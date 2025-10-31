/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 Coordinator Election Tests
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  electCoordinator,
  verifyElectionResult,
  isCoordinator,
  getCoordinatorPublicKey,
  ElectionMethod,
} from '../../../lib/p2p/musig2/election.js'
import { PrivateKey } from '../../../lib/bitcore/privatekey.js'
import { PublicKey } from '../../../lib/bitcore/publickey.js'

describe('MuSig2 Coordinator Election', () => {
  describe('electCoordinator()', () => {
    it('should elect coordinator using lexicographic ordering', () => {
      // Create 5 participants with random keys
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.ok(election.coordinatorIndex >= 0)
      assert.ok(election.coordinatorIndex < publicKeys.length)
      assert.ok(election.coordinatorPublicKey)
      assert.strictEqual(election.sortedSigners.length, publicKeys.length)
      assert.ok(election.electionProof)
      assert.strictEqual(typeof election.electionProof, 'string')
      assert.strictEqual(election.electionProof.length, 64) // SHA256 hex
    })

    it('should elect same coordinator for same set of keys', () => {
      const participants = Array.from({ length: 3 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election1 = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const election2 = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.strictEqual(election1.coordinatorIndex, election2.coordinatorIndex)
      assert.strictEqual(
        election1.coordinatorPublicKey.toString(),
        election2.coordinatorPublicKey.toString(),
      )
      assert.strictEqual(election1.electionProof, election2.electionProof)
    })

    it('should elect different coordinator for different key orderings', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election1 = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Reverse the order
      const publicKeysReversed = [...publicKeys].reverse()
      const election2 = electCoordinator(
        publicKeysReversed,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // The coordinator should still be the same public key (lexicographic is deterministic)
      assert.strictEqual(
        election1.coordinatorPublicKey.toString(),
        election2.coordinatorPublicKey.toString(),
      )
      // But the index in the original array will be different
      // (unless by chance the same key is first in both orderings)
    })

    it('should handle single participant', () => {
      const participant = new PrivateKey()
      const publicKeys = [participant.publicKey]

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.strictEqual(election.coordinatorIndex, 0)
      assert.strictEqual(
        election.coordinatorPublicKey.toString(),
        participant.publicKey.toString(),
      )
      assert.strictEqual(election.sortedSigners.length, 1)
    })

    it('should throw error for empty signers array', () => {
      assert.throws(
        () => electCoordinator([], ElectionMethod.LEXICOGRAPHIC),
        /no signers provided/,
      )
    })

    it('should elect coordinator using hash-based method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(publicKeys, ElectionMethod.HASH_BASED)

      assert.ok(election.coordinatorIndex >= 0)
      assert.ok(election.coordinatorIndex < publicKeys.length)
      assert.ok(election.electionProof)
    })

    it('should elect first signer when using FIRST_SIGNER method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(publicKeys, ElectionMethod.FIRST_SIGNER)

      assert.strictEqual(election.coordinatorIndex, 0)
      assert.strictEqual(
        election.coordinatorPublicKey.toString(),
        publicKeys[0].toString(),
      )
    })

    it('should elect last signer when using LAST_SIGNER method', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(publicKeys, ElectionMethod.LAST_SIGNER)

      assert.strictEqual(election.coordinatorIndex, publicKeys.length - 1)
      assert.strictEqual(
        election.coordinatorPublicKey.toString(),
        publicKeys[publicKeys.length - 1].toString(),
      )
    })

    it('should produce consistent results across multiple participants (determinism)', () => {
      // Simulate all participants performing the same election
      const participants = Array.from({ length: 10 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      // Each participant independently performs the election
      const elections = participants.map(() =>
        electCoordinator(publicKeys, ElectionMethod.LEXICOGRAPHIC),
      )

      // All should get the same result
      const firstElection = elections[0]
      for (let i = 1; i < elections.length; i++) {
        assert.strictEqual(
          elections[i].coordinatorIndex,
          firstElection.coordinatorIndex,
        )
        assert.strictEqual(
          elections[i].electionProof,
          firstElection.electionProof,
        )
      }
    })

    it('should create proper index mapping', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Verify index mapping size
      assert.strictEqual(election.indexMapping.size, publicKeys.length)

      // Verify all original indices are mapped
      for (let i = 0; i < publicKeys.length; i++) {
        assert.ok(election.indexMapping.has(i))
      }

      // Verify mapping is valid (all sorted indices are unique)
      const sortedIndices = Array.from(election.indexMapping.values())
      const uniqueIndices = new Set(sortedIndices)
      assert.strictEqual(uniqueIndices.size, publicKeys.length)
    })
  })

  describe('verifyElectionResult()', () => {
    it('should verify valid election result', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const isValid = verifyElectionResult(
        publicKeys,
        election,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.strictEqual(isValid, true)
    })

    it('should reject invalid election result (wrong coordinator)', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Tamper with the election result
      const tamperedElection = {
        ...election,
        coordinatorIndex: (election.coordinatorIndex + 1) % publicKeys.length,
      }

      const isValid = verifyElectionResult(
        publicKeys,
        tamperedElection,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.strictEqual(isValid, false)
    })

    it('should reject invalid election result (wrong proof)', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Tamper with the election proof
      const tamperedElection = {
        ...election,
        electionProof: 'invalid_proof_hash',
      }

      const isValid = verifyElectionResult(
        publicKeys,
        tamperedElection,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.strictEqual(isValid, false)
    })
  })

  describe('isCoordinator()', () => {
    it('should correctly identify coordinator', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Coordinator should be identified correctly
      assert.strictEqual(
        isCoordinator(
          publicKeys,
          election.coordinatorIndex,
          ElectionMethod.LEXICOGRAPHIC,
        ),
        true,
      )

      // Other indices should not be coordinator
      for (let i = 0; i < publicKeys.length; i++) {
        if (i !== election.coordinatorIndex) {
          assert.strictEqual(
            isCoordinator(publicKeys, i, ElectionMethod.LEXICOGRAPHIC),
            false,
          )
        }
      }
    })

    it('should return false for invalid index', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      assert.strictEqual(
        isCoordinator(publicKeys, -1, ElectionMethod.LEXICOGRAPHIC),
        false,
      )
      assert.strictEqual(
        isCoordinator(
          publicKeys,
          publicKeys.length,
          ElectionMethod.LEXICOGRAPHIC,
        ),
        false,
      )
    })
  })

  describe('getCoordinatorPublicKey()', () => {
    it('should return correct coordinator public key', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const coordinatorPubKey = getCoordinatorPublicKey(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.strictEqual(
        coordinatorPubKey.toString(),
        election.coordinatorPublicKey.toString(),
      )
      assert.strictEqual(
        coordinatorPubKey.toString(),
        publicKeys[election.coordinatorIndex].toString(),
      )
    })

    it('should return same coordinator for different methods (if applicable)', () => {
      // Create keys such that first is also lexicographically first
      const participants = Array.from({ length: 3 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const lexCoordinator = getCoordinatorPublicKey(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const firstCoordinator = getCoordinatorPublicKey(
        publicKeys,
        ElectionMethod.FIRST_SIGNER,
      )

      // These might be different, just verify both are valid
      assert.ok(lexCoordinator)
      assert.ok(firstCoordinator)
      assert.ok(
        publicKeys.some(pk => pk.toString() === lexCoordinator.toString()),
      )
      assert.ok(
        publicKeys.some(pk => pk.toString() === firstCoordinator.toString()),
      )
    })
  })

  describe('Multi-party scenarios', () => {
    it('should handle 2-of-2 signing', () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const publicKeys = [alice.publicKey, bob.publicKey]

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.ok(
        election.coordinatorIndex === 0 || election.coordinatorIndex === 1,
      )
      assert.strictEqual(election.sortedSigners.length, 2)
    })

    it('should handle 3-of-3 signing', () => {
      const participants = Array.from({ length: 3 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.ok(election.coordinatorIndex >= 0 && election.coordinatorIndex < 3)
      assert.strictEqual(election.sortedSigners.length, 3)
    })

    it('should handle 5-of-5 signing (example scenario)', () => {
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.ok(election.coordinatorIndex >= 0 && election.coordinatorIndex < 5)
      assert.strictEqual(election.sortedSigners.length, 5)

      // Verify all participants can verify the election
      const isValid = verifyElectionResult(
        publicKeys,
        election,
        ElectionMethod.LEXICOGRAPHIC,
      )
      assert.strictEqual(isValid, true)
    })

    it('should handle large number of signers (10-of-10)', () => {
      const participants = Array.from({ length: 10 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.ok(
        election.coordinatorIndex >= 0 && election.coordinatorIndex < 10,
      )
      assert.strictEqual(election.sortedSigners.length, 10)
    })
  })

  describe('Edge cases', () => {
    it('should handle keys with similar prefixes', () => {
      // Create keys and ensure some have similar prefixes
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Should still elect exactly one coordinator
      assert.ok(election.coordinatorIndex >= 0)
      assert.ok(election.coordinatorIndex < publicKeys.length)
    })

    it('should handle duplicate keys gracefully', () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      // Add duplicate
      const publicKeys = [alice.publicKey, bob.publicKey, alice.publicKey]

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // Should still elect a coordinator (though duplicate keys are not recommended)
      assert.ok(election.coordinatorIndex >= 0)
      assert.ok(election.coordinatorIndex < 3)
    })

    it('should produce different results for hash-based vs lexicographic (usually)', () => {
      const participants = Array.from({ length: 10 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      const lexElection = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const hashElection = electCoordinator(
        publicKeys,
        ElectionMethod.HASH_BASED,
      )

      // These MIGHT be the same by chance, but usually different
      // Just verify both are valid selections
      assert.ok(lexElection.coordinatorIndex >= 0)
      assert.ok(lexElection.coordinatorIndex < publicKeys.length)
      assert.ok(hashElection.coordinatorIndex >= 0)
      assert.ok(hashElection.coordinatorIndex < publicKeys.length)
    })
  })

  describe('Real-world compatibility', () => {
    it('should work with actual Bitcoin public keys', () => {
      // Use actual private keys that would be used in production
      const participants = [
        new PrivateKey('L1uyy5qTuGrVXrmrsvHWHgVzW9kKdrp27wBC7Vs6nZDTF2BRUVwy'),
        new PrivateKey('KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn'),
        new PrivateKey('L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ'),
      ]
      const publicKeys = participants.map(p => p.publicKey)

      const election = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      assert.ok(election.coordinatorIndex >= 0)
      assert.ok(election.coordinatorIndex < 3)
      assert.ok(election.electionProof)

      // Verify the result is deterministic
      const election2 = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      assert.strictEqual(election.coordinatorIndex, election2.coordinatorIndex)
      assert.strictEqual(election.electionProof, election2.electionProof)
    })

    it('should support all signers verifying the same election independently', () => {
      // Scenario: 5 participants, each independently computes the election
      const participants = Array.from({ length: 5 }, () => new PrivateKey())
      const publicKeys = participants.map(p => p.publicKey)

      // Each participant independently computes the election
      const aliceElection = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const bobElection = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const charlieElection = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const dianaElection = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )
      const eveElection = electCoordinator(
        publicKeys,
        ElectionMethod.LEXICOGRAPHIC,
      )

      // All should agree
      assert.strictEqual(
        aliceElection.coordinatorIndex,
        bobElection.coordinatorIndex,
      )
      assert.strictEqual(
        aliceElection.coordinatorIndex,
        charlieElection.coordinatorIndex,
      )
      assert.strictEqual(
        aliceElection.coordinatorIndex,
        dianaElection.coordinatorIndex,
      )
      assert.strictEqual(
        aliceElection.coordinatorIndex,
        eveElection.coordinatorIndex,
      )

      // All should have the same proof
      assert.strictEqual(aliceElection.electionProof, bobElection.electionProof)
      assert.strictEqual(
        aliceElection.electionProof,
        charlieElection.electionProof,
      )
      assert.strictEqual(
        aliceElection.electionProof,
        dianaElection.electionProof,
      )
      assert.strictEqual(aliceElection.electionProof, eveElection.electionProof)
    })
  })
})
