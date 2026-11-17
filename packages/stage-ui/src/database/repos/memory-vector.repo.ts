import type { MemoryVector } from '../../types/memory'

import { prefixStorage } from 'unstorage'

import { listRawItems, storage } from '../storage'

const records = prefixStorage(storage, 'memory-vector')

/**
 * Runs one vector write. A separate lock from the entry and index locks: a vector write only touches vector records and
 * never reads entries, so it cannot interleave with another window's vector write.
 */
function write<T>(run: () => Promise<T>) {
  return navigator.locks.request('airi:memory-vector', run)
}

/**
 * The embeddings of long-term memory, keyed by entry id and kept apart from the facts. Storing them separately means a
 * model change can invalidate every vector without touching a single remembered fact.
 */
export const memoryVectorRepo = {
  /** The vector of one entry, or undefined when it has none. */
  async get(id: string) {
    return await records.getItemRaw<MemoryVector>(id) ?? undefined
  },

  /** Every stored vector, unfiltered. Used for diagnostics and bulk invalidation. */
  async list() {
    return (await listRawItems<MemoryVector>(records, '')).map(([, vector]) => vector)
  },

  /** The vectors visible to a card: its own and the general ones. Recalled entries are filtered the same way. */
  async listFor(personaId: string) {
    return (await this.list()).filter(vector => !vector.persona || vector.persona === personaId)
  },

  /** Saves one vector, overwriting any older signature or content hash for the same entry. */
  async put(vector: MemoryVector) {
    await write(() => records.setItemRaw<MemoryVector>(vector.id, vector))
  },

  /** Saves several vectors as one write, for a batch embedding pass. */
  async putMany(vectors: MemoryVector[]) {
    await write(() => Promise.all(vectors.map(vector => records.setItemRaw<MemoryVector>(vector.id, vector))))
  },

  /** Removes the vectors of these entries, e.g. when the facts are forgotten. */
  async remove(ids: string[]) {
    await write(() => Promise.all(ids.map(id => records.removeItem(id))))
  },

  /** How many vectors are stored, for the settings page status line. */
  async count() {
    return (await this.list()).length
  },

  /** Deletes every vector. Only deleting all data or changing models uses it. */
  async clear() {
    await write(() => records.clear())
  },
}
