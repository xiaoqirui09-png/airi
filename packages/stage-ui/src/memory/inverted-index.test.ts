import { describe, expect, it } from 'vitest'

import { tokenizeMemoryText } from './inverted-index'

describe('tokenizeMemoryText', () => {
  it('splits an ideograph run into bigrams and keeps latin words whole', () => {
    expect(tokenizeMemoryText('喜欢喝冰美式 Iced Americano')).toEqual(['喜欢', '欢喝', '喝冰', '冰美', '美式', 'iced', 'americano'])
  })

  it('keeps a run of one ideograph as that ideograph', () => {
    expect(tokenizeMemoryText('猫')).toEqual(['猫'])
  })

  // The same function reads a stored entry and a recall query, so case and punctuation must not separate them.
  it('lowercases, drops punctuation and emoji, and deduplicates', () => {
    expect(tokenizeMemoryText('Cat, cat! 🐱 CAT')).toEqual(['cat'])
    expect(tokenizeMemoryText('豆豆。豆豆！')).toEqual(['豆豆'])
  })

  it('drops the words that carry no meaning of their own', () => {
    expect(tokenizeMemoryText('the cat and a dog')).toEqual(['cat', 'dog'])
    expect(tokenizeMemoryText('我 猫')).toEqual(['猫'])
  })

  // A preference often turns on a negation, so dropping it would make `no sugar` recall the same as `sugar`.
  it('keeps negations', () => {
    expect(tokenizeMemoryText('no sugar')).toEqual(['no', 'sugar'])
    expect(tokenizeMemoryText('not sweet')).toEqual(['not', 'sweet'])
  })

  it('drops a latin run of one character, which names nothing', () => {
    expect(tokenizeMemoryText('a I x cat')).toEqual(['cat'])
  })

  it('keeps digits as a whole word', () => {
    expect(tokenizeMemoryText('version 2024')).toEqual(['version', '2024'])
  })

  it('resolves to no key for text that holds no word', () => {
    expect(tokenizeMemoryText('')).toEqual([])
    expect(tokenizeMemoryText('🐱🐶 !!!')).toEqual([])
    expect(tokenizeMemoryText('the a of')).toEqual([])
  })

  // A bigram bridge across two runs would name a fact that neither run states.
  it('does not bridge two runs that punctuation separates', () => {
    expect(tokenizeMemoryText('猫,狗')).toEqual(['猫', '狗'])
  })
})
