import type { MemoryEntry } from '../types/memory'

import { differenceInMilliseconds } from 'date-fns'
import { millisecondsInDay } from 'date-fns/constants'

/** Half-life of an entry's importance: after this many days an untouched entry holds half its salience. */
const DEFAULT_HALF_LIFE_DAYS = 90
/** Below this salience an entry is folded into a one-line summary instead of carrying its full body in the index. */
export const FOLD_SALIENCE = 0.15
/** An access gives a small, logarithmic lift so a repeatedly useful fact outlives an unused one. */
const ACCESS_LIFT = 0.1

/**
 * The salience of one entry at `now`, after time decay and the lift from its reads.
 *
 * Age halves salience every half-life. Reads then raise it a little, so a fact the owner keeps needing stays visible
 * longer than one they never mention again. The result stays between 0 and 1. An entry written in the future is treated
 * as new, so a clock change cannot push its salience above the ceiling.
 *
 * @example
 * decayedSalience({ ...entry, salience: 1, accessCount: 0 }, now + 90 * 86_400_000, now)
 * // => 0.5
 */
export function decayedSalience(entry: Pick<MemoryEntry, 'salience' | 'accessCount' | 'updatedAt'>, now: number, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  const ageDays = Math.max(0, differenceInMilliseconds(now, entry.updatedAt) / millisecondsInDay)
  const aged = entry.salience * Math.exp(-ageDays * Math.LN2 / halfLifeDays)
  const lifted = aged * (1 + ACCESS_LIFT * Math.log1p(Math.max(0, entry.accessCount)))
  return Math.min(1, Math.max(0, lifted))
}

/**
 * The entries with their salience brought up to date. Only entries that changed by a visible amount are returned, so a
 * daily run does not rewrite the whole store when nothing noticeable aged. The caller writes these back and republishes.
 */
export function decayEntries(entries: MemoryEntry[], now: number, halfLifeDays = DEFAULT_HALF_LIFE_DAYS, epsilon = 0.001): MemoryEntry[] {
  return entries.flatMap((entry) => {
    const salience = decayedSalience(entry, now, halfLifeDays)
    return Math.abs(salience - entry.salience) < epsilon
      ? []
      : [{ ...entry, salience }]
  })
}

/**
 * Whether an entry is faint enough to fold. A folded entry still exists and still recalls, but its index line can be
 * shortened. It is never deleted by decay: only the owner removes a fact.
 */
export function isFolded(entry: MemoryEntry): boolean {
  return entry.salience < FOLD_SALIENCE
}
