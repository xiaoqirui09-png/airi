import type { DataType } from '@huggingface/transformers'

import type { MemoryHit } from '../memory/recall'
import type { MemoryEntry } from '../types/memory'
import type { MemoryEmbedder } from '../workers/embedding/embedding'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { memoryVectorRepo } from '../database/repos/memory-vector.repo'
import {
  contentHash,
  cosine,
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL,
  EMBEDDING_REVISION,
  embeddingText,
  isVectorCurrent,
  modelSignature,
} from '../memory/embedding'
import { useMemoryStore } from './memory'

/** A chunk of the initial backfill, small enough not to stall the thread when embeddings are computed on WASM. */
const BACKFILL_BATCH = 16
/** A short pause between backfill batches, so an active conversation keeps priority. */
const BACKFILL_PAUSE_MS = 0

/**
 * Semantic recall for long-term memory, layered on top of the keyword store as an opt-in enhancement.
 *
 * The Worker and model load lazily on the first real use, so opening the app with embeddings off (the default) costs
 * nothing. Every path degrades to keyword-only recall: a missing Worker, a failed model load, a timeout, or a stale
 * vector never throws at the chat and never blocks a reply. Vectors live in their own store keyed by entry id, bound to
 * the model signature and text hash that produced them, so a model change invalidates them all without touching a fact.
 */
