/**
 * Pure decisions for proactive recall: whether a turn should surface a memory the owner did not name, which entry to
 * bring up, and how to word the hint. No store, clock, or storage lives here, so the gating and selection rules are
 * unit-testable with injected randomness.
 *
 * The chat already recall entries that the current message names (see recall.ts). Proactive recall is the other half:
 * once in a while, the character remembers something on her own and carries it into the reply.
 */
import type { MemoryEntry } from '../types/memory'
import type { MemoryHit } from './recall'

/** The kinds worth remembering unprompted. A dated event rarely shapes an unrelated turn, so it is left out. */
export const PROACTIVE_KINDS = new Set(['preference', 'plan', 'fact'])
/** Default chance that an eligible turn surfaces a memory. */
export const DEFAULT_PROBABILITY = 0.15
/** Default minimum number of finished turns between two proactive recalls. */
export const DEFAULT_MIN_INTERVAL = 8
/** Default salience floor: a faded fact is not worth interrupting the reply for. */
export const DEFAULT_SALIENCE_FLOOR = 0.4
/** Default character budget of the hint line. */
export const DEFAULT_MAX_CHARS = 120
/** Default cosine floor for the relevance-aware variant: below it, nothing is brought up. */
export const DEFAULT_RELEVANCE_THRESHOLD = 0.35

export interface RecallGate {
  enabled: boolean
  /** Finished turns since the last proactive recall for this card. */
  turnsSince: number
  minInterval: number
  probability: number
  hasCandidates: boolean
}

/**
 * Whether this turn brings up an unprompted memory. Every guard is cheap except the probability roll, and a turn with
 * no eligible entry never rolls at all. `roll` is injected so tests are deterministic; callers pass Math.random().
 */
export function shouldRecall(gate: RecallGate, roll = Math.random()): boolean {
  if (!gate.enabled || !gate.hasCandidates)
    return false
  if (gate.turnsSince < gate.minInterval)
    return false
  return roll < gate.probability
}

/** Whether an entry may be surfaced unprompted: visible kinds only, still important, and active. */
export function isProactiveCandidate(entry: MemoryEntry, salienceFloor = DEFAULT_SALIENCE_FLOOR): boolean {
  return entry.status === 'active'
    && PROACTIVE_KINDS.has(entry.kind)
    && entry.salience >= salienceFloor
}

/** The entries that proactive recall may choose from, in store order. */
export function proactiveCandidates(entries: MemoryEntry[], salienceFloor = DEFAULT_SALIENCE_FLOOR): MemoryEntry[] {
  return entries.filter(entry => isProactiveCandidate(entry, salienceFloor))
}

/**
 * Picks one entry with probability proportional to its salience, so an important memory surfaces more often without
 * always being the same one. A roll at the far end falls back to the last entry to stay inside the pool.
 */
export function pickBySalience(entries: MemoryEntry[], roll = Math.random()): MemoryEntry | undefined {
  if (entries.length === 0)
    return undefined
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.salience), 0)
  if (total <= 0)
    return entries[Math.min(entries.length - 1, Math.floor(roll * entries.length))]
  let target = roll * total
  for (const entry of entries) {
    target -= Math.max(0, entry.salience)
    if (target <= 0)
      return entry
  }
  return entries[entries.length - 1]
}

/**
 * The most relevant semantically-ranked hit, only when it clears the floor. Used by the 6b variant: a related memory
 * is brought up, but an unrelated conversation never gets one forced into it.
 */
export function pickRelevant(hits: MemoryHit[], threshold = DEFAULT_RELEVANCE_THRESHOLD): MemoryHit | undefined {
  const best = hits[0]
  if (!best || best.score < threshold)
    return undefined
  return best
}

/**
 * Truncates a description to the hint line on code-point boundaries, so a cut never splits an emoji or a surrogate
 * pair. The prefix is kept short: the hint is a nudge for the model, not the memory body itself.
 */
export function composeReminder(entry: MemoryEntry, maxChars = DEFAULT_MAX_CHARS, prefix = 'A memory just came to mind:'): string {
  // Reserve one character for the space after the prefix and one for the ellipsis, so the line never exceeds maxChars.
  const overhead = prefix.length + 1
  const budget = Math.max(1, maxChars - overhead)
  const chars = Array.from(entry.description.trim() || entry.body.trim())
  const body = chars.length > budget
    ? `${chars.slice(0, Math.max(0, budget - 1)).join('')}…`
    : chars.join('')
  return `${prefix} ${body}`
}
