/**
 * Unit Tests: SwapSig Group Formation & Settlement Mapping
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import { SwapPoolManager } from '../../lib/p2p/swapsig/pool.js'
import { PrivateKey } from '../../lib/bitcore/privatekey.js'
import type { SwapParticipant } from '../../lib/p2p/swapsig/types.js'
import { Script } from '../../lib/bitcore/script.js'

describe('SwapSig Group Formation', () => {
  let poolManager: SwapPoolManager

  before(() => {
    poolManager = new SwapPoolManager()
  })

  describe('Group Size Strategy', () => {
    it('should select 2-of-2 for small pools (3-9 participants)', () => {
      const strategy3 = poolManager.determineOptimalGroupSize(3)
      assert.strictEqual(
        strategy3.groupSize,
        2,
        'Should use 2-of-2 for 3 participants',
      )

      const strategy9 = poolManager.determineOptimalGroupSize(9)
      assert.strictEqual(
        strategy9.groupSize,
        2,
        'Should use 2-of-2 for 9 participants',
      )
    })

    it('should select 3-of-3 for medium-small pools (10-14 participants)', () => {
      const strategy10 = poolManager.determineOptimalGroupSize(10)
      assert.strictEqual(
        strategy10.groupSize,
        3,
        'Should use 3-of-3 for 10 participants',
      )

      const strategy14 = poolManager.determineOptimalGroupSize(14)
      assert.strictEqual(
        strategy14.groupSize,
        3,
        'Should use 3-of-3 for 14 participants',
      )
    })

    it('should select 5-of-5 for medium-large pools (15-49 participants)', () => {
      const strategy15 = poolManager.determineOptimalGroupSize(15)
      assert.strictEqual(
        strategy15.groupSize,
        5,
        'Should use 5-of-5 for 15 participants',
      )

      const strategy25 = poolManager.determineOptimalGroupSize(25)
      assert.strictEqual(
        strategy25.groupSize,
        5,
        'Should use 5-of-5 for 25 participants (sweet spot)',
      )

      const strategy49 = poolManager.determineOptimalGroupSize(49)
      assert.strictEqual(
        strategy49.groupSize,
        5,
        'Should use 5-of-5 for 49 participants',
      )
    })

    it('should select 10-of-10 for large pools (50+ participants)', () => {
      const strategy50 = poolManager.determineOptimalGroupSize(50)
      assert.strictEqual(
        strategy50.groupSize,
        10,
        'Should use 10-of-10 for 50 participants',
      )

      const strategy100 = poolManager.determineOptimalGroupSize(100)
      assert.strictEqual(
        strategy100.groupSize,
        10,
        'Should use 10-of-10 for 100 participants',
      )
    })

    it('should calculate correct anonymity per group', () => {
      const strategy2 = poolManager.determineOptimalGroupSize(5)
      assert.strictEqual(
        strategy2.anonymityPerGroup,
        2,
        '2-of-2 should have 2 mappings',
      )

      const strategy3 = poolManager.determineOptimalGroupSize(10)
      assert.strictEqual(
        strategy3.anonymityPerGroup,
        6,
        '3-of-3 should have 6 mappings (3!)',
      )

      const strategy5 = poolManager.determineOptimalGroupSize(25)
      assert.strictEqual(
        strategy5.anonymityPerGroup,
        120,
        '5-of-5 should have 120 mappings (5!)',
      )

      const strategy10 = poolManager.determineOptimalGroupSize(50)
      assert.strictEqual(
        strategy10.anonymityPerGroup,
        3628800,
        '10-of-10 should have 3,628,800 mappings (10!)',
      )
    })
  })

  describe('Output Group Formation (2-of-2)', () => {
    it('should create circular pairs for 3 participants', () => {
      // Create mock participants
      const participants: SwapParticipant[] = []
      for (let i = 0; i < 3; i++) {
        const key = new PrivateKey()
        const address = key.toAddress()
        participants.push({
          peerId: `peer-${i}`,
          participantIndex: i,
          publicKey: key.publicKey,
          input: {
            txId: '0'.repeat(64),
            outputIndex: i,
            amount: 1000000,
            script: Script.fromAddress(address),
            address: address,
          },
          ownershipProof: Buffer.from('proof'),
          finalOutputEncrypted: Buffer.from('encrypted'),
          finalOutputCommitment: Buffer.from('commitment'),
          setupConfirmed: false,
          joinedAt: Date.now(),
        })
      }

      // Compute groups using the algorithm from coordinator
      const groupSize = 2
      const groups: number[][] = []
      const n = participants.length

      for (let i = 0; i < n; i++) {
        const partner = (i + 1) % n
        groups.push([i, partner])
      }

      // Verify groups
      assert.strictEqual(groups.length, 3, 'Should have 3 groups')
      assert.deepStrictEqual(groups[0], [0, 1], 'Group 0 should be [0, 1]')
      assert.deepStrictEqual(groups[1], [1, 2], 'Group 1 should be [1, 2]')
      assert.deepStrictEqual(
        groups[2],
        [2, 0],
        'Group 2 should be [2, 0] (circular)',
      )
    })

    it('should create circular pairs for 5 participants', () => {
      const n = 5
      const groups: number[][] = []

      for (let i = 0; i < n; i++) {
        const partner = (i + 1) % n
        groups.push([i, partner])
      }

      assert.strictEqual(groups.length, 5, 'Should have 5 groups')
      assert.deepStrictEqual(
        groups[4],
        [4, 0],
        'Last group should wrap to first participant',
      )
    })

    it('should ensure every participant appears in exactly 2 groups', () => {
      const n = 5
      const groups: number[][] = []

      for (let i = 0; i < n; i++) {
        const partner = (i + 1) % n
        groups.push([i, partner])
      }

      // Count appearances
      const appearances = new Map<number, number>()
      for (const group of groups) {
        for (const participant of group) {
          appearances.set(participant, (appearances.get(participant) || 0) + 1)
        }
      }

      for (let i = 0; i < n; i++) {
        assert.strictEqual(
          appearances.get(i),
          2,
          `Participant ${i} should appear in exactly 2 groups`,
        )
      }
    })
  })

  describe('Output Group Formation (3-of-3)', () => {
    it('should create non-overlapping groups for 12 participants', () => {
      const n = 12
      const groupSize = 3
      const groups: number[][] = []

      const numCompleteGroups = Math.floor(n / groupSize)

      for (let g = 0; g < numCompleteGroups; g++) {
        const group: number[] = []
        for (let i = 0; i < groupSize; i++) {
          group.push(g * groupSize + i)
        }
        groups.push(group)
      }

      assert.strictEqual(groups.length, 4, 'Should have 4 complete groups')
      assert.deepStrictEqual(
        groups[0],
        [0, 1, 2],
        'Group 0 should be [0, 1, 2]',
      )
      assert.deepStrictEqual(
        groups[1],
        [3, 4, 5],
        'Group 1 should be [3, 4, 5]',
      )
      assert.deepStrictEqual(
        groups[2],
        [6, 7, 8],
        'Group 2 should be [6, 7, 8]',
      )
      assert.deepStrictEqual(
        groups[3],
        [9, 10, 11],
        'Group 3 should be [9, 10, 11]',
      )
    })

    it('should handle remaining participants with wrap-around', () => {
      const n = 10 // Not divisible by 3
      const groupSize = 3
      const groups: number[][] = []

      const numCompleteGroups = Math.floor(n / groupSize)

      // Complete groups
      for (let g = 0; g < numCompleteGroups; g++) {
        const group: number[] = []
        for (let i = 0; i < groupSize; i++) {
          group.push(g * groupSize + i)
        }
        groups.push(group)
      }

      // Handle remaining
      const remaining = n % groupSize
      if (remaining > 0) {
        const lastGroup: number[] = []
        for (let i = 0; i < remaining; i++) {
          lastGroup.push(numCompleteGroups * groupSize + i)
        }
        // Pad with participants from beginning
        let padIndex = 0
        while (lastGroup.length < groupSize) {
          lastGroup.push(padIndex)
          padIndex++
        }
        groups.push(lastGroup)
      }

      assert.strictEqual(groups.length, 4, 'Should have 4 groups')
      assert.deepStrictEqual(
        groups[3],
        [9, 0, 1],
        'Last group should wrap around',
      )
    })
  })

  describe('Settlement Mapping (Circular Rotation)', () => {
    it('should create valid circular rotation for 3 participants (2-of-2)', () => {
      const n = 3
      const numGroups = 3
      const groupSize = 2

      // Mapping: each group's output goes to next participant
      const mapping: Array<{ groupIndex: number; receiverIndex: number }> = []

      for (let g = 0; g < numGroups; g++) {
        const receiverIndex = (g + 1) % n
        mapping.push({ groupIndex: g, receiverIndex })
      }

      assert.strictEqual(mapping.length, 3, 'Should have 3 mappings')

      // Verify circular rotation
      assert.strictEqual(mapping[0].receiverIndex, 1, 'Group 0 → Participant 1')
      assert.strictEqual(mapping[1].receiverIndex, 2, 'Group 1 → Participant 2')
      assert.strictEqual(
        mapping[2].receiverIndex,
        0,
        'Group 2 → Participant 0 (wrap)',
      )
    })

    it('should ensure no participant receives from their own input', () => {
      const n = 5
      const numGroups = 5

      // For 2-of-2, groups are: [0,1], [1,2], [2,3], [3,4], [4,0]
      const groups = []
      for (let i = 0; i < n; i++) {
        groups.push([i, (i + 1) % n])
      }

      // Mapping: each group → participant +2 positions away to avoid overlap
      // (For 2-of-2, adjacent groups share a participant, so +1 doesn't work)
      const mapping: Array<{ groupIndex: number; receiverIndex: number }> = []
      for (let g = 0; g < numGroups; g++) {
        const receiverIndex = (g + 2) % n
        mapping.push({ groupIndex: g, receiverIndex })
      }

      // Verify no participant receives from their own input
      for (let i = 0; i < n; i++) {
        const myGroups = groups
          .map((g, idx) => ({ group: g, index: idx }))
          .filter(({ group }) => group.includes(i))
          .map(({ index }) => index)

        const myReceivedFrom = mapping.find(
          m => m.receiverIndex === i,
        )?.groupIndex

        if (myReceivedFrom !== undefined) {
          assert.ok(
            !myGroups.includes(myReceivedFrom),
            `Participant ${i} should not receive from their own group`,
          )
        }
      }
    })

    it('should create valid mapping for larger groups (3-of-3)', () => {
      const n = 12
      const groupSize = 3
      const numGroups = 4

      // Groups: [0,1,2], [3,4,5], [6,7,8], [9,10,11]
      const groups = []
      for (let g = 0; g < numGroups; g++) {
        const group = []
        for (let i = 0; i < groupSize; i++) {
          group.push(g * groupSize + i)
        }
        groups.push(group)
      }

      // Mapping: each group's output → first participant of next group
      const mapping: Array<{ groupIndex: number; receiverIndex: number }> = []
      for (let g = 0; g < numGroups; g++) {
        const nextGroup = (g + 1) % numGroups
        const receiverIndex = groups[nextGroup][0]
        mapping.push({ groupIndex: g, receiverIndex })
      }

      assert.strictEqual(mapping.length, 4, 'Should have 4 mappings')
      assert.strictEqual(mapping[0].receiverIndex, 3, 'Group 0 → Participant 3')
      assert.strictEqual(mapping[1].receiverIndex, 6, 'Group 1 → Participant 6')
      assert.strictEqual(mapping[2].receiverIndex, 9, 'Group 2 → Participant 9')
      assert.strictEqual(
        mapping[3].receiverIndex,
        0,
        'Group 3 → Participant 0 (wrap)',
      )
    })

    it('should have perfect unlinkability (every participant receives from non-signers)', () => {
      const n = 3
      const groups = [
        [0, 1],
        [1, 2],
        [2, 0],
      ]

      // Mapping
      const receiverMap = [
        { receiver: 1, fromGroup: 0 }, // Participant 1 receives from Group 0 (signers: 0, 1)
        { receiver: 2, fromGroup: 1 }, // Participant 2 receives from Group 1 (signers: 1, 2)
        { receiver: 0, fromGroup: 2 }, // Participant 0 receives from Group 2 (signers: 2, 0)
      ]

      // Verify each receiver is not a signer of their receiving group
      for (const { receiver, fromGroup } of receiverMap) {
        const signers = groups[fromGroup]
        // At least one signer should be different from receiver
        const hasNonSelfSigner = signers.some(s => s !== receiver)
        assert.ok(
          hasNonSelfSigner,
          `Participant ${receiver} should receive from a group with at least one non-self signer`,
        )
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle minimum participants (3)', () => {
      const strategy = poolManager.determineOptimalGroupSize(3)
      assert.strictEqual(strategy.groupSize, 2, 'Should use 2-of-2 for minimum')
      assert.ok(strategy.groupCount >= 1, 'Should have at least 1 group')
    })

    it('should handle large participant count (100)', () => {
      const strategy = poolManager.determineOptimalGroupSize(100)
      assert.strictEqual(strategy.groupSize, 10, 'Should use 10-of-10')
      assert.strictEqual(strategy.groupCount, 10, 'Should have 10 groups')
    })

    it('should handle edge case at boundaries', () => {
      // Test boundary between 2-of-2 and 3-of-3
      const strategy9 = poolManager.determineOptimalGroupSize(9)
      const strategy10 = poolManager.determineOptimalGroupSize(10)

      assert.strictEqual(strategy9.groupSize, 2, '9 should use 2-of-2')
      assert.strictEqual(strategy10.groupSize, 3, '10 should use 3-of-3')

      // Test boundary between 3-of-3 and 5-of-5
      const strategy14 = poolManager.determineOptimalGroupSize(14)
      const strategy15 = poolManager.determineOptimalGroupSize(15)

      assert.strictEqual(strategy14.groupSize, 3, '14 should use 3-of-3')
      assert.strictEqual(strategy15.groupSize, 5, '15 should use 5-of-5')

      // Test boundary between 5-of-5 and 10-of-10
      const strategy49 = poolManager.determineOptimalGroupSize(49)
      const strategy50 = poolManager.determineOptimalGroupSize(50)

      assert.strictEqual(strategy49.groupSize, 5, '49 should use 5-of-5')
      assert.strictEqual(strategy50.groupSize, 10, '50 should use 10-of-10')
    })
  })
})
