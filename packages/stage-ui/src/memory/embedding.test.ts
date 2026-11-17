import { describe, expect, it } from 'vitest'

import {
  contentHash,
  cosine,
  CURRENT_EMBEDDING_SIGNATURE,
  EMBEDDING_DIM,
  embeddingText,
  isVectorCurrent,
  meanPool,
  modelSignature,
  normalize,
} from './embedding'

describe('modelSignature', () => {
  it('joins model, revision and dtype', () => {
    expect(modelSignature('m', 'r', 'q8')).toBe('m@r#q8')
  })

  it('derives the current signature from the pinned defaults', () => {
    expect(CURRENT_EMBEDDING_SIGNATURE).toContain('@')
    expect(CURRENT_EMBEDDING_SIGNATURE).toContain('#q8')
  })
})

describe('contentHash', () => {
  it('is stable for the same text', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'))
  })

  it('changes when the text changes', () => {
    expect(contentHash('hello')).not.toBe(contentHash('hallo'))
  })

  it('distinguishes description and body order', () => {
    expect(contentHash('a\nb')).not.toBe(contentHash('b\na'))
  })
})

describe('embeddingText', () => {
  it('joins description and body with a newline', () => {
    expect(embeddingText('title', 'detail')).toBe('title\ndetail')
  })
})

describe('meanPool', () => {
  it('averages real tokens and ignores masked padding', () => {
    const dim = 2
    // token0 = [2, 4] (real), token1 = [100, 100] (padding, masked out)
    const hidden = new Float32Array([2, 4, 100, 100])
    const pooled = meanPool(hidden, [1, 0], dim)
    expect(pooled[0]).toBeCloseTo(2, 5)
    expect(pooled[1]).toBeCloseTo(4, 5)
  })

  it('weights tokens by their mask values', () => {
    const dim = 1
    const hidden = new Float32Array([2, 6])
    const pooled = meanPool(hidden, [1, 3], dim)
    // (2*1 + 6*3) / 4 = 5
    expect(pooled[0]).toBeCloseTo(5, 5)
  })

  it('returns zeros for an all-masked matrix', () => {
    const pooled = meanPool(new Float32Array([1, 2]), [0, 0], 1)
    expect(pooled[0]).toBe(0)
  })
})

describe('normalize', () => {
  it('produces a unit vector', () => {
    const vector = normalize(new Float32Array([3, 4]))
    expect(Math.sqrt(vector[0] ** 2 + vector[1] ** 2)).toBeCloseTo(1, 5)
  })

  it('leaves a zero vector unchanged', () => {
    const vector = normalize(new Float32Array([0, 0]))
    expect(vector[0]).toBe(0)
    expect(vector[1]).toBe(0)
  })
})

describe('cosine', () => {
  it('is 1 for identical direction', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5)
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5)
  })

  it('is -1 for opposite vectors', () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 5)
  })

  it('is 0 for empty vectors', () => {
    expect(cosine([], [])).toBe(0)
  })
})

describe('isVectorCurrent', () => {
  const hash = contentHash('text')

  it('accepts a vector with the current signature, dim and hash', () => {
    expect(isVectorCurrent({ modelSignature: CURRENT_EMBEDDING_SIGNATURE, dim: EMBEDDING_DIM, contentHash: hash }, hash)).toBe(true)
  })

  it('rejects a stale model signature', () => {
    expect(isVectorCurrent({ modelSignature: 'old@r#q8', dim: EMBEDDING_DIM, contentHash: hash }, hash)).toBe(false)
  })

  it('rejects a wrong dimension', () => {
    expect(isVectorCurrent({ modelSignature: CURRENT_EMBEDDING_SIGNATURE, dim: 128, contentHash: hash }, hash)).toBe(false)
  })

  it('rejects a stale content hash', () => {
    expect(isVectorCurrent({ modelSignature: CURRENT_EMBEDDING_SIGNATURE, dim: EMBEDDING_DIM, contentHash: hash }, 'other')).toBe(false)
  })
})
