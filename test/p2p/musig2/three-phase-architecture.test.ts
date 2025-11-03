/**
 * MuSig2 Three-Phase Architecture Tests
 *
 * Tests for the new three-phase discovery and coordination architecture:
 * - Phase 0: Signer Advertisement
 * - Phase 1: Matchmaking & Discovery
 * - Phase 2: Signing Request Creation
 * - Phase 3: Dynamic Session Building
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { MuSig2P2PCoordinator } from '../../../lib/p2p/musig2/coordinator.js'
import { PrivateKey } from '../../../lib/bitcore/privatekey.js'
import { waitForEvent } from '../../../lib/p2p/utils.js'
import {
  SignerAdvertisement,
  SigningRequest,
  MuSig2Event,
  TransactionType,
} from '../../../lib/p2p/musig2/types.js'

describe('MuSig2 Three-Phase Architecture', () => {
  describe('Phase 0: Signer Advertisement', () => {
    let coordinator: MuSig2P2PCoordinator
    let aliceKey: PrivateKey
    let bobKey: PrivateKey

    before(async () => {
      coordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await coordinator.start()

      aliceKey = new PrivateKey()
      bobKey = new PrivateKey()
    })

    after(async () => {
      if (coordinator) {
        await coordinator.stop()
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should advertise signer availability', async () => {
      const eventPromise = waitForEvent<SignerAdvertisement>(
        coordinator,
        'signer:advertised',
      )

      await coordinator.advertiseSigner(
        aliceKey,
        {
          transactionTypes: [TransactionType.SPEND, TransactionType.SWAP],
          minAmount: 1_000_000, // 1 XPI
          maxAmount: 100_000_000, // 100 XPI
        },
        {
          ttl: 24 * 60 * 60 * 1000,
          metadata: {
            nickname: 'AliceWallet',
            fees: 0,
          },
        },
      )

      const advertisement = await eventPromise
      assert.ok(advertisement)
      assert.strictEqual(advertisement.peerId, coordinator.peerId)
      assert.strictEqual(
        advertisement.publicKey.toString(),
        aliceKey.publicKey.toString(),
      )
      assert.ok(
        advertisement.criteria.transactionTypes.includes(TransactionType.SPEND),
      )
      assert.ok(
        advertisement.criteria.transactionTypes.includes(TransactionType.SWAP),
      )
      assert.strictEqual(advertisement.metadata?.nickname, 'AliceWallet')
      assert.ok(advertisement.signature)
      assert.ok(advertisement.signature.length === 64) // Schnorr signature
    })

    it('should filter signers by transaction type', async () => {
      // Advertise Alice for spend transactions
      await coordinator.advertiseSigner(aliceKey, {
        transactionTypes: [TransactionType.SPEND],
      })

      // Advertise Bob for swap transactions only
      await coordinator.advertiseSigner(bobKey, {
        transactionTypes: [TransactionType.SWAP],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Find spend signers
      const spendSigners = await coordinator.findAvailableSigners({
        transactionType: TransactionType.SPEND,
      })

      assert.ok(spendSigners.length >= 1)
      assert.ok(
        spendSigners.some(
          s => s.publicKey.toString() === aliceKey.publicKey.toString(),
        ),
      )
      assert.ok(
        !spendSigners.some(
          s => s.publicKey.toString() === bobKey.publicKey.toString(),
        ),
      )

      // Find swap signers
      const swapSigners = await coordinator.findAvailableSigners({
        transactionType: TransactionType.SWAP,
      })

      assert.ok(swapSigners.length >= 1)
      assert.ok(
        swapSigners.some(
          s => s.publicKey.toString() === bobKey.publicKey.toString(),
        ),
      )
    })

    it('should filter signers by amount range', async () => {
      // Advertise Alice for small amounts
      await coordinator.advertiseSigner(aliceKey, {
        transactionTypes: [TransactionType.SPEND],
        minAmount: 1_000_000,
        maxAmount: 10_000_000,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Find signers for large amount (should exclude Alice)
      const largeAmountSigners = await coordinator.findAvailableSigners({
        transactionType: TransactionType.SPEND,
        minAmount: 50_000_000,
      })

      assert.ok(
        !largeAmountSigners.some(
          s => s.publicKey.toString() === aliceKey.publicKey.toString(),
        ),
      )

      // Find signers for small amount (should include Alice)
      const smallAmountSigners = await coordinator.findAvailableSigners({
        transactionType: TransactionType.SPEND,
        maxAmount: 5_000_000,
      })

      assert.ok(
        smallAmountSigners.some(
          s => s.publicKey.toString() === aliceKey.publicKey.toString(),
        ),
      )
    })

    it('should withdraw advertisement', async () => {
      await coordinator.advertiseSigner(aliceKey, {
        transactionTypes: [TransactionType.SPEND],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const beforeSigners = await coordinator.findAvailableSigners({
        transactionType: TransactionType.SPEND,
      })
      assert.ok(beforeSigners.length > 0)

      const eventPromise = waitForEvent(
        coordinator,
        MuSig2Event.SIGNER_WITHDRAWN,
      )

      await coordinator.withdrawAdvertisement()
      await eventPromise

      await new Promise(resolve => setTimeout(resolve, 100))

      const afterSigners = await coordinator.findAvailableSigners({
        transactionType: TransactionType.SPEND,
      })

      // Alice should no longer be in results
      assert.ok(
        !afterSigners.some(
          s => s.publicKey.toString() === aliceKey.publicKey.toString(),
        ),
      )
    })
  })

  describe('Phase 1-2: Matchmaking and Signing Request', () => {
    let creatorCoordinator: MuSig2P2PCoordinator
    let aliceCoordinator: MuSig2P2PCoordinator
    let bobCoordinator: MuSig2P2PCoordinator

    let creatorKey: PrivateKey
    let aliceKey: PrivateKey
    let bobKey: PrivateKey

    before(async () => {
      creatorKey = new PrivateKey()
      aliceKey = new PrivateKey()
      bobKey = new PrivateKey()

      // Create coordinators
      creatorCoordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      aliceCoordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      bobCoordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await Promise.all([
        creatorCoordinator.start(),
        aliceCoordinator.start(),
        bobCoordinator.start(),
      ])

      // Connect peers
      const creatorAddrs = creatorCoordinator.getStats().multiaddrs
      await Promise.all([
        aliceCoordinator.connectToPeer(creatorAddrs[0]),
        bobCoordinator.connectToPeer(creatorAddrs[0]),
      ])

      await new Promise(resolve => setTimeout(resolve, 500))
    })

    after(async () => {
      await Promise.all([
        creatorCoordinator?.stop(),
        aliceCoordinator?.stop(),
        bobCoordinator?.stop(),
      ])
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should create signing request with discovered signers', async () => {
      // Phase 0: Alice and Bob advertise
      await Promise.all([
        aliceCoordinator.advertiseSigner(aliceKey, {
          transactionTypes: [TransactionType.SPEND],
        }),
        bobCoordinator.advertiseSigner(bobKey, {
          transactionTypes: [TransactionType.SPEND],
        }),
      ])

      await new Promise(resolve => setTimeout(resolve, 200))

      // Phase 1: Creator discovers available signers
      const availableSigners = await creatorCoordinator.findAvailableSigners({
        transactionType: TransactionType.SPEND,
        maxResults: 2,
      })

      assert.ok(availableSigners.length >= 2)

      // Phase 2: Create signing request with discovered keys
      const requiredKeys = [
        creatorKey.publicKey,
        availableSigners[0].publicKey,
        availableSigners[1].publicKey,
      ]

      const message = Buffer.from('test transaction', 'utf8')

      const eventPromise = waitForEvent<SigningRequest>(
        creatorCoordinator,
        'signing-request:created',
      )

      const requestId = await creatorCoordinator.announceSigningRequest(
        requiredKeys,
        message,
        creatorKey,
        {
          metadata: {
            amount: 5_000_000,
            transactionType: TransactionType.SPEND,
            description: 'Test spend (3-of-3, all must sign)',
          },
        },
      )

      const request = await eventPromise

      assert.ok(requestId)
      assert.strictEqual(request.requestId, requestId)
      assert.strictEqual(request.requiredPublicKeys.length, 3)
      // MuSig2 = n-of-n, all 3 must sign (no threshold)
      assert.ok(request.creatorSignature)
      assert.ok(request.creatorSignature.length === 64)
    })

    it('should reject signing request if creator not in required keys', async () => {
      const requiredKeys = [aliceKey.publicKey, bobKey.publicKey]
      const message = Buffer.from('test', 'utf8')

      await assert.rejects(
        async () => {
          await creatorCoordinator.announceSigningRequest(
            requiredKeys,
            message,
            creatorKey, // Not in required keys!
          )
        },
        {
          message: 'Creator must be one of the required signers',
        },
      )
    })
  })

  describe('Phase 3: Dynamic Session Building', () => {
    let creatorCoordinator: MuSig2P2PCoordinator
    let aliceCoordinator: MuSig2P2PCoordinator
    let bobCoordinator: MuSig2P2PCoordinator

    let creatorKey: PrivateKey
    let aliceKey: PrivateKey
    let bobKey: PrivateKey

    before(async () => {
      creatorKey = new PrivateKey()
      aliceKey = new PrivateKey()
      bobKey = new PrivateKey()

      creatorCoordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      aliceCoordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      bobCoordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await Promise.all([
        creatorCoordinator.start(),
        aliceCoordinator.start(),
        bobCoordinator.start(),
      ])

      // Connect peers in mesh topology
      const creatorAddrs = creatorCoordinator.getStats().multiaddrs
      const aliceAddrs = aliceCoordinator.getStats().multiaddrs

      await Promise.all([
        aliceCoordinator.connectToPeer(creatorAddrs[0]),
        bobCoordinator.connectToPeer(creatorAddrs[0]),
        bobCoordinator.connectToPeer(aliceAddrs[0]),
      ])

      await new Promise(resolve => setTimeout(resolve, 500))
    })

    after(async () => {
      await Promise.all([
        creatorCoordinator?.stop(),
        aliceCoordinator?.stop(),
        bobCoordinator?.stop(),
      ])
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should discover signing requests needing my key', async () => {
      // Advertise so we can discover each other
      await Promise.all([
        aliceCoordinator.advertiseSigner(aliceKey, {
          transactionTypes: [TransactionType.SPEND],
        }),
        bobCoordinator.advertiseSigner(bobKey, {
          transactionTypes: [TransactionType.SPEND],
        }),
      ])

      await new Promise(resolve => setTimeout(resolve, 200))

      // Creator creates request
      const requiredKeys = [
        creatorKey.publicKey,
        aliceKey.publicKey,
        bobKey.publicKey,
      ]
      const message = Buffer.from('test transaction', 'utf8')

      const requestId = await creatorCoordinator.announceSigningRequest(
        requiredKeys,
        message,
        creatorKey,
      )

      await new Promise(resolve => setTimeout(resolve, 300))

      // Alice discovers she's needed
      const aliceRequests = await aliceCoordinator.findSigningRequestsForMe(
        aliceKey.publicKey,
      )

      assert.ok(aliceRequests.length > 0)
      assert.ok(aliceRequests.some(r => r.requestId === requestId))

      // Bob discovers he's needed
      const bobRequests = await bobCoordinator.findSigningRequestsForMe(
        bobKey.publicKey,
      )

      assert.ok(bobRequests.length > 0)
      assert.ok(bobRequests.some(r => r.requestId === requestId))
    })

    it('should join signing request and build session dynamically', async () => {
      // Advertise
      await Promise.all([
        aliceCoordinator.advertiseSigner(aliceKey, {
          transactionTypes: [TransactionType.SPEND],
        }),
        bobCoordinator.advertiseSigner(bobKey, {
          transactionTypes: [TransactionType.SPEND],
        }),
      ])

      await new Promise(resolve => setTimeout(resolve, 200))

      // Create request (MuSig2 = 3-of-3, all must join)
      const requiredKeys = [
        creatorKey.publicKey,
        aliceKey.publicKey,
        bobKey.publicKey,
      ]
      const message = Buffer.from('dynamic build test', 'utf8')

      const requestId = await creatorCoordinator.announceSigningRequest(
        requiredKeys,
        message,
        creatorKey,
      )

      await new Promise(resolve => setTimeout(resolve, 300))

      // Alice joins
      const aliceJoinPromise = waitForEvent(
        aliceCoordinator,
        'signing-request:joined',
      )

      await aliceCoordinator.joinSigningRequest(requestId, aliceKey)

      await aliceJoinPromise

      await new Promise(resolve => setTimeout(resolve, 300))

      // Bob joins - all participants now joined (3-of-3 for MuSig2)
      const bobJoinPromise = waitForEvent(
        bobCoordinator,
        'signing-request:joined',
      )

      const creatorReadyPromise = waitForEvent(
        creatorCoordinator,
        'session:ready',
      )
      const aliceReadyPromise = waitForEvent(
        aliceCoordinator,
        MuSig2Event.SESSION_READY,
      )
      const bobReadyPromise = waitForEvent(
        bobCoordinator,
        MuSig2Event.SESSION_READY,
      )

      await bobCoordinator.joinSigningRequest(requestId, bobKey)

      await bobJoinPromise

      // Wait for session ready event on all nodes (all 3 must be ready)
      await Promise.all([
        creatorReadyPromise,
        aliceReadyPromise,
        bobReadyPromise,
      ])

      const readySessionId = await creatorReadyPromise

      assert.strictEqual(readySessionId, requestId)
    })

    it('should reject join if key not required', async () => {
      const requiredKeys = [creatorKey.publicKey, aliceKey.publicKey]
      const message = Buffer.from('test', 'utf8')

      const requestId = await creatorCoordinator.announceSigningRequest(
        requiredKeys,
        message,
        creatorKey,
      )

      await new Promise(resolve => setTimeout(resolve, 200))

      // Bob tries to join but his key is not required
      await assert.rejects(
        async () => {
          await bobCoordinator.joinSigningRequest(requestId, bobKey)
        },
        {
          message: /not required/,
        },
      )
    })

    it('should verify creator signature on request', async () => {
      const requiredKeys = [creatorKey.publicKey, aliceKey.publicKey]
      const message = Buffer.from('test', 'utf8')

      const requestId = await creatorCoordinator.announceSigningRequest(
        requiredKeys,
        message,
        creatorKey,
      )

      await new Promise(resolve => setTimeout(resolve, 200))

      // Alice verifies and joins successfully
      await assert.doesNotReject(async () => {
        await aliceCoordinator.joinSigningRequest(requestId, aliceKey)
      })
    })
  })

  describe('End-to-End Three-Phase Flow', () => {
    let creatorCoordinator: MuSig2P2PCoordinator
    let aliceCoordinator: MuSig2P2PCoordinator
    let bobCoordinator: MuSig2P2PCoordinator

    let creatorKey: PrivateKey
    let aliceKey: PrivateKey
    let bobKey: PrivateKey

    before(async () => {
      creatorKey = new PrivateKey()
      aliceKey = new PrivateKey()
      bobKey = new PrivateKey()

      creatorCoordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      aliceCoordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      bobCoordinator = new MuSig2P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
      })

      await Promise.all([
        creatorCoordinator.start(),
        aliceCoordinator.start(),
        bobCoordinator.start(),
      ])

      // Full mesh connectivity
      const creatorAddrs = creatorCoordinator.getStats().multiaddrs
      const aliceAddrs = aliceCoordinator.getStats().multiaddrs

      await Promise.all([
        aliceCoordinator.connectToPeer(creatorAddrs[0]),
        bobCoordinator.connectToPeer(creatorAddrs[0]),
        bobCoordinator.connectToPeer(aliceAddrs[0]),
      ])

      await new Promise(resolve => setTimeout(resolve, 500))
    })

    after(async () => {
      await Promise.all([
        creatorCoordinator?.stop(),
        aliceCoordinator?.stop(),
        bobCoordinator?.stop(),
      ])
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('should complete full three-phase flow', async () => {
      // PHASE 0: Wallets advertise availability
      await Promise.all([
        aliceCoordinator.advertiseSigner(
          aliceKey,
          {
            transactionTypes: [TransactionType.SPEND],
            minAmount: 1_000_000,
            maxAmount: 100_000_000,
          },
          {
            metadata: {
              nickname: 'AliceWallet',
            },
          },
        ),
        bobCoordinator.advertiseSigner(
          bobKey,
          {
            transactionTypes: [TransactionType.SPEND, TransactionType.SWAP],
            minAmount: 1_000_000,
            maxAmount: 50_000_000,
          },
          {
            metadata: {
              nickname: 'BobWallet',
            },
          },
        ),
      ])

      await new Promise(resolve => setTimeout(resolve, 300))

      // PHASE 1: Creator discovers available signers
      const availableSigners = await creatorCoordinator.findAvailableSigners({
        transactionType: TransactionType.SPEND,
        minAmount: 5_000_000,
        maxResults: 10,
      })

      assert.ok(availableSigners.length >= 2)
      console.log(`Found ${availableSigners.length} available signers`)

      // Select 2 signers
      const selectedSigners = availableSigners.slice(0, 2)

      // PHASE 2: Create signing request with discovered keys
      const requiredKeys = [
        creatorKey.publicKey,
        ...selectedSigners.map(s => s.publicKey),
      ]

      const message = Buffer.from('Full flow test transaction', 'utf8')

      const requestId = await creatorCoordinator.announceSigningRequest(
        requiredKeys,
        message,
        creatorKey,
        {
          metadata: {
            amount: 5_000_000,
            transactionType: TransactionType.SPEND,
            description: 'Test spend transaction (3-of-3, all must sign)',
          },
        },
      )

      assert.ok(requestId)

      await new Promise(resolve => setTimeout(resolve, 300))

      // PHASE 3: Participants discover and join
      // Set up event listeners
      const creatorReadyPromise = waitForEvent(
        creatorCoordinator,
        'session:ready',
      )
      const aliceReadyPromise = waitForEvent(
        aliceCoordinator,
        MuSig2Event.SESSION_READY,
      )
      const bobReadyPromise = waitForEvent(
        bobCoordinator,
        MuSig2Event.SESSION_READY,
      )

      // Alice discovers she's needed and joins
      const aliceRequests = await aliceCoordinator.findSigningRequestsForMe(
        aliceKey.publicKey,
      )

      const aliceRequest = aliceRequests.find(r => r.requestId === requestId)
      assert.ok(aliceRequest)

      await aliceCoordinator.joinSigningRequest(requestId, aliceKey)

      await new Promise(resolve => setTimeout(resolve, 300))

      // Bob discovers he's needed and joins
      const bobRequests = await bobCoordinator.findSigningRequestsForMe(
        bobKey.publicKey,
      )

      const bobRequest = bobRequests.find(r => r.requestId === requestId)
      assert.ok(bobRequest)

      await bobCoordinator.joinSigningRequest(requestId, bobKey)

      // Wait for session ready on all participants
      await Promise.all([
        creatorReadyPromise,
        aliceReadyPromise,
        bobReadyPromise,
      ])

      console.log('✅ Three-phase flow complete - Session ready for signing')
    })
  })
})
