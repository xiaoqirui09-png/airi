import type { MemoryQueueTask } from '../../types/memory'

import { prefixStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { newQueueTask } from '../../memory/queue'
import { storage } from '../storage'
import { memoryQueueRepo } from './memory-queue.repo'

const records = prefixStorage(storage, 'memory-queue')
const turn = { userText: 'I keep a cat named Doudou.', assistantText: 'Doudou sounds lovely.', toolCalls: [] }

function task(id: string, at: number): MemoryQueueTask {
  return newQueueTask(id, 'airi', turn, at)
}

describe('memory queue repository', () => {
  beforeEach(async () => {
    await records.clear()
  })

  afterEach(async () => {
    await records.clear()
  })

  it('lists every task, oldest turn first', async () => {
    await memoryQueueRepo.save([task('t3', 30), task('t1', 10), task('t2', 20)])

    expect((await memoryQueueRepo.list()).map(stored => stored.id)).toEqual(['t1', 't2', 't3'])
  })

  it('appends a turn and keeps the tasks that wait', async () => {
    await memoryQueueRepo.enqueue(task('t1', 10))

    expect(await memoryQueueRepo.enqueue(task('t2', 20))).toEqual([])
    expect((await memoryQueueRepo.list()).map(stored => stored.id)).toEqual(['t1', 't2'])
  })

  // A long idle period must not grow the queue without limit, so the oldest turns leave it first.
  it('trims the queue to its limit and reports the turns that it removed', async () => {
    await memoryQueueRepo.save(Array.from({ length: 200 }, (_, index) => task(`t${index}`, index)))

    const overflow = await memoryQueueRepo.enqueue(task('new', 1000))

    expect(overflow.map(stored => stored.id)).toEqual(['t0'])
    const stored = await memoryQueueRepo.list()
    expect(stored).toHaveLength(200)
    expect(stored[0]?.id).toBe('t1')
    expect(stored.at(-1)?.id).toBe('new')
  })

  it('claims the oldest pending tasks and saves them as running', async () => {
    await memoryQueueRepo.save([task('t1', 10), task('t2', 20), task('t3', 30)])

    const claimed = await memoryQueueRepo.claim(2, 100)

    expect(claimed.map(stored => stored.id)).toEqual(['t1', 't2'])
    expect(claimed.every(stored => stored.state === 'running' && stored.claimedAt === 100)).toBe(true)
    expect((await memoryQueueRepo.list()).map(stored => stored.state)).toEqual(['running', 'running', 'pending'])
  })

  // Every window runs the queue, so two claims that overlap must not extract the same turn twice.
  it('gives two windows that claim at once disjoint tasks', async () => {
    await memoryQueueRepo.save([task('t1', 10), task('t2', 20), task('t3', 30), task('t4', 40)])

    const [first, second] = await Promise.all([memoryQueueRepo.claim(2, 100), memoryQueueRepo.claim(2, 100)])

    expect(first.map(stored => stored.id)).toEqual(['t1', 't2'])
    expect(second.map(stored => stored.id)).toEqual(['t3', 't4'])
  })

  it('claims nothing once every task settled', async () => {
    await memoryQueueRepo.save([{ ...task('t1', 10), state: 'done' }])

    expect(await memoryQueueRepo.claim(3, 100)).toEqual([])
  })

  it('returns the claim of a window that closed during its request to pending', async () => {
    await memoryQueueRepo.save([{ ...task('t1', 10), state: 'running', claimedAt: 100 }])

    expect(await memoryQueueRepo.resetInterrupted(100 + 60_000)).toEqual([])
    const reset = await memoryQueueRepo.resetInterrupted(100 + 60_001)

    expect(reset.map(stored => stored.id)).toEqual(['t1'])
    expect((await memoryQueueRepo.list())[0]).toMatchObject({ state: 'pending', claimedAt: undefined })
  })

  it('settles a task without touching the others', async () => {
    await memoryQueueRepo.save([task('t1', 10), task('t2', 20)])

    await memoryQueueRepo.save([{ ...task('t1', 10), state: 'done', attempts: 1 }])

    expect((await memoryQueueRepo.list()).map(stored => [stored.id, stored.state, stored.attempts])).toEqual([['t1', 'done', 1], ['t2', 'pending', 0]])
  })

  it('deletes every task when all data is deleted', async () => {
    await memoryQueueRepo.save([task('t1', 10)])

    await memoryQueueRepo.clear()

    expect(await memoryQueueRepo.list()).toEqual([])
  })
})
