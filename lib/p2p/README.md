# P2P Coordination Layer (libp2p)

**Status**: Phase 1 Complete ✅  
**Version**: 1.0.0  
**Date**: October 30, 2025

---

## Overview

This is a **generalized peer-to-peer (P2P) networking infrastructure** for lotus-lib built on **libp2p**. It provides core P2P primitives that can be extended by any protocol requiring decentralized coordination.

**Built on libp2p**: Industry-standard P2P networking stack used by IPFS, Filecoin, and Ethereum 2.0.

**Use Cases:**

- MuSig2 multi-signature session coordination
- Decentralized CoinJoin rounds
- Any protocol requiring peer-to-peer communication

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    P2P Coordinator                          │
│  • Protocol registration                                    │
│  • Message routing                                          │
│  • Resource management                                      │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │       libp2p           │
            │  ┌──────────────────┐  │
            │  │ Connection Mgr   │  │
            │  │ Kad-DHT          │  │
            │  │ Transports       │  │
            │  │ • WebSockets     │  │
            │  │ • TCP            │  │
            │  │ Stream Muxing    │  │
            │  │ Encryption       │  │
            │  └──────────────────┘  │
            └────────────────────────┘
```

---

## Key Features

✅ **Industry-Standard libp2p**

- Proven P2P stack
- Used by major blockchain projects
- Active development and support

✅ **Full Feature Set**

- Kad-DHT for decentralized discovery
- Multiple transports (WebSockets, TCP)
- Encrypted connections (Noise protocol)
- Stream multiplexing (mplex)
- NAT traversal support
- GossipSub pub/sub messaging
- Circuit relay v2 (NAT traversal)
- AutoNAT (automatic NAT detection)
- DCUTR (direct connection upgrade)
- UPnP/NAT-PMP (automatic port forwarding)

✅ **Protocol Extension**

- `IProtocolHandler` interface
- Custom protocol streams
- Message routing

✅ **Type-Safe**

- Native libp2p types
- TypeScript throughout
- Generic type support

---

## Quick Start

### Installation

```bash
# Dependencies already installed with lotus-lib
npm install
```

### Basic Usage

```typescript
import { P2PCoordinator } from 'lotus-lib/p2p'

// Create coordinator
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'], // Listen on any available port
  enableDHT: true,
})

// Start node
await coordinator.start()

console.log('Peer ID:', coordinator.peerId)
console.log('Listening on:', coordinator.getStats().multiaddrs)

// Connect to another peer
await coordinator.connectToPeer('/ip4/127.0.0.1/tcp/4001/p2p/QmPeerID...')

// Announce resource
await coordinator.announceResource(
  'session',
  'session-123',
  { participants: ['alice', 'bob'] },
  { ttl: 3600 },
)

// Discover resources
const resources = await coordinator.discoverResources('session')

// Shutdown
await coordinator.stop()
```

### Connection Management Configuration

The P2P layer supports configurable connection limits via environment variables or programmatic configuration.

**Environment Variables** (via `.env` file):

```bash
# Maximum number of general P2P connections
# Default: 50 (adequate for most client nodes)
# Recommended: 20-100 for clients, 100-500 for bootstrap nodes
P2P_MAX_CONNECTIONS=50

# Minimum number of P2P connections to maintain
# Default: 10 (maintains network health)
# Recommended: 5-20 for clients, 20-50 for bootstrap nodes
P2P_MIN_CONNECTIONS=10
```

**Programmatic Configuration**:

```typescript
import { P2P } from 'lotus-lib/utils/settings'

