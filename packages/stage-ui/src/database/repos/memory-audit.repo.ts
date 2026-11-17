import type { MemoryAuditLog } from '../../types/memory'

import { prefixStorage } from 'unstorage'

import { listRawItems, storage } from '../storage'

/** The audit keeps a bounded trail, so a long-running owner cannot grow it without limit. */
const LOG_LIMIT = 500

const records = prefixStorage(storage, 'memory-audit')

/**
 * Runs one audit write. Every window takes this lock, so an append trims the trail that the write before it saved.
 * It is a different lock from the entry and index locks: an audit record holds a snapshot, not a live entry.
 */
function write<T>(run: () => Promise<T>) {
  return navigator.locks.request('airi:memory-audit', run)
}

/** The audit trail of automatic memory changes, one record for each action, keyed by the log id. */
export const memoryAuditRepo = {
  /** Every log, newest action first. */
  async list() {
    const logs = (await listRawItems<MemoryAuditLog>(records, '')).map(([, log]) => log)
    return logs.sort((left, right) => right.at - left.at)
  },
  /**
   * Appends one log and trims the trail to its limit, oldest action first. Append and trim are one operation against
   * other windows' writes, so no window can append into a trail that another window is trimming.
   */
  async append(log: MemoryAuditLog) {
    await write(async () => {
      const logs = (await listRawItems<MemoryAuditLog>(records, '')).map(([, stored]) => stored)
      logs.sort((left, right) => left.at - right.at)
      const overflow = logs.slice(0, Math.max(0, logs.length + 1 - LOG_LIMIT))
      await Promise.all(overflow.map(old => records.removeItem(old.id)))
      await records.setItemRaw<MemoryAuditLog>(log.id, log)
    })
  },
  /** Deletes every log. Only deleting all data uses it. */
  async clear() {
    await write(() => records.clear())
  },
}
