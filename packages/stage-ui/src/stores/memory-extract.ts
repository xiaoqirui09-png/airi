import type { MemoryQueueTask, MemoryTurn } from '../types/memory'

import { errorMessageFrom } from '@moeru/std'
import { createMemoryExtractAgent } from '@proj-airi/agents/memory-extract'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useTimeoutFn } from '@vueuse/core'
import { defineStore } from 'pinia'
import { v7 as uuidv7 } from 'uuid'
import { ref } from 'vue'

import { useTextGeneration } from '../composables/text-generation'
import { memoryQueueRepo } from '../database/repos/memory-queue.repo'
import { annotateCandidate, needsExtraction } from '../memory/extract'
import { newQueueTask, settleTask } from '../memory/queue'
import { useMemoryStore } from './memory'
import { useConsciousnessStore } from './modules/consciousness'

/** The first consumption waits for the window to finish its own start-up work. */
const STARTUP_DELAY_MS = 5_000
/** A turn schedules its consumption once the conversation settles, so a fast exchange makes one request, not one per turn. */
const AFTER_TURN_DELAY_MS = 30_000
/** A full batch means more turns wait, so the next batch follows shortly instead of waiting for another turn. */
const NEXT_BATCH_DELAY_MS = 1_000
const REQUEST_TIMEOUT_MS = 20_000
const STARTUP_BATCH = 3
const TURN_BATCH = 3
/** The index lines of the entries that the turn already recalls. They let the model update a fact instead of copying it. */
const RELATED_ENTRIES = 5
const RECENT_TURNS = 2

/**
 * Automatic long-term memory: the queue of finished turns, and the extraction that turns them into candidates.
 *
 * The chat turn hook only enqueues, so a reply never waits for this store. Consumption runs on three occasions: once
 * after the window starts, after a turn settles, and again while a full batch leaves turns waiting. Every window runs
 * it, and the queue repository claims a task for one window only.
 *
 * Use when:
 * - A chat turn completes and its lasting facts are worth remembering.
 * - Settings changes whether extraction runs, and whether a candidate waits for the owner.
 *
 * Expects:
 * - A chat provider and model are selected. Without one, tasks stay pending instead of failing.
 * - The memory store is ready before a consumption reads the entries that a turn recalls.
 *
 * Returns:
 * - `enqueueTurn`, which stores one turn, and the two settings that control extraction.
 */
export const useMemoryExtractStore = defineStore('memory-extract', () => {
  const memory = useMemoryStore()
  const consciousness = useConsciousnessStore()
  const { generateText } = useTextGeneration()

  const autoExtractEnabled = useLocalStorageManualReset<boolean>('settings/memory/auto-extract-enabled', true)
  /** `confirm` keeps a candidate pending until the owner accepts it. `auto` stores it as an active fact at once. */
  const autoExtractMode = useLocalStorageManualReset<'confirm' | 'auto'>('settings/memory/auto-extract-mode', 'confirm')

  const extracting = ref(false)

  /**
   * Extracts one claimed task and settles it. A failed request leaves the task for a later attempt, so a model outage
   * does not lose the turn. A request that finds no lasting fact settles the task as done.
   */
  async function extractTask(task: MemoryQueueTask, selection: { providerId: string, model: string }) {
    let failed = false
    try {
      const agent = createMemoryExtractAgent({ generateText: generateText(selection) })
      const candidates = await agent.extract({
        userText: task.userText,
        assistantText: task.assistantText,
        recentTurns: task.recentTurns,
        relatedDescriptions: memory.recall(task.persona, task.userText).slice(0, RELATED_ENTRIES).map(hit => hit.entry.description),
      }, AbortSignal.timeout(REQUEST_TIMEOUT_MS))
      const status = autoExtractMode.value === 'auto' ? 'active' : 'pending'
      for (const candidate of candidates) {
        const annotated = annotateCandidate(candidate, task.userText)
        if (annotated)
          await memory.storeCandidate(annotated, task.persona, status)
      }
    }
    catch (error) {
      failed = true
      console.warn('[memory] Failed to extract the turn:', errorMessageFrom(error))
    }
    await memoryQueueRepo.save([settleTask(task, failed)])
  }

  const { start: startNextBatch } = useTimeoutFn(() => void consume(TURN_BATCH), NEXT_BATCH_DELAY_MS, { immediate: false })
  const { start: startAfterTurn } = useTimeoutFn(() => void consume(TURN_BATCH), AFTER_TURN_DELAY_MS, { immediate: false })

  /** Claims and extracts up to `limit` turns. One consumption runs at a time in this window. */
  async function consume(limit: number) {
    if (extracting.value || !autoExtractEnabled.value || !memory.enabled)
      return
    // The extraction uses the selected chat model. A card's own model belongs to its replies, not to this background task.
    const selection = { providerId: consciousness.activeProvider, model: consciousness.activeModel }
    if (!selection.providerId || !selection.model)
      return

    extracting.value = true
    try {
      await memory.ready()
      const claimed = await memoryQueueRepo.claim(limit, Date.now())
      for (const task of claimed)
        await extractTask(task, selection)
      if (claimed.length === limit)
        startNextBatch()
    }
    finally {
      extracting.value = false
    }
  }

  /**
   * Stores one finished turn for extraction, unless the turn holds no lasting fact. The turns of the same card that
   * came before it travel with it, so a short statement such as an agreement keeps its meaning.
   */
  async function enqueueTurn(persona: string, turn: MemoryTurn) {
    if (!memory.enabled || !autoExtractEnabled.value || !needsExtraction(turn))
      return
    const previous = (await memoryQueueRepo.list())
      .filter(task => task.persona === persona)
      .slice(-RECENT_TURNS)
      .map(({ userText, assistantText }) => ({ userText, assistantText }))
    await memoryQueueRepo.enqueue({ ...newQueueTask(uuidv7(), persona, turn, Date.now()), recentTurns: previous })
    startAfterTurn()
  }

  // A window that closed during a request left its task running. Reset those claims before the first consumption, so
  // an interrupted turn is extracted again instead of waiting forever.
  useTimeoutFn(async () => {
    await memoryQueueRepo.resetInterrupted(Date.now())
    await consume(STARTUP_BATCH)
  }, STARTUP_DELAY_MS)

  return {
    autoExtractEnabled,
    autoExtractMode,
    enqueueTurn,
  }
})
