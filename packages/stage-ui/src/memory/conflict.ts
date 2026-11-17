import type { MemoryRelation } from '@proj-airi/agents/memory-conflict'
import type { MemoryCandidate } from '@proj-airi/agents/memory-extract'

import type { MemoryEntry } from '../types/memory'

import { tokenizeMemoryText } from './inverted-index'

/** Two entries must share at least this share of their keys before a model compares them. */
const OVERLAP_THRESHOLD = 0.5
/** At most this many stored entries are compared with one candidate, to bound the model calls. */
const MAX_COMPARISONS = 5

/** A stored entry paired with how much of the candidate it shares. */
export interface OverlapCandidate {
  entry: MemoryEntry
  overlap: number
}

/**
 * The share of `a`'s keys that also name `b`, from 0 to 1.
 *
 * The candidate is the smaller set, so a short statement that a longer entry contains still scores 1. A statement with
 * no keys overlaps nothing, which keeps a candidate without words out of the conflict check.
 */
export function keywordOverlap(a: string[], b: string[]): number {
  if (a.length === 0)
    return 0
  const other = new Set(b)
  const shared = a.filter(key => other.has(key)).length
  return shared / a.length
}

/**
 * The stored entries that share enough keywords with a candidate to be worth a conflict check, best overlap first.
 * Only active entries count: a pending candidate is not yet a stated fact, and a merged or archived one is no longer
 * the current truth.
 *
 * @example
 * findConflicts({ keywords: ['Doudou', 'cat'] }, [doudouEntry, weatherEntry])
 * // => [{ entry: doudouEntry, overlap: 1 }]
 */
export function findConflicts(candidate: Pick<MemoryCandidate, 'keywords'>, entries: MemoryEntry[]): OverlapCandidate[] {
  const keys = candidate.keywords.flatMap(tokenizeMemoryText)
  if (keys.length === 0)
    return []
  return entries
    .filter(entry => entry.status === 'active')
    .map(entry => ({
      entry,
      overlap: keywordOverlap(keys, entry.keywords.flatMap(tokenizeMemoryText)),
    }))
    .filter(pair => pair.overlap >= OVERLAP_THRESHOLD)
    .sort((left, right) => right.overlap - left.overlap)
    .slice(0, MAX_COMPARISONS)
}

/**
 * Folds an older entry into a newer one after the model calls them a duplicate.
 *
 * The newer entry keeps its own identity and gains the older one's access count and any keywords it lacked. The older
 * entry is not removed: its caller marks it `merged` and points `mergedInto` at the survivor, so the audit keeps the
 * lineage. `supersedes` records that the survivor replaced the older entry.
 */
export function mergeEntries(newer: MemoryEntry, older: MemoryEntry, now: number): MemoryEntry {
  return {
    ...newer,
    confidence: Math.max(newer.confidence, older.confidence),
    salience: Math.max(newer.salience, older.salience),
    accessCount: newer.accessCount + older.accessCount,
    keywords: [...new Set([...newer.keywords, ...older.keywords])],
    supersedes: [...new Set([...(newer.supersedes ?? []), older.id])],
    updatedAt: now,
  }
}

/** What a relation check decided to do with a candidate and the entry it matched. */
export type ConflictResolution = 'store' | 'merge' | 'replace' | 'skip'

/**
 * Turns a model relation into an action on the store.
 *
 * - `independent` stores the candidate as a new fact.
 * - `duplicate` folds the candidate into the entry that already states it; nothing new is proposed.
 * - `contradiction` replaces the matched entry: the new statement takes its place and the old one is archived.
 * - `skip` is never returned by the model, and exists so an unresolved check stores nothing by default.
 *
 * Whether the new entry is active or pending stays the store's decision, from the owner's confirm/auto mode. The mode
 * also decides when a `replace` archives the old entry: at once in auto mode, or when the owner accepts the pending
 * replacement in confirm mode.
 */
export function resolutionFor(relation: MemoryRelation): ConflictResolution {
  if (relation === 'duplicate')
    return 'merge'
  if (relation === 'contradiction')
    return 'replace'
  if (relation === 'independent')
    return 'store'
  return 'skip'
}
