# MuSig2 P2P Event-Driven Architecture

**Version**: 1.0.0  
**Status**: ✅ **IMPLEMENTED**  
**Last Updated**: November 2025

---

## Overview

The MuSig2 P2P implementation is **100% event-driven** with **zero internal timeouts or intervals**. All timing and scheduling is controlled by the application layer, not the library.

## Core Principle

> **The library emits events; the application controls timing.**

This architectural decision provides:

- ✅ **Flexibility**: Applications control timeout durations
- ✅ **Testability**: No internal timers to mock or wait for
- ✅ **Determinism**: Behavior is predictable and reproducible
- ✅ **Resource Efficiency**: No background timers running
- ✅ **Clarity**: Clear separation between library and application concerns

---

## Removed Internal Timers

The following internal timers have been **completely removed**:

### 1. Session Cleanup (`setInterval`)

**Old Behavior** (❌ Removed):

```typescript
// Library automatically cleaned up sessions every 60 seconds
this.sessionCleanupIntervalId = setInterval(() => {
  this.cleanupExpiredSessions()
}, 60000)
```

**New Behavior** (✅ Event-Driven):

```typescript
// Application manually triggers cleanup when needed
coordinator.cleanupExpiredSessions()

// Or set up application-level periodic cleanup if desired
setInterval(() => {
  coordinator.cleanupExpiredSessions()
}, 60000)
```

### 2. Coordinator Failover (`setTimeout`)

**Old Behavior** (❌ Removed):

```typescript
// Library automatically triggered failover after 5 minutes
const timeoutId = setTimeout(
  () => {
    this._handleCoordinatorTimeout(sessionId)
  },
  5 * 60 * 1000,
)
```

**New Behavior** (✅ Event-Driven):

```typescript
// Application controls failover timing
coordinator.on('session:should-broadcast', async sessionId => {
  const timeout = setTimeout(
    () => {
      coordinator.triggerCoordinatorFailover(sessionId)
    },
    5 * 60 * 1000,
  ) // Application chooses timeout

  try {
    await broadcastTransaction(sessionId)
    clearTimeout(timeout) // Success - cancel failover
    coordinator.notifyBroadcastComplete(sessionId)
  } catch (error) {
    // Let timeout trigger failover
  }
})
```

### 3. Identity Manager Cleanup (`setInterval`)

**Old Behavior** (❌ Removed):

```typescript
// Library automatically cleaned up identity data every hour
this.cleanupIntervalId = setInterval(
  () => {
    this.cleanup()
  },
  60 * 60 * 1000,
)
```

**New Behavior** (✅ Event-Driven):

```typescript
// Application manually triggers cleanup when needed
const identityManager = coordinator.getIdentityManager()
identityManager.cleanup()
```

---

## Removed Configuration Options

The following configuration options have been **removed** as they are no longer needed:

```typescript
interface MuSig2P2PConfig {
  // ❌ REMOVED: No automatic broadcast timeout
  broadcastTimeout?: number

  // ❌ REMOVED: No automatic cleanup
  enableAutoCleanup?: boolean
  cleanupInterval?: number
}
```

The following configuration options remain:

```typescript
interface MuSig2P2PConfig {
  // ✅ RETAINED: Used by manual cleanup to determine "stuck" threshold
  stuckSessionTimeout?: number // Default: 10 minutes

  // ✅ RETAINED: Security and identity management
  enableBurnBasedIdentity?: boolean
  enableCoordinatorElection?: boolean
  enableSessionDiscovery?: boolean

  // ✅ RETAINED: Performance tuning
  maxConcurrentSessions?: number
  maxAdvertisementsPerPeer?: number
  maxSigningRequestsPerPeer?: number
}
```

---

## Event-Driven API

### Public Methods for Manual Control

#### 1. `cleanupExpiredSessions()`

Manually clean up expired and stuck sessions.

```typescript
public async cleanupExpiredSessions(): Promise<void>
```

**When to call**:

- Before processing important operations
- Periodically (if desired, via application-level timer)
- When memory pressure is detected
- On application startup/shutdown

**Example**:

```typescript
// Option 1: On-demand cleanup
await coordinator.cleanupExpiredSessions()

// Option 2: Periodic cleanup (application-managed)
setInterval(() => {
  coordinator.cleanupExpiredSessions()
}, 60000) // Every minute

// Option 3: Event-triggered cleanup
coordinator.on('session:created', async () => {
  await coordinator.cleanupExpiredSessions() // Clean before creating new session
})
```

#### 2. `triggerCoordinatorFailover()`

Manually trigger coordinator failover.