const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
  connectionManager: {
    minConnections: P2P.minConnections, // From .env or defaults to 10
    maxConnections: P2P.maxConnections, // From .env or defaults to 50
  },
})
```

**Important Notes**:

1. **General P2P connections** are for network health (DHT, GossipSub, peer discovery)
2. **Session-specific connections** (e.g., MuSig2 signers) are managed separately
3. libp2p maintains connections within the min/max range automatically
4. Sane defaults are provided if `.env` is not configured:
   - Default max: 50 connections
   - Default min: 10 connections

**Recommended Configurations**:

| Node Type      | Max Connections | Min Connections | Use Case              |
| -------------- | --------------- | --------------- | --------------------- |
| Wallet Client  | 20-50           | 5-10            | Lightweight wallet UX |
| Full Client    | 50-100          | 10-20           | Standard client node  |
| Bootstrap Node | 100-500         | 20-50           | Public discovery node |
| Relay Node     | 200-1000        | 50-100          | NAT traversal relay   |

---

## Components

### 1. P2PCoordinator

Main entry point wrapping libp2p functionality.

```typescript
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
  bootstrapPeers: ['/dnsaddr/bootstrap.libp2p.io/p2p/QmBootstrap...'],
  enableDHT: true,
})

await coordinator.start()
```

### 2. Protocol Extension

Implement custom protocols using `IProtocolHandler`:

```typescript
import { IProtocolHandler, P2PMessage, PeerInfo } from 'lotus-lib/p2p'

class MyProtocol implements IProtocolHandler {
  readonly protocolName = 'my-protocol'
  readonly protocolId = '/lotus/my-protocol/1.0.0'

  async handleMessage(message: P2PMessage, from: PeerInfo): Promise<void> {
    // Handle protocol messages
  }

  async handleStream(stream, connection): Promise<void> {
    // Handle libp2p streams (optional)
  }

  async onPeerDiscovered(peerInfo: PeerInfo): Promise<void> {
    // Handle peer discovery (e.g., from bootstrap nodes)
    // Called before connection is established
    console.log('Discovered peer:', peerInfo.peerId, peerInfo.multiaddrs)
  }

  async onPeerConnected(peerId: string): Promise<void> {
    // Handle peer connection (after successful connection)
    console.log('Connected to peer:', peerId)
  }

  async onPeerDisconnected(peerId: string): Promise<void> {
    // Handle peer disconnection
    console.log('Disconnected from peer:', peerId)
  }

  async onPeerUpdated(peerInfo: PeerInfo): Promise<void> {
    // Handle peer information update (e.g., multiaddrs changed)
    console.log('Peer updated:', peerInfo.peerId, peerInfo.multiaddrs)
  }

  async onRelayAddressesChanged(data: {
    peerId: string
    reachableAddresses: string[]
    relayAddresses: string[]
    timestamp: number
  }): Promise<void> {
    // Handle relay address changes (optional)
    console.log('Relay addresses changed for peer:', data.peerId)
  }
}

coordinator.registerProtocol(new MyProtocol())
```

### 3. Security and Validation

The P2P layer provides comprehensive security features:

#### Core Security Manager

```typescript
// Access core security manager
const security = coordinator.getCoreSecurityManager()

// Register protocol validators
security.registerValidator({
  validateResourceAnnouncement: async (
    resourceType,
    resourceId,
    data,
    peerId,
  ) => {
    // Custom validation logic
    return true // Accept or reject
  },

  validateMessage: async (message, from) => {
    // Message validation
    return message.payload !== null
  },

  canAnnounceResource: async (resourceType, peerId) => {
    // Permission check
    return true
  },
})

// Get security metrics
const metrics = security.getMetrics()
console.log('Security metrics:', metrics)
```

#### Built-in Security Features

- **Rate Limiting**: DHT announcements (30s minimum per peer)
- **Resource Limits**: Max 100 resources per peer, 20 per type
- **Message Size Limits**: 100KB max message size
- **Peer Ban Management**: Automatic banning for malicious behavior
- **Reputation Tracking**: Track peer behavior over time

#### Security Configuration

```typescript
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
  securityConfig: {
    // WARNING: Never disable in production!
    disableRateLimiting: false,

    // Override default limits
    customLimits: {
      MAX_P2P_MESSAGE_SIZE: 200_000, // 200KB
      MIN_DHT_ANNOUNCEMENT_INTERVAL: 60_000, // 1 minute
    },
  },
})
```

---

## libp2p Integration

### Native libp2p Features

The coordinator provides access to libp2p's full feature set:

```typescript
// Access libp2p node directly
const libp2p = coordinator.libp2pNode

