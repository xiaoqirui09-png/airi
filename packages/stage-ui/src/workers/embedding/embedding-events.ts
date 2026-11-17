import type { DataType } from '@huggingface/transformers'

import { defineInvokeEventa } from '@moeru/eventa'

/** The model and backend settings that the main thread passes to the Worker once, before the first embed. */
export interface EmbeddingConfig {
  readonly model: string
  readonly dtype: DataType
  readonly device: 'wasm' | 'webgpu'
}

/** The raw model hidden states for a batch of texts, with the mask needed to mean-pool them on the main thread. */
export interface EmbeddingBatchOutput {
  /** Row-major [textCount * tokenCount * dim] hidden states. */
  readonly hidden: Float32Array
  /** Row-major [textCount * tokenCount] attention masks. */
  readonly masks: Float32Array
  /** Token count per text, all equal within a batch because texts are padded to the longest. */
  readonly tokenCount: number
  readonly dim: number
}

/**
 * Loads the feature-extraction model if needed and embeds a batch of texts. The Worker pads texts to one length, so
 * the main thread receives rectangular arrays that it can pool into one vector per text.
 */
export const embedTexts = defineInvokeEventa<EmbeddingBatchOutput, { texts: string[], config: EmbeddingConfig }>('eventa:memory:embed')

/** Releases the model in the Worker. Later embeds reject until a new Worker is created. */
export const closeEmbedder = defineInvokeEventa<void>('eventa:memory:embed:close')
