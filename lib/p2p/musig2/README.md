# MuSig2 P2P Coordination

**Status**: ✅ Production Ready  
**Version**: 2.1.0 - Three-Phase Architecture + GossipSub  
**Date**: November 2, 2025

---

## Overview

The MuSig2 P2P coordination layer enables **fully decentralized multi-signature session coordination** using a three-phase architecture that solves the peer discovery problem.

**Key Innovation**: Wallets can discover each other's public keys through DHT-based advertisement and matchmaking, eliminating the need for out-of-band communication.

## Security Model

### DHT Advertisement Security

**Cryptographic Proof of Ownership:**

Every advertisement is **self-signed** by the advertiser's private key, proving ownership of the advertised public key.

```
Advertisement Signature = Schnorr.sign(
  SHA256(peerId || multiaddrs || publicKey || criteria || timestamps),
  privateKey
)
```

**Protection Against Attacks:**

✅ **DHT Poisoning Prevention:**

- Attackers cannot advertise someone else's public key (no private key to sign)
- Signature verification fails for fake advertisements
- Invalid advertisements are rejected

✅ **Multiaddr Tampering Prevention:**

- Multiaddrs are included in the signed data
- Any modification breaks the signature
- Ensures Alice connects to the correct peer

✅ **Directory Index Integrity (Secure Append-Only Log):**

- Directory index is a **self-signed append-only log**
- Each entry is cryptographically signed by the advertiser
- Entry format: `{publicKey, peerId, transactionType, timestamp, signature}`
- Entry signature proves only key owner can add their public key
- **Dual verification**: Directory entry + individual advertisement both verified
- Attackers cannot poison directory with keys they don't own
- Directory tampering is cryptographically detectable

✅ **Impersonation Prevention:**

- Only the owner of a private key can create valid signatures
- Advertisement signature proves key ownership
- No challenge-response needed (signature is the proof!)

**Security Guarantees:**

1. **Authenticity**: Advertisements provably come from key owners
2. **Integrity**: Data cannot be modified without detection
3. **Non-repudiation**: Advertisers cannot deny their advertisements
4. **Freshness**: Timestamps and expiry prevent replay attacks
5. **Trust-Free Verification**: Alice verifies signatures locally, doesn't trust intermediaries
6. **DoS Protection**: Size limits, timestamp validation, expiry enforcement

**Multi-Layer Security Validation:**

Every advertisement is validated through **4 security checks** before processing:

```typescript
// Layer 1: Message size limit (prevent memory exhaustion)
if (messageSize > 10KB) → DROP

// Layer 2: Timestamp validation (prevent time-based attacks)
if (|now - timestamp| > 5 minutes) → DROP

// Layer 3: Expiry enforcement (reject expired ads)
if (expiresAt < now) → DROP

// Layer 4: Signature verification (prove ownership)
if (!verifySignature(advertisement)) → DROP

// All checks passed → SIGNER_DISCOVERED event emitted
```

**Security Constants:**

```typescript
import { MUSIG2_SECURITY_LIMITS } from 'lotus-lib/p2p/musig2'

// Defined in types.ts:
const MUSIG2_SECURITY_LIMITS = {
  MAX_ADVERTISEMENT_SIZE: 10_000,        // 10KB max
  MAX_TIMESTAMP_SKEW: 300_000,           // 5 minutes
  MIN_ADVERTISEMENT_INTERVAL: 60_000,    // 60 seconds (future use)
  MAX_INVALID_SIGNATURES_PER_PEER: 10,   // Ban threshold (future use)
}

// Override if needed (not recommended):
const coordinator = new MuSig2P2PCoordinator(
  { listen: [...] },
  {
    securityLimits: {
      MAX_ADVERTISEMENT_SIZE: 20_000, // Custom limit
    },
  }
)
```

---

## Discovery Mechanisms

### 1. DHT-Based Discovery (Historical/Offline)

Query pre-existing advertisements stored in the DHT:

```typescript
// Alice queries DHT for signers who advertised BEFORE she connected
const signers = await coordinator.findAvailableSigners({
  transactionType: TransactionType.SWAP,
  minAmount: 10_000_000, // 10 XPI
  maxResults: 10,
})
```

**Use Case**: Finding services across time (like browsing a directory)

### 2. GossipSub Event-Driven Discovery (Real-Time)

Subscribe to real-time notifications when NEW signers advertise:

```typescript
// Alice subscribes FIRST (before advertisers join)
await coordinator.subscribeToSignerDiscovery([TransactionType.SWAP])

// Event handler receives notifications instantly
coordinator.on(MuSig2Event.SIGNER_DISCOVERED, advertisement => {
  console.log(`New signer: ${advertisement.metadata?.nickname}`)
  // No DHT query needed - instant notification!
})

// Later: Bob advertises → Alice receives notification (milliseconds)
```

