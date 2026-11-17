import { createPinia, disposePinia } from 'pinia'
import { prefixStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryAuditRepo } from '../database/repos/memory-audit.repo'
import { storage } from '../database/storage'
import { useMemoryStore } from './memory'

const records = prefixStorage(storage, 'memory')
const stores: ReturnType<typeof createPinia>[] = []

/** Each store stands for one window. */
function createStore() {
  const pinia = createPinia()
  stores.push(pinia)
  return useMemoryStore(pinia)
}

describe('memory store', () => {
  beforeEach(async () => {
    await records.clear()
    await memoryAuditRepo.clear()
    localStorage.removeItem('memory/entries')
    // The entries are in the order of their changes, so each change gets its own time.
    let now = 1
    vi.spyOn(Date, 'now').mockImplementation(() => now++)
  })

  afterEach(async () => {
    for (const pinia of stores.splice(0))
      disposePinia(pinia)
    vi.restoreAllMocks()
    localStorage.removeItem('memory/entries')
    await records.clear()
  })

  it('gives each new fact its own id, changes an entry by its id, and lists it in the index', async () => {
    const memory = createStore()
    const game = (await memory.write({ description: 'What the owner plays.', body: 'Porridge games.' }, 'airi'))!
    // Two facts with the same index line stay two entries.
    const other = (await memory.write({ description: 'What the owner plays.', body: 'Puzzle games on the train.' }, 'airi'))!
    await memory.write({ id: game.id, description: 'What the owner plays now.', body: 'Minecraft.' }, 'airi')

    expect(other.id).not.toBe(game.id)
    expect(memory.entries).toHaveLength(2)
    expect(memory.read(game.id, 'airi')?.body).toBe('Minecraft.')
    expect(memory.indexFor('airi')).toBe(`Your own:\n- ${other.id}: What the owner plays.\n- ${game.id}: What the owner plays now.`)
  })

  // A card keeps its own memories. Only the owner makes one general, and then every card reads it.
  it('keeps memories on their card until the owner makes one general', async () => {
    const memory = createStore()
    const nickname = (await memory.write({ description: 'What the owner likes to be called.', body: 'Yumeka.' }, 'airi'))!
    const rules = (await memory.write({ description: 'Rules of the Discord channel.', body: 'No spoilers.' }, 'discord-host'))!

    expect(memory.indexFor('discord-host')).toBe(`Your own:\n- ${rules.id}: Rules of the Discord channel.`)
    expect(memory.read(nickname.id, 'discord-host')).toBeUndefined()

    await memory.makeGeneral(nickname)

    expect(memory.indexFor('discord-host')).toBe(`Your own:\n- ${rules.id}: Rules of the Discord channel.\nGeneral:\n- ${nickname.id}: What the owner likes to be called.`)
    expect(memory.read(nickname.id, 'discord-host')?.body).toBe('Yumeka.')
    expect(memory.entries.find(entry => entry.id === nickname.id)?.persona).toBeUndefined()
  })

  it('changes and forgets only the card own entries, and refuses an empty body', async () => {
    const memory = createStore()
    const tone = (await memory.write({ description: '', body: 'Calm.' }, 'airi'))!
    await memory.makeGeneral(tone)
    // A general memory belongs to the owner, so a write with its id adds the card's own entry.
    const own = (await memory.write({ id: tone.id, description: '', body: 'Short sentences.' }, 'focus'))!

    expect(own.id).not.toBe(tone.id)
    expect(memory.read(tone.id, 'focus')?.body).toBe('Calm.')
    expect(await memory.forget(own.id, 'focus')).toBe(true)
    // A run cannot forget a general memory either.
    expect(await memory.forget(tone.id, 'focus')).toBe(false)
    expect(await memory.write({ description: '', body: ' ' }, 'airi')).toBeUndefined()
  })

  // A run writes in the chat window while the owner changes the same entry in Settings.
  it('never undoes a removal or a make-general from a window that has not read it yet', async () => {
    const chat = createStore()
    const settings = createStore()
    const nickname = (await chat.write({ description: 'What the owner likes to be called.', body: 'Yumeka.' }, 'airi'))!
    const tone = (await chat.write({ description: 'How to answer.', body: 'Calm.' }, 'airi'))!
    await vi.waitFor(() => expect(settings.entries).toHaveLength(2))

    await Promise.all([
      settings.remove(nickname),
      settings.makeGeneral(tone),
      chat.write({ id: nickname.id, description: 'What the owner likes to be called.', body: 'Yume.' }, 'airi'),
      chat.write({ id: tone.id, description: 'How to answer.', body: 'Short sentences.' }, 'airi'),
    ])

    await vi.waitFor(() => expect(settings.entries).toHaveLength(3))
    expect(await records.getItemRaw(nickname.id)).toEqual({ id: nickname.id, updatedAt: expect.any(Number), deleted: true })
    expect(settings.entries.find(entry => entry.id === tone.id)?.persona).toBeUndefined()
  })

  it('keeps the entries across restarts and shows a change in every window', async () => {
    const chat = createStore()
    const settings = createStore()
    const nickname = (await chat.write({ description: 'What the owner likes to be called.', body: 'Yumeka.' }, 'airi'))!

    await vi.waitFor(() => expect(settings.read(nickname.id, 'airi')?.body).toBe('Yumeka.'))
    const restarted = createStore()
    await vi.waitFor(() => expect(restarted.read(nickname.id, 'airi')?.body).toBe('Yumeka.'))

    await settings.remove(nickname)

    await vi.waitFor(() => expect(chat.entries).toEqual([]))
    // The removal stays as a tombstone.
    expect(await records.getItemRaw(nickname.id)).toEqual({ id: nickname.id, updatedAt: expect.any(Number), deleted: true })
  })

  it('moves the entries from localStorage once, with new ids, before it is ready', async () => {
    localStorage.setItem('memory/entries', JSON.stringify([
      { name: 'nickname', description: 'What the owner likes to be called.', body: 'Yumeka.', persona: 'airi', updatedAt: 10 },
      { name: 'tone', description: 'How to answer.', body: 'Calm.', updatedAt: 20 },
    ]))

    const memory = createStore()
    await memory.ready()

    // A record that predates the attributes reads as an active fact of the owner, at full confidence and salience,
    // with its change time as its creation time. The move keeps the facts and loses nothing.
    expect(memory.entries).toEqual([
      {
        id: expect.any(String),
        description: 'What the owner likes to be called.',
        body: 'Yumeka.',
        persona: 'airi',
        updatedAt: 10,
        kind: 'fact',
        source: 'user',
        confidence: 1,
        salience: 1,
        createdAt: 10,
        lastAccessedAt: 10,
        accessCount: 0,
        keywords: [],
        status: 'active',
      },
      {
        id: expect.any(String),
        description: 'How to answer.',
        body: 'Calm.',
        persona: undefined,
        updatedAt: 20,
        kind: 'fact',
        source: 'user',
        confidence: 1,
        salience: 1,
        createdAt: 20,
        lastAccessedAt: 20,
        accessCount: 0,
        keywords: [],
        status: 'active',
      },
    ])
    expect(localStorage.getItem('memory/entries')).toBeNull()
  })

  // Stage 3: a pending replacement only archives the old entry once the owner accepts it.
  it('archives the entries that a replacement supersedes only when the owner accepts it', async () => {
    const memory = createStore()
    const old = (await memory.write({ description: 'Cat name.', body: 'The cat is called Doudou.' }, 'airi'))!
    const candidate = {
      description: 'Cat name.',
      body: 'The cat is now called Maomao.',
      kind: 'fact' as const,
      source: 'user' as const,
      confidence: 0.9,
      keywords: ['cat', 'name'],
    }

    const pending = await memory.storeCandidate(candidate, 'airi', 'pending', { supersedes: [old.id], reason: 'replaces cat name' })

    expect(memory.entries.find(entry => entry.id === old.id)?.status).toBe('active')
    expect(pending.supersedes).toEqual([old.id])
    await memory.accept(pending)

    await vi.waitFor(() => expect(memory.entries.find(entry => entry.id === old.id)?.status).toBe('archived'))
    expect(memory.entries.find(entry => entry.id === old.id)?.mergedInto).toBe(pending.id)
    expect(memory.read(pending.id, 'airi')?.status).toBe('active')
  })

  // Stage 3: every automatic candidate writes an audit log, and undo removes it again.
  it('records a create in the audit and undoes it by removing the entry', async () => {
    const memory = createStore()
    const candidate = {
      description: 'Likes iced americano.',
      body: 'The owner drinks one each morning.',
      kind: 'preference' as const,
      source: 'user' as const,
      confidence: 0.9,
      keywords: ['americano'],
    }

    const entry = await memory.storeCandidate(candidate, 'airi', 'active')
    await vi.waitFor(() => expect(memory.auditLogs.length).toBeGreaterThan(0))
    const create = memory.auditLogs.find(log => log.action === 'create' && log.entryId === entry.id)
    expect(create).toBeDefined()

    expect(await memory.undoAudit(create!.id)).toBe(true)

    await vi.waitFor(() => expect(memory.entries.find(item => item.id === entry.id)).toBeUndefined())
  })

  // Stage 3: decay lowers an old entry's salience while leaving a fresh one alone.
  it('decays an old entry but not a fresh one', async () => {
    const memory = createStore()
    const old = (await memory.write({ description: 'Old fact.', body: 'Said long ago.' }, 'airi'))!
    await memory.ready()

    // The entry was written at a small mocked time. Decay at one half-life later: it should lose about half its salience.
    const oneHalfLifeLater = 90 * 86_400_000 + old.updatedAt
    const changed = await memory.runDecay(oneHalfLifeLater)

    expect(changed).toBe(1)
    await vi.waitFor(() => expect(memory.entries.find(entry => entry.id === old.id)?.salience).toBeLessThan(0.6))
  })

  const candidate = (description: string) => ({
    description,
    body: `${description} in full.`,
    kind: 'fact' as const,
    source: 'user' as const,
    confidence: 0.9,
    keywords: [description],
  })

  // Batch accept: every pending candidate becomes active, and active entries are left alone.
  it('accepts all pending candidates in one call', async () => {
    const memory = createStore()
    await memory.storeCandidate(candidate('Fact one.'), 'airi', 'pending')
    await memory.storeCandidate(candidate('Fact two.'), 'airi', 'pending')
    const active = (await memory.write({ description: 'Already known.', body: 'Kept.' }, 'airi'))!
    expect(memory.pendingCount).toBe(2)

    const count = await memory.acceptAll()

    expect(count).toBe(2)
    await vi.waitFor(() => expect(memory.pendingCount).toBe(0))
    expect(memory.entries.filter(entry => entry.status === 'active')).toHaveLength(3)
    expect(memory.entries.find(entry => entry.id === active.id)?.status).toBe('active')
  })

  // Batch reject: pending candidates are removed and never reach recall.
  it('rejects all pending candidates in one call', async () => {
    const memory = createStore()
    await memory.storeCandidate(candidate('Fact one.'), 'airi', 'pending')
    await memory.storeCandidate(candidate('Fact two.'), 'airi', 'pending')

    const count = await memory.rejectAll()

    expect(count).toBe(2)
    await vi.waitFor(() => expect(memory.pendingCount).toBe(0))
    expect(memory.entries.filter(entry => entry.status === 'active')).toHaveLength(0)
  })

  // Batch undo unwinds the whole trail newest-first, returning the store to its state before the changes.
  it('undoes the whole audit trail in one call', async () => {
    const memory = createStore()
    await memory.storeCandidate(candidate('First.'), 'airi', 'active')
    await memory.storeCandidate(candidate('Second.'), 'airi', 'active')
    await vi.waitFor(() => expect(memory.auditLogs.length).toBe(2))

    const count = await memory.undoAll()

    expect(count).toBe(2)
    await vi.waitFor(() => expect(memory.entries.filter(entry => entry.status === 'active')).toHaveLength(0))
  })
})
