import type { MemoryEntry } from '../types/memory'

import { describe, expect, it } from 'vitest'

import { decayedSalience, decayEntries, FOLD_SALIENCE, isFolded } from './decay'

const DAY = 86_400_000
const NOW = 1_000_000_000

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'e1',
    description: 'a fact',
    body: 'the body',
    updatedAt: NOW,
    kind: 'fact',
    source: 'user',
    confidence: 1,
    salience: 1,
    createdAt: NOW,
    lastAccessedAt: NOW,
    accessCount: 0,
    keywords: [],
    status: 'active',
    ...overrides,
  }
}

describe('decayedSalience', () => {
  it('keeps a fresh entry at full salience', () => {
    expect(decayedSalience(entry(), NOW)).toBe(1)
  })

  it('halves salience after one half-life without accesses', () => {
    expect(decayedSalience(entry(), NOW + 90 * DAY)).toBeCloseTo(0.5, 5)
  })

  it('drops further after two half-lives', () => {
    expect(decayedSalience(entry(), NOW + 180 * DAY)).toBeCloseTo(0.25, 5)
  })

  it('uses a custom half-life when the caller passes one', () => {
    expect(decayedSalience(entry(), NOW + 30 * DAY, 30)).toBeCloseTo(0.5, 5)
  })

  it('lifts a frequently read entry above an unused one', () => {
    const unused = decayedSalience(entry({ accessCount: 0 }), NOW + 90 * DAY)
    const used = decayedSalience(entry({ accessCount: 5 }), NOW + 90 * DAY)

    expect(used).toBeGreaterThan(unused)
    expect(used).toBeLessThanOrEqual(1)
  })

  // A clock change must not make an entry more important than a fresh one.
  it('clamps an entry dated in the future to full salience', () => {
    expect(decayedSalience(entry(), NOW - 10 * DAY)).toBe(1)
  })
})

describe('decayEntries', () => {
  it('returns only the entries whose salience changed noticeably', () => {
    const old = entry({ id: 'old', salience: 1 })
    const fresh = entry({ id: 'fresh', salience: 1, updatedAt: NOW + 90 * DAY })

    const changed = decayEntries([old, fresh], NOW + 90 * DAY)

    expect(changed.map(item => item.id)).toEqual(['old'])
    expect(changed[0]?.salience).toBeCloseTo(0.5, 5)
  })

  it('returns nothing when every entry is still fresh', () => {
    expect(decayEntries([entry()], NOW)).toEqual([])
  })
})

describe('isFolded', () => {
  it('folds entries below the threshold', () => {
    expect(isFolded(entry({ salience: FOLD_SALIENCE - 0.01 }))).toBe(true)
    expect(isFolded(entry({ salience: FOLD_SALIENCE + 0.01 }))).toBe(false)
  })
})
