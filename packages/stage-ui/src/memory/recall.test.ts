import type { KeywordPosting, MemoryEntry } from '../types/memory'

import { subDays } from 'date-fns'
import { describe, expect, it } from 'vitest'

import { normalizeMemoryEntry } from './attributes'
import { fuseRecallHits, recallMemories, scoreMemoryEntry } from './recall'

const NOW = 1_800_000_000_000
const options = { limit: 8, budgetChars: 800, now: NOW }

function entry(id: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return normalizeMemoryEntry({ id, description: 'Cat', body: 'Keeps a cat named Doudou.', updatedAt: NOW, ...overrides })
}

function postings(...lists: [string, KeywordPosting[]][]) {
  return new Map(lists)
}

describe('recallMemories', () => {
  const cat = entry('cat', { keywords: ['doudou', 'cat'] })
  const named = postings(['doudou', [{ id: 'cat', weight: 1 }]], ['cat', [{ id: 'cat', weight: 1 }]])

  it('recalls the entry that the message names', () => {
    expect(recallMemories([cat], named, 'How is Doudou today?', options).map(hit => hit.entry.id)).toEqual(['cat'])
  })

  it('recalls through an ideograph bigram, which needs no space in the message', () => {
    const doudou = entry('cat', { description: '养了一只叫豆豆的猫', body: '豆豆是去年领养的。', keywords: ['豆豆'] })

    expect(recallMemories([doudou], postings(['豆豆', [{ id: 'cat', weight: 1 }]]), '豆豆今天怎么样', options).map(hit => hit.entry.id)).toEqual(['cat'])
  })

  // The index generates the candidates, so a message that shares no key with any entry injects nothing.
  it('injects nothing for a message that names no remembered fact', () => {
    expect(recallMemories([cat], named, 'What is the weather tomorrow?', options)).toEqual([])
  })

  it('injects nothing for a message that holds no key', () => {
    expect(recallMemories([cat], named, '', options)).toEqual([])
    expect(recallMemories([cat], named, 'the a of', options)).toEqual([])
    expect(recallMemories([cat], named, '🐱 !!!', options)).toEqual([])
  })

  it('injects nothing when no entry is stored', () => {
    expect(recallMemories([], named, 'Doudou', options)).toEqual([])
  })

  // A pending candidate waits for the owner, and a merged or archived one no longer states the truth.
  it('selects only active entries', () => {
    const entries = [
      entry('active'),
      entry('pending', { status: 'pending' }),
      entry('merged', { status: 'merged' }),
      entry('archived', { status: 'archived' }),
    ]
    const all = postings(['cat', entries.map(candidate => ({ id: candidate.id, weight: 1 }))])

    expect(recallMemories(entries, all, 'cat', options).map(hit => hit.entry.id)).toEqual(['active'])
  })

  it('selects at most the count budget', () => {
    const entries = [entry('a'), entry('b'), entry('c')]
    const all = postings(['cat', entries.map(candidate => ({ id: candidate.id, weight: 1 }))])

    expect(recallMemories(entries, all, 'cat', { ...options, limit: 2 })).toHaveLength(2)
  })

  it('selects within the character budget of the index lines', () => {
    const entries = [entry('a'), entry('b')]
    const all = postings(['cat', entries.map(candidate => ({ id: candidate.id, weight: 1 }))])

    // One line costs the id, the description, and the four characters of the `- ` separator and the `: ` after the id.
    expect(recallMemories(entries, all, 'cat', { ...options, budgetChars: 8 })).toHaveLength(1)
    expect(recallMemories(entries, all, 'cat', { ...options, budgetChars: 16 })).toHaveLength(2)
    expect(recallMemories(entries, all, 'cat', { ...options, budgetChars: 7 })).toEqual([])
  })

  // Selection stops at the first line that would pass the budget, so a later shorter line does not slip in.
  it('stops at the first line that would pass the budget', () => {
    const entries = [entry('a', { description: 'A very long description of the cat' }), entry('b')]
    const all = postings(['cat', [{ id: 'a', weight: 1 }, { id: 'b', weight: 0.5 }]])

    expect(recallMemories(entries, all, 'cat', { ...options, budgetChars: 8 })).toEqual([])
  })

  it('ranks a named key above a key that only the text yields', () => {
    const entries = [entry('text'), entry('named')]
    const both = postings(['cat', [{ id: 'text', weight: 0.5 }, { id: 'named', weight: 1 }]])

    expect(recallMemories(entries, both, 'cat', options).map(hit => hit.entry.id)).toEqual(['named', 'text'])
  })

  it('ranks a recent fact above an old one that the message names as well', () => {
    const entries = [entry('old', { updatedAt: subDays(NOW, 30).getTime() }), entry('recent')]
    const both = postings(['cat', entries.map(candidate => ({ id: candidate.id, weight: 1 }))])

    expect(recallMemories(entries, both, 'cat', options).map(hit => hit.entry.id)).toEqual(['recent', 'old'])
  })

  it('ranks a taste above a dated event that the message names as well', () => {
    const entries = [entry('event', { kind: 'event' }), entry('preference', { kind: 'preference' })]
    const both = postings(['cat', entries.map(candidate => ({ id: candidate.id, weight: 1 }))])

    expect(recallMemories(entries, both, 'cat', options).map(hit => hit.entry.id)).toEqual(['preference', 'event'])
  })

  it('ranks an entry that runs read above one that it never opened', () => {
    const entries = [entry('unread'), entry('read', { accessCount: 10 })]
    const both = postings(['cat', entries.map(candidate => ({ id: candidate.id, weight: 1 }))])

    expect(recallMemories(entries, both, 'cat', options).map(hit => hit.entry.id)).toEqual(['read', 'unread'])
  })

  it('takes the highest weight when one key posts the entry twice', () => {
    const duplicated = postings(['cat', [{ id: 'cat', weight: 0.5 }, { id: 'cat', weight: 1 }]])
    const [hit] = recallMemories([cat], duplicated, 'cat', options)

    expect(hit?.score).toBe(scoreMemoryEntry(cat, new Map([['cat', 1]]), 1, 0, NOW))
  })

  it('scores every hit between 0 and 1', () => {
    const entries = [entry('a', { kind: 'preference', accessCount: 100, salience: 1 }), entry('b', { kind: 'event', salience: 0, updatedAt: subDays(NOW, 400).getTime() })]
    const all = postings(['cat', entries.map(candidate => ({ id: candidate.id, weight: 1 }))])

    for (const hit of recallMemories(entries, all, 'cat', options)) {
      expect(hit.score).toBeGreaterThanOrEqual(0)
      expect(hit.score).toBeLessThanOrEqual(1)
    }
  })
})

