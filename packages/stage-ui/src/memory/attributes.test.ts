import { describe, expect, it } from 'vitest'

import { normalizeMemoryEntry, toolWriteAttributes } from './attributes'

const legacy = { id: '0190', description: 'Plays Minecraft.', body: 'Minecraft.', updatedAt: 10 }

describe('normalizeMemoryEntry', () => {
  it('reads a record that predates the attributes as an active fact of the owner', () => {
    expect(normalizeMemoryEntry(legacy)).toEqual({
      ...legacy,
      kind: 'fact',
      source: 'user',
      confidence: 1,
      salience: 1,
      createdAt: 10,
      lastAccessedAt: 10,
      accessCount: 0,
      keywords: [],
      status: 'active',
    })
  })

  // The fill happens per field, so a record that already carries some attributes keeps them.
  it('keeps every attribute that the record already states', () => {
    const stored = {
      ...legacy,
      kind: 'preference' as const,
      source: 'model' as const,
      confidence: 0.4,
      salience: 0.2,
      createdAt: 1,
      lastAccessedAt: 2,
      accessCount: 7,
      keywords: ['minecraft'],
      status: 'pending' as const,
      mergedInto: 'other',
      supersedes: ['older'],
    }

    expect(normalizeMemoryEntry(stored)).toEqual(stored)
  })

  // Zero and empty are values, not missing fields, so `??` must not replace them.
  it('keeps a zero count, a zero confidence, and an empty keyword list', () => {
    const stored = { ...legacy, confidence: 0, salience: 0, accessCount: 0, createdAt: 0, keywords: [] }

    expect(normalizeMemoryEntry(stored)).toMatchObject({ confidence: 0, salience: 0, accessCount: 0, createdAt: 0, keywords: [] })
  })

  it('keeps the persona of a card and the absence of one for a general entry', () => {
    expect(normalizeMemoryEntry({ ...legacy, persona: 'airi' }).persona).toBe('airi')
    expect(normalizeMemoryEntry(legacy).persona).toBeUndefined()
  })
})

describe('toolWriteAttributes', () => {
  it('states a tool fact at full confidence, with the write time as every timestamp', () => {
    expect(toolWriteAttributes(42)).toEqual({
      kind: 'fact',
      source: 'tool',
      confidence: 1,
      salience: 1,
      createdAt: 42,
      lastAccessedAt: 42,
      accessCount: 0,
      keywords: [],
      status: 'active',
    })
  })
})