**Use Case**: Real-time marketplace updates, instant discovery

### 3. Hybrid Approach (Production Recommended)

Use BOTH for maximum reliability:

```typescript
// Subscribe for real-time notifications (preferred)
await coordinator.subscribeToSignerDiscovery([TransactionType.SWAP])

// Event handler for instant discovery
coordinator.on(MuSig2Event.SIGNER_DISCOVERED, ad => {
  displaySigner(ad)
})

// Fallback: Query DHT for historical/missed advertisements
const historical = await coordinator.findAvailableSigners({
  transactionType: TransactionType.SWAP,
})
```

### Discovery Comparison

| Mechanism         | Latency    | Use Case          | Network Requirement       |
| ----------------- | ---------- | ----------------- | ------------------------- |
| **DHT**           | 500-2000ms | Offline discovery | Routing table ready       |
| **GossipSub**     | 10-100ms   | Real-time events  | Subscribed before publish |
| **P2P Broadcast** | 50-200ms   | Direct messaging  | Peer connections          |

**Deduplication**: Applications should deduplicate by public key, as `advertiseSigner()` uses multiple channels for reliability.

---

## Three-Phase Architecture

### The Problem

Traditional MuSig2 implementations have a chicken-and-egg problem:

- Can't create transaction without knowing public keys
- Can't discover public keys without an existing session
- Must share session IDs out-of-band (email, QR codes)

### The Solution

**Phase 0: Advertisement** → **Phase 1: Discovery** → **Phase 2: Request** → **Phase 3: Dynamic Building**

---

## Quick Start

### Installation

```bash
npm install lotus-lib
```

### Basic Usage

```typescript
import { MuSig2P2PCoordinator } from 'lotus-lib/p2p/musig2'
import { PrivateKey } from 'lotus-lib/bitcore'

// Create coordinator
const coordinator = new MuSig2P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/4001'],
  enableDHT: true,
})

await coordinator.start()
```

### Phase 0: Advertise Your Availability

```typescript
await coordinator.advertiseSigner(
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

console.log('✅ Now discoverable by other wallets')
```

### Phase 1: Discover Available Signers

```typescript
const availableSigners = await coordinator.findAvailableSigners({
  transactionType: 'spend',
  minAmount: 5_000_000, // 5 XPI transaction
  maxResults: 10,
})

console.log(`Found ${availableSigners.length} available signers`)

// Display to user for selection
availableSigners.forEach(signer => {
  console.log(`- ${signer.metadata?.nickname}`)
  console.log(`  Public Key: ${signer.publicKey.toString()}`)
  console.log(`  Fees: ${signer.metadata?.fees || 0} satoshis`)
})
```

### Phase 2: Create Signing Request

```typescript
// User selects signers from list
const selectedSigners = [availableSigners[0], availableSigners[1]]

// Now we have the public keys!
const requiredKeys = [
  myPrivateKey.publicKey,
  selectedSigners[0].publicKey,
  selectedSigners[1].publicKey,
]

// Create transaction with known keys
const transaction = createTransaction(inputs, outputs, requiredKeys)
const sighash = transaction.getSignatureHash()

// Announce signing request
const requestId = await coordinator.announceSigningRequest(
  requiredKeys,
  sighash,
  myPrivateKey,
  {
    metadata: {
      transactionHex: transaction.toHex(),
      amount: 5_000_000,
      transactionType: 'spend',
      description: '3-of-3 MuSig2 - all must sign',
    },
  },
)

console.log(`✅ Signing request created: ${requestId}`)
```

### Phase 3: Join Signing Request (As Participant)

```typescript
// Discover requests needing your signature
const myRequests = await coordinator.findSigningRequestsForMe(
  myPrivateKey.publicKey,
)

console.log(`You have ${myRequests.length} pending signing requests`)

// User reviews and approves request
const request = myRequests[0]
console.log(`Request for ${request.metadata?.amount} XPI`)

// Join the request
await coordinator.joinSigningRequest(request.requestId, myPrivateKey)

// Listen for session ready
coordinator.on('session:ready', async sessionId => {
  console.log('✅ All participants joined! Session ready for signing')

  // Now proceed with MuSig2 signing protocol (n-of-n)
  await coordinator.startRound1(sessionId, myPrivateKey)
})
```

---

## Event-Driven Discovery

### Real-Time Discovery with GossipSub

**GossipSub** enables instant, event-driven discovery without polling or DHT queries:

