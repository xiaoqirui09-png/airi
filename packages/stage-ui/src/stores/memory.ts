import type { MemoryCandidate } from '@proj-airi/agents/memory-extract'

import type { KeywordPosting, MemoryEntry, MemoryEntryRecord, MemoryStatus, MemoryWrite } from '../types/memory'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { v7 as uuidv7 } from 'uuid'
import { computed, ref, toRaw, watch } from 'vue'

import { memoryIndexRepo } from '../database/repos/memory-index.repo'
import { memoryQueueRepo } from '../database/repos/memory-queue.repo'
import { memoryRepo } from '../database/repos/memory.repo'
import { rebuildMemoryIndex } from '../memory/inverted-index'
import { recallMemories } from '../memory/recall'

const LEGACY_ENTRIES_STORAGE_KEY = 'memory/entries'

// NOTICE:
// Up to v0.13.1 the entries were in localStorage under `memory/entries`, keyed by a name that the model chose.
// localStorage holds a few megabytes, and two facts could share a name. IndexedDB keeps the entries now, with store-made ids.
// Move them once. The lock keeps two windows that start together from moving them twice.
// Removal condition: two releases after the release that moves them.
async function moveLegacyEntries() {
  if (!globalThis.localStorage?.getItem(LEGACY_ENTRIES_STORAGE_KEY))
    return
  await navigator.locks.request('airi:memory-move', async () => {
    const stored = localStorage.getItem(LEGACY_ENTRIES_STORAGE_KEY)
    if (!stored)
      return
    const legacy: (Omit<MemoryEntryRecord, 'id'> & { name: string })[] = JSON.parse(stored)
    await memoryRepo.add(legacy.map(({ description, body, persona, updatedAt }) => ({ id: uuidv7(), description, body, persona, updatedAt })))
    localStorage.removeItem(LEGACY_ENTRIES_STORAGE_KEY)
  })
}

/**
 * Long-term memory as a small index and one entry per fact, kept by the character itself.
 * IndexedDB keeps the entries and their inverted index. After each change, the other windows read them again.
 *
 * Use when:
 * - A run reads the index or an entry, writes or forgets a fact, or Settings lists the memories by card.
 * - A run recalls the entries that its message names, before it composes a reply.
 *
 * Expects:
 * - Callers pass the character card of the run. It reads its own memories and the general ones.
 * - Only the owner makes a memory general, in Settings. A run writes and forgets only its own card's memories.
 * - An extracted candidate stays pending until the owner accepts it, unless automatic extraction runs in auto mode.
 *
 * Returns:
 * - Whether memory is on, entries, `ready` for the first read, the index for a card, and actions that change entries.
 */
