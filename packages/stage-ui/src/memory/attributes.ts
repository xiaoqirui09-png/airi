import type { MemoryAttributes, MemoryEntry, MemoryEntryRecord } from '../types/memory'

/**
 * The attributes of a record that predates them. Such a record was written by the owner or by a model tool call, so it
 * is an active fact of full confidence and importance. Its only timestamp is `updatedAt`, which stands in for the times
 * that the record never stored.
 */
function legacyAttributes(record: MemoryEntryRecord): MemoryAttributes {
  return {
    kind: 'fact',
    source: 'user',
    confidence: 1,
    salience: 1,
    createdAt: record.updatedAt,
    lastAccessedAt: record.updatedAt,
    accessCount: 0,
    keywords: [],
    status: 'active',
  }
}

/**
 * Fills the attributes that a stored record lacks, so every consumer reads a complete entry.
 *
 * Records written before the attributes existed carry only the base fields. The fill happens on read, and the next
 * write of the entry persists it. An empty `keywords` list means the inverted index has not derived the keys yet.
 *
 * @example
 * normalizeMemoryEntry({ id: '0190', description: 'Plays Minecraft.', body: 'Minecraft.', updatedAt: 10 })
 * // => { id: '0190', description: 'Plays Minecraft.', body: 'Minecraft.', updatedAt: 10,
 * //      kind: 'fact', source: 'user', confidence: 1, salience: 1, createdAt: 10, lastAccessedAt: 10,
 * //      accessCount: 0, keywords: [], status: 'active' }
 */
export function normalizeMemoryEntry(record: MemoryEntryRecord): MemoryEntry {
  const defaults = legacyAttributes(record)
  return {
    ...record,
    kind: record.kind ?? defaults.kind,
    source: record.source ?? defaults.source,
    confidence: record.confidence ?? defaults.confidence,
    salience: record.salience ?? defaults.salience,
    createdAt: record.createdAt ?? defaults.createdAt,
    lastAccessedAt: record.lastAccessedAt ?? defaults.lastAccessedAt,
    accessCount: record.accessCount ?? defaults.accessCount,
    keywords: record.keywords ?? defaults.keywords,
    status: record.status ?? defaults.status,
  }
}

/**
 * The attributes of an entry that a model tool call saves. The tool states a fact for its card, and the extraction
 * pipeline replaces these values when it proposes a candidate of its own.
 */
export function toolWriteAttributes(now: number): MemoryAttributes {
  return {
    kind: 'fact',
    source: 'tool',
    confidence: 1,
    salience: 1,
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    keywords: [],
    status: 'active',
  }
}
