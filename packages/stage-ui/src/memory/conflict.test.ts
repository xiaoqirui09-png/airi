import type { MemoryCandidate } from '@proj-airi/agents/memory-extract'

import type { MemoryEntry } from '../types/memory'

import { describe, expect, it } from 'vitest'

import { findConflicts, keywordOverlap, mergeEntries, resolutionFor } from './conflict'

function entry(id: string, keywords: string[], overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id,
    description: `entry ${id}`,
    body: `body ${id}`,
    persona: 'airi',
    updatedAt: 100,
    kind: 'fact',
    source: 'user',
    confidence: 0.8,
    salience: 0.9,
    createdAt: 100,
    lastAccessedAt: 100,
    accessCount: 2,
    keywords,
    status: 'active',
    ...overrides,
  }
}

const candidate: Pick<MemoryCandidate, 'keywords'> = { keywords: ['doudou', 'cat'] }

describe('keywordOverlap', () => {
  it('measures how much of the first set the second contains', () => {
    expect(keywordOverlap(['doudou', 'cat'], ['doudou', 'cat', 'pet'])).toBe(1)
    expect(keywordOverlap(['doudou', 'cat'], ['doudou'])).toBe(0.5)
    expect(keywordOverlap(['doudou', 'cat'], ['weather'])).toBe(0)
  })

  // The candidate is the smaller set, so a short statement inside a longer entry still fully overlaps.
  it('returns zero for a candidate with no keys', () => {
    expect(keywordOverlap([], ['doudou'])).toBe(0)
  })
})

describe('findConflicts', () => {
  it('returns only active entries that pass the overlap threshold, best first', () => {
    const matches = findConflicts(candidate, [
      entry('low', ['doudou']),
      entry('full', ['doudou', 'cat', 'pet']),
      entry('none', ['weather']),
      entry('pending', ['doudou', 'cat'], { status: 'pending' }),
      entry('archived', ['doudou', 'cat'], { status: 'archived' }),
    ])

    expect(matches.map(match => match.entry.id)).toEqual(['full', 'low'])
    expect(matches[0]?.overlap).toBe(1)
  })

  it('finds nothing when the candidate has no words', () => {
    expect(findConflicts({ keywords: [] }, [entry('a', ['doudou'])])).toEqual([])
  })

  // A candidate with many generic keys must not flood the model with comparisons.
  it('compares at most five entries', () => {
    const many = Array.from({ length: 8 }, (_, index) => entry(`e${index}`, ['doudou', 'cat']))

    expect(findConflicts(candidate, many)).toHaveLength(5)
  })
})

describe('mergeEntries', () => {
  const newer = entry('new', ['cat'], {
    confidence: 0.7,
    salience: 0.5,
    accessCount: 3,
    updatedAt: 200,
  })
  const older = entry('old', ['doudou', 'pet'], {
    confidence: 0.9,
    salience: 0.8,
    accessCount: 4,
  })

  it('keeps the stronger fields and unions the keywords', () => {
    const merged = mergeEntries(newer, older, 300)

    expect(merged).toMatchObject({
      id: 'new',
      confidence: 0.9,
      salience: 0.8,
      accessCount: 7,
      updatedAt: 300,
    })
    expect(merged.keywords).toEqual(['cat', 'doudou', 'pet'])
  })

  // A merge must never physically remove the old entry: the survivor names it so the audit keeps the lineage.
  it('records the older entry in supersedes', () => {
    expect(mergeEntries(newer, older, 300).supersedes).toEqual(['old'])
  })

  it('keeps the newer entry content instead of the older text', () => {
    expect(mergeEntries(newer, older, 300)).toMatchObject({ description: 'entry new', body: 'body new' })
  })
})

describe('resolutionFor', () => {
  it('maps each relation to its store action', () => {
    expect(resolutionFor('independent')).toBe('store')
    expect(resolutionFor('duplicate')).toBe('merge')
    expect(resolutionFor('contradiction')).toBe('replace')
  })
})
