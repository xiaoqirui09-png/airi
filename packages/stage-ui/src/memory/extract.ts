import type { MemoryCandidate } from '@proj-airi/agents/memory-extract'

import type { MemoryTurn } from '../types/memory'

import { WRITE_MEMORY_TOOL_NAME } from '../tools/memory'

/**
 * Short acknowledgements that carry no fact. The filter compares the whole message after it removes emoji, punctuation,
 * and spaces, so `好的！！` and `好的` are the same turn.
 */
const FILLERS = new Set([
  '哈哈',
  '哈哈哈',
  '哈哈哈哈',
  '嗯',
  '嗯嗯',
  '好',
  '好的',
  '好吧',
  '哦',
  '噢',
  '呵',
  '呵呵',
  '嘿嘿',
  '嘻嘻',
  '唉',
  '诶',
  'ok',
  'okay',
  'okays',
  'yes',
  'yeah',
  'yep',
  'no',
  'nope',
  'hi',
  'hello',
  'hey',
  'thanks',
  'thankyou',
  'thx',
  'lol',
  'lmao',
  'haha',
  'hahaha',
  'wow',
  'nice',
  'cool',
  'emmm',
  'emm',
  'uh',
  'um',
])

/** Emoji, punctuation, symbols, and spaces. What survives them is the wording of the message. */
const NON_WORD = /[\p{Extended_Pictographic}\p{P}\p{S}\s]/gu

/** A statement about the owner. The extraction trusts a candidate more when the owner's own words carry one. */
const FIRST_PERSON = /[我咱俺]|\b(?:i|my|me|mine|myself)\b/i

/** A question word at the start of the message. A question asks for information instead of giving it. */
const QUESTION_START = /^(?:什么|怎么|怎样|为什么|为何|[哪谁几]|多少|难道|是不是|有没有|(?:what|how|why|who|where|when|which|is|are|do|does|did|can|could)\b)/i

/** Wording that hedges a claim. A hedged fact is weaker evidence, so its confidence drops. */
const HEDGE = /可能|大概|似乎|也许|好像|或许|应该是|maybe|perhaps|probably|might|seems|likely/i

const HEDGE_CONFIDENCE_FACTOR = 0.7

/** A candidate below this confidence is discarded instead of stored, so a guess never becomes a remembered fact. */
const MIN_CONFIDENCE = 0.5

const MIN_USER_CHARS = 6
const MIN_ASSISTANT_CHARS = 20

/**
 * Decides whether a finished turn is worth an extraction request.
 *
 * This runs before any model call, so it turns away the turns that cannot hold a lasting fact: a short exchange, an
 * acknowledgement, a question that states nothing about the owner, and a turn where the model already saved memory.
 */
export function needsExtraction(turn: MemoryTurn) {
  const userText = turn.userText.trim()
  const assistantText = turn.assistantText.trim()
  if (turn.toolCalls.includes(WRITE_MEMORY_TOOL_NAME))
    return false
  if (userText.length < MIN_USER_CHARS && assistantText.length < MIN_ASSISTANT_CHARS)
    return false

  const wording = userText.replace(NON_WORD, '').toLowerCase()
  if (!wording || FILLERS.has(wording))
    return false

  // A question about the owner still states nothing, so only a question without a first-person marker is turned away.
  return !(QUESTION_START.test(userText) && !FIRST_PERSON.test(userText))
}

/**
 * Corrects the attributes of one candidate against the owner's own words, and drops a candidate that is too unsure.
 *
 * A first-person statement overrides the model's `source`, because the owner's wording is stronger evidence than the
 * model's reading of it. Without that marker the model's own label stands: a statement such as a birthday can be the
 * owner's without naming them. Hedged wording lowers confidence, and a candidate that falls below the floor is dropped.
 *
 * @example
 * annotateCandidate({ description: 'Likes iced americano.', body: 'Maybe one each morning.', kind: 'preference', source: 'model', confidence: 1, keywords: ['americano'] }, '我喜欢冰美式')
 * // => { description: 'Likes iced americano.', body: 'Maybe one each morning.', kind: 'preference', source: 'user', confidence: 0.7, keywords: ['americano'] }
 */
export function annotateCandidate(candidate: MemoryCandidate, userText: string): MemoryCandidate | undefined {
  const source = FIRST_PERSON.test(userText) ? 'user' : candidate.source
  const confidence = HEDGE.test(`${candidate.description}\n${candidate.body}`)
    ? candidate.confidence * HEDGE_CONFIDENCE_FACTOR
    : candidate.confidence
  if (confidence < MIN_CONFIDENCE)
    return undefined
  return { ...candidate, source, confidence }
}
