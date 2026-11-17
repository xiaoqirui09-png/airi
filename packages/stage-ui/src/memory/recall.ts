import type { KeywordPosting, MemoryEntry, MemoryKind } from '../types/memory'

import { differenceInMilliseconds } from 'date-fns'
import { millisecondsInDay } from 'date-fns/constants'

import { tokenizeMemoryText } from './inverted-index'

/** One entry that the recall selected, with the score that ranked it. */
export interface MemoryHit {
  entry: MemoryEntry
  score: number
}

/**
 * The weight of each recall signal. They sum to 1, so a score stays between 0 and 1.
 * Keywords dominate: an entry that the message names matters more than one that is merely recent.
 */
const SIGNAL_WEIGHTS = {
  keyword: 0.45,
  recency: 0.25,
  salience: 0.15,
  access: 0.10,
  kind: 0.05,
} as const

/** A taste or a plan shapes every reply, a fact shapes some, and a dated event shapes few. */
const KIND_BOOST: Record<MemoryKind, number> = {
  preference: 1,
  plan: 1,
  fact: 0.6,
  event: 0.4,
}

/** Recency falls to half in about 21 days, so a fact of last month still reaches a reply that names it. */
const RECENCY_SCALE_DAYS = 30

/** A query key that names no entry. The lookup only reads it, so one shared list serves every miss. */
const NO_POSTINGS: KeywordPosting[] = []

export interface RecallOptions {
  /** How many entries the recall selects at most. */
  limit: number
  /** The character budget of the selected lines. Selection stops at the first line that would pass it. */
  budgetChars: number
  now: number
}

/**
 * Scores one entry against the keys of a message.
 *
 * `matched` holds the posting weight of each query key that names the entry. `maxAccessCount` is the largest count in
 * the candidate set, so the access signal compares entries against each other instead of against an absolute scale.
 */
export function scoreMemoryEntry(entry: MemoryEntry, matched: Map<string, number>, keyCount: number, maxAccessCount: number, now: number) {
  const weightSum = [...matched.values()].reduce((total, weight) => total + weight, 0)
  const keywordScore = keyCount > 0 ? Math.min(1, weightSum / keyCount) : 0
  const ageDays = differenceInMilliseconds(now, entry.updatedAt) / millisecondsInDay
  const recencyScore = Math.exp(-Math.max(0, ageDays) / RECENCY_SCALE_DAYS)
  // A candidate set that nothing ever read has no access signal, and every entry scores 0 on it.
  const accessScore = maxAccessCount > 0 ? Math.log(1 + entry.accessCount) / Math.log(1 + maxAccessCount) : 0
  return SIGNAL_WEIGHTS.keyword * keywordScore
    + SIGNAL_WEIGHTS.recency * recencyScore
    + SIGNAL_WEIGHTS.salience * entry.salience
    + SIGNAL_WEIGHTS.access * accessScore
    + SIGNAL_WEIGHTS.kind * KIND_BOOST[entry.kind]
}

/**
 * Selects the entries that a message recalls, best first, within the count and character budgets.
 *
 * The inverted index generates the candidates, so an entry that shares no key with the message is never scored and
 * never injected. `entries` are the ones that the persona can see. Only active entries reach a reply: a pending
 * candidate waits for the owner, and a merged or archived one no longer states the truth.
 */
/**
 * Fuses keyword hits and semantic hits into one ranked, budget-capped list. An entry found by both signals gets a
 * blended score; an entry found by one signal keeps that signal's score. This lets a message with no keyword match
 * still surface a semantically close entry, while an entry that the message names by keyword is never pushed out just
 * because its embedding is weaker.
 *
 * `semanticWeight` is the share of the blended score that comes from cosine similarity (0–1). Negative cosine means
 * the entry is unrelated, so it is clamped to zero: a semantic signal can lift an entry but never hard-insert an
 * opposite one.
 */
export function fuseRecallHits(keywordHits: MemoryHit[], semanticHits: MemoryHit[], semanticWeight: number, options: { limit: number, budgetChars: number }): MemoryHit[] {
  const weight = Math.min(1, Math.max(0, semanticWeight))
  const byId = new Map<string, { hit: MemoryHit, keyword?: number, semantic?: number }>()
  for (const hit of keywordHits) {
    byId.set(hit.entry.id, { hit, keyword: hit.score })
  }
  for (const hit of semanticHits) {
    const normalized = Math.min(1, Math.max(0, hit.score))
    const existing = byId.get(hit.entry.id)
    if (existing)
      existing.semantic = normalized
    else
      byId.set(hit.entry.id, { hit, semantic: normalized })
  }
  const ranked = [...byId.values()]
    .map(({ hit, keyword, semantic }) => {
      let score: number
      if (keyword !== undefined && semantic !== undefined)
        score = (1 - weight) * keyword + weight * semantic
      else
        score = keyword ?? semantic ?? 0
      return { entry: hit.entry, score }
    })
    .sort((left, right) => right.score - left.score)

  const selected: MemoryHit[] = []
  let usedChars = 0
  for (const hit of ranked) {
    if (selected.length >= options.limit)
      break
    const lineChars = hit.entry.id.length + hit.entry.description.length + 4
    if (usedChars + lineChars > options.budgetChars)
      break
    usedChars += lineChars
    selected.push(hit)
  }
  return selected
}

export function recallMemories(entries: MemoryEntry[], postings: Map<string, KeywordPosting[]>, message: string, options: RecallOptions): MemoryHit[] {
  const keys = tokenizeMemoryText(message)
  if (keys.length === 0)
    return []

  const matchedByEntry = new Map<string, Map<string, number>>()
  for (const key of keys) {
    for (const posting of postings.get(key) ?? NO_POSTINGS) {
      const matched = matchedByEntry.get(posting.id)
      if (matched)
        matched.set(key, Math.max(matched.get(key) ?? 0, posting.weight))
      else
        matchedByEntry.set(posting.id, new Map([[key, posting.weight]]))
    }
  }
  if (matchedByEntry.size === 0)
    return []

  const visible = new Map(entries.filter(entry => entry.status === 'active').map(entry => [entry.id, entry]))
  const candidates = [...matchedByEntry].flatMap(([id, matched]) => {
    const entry = visible.get(id)
    return entry ? [{ entry, matched }] : []
  })
  const maxAccessCount = candidates.reduce((largest, candidate) => Math.max(largest, candidate.entry.accessCount), 0)
  const ranked = candidates
    .map(({ entry, matched }) => ({ entry, score: scoreMemoryEntry(entry, matched, keys.length, maxAccessCount, options.now) }))
    .sort((left, right) => right.score - left.score)

  const selected: MemoryHit[] = []
  let usedChars = 0
  for (const hit of ranked) {
    if (selected.length >= options.limit)
      break
    const lineChars = hit.entry.id.length + hit.entry.description.length + 4
    if (usedChars + lineChars > options.budgetChars)
      break
    usedChars += lineChars
    selected.push(hit)
  }
  return selected
}
