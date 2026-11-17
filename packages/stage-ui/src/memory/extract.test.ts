import type { MemoryCandidate } from '@proj-airi/agents/memory-extract'

import type { MemoryTurn } from '../types/memory'

import { describe, expect, it } from 'vitest'

import { WRITE_MEMORY_TOOL_NAME } from '../tools/memory'
import { annotateCandidate, needsExtraction } from './extract'

function turn(userText: string, assistantText = 'That sounds lovely, tell me more about it.', toolCalls: string[] = []): MemoryTurn {
  return { userText, assistantText, toolCalls }
}

const candidate: MemoryCandidate = {
  description: 'Likes iced americano.',
  body: 'The owner drinks one each morning.',
  kind: 'preference',
  source: 'model',
  confidence: 1,
  keywords: ['americano'],
}

describe('needsExtraction', () => {
  it('takes a turn where the owner states a lasting fact', () => {
    expect(needsExtraction(turn('我养了一只叫豆豆的猫'))).toBe(true)
    expect(needsExtraction(turn('I keep a cat named Doudou.'))).toBe(true)
  })

  // The model already saved the fact this turn, so a second request would propose a copy of it.
  it('turns away a turn where the model already wrote memory', () => {
    expect(needsExtraction(turn('我养了一只叫豆豆的猫', 'Saved.', [WRITE_MEMORY_TOOL_NAME]))).toBe(false)
  })

  it('turns away a short exchange that cannot hold a fact', () => {
    expect(needsExtraction(turn('hi', 'Hello!'))).toBe(false)
    expect(needsExtraction(turn('', ''))).toBe(false)
  })

  // A long assistant reply can carry a fact that the owner only stated briefly, so length alone does not turn it away.
  it('takes a short statement when the reply is long enough to carry meaning', () => {
    expect(needsExtraction(turn('养了只猫', 'You keep a cat named Doudou, and you adopted her last spring.'))).toBe(true)
  })

  // The filler rule runs after the length rule, so an acknowledgement stays turned away even beside a long reply.
  it('turns away an acknowledgement even when the reply is long', () => {
    expect(needsExtraction(turn('好的', 'You keep a cat named Doudou, and you adopted her last spring.'))).toBe(false)
  })

  it('turns away an acknowledgement, with or without punctuation and emoji', () => {
    expect(needsExtraction(turn('好的！！', 'You keep a cat named Doudou, and you adopted her last spring.'))).toBe(false)
    expect(needsExtraction(turn('哈哈哈', 'You keep a cat named Doudou, and you adopted her last spring.'))).toBe(false)
    expect(needsExtraction(turn('ok 🐱', 'You keep a cat named Doudou, and you adopted her last spring.'))).toBe(false)
    expect(needsExtraction(turn('...', 'You keep a cat named Doudou, and you adopted her last spring.'))).toBe(false)
  })

  it('turns away a question that states nothing about the owner', () => {
    expect(needsExtraction(turn('什么是倒排索引？'))).toBe(false)
    expect(needsExtraction(turn('What is an inverted index?'))).toBe(false)
    expect(needsExtraction(turn('How does the index work?'))).toBe(false)
  })

  // A question about the owner still states a fact about them, so the first-person marker keeps it.
  it('takes a question that names the owner', () => {
    expect(needsExtraction(turn('为什么我总是喜欢冰美式？'))).toBe(true)
    expect(needsExtraction(turn('Why do I always want iced americano?'))).toBe(true)
    expect(needsExtraction(turn('How do I install it?'))).toBe(true)
  })
})

describe('annotateCandidate', () => {
  it('trusts the owner wording over the model reading of it', () => {
    expect(annotateCandidate(candidate, '我喜欢冰美式')).toMatchObject({ source: 'user', confidence: 1 })
    expect(annotateCandidate(candidate, 'I like iced americano')).toMatchObject({ source: 'user', confidence: 1 })
  })

  // A statement such as a birthday can be the owner's without naming them, so the model label stands.
  it('keeps the model label when the owner words carry no first-person marker', () => {
    expect(annotateCandidate(candidate, '冰美式')).toMatchObject({ source: 'model' })
    expect(annotateCandidate({ ...candidate, source: 'user' }, '冰美式')).toMatchObject({ source: 'user' })
  })

  it('lowers the confidence of a hedged fact', () => {
    expect(annotateCandidate({ ...candidate, body: 'Maybe one each morning.' }, '我喜欢冰美式')).toMatchObject({ confidence: 0.7 })
    expect(annotateCandidate({ ...candidate, description: '可能喜欢冰美式' }, '我喜欢冰美式')).toMatchObject({ confidence: 0.7 })
  })

  it('drops a candidate that falls below the confidence floor', () => {
    expect(annotateCandidate({ ...candidate, confidence: 0.7, body: 'Maybe one each morning.' }, '我喜欢冰美式')).toBeUndefined()
    expect(annotateCandidate({ ...candidate, confidence: 0.4 }, '我喜欢冰美式')).toBeUndefined()
  })

  it('keeps a candidate at the floor', () => {
    expect(annotateCandidate({ ...candidate, confidence: 0.5 }, '我喜欢冰美式')).toMatchObject({ confidence: 0.5 })
  })

  it('keeps the fact itself and its keywords unchanged', () => {
    expect(annotateCandidate(candidate, '我喜欢冰美式')).toEqual({ ...candidate, source: 'user' })
  })
})