// Use libp2p connection manager
const connections = libp2p.getConnections()

// Use libp2p peer store
const peerInfo = await libp2p.peerStore.get(peerId)

// Use libp2p DHT
const dht = libp2p.services.dht as KadDHT
await dht.put(key, value)

// Use libp2p pubsub (if enabled)
// const pubsub = libp2p.services.pubsub
```

### Multiaddrs

libp2p uses multiaddrs for addressing:

```typescript
// Connect using multiaddr
await coordinator.connectToPeer('/ip4/192.168.1.100/tcp/4001/p2p/QmPeerId...')

// Get node's multiaddrs
const stats = coordinator.getStats()
console.log('Listening on:', stats.multiaddrs)
// ['/ip4/127.0.0.1/tcp/54321/p2p/QmYourPeerId...']
```

### Transports

Supported out of the box:

- ✅ TCP
- ✅ WebSockets
- ✅ Circuit Relay v2 (for NAT traversal)
- 🔜 WebRTC (add transport in config)
- 🔜 QUIC (add transport in config)

### NAT Traversal

Complete NAT traversal solution:

- ✅ **Circuit Relay v2**: Connect via public relay nodes
- ✅ **AutoNAT**: Automatic NAT detection and public address discovery
- ✅ **DCUTR**: Direct Connection Upgrade through Relay (hole punching)
- ✅ **UPnP/NAT-PMP**: Automatic port forwarding (disabled by default)

### GossipSub Pub/Sub

Real-time messaging for instant notifications:

```typescript
// Enable GossipSub (default: true)
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
  enableGossipSub: true, // Default
})

// Subscribe to topics for real-time updates
const gossipsub = coordinator.libp2pNode.services.pubsub as GossipSub
await gossipsub.subscribe('lotus-musig2-sessions')
await gossipsub.subscribe('lotus-swapsig-pools')

// Listen for messages
gossipsub.addEventListener('message', event => {
  console.log('Received message:', event.detail)
})
```

### 4. Blockchain Utilities

The P2P layer includes blockchain verification utilities for burn-based mechanisms:

#### Burn Verifier

Generic burn transaction verification without enforcing policy:

```typescript
import { BurnVerifier, BurnVerificationResult } from 'lotus-lib/p2p'

// Create verifier
const verifier = new BurnVerifier('https://chronik.lotusia.org')

// Verify burn transaction
const result = await verifier.verifyBurn(
  'txid...', // Transaction ID
  0, // Output index (usually 0)
  6, // Minimum confirmations
  0, // Maturation period (0 = no maturation)
)

if (result) {
  console.log('Burn verified:', {
    txId: result.txId,
    burnAmount: result.burnAmount,
    confirmations: result.confirmations,
    isMatured: result.isMatured,
    lokadPrefix: result.lokadPrefix,
    lokadPayload: result.lokadPayload,
  })
}
```

#### Transaction Monitor

Monitor blockchain transactions in real-time:

```typescript
import { TransactionMonitor } from 'lotus-lib/p2p'

const monitor = new TransactionMonitor('https://chronik.lotusia.org')

// Monitor transaction confirmation
monitor.waitForConfirmation(
  'txid...',
  6, // Required confirmations
  tx => {
    console.log('Transaction confirmed:', tx.txid)
  },
  error => {
    console.error('Monitoring error:', error)
  },
)

// Monitor address for transactions
monitor.monitorAddress('ecash:q...', tx => {
  console.log('New transaction:', tx.txid)
})
```

---

## API Reference

### P2PCoordinator

```typescript
class P2PCoordinator extends EventEmitter {
  constructor(config: P2PConfig)

  // Lifecycle
  async start(): Promise<void>
  async stop(): Promise<void>

  // Properties
  get peerId(): string
  get libp2pNode(): Libp2p

  // Protocol Management
  registerProtocol(handler: IProtocolHandler): void
  unregisterProtocol(protocolName: string): void

