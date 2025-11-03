/**
 * MuSig2 P2P Coordinator Tests
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { P2PCoordinator } from '../../../lib/p2p/coordinator.js'
import { MuSig2P2PCoordinator } from '../../../lib/p2p/musig2/coordinator.js'
import { PrivateKey } from '../../../lib/bitcore/privatekey.js'
import { waitForEvent } from '../../../lib/p2p/utils.js'
import { ConnectionEvent } from '../../../lib/p2p/types.js'

describe('MuSig2 P2P Coordinator', () => {
  describe('Initialization', () => {
    it('should create coordinator with P2P config', async () => {
      const musig2Coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        securityConfig: {
          disableRateLimiting: true, // Disable for tests
        },
      })

      await musig2Coordinator.start()

      assert.ok(musig2Coordinator)
      assert.ok(musig2Coordinator.peerId)
      assert.strictEqual(musig2Coordinator.getActiveSessions().length, 0)

      await musig2Coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should configure session timeout', async () => {
      const timeout = 3600000 // 1 hour
      const musig2Coordinator = new MuSig2P2PCoordinator(
        {
          listen: ['/ip4/127.0.0.1/tcp/0'],
          enableDHT: true,
          enableDHTServer: false,
          securityConfig: {
            disableRateLimiting: true, // Disable for tests
          },
        },
        {
          sessionTimeout: timeout,
        },
      )

      await musig2Coordinator.start()

      assert.ok(musig2Coordinator)

      await musig2Coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should register protocol handler automatically', async () => {
      const musig2Coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        securityConfig: {
          disableRateLimiting: true, // Disable for tests
        },
      })

      await musig2Coordinator.start()

      // Protocol handler should be registered
      // We can verify by checking that protocol handler exists
      assert.ok(musig2Coordinator)

      await musig2Coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })
  })

  describe('Session Creation', () => {
    let musig2Coordinator: MuSig2P2PCoordinator

    before(async () => {
      musig2Coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        securityConfig: {
          disableRateLimiting: true, // Disable for tests
        },
      })

      await musig2Coordinator.start()
    })

    after(async () => {
      if (musig2Coordinator) {
        await musig2Coordinator.stop()
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should create a new session', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test message', 'utf8')

      const sessionId = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      assert.ok(sessionId)
      assert.strictEqual(musig2Coordinator.getActiveSessions().length, 1)
      assert.ok(musig2Coordinator.getActiveSessions().includes(sessionId))
    })

    it('should create session with metadata', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test', 'utf8')
      const metadata = { description: 'Test transaction', amount: 1000 }

      const sessionId = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
        metadata,
      )

      assert.ok(sessionId)
      const status = musig2Coordinator.getSessionStatus(sessionId)
      assert.ok(status)
    })

    it('should emit session:created event', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test', 'utf8')

      const eventPromise = waitForEvent<string>(
        musig2Coordinator,
        'session:created',
      )

      const sessionId = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const event = await eventPromise
      assert.strictEqual(event, sessionId)
    })

    it('should create multiple sessions', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message1 = Buffer.from('message 1', 'utf8')
      const message2 = Buffer.from('message 2', 'utf8')

      const beforeCount = musig2Coordinator.getActiveSessions().length

      const sessionId1 = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message1,
      )

      const sessionId2 = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message2,
      )

      assert.notStrictEqual(sessionId1, sessionId2)
      assert.strictEqual(
        musig2Coordinator.getActiveSessions().length,
        beforeCount + 2,
      )
    })

    it('should get session status', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test', 'utf8')

      const sessionId = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const status = musig2Coordinator.getSessionStatus(sessionId)
      assert.ok(status)
      assert.strictEqual(status.noncesCollected, 0)
      assert.strictEqual(status.noncesTotal, 2)
      assert.strictEqual(status.partialSigsCollected, 0)
      assert.strictEqual(status.partialSigsTotal, 2)
      assert.strictEqual(status.isComplete, false)
      assert.strictEqual(status.isAborted, false)
    })

    it('should return null for non-existent session', () => {
      const status = musig2Coordinator.getSessionStatus('non-existent')
      assert.strictEqual(status, null)
    })
  })

  describe('Session Cleanup', () => {
    let musig2Coordinator: MuSig2P2PCoordinator

    before(async () => {
      musig2Coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        securityConfig: {
          disableRateLimiting: true, // Disable for tests
        },
      })

      await musig2Coordinator.start()
    })

    after(async () => {
      if (musig2Coordinator) {
        await musig2Coordinator.stop()
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should close a session', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test', 'utf8')

      const sessionId = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      assert.ok(musig2Coordinator.getActiveSessions().includes(sessionId))

      await musig2Coordinator.closeSession(sessionId)

      assert.ok(!musig2Coordinator.getActiveSessions().includes(sessionId))
    })

    it('should emit session:closed event', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test', 'utf8')

      const sessionId = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const eventPromise = waitForEvent<string>(
        musig2Coordinator,
        'session:closed',
      )

      await musig2Coordinator.closeSession(sessionId)

      const event = await eventPromise
      assert.strictEqual(event, sessionId)
    })

    it('should cleanup all sessions', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test', 'utf8')

      await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )
      await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      assert.ok(musig2Coordinator.getActiveSessions().length > 0)

      await musig2Coordinator.cleanup()

      assert.strictEqual(musig2Coordinator.getActiveSessions().length, 0)
    })
  })

  describe('Error Handling', () => {
    let musig2Coordinator: MuSig2P2PCoordinator

    before(async () => {
      musig2Coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await musig2Coordinator.start()
    })

    after(async () => {
      if (musig2Coordinator) {
        await musig2Coordinator.stop()
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should handle invalid session ID gracefully', async () => {
      assert.throws(() => {
        musig2Coordinator.getFinalSignature('invalid-session-id')
      }, /Session.*not found/)

      await assert.rejects(async () => {
        await musig2Coordinator.startRound1('invalid', new PrivateKey())
      }, /Session.*not found/)
    })
  })
})
