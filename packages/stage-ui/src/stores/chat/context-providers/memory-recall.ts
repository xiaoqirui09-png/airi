import type { MemoryHit } from '../../../memory/recall'
import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { READ_MEMORY_TOOL_NAME } from '../../../tools/memory'

export const MEMORY_RECALL_CONTEXT_ID = 'system:airi-memory-recall'

/**
 * Creates the context that carries the entries a message recalls.
 *
 * The runtime attaches context to the last user message, after the cacheable prefix, so a recalled block that changes
 * every turn leaves the identity and the memory index cached. The block lists index lines only: the run reads a body
 * with the read tool when it needs one, which keeps the block inside its character budget.
 */
export function createMemoryRecallContext(hits: MemoryHit[]): ContextMessage | undefined {
  if (hits.length === 0)
    return undefined

  return {
    id: nanoid(),
    contextId: MEMORY_RECALL_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    metadata: {
      source: { id: MEMORY_RECALL_CONTEXT_ID },
    },
    text: [
      `Long-term memory recalled for this message. Read an entry with ${READ_MEMORY_TOOL_NAME} when its body matters.`,
      ...hits.map(hit => `- ${hit.entry.id}: ${hit.entry.description}`),
    ].join('\n'),
    createdAt: Date.now(),
  }
}
