# MuSig2 P2P Broadcast Architecture

## Core Principle: Protocol Handler as Single Source of Truth

**ALL** broadcasts follow the same pattern - the sender receives their own broadcast via GossipSub, and the protocol handler emits ALL events.

## Architecture Rules

1. **Broadcasters NEVER emit events locally** - they only broadcast messages
2. **Protocol Handler emits ALL events** - for both self and others
3. **No self-message filtering** - all peers (including sender) process their own broadcasts
4. **Semantic Event Differentiation** - handler emits different events for self vs others where semantically appropriate

## Message Flow

```
┌─────────────┐
│  Peer A     │  1. Broadcasts message
│ (Sender)    │  2. Does NOT emit event locally
└──────┬──────┘
       │
       ▼ broadcast()
┌─────────────────┐
│   GossipSub     │  3. Delivers to ALL subscribers (including sender)
│   (libp2p)      │
└────────┬────────┘
         │
         ├──────────────┬──────────────┬
         ▼              ▼              ▼
    ┌────────┐    ┌────────┐    ┌────────┐
    │ Peer A │    │ Peer B │    │ Peer C │
    │(Sender)│    │        │    │        │
    └───┬────┘    └───┬────┘    └───┬────┘
        │             │             │
        ▼             ▼             ▼
┌────────────────────────────────────────┐
│      Protocol Handler                   │  4. ALL peers process message
│  - Checks if from self                  │  5. Emits appropriate events
│  - Emits appropriate events             │     - Self: creator/action events
│  - NO filtering of self-messages        │     - Others: received/discovery events
└────────────────────────────────────────┘
```

## Event Mapping

| Message Type           | Sender Receives           | Others Receive             | Notes               |
| ---------------------- | ------------------------- | -------------------------- | ------------------- |
| `SIGNER_ADVERTISEMENT` | `SIGNER_ADVERTISED`       | `SIGNER_DISCOVERED`        | Semantic difference |
| `SIGNER_UNAVAILABLE`   | `SIGNER_WITHDRAWN`        | `SIGNER_UNAVAILABLE`       | Semantic difference |
| `SIGNING_REQUEST`      | `SIGNING_REQUEST_CREATED` | `SIGNING_REQUEST_RECEIVED` | Semantic difference |
| `PARTICIPANT_JOINED`   | `PARTICIPANT_JOINED`      | `PARTICIPANT_JOINED`       | Same for all        |
| `SESSION_READY`        | `SESSION_READY`           | `SESSION_READY`            | Same for all        |
| `NONCE_SHARE`          | (no event)                | (no event)                 | Internal state only |
| `PARTIAL_SIG_SHARE`    | (no event)                | (no event)                 | Internal state only |
| `SESSION_ABORT`        | (handled)                 | (handled)                  | Same for all        |

## Implementation Details

### Broadcast Channels

The MuSig2 implementation uses **three broadcast channels** for maximum reliability:

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

**Channel Characteristics:**

- **GossipSub**: Real-time for subscribers (10-100ms latency)
- **P2P Broadcast**: Reaches directly connected peers (50-200ms latency)
- **DHT**: Persistence for offline/later queries (500-2000ms latency)

### Deferred Event System

To ensure state consistency, the coordinator uses a deferred event system:

```typescript
private deferredEvents: Array<{event: string, data: unknown}> = []

private deferEvent<T>(event: string, data: T): void {
  this.deferredEvents.push({ event, data })

  // Process in next tick to ensure state consistency
  // Uses cross-platform scheduleNextTick() for browser compatibility
  import { scheduleNextTick } from './utils.js'
  scheduleNextTick(() => {
    this._collectDeferredEvents()
  })
}
```

**Why Deferred Events?**

- Prevents race conditions between state updates and event emissions
- Ensures all listeners see consistent state
- Guarantees event ordering across async operations
- **Cross-platform compatible**: Works in both Node.js and browsers

### Mutex-Based Concurrency Control

The implementation uses mutex locks to prevent concurrent state modifications:

```typescript
// State operations (sessions, metadata)
private async withStateLock<T>(fn: () => Promise<T>): Promise<T>

// Advertisement operations
private async withAdvertisementLock<T>(fn: () => Promise<T>): Promise<T>

// Signing request operations
private async withSigningRequestLock<T>(fn: () => Promise<T>): Promise<T>
```

**Lock Hierarchy:**

1. State Lock (highest priority)
2. Advertisement Lock
3. Signing Request Lock

### Message Validation Pipeline

All incoming messages pass through a 4-layer validation pipeline:

```typescript
// Layer 1: Size validation
if (messageData.length > limits.MAX_ADVERTISEMENT_SIZE) {
  return // Drop oversized messages
}

// Layer 2: Timestamp validation
const timestampSkew = Math.abs(Date.now() - payload.timestamp)
if (timestampSkew > limits.MAX_TIMESTAMP_SKEW) {
  return // Drop stale/future messages
}

// Layer 3: Expiration validation
if (payload.expiresAt && payload.expiresAt < Date.now()) {
  return // Drop expired messages
}

// Layer 4: Signature verification
if (!this.verifyAdvertisementSignature(advertisement)) {
  this.securityManager.recordInvalidSignature(payload.peerId)
  return // Drop invalid signatures
}
```

## Benefits

1. **Consistent Ordering** - All peers emit events in the same order
2. **No Race Conditions** - Sender waits for broadcast propagation before emitting
3. **Single Source of Truth** - Protocol handler is the only place that emits events
4. **Simpler Logic** - No duplicate emission prevention needed in broadcasters
5. **Better Testing** - All event logic is in one place (protocol handler)
6. **Reliable Delivery** - Multiple broadcast channels ensure message delivery
7. **State Consistency** - Deferred events and mutex locks prevent race conditions

## Implementation Checklist

- [x] Remove self-message filter from protocol handler
- [x] Update `advertiseSigner()` - remove local `SIGNER_ADVERTISED` emission
- [x] Update `withdrawAdvertisement()` - remove local `SIGNER_WITHDRAWN` emission
- [x] Update `announceSigningRequest()` - remove local `SIGNING_REQUEST_CREATED` emission
- [x] Update `joinSigningRequest()` - document that event is emitted by handler
- [x] Update protocol handler `_handleSignerAdvertisement()` - emit both events based on sender
- [x] Update protocol handler `_handleSignerUnavailable()` - emit both events based on sender
- [x] Update protocol handler `_handleSigningRequest()` - emit both events based on sender
- [x] Update protocol handler `_handleParticipantJoined()` - emit `SIGNING_REQUEST_JOINED` for self
- [x] Update protocol handler `_handleSessionReady()` - already correct
- [x] Update GossipSub handler in `subscribeToSignerDiscovery()` - emit both events based on sender
- [x] Implement deferred event system for state consistency
- [x] Add mutex-based concurrency control
- [x] Implement 4-layer message validation pipeline
- [x] Add multi-channel broadcast architecture

## Complete! ✅

All broadcast messages now follow the unified architecture where:

1. Broadcasters never emit events locally
2. Protocol handler emits ALL events when broadcasts are received
3. All peers (including sender) receive their own broadcasts
4. Events are emitted in consistent order across all peers
5. State consistency is maintained through deferred events and mutex locks
6. Message delivery is reliable through multiple broadcast channels
7. Security is enforced through comprehensive validation pipeline
