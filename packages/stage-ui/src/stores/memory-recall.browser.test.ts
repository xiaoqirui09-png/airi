import type { MemoryCandidate } from '@proj-airi/agents/memory-extract'

import { createPinia, disposePinia } from 'pinia'
import { prefixStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryIndexRepo } from '../database/repos/memory-index.repo'
import { memoryQueueRepo } from '../database/repos/memory-queue.repo'
import { memoryRepo } from '../database/repos/memory.repo'
import { storage } from '../database/storage'
import { newQueueTask } from '../memory/queue'
import { useMemoryStore } from './memory'

const records = prefixStorage(storage, 'memory')
const indexRecords = prefixStorage(storage, 'memory-index')
const queueRecords = prefixStorage(storage, 'memory-queue')
const stores: ReturnType<typeof createPinia>[] = []

// The settings outlive a store, so a test that turns recall off must not turn it off for the tests after it.
const settingsKeys = ['memory/enabled', 'settings/memory/recall-enabled', 'settings/memory/recall-top-n', 'settings/memory/recall-budget-chars']

function clearSettings() {
  localStorage.removeItem('memory/entries')
  for (const key of settingsKeys)
    localStorage.removeItem(key)
}

const candidate: MemoryCandidate = {
  description: 'Keeps a cat named Doudou.',
  body: 'The owner said they keep a cat named Doudou.',
  kind: 'fact',
  source: 'user',
  confidence: 0.9,
  keywords: ['Doudou'],
}

/** Each store stands for one window. */
function createStore() {
  const pinia = createPinia()
  stores.push(pinia)
  return useMemoryStore(pinia)
}