  // Peer Operations
  async connectToPeer(multiaddr: string): Promise<void>
  async disconnectFromPeer(peerId: string): Promise<void>
  getConnectedPeers(): PeerInfo[]
  getPeer(peerId: string): PeerInfo | undefined
  isConnected(peerId: string): boolean

  // Messaging
  async sendTo(peerId: string, message: P2PMessage): Promise<void>
  async broadcast(message: P2PMessage, options?): Promise<void>

  // Resource Management (DHT)
  async announceResource<T>(type, id, data: T, options?): Promise<void>
  async discoverResources(type, filters?): Promise<ResourceAnnouncement[]>
  async getResource(type, id): Promise<ResourceAnnouncement | null>

  // Utility
  getStats(): { peerId, peers, dht, multiaddrs }
  cleanup(): void
  async shutdown(): Promise<void>

  // Events (from libp2p)
  on('peer:connect', (peer: PeerInfo) => void)
  on('peer:disconnect', (peer: PeerInfo) => void)
  on('peer:discovery', (peer: PeerInfo) => void)
  on('peer:update', (peer: PeerInfo) => void)
  on('message', (message: P2PMessage, from: PeerInfo) => void)
  on('error', (error: Error) => void)
}
```

### P2PConfig

```typescript
interface P2PConfig {
  /** Fixed peer identity (optional) */
  privateKey?: PrivateKey

  /** Listen addresses (multiaddrs) */
  listen?: string[]

  /** Announce addresses (multiaddrs) */
  announce?: string[]

  /** Bootstrap peer addresses (multiaddrs with peer IDs) */
  bootstrapPeers?: string[]

  /** Enable Kad-DHT */
  enableDHT?: boolean

  /** DHT protocol prefix */
  dhtProtocol?: string

  /** Enable DHT server mode (participate in DHT network) */
  enableDHTServer?: boolean

  /** Enable GossipSub pub/sub for real-time messaging */
  enableGossipSub?: boolean

  /** Security configuration */
  securityConfig?: {
    disableRateLimiting?: boolean
    customLimits?: Partial<typeof CORE_P2P_SECURITY_LIMITS>
  }

  /** DHT peer info mapper function */
  dhtPeerInfoMapper?: PeerInfoMapper

  /** Enable circuit relay v2 (NAT traversal) */
  enableRelay?: boolean

  /** Enable relay server mode */
  enableRelayServer?: boolean

  /** Enable AutoNAT (automatic NAT detection) */
  enableAutoNAT?: boolean

  /** Enable DCUTR (direct connection upgrade) */
  enableDCUTR?: boolean

  /** Enable UPnP/NAT-PMP (automatic port forwarding) */
  enableUPnP?: boolean

  /** Relay address monitoring configuration */
  relayMonitoring?: {
    enabled?: boolean
    checkInterval?: number
    bootstrapOnly?: boolean
  }

  /** Maximum connections */
  maxConnections?: number

  /** Connection manager options */
  connectionManager?: {
    minConnections?: number
    maxConnections?: number
  }

  /** Custom metadata */
  metadata?: Record<string, unknown>
}
```

### IProtocolHandler

```typescript
interface IProtocolHandler {
  readonly protocolName: string
  readonly protocolId: string // libp2p protocol ID (e.g., '/lotus/musig2/1.0.0')

  handleMessage(message: P2PMessage, from: PeerInfo): Promise<void>
  handleStream?(stream: Stream, connection: Connection): Promise<void> // Optional libp2p stream handler
  onPeerDiscovered?(peerInfo: PeerInfo): Promise<void> // Peer discovered (before connection)
  onPeerConnected?(peerId: string): Promise<void> // Peer connected
  onPeerDisconnected?(peerId: string): Promise<void> // Peer disconnected
  onPeerUpdated?(peerInfo: PeerInfo): Promise<void> // Peer information updated (e.g., multiaddrs changed)
  onRelayAddressesChanged?(data: {
    peerId: string
    reachableAddresses: string[]
    relayAddresses: string[]
    timestamp: number
  }): Promise<void> // Optional relay address change handler
}
```

### Core Security Manager

```typescript
class CoreSecurityManager extends EventEmitter {
  // Register protocol validators
  registerValidator(validator: IProtocolValidator): void

