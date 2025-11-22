# GossipSub Event-Driven Discovery

**Status**: ✅ **IMPLEMENTED**  
**Date**: November 2, 2025  
**Package**: `@libp2p/gossipsub`  
**Version**: 1.0.0

## Overview

Real-time event-driven discovery using libp2p GossipSub for instant signer discovery with no polling or DHT queries required.

## Architecture

### Topics Structure

```
musig2:signers:{transactionType}
```

**Examples:**

- `musig2:signers:swap` - Swap signer advertisements
- `musig2:signers:spend` - Spend signer advertisements
- `musig2:signers:coinjoin` - CoinJoin signer advertisements

### Message Flow

```
1. Bob advertises for "swap":
   → Publish to topic: musig2:signers:swap
   → Message: SignerAdvertisementPayload (self-signed)

2. Alice subscribes to "swap":
   → Subscribe to: musig2:signers:swap
   → Receives: Bob's advertisement (real-time!)
   → Verifies signature locally
   → Event: SIGNER_DISCOVERED emitted

3. No polling, no timeouts, instant discovery!
```

## Implementation

### 1. GossipSub Integration

✅ **Implemented in**: `lib/p2p/coordinator.ts`

```typescript
import { gossipsub } from '@libp2p/gossipsub'

services: {
  identify: identify(),
  ping: ping(),
  kadDHT: kadDHT({...}),
  pubsub: gossipsub({
    allowPublishToZeroTopicPeers: true,
    emitSelf: false,
  }),
}
```

**Configuration:**

```typescript
const coordinator = new MuSig2P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/4001'],
  enableDHT: true,
  enableGossipSub: true, // Default: true
})
```

### 2. Pub/Sub Methods (Base Layer)

✅ **Implemented in**: `lib/p2p/coordinator.ts`

```typescript
// Subscribe to any topic
async subscribeToTopic(
  topic: string,
  handler: (message: Uint8Array) => void
): Promise<void>

// Publish to any topic
async publishToTopic(topic: string, message: unknown): Promise<void>

// Unsubscribe from topic
async unsubscribeFromTopic(topic: string): Promise<void>

// Get topic subscribers
getTopicPeers(topic: string): string[]
```

### 3. MuSig2-Specific Methods

✅ **Implemented in**: `lib/p2p/musig2/coordinator.ts`

```typescript
// Subscribe to transaction-type-specific topics
async subscribeToSignerDiscovery(
  transactionTypes: TransactionType[]
): Promise<void> {
  for (const txType of transactionTypes) {
    const topic = `musig2:signers:${txType}`

    await this.subscribeToTopic(topic, (messageData) => {
      const payload = JSON.parse(Buffer.from(messageData).toString('utf8'))
      const advertisement = this._deserializeAdvertisement(payload)

      // SECURITY: Verify signature before trusting
      if (!this.verifyAdvertisementSignature(advertisement)) {
        return // Drop invalid
      }

      // SECURITY: Check rate limits and key counts
      if (!this.securityManager.canAdvertiseKey(
        payload.peerId,
        advertisement.publicKey
      )) {
        return // Drop rate-limited
      }

      // Prevent duplicate emissions
      const pubKeyStr = advertisement.publicKey.toString()
      if (this.signerAdvertisements.has(pubKeyStr)) {
        return // Already discovered
      }

      // ARCHITECTURE: Emit appropriate event based on sender
      const isSelfAdvertisement = payload.peerId === this.peerId

      if (isSelfAdvertisement) {
        this.emit(MuSig2Event.SIGNER_ADVERTISED, advertisement)
      } else {
        this.emit(MuSig2Event.SIGNER_DISCOVERED, advertisement)
      }
    })
  }
}

// Unsubscribe from all signer topics
async unsubscribeFromSignerDiscovery(): Promise<void>
```

### 4. Message Validation Pipeline

✅ **Implemented**: 4-layer security validation

```typescript
// Layer 1: Size validation (DoS prevention)
if (messageData.length > limits.MAX_ADVERTISEMENT_SIZE) {
  console.warn('Oversized advertisement dropped')
  return // Drop oversized messages
}

// Layer 2: Timestamp validation (replay prevention)
const timestampSkew = Math.abs(Date.now() - payload.timestamp)
if (timestampSkew > limits.MAX_TIMESTAMP_SKEW) {
  console.warn('Stale/future advertisement dropped')
  return // Drop stale/future messages
}

// Layer 3: Expiration validation
if (payload.expiresAt && payload.expiresAt < Date.now()) {
  console.warn('Expired advertisement dropped')
  return // Drop expired messages
}

// Layer 4: Signature verification (cryptographic proof)
if (!this.verifyAdvertisementSignature(advertisement)) {
  this.securityManager.recordInvalidSignature(payload.peerId)
  return // Drop invalid signatures
}
```

### 5. Topic Management

✅ **Implemented**: Dynamic topic subscription