export const useMemoryEmbeddingStore = defineStore('memory-embedding', () => {
  const memory = useMemoryStore()

  const enabled = useLocalStorageManualReset<boolean>('settings/memory/embedding-enabled', false)
  const model = useLocalStorageManualReset<string>('settings/memory/embedding-model', EMBEDDING_MODEL)
  const dtype = useLocalStorageManualReset<DataType>('settings/memory/embedding-dtype', EMBEDDING_DTYPE)
  const device = useLocalStorageManualReset<'wasm' | 'webgpu'>('settings/memory/embedding-device', 'wasm')
  const timeoutMs = useLocalStorageManualReset<number>('settings/memory/embedding-timeout', 1500)
  const recallWeight = useLocalStorageManualReset<number>('settings/memory/embedding-recall-weight', 0.55)

  const ready = ref(false)
  const vectorCount = ref(0)
  const failure = ref<string | undefined>()
  const backfilling = ref(false)

  let embedder: MemoryEmbedder | undefined
  /** Serializes all vector computations so the single model instance is never asked for two batches at once. */
  let computation: Promise<unknown> = Promise.resolve()
  /** The signature of the model that the current Worker was built for. Empty until the first embed. */
  let activeSignature = ''
  /** The backend of the current Worker. A backend change rebuilds it but keeps the vectors (same vector space). */
  let activeDevice: 'wasm' | 'webgpu' | undefined

  /** The signature of the configured model, derived from the persisted model and dtype settings. */
  const signature = computed(() => modelSignature(model.value, EMBEDDING_REVISION, dtype.value))

  /** Whether a stored vector still matches the configured model and the entry's current text. */
  function vectorIsCurrent(vector: { modelSignature: string, dim: number, contentHash: string }, entry: MemoryEntry) {
    return isVectorCurrent(vector, contentHash(embeddingText(entry.description, entry.body)), signature.value)
  }

  /**
   * Lazily creates the embedder. Model loading is triggered by the first embed, not here, so an opted-in but unused
   * store still does not download weights. Stored vectors survive a restart: they are only dropped when the configured
   * model actually changes, detected by comparing the stored signature with the new one.
   */
  async function ensureEmbedder(): Promise<MemoryEmbedder> {
    if (embedder && activeSignature === signature.value && activeDevice === device.value)
      return embedder
    const modelChanged = activeSignature !== '' && activeSignature !== signature.value
    // A different model means a different vector space. Retire the old Worker and clear vectors that it produced.
    if (embedder) {
      await embedder.close()
      embedder = undefined
      if (modelChanged) {
        await memoryVectorRepo.clear()
        vectorCount.value = 0
      }
    }
    const { MemoryEmbedder: EmbedderClass } = await import('../workers/embedding/embedding')
    embedder = new EmbedderClass({ model: model.value, dtype: dtype.value, device: device.value })
    activeSignature = signature.value
    activeDevice = device.value
    ready.value = false
    failure.value = undefined
    return embedder
  }

  /** Runs a computation against the single model, one after another. A failed run resolves so the next still proceeds. */
  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = computation.then(run)
    computation = result.catch(() => {})
    return result
  }

  /**
   * Computes and stores the vector of one entry if it has none or its text or model changed. Never throws: a failed
   * embedding only loses this vector, leaving the remembered fact untouched.
   */
  async function ensureVector(entry: MemoryEntry): Promise<void> {
    if (!enabled.value || entry.status !== 'active')
      return
    try {
      await serialize(async () => {
        const embedderInstance = await ensureEmbedder()
        const text = embeddingText(entry.description, entry.body)
        const hash = contentHash(text)
        const stored = await memoryVectorRepo.get(entry.id)
        if (stored && vectorIsCurrent(stored, entry))
          return

        const [vector] = await embedderInstance.embed([text], AbortSignal.timeout(timeoutMs.value * 20), [hash])
        if (!vector)
          return
        await memoryVectorRepo.put({
          id: entry.id,
          ...(entry.persona ? { persona: entry.persona } : {}),
          modelSignature: signature.value,
          dim: vector.length,
          vector: Array.from(vector),
          contentHash: hash,
          updatedAt: Date.now(),
        })
        vectorCount.value = await memoryVectorRepo.count()
        ready.value = true
      })
    }
    catch (error) {
      failure.value = errorMessageFrom(error)
      console.warn('[memory-embedding] Failed to embed an entry:', errorMessageFrom(error))
    }
  }

  /** Schedules vector computation for changed entries without making the caller wait. */
  function scheduleVectors(entries: MemoryEntry[]): void {
    if (!enabled.value)
      return
    for (const entry of entries) {
      void ensureVector(entry)
    }
  }

  /**
   * Fills vectors for all active entries in small batches, pausing between them so an active conversation keeps the
   * model. It is safe to call repeatedly: entries that already have current vectors are skipped.
   */
  async function backfill(): Promise<void> {
    if (!enabled.value || backfilling.value)
      return
    backfilling.value = true
    try {
      await memory.ready()
      const active = memory.entries.filter(entry => entry.status === 'active')
      for (let start = 0; start < active.length; start += BACKFILL_BATCH) {
        await Promise.all(active.slice(start, start + BACKFILL_BATCH).map(entry => ensureVector(entry)))
        if (BACKFILL_PAUSE_MS > 0 && start + BACKFILL_BATCH < active.length)
          await new Promise(resolve => setTimeout(resolve, BACKFILL_PAUSE_MS))
      }
    }
    finally {
      backfilling.value = false
    }
  }

  /**
   * Scores the entries visible to a card by cosine similarity to the message, returning the best hits within a
   * relevance floor. Always resolves: when embeddings are off, unavailable, or too slow, it returns no hits and the
   * caller falls back to keyword recall untouched.
   */
  async function recallSemantic(personaId: string, message: string, signal?: AbortSignal): Promise<MemoryHit[]> {
    if (!enabled.value || !message.trim())
      return []
    const timeout = AbortSignal.timeout(timeoutMs.value)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const embedderInstance = await ensureEmbedder()
      const [query] = await embedderInstance.embed([message], combined)
      if (!query)
        return []

      const stored = await memoryVectorRepo.listFor(personaId)
      const visible = new Map(memory.entries.filter(entry => entry.status === 'active').map(entry => [entry.id, entry]))
      const hits: MemoryHit[] = []
      for (const vector of stored) {
        const entry = visible.get(vector.id)
        // Skip a stale vector rather than score it: a model or text change makes the cosine meaningless.
        if (!entry || !vectorIsCurrent(vector, entry))
          continue
        const score = cosine(query, vector.vector)
        // Negative or near-zero cosine means the entry is unrelated; do not hard-insert it into the reply.
        if (score <= 0)
          continue
        hits.push({ entry, score })
      }
      return hits.sort((left, right) => right.score - left.score)
    }
    catch (error) {
      if (!combined.aborted)
        console.warn('[memory-embedding] Semantic recall fell back to keywords:', errorMessageFrom(error))
      return []
    }
  }

  /** Turns embedding off without deleting facts. Vectors stay in their store for when it is enabled again. */
  function disable(): void {
    enabled.value = false
  }

  /** Releases the model and its Worker. The next use reloads from scratch. */
  async function close(): Promise<void> {
    await embedder?.close()
    embedder = undefined
    ready.value = false
  }

  /** Drops all vectors, e.g. after a model change the owner confirms. Facts are not touched. */
  async function clearVectors(): Promise<void> {
    await memoryVectorRepo.clear()
    vectorCount.value = 0
    embedder?.clearCache()
  }

  /** Reads the stored vector count once, for the settings status line. */
  async function loadCount(): Promise<void> {
    vectorCount.value = await memoryVectorRepo.count()
  }

  // The memory store republishes its entries after every write, accept, merge, and decay. Watching that single stream
  // keeps this store out of memory.ts (which would be a circular import) and makes vector upkeep automatic. `ensureVector`
  // is idempotent, so a republish that changed no text recomputes nothing.
  watch(() => memory.entries, (entries) => {
    if (enabled.value && entries.length > 0)
      scheduleVectors(entries)
  })

  // Turning the feature on starts a background backfill of any memories that predate embeddings, and reads the vector
  // count for the settings status line. The default is off, so opening the app downloads no model.
  watch(enabled, (on) => {
    if (on) {
      void loadCount()
      void backfill()
    }
  })

  return {
    enabled,
    model,
    dtype,
    device,
    timeoutMs,
    recallWeight,
    ready: computed(() => ready.value),
    vectorCount: computed(() => vectorCount.value),
    failure: computed(() => failure.value),
    backfilling: computed(() => backfilling.value),
    signature,
    ensureVector,
    scheduleVectors,
    backfill,
    recallSemantic,
    disable,
    close,
    clearVectors,
    loadCount,
  }
})
