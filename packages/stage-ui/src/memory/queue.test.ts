import type { MemoryQueueTask, MemoryTurn } from '../types/memory'

import { describe, expect, it } from 'vitest'

import { claimTasks, newQueueTask, resetInterrupted, settleTask } from './queue'

const turn: MemoryTurn = { userText: 'I keep a cat named Doudou.', assistantText: 'Doudou sounds lovely.', toolCalls: [] }

function task(id: string, at: number, state: MemoryQueueTask['state'] = 'pending'): MemoryQueueTask {
  return { ...newQueueTask(id, 'airi', turn, at), state }
}

describe('newQueueTask', () => {
  it('starts a turn pending, with no attempt and no claim', () => {
    expect(newQueueTask('t1', 'airi', turn, 10)).toEqual({
      id: 't1',
      persona: 'airi',
      userText: turn.userText,
      assistantText: turn.assistantText,
      toolCalls: [],
      at: 10,
      attempts: 0,
      state: 'pending',
    })
  })

  // The queue outlives the turn, so a later change to the caller's list must not change the stored task.
  it('copies the tool names instead of holding the caller list', () => {
    const toolCalls = ['builtIn_readMemory']
    const stored = newQueueTask('t1', 'airi', { ...turn, toolCalls }, 10)
    toolCalls.push('builtIn_writeMemory')

    expect(stored.toolCalls).toEqual(['builtIn_readMemory'])
  })
})

describe('claimTasks', () => {
  it('takes the first pending tasks and marks them running for this window', () => {
    const claimed = claimTasks([task('t1', 10), task('t2', 20), task('t3', 30)], 2, 100)

    expect(claimed).toEqual([
      { ...task('t1', 10), state: 'running', claimedAt: 100 },
      { ...task('t2', 20), state: 'running', claimedAt: 100 },
    ])
  })

  // A settled task must never run again, and a running one belongs to another window.
  it('leaves running, done, and dropped tasks alone', () => {
    const tasks = [task('t1', 10, 'running'), task('t2', 20, 'done'), task('t3', 30, 'dropped')]

    expect(claimTasks(tasks, 5, 100)).toEqual([])
  })

  it('takes nothing when no task waits', () => {
    expect(claimTasks([], 3, 100)).toEqual([])
  })
})

describe('resetInterrupted', () => {
  // Every window runs this on start, so a live claim of another window must survive it.
  it('leaves a claim that is still inside the timeout alone', () => {
    const running = { ...task('t1', 10, 'running'), claimedAt: 100 }

    expect(resetInterrupted([running], 100 + 60_000)).toEqual([])
  })

  it('returns a claim past the timeout to pending, without its claim time', () => {
    const running = { ...task('t1', 10, 'running'), claimedAt: 100 }

    expect(resetInterrupted([running], 100 + 60_001)).toEqual([{ ...task('t1', 10), claimedAt: undefined }])
  })

  // A task saved before the claim time existed still carries its enqueue time.
  it('falls back to the enqueue time when a running task has no claim time', () => {
    expect(resetInterrupted([task('t1', 10, 'running')], 10 + 60_001)).toEqual([{ ...task('t1', 10), claimedAt: undefined }])
  })

  it('leaves pending, done, and dropped tasks alone', () => {
    expect(resetInterrupted([task('t1', 10), task('t2', 20, 'done'), task('t3', 30, 'dropped')], 1_000_000)).toEqual([])
  })
})

describe('settleTask', () => {
  it('ends a finished request, whether it saved entries or found none', () => {
    const running = { ...task('t1', 10, 'running'), claimedAt: 100 }

    expect(settleTask(running, false)).toEqual({ ...task('t1', 10), state: 'done', claimedAt: undefined })
  })

  it('counts a failed request and returns the task to pending', () => {
    const running = { ...task('t1', 10, 'running'), claimedAt: 100 }

    expect(settleTask(running, true)).toEqual({ ...task('t1', 10), attempts: 1, state: 'pending', claimedAt: undefined })
  })

  // One broken turn must not retry forever, so the third failure drops it.
  it('drops the task after the third failed request', () => {
    const second = settleTask({ ...task('t1', 10, 'running'), attempts: 1 }, true)
    expect(second).toMatchObject({ attempts: 2, state: 'pending' })

    expect(settleTask({ ...second, state: 'running' }, true)).toMatchObject({ attempts: 3, state: 'dropped' })
  })

  it('keeps the attempt count of a task that finishes after a failure', () => {
    expect(settleTask({ ...task('t1', 10, 'running'), attempts: 2 }, false)).toMatchObject({ attempts: 2, state: 'done' })
  })
})