```typescript
// Topics are created dynamically based on transaction types
const topics = transactionTypes.map(txType => `musig2:signers:${txType}`)

// Supported transaction types
export enum TransactionType {
  SWAP = 'swap',
  SPEND = 'spend',
  COINJOIN = 'coinjoin',
  MULTI_SIG = 'multi-sig',
  ESCROW = 'escrow',
}

// Topic examples:
// - musig2:signers:swap
// - musig2:signers:spend
// - musig2:signers:coinjoin
```

### 6. Relay Support

✅ **Implemented**: Automatic topic propagation via relay nodes

```typescript
// GossipSub automatically propagates topics through relay nodes
// No additional configuration needed - works out of the box

// For nodes behind NAT, ensure relay is enabled:
const coordinator = new MuSig2P2PCoordinator({
  enableRelay: true, // Use circuit relay v2
  enableAutoNAT: true, // Auto-detect NAT
  enableDCUTR: true, // Direct connection upgrade
  enableUPnP: true, // Auto port forwarding
})
```

### 4. Dual-Channel Advertisement

✅ **Implemented in**: `advertiseSigner()`

Publishes to **THREE channels** for maximum reliability:

```typescript
async advertiseSigner(...) {
  // 1. DHT storage (offline/historical discovery)
  await this._addToSignerDirectory(txType, publicKey, advertisement)

  // 2. GossipSub topics (real-time pub/sub)
  for (const txType of criteria.transactionTypes) {
    await this.publishToTopic(`musig2:signers:${txType}`, payload)
  }

  // 3. P2P broadcast (direct peer messaging)
  await this.broadcast({
    type: MuSig2MessageType.SIGNER_ADVERTISEMENT,
    payload,
  })
}
```

**Why Multiple Channels?**

- **GossipSub**: Real-time for subscribers (instant!)
- **P2P Broadcast**: Reaches directly connected peers
- **DHT**: Persistence for offline/later queries

### 5. Security: Signature Verification

✅ **Implemented**: `verifyAdvertisementSignature()`

**Verification at Receipt Time:**

```typescript
// Called automatically for ALL incoming advertisements:
// - GossipSub messages
// - P2P broadcasts
// - DHT queries

verifyAdvertisementSignature(advertisement: SignerAdvertisement): boolean {
  // Reconstruct signed data (MUST match advertiseSigner() format)
  const adData = Buffer.concat([
    Buffer.from(advertisement.peerId),
    Buffer.from(JSON.stringify(advertisement.multiaddrs)),
    publicKey.toBuffer(),
    Buffer.from(JSON.stringify(criteria)),
    Buffer.from(timestamp.toString()),
    Buffer.from(expiresAt.toString()),
  ])

  const hashbuf = Hash.sha256(adData)
  const signature = new Signature({ r: ..., s: ... })

  return Schnorr.verify(hashbuf, signature, publicKey, 'big')
}
```

**Security Properties:**

