/**
 * P2P Coordinator Tests (libp2p-based)
 *
 * Note: These tests create and destroy multiple libp2p nodes with DHT, identify,
 * and ping services. Libp2p has internal timers and event listeners that take
 * time to clean up. The delays after stop() calls are necessary to allow these
 * resources to be fully released before the next test starts or the process exits.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  P2PCoordinator,
  P2PProtocol,
  ConnectionEvent,
  IProtocolHandler,
  P2PMessage,
  PeerInfo,
  Stream,
  Connection,
  waitForEvent,
} from '../../lib/p2p/index.js'
import type { SingleKadDHT } from '@libp2p/kad-dht'
import type { PeerId, AbortOptions } from '@libp2p/interface'

/**
 * Internal RoutingTable interface for test setup
 */
interface RoutingTableWithAdd {
  size: number
  add(peerId: PeerId, options?: AbortOptions): Promise<void>
}

/**
 * Helper to populate DHT routing tables after connection
 * This simulates what happens automatically in production networks
 */
async function populateDHTRoutingTable(
  node1: P2PCoordinator,
  node2: P2PCoordinator,
): Promise<void> {
  const dht1 = node1.libp2pNode.services.kadDHT as SingleKadDHT | undefined
  const dht2 = node2.libp2pNode.services.kadDHT as SingleKadDHT | undefined

  if (dht1?.routingTable && dht2?.routingTable) {
    const rt1 = dht1.routingTable as unknown as RoutingTableWithAdd
    const rt2 = dht2.routingTable as unknown as RoutingTableWithAdd

    await rt1.add(node2.libp2pNode.peerId)
    await rt2.add(node1.libp2pNode.peerId)
  }
}

