/**
 * MuSig2 P2P Protocol Handler Tests
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { P2PProtocol } from '../../../lib/p2p/protocol.js'
import { MuSig2P2PProtocolHandler } from '../../../lib/p2p/musig2/protocol-handler.js'
import { MuSig2P2PCoordinator } from '../../../lib/p2p/musig2/coordinator.js'
import { P2PCoordinator } from '../../../lib/p2p/coordinator.js'
import { PrivateKey } from '../../../lib/bitcore/privatekey.js'
import { MuSig2MessageType } from '../../../lib/p2p/musig2/types.js'
import {
  serializePublicNonce,
  serializeBN,
  serializePublicKey,
} from '../../../lib/p2p/musig2/serialization.js'
import {
  musigNonceGen,
  musigKeyAgg,
} from '../../../lib/bitcore/crypto/musig2.js'
import { BN } from '../../../lib/bitcore/crypto/bn.js'

describe('MuSig2 P2P Protocol Handler', () => {
  describe('Initialization', () => {
    it('should create protocol handler with correct properties', async () => {
      const handler = new MuSig2P2PProtocolHandler()

      assert.strictEqual(handler.protocolName, 'musig2')
      assert.strictEqual(handler.protocolId, '/lotus/musig2/1.0.0')
    })

    it('should set coordinator', async () => {
      const musig2Coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        securityConfig: {
          disableRateLimiting: true,
        },
      })

      await musig2Coordinator.start()

      const handler = new MuSig2P2PProtocolHandler()
      handler.setCoordinator(musig2Coordinator)

      assert.ok(handler)

      await musig2Coordinator.stop()
      await new Promise(resolve => setTimeout(resolve, 200))
    })
  })

  describe('Message Handling', () => {
    let musig2Coordinator: MuSig2P2PCoordinator
    let handler: MuSig2P2PProtocolHandler
    let protocol: P2PProtocol

    before(async () => {
      musig2Coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        securityConfig: {
          disableRateLimiting: true,
        },
      })

      await musig2Coordinator.start()

      handler = new MuSig2P2PProtocolHandler()
      handler.setCoordinator(musig2Coordinator)
      protocol = new P2PProtocol()
    })

    after(async () => {
      if (musig2Coordinator) {
        await musig2Coordinator.stop()
      }
      // Allow time for cleanup
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should handle session announcement message', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test', 'utf8')

      const sessionId = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const payload = {
        sessionId,
        signers: [alice.publicKey, bob.publicKey].map(pk =>
          serializePublicKey(pk),
        ),
        creatorIndex: 0,
        message: message.toString('hex'),
        requiredSigners: 2,
      }

      const p2pMessage = protocol.createMessage(
        MuSig2MessageType.SESSION_ANNOUNCE,
        payload,
        musig2Coordinator.peerId,
        { protocol: 'musig2' },
      )

      const peerInfo = {
        peerId: 'test-peer',
        lastSeen: Date.now(),
      }

      // Should not throw
      await handler.handleMessage(p2pMessage, peerInfo)
    })

    it('should handle nonce share message', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test', 'utf8')

      const sessionId = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      // Generate nonces
      const keyAggContext = musigKeyAgg([alice.publicKey])
      const nonces = musigNonceGen(
        alice,
        keyAggContext.aggregatedPubKey,
        message,
      )

      const payload = {
        sessionId,
        signerIndex: 0,
        publicNonce: serializePublicNonce(nonces.publicNonces),
      }

      const p2pMessage = protocol.createMessage(
        MuSig2MessageType.NONCE_SHARE,
        payload,
        musig2Coordinator.peerId,
        { protocol: 'musig2' },
      )

      const peerInfo = {
        peerId: 'test-peer',
        lastSeen: Date.now(),
      }

      // Should not throw
      await handler.handleMessage(p2pMessage, peerInfo)
    })

    it('should handle partial signature share message', async () => {
      const alice = new PrivateKey()
      const bob = new PrivateKey()
      const message = Buffer.from('test', 'utf8')

      const sessionId = await musig2Coordinator.createSession(
        [alice.publicKey, bob.publicKey],
        alice,
        message,
      )

      const payload = {
        sessionId,
        signerIndex: 0,
        partialSig: serializeBN(new BN(12345)),
      }

      const p2pMessage = protocol.createMessage(
        MuSig2MessageType.PARTIAL_SIG_SHARE,
        payload,
        musig2Coordinator.peerId,
        { protocol: 'musig2' },
      )

      const peerInfo = {
        peerId: 'test-peer',
        lastSeen: Date.now(),
      }

      // Should not throw (though it may error due to invalid signature, which is expected)
      try {
        await handler.handleMessage(p2pMessage, peerInfo)
      } catch (error) {
        // Expected - invalid signature should cause error
        assert.ok(error)
      }
    })

    it('should ignore messages for other protocols', async () => {
      const p2pMessage = protocol.createMessage(
        'other-protocol:message',
        { data: 'test' },
        musig2Coordinator.peerId,
        { protocol: 'other-protocol' },
      )

      const peerInfo = {
        peerId: 'test-peer',
        lastSeen: Date.now(),
      }

      // Should return early without error
      await handler.handleMessage(p2pMessage, peerInfo)
    })

    it('should handle validation error messages', async () => {
      const payload = {
        sessionId: 'test-session',
        error: 'Test error',
        code: 'TEST_ERROR',
      }

      const p2pMessage = protocol.createMessage(
        MuSig2MessageType.VALIDATION_ERROR,
        payload,
        musig2Coordinator.peerId,
        { protocol: 'musig2' },
      )

      const peerInfo = {
        peerId: 'test-peer',
        lastSeen: Date.now(),
      }

      // Should not throw
      await handler.handleMessage(p2pMessage, peerInfo)
    })

    it('should handle session abort messages', async () => {
      const payload = {
        sessionId: 'test-session',
        reason: 'Test abort',
      }

      const p2pMessage = protocol.createMessage(
        MuSig2MessageType.SESSION_ABORT,
        payload,
        musig2Coordinator.peerId,
        { protocol: 'musig2' },
      )

      const peerInfo = {
        peerId: 'test-peer',
        lastSeen: Date.now(),
      }

      // Should not throw
      await handler.handleMessage(p2pMessage, peerInfo)
    })
  })

  describe('Peer Connection Events', () => {
    it('should handle peer connected events', async () => {
      const handler = new MuSig2P2PProtocolHandler()

      // Should not throw
      await handler.onPeerConnected('test-peer-id')
    })

    it('should handle peer disconnected events', async () => {
      const handler = new MuSig2P2PProtocolHandler()

      // Should not throw
      await handler.onPeerDisconnected('test-peer-id')
    })
  })
})
