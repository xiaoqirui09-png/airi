import type { MemoryAuditLog } from '../../types/memory'

import { prefixStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { storage } from '../storage'
import { memoryAuditRepo } from './memory-audit.repo'

const records = prefixStorage(storage, 'memory-audit')

function log(id: string, at: number): MemoryAuditLog {
  return { id, at, action: 'create', entryId: `entry-${id}`, reason: 'automatic extraction' }
}

describe('memory audit repository', () => {
  beforeEach(async () => {
    await records.clear()
  })

  afterEach(async () => {
    await records.clear()
  })

  it('lists every log, newest action first', async () => {
    await memoryAuditRepo.append(log('a', 10))
    await memoryAuditRepo.append(log('b', 20))
    await memoryAuditRepo.append(log('c', 30))

    expect((await memoryAuditRepo.list()).map(stored => stored.id)).toEqual(['c', 'b', 'a'])
  })

  it('keeps the fields that describe the change', async () => {
    const full: MemoryAuditLog = {
      ...log('a', 10),
      action: 'archive',
      reason: 'superseded by a newer statement',
      before: { status: 'active', description: 'cat named Doudou' },
      after: { status: 'archived', supersedes: ['new-id'] },
    }
    await memoryAuditRepo.append(full)

    expect((await memoryAuditRepo.list())[0]).toEqual(full)
  })

  // The trail is bounded, so a long-running owner cannot grow it without limit. The oldest actions leave first.
  it('trims the trail to its limit and keeps the newest actions', async () => {
    await Promise.all(Array.from({ length: 500 }, (_, index) => memoryAuditRepo.append(log(`old-${index}`, index))))

    await memoryAuditRepo.append(log('new', 1000))

    const stored = await memoryAuditRepo.list()
    expect(stored).toHaveLength(500)
    expect(stored[0]?.id).toBe('new')
    expect(stored.at(-1)?.id).toBe('old-1')
    expect(stored.some(entry => entry.id === 'old-0')).toBe(false)
  })

  it('deletes every log when all data is deleted', async () => {
    await memoryAuditRepo.append(log('a', 10))

    await memoryAuditRepo.clear()

    expect(await memoryAuditRepo.list()).toEqual([])
  })
})
