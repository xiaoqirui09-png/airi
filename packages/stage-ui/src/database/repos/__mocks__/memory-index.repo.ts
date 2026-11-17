import type { KeywordPosting } from '../../../types/memory'

/** In-memory long-term memory index for Node tests, which have no IndexedDB. */
const keywords = new Map<string, KeywordPosting[]>()

export const memoryIndexRepo = {
  async list() {
    return new Map(keywords)
  },
  async replace(postings: Map<string, KeywordPosting[]>) {
    keywords.clear()
    for (const [keyword, list] of postings)
      keywords.set(keyword, list)
  },
  async clear() {
    keywords.clear()
  },
}
