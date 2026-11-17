import type { MemoryEntry } from '../../types/memory'

import { prefixStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { normalizeMemoryEntry } from '../../memory/attributes'
import { rebuildMemoryIndex } from '../../memory/inverted-index'
import { storage } from '../storage'
import { memoryIndexRepo } from './memory-index.repo'

const records = prefixStorage(storage, 'memory-index')

function entry(id: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return normalizeMemoryEntry({ id, description: 'Keeps a cat.', body: 'The cat is named Doudou.', updatedAt: 10, ...overrides })
}

describe('memory index repository', () => {
  beforeEach(async () => {
    await records.clear()
  })

  afterEach(async () => {
    await records.clear()
  })

  it('stores and reads every keyword with its postings', async () => {
    await memoryIndexRepo.replace(new Map([['doudou', [{ id: 'cat', weight: 1 }]], ['cat', [{ id: 'cat', weight: 0.5 }]]]))

    const stored = await memoryIndexRepo.list()

    expect(stored.get('doudou')).toEqual([{ id: 'cat', weight: 1 }])
    expect(stored.get('cat')).toEqual([{ id: 'cat', weight: 0.5 }])
    expect(stored.size).toBe(2)
  })

  // A rebuild derives every posting from the entries, so no posting of a removed entry survives it.
  it('replaces the whole index, leaving no stale keyword', async () => {
    await memoryIndexRepo.replace(new Map([['old', [{ id: 'gone', weight: 1 }]]]))

    await memoryIndexRepo.replace(new Map([['new', [{ id: 'cat', weight: 1 }]]]))

    expect([...(await memoryIndexRepo.list()).keys()]).toEqual(['new'])
  })

  it('reads an empty index when nothing is stored', async () => {
    expect((await memoryIndexRepo.list()).size).toBe(0)
  })

  it('deletes every keyword when all data is deleted', async () => {
    await memoryIndexRepo.replace(new Map([['cat', [{ id: 'cat', weight: 1 }]]]))

    await memoryIndexRepo.clear()

    expect((await memoryIndexRepo.list()).size).toBe(0)
  })
})

describe('rebuildMemoryIndex', () => {
  beforeEach(async () => {
    await records.clear()
  })

  afterEach(async () => {
    await records.clear()
  })

  it('weighs a key that the extraction named above a key that only the text yields', async () => {
    const postings = await rebuildMemoryIndex([entry('cat', { keywords: ['Doudou'] })])

    expect(postings.get('doudou')).toEqual([{ id: 'cat', weight: 1 }])
    expect(postings.get('cat')).toEqual([{ id: 'cat', weight: 0.5 }])
    expect(postings.get('named')).toEqual([{ id: 'cat', weight: 0.5 }])
  })

  it('posts one keyword to every entry that names it', async () => {
    const postings = await rebuildMemoryIndex([entry('cat'), entry('dog', { description: 'Keeps a cat too.', body: 'Another cat.' })])

    expect(postings.get('cat')).toEqual([{ id: 'cat', weight: 0.5 }, { id: 'dog', weight: 0.5 }])
  })

  // Recall and conflict detection select the statuses that they need, so the index holds every entry.
  it('indexes every status, not only the active ones', async () => {
    const postings = await rebuildMemoryIndex([entry('active'), entry('pending', { status: 'pending' }), entry('archived', { status: 'archived' })])

    expect(postings.get('cat')?.map(posting => posting.id)).toEqual(['active', 'pending', 'archived'])
  })

  it('saves the postings that it resolves to, so another window reads the same index', async () => {
    const postings = await rebuildMemoryIndex([entry('cat', { keywords: ['Doudou'] })])

    expect(await memoryIndexRepo.list()).toEqual(postings)
  })

  it('stores no keyword for an entry whose text holds no word', async () => {
    expect((await rebuildMemoryIndex([entry('empty', { description: '...', body: '🐱', keywords: [] })])).size).toBe(0)
  })

  it('stores an empty index when no entry is stored', async () => {
    expect((await rebuildMemoryIndex([])).size).toBe(0)
    expect((await memoryIndexRepo.list()).size).toBe(0)
  })
})
