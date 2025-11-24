## MuSig2 P2P Coordination

Production-ready P2P coordination layer for MuSig2 multi-signature sessions.

### Architecture

This implementation provides a clean, layered architecture for MuSig2 coordination:

```
┌─────────────────────────────────────────────────────────────┐
│              MuSig2P2PCoordinator (Application)             │
│  • Session creation and management                           │
│  • Nonce and signature coordination                          │
│  • Event emission                                            │
└─────────────────────────────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Protocol    │  │  Security    │  │   Session    │
│  Handler     │  │  Validator   │  │   Manager    │
│              │  │              │  │              │
│ • Message    │  │ • Validation │  │ • Crypto ops │
│   routing    │  │ • Rate limit │  │ • Nonce agg  │
│ • Events     │  │ • Auth check │  │ • Sig agg    │
└──────────────┘  └──────────────┘  └──────────────┘
         │                │                │
         └────────────────┼────────────────┘
                          ▼
         ┌────────────────────────────────┐
         │      P2PCoordinator (Base)     │
         │  • GossipSub (announcements)   │
         │  • Direct P2P (coordination)   │
         │  • DHT (discovery)             │
         └────────────────────────────────┘
```

### Discovery Model

**GossipSub for Announcements:**

- Session creators publish announcements to `lotus/musig2/sessions` topic
- All nodes subscribe and discover available sessions
- Fast, decentralized discovery without DHT queries

**Direct P2P for Coordination:**

- Once participants know each other, use direct messaging
- Nonce exchange happens peer-to-peer
- Partial signature exchange happens peer-to-peer
- No GossipSub overhead for round data

### Quick Start

#### 1. Create Coordinator

```typescript
import { MuSig2P2PCoordinator } from 'lotus-sdk/lib/p2p/musig2'
import { P2PConfig } from 'lotus-sdk/lib/p2p'

// Configure P2P layer
const p2pConfig: P2PConfig = {
  listen: ['/ip4/0.0.0.0/tcp/0'],
  bootstrapPeers: ['/dns4/bootstrap.lotusia.org/tcp/4001/p2p/12D3KooW...'],
  enableDHT: true,
  enableGossipSub: true,
}

// Create coordinator
const coordinator = new MuSig2P2PCoordinator(p2pConfig)
await coordinator.start()
```

#### 2. Create and Announce Session

```typescript
import { PublicKey } from 'lotus-sdk/lib/bitcore/publickey'
import { PrivateKey } from 'lotus-sdk/lib/bitcore/privatekey'

// Define signers (sorted)
const signers = [
  PublicKey.fromString('02...'),
  PublicKey.fromString('03...'),
  PublicKey.fromString('02...'),
].sort((a, b) => a.toBuffer().compare(b.toBuffer()))

const myPrivateKey = PrivateKey.fromWIF('...')
const message = Buffer.from('transaction hash', 'hex')

// Create session
const sessionId = await coordinator.createSession(
  signers,
  myPrivateKey,
  message,
)

// Announce to network
await coordinator.announceSession(sessionId)
```

#### 3. Listen for Sessions

```typescript
import { MuSig2Event } from 'lotus-sdk/lib/p2p/musig2'

coordinator.on(MuSig2Event.SESSION_DISCOVERED, announcement => {
  console.log('New session:', announcement.sessionId)
  console.log('Coordinator:', announcement.coordinatorPeerId)
  console.log('Required signers:', announcement.requiredSigners)

  // Decide whether to join...
})
```

#### 4. Coordinate Signing (3-Phase Process)

**Phase 1: Nonce Exchange**

```typescript
// Wait for all participants to join
coordinator.on(MuSig2Event.SESSION_READY, async sessionId => {
  // Share nonces
  await coordinator.shareNonces(sessionId, myPrivateKey)
})

// Wait for all nonces
coordinator.on(MuSig2Event.NONCES_COMPLETE, sessionId => {
  console.log('All nonces collected!')
  // Ready for partial signatures
})
```

**Phase 2: Partial Signature Exchange**

```typescript
// Share partial signature
await coordinator.sharePartialSignature(sessionId, myPrivateKey)

// Wait for all partial signatures
coordinator.on(MuSig2Event.PARTIAL_SIGS_COMPLETE, sessionId => {
  console.log('All partial signatures collected!')
  // Ready to finalize
})
```

**Phase 3: Finalization**

```typescript
// Finalize and get signature
if (coordinator.canFinalizeSession(sessionId)) {
  const signature = coordinator.finalizeSession(sessionId)
  console.log('Final signature:', signature.toString('hex'))
}
```

### Event-Driven API

All coordination happens through events:

```typescript
import { MuSig2Event } from 'lotus-sdk/lib/p2p/musig2'

// Session lifecycle
coordinator.on(MuSig2Event.SESSION_CREATED, sessionId => {})
coordinator.on(MuSig2Event.SESSION_DISCOVERED, announcement => {})
coordinator.on(MuSig2Event.SESSION_READY, sessionId => {})

// Round 1
coordinator.on(MuSig2Event.NONCE_RECEIVED, (sessionId, signerIndex) => {})
coordinator.on(MuSig2Event.NONCES_COMPLETE, sessionId => {})

// Round 2
coordinator.on(MuSig2Event.PARTIAL_SIG_RECEIVED, (sessionId, signerIndex) => {})
coordinator.on(MuSig2Event.PARTIAL_SIGS_COMPLETE, sessionId => {})

// Completion
coordinator.on(MuSig2Event.SESSION_COMPLETE, (sessionId, signature) => {})
coordinator.on(MuSig2Event.SESSION_ABORTED, (sessionId, reason) => {})
coordinator.on(MuSig2Event.SESSION_ERROR, (sessionId, error) => {})
```

### Security Features

**Built-in Validation:**

- Session announcement validation
- Public key format verification
- Nonce and signature format validation
- Timestamp validation (prevents replay)
- Signer count limits (2-15 signers)

**Rate Limiting:**

- Inherits core P2P rate limiting
- DHT announcement throttling
- DoS protection

**Protocol Isolation:**

- MuSig2 uses dedicated protocol handler
- Message routing isolated from other protocols
- Security validator registered with core

### Configuration

```typescript
import { MuSig2P2PConfig, MuSig2SecurityConfig } from 'lotus-sdk/lib/p2p/musig2'

const musig2Config: MuSig2P2PConfig = {
  announcementTopic: 'lotus/musig2/sessions',
  announcementTTL: 5 * 60 * 1000, // 5 minutes
  nonceTimeout: 60 * 1000, // 1 minute
  partialSigTimeout: 60 * 1000, // 1 minute
  maxConcurrentSessions: 10,
  enableAutoCleanup: true,
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
}

const securityConfig: MuSig2SecurityConfig = {
  minSigners: 2,
  maxSigners: 15,
  maxSessionDuration: 10 * 60 * 1000, // 10 minutes
  requireValidPublicKeys: true,
}

const coordinator = new MuSig2P2PCoordinator(
  p2pConfig,
  musig2Config,
  securityConfig,
)
```

### Session Management

**Get Session Info:**

```typescript
const session = coordinator.getSession(sessionId)

console.log('Phase:', session.session.phase)
console.log('Participants:', session.participants.size)
console.log('Is Coordinator:', session.isCoordinator)
console.log('Last Activity:', session.lastActivity)
```

**List All Sessions:**

```typescript
const allSessions = coordinator.getAllSessions()

for (const session of allSessions) {
  console.log(`${session.session.sessionId}: ${session.session.phase}`)
}
```

**Abort Session:**

```typescript
await coordinator.abortSession(sessionId, 'Timeout waiting for signatures')
```

### Production Considerations

**1. Participant Management**

In production, you'll need to:

- Track which peers correspond to which signer indices
- Handle peer disconnections gracefully
- Implement timeouts for each phase

**2. Error Handling**

```typescript
coordinator.on(MuSig2Event.SESSION_ERROR, (sessionId, error) => {
  console.error(`Session ${sessionId} error:`, error)

  // Abort and notify participants
  coordinator.abortSession(sessionId, error.message).catch(console.error)
})
```

**3. Cleanup**

Sessions auto-cleanup after 10 minutes of inactivity. Manually cleanup:

```typescript
// On shutdown
await coordinator.stop()
```

### Design Principles

**1. Simplicity First**

- Clean separation between P2P and cryptography
- Event-driven API (no complex state machines)
- Minimal coupling between components

**2. Production Ready**

- Comprehensive error handling
- Security validation at every layer
- Automatic resource cleanup

**3. Extensible**

- Protocol handler pattern
- Security validator pattern
- Easy to add new message types

### Differences from Old Implementation

The old implementation (`musig2.old`) had several issues:

- ❌ Complex state machines prone to deadlocks
- ❌ Tight coupling between P2P and crypto
- ❌ DHT-heavy (slow discovery)
- ❌ Difficult to debug and maintain

This new implementation:

- ✅ Simple event-driven flow
- ✅ Clean separation of concerns
- ✅ GossipSub for fast discovery
- ✅ Direct P2P for coordination
- ✅ Easy to understand and maintain

### Reference

Based on Blockchain Commons MuSig2 coordination sequence:
https://developer.blockchaincommons.com/musig/sequence/

**Key Flow:**

1. Coordinator announces session (GossipSub)
2. Participants discover and join
3. Round 1: Nonce exchange (Direct P2P)
4. Round 2: Partial signature exchange (Direct P2P)
5. Finalization: Aggregate signature

### Testing

See test files:

- `test/p2p/musig2/coordinator.test.ts`
- `test/p2p/musig2/protocol-handler.test.ts`
- `test/p2p/musig2/integration.test.ts`

### Support

For issues or questions, see: https://github.com/LotusiaStewardship/lotus-sdk/issues