  // Check if peer can announce resource
  canAnnounceResource(peerId: string, resourceType: string): boolean

  // Validate message
  validateMessage(message: P2PMessage, from: PeerInfo): boolean

  // Get security metrics
  getMetrics(): CoreSecurityMetrics

  // Ban/unban peers
  banPeer(peerId: string, reason?: string): void
  unbanPeer(peerId: string): void

  // Cleanup expired data
  cleanup(): void
}
```

### Blockchain Utilities

#### BurnVerifier

```typescript
class BurnVerifier {
  constructor(chronikUrl: string | string[])

  // Verify burn transaction
  async verifyBurn(
    txId: string,
    outputIndex: number,
    minConfirmations?: number,
    maturationPeriod?: number,
  ): Promise<BurnVerificationResult | null>
}
```

#### TransactionMonitor

```typescript
class TransactionMonitor {
  constructor(chronikUrl: string | string[])

  // Wait for transaction confirmation
  waitForConfirmation(
    txId: string,
    requiredConfirmations: number,
    onConfirmed: (tx: ChronikTx) => void,
    onError: (error: Error) => void,
  ): void

  // Monitor address for transactions
  monitorAddress(address: string, onTransaction: (tx: ChronikTx) => void): void
}
```

### P2P Protocol

```typescript
class P2PProtocol {
  // Create messages
  createMessage<T>(
    type: string,
    payload: T,
    from: string,
    options?,
  ): P2PMessage<T>

  // Serialization
  serialize(message: P2PMessage): Buffer
  deserialize(data: Buffer): P2PMessage

  // Validation
  validateMessage(message: P2PMessage): boolean
  validateMessageSize(message: P2PMessage, maxSize?: number): boolean

  // Utility messages
  createHandshake(peerId: string, metadata?): P2PMessage
  createHeartbeat(peerId: string): P2PMessage
  createDisconnect(peerId: string, reason?: string): P2PMessage
  createError(peerId: string, error: string, context?): P2PMessage
}
```

### Protocol Implementations

#### MuSig2P2PCoordinator

```typescript
class MuSig2P2PCoordinator extends P2PCoordinator {
  // Session management
  async createSession(signers: string[], message: Buffer): Promise<MuSigSession>
  async joinSession(sessionId: string, signerKey: PrivateKey): Promise<void>
  async leaveSession(sessionId: string): Promise<void>

  // Nonce management
  async shareNonces(sessionId: string, nonces: Buffer[]): Promise<void>
  async collectNonces(sessionId: string): Promise<Buffer[]>

  // Signing
  async createPartialSignature(
    sessionId: string,
    messageHash: Buffer,
  ): Promise<Buffer>
  async collectPartialSignatures(sessionId: string): Promise<Buffer>

  // Coordinator election
  async electCoordinator(sessionId: string): Promise<string>

  // Identity management
  async registerIdentity(publicKey: PublicKey, burnTxId?: string): Promise<void>
  async verifyIdentity(peerId: string): Promise<boolean>
}
```

#### SwapSigCoordinator

```typescript
class SwapSigCoordinator extends MuSig2P2PCoordinator {
  // Pool management
  async createPool(params: CreatePoolParams): Promise<string>
  async joinPool(poolId: string, input: ParticipantInput): Promise<void>
  async leavePool(poolId: string): Promise<void>

  // Pool discovery
  async discoverPools(
    filters?: PoolDiscoveryFilters,
  ): Promise<SwapPoolAnnouncement[]>

  // Swap execution
  async executeSwap(poolId: string): Promise<void>

  // Burn verification
  async verifyBurn(burnTxId: string, poolId: string): Promise<boolean>
}
```

---

## libp2p Features

### 1. Kad-DHT (Distributed Hash Table)

```typescript
// Enable DHT in config
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
  enableDHT: true,
  dhtProtocol: '/lotus/kad/1.0.0',
})

