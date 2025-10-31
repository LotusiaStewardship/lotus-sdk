/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 Coordinator Failover Tests
 *
 * Tests the automatic coordinator failover mechanism for all election methods.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import {
  electCoordinator,
  getBackupCoordinator,
  getCoordinatorPriorityList,
  ElectionMethod,
} from '../../../lib/p2p/musig2/election.js'
import { PrivateKey } from '../../../lib/bitcore/privatekey.js'
import { PublicKey } from '../../../lib/bitcore/publickey.js'

describe('MuSig2 Coordinator Failover', () => {
  describe('getBackupCoordinator()', () => {
    it('should get backup coordinator for lexicographic method', () => {
      // Create 5 participants
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      // Get primary coordinator
      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Get backup coordinator
      const backup = getBackupCoordinator(
        publicKeys,
        election.coordinatorIndex,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.ok(backup !== null)
      assert.notStrictEqual(backup, election.coordinatorIndex)
      assert.ok(backup >= 0 && backup < publicKeys.length)
    })

    it('should get backup coordinator for hash-based method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(publicKeys, ElectionMethod.HASH_BASED)
      const backup = getBackupCoordinator(
        publicKeys,
        election.coordinatorIndex,
        ElectionMethod.HASH_BASED,
      )

      assert.ok(backup !== null)
      assert.notStrictEqual(backup, election.coordinatorIndex)
    })

    it('should get backup coordinator for first-signer method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(publicKeys, ElectionMethod.FIRST_SIGNER)
      assert.strictEqual(election.coordinatorIndex, 0) // First signer

      const backup = getBackupCoordinator(
        publicKeys,
        election.coordinatorIndex,
        ElectionMethod.FIRST_SIGNER,
      )

      assert.strictEqual(backup, 1) // Next is index 1
    })

    it('should get backup coordinator for last-signer method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(publicKeys, ElectionMethod.LAST_SIGNER)
      assert.strictEqual(election.coordinatorIndex, 4) // Last signer (index 4)

      const backup = getBackupCoordinator(
        publicKeys,
        election.coordinatorIndex,
        ElectionMethod.LAST_SIGNER,
      )

      assert.strictEqual(backup, 3) // Previous is index 3
    })

    it('should return null when no backup available (single signer)', () => {
      const participant = new PrivateKey()
      const publicKeys = [participant.publicKey]

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const backup = getBackupCoordinator(
        publicKeys,
        election.coordinatorIndex,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.strictEqual(backup, null)
    })

    it('should return null when first-signer reaches end of list', () => {
      const participants = Array.from({ length: 3 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      // Simulate failover to last signer
      const lastIndex = publicKeys.length - 1
      const backup = getBackupCoordinator(
        publicKeys,
        lastIndex,
        ElectionMethod.FIRST_SIGNER,
      )

      assert.strictEqual(backup, null) // No more backups
    })

    it('should return null when last-signer reaches beginning of list', () => {
      const participants = Array.from({ length: 3 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      // Simulate failover to first signer
      const backup = getBackupCoordinator(
        publicKeys,
        0,
        ElectionMethod.LAST_SIGNER,
      )

      assert.strictEqual(backup, null) // No more backups
    })

    it('should not return same coordinator as backup (lexicographic)', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const backup = getBackupCoordinator(
        publicKeys,
        election.coordinatorIndex,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Backup should never be the same as current coordinator
      assert.notStrictEqual(backup, election.coordinatorIndex)
    })

    it('should chain multiple backups (lexicographic wraps around)', () => {
      const participants = Array.from({ length: 3 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const backup1 = getBackupCoordinator(
        publicKeys,
        election.coordinatorIndex,
        ElectionMethod.LEXICOGRAPHIC,
      )
      assert.ok(backup1 !== null)

      const backup2 = getBackupCoordinator(
        publicKeys,
        backup1,
        ElectionMethod.LEXICOGRAPHIC,
      )
      assert.ok(backup2 !== null)

      // All three should be different
      assert.notStrictEqual(election.coordinatorIndex, backup1)
      assert.notStrictEqual(backup1, backup2)
      assert.notStrictEqual(election.coordinatorIndex, backup2)
    })
  })

  describe('getCoordinatorPriorityList()', () => {
    it('should return priority list for lexicographic method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const priorityList = getCoordinatorPriorityList(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Should have all 5 coordinators (wraps around)
      assert.strictEqual(priorityList.length, 5)

      // All indices should be unique
      const uniqueIndices = new Set(priorityList)
      assert.strictEqual(uniqueIndices.size, 5)

      // All indices should be valid
      for (const index of priorityList) {
        assert.ok(index >= 0 && index < 5)
      }
    })

    it('should return priority list for first-signer method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const priorityList = getCoordinatorPriorityList(
        publicKeys,
        ElectionMethod.FIRST_SIGNER,
      )

      // Should be [0, 1, 2, 3, 4] (in order)
      assert.deepStrictEqual(priorityList, [0, 1, 2, 3, 4])
    })

    it('should return priority list for last-signer method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const priorityList = getCoordinatorPriorityList(
        publicKeys,
        ElectionMethod.LAST_SIGNER,
      )

      // Should be [4, 3, 2, 1, 0] (reverse order)
      assert.deepStrictEqual(priorityList, [4, 3, 2, 1, 0])
    })

    it('should return priority list for hash-based method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const priorityList = getCoordinatorPriorityList(
        publicKeys,
        ElectionMethod.HASH_BASED,
      )

      // Should have all 5 coordinators
      assert.strictEqual(priorityList.length, 5)

      // All indices should be unique
      const uniqueIndices = new Set(priorityList)
      assert.strictEqual(uniqueIndices.size, 5)
    })

    it('should return single item for single signer', () => {
      const participant = new PrivateKey()
      const publicKeys = [participant.publicKey]

      const priorityList = getCoordinatorPriorityList(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.deepStrictEqual(priorityList, [0])
    })

    it('should be deterministic (same result on multiple calls)', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const list1 = getCoordinatorPriorityList(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const list2 = getCoordinatorPriorityList(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.deepStrictEqual(list1, list2)
    })
  })

  describe('Failover Sequence Validation', () => {
    it('should provide valid failover sequence for 3-of-3', () => {
      const participants = Array.from({ length: 3 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Simulate 3 failovers (should hit all participants)
      const sequence = [election.coordinatorIndex]
      let current = election.coordinatorIndex

      for (let i = 0; i < 2; i++) {
        const next = getBackupCoordinator(
          publicKeys,
          current,
          ElectionMethod.LEXICOGRAPHIC,
        )
        assert.ok(next !== null)
        sequence.push(next!)
        current = next!
      }

      // All 3 participants should be in sequence
      assert.strictEqual(new Set(sequence).size, 3)
    })

    it('should provide valid failover sequence for 5-of-5', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Simulate 5 failovers (should hit all participants)
      const sequence = [election.coordinatorIndex]
      let current = election.coordinatorIndex

      for (let i = 0; i < 4; i++) {
        const next = getBackupCoordinator(
          publicKeys,
          current,
          ElectionMethod.LEXICOGRAPHIC,
        )
        assert.ok(next !== null)
        sequence.push(next!)
        current = next!
      }

      // All 5 participants should be in sequence
      assert.strictEqual(new Set(sequence).size, 5)
    })

    it('should handle first-signer exhaustion correctly', () => {
      const participants = Array.from({ length: 3 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      // First signer: 0 -> 1 -> 2 -> null
      let current = 0

      for (let i = 0; i < 2; i++) {
        const next = getBackupCoordinator(
          publicKeys,
          current,
          ElectionMethod.FIRST_SIGNER,
        )
        assert.ok(next !== null)
        current = next!
      }

      // Last failover should return null
      const final = getBackupCoordinator(
        publicKeys,
        current,
        ElectionMethod.FIRST_SIGNER,
      )
      assert.strictEqual(final, null)
    })

    it('should handle last-signer exhaustion correctly', () => {
      const participants = Array.from({ length: 3 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      // Last signer: 2 -> 1 -> 0 -> null
      let current = 2

      for (let i = 0; i < 2; i++) {
        const next = getBackupCoordinator(
          publicKeys,
          current,
          ElectionMethod.LAST_SIGNER,
        )
        assert.ok(next !== null)
        current = next!
      }

      // Last failover should return null
      const final = getBackupCoordinator(
        publicKeys,
        current,
        ElectionMethod.LAST_SIGNER,
      )
      assert.strictEqual(final, null)
    })
  })

  describe('Failover Consistency', () => {
    it('should produce same backup for all participants (determinism)', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // All participants compute same backup
      const backups = participants.map(() =>
        getBackupCoordinator(
          publicKeys,
          election.coordinatorIndex,
          ElectionMethod.LEXICOGRAPHIC,
        ),
      )

      // All should be the same
      const firstBackup = backups[0]
      for (const backup of backups) {
        assert.strictEqual(backup, firstBackup)
      }
    })

    it('should maintain priority list consistency across failovers', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const priorityList = getCoordinatorPriorityList(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Manually compute failover sequence
      const manualSequence = [priorityList[0]]
      for (let i = 1; i < priorityList.length; i++) {
        const backup = getBackupCoordinator(
          publicKeys,
          manualSequence[i - 1],
          ElectionMethod.LEXICOGRAPHIC,
        )
        if (backup !== null) {
          manualSequence.push(backup)
        }
      }

      // Manual sequence should match priority list
      assert.deepStrictEqual(manualSequence, priorityList)
    })
  })

  describe('Edge Cases', () => {
    it('should throw error if current coordinator not in signers list', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      // Invalid coordinator index
      assert.throws(() => {
        getBackupCoordinator(publicKeys, 999, ElectionMethod.LEXICOGRAPHIC)
      }, /not found in signers list/)
    })

    it('should handle 2-of-2 failover (minimal case)', () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const publicKeys = [alice.publicKey, bob.publicKey]

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const backup = getBackupCoordinator(
        publicKeys,
        election.coordinatorIndex,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.ok(backup !== null)
      assert.notStrictEqual(backup, election.coordinatorIndex)

      // Only 2 options: 0 or 1
      assert.ok(backup === 0 || backup === 1)
    })

    it('should handle large number of signers (10-of-10)', () => {
      const participants = Array.from({ length: 10 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const priorityList = getCoordinatorPriorityList(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Should have all 10 coordinators
      assert.strictEqual(priorityList.length, 10)
      assert.strictEqual(new Set(priorityList).size, 10)
    })
  })
})
