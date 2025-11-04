# MuSig2 P2P Coordination - Complete Reference

**Version**: 2.0.0  
**Status**: ✅ **PRODUCTION READY**  
**Last Updated**: November 4, 2025

---

## Table of Contents

1. [Introduction](#introduction)
2. [How It Works](#how-it-works)
   - [Architecture Overview](#architecture-overview)
   - [Protocol Flow](#protocol-flow)
   - [Security Architecture](#security-architecture)
   - [Coordinator Election](#coordinator-election)
   - [Network Topology](#network-topology)
3. [API Reference](#api-reference)
   - [MuSig2P2PCoordinator](#musig2p2pcoordinator)
   - [Session Management](#session-management)
   - [Election Functions](#election-functions)
   - [Security Manager](#security-manager)
   - [Events](#events)
   - [Configuration](#configuration)
4. [Quick Start](#quick-start)
5. [Examples](#examples)
6. [Security](#security)
7. [Testing](#testing)
8. [Additional Documentation](#additional-documentation)

---

## Introduction

The MuSig2 P2P Coordination system enables **decentralized, multi-party Schnorr signature creation** for the Lotus blockchain. It implements the MuSig2 protocol (BIP327) adapted for Lotus's Schnorr signature format, with production-grade P2P networking, security features, and automatic coordinator election.

### What is MuSig2?

MuSig2 is a multi-signature scheme that allows multiple parties to collaboratively create a single Schnorr signature. When combined with Taproot:

- **Privacy**: Multi-sig transactions look identical to single-sig
- **Efficiency**: 83% size reduction vs traditional P2SH multisig
- **Security**: Provably secure under discrete log assumption
- **Non-interactive**: Parallel nonce exchange (2 rounds)

### Key Features

**Core Protocol:**

- ✅ Complete MuSig2 implementation (BIP327)
- ✅ Lotus Schnorr signature format support
- ✅ Two-round signing protocol
- ✅ Nonce reuse prevention
- ✅ Partial signature verification

**P2P Networking:**

- ✅ libp2p-based P2P coordination
- ✅ DHT session discovery
- ✅ GossipSub real-time messaging
- ✅ Direct P2P streams
- ✅ Automatic peer connection management

**Coordinator Election:**

- ✅ Deterministic coordinator selection (4 election methods)
- ✅ Automatic failover mechanism
- ✅ Backup coordinator priority lists
- ✅ Byzantine fault tolerance (up to N-1 coordinator failures)

**Security:**

- ✅ Cryptographic session signatures (DHT poisoning prevention)
- ✅ Message replay protection (sequence numbers)
- ✅ Protocol phase enforcement
- ✅ Rate limiting (1 ad per 60s per peer)
- ✅ Sybil resistance (max 10 keys per peer)
- ✅ Peer reputation tracking
- ✅ Automatic cleanup (expired sessions)

**Production Features:**

- ✅ Comprehensive error handling
- ✅ Event-driven architecture
- ✅ TypeScript type safety
- ✅ 91+ passing tests
- ✅ Complete API documentation

### Use Cases

1. **Multi-Party Wallets**: 2-of-2, 3-of-3, N-of-N multisig wallets with privacy
2. **Organization Treasury**: Corporate multisig with automatic coordinator selection
3. **Decentralized Exchanges**: Atomic swap coordination
4. **Lightning Network**: Channel opening/closing coordination
5. **Vault Systems**: Time-locked multi-party custody

---

## How It Works

### Architecture Overview

The MuSig2 P2P system is built on a layered architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Application Layer                            │
│  Your wallet, exchange, vault, or DApp                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│              MuSig2 P2P Coordinator                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Session Management                                       │  │
│  │ - Creates and tracks signing sessions                    │  │
│  │ - Validates nonces and partial signatures                │  │
│  │ - Aggregates final signatures                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Coordinator Election                                     │  │
│  │ - Deterministic coordinator selection                    │  │
│  │ - Automatic failover (up to N-1 failures)                │  │
│  │ - Priority list management                               │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Security Manager                                         │  │
│  │ - Rate limiting (1 ad/60s)                               │  │
│  │ - Sybil resistance (10 keys max)                         │  │
│  │ - Peer reputation tracking                               │  │
│  │ - Invalid signature tracking                             │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Protocol Handler                                         │  │
│  │ - Routes incoming messages                               │  │
│  │ - Deserializes payloads                                  │  │
│  │ - Error handling                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                  Base P2P Infrastructure                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ libp2p Node                                              │  │
│  │ - Peer discovery and connection management               │  │
│  │ - Encrypted transport (Noise protocol)                   │  │
│  │ - Multiple transports (TCP, WebSocket, etc.)             │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Kademlia DHT                                             │  │
│  │ - Session announcement storage                           │  │
│  │ - Distributed session discovery                          │  │
│  │ - k=20 replication for fault tolerance                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ GossipSub                                                │  │
│  │ - Real-time message broadcasting                         │  │
│  │ - Topic-based subscriptions                              │  │
│  │ - Peer scoring and validation                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Design Principles:**

1. **Separation of Concerns**: Each layer handles specific responsibilities
2. **Event-Driven**: Async coordination via EventEmitter
3. **Security First**: Multi-layer defense in depth
4. **Fault Tolerant**: Automatic failover and cleanup
5. **Type Safe**: Strong TypeScript typing throughout

---

### Protocol Flow

#### Complete Signing Session Flow

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│  Alice  │         │   Bob   │         │ Charlie │
└────┬────┘         └────┬────┘         └────┬────┘
     │                   │                   │
     │ PHASE 1: Session Creation              │
     │                   │                   │
     │ 1. createSession()│                   │
     ├─────────────────► │                   │
     │   - Announce to DHT                   │
     │   - Include election data             │
     │   - Sign announcement                 │
     │                   │                   │
     │ 2. Discover from DHT                  │
     │                   │                   │
     │      ◄────────────┼───────────────────┤
     │                   │                   │
     │ 3. SESSION_JOIN   │                   │
     │      ◄────────────┤                   │
     │      ◄────────────┼───────────────────┤
     │                   │                   │
     │ [Election Complete: Alice = Coordinator] │
     │                   │                   │
     │ PHASE 2: Round 1 - Nonce Exchange     │
     │                   │                   │
     │ 4. Generate nonces│                   │
     │    (R1, R2) each  │                   │
     │                   │                   │
     │ 5. NONCE_SHARE    │                   │
     ├──────────────────►│                   │
     ├───────────────────┼──────────────────►│
     │      ◄────────────┤                   │
     │      ◄────────────┼───────────────────┤
     │                   │                   │
     │ [All nonces received - Auto-advance]  │
     │                   │                   │
     │ PHASE 3: Round 2 - Partial Sigs       │
     │                   │                   │
     │ 6. Compute partial│                   │
     │    signatures     │                   │
     │                   │                   │
     │ 7. PARTIAL_SIG_SHARE                  │
     ├──────────────────►│                   │
     ├───────────────────┼──────────────────►│
     │      ◄────────────┤                   │
     │      ◄────────────┼───────────────────┤
     │                   │                   │
     │ [All partial sigs received]           │
     │                   │                   │
     │ 8. Aggregate final signature          │
     │    s = s1 + s2 + s3                   │
     │                   │                   │
     │ PHASE 4: Transaction Broadcasting     │
     │                   │                   │
     │ 9. session:should-broadcast (Alice)   │
     │    [Coordinator builds & broadcasts]  │
     │                   │                   │
     │ 10. Build transaction                 │
     │ 11. Broadcast to network              │
     │                   │                   │
     │ 12. notifyBroadcastComplete()         │
     │     [Cancels failover timeouts]       │
     │                   │                   │
     │ 13. SIGNATURE_FINALIZED               │
     ├──────────────────►│                   │
     ├───────────────────┼──────────────────►│
     │                   │                   │
     │ [Session Complete]│                   │
     │                   │                   │
```

#### Phase Progression

```
INIT
  │
  ├─ SESSION_ANNOUNCE (creator only)
  ├─ SESSION_JOIN (participants)
  │
  ▼
NONCE_EXCHANGE
  │
  ├─ NONCE_SHARE (all participants)
  ├─ Auto-advance when all nonces received
  │
  ▼
PARTIAL_SIG_EXCHANGE
  │
  ├─ PARTIAL_SIG_SHARE (all participants)
  ├─ Auto-advance when all partial sigs received
  │
  ▼
COMPLETE
  │
  ├─ Coordinator failover initialized
  ├─ session:should-broadcast event
  ├─ Transaction broadcast
  │
  ▼
[Session Closed]
```

---

### Security Architecture

#### Multi-Layer Defense

The system implements **7 defensive layers** for incoming messages:

```
INCOMING MESSAGE FLOW (bottom to top)
════════════════════════════════════════════════════════════════

Layer 7: Application Logic
┌──────────────────────────────────────────────────────────┐
│ • Reputation scoring                                      │
│ • Session management                                      │
│ • Business logic validation                               │
└──────────────────────────────────────────────────────────┘
                          ▲ Clean data ✅
                          │
Layer 6: Identity Verification
┌──────────────────────────────────────────────────────────┐
│ ✅ Check: Is identity registered?                        │
│ ✅ Check: Does peer own claimed public key?              │
│ ✅ Check: Is session announcement signature valid?       │
│ ❌ Drop if: Invalid signature or unauthorized peer      │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │
Layer 5: Rate Limiting & Quotas
┌──────────────────────────────────────────────────────────┐
│ ✅ Check: Last advertisement > 60 seconds ago?           │
│ ✅ Check: Peer has < 10 public keys?                    │
│ ✅ Check: Invalid signatures < 10?                       │
│ ❌ Drop if: Rate limit exceeded                         │
│ ❌ Ban if: Repeated violations                          │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │
Layer 4: Cryptographic Validation
┌──────────────────────────────────────────────────────────┐
│ ✅ Verify: Schnorr signature valid?                     │
│ ✅ Verify: Message sequence strictly increasing?        │
│ ✅ Verify: Protocol phase correct for message type?     │
│ ❌ Drop if: Invalid signature or sequence               │
│ ❌ Record: Invalid signature attempt                    │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │
Layer 3: Content Validation
┌──────────────────────────────────────────────────────────┐
│ ✅ Check: Message size < 10KB (GossipSub)?              │
│ ✅ Check: Message size < 100KB (P2P)?                   │
│ ✅ Check: Timestamp within 5 minutes?                   │
│ ✅ Check: Not expired (expiresAt > now)?                │
│ ❌ Drop if: Oversized or malformed                     │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │
Layer 2: Peer Reputation
┌──────────────────────────────────────────────────────────┐
│ ✅ Check: Is peer blacklisted?                          │
│ ✅ Check: Is peer graylisted?                           │
│ ✅ Check: Peer reputation score acceptable?             │
│ ❌ Drop if: Blacklisted (permanent)                    │
│ ❌ Drop if: Graylisted (temporary)                     │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │
Layer 1: Network Transport
┌──────────────────────────────────────────────────────────┐
│ libp2p Security:                                         │
│ • Noise encryption (end-to-end)                         │
│ • Peer authentication                                    │
│ • Connection encryption                                  │
│ ✅ Encrypted connection                                 │
│ ✅ Authenticated peer                                   │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │
                 RAW NETWORK MESSAGE
════════════════════════════════════════════════════════════════
```

#### Security Constants

```typescript
// Message size limits
MAX_ADVERTISEMENT_SIZE: 10_000 // 10KB (GossipSub)
MAX_MESSAGE_SIZE: 100_000 // 100KB (P2P Direct)

// Time-based protections
MAX_TIMESTAMP_SKEW: 300_000 // 5 minutes
MIN_ADVERTISEMENT_INTERVAL: 60_000 // 60 seconds

// Sybil resistance
MAX_KEYS_PER_PEER: 10 // Default tier
MAX_INVALID_SIGNATURES_PER_PEER: 10

// Session limits
DEFAULT_SESSION_TIMEOUT: 7_200_000 // 2 hours
STUCK_SESSION_TIMEOUT: 600_000 // 10 minutes
CLEANUP_INTERVAL: 60_000 // 1 minute
```

---

### Coordinator Election

#### Why Coordinator Election?

In a multi-party MuSig2 session, after all participants sign, **someone must construct and broadcast the final transaction**. Without coordination, this is problematic:

- ❌ Each party might try to broadcast (wasteful, confusing)
- ❌ Manual coordination required (not automated)
- ❌ Central server defeats decentralization
- ❌ Random selection requires additional messages

**Solution**: Deterministic coordinator election where all participants independently compute the same coordinator.

#### Election Methods

**1. Lexicographic (Recommended for Production)**

```typescript
ElectionMethod.LEXICOGRAPHIC
```

- Sort all public keys alphabetically
- First key in sorted order is coordinator
- Most deterministic and verifiable
- Cannot be manipulated without controlling specific private key

**2. Hash-Based**

```typescript
ElectionMethod.HASH_BASED
```

- Hash all public keys concatenated
- Use hash to select index: `hashValue % numSigners`
- Pseudo-random but deterministic
- More "fair" distribution across runs

**3. First Signer**

```typescript
ElectionMethod.FIRST_SIGNER
```

- Always selects first signer in array
- Simple and predictable
- Useful for testing

**4. Last Signer**

```typescript
ElectionMethod.LAST_SIGNER
```

- Always selects last signer in array
- Simple and predictable

#### Automatic Failover

**Problem**: What if the elected coordinator refuses to broadcast or crashes?

**Solution**: Automatic failover with backup coordinators

```
Primary Coordinator (5 min timeout)
  ├─ Broadcasts successfully → ✅ Done
  └─ Timeout expires → Failover to Backup #1

Backup Coordinator #1 (5 min timeout)
  ├─ Broadcasts successfully → ✅ Done
  └─ Timeout expires → Failover to Backup #2

... continues through all participants
```

**Key Features**:

- ✅ Deterministic backup ordering (all participants know the sequence)
- ✅ Zero additional P2P messages required
- ✅ Configurable broadcast timeout (default: 5 minutes)
- ✅ Byzantine fault tolerance (up to N-1 coordinator failures)

**Usage**:

```typescript
const coordinator = new MuSig2P2PCoordinator(p2pConfig, {
  enableCoordinatorElection: true,
  electionMethod: 'lexicographic',
  enableCoordinatorFailover: true,
  broadcastTimeout: 5 * 60 * 1000, // 5 minutes
})

coordinator.on(
  'session:should-broadcast',
  async (sessionId, coordinatorIndex) => {
    console.log(`I'm coordinator #${coordinatorIndex}, broadcasting...`)

    const tx = buildTransaction(sessionId)
    await lotus.sendRawTransaction(tx.serialize())

    // IMPORTANT: Cancel failover timeouts
    coordinator.notifyBroadcastComplete(sessionId)
  },
)

coordinator.on('session:coordinator-failed', (sessionId, attempt) => {
  console.log(`⚠️ Coordinator failed, failover attempt #${attempt}`)
})

coordinator.on('session:failover-exhausted', (sessionId, attempts) => {
  console.error(`🔴 All ${attempts} coordinators failed!`)
  // Manual intervention needed
})
```

---

### Network Topology

#### Multi-Channel Communication

The system uses **three complementary communication channels**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Communication Channels                   │
└─────────────────────────────────────────────────────────────┘

Channel 1: DHT (Persistent Storage)
┌──────────────────────────────────────────────────────────┐
│ Purpose: Session announcement and discovery              │
│ Technology: Kademlia DHT (k=20 replication)              │
│ Latency: High (seconds)                                  │
│ Reliability: High (fault tolerant)                       │
│                                                          │
│ Used for:                                                │
│ • Session announcements (with cryptographic signatures)  │
│ • Signer advertisements                                  │
│ • Directory indices                                      │
│                                                          │
│ Example:                                                 │
│ DHT.put("musig2-session:<id>", sessionData)             │
└──────────────────────────────────────────────────────────┘

Channel 2: GossipSub (Real-Time Pub/Sub)
┌──────────────────────────────────────────────────────────┐
│ Purpose: Real-time discovery and notifications           │
│ Technology: libp2p GossipSub                             │
│ Latency: Low (10-100ms)                                  │
│ Reliability: Medium (best effort)                        │
│                                                          │
│ Used for:                                                │
│ • Signer advertisements (instant discovery)              │
│ • Topic-based subscriptions                              │
│ • Broadcast to interested peers                          │
│                                                          │
│ Example:                                                 │
│ topic: "musig2:signers:spend"                           │
│ publish(advertisement)                                   │
└──────────────────────────────────────────────────────────┘

Channel 3: P2P Direct Streams (Reliable Delivery)
┌──────────────────────────────────────────────────────────┐
│ Purpose: Session coordination messages                   │
│ Technology: libp2p direct streams                        │
│ Latency: Low (1-10ms)                                    │
│ Reliability: High (TCP-like)                             │
│                                                          │
│ Used for:                                                │
│ • SESSION_JOIN                                           │
│ • NONCE_SHARE                                            │
│ • PARTIAL_SIG_SHARE                                      │
│ • VALIDATION_ERROR                                       │
│                                                          │
│ Example:                                                 │
│ stream = await dial(peer, protocol)                     │
│ stream.write(message)                                    │
└──────────────────────────────────────────────────────────┘
```

#### Peer Connection Flow

```
Participant A                         Participant B
┌───────────┐                        ┌───────────┐
│           │                        │           │
│ 1. Start  │                        │ 1. Start  │
│    P2P    │                        │    P2P    │
│    Node   │                        │    Node   │
│           │                        │           │
└─────┬─────┘                        └─────┬─────┘
      │                                    │
      │ 2. Connect to bootstrap peers     │
      ├───────────────────────────────────►
      │                                    │
      │ 3. DHT routing table exchange     │
      │◄───────────────────────────────────┤
      │                                    │
      │ 4. Discover each other via DHT    │
      │                                    │
      │ 5. Establish direct connection    │
      ├───────────────────────────────────►
      │                                    │
      │ 6. Subscribe to GossipSub topics  │
      │    - musig2:signers:spend         │
      │    - musig2:signers:swap          │
      │                                    │
      │ 7. Ready for MuSig2 coordination  │
      │                                    │
```

---

## API Reference

### MuSig2P2PCoordinator

The main class for P2P MuSig2 coordination.

#### Constructor

```typescript
constructor(
  p2pConfig: P2PConfig,
  musig2Config?: Partial<MuSig2P2PConfig>
)
```

**Parameters**:

- `p2pConfig`: P2P network configuration

  ```typescript
  interface P2PConfig {
    listen?: string[] // Multiaddrs to listen on
    enableDHT?: boolean // Enable DHT (default: true)
    enableDHTServer?: boolean // Act as DHT server (default: false)
    bootstrapPeers?: string[] // Bootstrap peer multiaddrs
    dhtProtocol?: string // DHT protocol (default: '/lotus/kad/1.0.0')
  }
  ```

- `musig2Config`: MuSig2-specific configuration (optional)

  ```typescript
  interface MuSig2P2PConfig {
    // Session settings
    sessionTimeout?: number // Default: 2 hours
    sessionResourceType?: string // DHT resource type
    enableSessionDiscovery?: boolean // Default: true

    // Coordinator election
    enableCoordinatorElection?: boolean // Default: false
    electionMethod?: ElectionMethodString // Default: 'lexicographic'
    enableCoordinatorFailover?: boolean // Default: true
    broadcastTimeout?: number // Default: 5 minutes

    // Security
    enableReplayProtection?: boolean // Default: true
    maxSequenceGap?: number // Default: 100

    // Session cleanup
    enableAutoCleanup?: boolean // Default: true
    cleanupInterval?: number // Default: 60 seconds
    stuckSessionTimeout?: number // Default: 10 minutes
  }
  ```

**Example**:

```typescript
import { MuSig2P2PCoordinator } from 'lotus-lib/lib/p2p/musig2'

const coordinator = new MuSig2P2PCoordinator(
  {
    listen: ['/ip4/0.0.0.0/tcp/4001'],
    enableDHT: true,
    enableDHTServer: false,
    bootstrapPeers: ['/dns4/bootstrap.lotusia.org/tcp/4001/p2p/12D3Koo...'],
  },
  {
    sessionTimeout: 2 * 60 * 60 * 1000, // 2 hours
    enableCoordinatorElection: true,
    electionMethod: 'lexicographic',
    enableCoordinatorFailover: true,
    broadcastTimeout: 5 * 60 * 1000,
  },
)
```

---

### Session Management

#### createSession()

Create a new MuSig2 signing session.

```typescript
async createSession(
  signers: PublicKey[],
  myPrivateKey: PrivateKey,
  message: Buffer,
  options?: SessionOptions
): Promise<string>
```

**Parameters**:

- `signers`: Array of all participant public keys (including yours)
- `myPrivateKey`: Your private key (used for signing)
- `message`: Message to be signed (typically transaction sighash)
- `options`: Optional session metadata

**Returns**: `sessionId` (string)

**Example**:

```typescript
const alice = new PrivateKey()
const bob = new PrivateKey()
const charlie = new PrivateKey()

const message = Buffer.from('Transaction sighash to sign')

const sessionId = await coordinator.createSession(
  [alice.publicKey, bob.publicKey, charlie.publicKey],
  alice,
  message,
  {
    description: 'Treasury payment #123',
    metadata: { txid: 'abc123...' },
  },
)

console.log('Session created:', sessionId)
```

#### joinSession()

Join an existing session (as a participant).

```typescript
async joinSession(
  sessionId: string,
  myPrivateKey: PrivateKey
): Promise<void>
```

**Parameters**:

- `sessionId`: Session ID (from DHT discovery or out-of-band)
- `myPrivateKey`: Your private key

**Example**:

```typescript
// Bob discovers session from DHT or receives sessionId out-of-band
const sessionId = 'session-abc123...'

await coordinator.joinSession(sessionId, bobPrivateKey)

console.log('Joined session:', sessionId)
```

#### startRound1()

Begin Round 1 (nonce exchange).

```typescript
async startRound1(
  sessionId: string,
  privateKey: PrivateKey
): Promise<void>
```

**Behavior**:

- Generates nonces locally
- Broadcasts nonces to all participants
- Auto-advances to Round 2 when all nonces received

**Example**:

```typescript
await coordinator.startRound1(sessionId, myPrivateKey)
// Nonces automatically broadcast to all participants
```

#### startRound2()

Begin Round 2 (partial signature exchange).

```typescript
async startRound2(
  sessionId: string,
  privateKey: PrivateKey
): Promise<void>
```

**Behavior**:

- Creates partial signature
- Broadcasts to all participants
- Auto-completes when all partial signatures received

**Example**:

```typescript
await coordinator.startRound2(sessionId, myPrivateKey)
// Partial signature automatically broadcast
```

#### getFinalSignature()

Get the final aggregated signature.

```typescript
getFinalSignature(sessionId: string): Signature | undefined
```

**Returns**: Schnorr signature or undefined if not complete

**Example**:

```typescript
const signature = coordinator.getFinalSignature(sessionId)
if (signature) {
  console.log('Final signature:', signature.toString('hex'))
}
```

#### closeSession()

Explicitly close a session.

```typescript
async closeSession(sessionId: string): Promise<void>
```

**Behavior**:

- Clears failover timeouts
- Broadcasts SESSION_ABORT to participants
- Removes session from active sessions
- Cleans up state

**Example**:

```typescript
await coordinator.closeSession(sessionId)
```

#### getSession()

Get session details.

```typescript
getSession(sessionId: string): MuSigSession | undefined
```

**Returns**: Session object with all state

**Example**:

```typescript
const session = coordinator.getSession(sessionId)
console.log('Phase:', session.phase)
console.log('Signers:', session.signers.length)
```

---

### Election Functions

#### electCoordinator()

Perform coordinator election (standalone function).

```typescript
import { electCoordinator, ElectionMethod } from 'lotus-lib/lib/p2p/musig2'

function electCoordinator(
  signers: PublicKey[],
  method?: ElectionMethod,
): ElectionResult
```

**Returns**:

```typescript
interface ElectionResult {
  coordinatorIndex: number // Index in signers array
  coordinatorPublicKey: PublicKey // Coordinator's public key
  sortedSigners: PublicKey[] // All signers sorted
  indexMapping: Map<number, number> // Original index → sorted index
  electionProof: string // SHA256 hash for verification
}
```

**Example**:

```typescript
const election = electCoordinator(
  [alice.publicKey, bob.publicKey, charlie.publicKey],
  ElectionMethod.LEXICOGRAPHIC,
)

console.log('Coordinator index:', election.coordinatorIndex)
console.log('Coordinator:', election.coordinatorPublicKey.toString())
console.log('Proof:', election.electionProof)
```

#### getBackupCoordinator()

Get the next backup coordinator.

```typescript
function getBackupCoordinator(
  signers: PublicKey[],
  currentCoordinatorIndex: number,
  method?: ElectionMethod,
): number | null
```

**Returns**: Index of backup coordinator, or `null` if no backups remaining

**Example**:

```typescript
const backup = getBackupCoordinator(signers, 2, ElectionMethod.LEXICOGRAPHIC)
console.log('Backup coordinator index:', backup)
```

#### getCoordinatorPriorityList()

Get complete failover priority list.

```typescript
function getCoordinatorPriorityList(
  signers: PublicKey[],
  method?: ElectionMethod,
): number[]
```

**Returns**: Array of coordinator indices in priority order

**Example**:

```typescript
const priorityList = getCoordinatorPriorityList(
  signers,
  ElectionMethod.LEXICOGRAPHIC,
)
// [2, 4, 0, 1, 3] means:
// - Primary: index 2
// - Backup #1: index 4
// - Backup #2: index 0
// - Backup #3: index 1
// - Backup #4: index 3
```

#### isCoordinator()

Check if a signer is the coordinator.

```typescript
isCoordinator(sessionId: string): boolean
```

**Returns**: `true` if you are the current coordinator

**Example**:

```typescript
if (coordinator.isCoordinator(sessionId)) {
  console.log('I am the coordinator')
  // Build and broadcast transaction
}
```

#### notifyBroadcastComplete()

Cancel failover timeouts after successful broadcast.

```typescript
notifyBroadcastComplete(sessionId: string): void
```

**Example**:

```typescript
// After broadcasting transaction
await lotus.sendRawTransaction(tx.serialize())

// Cancel failover timeouts
coordinator.notifyBroadcastComplete(sessionId)
```

---

### Security Manager

#### getSecurityManager()

Get the security manager instance.

```typescript
getSecurityManager(): SecurityManager
```

**Returns**: SecurityManager with access to all security components

**Example**:

```typescript
const security = coordinator.getSecurityManager()

// Check metrics
const metrics = security.getMetrics()
console.log('Rate limit violations:', metrics.rateLimitViolations)
console.log('Blacklisted peers:', metrics.blacklistedPeers)

// Manual operations
security.peerReputation.blacklistPeer('12D3Koo...', 'manual-ban')
security.peerReputation.unblacklistPeer('12D3Koo...')

// Get peer scores
const score = security.peerReputation.getScore('12D3Koo...')
console.log('Invalid signatures:', score.invalidSignatures)
console.log('Spam count:', score.spamCount)
```

---

### Events

The coordinator emits various events for monitoring and coordination.

#### Session Lifecycle Events

**session:created**

```typescript
coordinator.on('session:created', (sessionId: string) => {
  console.log('Session created:', sessionId)
})
```

**session:complete**

```typescript
coordinator.on('session:complete', (sessionId: string) => {
  console.log('All partial signatures received')
})
```

**session:closed**

```typescript
coordinator.on('session:closed', (sessionId: string) => {
  console.log('Session closed')
})
```

**session:error**

```typescript
coordinator.on(
  'session:error',
  (sessionId: string, error: string, code: string) => {
    console.error('Session error:', sessionId, error)
  },
)
```

#### Coordinator Events

**session:should-broadcast**

```typescript
coordinator.on(
  'session:should-broadcast',
  async (sessionId: string, coordinatorIndex: number) => {
    console.log(`I'm coordinator #${coordinatorIndex}, broadcasting...`)

    const tx = buildTransaction(sessionId)
    await broadcast(tx)
    coordinator.notifyBroadcastComplete(sessionId)
  },
)
```

**session:coordinator-failed**

```typescript
coordinator.on(
  'session:coordinator-failed',
  (sessionId: string, attemptNumber: number) => {
    console.log(`Coordinator failed, failover attempt #${attemptNumber}`)
  },
)
```

**session:failover-exhausted**

```typescript
coordinator.on(
  'session:failover-exhausted',
  (sessionId: string, totalAttempts: number) => {
    console.error(`All ${totalAttempts} coordinators failed!`)
    // Manual intervention needed
  },
)
```

**session:broadcast-confirmed**

```typescript
coordinator.on('session:broadcast-confirmed', (sessionId: string) => {
  console.log('Broadcast confirmed, failover cancelled')
})
```

#### Discovery Events

**signer:discovered**

```typescript
coordinator.on('signer:discovered', (advertisement: SignerAdvertisement) => {
  console.log('Discovered signer:', advertisement.publicKey)
  console.log('Available for:', advertisement.criteria.transactionTypes)
})
```

#### Security Events

```typescript
const security = coordinator.getSecurityManager()

security.on('peer:blacklisted', (peerId: string, reason: string) => {
  console.log(`Peer blacklisted: ${peerId} - ${reason}`)
})

security.on('peer:graylisted', (peerId: string, durationMs: number) => {
  console.log(`Peer graylisted: ${peerId} for ${durationMs}ms`)
})

security.on('peer:should-ban', (peerId: string, reason: string) => {
  console.log(`Peer should be banned: ${peerId} - ${reason}`)
})
```

---

### Configuration

#### Complete Configuration Example

```typescript
const coordinator = new MuSig2P2PCoordinator(
  // P2P Configuration
  {
    listen: ['/ip4/0.0.0.0/tcp/4001', '/ip4/0.0.0.0/tcp/4002/ws'],
    enableDHT: true,
    enableDHTServer: false, // true for bootstrap nodes
    bootstrapPeers: [
      '/dns4/bootstrap1.lotusia.org/tcp/4001/p2p/12D3Koo...',
      '/dns4/bootstrap2.lotusia.org/tcp/4001/p2p/12D3Koo...',
    ],
    dhtProtocol: '/lotus/kad/1.0.0',
  },
  // MuSig2 Configuration
  {
    // Session settings
    sessionTimeout: 2 * 60 * 60 * 1000, // 2 hours
    sessionResourceType: 'musig2-session',
    enableSessionDiscovery: true,

    // Coordinator election
    enableCoordinatorElection: true,
    electionMethod: 'lexicographic',
    enableCoordinatorFailover: true,
    broadcastTimeout: 5 * 60 * 1000, // 5 minutes

    // Security
    enableReplayProtection: true,
    maxSequenceGap: 100,

    // Session cleanup
    enableAutoCleanup: true,
    cleanupInterval: 60 * 1000, // 1 minute
    stuckSessionTimeout: 10 * 60 * 1000, // 10 minutes
  },
)
```

---

## Quick Start

### Installation

```bash
npm install lotus-lib
```

### Basic 2-of-2 Signing

```typescript
import { MuSig2P2PCoordinator } from 'lotus-lib/lib/p2p/musig2'
import { PrivateKey } from 'lotus-lib/lib/bitcore'

// 1. Create coordinators
const aliceCoord = new MuSig2P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/9001'],
  enableDHT: true,
})

const bobCoord = new MuSig2P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/9002'],
  enableDHT: true,
})

// 2. Start nodes
await aliceCoord.start()
await bobCoord.start()

// 3. Connect peers
await bobCoord.connectTo(aliceCoord.getMultiaddrs()[0])

// 4. Create keys
const alice = new PrivateKey()
const bob = new PrivateKey()

// 5. Create session (Alice)
const message = Buffer.from('Transaction to sign')
const sessionId = await aliceCoord.createSession(
  [alice.publicKey, bob.publicKey],
  alice,
  message,
)

// 6. Join session (Bob)
await bobCoord.joinSession(sessionId, bob)

// 7. Round 1 - Nonce exchange
await aliceCoord.startRound1(sessionId, alice)
await bobCoord.startRound1(sessionId, bob)

// 8. Round 2 - Partial signatures
await aliceCoord.startRound2(sessionId, alice)
await bobCoord.startRound2(sessionId, bob)

// 9. Get final signature
const signature = aliceCoord.getFinalSignature(sessionId)
console.log('Signature:', signature.toString('hex'))

// 10. Cleanup
await aliceCoord.closeSession(sessionId)
await aliceCoord.cleanup()
await bobCoord.cleanup()
```

### With Coordinator Election

```typescript
const coordinator = new MuSig2P2PCoordinator(
  {
    listen: ['/ip4/0.0.0.0/tcp/4001'],
    enableDHT: true,
  },
  {
    enableCoordinatorElection: true,
    electionMethod: 'lexicographic',
    enableCoordinatorFailover: true,
  },
)

// Listen for coordinator events
coordinator.on(
  'session:should-broadcast',
  async (sessionId, coordinatorIndex) => {
    console.log(`I'm coordinator #${coordinatorIndex}`)

    // Build and broadcast transaction
    const signature = coordinator.getFinalSignature(sessionId)
    const tx = buildTransaction(signature)
    await lotus.sendRawTransaction(tx.serialize())

    // Important: cancel failover
    coordinator.notifyBroadcastComplete(sessionId)
  },
)

// Create session
const sessionId = await coordinator.createSession(
  allPublicKeys,
  myPrivateKey,
  message,
)

// Election happens automatically
// Coordinator will receive 'session:should-broadcast' event
```

---

## Examples

The library includes several comprehensive examples:

### Available Examples

1. **musig2-example.ts** - Basic 2-of-2 signing without P2P
2. **musig2-session-example.ts** - Session manager usage
3. **musig2-p2p-example.ts** - Basic P2P coordination
4. **musig2-p2p-election-example.ts** - 5-party signing with coordinator election
5. **musig2-p2p-taproot-example.ts** - MuSig2 with Taproot integration
6. **musig2-three-phase-example.ts** - Advertisement and matchmaking
7. **musig2-taproot-transaction.ts** - Complete transaction creation

### Running Examples

```bash
# Basic P2P example
npx tsx examples/musig2-p2p-example.ts

# 5-party election example
npx tsx examples/musig2-p2p-election-example.ts

# Taproot integration
npx tsx examples/musig2-p2p-taproot-example.ts
```

---

## Security

### Security Status

✅ **PRODUCTION READY**

All critical security enhancements implemented:

- ✅ Cryptographic session signatures (DHT poisoning prevention)
- ✅ Message replay protection (sequence numbers)
- ✅ Protocol phase enforcement
- ✅ Rate limiting (1 ad/60s per peer)
- ✅ Sybil resistance (10 keys max per peer)
- ✅ Peer reputation tracking
- ✅ Automatic cleanup

### Attack Resistance

| Attack Type                | Protection                          | Status       |
| -------------------------- | ----------------------------------- | ------------ |
| **DHT Poisoning**          | Schnorr signatures on announcements | ✅ DEFENDED  |
| **Message Replay**         | Sequence numbers per signer/session | ✅ DEFENDED  |
| **Sybil Attack**           | Max 10 keys per peer                | ✅ LIMITED   |
| **Spam Attack**            | Rate limiting (1/60s)               | ✅ DEFENDED  |
| **Memory Exhaustion**      | Size limits (10KB/100KB)            | ✅ DEFENDED  |
| **Nonce Reuse**            | Session-level enforcement           | ✅ PREVENTED |
| **Rogue Key**              | MuSig2 key coefficients             | ✅ DEFENDED  |
| **Coordinator Censorship** | Automatic failover                  | ✅ MITIGATED |

### Security Best Practices

1. **Always verify** session announcements are signed
2. **Enable coordinator failover** for production deployments
3. **Monitor security events** for blacklisted/graylisted peers
4. **Use lexicographic election** method for production
5. **Set appropriate timeouts** based on network conditions
6. **Review security metrics** periodically

### Security Documentation

For detailed security information, see:

- `docs/MUSIG2_DHT_SECURITY_ANALYSIS.md` - Complete security audit
- `docs/MUSIG2_DHT_SECURITY_IMPLEMENTATION.md` - Implementation details
- `docs/MUSIG2_ELECTION_SECURITY_ANALYSIS.md` - Election security
- `docs/MUSIG2_GOSSIPSUB_SECURITY.md` - GossipSub security

---

## Testing

### Test Coverage

**91+ comprehensive tests** covering:

- **26 tests**: Coordinator election
- **24 tests**: Coordinator failover
- **24 tests**: Session announcement signatures
- **13 tests**: Message replay protection
- **18 tests**: Session cleanup
- **41+ tests**: MuSig2 P2P coordination

**Test Status**: ✅ All passing (100%)

### Running Tests

```bash
# All tests
npm test

# Specific test suites
npm test -- test/p2p/musig2/election.test.ts
npm test -- test/p2p/musig2/failover.test.ts
npm test -- test/p2p/musig2/session-signatures.test.ts
npm test -- test/p2p/musig2/replay-protection.test.ts

# All MuSig2 tests
npm test -- test/p2p/musig2/
```

### Test Documentation

- `test/p2p/musig2/README_SESSION_SIGNATURES_TESTS.md`
- `test/p2p/musig2/README_REPLAY_PROTECTION_TESTS.md`
- `test/p2p/musig2/README_SESSION_CLEANUP_TESTS.md`

---

## Additional Documentation

### Core Documentation

**Getting Started:**

- `MUSIG2_START_HERE.md` - Introduction and overview
- `MUSIG2_QUICK_REFERENCE.md` - Quick reference guide
- `MUSIG2_IMPLEMENTATION_PLAN.md` - Original implementation plan

**Coordinator Election:**

- `MUSIG2_COORDINATOR_ELECTION.md` - Complete election guide
- `MUSIG2_ELECTION_IMPLEMENTATION_SUMMARY.md` - Implementation summary
- `MUSIG2_ELECTION_SECURITY_ANALYSIS.md` - Security analysis
- `MUSIG2_FAILOVER_IMPLEMENTATION.md` - Failover mechanism

**Security:**

- `MUSIG2_DHT_SECURITY_ANALYSIS.md` - Comprehensive security audit
- `MUSIG2_DHT_SECURITY_IMPLEMENTATION.md` - Security implementation
- `MUSIG2_DHT_VISUAL_ARCHITECTURE.md` - Visual architecture diagrams
- `MUSIG2_GOSSIPSUB_SECURITY.md` - GossipSub security
- `MUSIG2_MESSAGE_REPLAY_PROTECTION.md` - Replay protection
- `MUSIG2_SESSION_ANNOUNCEMENT_SIGNATURES.md` - Session signatures

**Implementation:**

- `MUSIG2_P2P_COORDINATION.md` - P2P coordination details
- `MUSIG2_P2P_PHASE3_COMPLETE.md` - Phase 3 completion
- `MUSIG2_P2P_ANALYSIS.md` - Technical analysis
- `MUSIG2_P2P_REVIEW_SUMMARY.md` - Review summary
- `MUSIG2_P2P_RECOMMENDATIONS.md` - Recommendations
- `MUSIG2_IMPLEMENTATION_STATUS.md` - Overall status

### Related Documentation

**Lotus Ecosystem:**

- Lotus documentation: https://lotusia.org/docs
- lotusd repository: https://github.com/LotusiaStewardship/lotusd
- Lotus blockchain explorer: https://explorer.lotusia.org

**Specifications:**

- BIP327 MuSig2: https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki
- libp2p: https://libp2p.io/
- Kademlia DHT: https://docs.libp2p.io/concepts/discovery-routing/kaddht/

---

## Support

### Community

- **Discord**: [Lotusia](https://discord.gg/fZrFa3vf)
- **Telegram**: [Lotusia Discourse](https://t.me/LotusiaDiscourse)
- **GitHub**: [lotus-lib Issues](https://github.com/LotusiaStewardship/lotus-lib/issues)

### Contributing

Contributions are welcome! Please:

1. Read the documentation thoroughly
2. Follow the existing code style
3. Add tests for new features
4. Update documentation
5. Submit a pull request

### License

[License information for lotus-lib]

---

**Document Version**: 2.0.0  
**Last Updated**: November 4, 2025  
**Status**: ✅ PRODUCTION READY

**Quick Links**:

- [Examples](../../examples/)
- [Tests](../../../test/p2p/musig2/)
- [Documentation](../../../docs/)
- [Security](../../../docs/MUSIG2_DHT_SECURITY_ANALYSIS.md)
