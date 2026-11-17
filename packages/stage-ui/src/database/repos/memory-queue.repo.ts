import type { MemoryQueueTask } from '../../types/memory'

import { prefixStorage } from 'unstorage'

import { claimTasks, resetInterrupted } from '../../memory/queue'
import { listRawItems, storage } from '../storage'

/** The queue holds a bounded number of turns, so a long idle period cannot grow it without limit. */
const TASK_LIMIT = 200

const records = prefixStorage(storage, 'memory-queue')

/** Runs one queue write. Every window takes this lock, so a claim sees the tasks that the write before it saved. */
function write<T>(run: () => Promise<T>) {
  return navigator.locks.request('airi:memory-queue', run)
}

/** Finished chat turns that wait for memory extraction, one record for each turn, keyed by the task id. */
export const memoryQueueRepo = {
  /** Every task, oldest turn first. */
  async list() {
    const tasks = (await listRawItems<MemoryQueueTask>(records, '')).map(([, task]) => task)
    return tasks.sort((left, right) => left.at - right.at)
  },
  /**
   * Appends one turn and trims the queue to its limit, oldest turn first. Resolves to the tasks that the trim removed,
   * so the caller can report them. The append and the trim are one operation against other windows' writes.
   */
  async enqueue(task: MemoryQueueTask) {
    return write(async () => {
      const tasks = (await listRawItems<MemoryQueueTask>(records, '')).map(([, stored]) => stored)
      tasks.push(task)
      tasks.sort((left, right) => left.at - right.at)
      const overflow = tasks.slice(0, Math.max(0, tasks.length - TASK_LIMIT))
      await Promise.all(overflow.map(dropped => records.removeItem(dropped.id)))
      await records.setItemRaw<MemoryQueueTask>(task.id, task)
      return overflow
    })
  },
  /** Saves each task as it is, with its id. */
  async save(tasks: MemoryQueueTask[]) {
    await write(() => Promise.all(tasks.map(task => records.setItemRaw<MemoryQueueTask>(task.id, task))))
  },
  /**
   * Claims the oldest pending tasks for this window and saves them as running, as one operation against other windows.
   * Every window runs the queue, so the claim and the save must not let a second window claim the same turn.
   */
  async claim(limit: number, now: number) {
    return write(async () => {
      const tasks = (await listRawItems<MemoryQueueTask>(records, '')).map(([, task]) => task)
      const claimed = claimTasks(tasks.sort((left, right) => left.at - right.at), limit, now)
      await Promise.all(claimed.map(task => records.setItemRaw<MemoryQueueTask>(task.id, task)))
      return claimed
    })
  },
  /** Returns the tasks of windows that closed during a request to pending. Resolves to the tasks that it reset. */
  async resetInterrupted(now: number) {
    return write(async () => {
      const tasks = (await listRawItems<MemoryQueueTask>(records, '')).map(([, task]) => task)
      const reset = resetInterrupted(tasks, now)
      await Promise.all(reset.map(task => records.setItemRaw<MemoryQueueTask>(task.id, task)))
      return reset
    })
  },
  /** Deletes every record. Only deleting all data uses it. */
  async clear() {
    await write(() => records.clear())
  },
}