```typescript
public async triggerCoordinatorFailover(sessionId: string): Promise<void>
```

**When to call**:

- When coordinator fails to broadcast within acceptable timeframe
- When broadcast error is detected
- When coordinator becomes unresponsive

**Example**:

```typescript
coordinator.on('session:should-broadcast', async sessionId => {
  // Application-level timeout
  const timeout = setTimeout(
    () => {
      console.warn('Coordinator timeout, triggering failover')
      await coordinator.triggerCoordinatorFailover(sessionId)
    },
    5 * 60 * 1000,
  )

  try {
    await buildAndBroadcastTransaction(sessionId)
    clearTimeout(timeout)
    coordinator.notifyBroadcastComplete(sessionId)
  } catch (error) {
    console.error('Broadcast failed:', error)
    // Optionally trigger immediate failover
    clearTimeout(timeout)
    await coordinator.triggerCoordinatorFailover(sessionId)
  }
})
```

#### 3. `notifyBroadcastComplete()`

Signal that broadcast completed successfully.

```typescript
public notifyBroadcastComplete(sessionId: string): void
```

**When to call**:

- Immediately after successful transaction broadcast
- Emits `SESSION_BROADCAST_CONFIRMED` event

**Example**:

```typescript
try {
  await lotus.sendRawTransaction(tx.serialize())
  coordinator.notifyBroadcastComplete(sessionId) // Success
} catch (error) {
  // Handle error, possibly trigger failover
}
```

#### 4. Session Management Methods

```typescript
// Get active session IDs
public async getActiveSessions(): Promise<string[]>

// Get session details
public async getSession(sessionId: string): Promise<MuSigSession | null>

// Get active session (throws if not found)
public async getActiveSession(sessionId: string): Promise<MuSigSession | undefined>

// Close session manually
public async closeSession(sessionId: string): Promise<void>

// Get session status
public async getSessionStatus(sessionId: string): Promise<{
  phase: MuSigSessionPhase
  participants: number
  isCoordinator: boolean
  hasMyNonceShare: boolean
  hasAllNonceShares: boolean
  hasMyPartialSig: boolean
  hasAllPartialSigs: boolean
}>
```

#### 5. Signer Discovery Methods

```typescript
// Subscribe to real-time signer discovery
public async subscribeToSignerDiscovery(
  transactionTypes: TransactionType[]
): Promise<void>

// Unsubscribe from signer discovery
public async unsubscribeFromSignerDiscovery(): Promise<void>

// Advertise yourself as a signer
public async advertiseSigner(
  criteria: SignerCriteria,
  metadata?: Record<string, unknown>
): Promise<void>

// Withdraw advertisement
public async withdrawAdvertisement(): Promise<void>

// Find available signers (DHT query)
public async findAvailableSigners(
  filters: SignerSearchFilters
): Promise<SignerAdvertisement[]>

// Connect to specific signer
public async connectToSigner(
  peerId: string,
  multiaddrs?: string[]
): Promise<void>
```

#### 6. Signing Request Methods

```typescript
// Subscribe to signing requests
public async subscribeToSigningRequests(
  criteria?: SignerCriteria
): Promise<void>

// Create signing request
public async announceSigningRequest(
  signers: string[],
  message: Buffer,
  options?: {
    timeout?: number
    metadata?: Record<string, unknown>
  }
): Promise<string> // Returns requestId

// Find signing requests for you
public async findSigningRequestsForMe(
  filters?: {
    minAmount?: number
    maxAmount?: number
    transactionType?: TransactionType
  }
): Promise<SigningRequest[]>

// Join a signing request
public async joinSigningRequest(
  requestId: string,
  signerKey: PrivateKey
): Promise<void>
```

---

## Implementation Details

### Why Deferred Events?

- Prevents race conditions between state updates and event emissions
- Ensures all listeners see consistent state
- Guarantees event ordering across async operations
- **Cross-platform compatible**: Works in both Node.js and browsers

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

### Mutex-Based Concurrency Control

Prevents concurrent state modifications with hierarchical mutex locks:

```typescript
// State operations (sessions, metadata)
private async withStateLock<T>(fn: () => Promise<T>): Promise<T>

// Advertisement operations
private async withAdvertisementLock<T>(fn: () => Promise<T>): Promise<T>

// Signing request operations
private async withSigningRequestLock<T>(fn: () => Promise<T>): Promise<T>
```

### Session Lifecycle Management

Sessions are managed through explicit lifecycle events:

