/** What a remembered statement is. Recall weights a lasting preference or plan above a passing event. */
export type MemoryKind = 'fact' | 'preference' | 'event' | 'plan'

/** Who stated the fact. The owner's own statement is stronger evidence than a model inference. */
export type MemorySource = 'user' | 'model' | 'tool'

/**
 * Where an entry stands in its life. Only `active` entries reach the index and recall.
 * - `pending`: an automatic extraction proposed it, and the owner has not accepted it yet.
 * - `merged`: a newer entry holds its content, named by `mergedInto`.
 * - `archived`: a newer entry contradicts it, and names it in that entry's `supersedes`.
 */
export type MemoryStatus = 'active' | 'pending' | 'merged' | 'archived'

/** The fields that every stored record carries, including the records written before the attributes existed. */
export interface MemoryEntryBase {
  /** A UUIDv7 that the store makes when it adds the entry. The index lists it, and tools address the entry by it. */
  id: string
  /** The index line: the fact itself when it fits in one line, or when the entry matters. */
  description: string
  body: string
  /** The character card that owns this memory. Without it, the owner made the memory general. */
  persona?: string
  updatedAt: number
}

/** How the entry behaves in recall and maintenance. Reads fill these for records that predate them. */
export interface MemoryAttributes {
  kind: MemoryKind
  source: MemorySource
  /** How sure the extraction was, from 0 to 1. A candidate below 0.5 is discarded instead of stored. */
  confidence: number
  /** Importance after time decay, from 0 to 1. Access raises it, and age lowers it. */
  salience: number
  createdAt: number
  /** When a run last read the entry. Recall scores recency from `updatedAt`, not from this. */
  lastAccessedAt: number
  /** How many times a run read the entry. Recall and decay both reward a repeatedly useful entry. */
  accessCount: number
  /** The keys that the extraction named for the entry, already normalized. The index also derives keys from the text. */
  keywords: string[]
  status: MemoryStatus
  /** The entry that holds this one's content after a merge. */
  mergedInto?: string
  /** The entries that this one contradicts and replaces. */
  supersedes?: string[]
}

/** One remembered fact. A character keeps it on its own card. A general memory reaches every card. */
export type MemoryEntry = MemoryEntryBase & MemoryAttributes

/**
 * An entry as a record holds it. The attributes are optional because records written before they existed carry only
 * the base fields. Every read normalizes a record into a {@link MemoryEntry}, so no consumer handles a missing attribute.
 */
export type MemoryEntryRecord = MemoryEntryBase & Partial<MemoryAttributes>

/** A fact to save. The id of one of the card's own entries changes that entry. Without it, the write adds an entry. */
export interface MemoryWrite {
  id?: string
  description: string
  body: string
}

/** One entry under a keyword of the inverted index. */
export interface KeywordPosting {
  id: string
  /**
   * How strongly the keyword names the entry. A key that the extraction named weighs 1, and a key that only the
   * description or body yields weighs 0.5, so recall prefers an entry that the extraction tagged with the query word.
   */
  weight: number
}

/** The text of one finished chat turn, as the queue stores it and the extraction reads it. */
export interface MemoryTurn {
  userText: string
  assistantText: string
  /** The names of the tools that the turn called. A turn that already wrote memory needs no extraction. */
  toolCalls: string[]
}

/**
 * One finished chat turn that waits for memory extraction. The turn hook only enqueues, so a reply never waits for the
 * extraction model.
 *
 * The state moves `pending` -> `running` -> `done`, or back to `pending` when a request fails and attempts remain.
 * A turn that already saved memory, or that the light filter skips, never enters the queue. A window that closes
 * during a request leaves its task `running`; a later start returns a task that stayed running past the request
 * timeout to `pending`, so an interrupted extraction runs again instead of being lost.
 */
export interface MemoryQueueTask extends MemoryTurn {
  id: string
  /** The card that owns the turn. The extraction writes only this card's memories. */
  persona: string
  at: number
  /** How many extraction requests the task already made. A task is dropped after the third failure. */
  attempts: number
  state: 'pending' | 'running' | 'done' | 'dropped'
  /**
   * When a window claimed the task. Every window runs the queue, so a start resets only a claim that outlived the
   * request timeout. A claim that another window is still working on stays running.
   */
  claimedAt?: number
  /** The turns of the same card just before this one, oldest first. They give a short statement its meaning. */
  recentTurns?: Pick<MemoryTurn, 'userText' | 'assistantText'>[]
}