- ✅ Alice verifies signatures locally (doesn't trust Zoe)
- ✅ Invalid advertisements dropped silently
- ✅ No MITM possible (signature validation)
- ✅ Multiaddr tampering detected (breaks signature)

### 6. Application-Layer Deduplication

✅ **Required**: Due to multi-channel broadcasting

**Why Deduplication is Needed:**

`advertiseSigner()` uses multiple channels (GossipSub + P2P broadcast) for reliability, which means Alice may receive the same advertisement twice.

**Solution:** Deduplicate in your application by public key:

```typescript
const seenPublicKeys = new Set<string>()

coordinator.on(MuSig2Event.SIGNER_DISCOVERED, ad => {
  const key = ad.publicKey.toString()

  if (seenPublicKeys.has(key)) {
    return // Already processed this signer
  }

  seenPublicKeys.add(key)
  discoveredSigners.push(ad)
})
```

**Why NOT in the library?**

- ✅ Prevents state pollution
- ✅ Avoids memory leaks (caching signatures)
- ✅ Handles re-advertising correctly
- ✅ Application has full control
- ✅ Simple `Set` tracking works perfectly

## Usage

### Scenario 1: DHT-Based Discovery (Offline)

For discovering services that advertised BEFORE you connected:

```typescript
// Bob & Charlie advertised services yesterday
// Alice connects today and queries DHT

const signers = await coordinator.findAvailableSigners({
  transactionType: TransactionType.SWAP,
  minAmount: 10_000_000,
  maxResults: 10,
})

console.log(`Found ${signers.length} signers from DHT`)
```

### Scenario 2: GossipSub Real-Time Discovery

For receiving instant notifications when NEW signers advertise:

```typescript
// Alice subscribes FIRST (before advertisers)
await coordinator.subscribeToSignerDiscovery([TransactionType.SWAP])

// Application-layer deduplication
const discoveredSigners: SignerAdvertisement[] = []
const seenPublicKeys = new Set<string>()

coordinator.on(MuSig2Event.SIGNER_DISCOVERED, ad => {
  // Deduplicate by public key (receives via GossipSub + P2P)
  const key = ad.publicKey.toString()
  if (!seenPublicKeys.has(key)) {
    seenPublicKeys.add(key)
    discoveredSigners.push(ad)
    console.log(`📥 Discovered: ${ad.metadata?.nickname}`)
  }
})

// Later: Bob & Charlie advertise
// Alice receives notifications INSTANTLY!
```

### Hybrid Approach (Production)

Use BOTH mechanisms for reliability:

```typescript
// 1. Subscribe for real-time (preferred)
await coordinator.subscribeToSignerDiscovery([TransactionType.SWAP])

// 2. Event handler for instant discovery
coordinator.on(MuSig2Event.SIGNER_DISCOVERED, ad => {
  addToUI(ad)
})

// 3. Also query DHT for historical data (fallback)
const historical = await coordinator.findAvailableSigners({
  transactionType: TransactionType.SWAP,
})
```

## Application-Layer Deduplication

**Why Deduplication is Needed:**

`advertiseSigner()` uses multiple channels (GossipSub + P2P broadcast) for reliability, which means Alice may receive the same advertisement twice.

**Solution:** Deduplicate in your application by public key:

```typescript
const seenPublicKeys = new Set<string>()

coordinator.on(MuSig2Event.SIGNER_DISCOVERED, ad => {
  const key = ad.publicKey.toString()

  if (seenPublicKeys.has(key)) {
    return // Already processed this signer
  }

  seenPublicKeys.add(key)
  discoveredSigners.push(ad)
})
```

**Why NOT in the library?**

- ✅ Prevents state pollution
- ✅ Avoids memory leaks (caching signatures)
- ✅ Handles re-advertising correctly
- ✅ Application has full control
- ✅ Simple `Set` tracking works perfectly

## Performance

### Latency Comparison

| Mechanism     | Latency    | Use Case            |
| ------------- | ---------- | ------------------- |
| GossipSub     | 10-100ms   | Real-time discovery |
| P2P Broadcast | 50-200ms   | Direct messaging    |
| DHT Query     | 500-2000ms | Offline/historical  |

### Network Overhead

```
GossipSub Message Size: ~500 bytes
  - SignerAdvertisementPayload (JSON)
  - Includes: peerId, multiaddrs, publicKey, criteria, signature

Bandwidth:
  - 10 advertisers × 500 bytes = 5 KB
  - Negligible for modern networks
```

## Security

### Multi-Layer Defense (4 Security Checks)

Every advertisement undergoes validation before processing:

```typescript
// Defined in types.ts
export const MUSIG2_SECURITY_LIMITS = {
  MAX_ADVERTISEMENT_SIZE: 10_000,       // 10KB (DoS prevention)
  MAX_TIMESTAMP_SKEW: 300_000,          // 5 minutes (time attack prevention)
  MIN_ADVERTISEMENT_INTERVAL: 60_000,   // 60 seconds (rate limiting - future)
  MAX_INVALID_SIGNATURES_PER_PEER: 10,  // Ban threshold (future)
}

// Applied on ALL channels (GossipSub, P2P, DHT):
Layer 1: if (size > 10KB) → DROP
Layer 2: if (|now - timestamp| > 5min) → DROP
Layer 3: if (expiresAt < now) → DROP
Layer 4: if (!verifySignature) → DROP
```

### Trust Model

**Alice CANNOT trust Zoe** (or any intermediary):

```
Bob → Signs advertisement → Publishes via Zoe → Alice receives

Alice's 4-Layer Validation:
  1. ✅ Size check (< 10KB)
  2. ✅ Timestamp check (within 5 minutes)
  3. ✅ Expiry check (not expired)
  4. ✅ Signature verification (cryptographic proof)

  ❌ Does NOT trust Zoe
  ✅ Only trusts math & cryptography
```

### Attack Resistance

| Attack Type            | Protection                      | Layer   |
| ---------------------- | ------------------------------- | ------- |
| Message Flooding (DoS) | ✅ 10KB size limit              | Layer 1 |
| Memory Exhaustion      | ✅ Size validation              | Layer 1 |
| Time-based Attacks     | ✅ 5-minute skew limit          | Layer 2 |
| Replay Attacks         | ✅ Expiry + timestamps          | Layer 3 |
| DHT Poisoning          | ✅ Signature verification       | Layer 4 |
| Impersonation          | ✅ Only key owner can sign      | Layer 4 |
| Multiaddr Tampering    | ✅ Part of signed data          | Layer 4 |
| MITM                   | ✅ Signature breaks if modified | Layer 4 |

## Examples

See `examples/musig2-three-phase-example.ts`:

- `matchmakingDHTExample()` - DHT-based discovery
- `matchmakingGossipSubExample()` - GossipSub real-time discovery

## Related Documentation

- [MuSig2 README](./README.md) - Complete API reference
- [P2P DHT Architecture](../../docs/P2P_DHT_ARCHITECTURE.md) - DHT internals
- [Examples](../../examples/SCENARIOS.md) - Discovery scenarios

---

**Built with libp2p GossipSub for the Lotus Ecosystem** 🌸
