/**
 * Pure helpers for memory embeddings. No model, worker, or browser API lives here, so the vector math and the
 * invalidation rules can be unit-tested. The Worker (see workers/embedding) only produces the raw hidden states;
 * pooling, normalization, scoring, and version checks happen here on the main thread.
 */

/** The feature-extraction model used for memory vectors: a small Chinese-optimized bidirectional encoder. */
export const EMBEDDING_MODEL = 'Xenova/bge-small-zh-v1.5'
/** Model revision pinned so a silent upstream update cannot change the vector space under stored vectors. */
export const EMBEDDING_REVISION = 'v1'
/** Quantization used by default. q8 keeps the download small with little accuracy loss. */
export const EMBEDDING_DTYPE = 'q8'
/** bge-small-zh-v1.5 emits 512-dimensional sentence vectors. */
export const EMBEDDING_DIM = 512
/** The number of cached (text hash -> vector) entries kept on the main thread. */
export const EMBEDDING_CACHE_LIMIT = 512

/**
 * The signature that a vector is bound to. Changing the model, revision, or quantization produces a new signature,
 * which invalidates every stored vector so a query is never scored against vectors from a different space.
 */
export function modelSignature(
  model = EMBEDDING_MODEL,
  revision = EMBEDDING_REVISION,
  dtype = EMBEDDING_DTYPE,
): string {
  return `${model}@${revision}#${dtype}`
}

/** The signature of the default model, used by tests and as a fallback. Callers with a custom model pass their own. */
export const CURRENT_EMBEDDING_SIGNATURE = modelSignature()

/**
 * FNV-1a over the text that produced a vector. A 32-bit hash is plenty to notice an edited memory: collisions only
 * matter if two different facts hash equal, which is unlikely at this scale, and a collision merely reuses a vector.
 */
export function contentHash(text: string): string {
  let hash = 0x811C9DC5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/** The text that is embedded for an entry: the index line plus the body, so a short description still carries detail. */
export function embeddingText(description: string, body: string): string {
  return `${description}\n${body}`
}

/**
 * Mean-pools a token hidden-state matrix into one sentence vector, using the attention mask so padding tokens do not
 * dilute the result. `hidden` is row-major [tokenCount * dim]; `mask` holds 1 for real tokens and 0 for padding.
 */
export function meanPool(hidden: Float32Array, mask: ArrayLike<number>, dim = EMBEDDING_DIM): Float32Array {
  const tokenCount = Math.floor(hidden.length / dim)
  const pooled = new Float32Array(dim)
  let tokenTotal = 0
  for (let token = 0; token < tokenCount; token++) {
    const weight = mask[token] ?? 0
    if (weight <= 0)
      continue
    tokenTotal += weight
    const offset = token * dim
    for (let d = 0; d < dim; d++)
      pooled[d] += hidden[offset + d] * weight
  }
  if (tokenTotal > 0) {
    for (let d = 0; d < dim; d++)
      pooled[d] /= tokenTotal
  }
  return pooled
}

/** L2-normalizes a vector in place and returns it, so cosine similarity is a plain dot product. */
export function normalize(vector: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++)
    sum += vector[i] * vector[i]
  const length = Math.sqrt(sum)
  if (length > 0) {
    for (let i = 0; i < vector.length; i++)
      vector[i] /= length
  }
  return vector
}

/** Cosine similarity of two unit vectors, clamped to [-1, 1] to absorb floating-point drift. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length)
  if (length === 0)
    return 0
  let dot = 0
  for (let i = 0; i < length; i++)
    dot += a[i] * b[i]
  return Math.min(1, Math.max(-1, dot))
}

/**
 * Whether a stored vector was produced by the configured model and still matches the entry's text. Callers pass the
 * signature of the model they actually configured, so switching model invalidates old vectors without a hardcoded
 * default. The dimension is fixed by the model family and checked too.
 */
export function isVectorCurrent(vector: { modelSignature: string, dim: number, contentHash: string }, expectedHash: string, expectedSignature = CURRENT_EMBEDDING_SIGNATURE): boolean {
  return vector.modelSignature === expectedSignature
    && vector.dim === EMBEDDING_DIM
    && vector.contentHash === expectedHash
}
