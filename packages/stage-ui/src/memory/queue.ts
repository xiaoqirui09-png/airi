import type { MemoryQueueTask, MemoryTurn } from '../types/memory'

/** After the third failed request a task is dropped, so one broken turn cannot retry forever. */
const MAX_ATTEMPTS = 3

/**
 * A claim older than this belongs to a window that closed during its request. The value stays well above the 20s
 * request timeout, so a slow request that is still running is never reset and extracted twice.
 */
const INTERRUPTED_AFTER_MS = 60_000

/** The task of one finished turn, waiting for its first extraction request. */
export function newQueueTask(id: string, persona: string, turn: MemoryTurn, now: number): MemoryQueueTask {
  return {
    id,
    persona,
    userText: turn.userText,
    assistantText: turn.assistantText,
    toolCalls: [...turn.toolCalls],
    at: now,
    attempts: 0,
    state: 'pending',
  }
}

/**
 * Takes the first pending tasks in the order given and marks them running, so another window does not extract the same
 * turn. The repository passes them oldest first. The caller saves the returned tasks before it starts a request.
 */
export function claimTasks(tasks: MemoryQueueTask[], limit: number, now: number) {
  return tasks
    .filter(task => task.state === 'pending')
    .slice(0, limit)
    .map(task => ({ ...task, state: 'running' as const, claimedAt: now }))
}

/**
 * Returns the tasks of interrupted windows to pending. A window that closes during a request leaves its task running,
 * and no other window finishes it. Only a claim past the timeout is reset, because every window runs this on start and
 * a live claim of another window must survive. Running the task again is safe: it writes its entries only once.
 */
export function resetInterrupted(tasks: MemoryQueueTask[], now: number) {
  return tasks
    .filter(task => task.state === 'running' && now - (task.claimedAt ?? task.at) > INTERRUPTED_AFTER_MS)
    .map(task => ({ ...task, state: 'pending' as const, claimedAt: undefined }))
}

/**
 * Settles one claimed task. A finished request ends the task, whether it saved entries or found none. A failed request
 * counts one attempt and returns the task to pending until the attempts run out.
 */
export function settleTask(task: MemoryQueueTask, failed: boolean): MemoryQueueTask {
  if (!failed)
    return { ...task, state: 'done', claimedAt: undefined }
  const attempts = task.attempts + 1
  return { ...task, attempts, state: attempts >= MAX_ATTEMPTS ? 'dropped' : 'pending', claimedAt: undefined }
}
