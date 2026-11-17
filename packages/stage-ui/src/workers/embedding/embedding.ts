import type { EmbeddingConfig } from './embedding-events'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers'

import { EMBEDDING_CACHE_LIMIT, EMBEDDING_DIM, meanPool, normalize } from '../../memory/embedding'
import { closeEmbedder, embedTexts } from './embedding-events'

/**
 * Main-thread wrapper for the embedding Worker. It lazily starts the Worker, keeps an LRU cache of text hash -> unit
 * vector, and pools the raw hidden states that the Worker returns. A failed load is remembered so one broken model
 * does not spawn an endless retry loop; a new wrapper (or restart) is the way to retry.
 *
 * Callers never see the raw hidden states: `embed` resolves to one normalized vector per text, in input order.
 */
export class MemoryEmbedder {
  private worker: Worker | undefined
  private readonly embedInvoke
  private readonly closeInvoke
  private readonly cache = new Map<string, Float32Array>()
  private config: EmbeddingConfig
  private loadFailed: Error | undefined
  private closing: Promise<void> | undefined
  private errorListener: ((event: ErrorEvent) => void) | undefined

  constructor(config: EmbeddingConfig) {
    this.config = config
    const worker = new Worker(new URL('./embedding.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    this.errorListener = (event: ErrorEvent) => {
      this.loadFailed = new Error(event.message || 'Embedding worker failed')
    }
    worker.addEventListener('error', this.errorListener)
    const { context } = createContext(worker)
    this.embedInvoke = defineInvoke(context, embedTexts)
    this.closeInvoke = defineInvoke(context, closeEmbedder)
  }

  /** Whether the model (or the Worker) has failed, so callers can report status without starting a load. */
  get failure(): Error | undefined {
    return this.loadFailed
  }

  /** Forces the next config to be used. A device or dtype change needs a fresh model in the Worker. */
  setConfig(config: EmbeddingConfig): void {
    this.config = config
  }

  /**
   * Resolves once the model is loaded, so a caller can warm it up before it needs a vector. The load itself happens on
   * the first embed; this just awaits it with an empty batch, which the Worker still tokenizes as a no-op.
   */
  async ready(signal: AbortSignal): Promise<void> {
    if (this.loadFailed)
      throw this.loadFailed
    await this.embedInvoke({ texts: [], config: this.config }, { signal })
  }

  /**
   * Embeds texts into unit vectors in input order. Cached texts bypass the Worker entirely. A Worker failure is
   * remembered so later calls fail fast instead of retrying a broken model.
   */
  async embed(texts: string[], signal: AbortSignal, hashes: string[] = texts): Promise<Float32Array[]> {
    signal.throwIfAborted()
    if (this.loadFailed)
      throw this.loadFailed
    if (this.closing)
      throw new Error('Embedding model is closing')
    if (texts.length === 0)
      return []

    const result: (Float32Array | undefined)[] = texts.map((_, index) => {
      const cached = this.cache.get(hashes[index])
      return cached ? new Float32Array(cached) : undefined
    })
    const pending: number[] = []
    for (let index = 0; index < result.length; index++) {
      if (!result[index])
        pending.push(index)
    }
    if (pending.length === 0)
      return result as Float32Array[]

    try {
      const batch = await this.embedInvoke({ texts: pending.map(index => texts[index]), config: this.config }, { signal })
      for (let row = 0; row < pending.length; row++) {
        const index = pending[row]
        const offsetRow = row * batch.tokenCount * batch.dim
        const maskOffset = row * batch.tokenCount
        const mask = batch.masks.subarray(maskOffset, maskOffset + batch.tokenCount)
        const hidden = batch.hidden.subarray(offsetRow, offsetRow + batch.tokenCount * batch.dim)
        const vector = normalize(meanPool(hidden, mask, batch.dim || EMBEDDING_DIM))
        result[index] = vector
        this.remember(hashes[index], vector)
      }
      return result as Float32Array[]
    }
    catch (error) {
      // Only a real load/inference failure poisons the wrapper. An abort is transient and must not.
      if (!signal.aborted)
        this.loadFailed = error instanceof Error ? error : new Error(String(error))
      throw error
    }
  }

  /** Caches a vector under a text hash, evicting the oldest entry at capacity. */
  private remember(hash: string, vector: Float32Array): void {
    if (!hash)
      return
    if (this.cache.has(hash))
      this.cache.delete(hash)
    this.cache.set(hash, new Float32Array(vector))
    while (this.cache.size > EMBEDDING_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined)
        break
      this.cache.delete(oldest)
    }
  }

  /** Clears the in-memory cache, e.g. after a model change invalidates every vector. */
  clearCache(): void {
    this.cache.clear()
  }

  /** Releases the model and terminates the Worker. Repeated calls share completion. */
  close(): Promise<void> {
    this.closing ??= this.closeInvoke().catch(() => {}).finally(() => {
      if (this.worker) {
        if (this.errorListener)
          this.worker.removeEventListener('error', this.errorListener)
        this.worker.terminate()
        this.worker = undefined
      }
      this.cache.clear()
    })
    return this.closing
  }
}
