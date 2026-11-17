import type { MemoryHit } from '../memory/recall'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import { memoryVectorRepo } from '../database/repos/memory-vector.repo'
import { cosine } from '../memory/embedding'
import {
  composeReminder,
  DEFAULT_MAX_CHARS,
  DEFAULT_MIN_INTERVAL,
  DEFAULT_PROBABILITY,
  DEFAULT_RELEVANCE_THRESHOLD,
  DEFAULT_SALIENCE_FLOOR,
  pickBySalience,
  pickRelevant,
  proactiveCandidates,
  shouldRecall,
} from '../memory/proactive'
import { useMemoryStore } from './memory'
import { useMemoryEmbeddingStore } from './memory-embedding'

/** How many recent turns of a session feed the conversation vector used by the relevance-aware variant. */
const SESSION_WINDOW = 4

/** One window's persisted counters: finished turns since the last recall, per card. */
interface TurnCounters {
  [persona: string]: number
}

/** Recent conversation text per session, capped at SESSION_WINDOW entries. */
interface SessionTexts {
  [sessionId: string]: string[]
}

/**
 * Proactive recall: once in a while the character brings up a memory that the current message never named.
 *
 * The chat calls `recordTurn` when a reply finishes (so a model retry, which never finishes a turn, cannot advance the
 * counter) and `maybeRecall` before composing the next message. The latter returns a short hint line or undefined;
 * undefined means no extra context, leaving the prompt byte-for-byte unchanged. All state is persisted in localStorage
 * so the interval stays stable across restarts. The 6b variant scores a conversation vector against stored memory
 * vectors and stays silent when nothing is related; any failure falls back to the 6a salience-weighted pick.
 */
export const useMemoryProactiveStore = defineStore('memory-proactive', () => {
  const memory = useMemoryStore()
  const embedding = useMemoryEmbeddingStore()

  const enabled = useLocalStorageManualReset<boolean>('settings/memory/proactive-enabled', false)
  const probability = useLocalStorageManualReset<number>('settings/memory/proactive-probability', DEFAULT_PROBABILITY)
  const minInterval = useLocalStorageManualReset<number>('settings/memory/proactive-min-interval', DEFAULT_MIN_INTERVAL)
  const maxChars = useLocalStorageManualReset<number>('settings/memory/proactive-max-chars', DEFAULT_MAX_CHARS)
  const salienceFloor = useLocalStorageManualReset<number>('settings/memory/proactive-salience-floor', DEFAULT_SALIENCE_FLOOR)
  const relevanceThreshold = useLocalStorageManualReset<number>('settings/memory/proactive-relevance-threshold', DEFAULT_RELEVANCE_THRESHOLD)

  const counters = useLocalStorageManualReset<TurnCounters>('settings/memory/proactive-counters', {})
  const sessionTexts = useLocalStorageManualReset<SessionTexts>('settings/memory/proactive-session-texts', {})

  const lastRecallAt = computed(() => Object.values(counters.value).reduce((sum, value) => sum + value, 0))

  /**
   * Called once a reply finishes. Advances only the finished-card counter and appends the turn text to the session's
   * rolling window. Because a retry never completes a turn, it cannot move the counter or add a second session line.
   */
  function recordTurn(persona: string, sessionId: string, userText: string, assistantText: string): void {
    counters.value = { ...counters.value, [persona]: (counters.value[persona] ?? 0) + 1 }
    const text = `${userText}\n${assistantText}`.trim()
    if (!text)
      return
    const recent = sessionTexts.value[sessionId] ?? []
    sessionTexts.value = { ...sessionTexts.value, [sessionId]: [...recent, text].slice(-SESSION_WINDOW) }
  }

  /** Scores active memory vectors against the recent conversation. Empty when semantic recall is unusable. */
  async function semanticallyRelated(persona: string, sessionId: string): Promise<MemoryHit[]> {
    const recent = sessionTexts.value[sessionId] ?? []
    const conversation = recent.join('\n')
    if (!conversation)
      return []
    const query = await embedding.embedQuery(conversation)
    if (!query)
      return []

    const stored = await memoryVectorRepo.listFor(persona)
    const visible = new Map(memory.entries.filter(entry => entry.status === 'active').map(entry => [entry.id, entry]))
    const hits: MemoryHit[] = []
    for (const vector of stored) {
      const entry = visible.get(vector.id)
      if (!entry)
        continue
      const score = cosine(query, vector.vector)
      if (score > 0)
        hits.push({ entry, score })
    }
    return hits.sort((left, right) => right.score - left.score)
  }

  /**
   * Decides whether this turn brings up a memory. Returns a hint line to append to the recall block, or undefined to
   * leave the prompt untouched. On a successful recall the card's counter resets, so the interval starts fresh.
   */
  async function maybeRecall(persona: string, sessionId: string): Promise<string | undefined> {
    if (!enabled.value)
      return undefined
    const candidates = proactiveCandidates(memory.entries.filter(entry => !entry.persona || entry.persona === persona), salienceFloor.value)
    const turnsSince = counters.value[persona] ?? 0
    if (!shouldRecall({
      enabled: true,
      turnsSince,
      minInterval: minInterval.value,
      probability: probability.value,
      hasCandidates: candidates.length > 0,
    })) {
      return undefined
    }

    let chosen = pickBySalience(candidates)

    // 6b: when embeddings are on, prefer a memory that is actually related to the recent conversation. If nothing is
    // related, stay silent rather than forcing an unrelated fact. If the semantic path fails at all, fall back to 6a.
    if (embedding.enabled) {
      try {
        const related = await semanticallyRelated(persona, sessionId)
        if (related.length > 0) {
          const hit = pickRelevant(related, relevanceThreshold.value)
          if (!hit)
            return undefined
          chosen = hit.entry
        }
      }
      catch {
        // Keep the 6a pick made above; a broken semantic path must never block a reply.
      }
    }

    if (!chosen)
      return undefined
    counters.value = { ...counters.value, [persona]: 0 }
    return composeReminder(chosen, maxChars.value)
  }

  return {
    enabled,
    probability,
    minInterval,
    maxChars,
    salienceFloor,
    relevanceThreshold,
    lastRecallAt,
    recordTurn,
    maybeRecall,
  }
})