```typescript
// Subscribe to topics for real-time notifications
await coordinator.subscribeToSignerDiscovery([
  TransactionType.SWAP,
  TransactionType.SPEND,
])

// Receive instant notifications when signers advertise
const discoveredSigners: SignerAdvertisement[] = []
const seenPublicKeys = new Set<string>()

coordinator.on(MuSig2Event.SIGNER_DISCOVERED, ad => {
  // Application-layer deduplication (library uses multiple channels)
  const pubKeyStr = ad.publicKey.toString()
  if (!seenPublicKeys.has(pubKeyStr)) {
    seenPublicKeys.add(pubKeyStr)
    discoveredSigners.push(ad)
    console.log(`📥 New signer: ${ad.metadata?.nickname}`)
  }
})

// Unsubscribe when done
await coordinator.unsubscribeFromSignerDiscovery()
```

**Benefits:**

- ✅ **Instant**: 10-100ms latency (vs 500-2000ms for DHT)
- ✅ **No polling**: True event-driven architecture
- ✅ **Scalable**: GossipSub used by Ethereum 2.0
- ✅ **Reliable**: Redundant delivery (GossipSub + P2P broadcast)

### Event Listeners

```typescript
// Listen for new signing requests
coordinator.on(MuSig2Event.SIGNING_REQUEST_RECEIVED, request => {
  const myPubKeyStr = myPrivateKey.publicKey.toString()
  const isRequired = request.requiredPublicKeys.some(
    pk => pk.toString() === myPubKeyStr,
  )

  if (isRequired) {
    showNotification(`Signing request: ${request.metadata?.amount} XPI`)
  }
})

// Listen for new signer advertisements (both DHT and GossipSub)
coordinator.on(MuSig2Event.SIGNER_DISCOVERED, advertisement => {
  console.log(`New signer: ${advertisement.metadata?.nickname}`)
  console.log(`Types: ${advertisement.criteria.transactionTypes.join(', ')}`)
})

// Listen for session ready
coordinator.on(MuSig2Event.SESSION_READY, sessionId => {
  console.log('Session ready for nonce exchange!')
})
```

---

## Complete Example

```typescript
// PHASE 0: Advertise
await coordinator.advertiseSigner(myPrivateKey, {
  transactionTypes: ['spend'],
})

// PHASE 1: Discover
const signers = await coordinator.findAvailableSigners({
  transactionType: 'spend',
  maxResults: 2,
})

// PHASE 2: Request
const requestId = await coordinator.announceSigningRequest(
  [myKey, signers[0].publicKey, signers[1].publicKey],
  transactionSighash,
  myPrivateKey,
)

// PHASE 3: Join (as participant)
const requests = await coordinator.findSigningRequestsForMe(myPublicKey)
await coordinator.joinSigningRequest(requests[0].requestId, myPrivateKey)

// Wait for all participants to join (MuSig2 = n-of-n)
coordinator.on('session:ready', async sessionId => {
  // ALL participants joined - proceed with MuSig2 protocol
  await coordinator.startRound1(sessionId, myPrivateKey)
  await coordinator.startRound2(sessionId, myPrivateKey)

  const signature = await coordinator.getFinalSignature(sessionId)
  console.log('✅ Signature complete!', signature.toString('hex'))
})
```

---

## API Reference

### Signer Advertisement

**`advertiseSigner(privateKey, criteria, options?)`**

Announce your availability to the network.

```typescript
await coordinator.advertiseSigner(
  myPrivateKey,
  {
    transactionTypes: string[]      // ['spend', 'swap', 'coinjoin', 'custody']
    minAmount?: number               // Min XPI (satoshis)
    maxAmount?: number               // Max XPI (satoshis)
    trustRequirements?: {
      reputation?: number            // Min reputation score
      requiresVerification?: boolean // Require identity verification
    }
  },
  {
    ttl?: number                     // Advertisement lifetime (ms)
    metadata?: {
      nickname?: string              // User-friendly name
      description?: string           // Service description
      fees?: number                  // Fee per signature (satoshis)
      responseTime?: number          // Avg response time (ms)
      reputation?: {
        score: number                // 0-100
        completedSignings: number
        failedSignings: number
        averageResponseTime: number
        verifiedIdentity: boolean
      }
    }
  }
)
```

**`withdrawAdvertisement()`**

Remove your advertisement from the network.

**`subscribeToSignerDiscovery(transactionTypes)`**

Subscribe to real-time signer advertisements via GossipSub.

```typescript
// Subscribe to topics for instant notifications
await coordinator.subscribeToSignerDiscovery([
  TransactionType.SWAP,
  TransactionType.SPEND,
])

// Signers who advertise AFTER subscription → instant notification
coordinator.on(MuSig2Event.SIGNER_DISCOVERED, ad => {
  console.log(`Real-time discovery: ${ad.metadata?.nickname}`)
})
```

