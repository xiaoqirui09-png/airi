import type { MemoryAuditLog } from '../../../types/memory'

/** The audit trail in memory for Node tests, which have no IndexedDB. */
const logs = new Map<string, MemoryAuditLog>()

/** In-memory memory audit repository. Mirrors the browser repo, including its bounded trail. */
export const memoryAuditRepo = {
  async list() {
    return [...logs.values()].sort((left, right) => right.at - left.at)
  },
  async append(log: MemoryAuditLog) {
    logs.set(log.id, log)
  },
  async clear() {
    logs.clear()
  },
}
