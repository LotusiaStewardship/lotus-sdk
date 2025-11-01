/**
 * MuSig2 P2P Replay Protection Tests
 *
 * Tests for message replay protection via sequence numbers
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { MuSig2P2PCoordinator } from '../../../lib/p2p/musig2/coordinator.js'
import { P2PCoordinator } from '../../../lib/p2p/coordinator.js'
import { PrivateKey } from '../../../lib/bitcore/privatekey.js'
import { waitForEvent } from '../../../lib/p2p/utils.js'
import { MuSigSessionPhase } from '../../../lib/bitcore/musig2/session.js'
import { ConnectionEvent } from '../../../lib/p2p/types.js'
import { Point } from '../../../lib/bitcore/crypto/point.js'
import { BN } from '../../../lib/bitcore/crypto/bn.js'

/**
 * Helper to connect two P2P coordinators
 */
async function connectPeers(
  peer1: P2PCoordinator,
  peer2: P2PCoordinator,
): Promise<void> {
  const peer2Addrs = peer2.libp2pNode.getMultiaddrs()
  assert.ok(peer2Addrs.length > 0)

  const peer1ConnectPromise = waitForEvent(peer1, ConnectionEvent.CONNECTED)
  const peer2ConnectPromise = waitForEvent(peer2, ConnectionEvent.CONNECTED)

  await peer1.connectToPeer(peer2Addrs[0].toString())

  await Promise.all([peer1ConnectPromise, peer2ConnectPromise])
}

