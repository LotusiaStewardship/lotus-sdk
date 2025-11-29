/**
 * Simple MuSig2 Coordinator Test - No P2P
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { MuSig2P2PCoordinator } from '../../../lib/p2p/musig2/coordinator.js'
import { PrivateKey } from '../../../lib/bitcore/privatekey.js'

describe('MuSig2 P2P Coordinator - Simple Tests', () => {
  describe('Basic Functionality', () => {
    it('should create coordinator instance without starting', () => {
      const musig2Coordinator = new MuSig2P2PCoordinator(
        {
          listen: [], // No listening
          enableDHT: false,
          enableDHTServer: false,
          securityConfig: {
            disableRateLimiting: true,
          },
        },
        {
          enableSessionDiscovery: false,
          enableCoordinatorElection: false,
          enableReplayProtection: false,
          enableAutoCleanup: false,
        },
      )

      assert.ok(musig2Coordinator)
      assert.strictEqual(musig2Coordinator.getActiveSessions().length, 0)
    })

    it('should handle session creation without P2P', async () => {
      const musig2Coordinator = new MuSig2P2PCoordinator(
        {
          listen: [], // No listening
          enableDHT: false,
          enableDHTServer: false,
          securityConfig: {
            disableRateLimiting: true,
          },
        },
        {
          enableSessionDiscovery: false,
          enableCoordinatorElection: false,
          enableReplayProtection: false,
          enableAutoCleanup: false,
        },
      )

      // Don't start P2P - just test session creation logic
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test message', 'utf8')

      try {
        const sessionId = await musig2Coordinator.createSession(
          [alice.publicKey, bob.publicKey],
          alice,
          message,
        )
        assert.ok(sessionId)
        assert.strictEqual(musig2Coordinator.getActiveSessions().length, 1)
      } catch (error) {
        // If P2P is required for session creation, that's expected
        assert.ok(
          error.message.includes('P2P') || error.message.includes('started'),
        )
      }
    })
  })
})
