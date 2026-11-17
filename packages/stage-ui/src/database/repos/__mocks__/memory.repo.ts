import type { MemoryEntry, MemoryEntryRecord, MemoryWrite } from '../../../types/memory'

import { v7 as uuidv7 } from 'uuid'

import { normalizeMemoryEntry, toolWriteAttributes } from '../../../memory/attributes'

/** In-memory long-term memory for Node tests, which have no IndexedDB. */
const entries = new Map<string, MemoryEntry>()

export const memoryRepo = {
  async list() {
    return [...entries.values()].sort((left, right) => left.updatedAt - right.updatedAt)
  },
  async add(added: MemoryEntryRecord[]) {
    for (const entry of added)
      entries.set(entry.id, normalizeMemoryEntry(entry))
  },
  async replace(replaced: MemoryEntryRecord[]) {
    entries.clear()
    for (const entry of replaced)
      entries.set(entry.id, normalizeMemoryEntry(entry))
  },
  async write(input: MemoryWrite, persona: string, updatedAt: number) {
    const own = input.id ? entries.get(input.id) : undefined
    const reused = own?.persona === persona ? own : undefined
    const entry: MemoryEntry = {
      ...reused ?? toolWriteAttributes(updatedAt),
      id: reused?.id ?? uuidv7(),
      description: input.description,
      body: input.body,
      persona,
      updatedAt,
    }
    entries.set(entry.id, entry)
    return entry
  },
  async put(entry: MemoryEntry) {
    entries.set(entry.id, entry)
  },
  async recordAccess(ids: string[], now: number) {
    for (const id of ids) {
      const stored = entries.get(id)
      if (stored)
        entries.set(id, { ...stored, accessCount: stored.accessCount + 1, lastAccessedAt: now })
    }
  },
  async makeGeneral(id: string, updatedAt: number) {
    const stored = entries.get(id)
    if (!stored?.persona)
      return false
    const { persona: _card, ...general } = stored
    entries.set(id, { ...general, updatedAt })
    return true
  },
  async forget(id: string, persona: string) {
    if (entries.get(id)?.persona !== persona)
      return false
    entries.delete(id)
    return true
  },
  async remove(ids: string[]) {
    for (const id of ids)
      entries.delete(id)
  },
  async clear() {
    entries.clear()
  },
}