// Use through coordinator
await coordinator.announceResource('type', 'id', data)
const resources = await coordinator.discoverResources('type')

// Or access DHT directly
const dht = coordinator.libp2pNode.services.dht
await dht.put(key, value)
```

### 2. Connection Manager

```typescript
// Configure connection limits
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
  connectionManager: {
    minConnections: 5, // Maintain at least 5 connections
    maxConnections: 100, // Allow max 100 connections
  },
})
```

### 3. Peer Discovery

```typescript
// Bootstrap discovery - automatically connects to bootstrap nodes
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
  bootstrapPeers: ['/dns4/bootstrap.lotusia.org/tcp/4001/p2p/12D3Koo...'],
})

// Listen for discovered peers at coordinator level
coordinator.on('peer:discovery', (peerInfo: PeerInfo) => {
  console.log('Discovered peer:', peerInfo.peerId, peerInfo.multiaddrs)
  // Bootstrap module will automatically attempt to connect
})

// OR implement onPeerDiscovered in your protocol handler
class MyProtocol implements IProtocolHandler {
  // ... other methods ...

  async onPeerDiscovered(peerInfo: PeerInfo): Promise<void> {
    // React to peer discovery (e.g., check if peer offers your service)
    console.log('Protocol notified of discovery:', peerInfo.peerId)

    // Optionally attempt connection if not auto-connecting
    // await coordinator.connectToPeer(peerInfo.multiaddrs[0])
  }

  async onPeerConnected(peerId: string): Promise<void> {
    // Peer successfully connected - ready for protocol operations
    console.log('Peer connected:', peerId)
  }

  async onPeerUpdated(peerInfo: PeerInfo): Promise<void> {
    // Peer information updated (e.g., multiaddrs changed)
    // This happens when a peer's network configuration changes
    console.log('Peer updated:', peerInfo.peerId, peerInfo.multiaddrs)

    // Example: Update cached peer information
    // this.peerCache.set(peerInfo.peerId, peerInfo)
  }
}
```

**When is `peer:update` fired?**

The `peer:update` event is emitted by libp2p when a peer's information changes, typically:

- Multiaddrs change (e.g., NAT traversal completes, IP address changes)
- Peer establishes a new transport connection
- Network configuration changes (e.g., relay → direct connection upgrade via DCUTR)

This event is useful for:

- Keeping cached peer information up-to-date
- Updating UI displays of peer connection status
- Refreshing connection strategies when peer addresses change
- Tracking network topology changes

### 4. Stream Protocols

```typescript
// Register custom stream protocol
class MyProtocol implements IProtocolHandler {
  readonly protocolName = 'my-protocol'
  readonly protocolId = '/lotus/my-protocol/1.0.0'

  async handleStream(stream, connection): Promise<void> {
    // Read from stream
    for await (const chunk of stream.source) {
      console.log('Received:', chunk)
    }

    // Write to stream
    await pipe([Buffer.from('response')], stream)
  }
}
```

---

## Testing

### Run Tests

```bash
# Protocol tests
npx tsx --test test/p2p/protocol.test.ts

# Coordinator tests (integration with libp2p)
npx tsx --test test/p2p/coordinator.test.ts
```

### Run Examples

```bash
# Basic P2P with libp2p
npx tsx examples/p2p-basic-example.ts

# Protocol extension pattern
npx tsx examples/p2p-protocol-extension-example.ts
```

---

## Extending for Protocols

### MuSig2 Example

```typescript
import { IProtocolHandler, P2PCoordinator } from 'lotus-lib/p2p'
import { MuSigSessionManager } from '../bitcore/crypto/musig2-session.js'

class MuSig2P2PHandler implements IProtocolHandler {
  readonly protocolName = 'musig2'
  readonly protocolId = '/lotus/musig2/1.0.0'

  private sessionManager = new MuSigSessionManager()

  constructor(private coordinator: P2PCoordinator) {}

