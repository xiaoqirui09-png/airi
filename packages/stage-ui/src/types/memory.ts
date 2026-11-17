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

/** What an automatic memory action did, as shown in the audit list and used to undo it. */
export type MemoryAuditAction = 'create' | 'merge' | 'archive' | 'drop' | 'restore'

/**
 * One automatic change to the store. The store writes a log for each candidate it saves, merges, archives, or drops,
 * so the owner can see why a fact appeared or vanished and undo the change. `before` holds the entry before the action
 * and `after` the entry after it, but only the fields that the action touched.
 */
export interface MemoryAuditLog {
  id: string
  at: number
  action: MemoryAuditAction
  /** The entry that the action wrote or changed. An undo addresses this entry. */
  entryId: string
  /** A short, human-readable reason, such as the relation that a conflict check decided. */
  reason: string
  before?: Partial<MemoryEntry>
  after?: Partial<MemoryEntry>
}

/**
 * The embedding of one memory entry, kept apart from the fact so a model change can invalidate every vector at once.
 * The signature names the model, revision, and quantization that produced the vector; a mismatch means the vector is
 * stale and must not be scored against a new query. `contentHash` names the text, so an edited entry is re-embedded.
 */
export interface MemoryVector {
  /** The entry whose meaning this vector holds. */
  id: string
  /** The card that owns the entry. Absent for a general memory. */
  persona?: string
  /** `${modelId}@${revision}#${dtype}` of the model that produced the vector. */
  modelSignature: string
  /** The vector length, fixed by the model (512 for bge-small-zh-v1.5). */
  dim: number
  /** The unit-length embedding. Stored as a plain array so IndexedDB can clone it. */
  vector: number[]
  /** Hash of the description + body that produced the vector. */
  contentHash: string
  updatedAt: number
}