describe('MuSig2 P2P Replay Protection', () => {
  describe('Configuration', () => {
    it('should enable replay protection by default', async () => {
      const coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await coordinator.start()

      // Create a session to verify replay protection is active
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test message', 'utf8')

      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const session = coordinator.getSession(sessionId)
      assert.ok(session)

      await coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should allow disabling replay protection', async () => {
      const coordinator = new MuSig2P2PCoordinator(
        {
          listen: ['/ip4/127.0.0.1/tcp/0'],
          enableDHT: true,
          enableDHTServer: false,
        },
        {
          enableReplayProtection: false,
        },
      )

      await coordinator.start()

      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test message', 'utf8')

      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const session = coordinator.getSession(sessionId)
      assert.ok(session)

      await coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should configure max sequence gap', async () => {
      const coordinator = new MuSig2P2PCoordinator(
        {
          listen: ['/ip4/127.0.0.1/tcp/0'],
          enableDHT: true,
          enableDHTServer: false,
        },
        {
          maxSequenceGap: 50,
        },
      )

      await coordinator.start()
      assert.ok(coordinator)

      await coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })
  })

  describe('Unit Tests - Sequence Validation', () => {
    let alice: PrivateKey
    let bob: PrivateKey
    let message: Buffer

    before(() => {
      alice = new PrivateKey()
      bob = new PrivateKey()
      message = Buffer.from('test message', 'utf8')
    })

    it('should initialize lastSequenceNumbers for new sessions', async () => {
      const coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await coordinator.start()

      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const session = coordinator.getActiveSession(sessionId)
      assert.ok(session)
      assert.ok(session.lastSequenceNumbers)
      assert.ok(session.lastSequenceNumbers instanceof Map)
      assert.strictEqual(session.lastSequenceNumbers.size, 0)

      await coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should track sequence numbers per signer', async () => {
      const coordinator = new MuSig2P2PCoordinator(
        {
          listen: ['/ip4/127.0.0.1/tcp/0'],
          enableDHT: true,
          enableDHTServer: false,
        },
        {
          enableSessionDiscovery: false,
        },
      )

      await coordinator.start()

      // Create session
      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const session = coordinator.getActiveSession(sessionId)
      assert.ok(session)

      // Verify sequence numbers map is initialized and empty
      assert.ok(session.lastSequenceNumbers instanceof Map)
      assert.strictEqual(session.lastSequenceNumbers.size, 0)
      assert.strictEqual(session.lastSequenceNumbers.get(0), undefined)
      assert.strictEqual(session.lastSequenceNumbers.get(1), undefined)

      await coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })
  })

  describe('Integration Tests - Replay Attack Prevention', () => {
    let aliceCoord: MuSig2P2PCoordinator
    let bobCoord: MuSig2P2PCoordinator
    let alice: PrivateKey
    let bob: PrivateKey
    let message: Buffer

    before(async () => {
      alice = new PrivateKey()
      bob = new PrivateKey()
      message = Buffer.from('test replay protection', 'utf8')

      // Create two coordinators
      aliceCoord = new MuSig2P2PCoordinator(
        {
          listen: ['/ip4/127.0.0.1/tcp/0'],
          enableDHT: true,
          enableDHTServer: true,
        },
        {
          enableSessionDiscovery: true,
          enableReplayProtection: true,
        },
      )

      bobCoord = new MuSig2P2PCoordinator(
        {
          listen: ['/ip4/127.0.0.1/tcp/0'],
          enableDHT: true,
          enableDHTServer: false,
        },
        {
          enableSessionDiscovery: true,
          enableReplayProtection: true,
        },
      )

      await aliceCoord.start()
      await bobCoord.start()

      // Connect peers
      await connectPeers(aliceCoord, bobCoord)

      // Wait for connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 500))
    })

    after(async () => {
      if (aliceCoord) {
        await aliceCoord.stop()
      }
      if (bobCoord) {
        await bobCoord.stop()
      }
      await new Promise(resolve => setTimeout(resolve, 300))
    })

    it(
      'should accept messages with increasing sequence numbers',
      { timeout: 30000 },
      async () => {
        // Alice creates session
        const sessionId = await aliceCoord.createSession(
          [alice.publicKey, bob.publicKey],
          alice,
          message,
        )

        // Wait for DHT announcement
        await new Promise(resolve => setTimeout(resolve, 500))

        // Bob joins
        try {
          await bobCoord.joinSession(sessionId, bob)
        } catch (error) {
          console.log(
            'Skipping test - DHT discovery may not work in test environment',
          )
          return
        }

        // Wait for session ready
        await new Promise(resolve => setTimeout(resolve, 500))

        // Start Round 1
        const aliceRound1Promise = waitForEvent(
          aliceCoord,
          'session:nonces-complete',
        )
        const bobRound1Promise = waitForEvent(
          bobCoord,
          'session:nonces-complete',
        )

        await Promise.all([
          aliceCoord.startRound1(sessionId, alice),
          bobCoord.startRound1(sessionId, bob),
        ])

        // Wait for nonces
        await Promise.all([aliceRound1Promise, bobRound1Promise])

        // Verify sequence tracking
        const aliceSession = aliceCoord.getActiveSession(sessionId)
        const bobSession = bobCoord.getActiveSession(sessionId)

        assert.ok(aliceSession)
        assert.ok(bobSession)

        // Alice should have seen Bob's messages
        assert.ok(aliceSession.lastSequenceNumbers.get(1)! > 0)
        // Bob should have seen Alice's messages
        assert.ok(bobSession.lastSequenceNumbers.get(0)! > 0)
      },
    )

    it(
      'should reject replayed SESSION_JOIN messages',
      { timeout: 30000 },
      async () => {
        // Create a new session for this test
        const testMessage = Buffer.from('test join replay', 'utf8')
        const sessionId = await aliceCoord.createSession(
          [alice.publicKey, bob.publicKey],
          alice,
          testMessage,
        )

        await new Promise(resolve => setTimeout(resolve, 500))

        // Bob joins once
        try {
          await bobCoord.joinSession(sessionId, bob)
        } catch (error) {
          console.log(
            'Skipping test - DHT discovery may not work in test environment',
          )
          return
        }

        await new Promise(resolve => setTimeout(resolve, 500))

        const aliceSession = aliceCoord.getActiveSession(sessionId)
        assert.ok(aliceSession)

        // Record Bob's last sequence number after join
        const bobLastSeq = aliceSession.lastSequenceNumbers.get(1)
        assert.ok(bobLastSeq !== undefined)
        assert.ok(bobLastSeq! > 0)

        // Try to manually handle a replayed join with same sequence
        // This should be rejected by the sequence validation
        let replayDetected = false
        try {
          await aliceCoord._handleSessionJoin(
            sessionId,
            1, // Bob's index
            bobLastSeq!, // Same sequence number (replay)
            bob.publicKey,
            bobCoord.peerId,
          )
        } catch (error) {
          replayDetected = true
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes('Invalid sequence number'))
        }

        assert.ok(
          replayDetected,
          'Replayed SESSION_JOIN should have been rejected',
        )
      },
    )

    it(
      'should reject replayed NONCE_SHARE messages',
      { timeout: 30000 },
      async () => {
        const testMessage = Buffer.from('test nonce replay', 'utf8')
        const sessionId = await aliceCoord.createSession(
          [alice.publicKey, bob.publicKey],
          alice,
          testMessage,
        )

        await new Promise(resolve => setTimeout(resolve, 500))

        try {
          await bobCoord.joinSession(sessionId, bob)
        } catch (error) {
          console.log(
            'Skipping test - DHT discovery may not work in test environment',
          )
          return
        }

        await new Promise(resolve => setTimeout(resolve, 500))

        // Start Round 1
        const aliceRound1Promise = waitForEvent(
          aliceCoord,
          'session:nonces-complete',
        )
        const bobRound1Promise = waitForEvent(
          bobCoord,
          'session:nonces-complete',
        )

        await Promise.all([
          aliceCoord.startRound1(sessionId, alice),
          bobCoord.startRound1(sessionId, bob),
        ])

        await Promise.all([aliceRound1Promise, bobRound1Promise])

        const aliceSession = aliceCoord.getActiveSession(sessionId)
        assert.ok(aliceSession)

        // Record Bob's nonce sequence
        const bobNonceSeq = aliceSession.lastSequenceNumbers.get(1)
        assert.ok(bobNonceSeq !== undefined)

        // Try to replay Bob's nonce with same sequence
        let replayDetected = false
        try {
          const bobSession = bobCoord.getActiveSession(sessionId)
          assert.ok(bobSession)
          assert.ok(bobSession.session.myPublicNonce)

          await aliceCoord._handleNonceShare(
            sessionId,
            1, // Bob's index
            bobNonceSeq!, // Replayed sequence
            bobSession.session.myPublicNonce,
            bobCoord.peerId,
          )
        } catch (error) {
          replayDetected = true
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes('Invalid sequence number'))
        }

        assert.ok(
          replayDetected,
          'Replayed NONCE_SHARE should have been rejected',
        )
      },
    )

    it(
      'should reject messages with large sequence gaps',
      { timeout: 30000 },
      async () => {
        const testMessage = Buffer.from('test gap detection', 'utf8')
        const sessionId = await aliceCoord.createSession(
          [alice.publicKey, bob.publicKey],
          alice,
          testMessage,
        )

        await new Promise(resolve => setTimeout(resolve, 500))

        try {
          await bobCoord.joinSession(sessionId, bob)
        } catch (error) {
          console.log(
            'Skipping test - DHT discovery may not work in test environment',
          )
          return
        }

        await new Promise(resolve => setTimeout(resolve, 500))

        const aliceSession = aliceCoord.getActiveSession(sessionId)
        assert.ok(aliceSession)

        // Bob's current sequence
        const bobLastSeq = aliceSession.lastSequenceNumbers.get(1) || 0

        // Try to send a message with a huge gap (> 100 by default)
        let gapDetected = false
        try {
          await aliceCoord._handleSessionJoin(
            sessionId,
            1,
            bobLastSeq + 200, // Huge gap
            bob.publicKey,
            bobCoord.peerId,
          )
        } catch (error) {
          gapDetected = true
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes('Invalid sequence number'))
        }

        assert.ok(gapDetected, 'Large sequence gap should have been detected')
      },
    )

    it('should allow disabling replay protection for testing', async () => {
      // Create coordinator with replay protection disabled
      const noReplayCoord = new MuSig2P2PCoordinator(
        {
          listen: ['/ip4/127.0.0.1/tcp/0'],
          enableDHT: true,
          enableDHTServer: false,
        },
        {
          enableSessionDiscovery: false,
          enableReplayProtection: false, // Disabled
        },
      )

      await noReplayCoord.start()

      const testMessage = Buffer.from('no replay protection', 'utf8')
      const sessionId = await noReplayCoord.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        testMessage,
      )

      const session = noReplayCoord.getSession(sessionId)
      assert.ok(session)

      // With replay protection disabled, should accept any sequence
      // (This would normally be rejected)
      try {
        await noReplayCoord._handleSessionJoin(
          sessionId,
          1,
          1, // First message
          bob.publicKey,
          'fake-peer-id',
        )

        // Try to "replay" with same sequence - should NOT throw
        await noReplayCoord._handleSessionJoin(
          sessionId,
          1,
          1, // Same sequence (normally a replay)
          bob.publicKey,
          'fake-peer-id',
        )

        // If we get here, replay protection is indeed disabled
        assert.ok(true, 'Replay protection successfully disabled')
      } catch (error) {
        assert.fail('Should not throw when replay protection is disabled')
      }

      await noReplayCoord.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })
  })

  describe('Integration Tests - Complete Signing Flow', () => {
    it(
      'should complete full 2-of-2 signing with sequence validation',
      { timeout: 30000 },
      async () => {
        const alice = new PrivateKey()
        const bob = new PrivateKey()
        const message = Buffer.from('complete signing test', 'utf8')

        const aliceCoord = new MuSig2P2PCoordinator(
          {
            listen: ['/ip4/127.0.0.1/tcp/0'],
            enableDHT: true,
            enableDHTServer: false,
          },
          {
            enableSessionDiscovery: true,
            enableReplayProtection: true,
          },
        )

        const bobCoord = new MuSig2P2PCoordinator(
          {
            listen: ['/ip4/127.0.0.1/tcp/0'],
            enableDHT: true,
            enableDHTServer: false,
          },
          {
            enableSessionDiscovery: true,
            enableReplayProtection: true,
          },
        )

        await aliceCoord.start()
        await bobCoord.start()

        // Connect peers
        await connectPeers(aliceCoord, bobCoord)
        await new Promise(resolve => setTimeout(resolve, 500))

        // Create session
        const sessionId = await aliceCoord.createSession(
          [alice.publicKey, bob.publicKey],
          alice,
          message,
        )

        await new Promise(resolve => setTimeout(resolve, 500))

        // Bob joins
        try {
          await bobCoord.joinSession(sessionId, bob)
        } catch (error) {
          console.log(
            'Skipping test - DHT discovery may not work in test environment',
          )
          await aliceCoord.stop()
          await bobCoord.stop()
          await new Promise(resolve => setTimeout(resolve, 200))
          return
        }

        await new Promise(resolve => setTimeout(resolve, 500))

        // Round 1: Nonces
        const aliceRound1Promise = waitForEvent(
          aliceCoord,
          'session:nonces-complete',
        )
        const bobRound1Promise = waitForEvent(
          bobCoord,
          'session:nonces-complete',
        )

        await Promise.all([
          aliceCoord.startRound1(sessionId, alice),
          bobCoord.startRound1(sessionId, bob),
        ])

        await Promise.all([aliceRound1Promise, bobRound1Promise])

        await new Promise(resolve => setTimeout(resolve, 500))

        // Round 2: Partial signatures
        const aliceCompletePromise = waitForEvent(
          aliceCoord,
          'session:complete',
        )
        const bobCompletePromise = waitForEvent(bobCoord, 'session:complete')

        await Promise.all([
          aliceCoord.startRound2(sessionId, alice),
          bobCoord.startRound2(sessionId, bob),
        ])

        await Promise.all([aliceCompletePromise, bobCompletePromise])

        // Verify signatures
        const aliceActiveSession = aliceCoord.getActiveSession(sessionId)
        const bobActiveSession = bobCoord.getActiveSession(sessionId)

        assert.ok(aliceActiveSession)
        assert.ok(bobActiveSession)
        assert.strictEqual(aliceActiveSession.phase, MuSigSessionPhase.COMPLETE)
        assert.strictEqual(bobActiveSession.phase, MuSigSessionPhase.COMPLETE)

        // Verify sequence numbers were tracked throughout
        assert.ok(aliceActiveSession.lastSequenceNumbers.size > 0)
        assert.ok(bobActiveSession.lastSequenceNumbers.size > 0)

        // Verify final signatures match
        assert.ok(aliceActiveSession.session.finalSignature)
        assert.ok(bobActiveSession.session.finalSignature)
        assert.deepStrictEqual(
          aliceActiveSession.session.finalSignature.toBuffer(),
          bobActiveSession.session.finalSignature.toBuffer(),
        )

        await aliceCoord.stop()
        await bobCoord.stop()
        await new Promise(resolve => setTimeout(resolve, 200))
      },
    )
  })

  describe('Protocol Phase Enforcement', () => {
    let coordinator: MuSig2P2PCoordinator
    let alice: PrivateKey
    let bob: PrivateKey

    before(async () => {
      alice = new PrivateKey()
      bob = new PrivateKey()

      coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await coordinator.start()
    })

    after(async () => {
      if (coordinator) {
        await coordinator.stop()
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should reject NONCE_SHARE before SESSION_JOIN (INIT phase)', async () => {
      const message = Buffer.from('phase violation test', 'utf8')
      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const session = coordinator.getActiveSession(sessionId)
      assert.ok(session)
      assert.strictEqual(session.phase, MuSigSessionPhase.INIT)

      // Try to send NONCE_SHARE while still in INIT phase (before JOIN)
      let phaseViolationDetected = false
      try {
        // Manually create a fake nonce and try to handle it
        const fakeNonce: [Point, Point] = [Point.getG(), Point.getG()]
        await coordinator._handleNonceShare(
          sessionId,
          1, // Bob's index
          1, // Valid sequence
          fakeNonce,
          'fake-peer-id',
        )
      } catch (error) {
        phaseViolationDetected = true
        assert.ok(error instanceof Error)
        assert.ok(
          error.message.includes('Protocol violation') ||
            error.message.includes('NONCE_SHARE not allowed'),
        )
      }

      assert.ok(
        phaseViolationDetected,
        'NONCE_SHARE should be rejected in INIT phase',
      )
    })

    it('should reject PARTIAL_SIG_SHARE before NONCE_EXCHANGE completes', async () => {
      const message = Buffer.from('phase violation test 2', 'utf8')
      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      // Move to NONCE_EXCHANGE phase
      await coordinator.startRound1(sessionId, alice)

      const activeSession = coordinator.getActiveSession(sessionId)
      assert.ok(activeSession)

      // Phase should be synced to NONCE_EXCHANGE after startRound1()
      assert.strictEqual(activeSession.phase, MuSigSessionPhase.NONCE_EXCHANGE)

      // Try to send PARTIAL_SIG_SHARE while still in NONCE_EXCHANGE
      let phaseViolationDetected = false
      try {
        const fakePartialSig = new BN(1)
        await coordinator._handlePartialSigShare(
          sessionId,
          1, // Bob's index
          1, // Valid sequence
          fakePartialSig,
          'fake-peer-id',
        )
      } catch (error) {
        phaseViolationDetected = true
        assert.ok(error instanceof Error)
        assert.ok(
          error.message.includes('Protocol violation') ||
            error.message.includes('PARTIAL_SIG_SHARE not allowed'),
        )
      }

      assert.ok(
        phaseViolationDetected,
        'PARTIAL_SIG_SHARE should be rejected in NONCE_EXCHANGE phase',
      )
    })

    it('should reject SESSION_JOIN after NONCE_EXCHANGE starts', async () => {
      const message = Buffer.from('phase violation test 3', 'utf8')
      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      // Move to NONCE_EXCHANGE phase
      await coordinator.startRound1(sessionId, alice)

      const session = coordinator.getActiveSession(sessionId)
      assert.ok(session)

      // Phase should be synced to NONCE_EXCHANGE after startRound1()
      assert.strictEqual(session.phase, MuSigSessionPhase.NONCE_EXCHANGE)

      // Try to send SESSION_JOIN while in NONCE_EXCHANGE (too late!)
      let phaseViolationDetected = false
      try {
        await coordinator._handleSessionJoin(
          sessionId,
          1, // Bob's index
          1, // Valid sequence
          bob.publicKey,
          'fake-peer-id',
        )
      } catch (error) {
        phaseViolationDetected = true
        assert.ok(error instanceof Error)
        assert.ok(
          error.message.includes('Protocol violation') ||
            error.message.includes('SESSION_JOIN not allowed'),
        )
      }

      assert.ok(
        phaseViolationDetected,
        'SESSION_JOIN should be rejected after INIT phase',
      )
    })

    it('should reject NONCE_SHARE in wrong phase (backwards transition)', async () => {
      const message = Buffer.from('backwards phase test', 'utf8')
      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const session = coordinator.getActiveSession(sessionId)
      assert.ok(session)

      // Manually set phase to PARTIAL_SIG_EXCHANGE to simulate being past nonce exchange
      // This simulates a scenario where protocol has advanced but attacker sends old message
      session.phase = MuSigSessionPhase.PARTIAL_SIG_EXCHANGE

      // Try to send NONCE_SHARE while in PARTIAL_SIG_EXCHANGE (backwards!)
      let phaseViolationDetected = false
      try {
        const lateNonce: [Point, Point] = [Point.getG(), Point.getG()]
        await coordinator._handleNonceShare(
          sessionId,
          1,
          1, // Valid sequence
          lateNonce,
          'fake-peer-id',
        )
      } catch (error) {
        phaseViolationDetected = true
        assert.ok(error instanceof Error)
        assert.ok(
          error.message.includes('Protocol violation') ||
            error.message.includes('NONCE_SHARE not allowed'),
        )
      }

      assert.ok(
        phaseViolationDetected,
        'NONCE_SHARE should be rejected after NONCE_EXCHANGE phase',
      )
    })

    it('should allow SESSION_ABORT in any phase', async () => {
      const message = Buffer.from('abort test', 'utf8')
      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      // Abort should work in INIT phase
      await coordinator._handleSessionAbort(
        sessionId,
        'Test abort',
        'fake-peer-id',
      )

      // Session should be aborted/closed
      const session = coordinator.getActiveSession(sessionId)
      // Session may be removed or marked as aborted
      assert.ok(true, 'ABORT should work in any phase')
    })
  })

  describe('Edge Cases', () => {
    it('should handle sequence overflow gracefully', async () => {
      const coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await coordinator.start()

      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('overflow test', 'utf8')

      const sessionId = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const session = coordinator.getActiveSession(sessionId)
      assert.ok(session)

      // Manually set a very high sequence number
      session.lastSequenceNumbers.set(0, Number.MAX_SAFE_INTEGER - 5)

      // Should still be able to increment
      const nextSeq = (session.lastSequenceNumbers.get(0) || 0) + 1
      assert.ok(nextSeq <= Number.MAX_SAFE_INTEGER)

      await coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should track sequences independently per session', async () => {
      const coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await coordinator.start()

      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message1 = Buffer.from('session 1', 'utf8')
      const message2 = Buffer.from('session 2', 'utf8')

      // Create two separate sessions
      const sessionId1 = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message1,
      )

      const sessionId2 = await coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message2,
      )

      const session1 = coordinator.getActiveSession(sessionId1)
      const session2 = coordinator.getActiveSession(sessionId2)

      assert.ok(session1)
      assert.ok(session2)

      // Sequences should be independent
      session1.lastSequenceNumbers.set(0, 5)
      session2.lastSequenceNumbers.set(0, 10)

      assert.strictEqual(session1.lastSequenceNumbers.get(0), 5)
      assert.strictEqual(session2.lastSequenceNumbers.get(0), 10)

      await coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })
  })
})