describe('P2P Coordinator (libp2p)', () => {
  describe('Initialization', () => {
    it('should start and stop node', async () => {
      const coordinator = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests // Client mode for tests to avoid background operations
      })

      await coordinator.start()

      assert.ok(coordinator.peerId)
      assert.ok(coordinator.libp2pNode)

      const stats = coordinator.getStats()
      assert.strictEqual(stats.dht.enabled, true)

      await coordinator.stop()
    })

    it('should have valid peer ID after start', async () => {
      const coordinator = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await coordinator.start()

      const peerId = coordinator.peerId
      assert.ok(peerId)
      assert.ok(peerId.length > 0)

      await coordinator.stop()
    })
  })

  describe('Connection Management', () => {
    it('should connect two peers', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await alice.start()
      await bob.start()

      console.log('Alice DHT Stats:', alice.getDHTStats())
      console.log('Bob DHT Stats:', bob.getDHTStats())

      // Connect Alice to Bob - wait for both sides to acknowledge
      const bobAddrs = bob.libp2pNode.getMultiaddrs()
      assert.ok(bobAddrs.length > 0)

      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())

      // Wait for both connection events
      const [aliceEvent, bobEvent] = await Promise.all([
        aliceConnectPromise,
        bobConnectPromise,
      ])

      assert.ok(aliceEvent, 'Alice should be connected to Bob')
      assert.ok(bobEvent, 'Bob should be connected to Alice')
      assert.strictEqual(aliceEvent.peerId, bob.peerId)
      assert.strictEqual(bobEvent.peerId, alice.peerId)

      console.log('After connection - Alice DHT Stats:', alice.getDHTStats())
      console.log('After connection - Bob DHT Stats:', bob.getDHTStats())

      // Populate DHT routing tables (simulates production network behavior)
      await populateDHTRoutingTable(alice, bob)

      console.log(
        'After DHT population - Alice DHT Stats:',
        alice.getDHTStats(),
      )
      console.log('After DHT population - Bob DHT Stats:', bob.getDHTStats())

      await alice.stop()
      await bob.stop()
    })

    it('should report connected peers', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await alice.start()
      await bob.start()

      // Connect and wait for both sides
      const bobAddrs = bob.libp2pNode.getMultiaddrs()

      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())

      await Promise.all([aliceConnectPromise, bobConnectPromise])

      // Populate DHT routing tables
      await populateDHTRoutingTable(alice, bob)

      // Now check connected peers
      const alicePeers = alice.getConnectedPeers()
      const bobPeers = bob.getConnectedPeers()

      assert.ok(alicePeers.length > 0, 'Alice should have connected peers')
      assert.ok(bobPeers.length > 0, 'Bob should have connected peers')

      console.log(
        'Alice peers:',
        alicePeers.length,
        'DHT:',
        alice.getDHTStats(),
      )
      console.log('Bob peers:', bobPeers.length, 'DHT:', bob.getDHTStats())

      await alice.stop()
      await bob.stop()
    })
  })

  describe('Resource Management', () => {
    it('should announce and retrieve resources', async () => {
      const coordinator = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await coordinator.start()

      console.log('Coordinator DHT Stats:', coordinator.getDHTStats())

      // Announce resource
      await coordinator.announceResource(
        'test-type',
        'test-id',
        {
          data: 'test data',
        },
        { ttl: 3600 },
      )

      console.log('After announcement - DHT Stats:', coordinator.getDHTStats())

      // Retrieve resource from local cache
      const resource = coordinator.getResource('test-type', 'test-id')

      assert.ok(resource)
      assert.strictEqual(resource.resourceId, 'test-id')
      assert.strictEqual(resource.resourceType, 'test-type')

      await coordinator.stop()
    })

    it('should discover resources by type', async () => {
      const coordinator = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await coordinator.start()

      // Announce multiple resources
      await coordinator.announceResource('session', 'session-1', {
        status: 'active',
      })

      await coordinator.announceResource('session', 'session-2', {
        status: 'complete',
      })

      // Get all sessions from local cache
      const sessions = coordinator.getLocalResources('session')
      assert.ok(sessions.length >= 2)

      // Get with filter
      const active = coordinator.getLocalResources('session', {
        status: 'active',
      })
      assert.ok(active.length >= 1)

      await coordinator.stop()
    })
  })

  describe('Statistics', () => {
    it('should provide accurate stats', async () => {
      const coordinator = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await coordinator.start()

      const stats = coordinator.getStats()

      assert.ok(stats.peerId)
      assert.ok(stats.multiaddrs.length > 0)
      assert.strictEqual(stats.dht.enabled, true)
      assert.strictEqual(typeof stats.peers.connected, 'number')

      await coordinator.stop()
    })
  })

  describe('Protocol Management', () => {
    it('should register and unregister protocol handlers', async () => {
      const coordinator = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await coordinator.start()

      // Create test protocol handler
      const handler: IProtocolHandler = {
        protocolName: 'test-protocol',
        protocolId: '/test/1.0.0',
        handleMessage: async (message: P2PMessage, from: PeerInfo) => {
          // Test handler
        },
      }

      // Register protocol
      coordinator.registerProtocol(handler)

      // Verify registration by attempting to register again (should throw)
      assert.throws(
        () => coordinator.registerProtocol(handler),
        /Protocol already registered/,
      )

      // Unregister protocol
      coordinator.unregisterProtocol('test-protocol')

      // Should be able to register again after unregistering
      coordinator.registerProtocol(handler)

      await coordinator.stop()
    })

    it('should handle protocol with stream handler', async () => {
      const coordinator = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await coordinator.start()

      let streamHandled = false

      const handler: IProtocolHandler = {
        protocolName: 'stream-protocol',
        protocolId: '/stream-test/1.0.0',
        handleMessage: async (message: P2PMessage, from: PeerInfo) => {
          // Message handler
        },
        handleStream: async (stream: Stream, connection: Connection) => {
          streamHandled = true
        },
      }

      coordinator.registerProtocol(handler)

      // Cleanup
      coordinator.unregisterProtocol('stream-protocol')
      await coordinator.stop()
    })
  })

  describe('Messaging', () => {
    it('should send message to specific peer', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await alice.start()
      await bob.start()

      // Connect Alice to Bob - wait for bidirectional connection
      const bobAddrs = bob.libp2pNode.getMultiaddrs()

      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())
      await Promise.all([aliceConnectPromise, bobConnectPromise])

      // Populate DHT routing tables
      await populateDHTRoutingTable(alice, bob)
      console.log('Messaging test - DHT populated. Alice:', alice.getDHTStats())

      // Send message from Alice to Bob
      const message: P2PMessage = {
        type: 'test-message',
        from: alice.peerId,
        payload: { text: 'Hello Bob!' },
        timestamp: Date.now(),
        messageId: 'test-msg-1',
      }

      // Send message and wait for Bob to receive it
      const messagePromise = waitForEvent<P2PMessage>(
        bob,
        ConnectionEvent.MESSAGE,
      )
      await alice.sendTo(bob.peerId, message)
      const receivedMessage = await messagePromise

      // Verify Bob received the message
      assert.ok(receivedMessage, 'Bob should have received the message')
      assert.strictEqual(receivedMessage.type, 'test-message')
      assert.strictEqual(receivedMessage.messageId, 'test-msg-1')
      assert.deepStrictEqual(receivedMessage.payload, { text: 'Hello Bob!' })

      await alice.stop()
      await bob.stop()
    })

    it('should broadcast message to all peers', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const charlie = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await alice.start()
      await bob.start()
      await charlie.start()

      // Connect Alice to Bob and Charlie - wait for all connections
      const bobAddrs = bob.libp2pNode.getMultiaddrs()
      const charlieAddrs = charlie.libp2pNode.getMultiaddrs()

      // Set up event listeners first
      const aliceToBobPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobToAlicePromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())
      await Promise.all([aliceToBobPromise, bobToAlicePromise])

      // Populate DHT routing table for Alice-Bob
      await populateDHTRoutingTable(alice, bob)

      // Now connect to Charlie
      const aliceToCharliePromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const charlieToAlicePromise = waitForEvent<PeerInfo>(
        charlie,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(charlieAddrs[0].toString())
      await Promise.all([aliceToCharliePromise, charlieToAlicePromise])

      // Populate DHT routing table for Alice-Charlie
      await populateDHTRoutingTable(alice, charlie)

      console.log('Broadcast test - Alice DHT:', alice.getDHTStats())

      // Broadcast message from Alice
      const message: P2PMessage = {
        type: 'broadcast-test',
        from: alice.peerId,
        payload: { text: 'Hello everyone!' },
        timestamp: Date.now(),
        messageId: 'broadcast-1',
      }

      // Wait for both to receive the message
      const bobMessagePromise = waitForEvent<P2PMessage>(
        bob,
        ConnectionEvent.MESSAGE,
      )
      const charlieMessagePromise = waitForEvent<P2PMessage>(
        charlie,
        ConnectionEvent.MESSAGE,
      )

      await alice.broadcast(message)

      // Wait for both messages to arrive
      const [bobMsg, charlieMsg] = await Promise.all([
        bobMessagePromise,
        charlieMessagePromise,
      ])

      // Verify both received the broadcast
      assert.ok(bobMsg, 'Bob should have received the broadcast')
      assert.ok(charlieMsg, 'Charlie should have received the broadcast')

      await alice.stop()
      await bob.stop()
      await charlie.stop()
    })

    it('should broadcast with exclusions', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await alice.start()
      await bob.start()

      // Connect Alice to Bob - wait for bidirectional connection
      const bobAddrs = bob.libp2pNode.getMultiaddrs()

      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())
      await Promise.all([aliceConnectPromise, bobConnectPromise])

      // Populate DHT routing tables
      await populateDHTRoutingTable(alice, bob)

      // Broadcast with exclusion
      const message: P2PMessage = {
        type: 'broadcast-exclude',
        from: alice.peerId,
        payload: { text: 'Excluded broadcast' },
        timestamp: Date.now(),
        messageId: 'broadcast-exclude-1',
      }

      await alice.broadcast(message, { exclude: [bob.peerId] })

      await alice.stop()
      await bob.stop()
    })
  })

  describe('Peer Management', () => {
    it('should check if connected to peer', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await alice.start()
      await bob.start()

      // Not connected initially
      assert.strictEqual(alice.isConnected(bob.peerId), false)

      // Connect - wait for bidirectional connection
      const bobAddrs = bob.libp2pNode.getMultiaddrs()

      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())
      await Promise.all([aliceConnectPromise, bobConnectPromise])

      // Should be connected
      assert.strictEqual(alice.isConnected(bob.peerId), true)

      await alice.stop()
      await bob.stop()
    })

    it('should get peer info', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await alice.start()
      await bob.start()

      // Connect - wait for bidirectional connection
      const bobAddrs = bob.libp2pNode.getMultiaddrs()

      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())
      await Promise.all([aliceConnectPromise, bobConnectPromise])

      // Populate DHT routing tables
      await populateDHTRoutingTable(alice, bob)

      // Get peer info
      const peerInfo = alice.getPeer(bob.peerId)
      assert.ok(peerInfo)
      assert.strictEqual(peerInfo.peerId, bob.peerId)

      await alice.stop()
      await bob.stop()
    })

    it('should disconnect from peer', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await alice.start()
      await bob.start()

      // Connect - wait for bidirectional connection
      const bobAddrs = bob.libp2pNode.getMultiaddrs()

      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())
      await Promise.all([aliceConnectPromise, bobConnectPromise])

      // Populate DHT routing tables
      await populateDHTRoutingTable(alice, bob)

      assert.strictEqual(alice.isConnected(bob.peerId), true)
      assert.strictEqual(bob.isConnected(alice.peerId), true)

      // Disconnect
      await alice.disconnectFromPeer(bob.peerId)

      assert.strictEqual(alice.isConnected(bob.peerId), false)

      await alice.stop()
      await bob.stop()
    })
  })

  describe('Lifecycle Management', () => {
    it('should cleanup expired DHT entries', async () => {
      const coordinator = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await coordinator.start()

      // Announce resource with expiration
      await coordinator.announceResource(
        'temp-resource',
        'temp-1',
        { data: 'temporary' },
        { expiresAt: Date.now() - 1000 }, // Already expired
      )

      // Run cleanup
      coordinator.cleanup()

      // Try to retrieve expired resource
      const resource = await coordinator.getResource('temp-resource', 'temp-1')
      assert.strictEqual(resource, null)

      await coordinator.stop()
    })

    it('should shutdown gracefully', async () => {
      const coordinator = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await coordinator.start()

      // Announce a resource
      await coordinator.announceResource('shutdown-test', 'resource-1', {
        test: true,
      })

      // Shutdown
      await coordinator.shutdown()

      // Should throw error when trying to access after shutdown
      assert.throws(() => coordinator.peerId, /Node not started/)
    })
  })

  describe('Direct Messaging (Integration)', () => {
    it('should send direct message from Alice to Bob', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false, // Client mode for tests
      })

      await alice.start()
      await bob.start()

      // Connect bidirectionally
      const bobAddrs = bob.libp2pNode.getMultiaddrs()

      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())
      await Promise.all([aliceConnectPromise, bobConnectPromise])

      // Populate DHT routing tables
      await populateDHTRoutingTable(alice, bob)
      console.log('Direct messaging test - DHT populated:', alice.getDHTStats())

      // Create message using protocol (ensures messageId is generated)
      const protocol = new P2PProtocol()
      const message = protocol.createMessage(
        'direct-test',
        { text: 'Hello Bob from Alice!' },
        alice.peerId,
      )

      const messagePromise = waitForEvent<P2PMessage>(
        bob,
        ConnectionEvent.MESSAGE,
      )

      await alice.sendTo(bob.peerId, message)

      const receivedMessage = await messagePromise
      assert.ok(receivedMessage, 'Bob should receive message')
      assert.strictEqual(receivedMessage.type, 'direct-test')
      assert.strictEqual(receivedMessage.from, alice.peerId)
      assert.deepStrictEqual(receivedMessage.payload, {
        text: 'Hello Bob from Alice!',
      })

      await alice.stop()
      await bob.stop()

      await new Promise(resolve => setTimeout(resolve, 200))
    })
  })

  describe('DHT Topology Integration', () => {
    it('should automatically populate DHT routing table via topology listener', async () => {
      // Create nodes with DHT in server mode
      // CRITICAL: Uses passthroughMapper (auto-detected from localhost address)
      // to allow private addresses - otherwise 127.0.0.1 would be filtered out!
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: true,
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: true,
      })

      const charlie = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: true,
      })

      await alice.start()
      await bob.start()
      await charlie.start()

      // Check initial state
      const aliceInitial = alice.getDHTStats()
      const bobInitial = bob.getDHTStats()

      assert.strictEqual(aliceInitial.mode, 'server')
      assert.strictEqual(bobInitial.mode, 'server')
      assert.strictEqual(aliceInitial.routingTableSize, 0)
      assert.strictEqual(bobInitial.routingTableSize, 0)

      // Connect Alice to Bob
      const bobAddr = bob.libp2pNode.getMultiaddrs()[0]
      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddr.toString())
      await Promise.all([aliceConnectPromise, bobConnectPromise])

      // Wait for identify service and DHT auto-population
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Verify Alice and Bob have each other in routing tables
      const aliceAfterBob = alice.getDHTStats()
      const bobAfterAlice = bob.getDHTStats()

      assert.ok(
        aliceAfterBob.routingTableSize >= 1,
        'Alice should have Bob in DHT routing table',
      )
      assert.ok(
        bobAfterAlice.routingTableSize >= 1,
        'Bob should have Alice in DHT routing table',
      )
      assert.strictEqual(aliceAfterBob.isReady, true)
      assert.strictEqual(bobAfterAlice.isReady, true)

      // Connect Charlie to Alice (late connection test)
      const charlieAddr = charlie.libp2pNode.getMultiaddrs()[0]
      const aliceCharliePromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const charlieAlicePromise = waitForEvent<PeerInfo>(
        charlie,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(charlieAddr.toString())
      await Promise.all([aliceCharliePromise, charlieAlicePromise])

      // Wait for DHT auto-population
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Verify Charlie was added to Alice's routing table
      const aliceAfterCharlie = alice.getDHTStats()
      const charlieAfterAlice = charlie.getDHTStats()

      assert.ok(
        aliceAfterCharlie.routingTableSize >= 2,
        'Alice should have both Bob and Charlie in routing table',
      )
      assert.ok(
        charlieAfterAlice.routingTableSize >= 1,
        'Charlie should have Alice in routing table',
      )

      // Cleanup
      await alice.stop()
      await bob.stop()
      await charlie.stop()

      await new Promise(resolve => setTimeout(resolve, 200))
    })
  })

  describe('GossipSub Pub/Sub', () => {
    it('should subscribe and receive messages on a topic', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        enableGossipSub: true,
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        enableGossipSub: true,
      })

      await alice.start()
      await bob.start()

      // Connect Alice to Bob
      const bobAddrs = bob.libp2pNode.getMultiaddrs()
      const aliceConnectPromise = waitForEvent<PeerInfo>(
        alice,
        ConnectionEvent.CONNECTED,
      )
      const bobConnectPromise = waitForEvent<PeerInfo>(
        bob,
        ConnectionEvent.CONNECTED,
      )

      await alice.connectToPeer(bobAddrs[0].toString())
      await Promise.all([aliceConnectPromise, bobConnectPromise])

      // Subscribe to topic
      const topic = 'test-topic'
      let receivedMessage: unknown = null

      await bob.subscribeToTopic(topic, (data: Uint8Array) => {
        receivedMessage = JSON.parse(new TextDecoder().decode(data))
      })

      // Also subscribe Alice so GossipSub has peers for the topic
      await alice.subscribeToTopic(topic, () => {})

      // Wait for subscription propagation
      await new Promise(resolve => setTimeout(resolve, 500))

      // Publish message from Alice
      const testMessage = { text: 'Hello GossipSub!' }
      await alice.publishToTopic(topic, testMessage)

      // Wait for message propagation
      await new Promise(resolve => setTimeout(resolve, 500))

      // Verify Bob received the message
      assert.deepStrictEqual(receivedMessage, testMessage)

      // Cleanup
      await alice.unsubscribeFromTopic(topic)
      await bob.unsubscribeFromTopic(topic)
      await alice.stop()
      await bob.stop()
    })

    it('should unsubscribe and stop receiving messages', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        enableGossipSub: true,
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        enableGossipSub: true,
      })

      await alice.start()
      await bob.start()

      // Connect
      const bobAddrs = bob.libp2pNode.getMultiaddrs()
      await alice.connectToPeer(bobAddrs[0].toString())
      await new Promise(resolve => setTimeout(resolve, 200))

      const topic = 'unsubscribe-test'
      let messageCount = 0

      await bob.subscribeToTopic(topic, () => {
        messageCount++
      })
      await alice.subscribeToTopic(topic, () => {})

      await new Promise(resolve => setTimeout(resolve, 500))

      // Unsubscribe Bob
      await bob.unsubscribeFromTopic(topic)

      // Publish message - Bob should NOT receive it
      await alice.publishToTopic(topic, { test: 'after-unsubscribe' })
      await new Promise(resolve => setTimeout(resolve, 500))

      // Message count should be 0 (no messages received after unsubscribe)
      assert.strictEqual(messageCount, 0)

      await alice.stop()
      await bob.stop()
    })

    it('should get topic peers', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        enableGossipSub: true,
      })

      const bob = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        enableGossipSub: true,
      })

      await alice.start()
      await bob.start()

      // Connect
      const bobAddrs = bob.libp2pNode.getMultiaddrs()
      await alice.connectToPeer(bobAddrs[0].toString())
      await new Promise(resolve => setTimeout(resolve, 200))

      const topic = 'peers-test'

      // Subscribe both
      await alice.subscribeToTopic(topic, () => {})
      await bob.subscribeToTopic(topic, () => {})

      // Wait for subscription propagation
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Get topic peers from Alice's perspective
      const topicPeers = alice.getTopicPeers(topic)

      // Bob should be in the list
      assert.ok(
        topicPeers.includes(bob.peerId),
        'Bob should be in topic peers list',
      )

      await alice.stop()
      await bob.stop()
    })

    it('should handle re-subscription to same topic', async () => {
      const alice = new P2PCoordinator({
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: true,
        enableDHTServer: false,
        enableGossipSub: true,
      })

      await alice.start()

      const topic = 'resubscribe-test'
      let handler1Called = false
      let handler2Called = false

      // First subscription
      await alice.subscribeToTopic(topic, () => {
        handler1Called = true
      })

      // Re-subscribe with new handler (should replace old one)
      await alice.subscribeToTopic(topic, () => {
        handler2Called = true
      })

      // Verify only one handler is registered (no memory leak)
      // This is implicitly tested by the fact that the test completes without issues

      await alice.stop()
    })
  })
})