describe('scoreMemoryEntry', () => {
  it('scores a named, recent, important, read taste at the top of the scale', () => {
    const best = entry('best', { kind: 'preference', accessCount: 10 })

    expect(scoreMemoryEntry(best, new Map([['cat', 1]]), 1, 10, NOW)).toBeCloseTo(1, 5)
  })

  // A candidate set that nothing ever read has no access signal, and every entry scores 0 on it.
  it('scores the access signal as zero when nothing was ever read', () => {
    const unread = entry('unread')

    expect(scoreMemoryEntry(unread, new Map([['cat', 1]]), 1, 0, NOW)).toBeCloseTo(0.45 + 0.25 + 0.15 + 0.05 * 0.6, 5)
  })

  it('scores no keyword signal when the message holds no key', () => {
    expect(scoreMemoryEntry(entry('a'), new Map(), 0, 0, NOW)).toBeCloseTo(0.25 + 0.15 + 0.05 * 0.6, 5)
  })

  // A clock behind the stored change time must not raise the recency signal above 1.
  it('clamps a future change time to the newest recency', () => {
    const future = entry('future', { updatedAt: subDays(NOW, -10).getTime() })

    expect(scoreMemoryEntry(future, new Map([['cat', 1]]), 1, 0, NOW)).toBeCloseTo(0.45 + 0.25 + 0.15 + 0.05 * 0.6, 5)
  })

  it('caps the keyword signal at 1 when the weights pass the key count', () => {
    expect(scoreMemoryEntry(entry('a'), new Map([['cat', 1], ['doudou', 1]]), 1, 0, NOW)).toBeCloseTo(0.45 + 0.25 + 0.15 + 0.05 * 0.6, 5)
  })
})

describe('fuseRecallHits', () => {
  const fuseOptions = { limit: 8, budgetChars: 800 }
  const cat = entry('cat', { description: 'Cat' })
  const coffee = entry('coffee', { description: 'Coffee' })

  it('keeps a keyword-only hit when there is no semantic signal', () => {
    const fused = fuseRecallHits([{ entry: cat, score: 0.8 }], [], 0.55, fuseOptions)
    expect(fused.map(hit => hit.entry.id)).toEqual(['cat'])
    expect(fused[0]?.score).toBeCloseTo(0.8, 5)
  })

  // The goal of stage 5: a message with no keyword match still surfaces a close entry.
  it('surfaces a semantic-only hit when keywords found nothing', () => {
    const fused = fuseRecallHits([], [{ entry: coffee, score: 0.9 }], 0.55, fuseOptions)
    expect(fused.map(hit => hit.entry.id)).toEqual(['coffee'])
    // cosine 0.9 is already on the 0–1 scale for a positive match.
    expect(fused[0]?.score).toBeCloseTo(0.9, 5)
  })

  it('blends both signals for an entry found twice, without duplicating it', () => {
    const fused = fuseRecallHits([{ entry: cat, score: 0.8 }], [{ entry: cat, score: 0.6 }], 0.5, fuseOptions)
    expect(fused).toHaveLength(1)
    // keyword 0.8 and semantic 0.6, equal weight -> 0.7
    expect(fused[0]?.score).toBeCloseTo(0.7, 5)
  })

  it('clamps a negative cosine to zero instead of surfacing an opposite entry', () => {
    const fused = fuseRecallHits([], [{ entry: coffee, score: -0.4 }], 0.55, fuseOptions)
    expect(fused[0]?.score).toBe(0)
  })

  it('respects the limit and character budget', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ entry: entry(`e${index}`), score: 1 - index / 10 }))
    const fused = fuseRecallHits(many, [], 0.55, { limit: 3, budgetChars: 800 })
    expect(fused).toHaveLength(3)
  })
})
