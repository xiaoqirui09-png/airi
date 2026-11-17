import type { MemoryQueueTask } from '../../../types/memory'

import { claimTasks, resetInterrupted } from '../../../memory/queue'

/** In-memory memory queue for Node tests, which have no IndexedDB. */
const tasks = new Map<string, MemoryQueueTask>()

export const memoryQueueRepo = {
  async list() {
    return [...tasks.values()].sort((left, right) => left.at - right.at)
  },
  async enqueue(task: MemoryQueueTask) {
    tasks.set(task.id, task)
    return []
  },
  async save(saved: MemoryQueueTask[]) {
    for (const task of saved)
      tasks.set(task.id, task)
  },
  async claim(limit: number, now: number) {
    const claimed = claimTasks(await this.list(), limit, now)
    for (const task of claimed)
      tasks.set(task.id, task)
    return claimed
  },
  async resetInterrupted(now: number) {
    const reset = resetInterrupted(await this.list(), now)
    for (const task of reset)
      tasks.set(task.id, task)
    return reset
  },
  async clear() {
    tasks.clear()
  },
}
