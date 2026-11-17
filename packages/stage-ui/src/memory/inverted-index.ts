import type { KeywordPosting, MemoryEntry } from '../types/memory'

import { memoryIndexRepo } from '../database/repos/memory-index.repo'

/** A key that the extraction named weighs more than a key that only the text yields. */
const NAMED_KEY_WEIGHT = 1
const TEXT_KEY_WEIGHT = 0.5

/**
 * Words that carry no meaning of their own, so they never name an entry. Negations such as `no` and `not` stay out of
 * this set: a preference often turns on them, and dropping them would make `no sugar` recall the same as `sugar`.
 */
const STOPWORDS = new Set([
  '的',
  '了',
  '是',
  '我',
  '你',
  '他',
  '她',
  '它',
  '们',
  '和',
  '与',
  '在',
  '有',
  '就',
  '都',
  '也',
  '很',
  '吗',
  '呢',
  '吧',
  '啊',
  '个',
  '之',
  '于',
  '而',
  '及',
  '或',
  '把',
  '被',
  '让',
  '给',
  '对',
  '从',
  '到',
  '向',
  '这',
  '那',
  '为',
  '以',
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'as',
  'for',
  'from',
  'i',
  'me',
  'my',
  'you',
  'your',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'am',
  'do',
  'does',
  'did',
  'so',
  'if',
  'then',
  'than',
])

/** Ideograph runs become bigrams, and latin runs stay whole words. Everything else separates them. */
const TEXT_RUNS = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+|[a-z0-9]+/g

/**
 * Splits text into the normalized keys of the inverted index.
 *
 * Ideograph runs have no spaces, so each pair of neighbouring characters becomes a key. A run of one character stays
 * that character. Latin and digit runs stay whole words of at least two characters. Keys are lowercase, deduplicated,
 * and without stopwords. The same function reads a stored entry and a recall query, so their keys always agree.
 *
 * @example
 * tokenizeMemoryText('喜欢喝冰美式 Iced Americano')
 * // => ['喜欢', '欢喝', '喝冰', '冰美', '美式', 'iced', 'americano']
 */
export function tokenizeMemoryText(text: string): string[] {
  const runs = text.toLowerCase().match(TEXT_RUNS) ?? []
  const keys = runs.flatMap((run) => {
    if (/^[a-z0-9]/.test(run))
      return run.length >= 2 ? [run] : []
    if (run.length === 1)
      return [run]
    return Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2))
  })
  return [...new Set(keys.filter(key => !STOPWORDS.has(key)))]
}

/** The keys of one entry with their weights. A key that the extraction named wins over the same key from the text. */
function weightsOf(entry: MemoryEntry) {
  const weights = new Map<string, number>()
  for (const key of tokenizeMemoryText(`${entry.description}\n${entry.body}`))
    weights.set(key, TEXT_KEY_WEIGHT)
  for (const key of entry.keywords.flatMap(tokenizeMemoryText))
    weights.set(key, NAMED_KEY_WEIGHT)
  return weights
}

/**
 * Rebuilds the whole inverted index from the entries that the caller holds, and resolves to the postings that it saved.
 *
 * The store already keeps every entry in memory, so a rebuild costs one write pass and cannot drift from the entries.
 * It indexes every status, because recall and conflict detection select the statuses that they need.
 */
export async function rebuildMemoryIndex(entries: MemoryEntry[]) {
  const postings = new Map<string, KeywordPosting[]>()
  for (const entry of entries) {
    for (const [key, weight] of weightsOf(entry)) {
      const list = postings.get(key)
      if (list)
        list.push({ id: entry.id, weight })
      else
        postings.set(key, [{ id: entry.id, weight }])
    }
  }
  await memoryIndexRepo.replace(postings)
  return postings
}
