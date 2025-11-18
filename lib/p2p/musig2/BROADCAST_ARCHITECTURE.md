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

| Message Type | Sender Receives | Others Receive | Notes |
|---|---|---|---|
| `SIGNER_ADVERTISEMENT` | `SIGNER_ADVERTISED` | `SIGNER_DISCOVERED` | Semantic difference |
| `SIGNER_UNAVAILABLE` | `SIGNER_WITHDRAWN` | `SIGNER_UNAVAILABLE` | Semantic difference |
| `SIGNING_REQUEST` | `SIGNING_REQUEST_CREATED` | `SIGNING_REQUEST_RECEIVED` | Semantic difference |
| `PARTICIPANT_JOINED` | `PARTICIPANT_JOINED` | `PARTICIPANT_JOINED` | Same for all |
| `SESSION_READY` | `SESSION_READY` | `SESSION_READY` | Same for all |
| `NONCE_SHARE` | (no event) | (no event) | Internal state only |
| `PARTIAL_SIG_SHARE` | (no event) | (no event) | Internal state only |
| `SESSION_ABORT` | (handled) | (handled) | Same for all |

## Benefits

1. **Consistent Ordering** - All peers emit events in the same order
2. **No Race Conditions** - Sender waits for broadcast propagation before emitting
3. **Single Source of Truth** - Protocol handler is the only place that emits events
4. **Simpler Logic** - No duplicate emission prevention needed in broadcasters
5. **Better Testing** - All event logic is in one place (protocol handler)

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

## Complete! ✅

All broadcast messages now follow the unified architecture where:
1. Broadcasters never emit events locally
2. Protocol handler emits ALL events when broadcasts are received
3. All peers (including sender) receive their own broadcasts
4. Events are emitted in consistent order across all peers