**`unsubscribeFromSignerDiscovery()`**

Unsubscribe from all signer discovery topics.

**`findAvailableSigners(filters)`**

Discover available signers matching criteria (queries DHT + local cache).

```typescript
const signers = await coordinator.findAvailableSigners({
  transactionType?: string          // 'spend', 'swap', etc.
  purpose?: string                  // 'personal', 'business', etc.
  minAmount?: number                // Min amount filter
  maxAmount?: number                // Max amount filter
  minReputation?: number            // Min reputation score
  maxResults?: number               // Limit results
})
```

### Signing Requests

**`announceSigningRequest(requiredKeys, message, privateKey, options?)`**

Create a signing request with discovered public keys.

**Note**: MuSig2 requires ALL participants to sign (n-of-n). For m-of-n threshold signatures, use FROST protocol or Taproot script paths.

```typescript
const requestId = await coordinator.announceSigningRequest(
  requiredPublicKeys,  // Array of PublicKey (ALL must sign)
  message,             // Buffer (transaction sighash)
  myPrivateKey,        // PrivateKey
  {
    metadata?: {
      transactionHex?: string       // Full tx context
      amount?: number               // Transaction amount
      transactionType?: string      // 'spend', 'swap', etc.
      purpose?: string              // Description
      description?: string          // Additional context
    }
  }
)
```

**`findSigningRequestsForMe(myPublicKey)`**

Find signing requests that need your signature.

```typescript
const requests = await coordinator.findSigningRequestsForMe(
  myPrivateKey.publicKey,
)
```

**`joinSigningRequest(requestId, privateKey)`**

Join a signing request as a participant.

```typescript
await coordinator.joinSigningRequest(requestId, myPrivateKey)
// Session auto-created when ALL participants join (n-of-n)
```

### MuSig2 Signing Protocol

**`startRound1(sessionId, privateKey)`**

Generate and exchange nonces.

**`startRound2(sessionId, privateKey)`**

Create and exchange partial signatures.

**`getFinalSignature(sessionId)`**

Get the aggregated final signature.

---

## Events

```typescript
// Signer advertisement
coordinator.on('signer:advertised', (ad: SignerAdvertisement) => {})
coordinator.on('signer:discovered', (ad: SignerAdvertisement) => {})
coordinator.on('signer:withdrawn', () => {})

// Signing requests
coordinator.on('signing-request:created', (req: SigningRequest) => {})
coordinator.on('signing-request:received', (req: SigningRequest) => {})
coordinator.on('signing-request:joined', (requestId: string) => {})

// Session lifecycle
coordinator.on('session:ready', (sessionId: string) => {})
coordinator.on('session:created', (sessionId: string) => {})
coordinator.on('session:joined', (sessionId: string) => {})
coordinator.on('session:closed', (sessionId: string) => {})
coordinator.on('session:aborted', (sessionId: string, reason: string) => {})

// Signing rounds
coordinator.on('round1:complete', (sessionId: string) => {})
coordinator.on('round2:complete', (sessionId: string) => {})
coordinator.on('signature:finalized', (sessionId: string, sig: Buffer) => {})
```

---

## Files

```
lib/p2p/musig2/
├── coordinator.ts          # Main coordinator
├── protocol-handler.ts     # Message routing
├── types.ts                # Type definitions
├── serialization.ts        # Data serialization
├── election.ts             # Coordinator election
└── index.ts                # Exports

test/p2p/musig2/
├── three-phase-architecture.test.ts  # New architecture tests
├── coordinator.test.ts               # Core coordinator tests
├── integration.test.ts               # Integration tests
└── ...

examples/
└── musig2-three-phase-example.ts  # Complete example
```

---

## Testing

```bash
# Run three-phase architecture tests
npx tsx --test test/p2p/musig2/three-phase-architecture.test.ts

# Run all MuSig2 tests
npx tsx --test test/p2p/musig2/*.test.ts

# Run example
npx tsx examples/musig2-three-phase-example.ts
```

---

## Documentation

- **[P2P_DHT_ARCHITECTURE.md](../../docs/P2P_DHT_ARCHITECTURE.md)** - Complete DHT and architecture details
- **[MUSIG2_P2P_COORDINATION.md](../../docs/MUSIG2_P2P_COORDINATION.md)** - P2P coordination overview
- **[MUSIG2_QUICK_REFERENCE.md](../../docs/MUSIG2_QUICK_REFERENCE.md)** - Quick reference guide
- **[P2P README](../README.md)** - P2P infrastructure overview

---

**Built with libp2p for the Lotus Ecosystem** 🌸
