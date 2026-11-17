import type { BaseModelOutput, PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers'

import type { EmbeddingBatchOutput, EmbeddingConfig } from './embedding-events'

import { AutoModel, AutoTokenizer } from '@huggingface/transformers'

/**
 * Owns the feature-extraction model and tokenizer inside the embedding Worker.
 *
 * The model loads lazily on the first embed, so opening the Worker costs nothing. Texts are tokenized with padding and
 * truncation to one length per batch; the returned hidden states and masks are rectangular arrays that the main thread
 * pools into one vector per text. WebGPU, when requested but unavailable, falls back to WASM.
 */
export class EmbeddingModel {
  private tokenizer: Promise<PreTrainedTokenizer> | undefined
  private model: Promise<PreTrainedModel> | undefined
  private resolvedDevice: 'wasm' | 'webgpu' | undefined
  private loading: Promise<void> | undefined
  private closed = false

  /** Resolves once the model and tokenizer are ready. Concurrent callers share one load. */
  async ready(config: EmbeddingConfig): Promise<void> {
    if (this.closed)
      throw new Error('Embedding model is closed')
    this.loading ??= this.load(config)
    await this.loading
  }

  private async load(config: EmbeddingConfig): Promise<void> {
    let device = config.device
    if (device === 'webgpu' && typeof navigator !== 'undefined' && !navigator.gpu) {
      console.warn('[embedding worker] WebGPU unavailable, falling back to WASM')
      device = 'wasm'
    }
    this.resolvedDevice = device
    // The tokenizer loads without device/dtype options; only the ONNX model needs them.
    this.tokenizer = AutoTokenizer.from_pretrained(config.model)
    this.model = (async () => {
      try {
        return await AutoModel.from_pretrained(config.model, { dtype: config.dtype, device })
      }
      catch (error) {
        // A WebGPU load can fail even when the adapter exists (device loss, unsupported op). Retry once on WASM.
        if (device === 'webgpu') {
          console.warn('[embedding worker] WebGPU load failed, retrying on WASM:', error)
          this.resolvedDevice = 'wasm'
          return await AutoModel.from_pretrained(config.model, { dtype: config.dtype, device: 'wasm' })
        }
        throw error
      }
    })()
    // Surface a load failure to whoever awaits ready(), but keep the promise so later calls see the same failure.
    void Promise.all([this.tokenizer, this.model]).catch(() => {})
    await Promise.all([this.tokenizer, this.model])
  }

  /** The device actually used after any fallback, for reporting to the main thread. */
  get device(): 'wasm' | 'webgpu' | undefined {
    return this.resolvedDevice
  }

  /**
   * Embeds a batch of texts. Returns raw hidden states and masks; pooling and normalization happen on the main thread.
   * An abort signal does not interrupt inference mid-call, but a closed model always rejects.
   */
  async embed(texts: string[], config: EmbeddingConfig, signal?: AbortSignal): Promise<EmbeddingBatchOutput> {
    signal?.throwIfAborted()
    await this.ready(config)
    signal?.throwIfAborted()
    const tokenizer = await this.tokenizer!
    const model = await this.model!

    const encoded = tokenizer(texts, { padding: true, truncation: true })
    const inputIds = encoded.input_ids
    const attentionMask = encoded.attention_mask
    if (!inputIds || !attentionMask)
      throw new Error('Tokenizer returned no input ids or mask')

    const tokenCount = inputIds.dims[1] ?? 0
    let output: BaseModelOutput | undefined
    try {
      output = await model({ input_ids: inputIds, attention_mask: attentionMask }) as BaseModelOutput
      const hidden = output.last_hidden_state
      const dim = hidden.dims[hidden.dims.length - 1] ?? 0
      // Feature-extraction hidden states are float32 and the attention mask holds 0/1 ids, both safe as numbers.
      return {
        hidden: new Float32Array(hidden.data as ArrayLike<number>),
        masks: new Float32Array(attentionMask.data as ArrayLike<number>),
        tokenCount,
        dim,
      }
    }
    finally {
      inputIds.dispose?.()
      attentionMask.dispose?.()
      output?.last_hidden_state?.dispose?.()
    }
  }

  /** Releases the model. The tokenizer needs no explicit disposal. Repeated calls are safe. */
  async close(): Promise<void> {
    if (this.closed)
      return
    this.closed = true
    await Promise.allSettled([
      this.model?.then(model => model.dispose()),
    ])
  }
}