```typescript
// Session creation
coordinator.on('session:created', sessionId => {
  console.log('Session created:', sessionId)
})

// Session ready for signing
coordinator.on('session:ready', data => {
  console.log('Session ready:', data.requestId, data.sessionId)
  // Start Round 1
  await coordinator.startRound1(data.sessionId, privateKey)
})

// Session completion
coordinator.on('session:complete', sessionId => {
  console.log('Session completed:', sessionId)
  // Clean up
  await coordinator.closeSession(sessionId)
})

// Session errors
coordinator.on('session:error', (sessionId, error, code) => {
  console.error('Session error:', sessionId, error)
  // Handle error appropriately
})
```

### Coordinator Election & Failover

Deterministic coordinator election with automatic failover:

```typescript
// Election methods available
import { ElectionMethod, electCoordinator } from './election.js'

// Default: Lexicographic ordering of public keys
const election = electCoordinator(signers, ElectionMethod.LEXICOGRAPHIC)

// Coordinator failover events
coordinator.on(
  'session:coordinator-failed',
  (sessionId, failedIndex, newIndex) => {
    console.log(
      `Coordinator ${failedIndex} failed, new coordinator: ${newIndex}`,
    )
  },
)

coordinator.on('session:failover-exhausted', (sessionId, attempts) => {
  console.error(`Failover exhausted after ${attempts} attempts`)
  // Session cannot continue
})
```

### Security & Identity Management

Burn-based identity registration with reputation tracking:

```typescript
const identityManager = coordinator.getIdentityManager()

// Register identity with burn proof
await identityManager.registerIdentity(txId, outputIndex, publicKey, signature)

// Verify identity
const isValid = await identityManager.verifyIdentity(peerId, publicKey)

// Get reputation
const reputation = identityManager.getReputation(identityId)

// Identity events
identityManager.on('identity:registered', (identityId, burnProof) => {
  console.log('Identity registered:', identityId)
})

identityManager.on('reputation:updated', (identityId, oldScore, newScore) => {
  console.log(`Reputation updated: ${identityId} ${oldScore} → ${newScore}`)
})
```

---

## Migration Guide

### For Applications Using Old API

**Before (❌ Old Automatic API)**:

```typescript
const coordinator = new MuSig2P2PCoordinator(p2pConfig, {
  enableAutoCleanup: true,
  cleanupInterval: 60000,
  broadcastTimeout: 5 * 60 * 1000,
})

// Coordinator automatically cleaned up and failed over
coordinator.on('session:should-broadcast', async sessionId => {
  await broadcastTransaction(sessionId)
  coordinator.notifyBroadcastComplete(sessionId)
})
```

**After (✅ New Event-Driven API)**:

```typescript
const coordinator = new MuSig2P2PCoordinator(p2pConfig, {
  // Removed: enableAutoCleanup, cleanupInterval, broadcastTimeout
  stuckSessionTimeout: 10 * 60 * 1000, // For manual cleanup threshold
})

// Application manages timing
coordinator.on('session:should-broadcast', async sessionId => {
  const timeout = setTimeout(
    () => {
      coordinator.triggerCoordinatorFailover(sessionId)
    },
    5 * 60 * 1000,
  )

  try {
    await broadcastTransaction(sessionId)
    clearTimeout(timeout)
    coordinator.notifyBroadcastComplete(sessionId)
  } catch (error) {
    // Let timeout trigger failover
  }
})

// Application manages cleanup (if desired)
setInterval(() => {
  coordinator.cleanupExpiredSessions()
}, 60000)
```

---

## Benefits of Event-Driven Architecture

### 1. **Testability**

**Before**:

```typescript
// Hard to test - need to wait for internal timers
await coordinator.createSession(...)
await sleep(5 * 60 * 1000) // Wait for timeout
expect(failoverTriggered).toBe(true)
```

**After**:

```typescript
// Easy to test - direct control
await coordinator.createSession(...)
await coordinator.triggerCoordinatorFailover(sessionId)
expect(failoverTriggered).toBe(true)
```

### 2. **Flexibility**

Applications can:

- Use different timeout durations per session
- Implement custom failover logic
- Skip cleanup when not needed
- Control resource usage precisely

### 3. **Debugging**

All timing is explicit in application code:

- Clear stack traces
- No hidden background tasks
- Predictable execution flow

### 4. **Resource Efficiency**

No background timers when library is idle:

- Lower CPU usage
- Better battery life (mobile/IoT)
- Cleaner shutdown

---

## Complete Example

