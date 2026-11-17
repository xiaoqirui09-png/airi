import type { KeywordPosting } from '../../types/memory'

import { prefixStorage } from 'unstorage'

import { listRawItems, storage } from '../storage'

const records = prefixStorage(storage, 'memory-index')

/**
 * Runs one index write. Every window takes this lock, so a rebuild reads the postings that the write before it saved.
 * It is a different lock from the entry lock: a rebuild reads the entries that the caller already holds.
 */
function write<T>(run: () => Promise<T>) {
  return navigator.locks.request('airi:memory-index', run)
}

/** The inverted index of long-term memory, one record for each normalized keyword. */
export const memoryIndexRepo = {
  /** Every keyword with its postings. Keywords without a posting are not stored. */
  async list() {
    const items = await listRawItems<KeywordPosting[]>(records, '')
    return new Map(items.map(([keyword, postings]) => [keyword, postings]))
  },
  /** Replaces the whole index. A rebuild derives every posting from the entries, so no stale posting survives it. */
  async replace(postings: Map<string, KeywordPosting[]>) {
    await write(async () => {
      await records.clear()
      await Promise.all([...postings].map(([keyword, list]) => records.setItemRaw<KeywordPosting[]>(keyword, list)))
    })
  },
  /** Deletes every record. Only deleting all data uses it. */
  async clear() {
    await write(() => records.clear())
  },
}