describe('memory recall', () => {
  beforeEach(async () => {
    await Promise.all([records.clear(), indexRecords.clear(), queueRecords.clear()])
    clearSettings()
    let now = 1
    vi.spyOn(Date, 'now').mockImplementation(() => now++)
  })

  afterEach(async () => {
    for (const pinia of stores.splice(0))
      disposePinia(pinia)
    vi.restoreAllMocks()
    clearSettings()
    await Promise.all([records.clear(), indexRecords.clear(), queueRecords.clear()])
  })

  it('recalls a written fact for a message that names it, and nothing for another topic', async () => {
    const memory = createStore()
    await memory.write({ description: 'Keeps a cat named Doudou.', body: 'Doudou is a cat.' }, 'airi')

    await vi.waitFor(() => expect(memory.recall('airi', 'How is Doudou today?').map(hit => hit.entry.description)).toEqual(['Keeps a cat named Doudou.']))
    expect(memory.recall('airi', 'What is the weather tomorrow?')).toEqual([])
  })

  // The entries can predate the index, or a rebuild can have been interrupted, so an empty index over stored facts is derived again.
  it('derives the index from entries that were stored before it existed', async () => {
    await memoryRepo.put({
      id: 'cat',
      description: 'Keeps a cat named Doudou.',
      body: 'Doudou is a cat.',
      persona: 'airi',
      updatedAt: 10,
      kind: 'fact',
      source: 'user',
      confidence: 1,
      salience: 1,
      createdAt: 10,
      lastAccessedAt: 10,
      accessCount: 0,
      keywords: ['Doudou'],
      status: 'active',
    })
    expect((await memoryIndexRepo.list()).size).toBe(0)

    const memory = createStore()
    await memory.ready()

    await vi.waitFor(() => expect(memory.recall('airi', 'Doudou').map(hit => hit.entry.id)).toEqual(['cat']))
  })

  it('recalls through the ideograph bigrams of a Chinese message', async () => {
    const memory = createStore()
    await memory.storeCandidate({ ...candidate, description: '养了一只叫豆豆的猫', body: '豆豆是去年领养的。', keywords: ['豆豆'] }, 'airi', 'active')

    await vi.waitFor(() => expect(memory.recall('airi', '豆豆今天怎么样')).toHaveLength(1))
    expect(memory.recall('airi', '明天天气如何')).toEqual([])
  })

  // A pending candidate waits for the owner, so it reaches neither the index nor a recall.
  it('keeps a pending candidate out of the index and recall until the owner accepts it', async () => {
    const memory = createStore()
    const stored = await memory.storeCandidate(candidate, 'airi', 'pending')

    expect(memory.pendingCount).toBe(1)
    expect(memory.indexFor('airi')).toBe('')
    expect(memory.recall('airi', 'Doudou')).toEqual([])

    await memory.accept(stored)

    expect(memory.pendingCount).toBe(0)
    expect(memory.indexFor('airi')).toContain(stored.id)
    await vi.waitFor(() => expect(memory.recall('airi', 'Doudou').map(hit => hit.entry.id)).toEqual([stored.id]))
  })

  it('recalls an automatic candidate at once, because it needs no acceptance', async () => {
    const memory = createStore()
    const stored = await memory.storeCandidate(candidate, 'airi', 'active')

    expect(memory.pendingCount).toBe(0)
    await vi.waitFor(() => expect(memory.recall('airi', 'Doudou').map(hit => hit.entry.id)).toEqual([stored.id]))
  })

  it('accepts only a pending candidate, and leaves an active one as it is', async () => {
    const memory = createStore()
    const stored = await memory.storeCandidate(candidate, 'airi', 'active')
    const before = memory.entries.find(entry => entry.id === stored.id)

    await memory.accept(stored)

    expect(memory.entries.find(entry => entry.id === stored.id)).toEqual(before)
  })

  it('recalls nothing when the owner turns recall off, and keeps the index', async () => {
    const memory = createStore()
    await memory.write({ description: 'Keeps a cat named Doudou.', body: 'Doudou is a cat.' }, 'airi')
    await vi.waitFor(() => expect(memory.recall('airi', 'Doudou')).toHaveLength(1))

    memory.recallEnabled = false

    expect(memory.recall('airi', 'Doudou')).toEqual([])
    expect(memory.indexFor('airi')).toContain('Doudou')
  })

  it('recalls only the memories of the card and the general ones', async () => {
    const memory = createStore()
    await memory.write({ description: 'Keeps a cat named Doudou.', body: 'Doudou is a cat.' }, 'airi')
    await memory.write({ description: 'Keeps a dog named Doudou too.', body: 'Another Doudou.' }, 'discord-host')

    await vi.waitFor(() => expect(memory.recall('airi', 'Doudou')).toHaveLength(1))
    expect(memory.recall('airi', 'Doudou')[0]?.entry.persona).toBe('airi')
    expect(memory.recall('discord-host', 'Doudou')[0]?.entry.persona).toBe('discord-host')
  })

  // A read is not a change, so the index order and the recency of the fact stay as they were.
  it('counts a read without changing the fact or its place in the index', async () => {
    const memory = createStore()
    const stored = (await memory.write({ description: 'Keeps a cat named Doudou.', body: 'Doudou is a cat.' }, 'airi'))!
    const indexBefore = memory.indexFor('airi')

    await memory.recordAccess([stored.id])

    const after = memory.entries.find(entry => entry.id === stored.id)!
    expect(after.accessCount).toBe(1)
    expect(after.lastAccessedAt).toBeGreaterThan(stored.lastAccessedAt)
    expect(after.updatedAt).toBe(stored.updatedAt)
    expect(memory.indexFor('airi')).toBe(indexBefore)
  })

  it('counts no read for an empty id list', async () => {
    const memory = createStore()
    const stored = (await memory.write({ description: 'Keeps a cat named Doudou.', body: 'Doudou is a cat.' }, 'airi'))!

    await memory.recordAccess([])

    expect(memory.entries.find(entry => entry.id === stored.id)?.accessCount).toBe(0)
  })

  it('shows a new fact and its index in every window', async () => {
    const chat = createStore()
    const settings = createStore()
    await chat.ready()
    await settings.ready()

    const stored = (await chat.write({ description: 'Keeps a cat named Doudou.', body: 'Doudou is a cat.' }, 'airi'))!

    await vi.waitFor(() => expect(settings.recall('airi', 'Doudou').map(hit => hit.entry.id)).toEqual([stored.id]))
  })

  it('deletes the entries, the index, and the queue when all data is deleted', async () => {
    const memory = createStore()
    await memory.write({ description: 'Keeps a cat named Doudou.', body: 'Doudou is a cat.' }, 'airi')
    await memoryQueueRepo.enqueue(newQueueTask('t1', 'airi', { userText: 'Doudou', assistantText: 'Lovely.', toolCalls: [] }, 10))
    await vi.waitFor(() => expect(memory.recall('airi', 'Doudou')).toHaveLength(1))

    await memory.resetState()

    expect(memory.entries).toEqual([])
    expect(memory.recall('airi', 'Doudou')).toEqual([])
    expect((await memoryIndexRepo.list()).size).toBe(0)
    expect(await memoryQueueRepo.list()).toEqual([])
  })

  it('restores an imported file that predates the attributes, and recalls it', async () => {
    const memory = createStore()
    await memory.ready()

    await memory.restoreState({
      enabled: true,
      entries: [{ id: 'cat', description: 'Keeps a cat named Doudou.', body: 'Doudou is a cat.', persona: 'airi', updatedAt: 10 }],
    })

    expect(memory.entries[0]).toMatchObject({ kind: 'fact', source: 'user', confidence: 1, status: 'active', createdAt: 10 })
    await vi.waitFor(() => expect(memory.recall('airi', 'Doudou').map(hit => hit.entry.id)).toEqual(['cat']))
  })
})
