import type { MemoryEntry } from '../types/memory'

import { describe, expect, it } from 'vitest'

import {
  composeReminder,
  DEFAULT_MAX_CHARS,
  isProactiveCandidate,
  pickBySalience,
  pickRelevant,
  proactiveCandidates,
  shouldRecall,
} from './proactive'

const NOW = 1_000_000_000

function entry(id: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id,
    description: 'A lasting fact',
    body: 'The fact in detail.',
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

describe('shouldRecall', () => {
  const gate = { enabled: true, turnsSince: 8, minInterval: 8, probability: 0.15, hasCandidates: true }

  it('does not recall while disabled', () => {
    expect(shouldRecall({ ...gate, enabled: false }, 0)).toBe(false)
  })

  it('does not recall before the interval passes', () => {
    expect(shouldRecall({ ...gate, turnsSince: 7 }, 0)).toBe(false)
  })

  it('does not recall with no eligible entry', () => {
    expect(shouldRecall({ ...gate, hasCandidates: false }, 0)).toBe(false)
  })

  it('recalls on a winning roll', () => {
    expect(shouldRecall(gate, 0.1)).toBe(true)
  })

  it('stays quiet on a losing roll', () => {
    expect(shouldRecall(gate, 0.9)).toBe(false)
  })

  it('recalls every eligible turn at probability 1', () => {
    expect(shouldRecall({ ...gate, probability: 1 }, 0.999)).toBe(true)
  })
})

describe('isProactiveCandidate / proactiveCandidates', () => {
  it('accepts active, important preference/plan/fact entries', () => {
    expect(isProactiveCandidate(entry('p', { kind: 'preference' }))).toBe(true)
    expect(isProactiveCandidate(entry('l', { kind: 'plan' }))).toBe(true)
    expect(isProactiveCandidate(entry('f', { kind: 'fact' }))).toBe(true)
  })

  it('rejects dated events, faded, pending and archived entries', () => {
    expect(isProactiveCandidate(entry('e', { kind: 'event' }))).toBe(false)
    expect(isProactiveCandidate(entry('low', { salience: 0.2 }))).toBe(false)
    expect(isProactiveCandidate(entry('pending', { status: 'pending' }))).toBe(false)
    expect(isProactiveCandidate(entry('archived', { status: 'archived' }))).toBe(false)
  })

  it('filters a mixed list down to the eligible ones', () => {
    const all = [
      entry('fact'),
      entry('event', { kind: 'event' }),
      entry('faded', { salience: 0.1 }),
      entry('plan', { kind: 'plan' }),
    ]
    expect(proactiveCandidates(all).map(item => item.id)).toEqual(['fact', 'plan'])
  })
})

describe('pickBySalience', () => {
  const high = entry('high', { salience: 9 })
  const low = entry('low', { salience: 1 })

  it('favours the more salient entry most of the time', () => {
    // low has salience 1, high has 9, so high owns [0.1, 1] of the roll range.
    expect(pickBySalience([low, high], 0.5)?.id).toBe('high')
    expect(pickBySalience([low, high], 0.95)?.id).toBe('high')
    expect(pickBySalience([low, high], 0.05)?.id).toBe('low')
  })

  it('returns undefined for an empty pool', () => {
    expect(pickBySalience([])).toBeUndefined()
  })

  it('stays inside the pool for all-zero salience', () => {
    const pool = [entry('a', { salience: 0 }), entry('b', { salience: 0 })]
    expect(pool.map(e => e.id)).toContain(pickBySalience(pool, 0.99)!.id)
  })
})

describe('pickRelevant', () => {
  it('picks the top hit when it clears the floor', () => {
    const top = { entry: entry('top'), score: 0.8 }
    expect(pickRelevant([top, { entry: entry('low'), score: 0.4 }], 0.35)?.entry.id).toBe('top')
  })

  it('picks nothing when even the top hit is below the floor', () => {
    expect(pickRelevant([{ entry: entry('x'), score: 0.2 }], 0.35)).toBeUndefined()
  })

  it('picks nothing from an empty list', () => {
    expect(pickRelevant([], 0.35)).toBeUndefined()
  })
})

describe('composeReminder', () => {
  it('includes the description', () => {
    expect(composeReminder(entry('e', { description: 'Likes iced coffee' }))).toContain('Likes iced coffee')
  })

  it('truncates long descriptions and marks the cut', () => {
    const long = entry('e', { description: 'x'.repeat(500) })
    const reminder = composeReminder(long, DEFAULT_MAX_CHARS)
    expect(reminder.length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS)
    expect(reminder.endsWith('…')).toBe(true)
  })

  it('falls back to the body when the description is empty', () => {
    expect(composeReminder(entry('e', { description: '', body: 'From the body' }))).toContain('From the body')
  })

  it('does not split a surrogate pair when truncating', () => {
    const long = entry('e', { description: '😀'.repeat(200) })
    const reminder = composeReminder(long, DEFAULT_MAX_CHARS)
    // No lone high/low surrogate should appear at the cut boundary.
    expect(reminder).not.toMatch(/[\uD800-\uDBFF]$/)
  })
})
