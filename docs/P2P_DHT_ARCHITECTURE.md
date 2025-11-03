# P2P DHT Architecture and MuSig2 Coordination

**Version**: 1.0.0  
**Date**: November 1, 2025  
**Status**: Complete Documentation

---

## Table of Contents

1. [Overview](#overview)
2. [Kademlia DHT Fundamentals](#kademlia-dht-fundamentals)
3. [libp2p DHT Implementation](#libp2p-dht-implementation)
4. [Lotus DHT Architecture](#lotus-dht-architecture)
5. [Visual DHT Structure](#visual-dht-structure)
6. [DHT State and Lifecycle](#dht-state-and-lifecycle)
7. [MuSig2 Coordination via DHT](#musig2-coordination-via-dht)
8. [Network Communication Patterns](#network-communication-patterns)
9. [Technical Implementation Details](#technical-implementation-details)
10. [Performance and Scaling](#performance-and-scaling)

---

## Overview

The **Distributed Hash Table (DHT)** in lotus-lib provides the foundational infrastructure for decentralized peer-to-peer coordination. This document explains how the DHT is constructed, what it looks like both conceptually and technically, and how individual nodes communicate to facilitate MuSig2 multi-signature coordination.

**Key Components:**

- **Kademlia DHT**: Industry-standard distributed hash table algorithm
- **libp2p kad-dht**: Production-ready implementation used by IPFS, Filecoin, Ethereum 2.0
- **Resource Announcements**: Session discovery and coordination metadata
- **Direct Messaging**: Point-to-point communication for cryptographic material exchange

**Design Goals:**

1. **Decentralized Discovery**: No central server required for session coordination
2. **Resilient**: Network continues functioning even with node failures
3. **Scalable**: Efficient routing with O(log n) lookup complexity
4. **Secure**: Cryptographic authentication and validation at all layers

---

## Kademlia DHT Fundamentals

### What is a DHT?

A **Distributed Hash Table** is a decentralized data structure that provides:

- **Key-Value Storage**: Distributed across network nodes
- **Efficient Lookups**: Logarithmic time complexity O(log n)
- **Self-Organization**: Nodes join/leave dynamically without coordination
- **Fault Tolerance**: Data replicated across multiple nodes

### Kademlia Algorithm

Kademlia is a specific DHT algorithm with these characteristics:

**1. Node IDs and XOR Distance Metric**

```
Each node has a 256-bit ID (SHA-256 hash)

Distance between two IDs:
d(A, B) = A ⊕ B (bitwise XOR)

Example:
Node A: 1010101010...
Node B: 1011001010...
Distance: 0001100000... (smaller = closer)
```

**2. Routing Table Structure**

Each node maintains a routing table organized into **k-buckets**:

```
k-bucket[i] contains nodes at distance 2^i to 2^(i+1) - 1

Routing Table (256 k-buckets):
┌─────────────────────────────────────────┐
│ k-bucket[0]:  distance 2^0  to 2^1  - 1 │ ← Closest nodes
│ k-bucket[1]:  distance 2^1  to 2^2  - 1 │
│ k-bucket[2]:  distance 2^2  to 2^3  - 1 │
│ ...                                     │
│ k-bucket[255]: distance 2^255 to 2^256 │ ← Furthest nodes
└─────────────────────────────────────────┘

Each k-bucket holds up to k peers (typically k=20)
```

**3. Lookup Algorithm**

When searching for a key, nodes perform iterative lookups:

```
1. Find k closest nodes to target key from local routing table
2. Query those nodes for even closer nodes
3. Repeat until target is found or no closer nodes exist
4. Complexity: O(log n) queries across the network
```

**4. Data Storage and Retrieval**

```
PUT(key, value):
  1. Compute nodeID = SHA256(key)
  2. Find k closest nodes to nodeID
  3. Store value on those k nodes (replication)

GET(key):
  1. Compute nodeID = SHA256(key)
  2. Query k closest nodes to nodeID
  3. Return first valid value found
```

### Why Kademlia?

**Advantages for P2P Networks:**

✅ **Efficient Routing**: O(log n) lookup complexity  
✅ **Symmetric Distance**: XOR metric is symmetric (d(A,B) = d(B,A))  
✅ **Flexible Topology**: Nodes can join/leave without disruption  
✅ **Load Balancing**: Uniform distribution of keys across nodes  
✅ **Redundancy**: Automatic replication across multiple nodes

**Used By:**

- BitTorrent (Mainline DHT)
- IPFS (InterPlanetary File System)
- Ethereum 2.0 (Peer Discovery)
- Storj (Decentralized Storage)

---

## libp2p DHT Implementation

### Architecture

lotus-lib uses `@libp2p/kad-dht`, the standard Kademlia DHT implementation for libp2p:

```typescript
import { kadDHT, KadDHT } from '@libp2p/kad-dht'

// DHT is configured as a libp2p service
const config = {
  services: {
    kadDHT: kadDHT({
      protocol: '/lotus/kad/1.0.0', // Protocol identifier
      clientMode: false, // Server mode: participate in DHT
      peerInfoMapper: passthroughMapper, // Address filtering
    }),
  },
}
```

### Operating Modes

**1. Server Mode** (`clientMode: false`)

```
✅ Participates in DHT network
✅ Routes queries for other peers
✅ Stores key-value pairs from network
✅ Responds to DHT queries
✅ Contributes to network health

Use Case: Long-running nodes, bootstrap nodes
```

**2. Client Mode** (`clientMode: true`)

```
✅ Queries DHT network
❌ Does NOT route queries
❌ Does NOT store network data
❌ Does NOT respond to queries
✅ Lightweight operation

Use Case: Mobile clients, ephemeral nodes
```

### DHT Lifecycle

```
┌──────────────────────────────────────────────────────────┐
│                    DHT Lifecycle                         │
└──────────────────────────────────────────────────────────┘

1. INITIALIZATION
   ├─ Node starts libp2p
   ├─ DHT service initializes
   └─ Routing table empty (routingTableSize = 0)

2. BOOTSTRAP
   ├─ Connect to bootstrap peers
   ├─ Exchange peer information via identify protocol
   └─ Bootstrap peers added to routing table

3. AUTO-POPULATION (TopologyListener)
   ├─ When peer connects + identify completes
   ├─ Peer automatically added to routing table
   ├─ Triggered by peerInfoMapper validation
   └─ routingTableSize increases

4. READY STATE (isReady = true)
   ├─ Routing table has ≥ 1 peer
   ├─ DHT queries can now succeed
   └─ PUT/GET operations enabled

5. MAINTENANCE
   ├─ Periodic refresh of routing table
   ├─ Dead peer removal
   └─ Key replication

6. SHUTDOWN
   ├─ Stop DHT service
   ├─ Close all connections
   └─ Clear routing table
```

### TopologyListener Auto-Population

**Critical Mechanism: Automatic Routing Table Population**

When a peer connects and identify completes:  
`TopologyListener → peerInfoMapper → RoutingTable.add()`

```

Connection Flow:
┌────────────────────────────────────────────────────────┐
│ 1. peer:connect event fires                            │
│ 2. libp2p identify protocol runs                       │
│ 3. Peer's multiaddrs discovered                        │
│ 4. peerInfoMapper validates addresses                  │
│    - passthroughMapper: Allow all (localhost dev)      │
│    - removePrivateAddressesMapper: Public only         │
│ 5. If valid → Peer added to DHT routing table          │
│ 6. routingTableSize increases                          │
│ 7. isReady becomes true when size ≥ 1                  │
└────────────────────────────────────────────────────────┘
```

**Why This Matters:**

- No manual routing table management required
- Peers automatically discover each other for DHT operations
- Works with both localhost (dev) and public networks (production)
- Graceful handling of network partitions

---

## Lotus DHT Architecture

### Configuration

```typescript
// P2PCoordinator with DHT enabled
const coordinator = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/4001'],
  enableDHT: true, // Enable Kademlia DHT
  enableDHTServer: true, // Server mode (participate)
  dhtProtocol: '/lotus/kad/1.0.0', // Protocol identifier
  dhtPeerInfoMapper: passthroughMapper, // Address filtering
})

await coordinator.start()
```

### DHT Statistics

Real-time monitoring via `getDHTStats()`:

```typescript
interface DHTStats {
  enabled: boolean              // DHT enabled?
  mode: 'client' | 'server'    // Operating mode
  routingTableSize: number     // Peers in routing table
  isReady: boolean             // routingTableSize > 0?
}

// Example usage
const stats = coordinator.getDHTStats()
if (stats.isReady) {
  // Safe to perform DHT operations
  await coordinator.announceResource(...)
}
```

### Resource Management

**Resource Announcement Structure:**

```typescript
interface ResourceAnnouncement<T> {
  resourceId: string // Unique ID (e.g., session ID)
  resourceType: string // Type (e.g., 'musig2-session')
  creatorPeerId: string // Announcing peer
  data: T // Arbitrary metadata
  createdAt: number // Unix timestamp
  expiresAt?: number // Optional expiration
  signature?: Buffer // Optional cryptographic signature
}
```

**Announcement Flow:**

```typescript
// Announce session to DHT
await coordinator.announceResource(
  'musig2-session', // resourceType
  'session-abc123', // resourceId
  {
    signers: ['pubkey1', 'pubkey2', 'pubkey3'],
    message: 'message-hash',
    requiredSigners: 3,
  },
  { ttl: 3600 }, // Optional expiration (1 hour)
)

// Internal process:
// 1. Create ResourceAnnouncement object
// 2. Store in local cache (dhtValues Map)
// 3. If DHT server mode + routing table ready:
//    - Compute key = "resource:musig2-session:session-abc123"
//    - Put key-value in DHT network
//    - Replicate to k closest nodes
```

**Discovery Flow:**

```typescript
// Discover session from DHT network
const session = await coordinator.discoverResource(
  'musig2-session', // resourceType
  'session-abc123', // resourceId
  5000, // timeout (5 seconds)
)

// Internal process:
// 1. Check local cache first (fast path)
// 2. If not found and DHT ready:
//    - Query DHT network for key
//    - Iterate through DHT GET responses
//    - Cache first valid result
//    - Return announcement
```

### Failsafe Mechanisms

**Routing Table Check Before DHT Operations:**

```typescript
// From coordinator.ts:
async announceResource(...) {
  // Store locally first
  this.dhtValues.set(key, announcement)

  // Only propagate to DHT if routing table has peers
  if (this.node.services.kadDHT && this.config.enableDHTServer) {
    const dhtStats = this.getDHTStats()

    if (dhtStats.isReady) {
      // Safe: routing table has peers
      await this._putDHT(keyBytes, valueBytes, 5000)
    }
    // Else: Skip DHT, resource in local cache
  }
}
```

**Why This Pattern?**

- Prevents hanging during startup (routing table still empty)
- Handles network partitions gracefully
- Works with TopologyListener auto-population
- Local cache ensures data availability even without DHT

---

## Visual DHT Structure

### Network Topology

```
    ┌─────────────────────────────────────────────┐
    │         Lotus P2P DHT Network               │
    └─────────────────────────────────────────────┘

    Node A                Node B                Node C
  ┌─────────┐          ┌─────────┐          ┌─────────┐
  │ Peer ID │          │ Peer ID │          │ Peer ID │
  │ 0x3A... │◄────────►│ 0x7B... │◄────────►│ 0x9C... │
  └─────────┘          └─────────┘          └─────────┘
      ▲                    ▲                     ▲
      │                    │                     │
      │         ┌──────────┴──────────┐          │
      │         │                     │          │
      │         ▼                     ▼          │
      │    ┌─────────┐          ┌─────────┐      │
      └───►│ Peer ID │          │ Peer ID │◄─────┘
           │ 0xD4... │◄────────►│ 0xE5... │
           └─────────┘          └─────────┘
             Node D                Node E

Each node maintains connections to multiple peers
DHT routing table directs queries to appropriate nodes
```

### Routing Table Structure (Single Node)

```
┌────────────────────────────────────────────────────────────────┐
│                    Node A (0x3A...)                            │
│                    Routing Table                               │
├────────────────────────────────────────────────────────────────┤
│ k-bucket[0]:  [Node B: 0x7B...]  ← Distance: 0x49 (closest)    │
│ k-bucket[1]:  [Node E: 0xE5...]  ← Distance: 0xDF              │
│ k-bucket[2]:  [Node C: 0x9C...]  ← Distance: 0xA6              │
│ k-bucket[3]:  []                 ← Empty bucket                │
│ ...                                                            │
│ k-bucket[255]: [Node D: 0xD4...] ← Distance: 0xFE (furthest)   │
└────────────────────────────────────────────────────────────────┘

XOR Distance Calculation:
  Node A: 0x3A... (this node)
  Node B: 0x7B...
  Distance: 0x3A ⊕ 0x7B = 0x49
```

### DHT Key Distribution

```
DHT Key Space (256-bit):
┌────────────────────────────────────────────────────────────┐
│ 0x00...                                         0xFF...    │
│ ├──────┬──────┬──────┬──────┬──────┬──────┬──────┤       │
│ │      │      │      │      │      │      │      │        │
│ │ N1   │ N2   │ N3   │ N4   │ N5   │ N6   │ N7   │...     │
│ │      │      │      │      │      │      │      │        │
│ └──────┴──────┴──────┴──────┴──────┴──────┴──────┘        │
└────────────────────────────────────────────────────────────┘

Keys are uniformly distributed across the ID space
Each node is responsible for keys closest to its ID

Example Resource Keys:
- "resource:musig2-session:abc123" → Hash → 0x8B...
- Node with ID closest to 0x8B... stores this resource
```

### DHT Query Visualization

```
Query: Find "resource:musig2-session:abc123"
Key Hash: 0x8B...

Step 1: Start at Query Node (Node A: 0x3A...)
┌─────────┐
│ Node A  │ Distance to 0x8B: 0xB1 (far)
│ 0x3A... │ Query: "Who's closest to 0x8B?"
└────┬────┘
     │
     ├─► Check routing table
     └─► Closest known: Node C (0x9C...)

Step 2: Query Node C
┌─────────┐
│ Node C  │ Distance to 0x8B: 0x17 (closer)
│ 0x9C... │ Query: "Who's closest to 0x8B?"
└────┬────┘
     │
     ├─► Check routing table
     └─► Closest known: Node F (0x8A...)

Step 3: Query Node F
┌─────────┐
│ Node F  │ Distance to 0x8B: 0x01 (very close!)
│ 0x8A... │ Has resource? NO
└────┬────┘ Query: "Who's closest to 0x8B?"
     │
     ├─► Check routing table
     └─► Closest known: Node G (0x8B...)

Step 4: Query Node G (Target!)
┌─────────┐
│ Node G  │ Distance to 0x8B: 0x00 (exact match)
│ 0x8B... │ Has resource? YES! Return value.
└─────────┘

Total Queries: 3 (O(log n) complexity)
```

---

## DHT State and Lifecycle

### State Machine

```
┌─────────────────────────────────────────────────────────────┐
│                  DHT Node State Machine                     │
└─────────────────────────────────────────────────────────────┘

    [INITIALIZED]
         │
         │ start()
         ▼
    [BOOTSTRAPPING] ──► Connect to bootstrap peers
         │
         │ peer:connect + identify
         ▼
    [POPULATING] ───► TopologyListener adds peers
         │           to routing table
         │
         │ routingTableSize > 0
         ▼
    [READY] ─────────► DHT operations enabled
         │              - announceResource()
         │              - discoverResource()
         │              - PUT/GET operations
         │
         │ stop()
         ▼
    [STOPPED]


State Checks:
  const stats = coordinator.getDHTStats()

  if (stats.isReady) {
    // READY state: safe to use DHT
  } else {
    // BOOTSTRAPPING/POPULATING: use local cache only
  }
```

### Local Cache vs DHT Network

```
┌────────────────────────────────────────────────────────────┐
│              Resource Storage Architecture                 │
└────────────────────────────────────────────────────────────┘

                    announceResource()
                            │
                            ▼
         ┌──────────────────────────────────────┐
         │  1. Store in Local Cache (ALWAYS)    │
         │     dhtValues.set(key, announcement) │
         └──────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │ DHT Server Mode?        │
              │ Routing Table Ready?    │
              └─────────────────────────┘
                     │              │
                 YES │              │ NO
                     ▼              ▼
         ┌──────────────────┐   [Skip DHT]
         │ 2. Propagate to  │   (Local Only)
         │    DHT Network   │
         │    - PUT to DHT  │
         │    - Replicate   │
         └──────────────────┘


                   discoverResource()
                            │
                            ▼
         ┌──────────────────────────────────────┐
         │  1. Check Local Cache (Fast Path)    │
         │     cached = dhtValues.get(key)      │
         └──────────────────────────────────────┘
                     │              │
                 Found │            │ Not Found
                     ▼              ▼
              [Return]      ┌──────────────────┐
                            │ DHT Enabled?     │
                            │ Routing Ready?   │
                            └──────────────────┘
                                  │        │
                              YES │        │ NO
                                  ▼        ▼
                      ┌──────────────┐  [Return null]
                      │ 2. Query DHT │
                      │    Network   │
                      └──────────────┘
                            │
                            ▼
                      [Return result]
```

### DHT Health Monitoring

```typescript
// Real-time DHT health check
function checkDHTHealth(coordinator: P2PCoordinator) {
  const stats = coordinator.getDHTStats()

  console.log('DHT Health Report:')
  console.log('  Enabled:', stats.enabled)
  console.log('  Mode:', stats.mode)
  console.log('  Routing Table Size:', stats.routingTableSize)
  console.log('  Ready:', stats.isReady)

  if (!stats.isReady) {
    console.warn('⚠️  DHT not ready - waiting for peers')
  } else {
    console.log('✅ DHT operational')
  }
}

// Usage
setInterval(() => checkDHTHealth(coordinator), 10000)
```

---

## MuSig2 Coordination via DHT

### Overview

MuSig2 multi-signature coordination uses a **three-phase architecture** that solves the chicken-and-egg problem of peer discovery:

1. **Phase 0: Signer Advertisement** - Wallets announce their public keys and availability
2. **Phase 1: Matchmaking** - Users discover available signers matching their criteria
3. **Phase 2: Signing Request** - Create requests with discovered public keys
4. **Phase 3: Dynamic Session Building** - Participants join, session builds when ALL join (n-of-n)

**Hybrid Architecture:**

```
DHT: Signer advertisements, signing request discovery (offline/historical)
GossipSub: Real-time event-driven discovery via pub/sub topics
Direct P2P: Cryptographic material exchange (nonces, partial signatures)
Broadcast: Advertisement and request announcements to connected peers
```

**Discovery Mechanisms:**

1. **GossipSub (Real-Time)**:
   - Topic-based pub/sub: `musig2:signers:{transactionType}`
   - Instant notifications (10-100ms latency)
   - Subscribe before publish (true pub/sub semantics)
   - Powered by `@libp2p/gossipsub` (Ethereum 2.0 standard)

2. **DHT (Offline/Historical)**:
   - Query pre-existing advertisements
   - Persistent storage across time
   - 500-2000ms latency

3. **P2P Broadcast (Direct Messaging)**:
   - Direct peer-to-peer announcements
   - 50-200ms latency
   - Requires peer connections

### Security: Signature Verification at Receipt

**Alice cannot trust Zoe or any intermediary** - she must verify cryptographic proof locally:

```typescript
// When Alice receives an advertisement (via DHT, GossipSub, or P2P):

// 1. Extract signature from advertisement
const { signature, publicKey, peerId, multiaddrs, criteria } = advertisement

// 2. Verify signature BEFORE trusting
const isValid = coordinator.verifyAdvertisementSignature(advertisement)

if (!isValid) {
  // Reject! Possible attack or corrupted data
  console.warn('Invalid advertisement signature - dropping')
  return
}

// 3. Signature valid → cryptographic proof established
//    - Bob owns the advertised public key (only he could sign)
//    - Multiaddrs are authentic (part of signed data)
//    - No MITM possible (signature would break)

// 4. Safe to connect
await coordinator.connectToSigner(advertisement)
```

**Verification Points:**

- ✅ **GossipSub handler**: Verifies before emitting `SIGNER_DISCOVERED`
- ✅ **P2P broadcast handler**: Verifies before emitting `SIGNER_DISCOVERED`
- ✅ **DHT query**: Verifies when deserializing from DHT
- ✅ **No challenge-response needed**: Signature IS the proof!

### Why Three Phases?

**The Problem**: Traditional approach assumes you know all signers upfront:

- ❌ Can't create transaction without knowing public keys
- ❌ Can't discover public keys without a way for wallets to advertise
- ❌ Chicken-and-egg: Need keys to create session, need session to find keys

**The Solution**: Phase 0 breaks the cycle:

- ✅ **Phase 0**: Wallets advertise "I'm available with this public key"
- ✅ **Phase 1**: Users discover signers: "Find me 2 signers for a spend transaction"
- ✅ **Phase 2**: Create transaction with discovered keys, announce signing request
- ✅ **Phase 3**: Participants discover they're needed, join dynamically

### Three-Phase Flow Detailed

```
┌────────────────────────────────────────────────────────────┐
│           Phase 0: Signer Advertisement                     │
└────────────────────────────────────────────────────────────┘

Wallet A (Available for Signing):
  1. advertiseSigner(myPrivateKey, criteria)
     ├─ Criteria: {transactionTypes: ['spend', 'swap']}
     ├─ Create Schnorr signature over advertisement
     └─ Metadata: {nickname: "AliceWallet", fees: 0}

  2. Announce to DHT (Multi-Index)
     ├─ musig2-signer:type:spend:pubkeyA
     ├─ musig2-signer:type:swap:pubkeyA
     └─ musig2-signer:all:pubkeyA

  3. Broadcast to P2P
     └─ SIGNER_ADVERTISEMENT → all connected peers

Wallet B, C, ... (Also Available):
  └─ Same process, different public keys

DHT Network:
  ├─ Indexed by transaction type: "type:spend" → [pubkeyA, pubkeyB]
  ├─ Indexed by transaction type: "type:swap" → [pubkeyA, pubkeyC]
  └─ Global index: "all" → [pubkeyA, pubkeyB, pubkeyC]

┌────────────────────────────────────────────────────────────┐
│           Phase 1: Matchmaking & Discovery                  │
└────────────────────────────────────────────────────────────┘

User (Needs 3-of-3 MuSig2 for 5 XPI Spend):
  1. findAvailableSigners({transactionType: 'spend', minAmount: 5M})
     ├─ Query local cache (from broadcasts)
     ├─ Apply filters
     └─ Returns: [SignerA, SignerB, SignerC]

  2. User selects 2 other signers
     └─ Selected: [AliceWallet (pubkeyA), BobWallet (pubkeyB)]

  3. Now knows public keys!
     └─ requiredKeys = [myKey, pubkeyA, pubkeyB] (all 3 must sign)

┌────────────────────────────────────────────────────────────┐
│           Phase 2: Signing Request Creation                 │
└────────────────────────────────────────────────────────────┘

User (Creates Transaction & Request):
  1. Create transaction
     ├─ Build transaction with requiredKeys
     ├─ Generate sighash/message
     └─ Transaction ready for signing

  2. announceSigningRequest(requiredKeys, message, myPrivateKey)
     ├─ requestId: hash(message + keys + timestamp)
     ├─ requiredKeys: 3 keys (ALL must sign - MuSig2 = n-of-n)
     ├─ metadata: {transactionHex, amount: 5M, type: 'spend'}
     └─ creatorSignature: Schnorr signature

  3. Announce to DHT (Multi-Index by Required Keys)
     ├─ musig2-signing-request:requestId:myKey
     ├─ musig2-signing-request:requestId:pubkeyA  ← AliceWallet can find
     └─ musig2-signing-request:requestId:pubkeyB  ← BobWallet can find

  4. Broadcast to P2P
     └─ SIGNING_REQUEST → all connected peers

┌────────────────────────────────────────────────────────────┐
│      Phase 3: Dynamic Session Building (n-of-n MuSig2)      │
└────────────────────────────────────────────────────────────┘

AliceWallet (Discovers They're Needed):
  1. Receives SIGNING_REQUEST broadcast
     └─ Or: findSigningRequestsForMe(myPublicKey)

  2. Checks: "Is my public key required?"
     └─ Yes! pubkeyA is in requiredPublicKeys

  3. Validates request
     ├─ Verify creator signature
     ├─ Check transaction details (amount, type)
     └─ User approves signing

  4. joinSigningRequest(requestId, myPrivateKey)
     ├─ Create participation signature
     ├─ Broadcast PARTICIPANT_JOINED
     └─ Add self to participants map

BobWallet (Also Discovers & Joins):
  └─ Same process, joins independently

Session State (Dynamic Building):
  ├─ Initially: 1/3 participants (creator only)
  ├─ AliceWallet joins: 2/3 participants
  └─ BobWallet joins: 3/3 participants → All joined! (3-of-3 MuSig2)

When ALL Participants Joined:
  1. _createMuSigSessionFromRequest()
     ├─ Create local MuSig session
     ├─ Phase changes: 'waiting' → 'ready'
     └─ Emit SESSION_READY event

  2. Proceed with MuSig2 protocol
     ├─ Round 1: Nonce exchange
     ├─ Round 2: Partial signature exchange
     └─ Finalization: Aggregate signature
```

### Session Discovery Pattern

**Three-Phase Solution:**

The three-phase architecture solves the discoverability problem:

- ✅ **Phase 0**: Wallets advertise their public keys proactively
- ✅ **Phase 1**: Users discover available signers by criteria
- ✅ **Phase 2**: Signing requests indexed by required public keys
- ✅ **Phase 3**: Automatic discovery - wallets find requests needing their key

**Discovery Patterns:**

```typescript
// Pattern 1: Advertise your availability (Phase 0)
await musig2Coordinator.advertiseSigner(
  myPrivateKey,
  {
    transactionTypes: ['spend', 'swap'],
    minAmount: 1_000_000, // 1 XPI
    maxAmount: 100_000_000, // 100 XPI
  },
  {
    ttl: 24 * 60 * 60 * 1000, // 24 hours
    metadata: {
      nickname: 'MyWallet',
      fees: 0,
    },
  },
)

// Pattern 2: Find available signers (Phase 1)
const availableSigners = await musig2Coordinator.findAvailableSigners({
  transactionType: 'spend',
  minAmount: 5_000_000, // 5 XPI transaction
  maxResults: 10,
})

console.log(`Found ${availableSigners.length} available signers`)
// User selects from list

// Pattern 3: Create signing request with discovered keys (Phase 2)
const selectedSigners = [availableSigners[0], availableSigners[1]]
const requiredKeys = [
  myPrivateKey.publicKey,
  ...selectedSigners.map(s => s.publicKey),
]

const requestId = await musig2Coordinator.announceSigningRequest(
  requiredKeys,
  transactionSighash,
  myPrivateKey,
  {
    metadata: {
      transactionHex: tx.toHex(),
      amount: 5_000_000,
      transactionType: 'spend',
      description: '3-of-3 MuSig2 - all must sign',
    },
  },
)

// Pattern 4: Discover requests needing your key (Phase 3)
const myRequests = await musig2Coordinator.findSigningRequestsForMe(
  myPrivateKey.publicKey,
)

console.log(`You have ${myRequests.length} pending signing requests`)

// Pattern 5: Join a discovered request (Phase 3)
for (const request of myRequests) {
  // User approves
  await musig2Coordinator.joinSigningRequest(request.requestId, myPrivateKey)
  // Session automatically created when ALL participants join (n-of-n)
}

// Pattern 6: Event-based discovery (automatic)
coordinator.on('signing-request:received', request => {
  if (isMyKeyRequired(request, myPublicKey)) {
    showNotification(`Signing request: ${request.metadata?.amount} XPI`)
  }
})

coordinator.on('session:ready', sessionId => {
  // All participants joined (n-of-n), session ready for signing
  console.log('Session ready for nonce exchange')
})
```

**Key Improvements:**

- ✅ No out-of-band communication needed for connected peers
- ✅ Automatic discovery via broadcasts and DHT indexing
- ✅ Multi-index DHT enables efficient filtering
- ✅ Dynamic session building (ALL participants must join for MuSig2 n-of-n)
- ✅ Event-driven notifications for real-time updates
- ⚠️ **Note**: MuSig2 = n-of-n only (all must sign). For m-of-n use FROST or Taproot scripts

### Complete MuSig2 Coordination Flow

```
┌────────────────────────────────────────────────────────────┐
│               MuSig2 P2P Coordination Flow                 │
└────────────────────────────────────────────────────────────┘

Phase 0: Session Setup
┌─────────────┐
│  Signer 1   │ (Creator)
│  0x3A...    │
└──────┬──────┘
       │
       │ 1. announceSession()
       ├──► Store in DHT: "resource:musig2-session:abc123"
       │    Data: {signers, message, creatorSignature}
       │
       │ 2. Broadcast SESSION_ANNOUNCE
       └──────────────────────────────────────────┐
                                                  │
Phase 1: Session Join                            │
┌─────────────┐  ┌─────────────┐  ┌─────────────┤
│  Signer 2   │  │  Signer 3   │  │  Signer N   │
│  0x7B...    │  │  0x9C...    │  │  0xE5...    │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       │ 3. Receive SESSION_ANNOUNCE    │
       │    (via P2P broadcast or DHT)  │
       │                │                │
       │ 4. Validate    │                │
       │    - Creator signature          │
       │    - Am I in signers list?      │
       │                │                │
       │ 5. Send SESSION_JOIN to Signer 1
       ├────────────────┼────────────────┤
       │   SESSION_JOIN │   SESSION_JOIN │
       └───────────────►└───────────────►│
                                         │
Phase 2: Nonce Exchange                 │
       ┌──────────────────────────────────┘
       │ 6. All signers joined
       │    Broadcast NONCE_SHARE
       ▼
All Signers Exchange Nonces (P2P Messages)
┌─────────┐     NONCE_SHARE      ┌─────────┐
│ Signer1 │◄────────────────────►│ Signer2 │
└────┬────┘                      └────┬────┘
     │         NONCE_SHARE            │
     └────────────────┬───────────────┘
                      │
                 ┌────┴────┐
                 │ Signer3 │
                 └─────────┘

Phase 3: Partial Signature Exchange
All Signers Exchange Partial Signatures (P2P Messages)
┌─────────┐  PARTIAL_SIG_SHARE   ┌─────────┐
│ Signer1 │◄────────────────────►│ Signer2 │
└────┬────┘                      └────┬────┘
     │     PARTIAL_SIG_SHARE          │
     └────────────────┬───────────────┘
                      │
                 ┌────┴────┐
                 │ Signer3 │
                 └─────────┘

Phase 4: Finalization
Each signer:
  1. Collects all partial signatures
  2. Aggregates into final signature
  3. Broadcasts SIGNATURE_FINALIZED
  4. Session complete! 🎉
```

### Session Announcement Data Structure

```typescript
// Data stored in DHT
interface SessionAnnouncementData {
  sessionId: string // "abc123"
  signers: PublicKey[] // [pubkey1, pubkey2, pubkey3]
  creatorPeerId: string // "12D3Koo..."
  creatorIndex: number // 0 (first signer)
  message: Buffer // Message to sign
  requiredSigners: number // 3 (all must sign - MuSig2 = n-of-n)
  createdAt: number // 1730419200000
  expiresAt?: number // 1730422800000 (optional)

  // Security
  creatorSignature: Buffer // Schnorr signature over announcement

  // Coordinator election (optional)
  election?: {
    coordinatorIndex: number // Elected coordinator (0-2)
    electionMethod: string // 'hash-based'
    electionProof: string // Deterministic proof
  }
}

// DHT Key
const key = 'resource:musig2-session:abc123'

// Storage
coordinator.announceResource('musig2-session', 'abc123', data)
```

---

## Network Communication Patterns

### Communication Layers

```
┌────────────────────────────────────────────────────────────┐
│                   Communication Layers                     │
└────────────────────────────────────────────────────────────┘

Layer 4: Protocol Logic (MuSig2)
         ├─ Session management
         ├─ Cryptographic operations
         └─ State machine

Layer 3: P2P Messaging (P2PCoordinator)
         ├─ sendTo(peerId, message)
         ├─ broadcast(message)
         └─ Protocol routing

Layer 2: DHT Operations (libp2p kad-dht)
         ├─ announceResource()
         ├─ discoverResource()
         └─ Routing table management

Layer 1: Transport (libp2p)
         ├─ TCP connections
         ├─ WebSocket connections
         ├─ Stream multiplexing (mplex)
         └─ Encryption (Noise protocol)

Layer 0: Network (IP)
         └─ Internet connectivity
```

### Message Types

**1. DHT Operations (Layer 2)**

```
DHT PUT:
  Purpose: Store session announcement
  Scope: Network-wide (k nodes)
  Performance: Slower (multiple hops)
  Use Case: Session discovery

DHT GET:
  Purpose: Retrieve session announcement
  Scope: Network-wide (multiple queries)
  Performance: Slower (O(log n) hops)
  Use Case: Find existing sessions
```

**2. Direct P2P Messages (Layer 3)**

```
sendTo(peerId, message):
  Purpose: Direct communication
  Scope: Single peer
  Performance: Fast (single hop)
  Use Case: Nonce/signature exchange

broadcast(message):
  Purpose: Notify all participants
  Scope: All connected peers
  Performance: Fast (parallel)
  Use Case: Session announcements, phase transitions
```

### MuSig2 Message Flow Diagram

```
┌────────────────────────────────────────────────────────────┐
│           MuSig2 Message Types and Flows                   │
└────────────────────────────────────────────────────────────┘

DHT Announcements:
┌──────────────────────────┐
│  SESSION_ANNOUNCE (DHT)  │ ──► Stored in DHT
│  - sessionId             │     Key: resource:musig2-session:abc123
│  - signers list          │     Replication: k nodes
│  - message hash          │     TTL: 1 hour (default)
│  - creator signature     │
└──────────────────────────┘

P2P Messages (Direct):
┌──────────────────────────┐
│  SESSION_JOIN            │ ──► Direct to creator
│  - sessionId             │     Confirms participation
│  - signerIndex           │
│  - publicKey             │
└──────────────────────────┘

┌──────────────────────────┐
│  NONCE_SHARE             │ ──► Broadcast to all signers
│  - sessionId             │     Contains [R1, R2] points
│  - signerIndex           │     65 bytes total
│  - publicNonce [R1, R2]  │
└──────────────────────────┘

┌──────────────────────────┐
│  PARTIAL_SIG_SHARE       │ ──► Broadcast to all signers
│  - sessionId             │     Contains partial signature
│  - signerIndex           │     32 bytes
│  - partialSig (BN)       │
└──────────────────────────┘

┌──────────────────────────┐
│  SIGNATURE_FINALIZED     │ ──► Broadcast to all signers
│  - sessionId             │     Final aggregated signature
│  - finalSignature        │     64 bytes (Schnorr)
└──────────────────────────┘
```

### Message Routing

```
┌────────────────────────────────────────────────────────────┐
│                    Message Routing Logic                   │
└────────────────────────────────────────────────────────────┘

Incoming Message:
  ┌──────────────────┐
  │ libp2p stream    │
  │ '/lotus/message' │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ P2PCoordinator   │
  │ _handleIncoming  │
  └────────┬─────────┘
           │
           ├─► Deserialize message
           ├─► Validate structure
           ├─► Check for duplicate (seenMessages)
           │
           ▼
  ┌──────────────────┐
  │ Route by         │
  │ message.protocol │
  └────────┬─────────┘
           │
           ├─► protocol='musig2' ──► MuSig2P2PProtocolHandler
           ├─► protocol='coinjoin' ──► CoinJoinProtocolHandler
           └─► protocol=undefined ──► Generic handler

MuSig2P2PProtocolHandler:
  ┌──────────────────┐
  │ Route by         │
  │ message.type     │
  └────────┬─────────┘
           │
           ├─► SESSION_ANNOUNCE ──► _handleSessionAnnounce()
           ├─► SESSION_JOIN     ──► _handleSessionJoin()
           ├─► NONCE_SHARE      ──► _handleNonceShare()
           ├─► PARTIAL_SIG      ──► _handlePartialSigShare()
           └─► ...

MuSig2P2PCoordinator:
  ┌──────────────────┐
  │ Process message  │
  │ Update session   │
  │ Emit events      │
  └──────────────────┘
```

---

## Technical Implementation Details

### Code: DHT Initialization

```typescript
// From coordinator.ts:start()

// Auto-detect peerInfoMapper based on environment
let peerInfoMapper = this.config.dhtPeerInfoMapper

if (!peerInfoMapper) {
  const listenAddrs = this.config.listen || ['/ip4/0.0.0.0/tcp/0']
  const isLocalhost = listenAddrs.some(
    addr => addr.includes('127.0.0.1') || addr.includes('localhost'),
  )

  if (isLocalhost) {
    // Development: allow private addresses (127.0.0.1)
    peerInfoMapper = passthroughMapper
  } else {
    // Production: filter private addresses for security
    peerInfoMapper = removePrivateAddressesMapper
  }
}

// Create libp2p with DHT
const config = {
  addresses: {
    listen: this.config.listen || ['/ip4/0.0.0.0/tcp/0'],
  },
  transports: [tcp(), webSockets()],
  connectionEncrypters: [noise()],
  streamMuxers: [mplex()],
  services: {
    identify: identify(),
    ping: ping(),
    kadDHT: kadDHT({
      protocol: this.config.dhtProtocol || '/lotus/kad/1.0.0',
      clientMode: !(this.config.enableDHTServer ?? false),
      peerInfoMapper,
    }),
  },
}

this.node = await createLibp2p(config)
await this.node.start()
```

### Code: Resource Announcement

```typescript
// From coordinator.ts:announceResource()

async announceResource<T>(
  resourceType: string,
  resourceId: string,
  data: T,
  options?: { ttl?: number; expiresAt?: number }
): Promise<void> {
  const announcement: ResourceAnnouncement<T> = {
    resourceId,
    resourceType,
    creatorPeerId: this.node.peerId.toString(),
    data,
    createdAt: Date.now(),
    expiresAt: options?.expiresAt,
  }

  // 1. Store locally (ALWAYS)
  const key = this._makeResourceKey(resourceType, resourceId)
  this.dhtValues.set(key, announcement)

  // 2. Propagate to DHT network (if ready)
  if (this.node.services.kadDHT && this.config.enableDHTServer) {
    const dhtStats = this.getDHTStats()

    if (dhtStats.isReady) {
      // Safe: routing table has peers
      const dht = this.node.services.kadDHT as KadDHT
      const keyBytes = uint8ArrayFromString(key)
      const valueBytes = uint8ArrayFromString(JSON.stringify(announcement))

      await this._putDHT(keyBytes, valueBytes, 5000)
    }
    // Else: routing table empty, skip DHT propagation
  }

  this.emit('resource:announced', announcement)
}

private _makeResourceKey(type: string, id: string): string {
  return `resource:${type}:${id}`
}
```

### Code: Resource Discovery

```typescript
// From coordinator.ts:discoverResource()

async discoverResource(
  resourceType: string,
  resourceId: string,
  timeoutMs: number = 5000
): Promise<ResourceAnnouncement | null> {
  const key = this._makeResourceKey(resourceType, resourceId)

  // 1. Check local cache first (fast path)
  const cached = this.dhtValues.get(key)
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
    return cached
  }

  // 2. Query DHT network (if ready)
  if (this.node?.services.kadDHT) {
    const dhtStats = this.getDHTStats()

    if (dhtStats.isReady) {
      // Routing table has peers - safe to query
      return this._queryDHT(key, timeoutMs)
    }
  }

  return null
}

// Internal DHT query with timeout
private async _queryDHT(
  key: string,
  timeoutMs: number
): Promise<ResourceAnnouncement | null> {
  const dht = this.node.services.kadDHT as KadDHT
  const keyBytes = uint8ArrayFromString(key)
  const controller = new AbortController()

  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let eventCount = 0
    const maxEvents = 20  // Prevent infinite iteration

    for await (const event of dht.get(keyBytes, { signal: controller.signal })) {
      eventCount++

      if (event.name === 'VALUE') {
        const valueStr = uint8ArrayToString(event.value)
        const announcement = JSON.parse(valueStr)

        // Cache it
        this.dhtValues.set(key, announcement)
        clearTimeout(timeout)
        return announcement
      }

      if (eventCount >= maxEvents) break
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('DHT query error:', error)
    }
  } finally {
    clearTimeout(timeout)
  }

  return null
}
```

### Code: MuSig2 Session Announcement

```typescript
// From musig2/coordinator.ts:announceSession()

async announceSession(
  signers: PublicKey[],
  myPrivateKey: PrivateKey,
  message: Buffer,
  options?: { requiredSigners?: number }
): Promise<string> {
  // 1. Create local session
  const session = this.sessionManager.createSession(
    signers,
    myPrivateKey,
    message,
    options
  )

  // 2. Sign announcement for authenticity
  const announcementData = Buffer.concat([
    Buffer.from(session.sessionId),
    message,
    ...signers.map(pk => pk.toBuffer()),
  ])
  const creatorSignature = Schnorr.sign(myPrivateKey, announcementData)

  // 3. Prepare announcement metadata
  const metadata: SessionAnnouncementData = {
    sessionId: session.sessionId,
    signers,
    creatorPeerId: this.peerId,
    creatorIndex: session.mySignerIndex,
    message,
    requiredSigners: options?.requiredSigners || signers.length,
    createdAt: Date.now(),
    expiresAt: Date.now() + this.musig2Config.sessionTimeout,
    creatorSignature,
  }

  // 4. Announce to DHT (if enabled)
  if (this.musig2Config.enableSessionDiscovery) {
    await this.announceResource(
      this.musig2Config.sessionResourceType,  // 'musig2-session'
      session.sessionId,
      metadata
    )
  }

  // 5. Broadcast to P2P network
  const payload: SessionAnnouncementPayload = {
    sessionId: session.sessionId,
    signers: signers.map(pk => pk.toString()),
    creatorIndex: session.mySignerIndex,
    message: message.toString('hex'),
    requiredSigners: metadata.requiredSigners,
    creatorSignature: creatorSignature.toString('hex'),
  }

  await this.broadcast({
    type: MuSig2MessageType.SESSION_ANNOUNCE,
    from: this.peerId,
    payload,
    timestamp: Date.now(),
    messageId: generateId(),
    protocol: 'musig2',
  })

  return session.sessionId
}
```

### Code: Session Discovery

```typescript
// From musig2/coordinator.ts

// Discovery Pattern 1: Query all local sessions
async findAvailableSessions(): Promise<SessionAnnouncementData[]> {
  const sessions = this.getLocalResources('musig2-session')

  return sessions
    .map(res => res.data as SessionAnnouncementData)
    .filter(session => {
      // Filter: not expired
      if (session.expiresAt && session.expiresAt < Date.now()) {
        return false
      }
      // Filter: I'm a signer
      const myPubKey = this.myPublicKey.toString()
      return session.signers.some(pk => pk.toString() === myPubKey)
    })
}

// Discovery Pattern 2: Query specific session from DHT
async findSession(sessionId: string): Promise<SessionAnnouncementData | null> {
  const resource = await this.discoverResource(
    'musig2-session',
    sessionId,
    5000  // 5 second timeout
  )

  if (!resource) return null

  const session = resource.data as SessionAnnouncementData

  // Validate creator signature
  if (session.creatorSignature) {
    const announcementData = Buffer.concat([
      Buffer.from(session.sessionId),
      session.message,
      ...session.signers.map(pk => pk.toBuffer()),
    ])

    const creatorPubKey = session.signers[session.creatorIndex]
    const isValid = Schnorr.verify(
      creatorPubKey,
      announcementData,
      session.creatorSignature
    )

    if (!isValid) {
      throw new Error('Invalid creator signature - DHT poisoning detected')
    }
  }

  return session
}
```

---

## Performance and Scaling

### DHT Performance Characteristics

```
┌────────────────────────────────────────────────────────────┐
│                  DHT Performance Metrics                   │
└────────────────────────────────────────────────────────────┘

Lookup Complexity: O(log n)
  - Network with 1,000 nodes: ~10 hops
  - Network with 1,000,000 nodes: ~20 hops
  - Network with 1,000,000,000 nodes: ~30 hops

Storage Redundancy: k nodes (default k=20)
  - Each key stored on 20 nodes
  - Tolerates 19 node failures
  - Increases availability

Query Latency:
  - Local cache hit: <1ms
  - DHT query (small network): 100-500ms
  - DHT query (large network): 500-2000ms
  - Timeout: 5000ms (configurable)

Bandwidth:
  - Announcement: ~1KB per resource
  - Query: ~500 bytes per hop
  - Negligible for typical use
```

### Scaling Considerations

**1. Network Size**

```
Small Network (< 10 nodes):
  ✅ Local cache sufficient
  ✅ Broadcast announcements work well
  ⚠️  DHT may not be necessary

Medium Network (10-1000 nodes):
  ✅ DHT provides efficient discovery
  ✅ Routing table well-populated
  ✅ O(log n) benefit apparent

Large Network (> 1000 nodes):
  ✅ DHT essential for scalability
  ✅ Broadcast becomes inefficient
  ✅ Full Kademlia benefits
```

**2. Session Volume**

```
Low Volume (< 100 sessions/hour):
  ✅ DHT handles easily
  ✅ No special optimization needed

Medium Volume (100-1000 sessions/hour):
  ✅ Local cache provides fast path
  ✅ DHT handles discovery
  ⚠️  Monitor routing table size

High Volume (> 1000 sessions/hour):
  ✅ Local cache critical
  ✅ Consider session TTL reduction
  ✅ Implement cleanup automation
  ⚠️  May need DHT server mode on multiple nodes
```

### Optimization Strategies

**1. Local Cache First**

```typescript
// Always check cache before DHT query
const cached = coordinator.getLocalResources('musig2-session')
if (cached.length > 0) {
  // Use cached sessions (fast)
} else {
  // Fall back to DHT query (slower)
  const session = await coordinator.discoverResource(...)
}
```

**2. Session Expiration**

```typescript
// Set reasonable TTL to prevent stale data
await coordinator.announceResource(
  'musig2-session',
  sessionId,
  data,
  { expiresAt: Date.now() + 3600_000 }, // 1 hour
)
```

**3. Automatic Cleanup**

```typescript
// Periodic cleanup of expired sessions
setInterval(() => {
  coordinator.cleanup() // Removes expired DHT entries
}, 60_000) // Every minute
```

**4. DHT Server Mode Strategy**

```typescript
// Long-running nodes: Server mode
const serverNode = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/4001'],
  enableDHT: true,
  enableDHTServer: true, // Participate in DHT network
})

// Ephemeral clients: Client mode
const clientNode = new P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/0'],
  enableDHT: true,
  enableDHTServer: false, // Query only
})
```

### Monitoring and Debugging

```typescript
// DHT health monitoring
function monitorDHT(coordinator: P2PCoordinator) {
  const stats = coordinator.getDHTStats()
  const p2pStats = coordinator.getStats()

  console.log('=== DHT Status ===')
  console.log('Enabled:', stats.enabled)
  console.log('Mode:', stats.mode)
  console.log('Routing Table Size:', stats.routingTableSize)
  console.log('Ready:', stats.isReady)
  console.log('Local Records:', p2pStats.dht.localRecords)
  console.log('Connected Peers:', p2pStats.peers.connected)
  console.log('Multiaddrs:', p2pStats.multiaddrs)

  if (!stats.isReady) {
    console.warn('⚠️  DHT not ready - routing table empty')
    console.warn('    - Check bootstrap peers')
    console.warn('    - Check peerInfoMapper configuration')
    console.warn('    - Wait for peer connections')
  }
}

// Run every 10 seconds
setInterval(() => monitorDHT(coordinator), 10000)
```

---

## Current Limitations and Future Improvements

### Limitation: No Session Enumeration

**Problem:**

The Kademlia DHT cannot enumerate all keys matching a pattern. This creates a discoverability challenge:

```typescript
// ❌ Not possible with DHT
const allSessions = await coordinator.findAllSessions()

// ✅ Only works if you know the exact session ID
const session = await coordinator.discoverResource('musig2-session', 'abc123')
```

**Current Workarounds:**

1. **Out-of-Band Communication**: Share session IDs via email, chat, QR codes
2. **Deep Links**: `lotus://musig2/join/abc123`
3. **Local Cache**: Query sessions you've previously heard about

**Impact:**

- ⚠️ Users must manually share session IDs
- ⚠️ No automatic session discovery for newcomers
- ⚠️ Cannot browse "available sessions"

### Recommended Improvements

**1. Add P2P Broadcast of Session Announcements**

Enhance `createSession()` to broadcast to all connected peers:

```typescript
// After DHT announcement, add:
await this._broadcastSessionAnnouncement(session, myPrivateKey)

// New method:
private async _broadcastSessionAnnouncement(
  session: MuSigSession,
  creatorPrivateKey: PrivateKey,
): Promise<void> {
  const payload: SessionAnnouncementPayload = {
    sessionId: session.sessionId,
    signers: session.signers.map(pk => pk.toString()),
    creatorIndex: session.myIndex,
    message: session.message.toString('hex'),
    requiredSigners: session.signers.length,
    creatorSignature: this._signSessionAnnouncement(...).toString('hex'),
  }

  // Broadcast to all connected peers
  await this.broadcast({
    type: MuSig2MessageType.SESSION_ANNOUNCE,
    from: this.peerId,
    payload,
    timestamp: Date.now(),
    messageId: generateId(),
    protocol: 'musig2',
  })
}
```

**Benefits:**

- ✅ Connected wallets automatically learn about new sessions
- ✅ Builds local cache for session browsing
- ✅ No out-of-band communication needed for connected peers
- ✅ DHT still provides backup for late-joining nodes

**2. Add Session Discovery API**

Add a user-facing method to query available sessions:

```typescript
/**
 * Find available MuSig2 sessions from local cache
 *
 * @param filters - Optional filters
 * @returns Array of session announcements
 */
async findAvailableSessions(filters?: {
  includeExpired?: boolean
  myPublicKey?: PublicKey
  minSigners?: number
  maxSigners?: number
}): Promise<SessionAnnouncementData[]> {
  const resources = this.getLocalResources('musig2-session')

  return resources
    .map(res => res.data as SessionAnnouncementData)
    .filter(session => {
      // Apply filters
      if (!filters?.includeExpired && session.expiresAt < Date.now()) {
        return false
      }
      if (filters?.myPublicKey) {
        const myKey = filters.myPublicKey.toString()
        if (!session.signers.some(pk => pk.toString() === myKey)) {
          return false
        }
      }
      // ... more filters
      return true
    })
}
```

**Usage:**

```typescript
// Wallet UI: "Show available sessions"
const sessions = await musig2Coordinator.findAvailableSessions({
  myPublicKey: myPrivateKey.publicKey,
  includeExpired: false,
})

console.log(`Found ${sessions.length} sessions I can join`)
```

**3. Implement Session Browser**

For wallet UIs, add event-driven session discovery:

```typescript
// Listen for new session announcements
coordinator.on('session:discovered', (session: SessionAnnouncementData) => {
  // Update UI: "New session available: abc123"
  if (isEligibleSigner(session, myPublicKey)) {
    showNotification(`New MuSig2 session: ${session.sessionId}`)
  }
})
```

### Alternative: Specialized Discovery Protocol

For large-scale deployments, consider implementing a separate discovery protocol:

**Option A: DHT-Based Registry Pattern**

Store a registry of session IDs at a well-known key:

```typescript
// Registry key: "musig2-session-registry"
// Value: ["abc123", "xyz789", ...]

// Coordinator periodically updates registry
await coordinator.announceResource('musig2-session-registry', 'global', {
  sessions: Array.from(activeSessions.keys()),
})

// Wallets query registry
const registry = await coordinator.discoverResource(
  'musig2-session-registry',
  'global',
)
// Then query each session individually
```

**Drawbacks:**

- Registry becomes a bottleneck
- Requires coordination for updates
- Doesn't scale well

**Option B: Gossip Protocol**

Implement a gossip-based discovery layer on top of DHT:

```typescript
// Peers periodically exchange session lists
// "I know about: [abc123, xyz789]"
// "I know about: [def456, ghi101]"
// Now both peers know about 4 sessions
```

**Complexity:**

- More complex to implement
- Adds network overhead
- Better for very large networks

### Recommended Approach

**For Most Use Cases:**

**Phase 1**: Add P2P broadcast + local cache (simple, effective)  
**Phase 2**: Add `findAvailableSessions()` API (user-friendly)  
**Phase 3**: Consider specialized protocol only if scaling issues arise

**Implementation Priority:**

1. ✅ **High**: P2P broadcast of session announcements
2. ✅ **High**: `findAvailableSessions()` method
3. ⚠️ **Medium**: Session browser UI/events
4. 🔜 **Low**: Specialized discovery protocol (only if needed)

## Summary

### Key Takeaways

**DHT Architecture:**

- ✅ Kademlia DHT provides O(log n) scalability
- ✅ libp2p kad-dht is production-ready and battle-tested
- ✅ TopologyListener auto-populates routing table
- ✅ Local cache provides fast path for common queries
- ⚠️ **Cannot enumerate all keys** - designed for exact lookups only

**MuSig2 Coordination:**

- ✅ **Three-phase architecture** solves peer discovery problem
- ✅ **Phase 0**: Signer advertisement enables public key discovery
- ✅ **Phase 1**: Matchmaking finds signers by criteria
- ✅ **Phase 2**: Signing requests indexed by required keys
- ✅ **Phase 3**: Dynamic session building (ALL must join - n-of-n)
- ✅ DHT multi-indexing for efficient discovery
- ✅ Direct P2P messages for cryptographic material
- ✅ Broadcast announcements to connected peers
- ✅ Automatic failsafe prevents hanging during startup
- ✅ **No out-of-band communication needed** for connected wallets
- ⚠️ **MuSig2 = n-of-n only** (for m-of-n use FROST or Taproot script paths)

**Best Practices:**

1. **Always check `getDHTStats().isReady` before DHT operations**
2. **Advertise signer availability** with appropriate criteria and TTL
3. **Use local cache first, DHT as fallback**
4. **Set reasonable TTLs** (24 hours for advertisements, 1-2 hours for requests)
5. **Enable DHT server mode on long-running nodes**
6. **Monitor routing table size for health**
7. **Implement automatic cleanup for expired advertisements/requests**
8. **Use event-driven discovery** for real-time notifications
9. **Verify signatures** on advertisements and requests to prevent poisoning

### Visual Summary

```
┌────────────────────────────────────────────────────────────┐
│              Lotus P2P DHT Architecture                    │
└────────────────────────────────────────────────────────────┘

Network Layer:
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │  Node A  │◄───►│  Node B  │◄───►│  Node C  │
  │ (Server) │     │ (Server) │     │ (Client) │
  └──────────┘     └──────────┘     └──────────┘
       ▲                 ▲                 ▲
       │                 │                 │
       └─────────────────┴─────────────────┘
              Kademlia DHT Network
              (Resource Announcements)

Session Coordination:
  Session Creator ──► Announce to DHT ──► Store on k nodes
                  ──► Broadcast to P2P ──► Direct messages

  Participants ─────► Discover from DHT ──► Query network
               ─────► Join session ────────► Direct messages
               ─────► Exchange nonces ─────► Direct P2P
               ─────► Exchange sigs ───────► Direct P2P
               ─────► Finalize ────────────► Complete!

Data Flow:
  [Session] → announceResource() → Local Cache → DHT Network
  [Query]   → discoverResource() → Local Cache → DHT Query → Result
  [Message] → sendTo() → libp2p stream → Peer
```

---

## Related Documentation

- [P2P README](../lib/p2p/README.md) - P2P infrastructure overview
- [MuSig2 P2P Coordination](MUSIG2_P2P_COORDINATION.md) - MuSig2-specific patterns
- [libp2p Documentation](https://docs.libp2p.io/) - Official libp2p docs
- [Kademlia Paper](https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf) - Original algorithm

---

**Built with libp2p for the Lotus Ecosystem** 🌸