export const useMemoryStore = defineStore('memory', () => {
  const enabled = useLocalStorageManualReset<boolean>('memory/enabled', true)
  const recallEnabled = useLocalStorageManualReset<boolean>('settings/memory/recall-enabled', true)
  const recallTopN = useLocalStorageManualReset<number>('settings/memory/recall-top-n', 8)
  const recallBudgetChars = useLocalStorageManualReset<number>('settings/memory/recall-budget-chars', 800)
  const entries = ref<MemoryEntry[]>([])
  const postings = ref<Map<string, KeywordPosting[]>>(new Map())
  const { data: changed, post } = useBroadcastChannel<string[], string[]>({ name: 'airi:memory' })
  let pendingLoad = moveLegacyEntries()
    .catch(error => console.warn('[memory] Failed to move the entries from localStorage:', errorMessageFrom(error)))

  /** Reads the entries again, after the reads that started before. */
  function load() {
    pendingLoad = pendingLoad.catch(() => {}).then(async () => {
      entries.value = await memoryRepo.list()
    })
    return pendingLoad
  }

  /**
   * Resolves after every read that started before the call, the first read and the move from localStorage included.
   * Until then, `entries` is empty because nothing is read yet, not because nothing is remembered.
   */
  function ready() {
    return pendingLoad.catch(() => {})
  }

  /**
   * Reads the inverted index. An empty index over a non-empty fact store means the entries predate the index, or a
   * rebuild never finished, so it is derived again from the entries that this window just read.
   */
  async function loadIndex() {
    const stored = await memoryIndexRepo.list()
    postings.value = stored.size === 0 && entries.value.length > 0
      ? await rebuildMemoryIndex(entries.value)
      : stored
  }

  /** Reads the entries again after a change, derives their index, and tells the other windows. */
  async function publish(ids: string[]) {
    await load()
    postings.value = await rebuildMemoryIndex(entries.value)
    post(ids)
  }

  /** The entries that a card can see: its own, then the general ones. Only active entries reach a run. */
  function activeFor(personaId: string) {
    return entries.value.filter(entry => entry.status === 'active' && (!entry.persona || entry.persona === personaId))
  }

  /**
   * The index for a card: its own memories, then general ones, each as an id and its description.
   * A run reads it when it starts, from the entries that the window read last.
   */
  function indexFor(personaId: string) {
    const line = (entry: MemoryEntry) => `- ${entry.id}: ${entry.description}`
    const active = activeFor(personaId)
    const own = active.filter(entry => entry.persona === personaId).map(line)
    const general = active.filter(entry => !entry.persona).map(line)
    return [
      ...(own.length ? [`Your own:\n${own.join('\n')}`] : []),
      ...(general.length ? [`General:\n${general.join('\n')}`] : []),
    ].join('\n')
  }

  /** Reads an entry that the persona can see by its id: one of its own, or a general one. */
  function read(id: string, personaId: string) {
    return activeFor(personaId).find(entry => entry.id === id)
  }

  /**
   * The entries that a message recalls, best first. An empty result means the message names no remembered fact, so the
   * run receives no recalled block and its cacheable prefix stays as it was.
   */
  function recall(personaId: string, message: string) {
    if (!enabled.value || !recallEnabled.value)
      return []
    return recallMemories(activeFor(personaId), postings.value, message, {
      limit: recallTopN.value,
      budgetChars: recallBudgetChars.value,
      now: Date.now(),
    })
  }

  /**
   * Saves a fact on the card. An id of the card's own entry replaces that entry. Any other id, for example of a general
   * entry that only the owner changes, adds a new entry. Resolves to the stored entry, or undefined for an empty body.
   */
  async function write(input: MemoryWrite, personaId: string) {
    const body = input.body.trim()
    if (!body)
      return undefined
    const entry = await memoryRepo.write({ id: input.id, description: input.description.trim(), body }, personaId, Date.now())
    await publish([entry.id])
    return entry
  }

  /**
   * Stores one extracted candidate on the card. `status` is pending while the owner has not accepted the candidate,
   * and active when automatic extraction writes without confirmation.
   */
  async function storeCandidate(candidate: MemoryCandidate, personaId: string, status: MemoryStatus) {
    const now = Date.now()
    const entry: MemoryEntry = {
      id: uuidv7(),
      description: candidate.description.trim(),
      body: candidate.body.trim(),
      persona: personaId,
      updatedAt: now,
      kind: candidate.kind,
      source: candidate.source,
      confidence: candidate.confidence,
      salience: 1,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      keywords: candidate.keywords,
      status,
    }
    await memoryRepo.put(entry)
    await publish([entry.id])
    return entry
  }

  /** Accepts a pending candidate, so it reaches the index and recall. Only the owner accepts, in Settings. */
  async function accept(entry: Pick<MemoryEntry, 'id'>) {
    const stored = entries.value.find(candidate => candidate.id === entry.id)
    if (!stored || stored.status !== 'pending')
      return
    // IndexedDB cannot clone a reactive proxy, and the stored entry holds one for its keyword list.
    await memoryRepo.put({ ...toRaw(stored), status: 'active', updatedAt: Date.now() })
    await publish([entry.id])
  }

  /**
   * Counts a read of each entry. It does not tell the other windows, because a read changes no fact: they pick the
   * counts up on their next change, and recall only uses them to rank entries against each other.
   * A failed count resolves anyway, so the read tool still returns the entries that the model asked for.
   */
  async function recordAccess(ids: string[]) {
    if (ids.length === 0)
      return
    try {
      await memoryRepo.recordAccess(ids, Date.now())
      await load()
    }
    catch (error) {
      console.warn('[memory] Failed to count the reads:', errorMessageFrom(error))
    }
  }

  /** Makes a card's memory general, so every card reads it. */
  async function makeGeneral(entry: Pick<MemoryEntry, 'id'>) {
    if (await memoryRepo.makeGeneral(entry.id, Date.now()))
      await publish([entry.id])
  }

  /** Removes one entry from Settings. */
  async function remove(entry: Pick<MemoryEntry, 'id'>) {
    await memoryRepo.remove([entry.id], Date.now())
    await publish([entry.id])
  }

  /** Forgets an entry of the card by its id. General memories belong to the owner, so a run cannot forget them. */
  async function forget(id: string, personaId: string) {
    if (!await memoryRepo.forget(id, personaId, Date.now()))
      return false
    await publish([id])
    return true
  }

  async function resetState() {
    enabled.reset()
    recallEnabled.reset()
    recallTopN.reset()
    recallBudgetChars.reset()
    await memoryRepo.clear()
    await memoryIndexRepo.clear()
    await memoryQueueRepo.clear()
    await publish([])
  }

  async function restoreState(state: { enabled: boolean, entries: MemoryEntryRecord[] }) {
    await ready()
    enabled.value = state.enabled
    await memoryRepo.replace(state.entries)
    await publish(state.entries.map(entry => entry.id))
  }

  function reload() {
    void load()
      .then(loadIndex)
      .catch(error => console.warn('[memory] Failed to read the entries:', errorMessageFrom(error)))
  }
  watch(changed, reload)
  reload()

  return {
    enabled,
    recallEnabled,
    recallTopN,
    recallBudgetChars,
    entries: computed(() => entries.value),
    pendingCount: computed(() => entries.value.filter(entry => entry.status === 'pending').length),
    ready,
    indexFor,
    read,
    recall,
    write,
    storeCandidate,
    accept,
    recordAccess,
    makeGeneral,
    forget,
    remove,
    resetState,
    restoreState,
  }
})