```typescript
import { MuSig2P2PCoordinator } from 'lotus-lib/lib/p2p/musig2'

// 1. Create coordinator (event-driven, no automatic timers)
const coordinator = new MuSig2P2PCoordinator(
  {
    listen: ['/ip4/0.0.0.0/tcp/4001'],
    enableDHT: true,
  },
  {
    enableCoordinatorElection: true,
    enableCoordinatorFailover: true,
    stuckSessionTimeout: 10 * 60 * 1000, // For manual cleanup
  },
)

// 2. Application-level periodic cleanup (optional)
const cleanupTimer = setInterval(() => {
  coordinator.cleanupExpiredSessions()
}, 60000) // Every minute

// 3. Application-managed coordinator failover
coordinator.on('session:should-broadcast', async sessionId => {
  console.log('I am the coordinator, attempting broadcast...')

  // Application controls timeout duration
  const failoverTimeout = setTimeout(
    () => {
      console.warn('Broadcast timeout, triggering failover')
      coordinator.triggerCoordinatorFailover(sessionId)
    },
    5 * 60 * 1000,
  ) // 5 minutes

  try {
    // Build and broadcast transaction
    const signature = coordinator.getFinalSignature(sessionId)
    const tx = buildTransaction(signature)
    await lotus.sendRawTransaction(tx.serialize())

    // Success: cancel failover and notify
    clearTimeout(failoverTimeout)
    coordinator.notifyBroadcastComplete(sessionId)
    console.log('✅ Broadcast successful')
  } catch (error) {
    console.error('❌ Broadcast failed:', error)
    // Let timeout trigger failover automatically
  }
})

// 4. Monitor failover events
coordinator.on(
  'session:coordinator-failed',
  (sessionId, oldIndex, newIndex) => {
    console.log(`Coordinator ${oldIndex} failed, ${newIndex} taking over`)
  },
)

coordinator.on('session:failover-exhausted', sessionId => {
  console.error('All coordinators failed! Manual intervention needed.')
})

// 5. Cleanup on shutdown
process.on('SIGINT', async () => {
  clearInterval(cleanupTimer)
  await coordinator.cleanup()
  process.exit(0)
})

// 6. Start coordinator
await coordinator.start()
```

---

## Security Considerations

### No Internal Timers = No Timing Side Channels

The event-driven architecture eliminates potential timing side channels:

- ✅ No predictable timer intervals to observe
- ✅ No internal state changes at fixed intervals
- ✅ Application controls all timing behavior

### Failover Security

Application-managed failover provides:

- ✅ Custom timeout durations per session
- ✅ Immediate failover on detected errors
- ✅ Conditional failover based on application logic

---

## Frequently Asked Questions

### Q: Why remove automatic cleanup?

**A**: Automatic cleanup requires internal `setInterval`, which:

- Runs continuously (resource waste when idle)
- Adds non-determinism to tests
- Limits application control over cleanup timing
- Violates single responsibility principle

Event-driven manual cleanup solves all these issues.

### Q: Why remove automatic coordinator failover timeout?

**A**: Different applications need different timeout durations:

- High-frequency trading: 30 seconds
- Standard transactions: 5 minutes
- Large batches: 30 minutes

Application-level control provides this flexibility.

### Q: Won't this make the API more complex?

**A**: Slightly more verbose, but:

- More explicit and predictable
- Better testability
- Greater flexibility
- Clearer responsibilities

The tradeoff heavily favors event-driven architecture.

### Q: What if I want automatic cleanup?

**A**: Simple! Just add it in your application:

```typescript
setInterval(() => {
  coordinator.cleanupExpiredSessions()
}, 60000)
```

Now YOU control the interval, not the library.

---

## Summary

| Feature                  | Old (Automatic)           | New (Event-Driven)                    |
| ------------------------ | ------------------------- | ------------------------------------- |
| **Session Cleanup**      | Automatic `setInterval`   | Manual `cleanupExpiredSessions()`     |
| **Coordinator Failover** | Automatic `setTimeout`    | Manual `triggerCoordinatorFailover()` |
| **Identity Cleanup**     | Automatic `setInterval`   | Manual `cleanup()`                    |
| **Testability**          | ❌ Hard (wait for timers) | ✅ Easy (direct control)              |
| **Flexibility**          | ❌ Fixed timeouts         | ✅ Application-controlled             |
| **Resource Efficiency**  | ❌ Always running timers  | ✅ No background timers               |
| **Determinism**          | ❌ Non-deterministic      | ✅ Fully deterministic                |

---

**The MuSig2 P2P implementation is now 100% event-driven with zero internal timeouts.**

All timing and scheduling is controlled by the application layer, providing maximum flexibility, testability, and resource efficiency.