  async handleMessage(message: P2PMessage, from: PeerInfo): Promise<void> {
    switch (message.type) {
      case 'nonce-share':
        const { sessionId, nonce, signerIndex } = message.payload
        // Handle nonce...
        break

      case 'partial-sig-share':
        // Handle partial signature...
        break
    }
  }

  async createSession(signers, message) {
    const session = this.sessionManager.createSession(signers, myKey, message)

    // Announce to P2P network
    await this.coordinator.announceResource(
      'musig-session',
      session.sessionId,
      {
        signers: signers.map(s => s.toString()),
        message: message.toString('hex'),
      },
    )

    return session
  }

  async shareNonces(sessionId, nonces) {
    await this.coordinator.broadcast({
      type: 'nonce-share',
      from: this.coordinator.peerId,
      payload: { sessionId, nonces },
      timestamp: Date.now(),
      messageId: generateId(),
      protocol: 'musig2',
    })
  }
}

// Use it
const handler = new MuSig2P2PHandler(coordinator)
coordinator.registerProtocol(handler)
```

---

## Configuration Examples

### Minimal Configuration

```typescript
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
})
```

### Production Configuration

```typescript
const coordinator = new P2PCoordinator({
  // Listen on all interfaces
  listen: ['/ip4/0.0.0.0/tcp/4001', '/ip4/0.0.0.0/tcp/4002/ws'],

  // Announce public addresses
  announce: [
    '/dns4/my-node.example.com/tcp/4001',
    '/dns4/my-node.example.com/tcp/4002/ws',
  ],

  // Bootstrap from known peers
  bootstrapPeers: [
    '/dnsaddr/bootstrap.lotus.org/p2p/QmBootstrap1...',
    '/dnsaddr/bootstrap.lotus.org/p2p/QmBootstrap2...',
  ],

  // Enable DHT for discovery
  enableDHT: true,
  dhtProtocol: '/lotus/kad/1.0.0',

  // Connection limits
  connectionManager: {
    minConnections: 10,
    maxConnections: 100,
  },
})
```

### Local Development

```typescript
const coordinator = new P2PCoordinator({
  listen: ['/ip4/127.0.0.1/tcp/0'], // Localhost only
  enableDHT: false, // Disable DHT for local testing
})
```

---

## Dependencies

**Installed:**

```json
{
  "dependencies": {
    "libp2p": "^1.0.0",
    "@libp2p/interface": "^1.0.0",
    "@libp2p/peer-id": "^4.0.0",
    "@libp2p/websockets": "^8.0.0",
    "@libp2p/kad-dht": "^12.0.0",
    "@libp2p/tcp": "^9.0.0",
    "@libp2p/mplex": "^10.0.0",
    "@chainsafe/libp2p-noise": "^14.0.0",
    "@libp2p/bootstrap": "^10.0.0",
    "@multiformats/multiaddr": "^12.0.0"
  }
}
```

---

## File Structure

```
lib/p2p/
├── index.ts           # Main exports
├── types.ts           # Type definitions (re-exports libp2p types)
├── coordinator.ts     # Main coordinator (wraps libp2p)
├── protocol.ts        # Message protocol
├── security.ts        # Core security manager and rate limiting
├── blockchain-utils.ts # Burn verification and transaction monitoring
├── utils.ts           # Utility functions
└── README.md          # This file

# Protocol Implementations
├── musig2/            # MuSig2 multi-signature coordination
│   ├── coordinator.ts      # MuSig2 P2P coordinator
│   ├── protocol-handler.ts # MuSig2 protocol handler
│   ├── security.ts         # MuSig2-specific security
│   ├── identity-manager.ts  # Burn-based identity management
│   ├── election.ts         # Coordinator election
│   ├── types.ts            # MuSig2 types
│   ├── serialization.ts    # Message serialization
│   ├── validation.ts       # Input validation
│   └── errors.ts           # MuSig2 errors
└── swapsig/           # SwapSig protocol (CoinJoin with MuSig2)
    ├── coordinator.ts      # SwapSig coordinator (extends MuSig2)
    ├── protocol-handler.ts # SwapSig protocol handler
    ├── pool.ts             # Pool state management
    ├── burn.ts             # XPI burn mechanism
    ├── types.ts            # SwapSig types
    └── validation.ts       # SwapSig validation

