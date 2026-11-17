import type { MemoryVector } from '../../types/memory'

import { prefixStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CURRENT_EMBEDDING_SIGNATURE } from '../../memory/embedding'
import { storage } from '../storage'
import { memoryVectorRepo } from './memory-vector.repo'

const records = prefixStorage(storage, 'memory-vector')

function vector(id: string, persona?: string): MemoryVector {
  return {
    id,
    ...(persona ? { persona } : {}),
    modelSignature: CURRENT_EMBEDDING_SIGNATURE,
    dim: 3,
    vector: [1, 0, 0],
    contentHash: 'abc',
    updatedAt: 10,
  }
}

describe('memory vector repository', () => {
  beforeEach(async () => {
    await records.clear()
  })

  afterEach(async () => {
    await records.clear()
  })

  it('stores and reads one vector by entry id', async () => {
    await memoryVectorRepo.put(vector('cat'))

    expect((await memoryVectorRepo.get('cat'))?.vector).toEqual([1, 0, 0])
  })

  it('returns undefined for an entry with no vector', async () => {
    expect(await memoryVectorRepo.get('missing')).toBeUndefined()
  })

  it('stores several vectors in one write', async () => {
    await memoryVectorRepo.putMany([vector('cat'), vector('dog', 'default')])

    expect(await memoryVectorRepo.count()).toBe(2)
  })

  it('overwrites an older vector when the entry is re-embedded', async () => {
    await memoryVectorRepo.put(vector('cat'))
    await memoryVectorRepo.put({ ...vector('cat'), vector: [0, 1, 0], contentHash: 'def' })

    const stored = await memoryVectorRepo.get('cat')
    expect(stored?.vector).toEqual([0, 1, 0])
    expect(stored?.contentHash).toBe('def')
    expect(await memoryVectorRepo.count()).toBe(1)
  })

  // persona isolation: a card only sees its own vectors and the general ones, as with the facts themselves.
  it('lists only the vectors visible to a card', async () => {
    await memoryVectorRepo.putMany([
      vector('mine', 'default'),
      vector('general'),
      vector('theirs', 'other'),
    ])

    const ids = (await memoryVectorRepo.listFor('default')).map(item => item.id).sort()
    expect(ids).toEqual(['general', 'mine'])
  })

  it('removes the vectors of forgotten entries', async () => {
    await memoryVectorRepo.putMany([vector('cat'), vector('dog')])

    await memoryVectorRepo.remove(['cat'])

    expect(await memoryVectorRepo.get('cat')).toBeUndefined()
    expect(await memoryVectorRepo.get('dog')).toBeDefined()
  })

  it('clears every vector when the model changes or all data is deleted', async () => {
    await memoryVectorRepo.putMany([vector('cat'), vector('dog')])

    await memoryVectorRepo.clear()

    expect(await memoryVectorRepo.count()).toBe(0)
  })
})