examples/
├── p2p-basic-example.ts              # Basic usage
└── p2p-protocol-extension-example.ts # Protocol extension

test/p2p/
├── protocol.test.ts   # Protocol tests
└── coordinator.test.ts # Coordinator tests
```

---

## Advantages of libp2p

### vs Custom Implementation

| Feature        | Custom            | libp2p              |
| -------------- | ----------------- | ------------------- |
| NAT Traversal  | ❌ Limited        | ✅ Full support     |
| Transports     | 🔶 WebSocket only | ✅ Multiple         |
| DHT            | 🔶 Simple         | ✅ Kademlia         |
| Security       | 🔶 Basic          | ✅ Noise protocol   |
| Peer Discovery | 🔶 Manual         | ✅ Automatic        |
| Battle-Tested  | ❌ No             | ✅ Yes (IPFS, etc.) |
| Documentation  | 🔶 Custom         | ✅ Extensive        |
| Community      | ❌ Small          | ✅ Large            |

### Production Benefits

- ✅ **Proven in production** (IPFS, Filecoin, Eth2)
- ✅ **Active maintenance** and security updates
- ✅ **Comprehensive testing** by libp2p team
- ✅ **Cross-platform** (Node.js, browsers, mobile)
- ✅ **Interoperability** with other libp2p networks

---

## Migration from Phase 1 Alpha

If you were using the custom implementation, migration is straightforward:

### Before (Custom)

```typescript
const coordinator = new P2PCoordinator({ peerId: 'my-peer' })

await coordinator.connectToPeer({
  peerId: 'other-peer',
  addresses: { websocket: 'ws://localhost:8080' },
  state: PeerState.DISCONNECTED,
  lastSeen: Date.now(),
})
```

### After (libp2p)

```typescript
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
})

await coordinator.start() // Now required

await coordinator.connectToPeer('/ip4/localhost/tcp/8080/p2p/QmOtherPeer...')
```

### Key Changes

1. **Must call `start()`** - libp2p requires initialization
2. **Use multiaddrs** - Instead of PeerInfo objects
3. **Peer IDs are strings** - libp2p PeerId.toString()
4. **DHT is built-in** - No separate DHT class

---

## Security Considerations

### Phase 1 (Current)

✅ **Provided by libp2p:**

- Encrypted connections (Noise protocol)
- Peer authentication
- Message integrity
- Connection timeouts

❌ **Not Yet Implemented:**

- Application-level message signing
- Rate limiting
- Sybil attack protection (application-level)
- Replay protection (application-level)

> **Note**: libp2p provides transport security, but application-level security (rate limiting, Sybil protection, etc.) must be implemented in Phase 2.

---

## Troubleshooting

### Cannot install libp2p

**Issue**: npm install fails

**Solution**:

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Peer connection fails

**Issue**: Cannot connect to peer

**Solution**:

1. Check multiaddr format: `/ip4/HOST/tcp/PORT/p2p/PEERID`
2. Verify peer is running and reachable
3. Check firewall settings
4. Try local connection first: `/ip4/127.0.0.1/tcp/PORT/...`

### DHT not finding resources

**Issue**: Resources not discovered

**Solution**:

1. Ensure DHT is enabled: `enableDHT: true`
2. Connect to bootstrap peers for DHT routing
3. Wait for DHT to propagate (~few seconds)
4. Check local cache with `getResource()` first

---

## Related Documentation

- [libp2p Documentation](https://docs.libp2p.io/)
- [libp2p GitHub](https://github.com/libp2p/js-libp2p)
- [MUSIG2_P2P_COORDINATION.md](../../docs/MUSIG2_P2P_COORDINATION.md) - MuSig2 P2P design
- [COINJOIN_DECENTRALIZED.md](../../docs/COINJOIN_DECENTRALIZED.md) - CoinJoin P2P design

---

**Built with libp2p for the Lotus Ecosystem** 🌸
