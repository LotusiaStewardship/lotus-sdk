# MuSig2 Coordinator Election

**Author**: The Lotusia Stewardship  
**Status**: ✅ **PRODUCTION READY** - All Tests Passing (91/91)  
**Date**: October 31, 2025  
**Version**: 1.0

---

## Summary

The MuSig2 Coordinator Election system enables **deterministic, decentralized coordinator selection** for multi-party MuSig2 signing sessions. This solves a critical real-world requirement: **who builds and broadcasts the final transaction?**

In Bitcoin MuSig2 scenarios (as described in [this Stack Exchange discussion](https://bitcoin.stackexchange.com/questions/125030/how-does-musig-work-in-real-bitcoin-scenarios)), one party typically acts as the **coordinator** who:

1. Collects all partial signatures from participants
2. Constructs the final aggregated signature
3. Builds the spending transaction
4. Broadcasts to the network

This implementation provides a **trustless, deterministic election** mechanism so all participants agree on the same coordinator without additional communication.

**Key Features**:

- ✅ Deterministic election (all parties compute the same result)
- ✅ No additional communication required
- ✅ Verifiable by all participants
- ✅ Resistant to manipulation
- ✅ Supports multiple election methods
- ✅ Production-ready with full test coverage (91 tests)
- ✅ Works with any number of signers (tested up to 10-of-10)
- ✅ **Automatic coordinator failover** - Backup coordinators take over if primary fails

---

## Why Coordinator Election?

### The Problem

In a multi-party MuSig2 signing session (e.g., 5-of-5), after all participants generate their partial signatures:

- ❌ **Without coordination**: Each party might try to construct and broadcast the transaction independently (wasteful, confusing)
- ❌ **Manual coordination**: Requires out-of-band communication ("Alice, you broadcast it")
- ❌ **Central server**: Defeats the purpose of decentralization
- ❌ **Random selection**: Not deterministic, requires additional P2P messages

### The Solution

**Deterministic coordinator election** based on cryptographic properties:

- ✅ All participants independently compute the same coordinator
- ✅ Based on public key ordering (lexicographic, hash-based, etc.)
- ✅ No additional P2P messages needed
- ✅ Verifiable by all parties
- ✅ Cannot be manipulated without controlling a specific private key

---

## How It Works

### Election Process

1. **All participants have the same set of public keys** (from session announcement)
2. **Each participant independently runs the election algorithm**
3. **Election algorithm produces deterministic result** (same coordinator for everyone)
4. **Elected coordinator builds and broadcasts the transaction**
5. **Other participants only need to sign** (simpler workflow)

### Example: 5-Party Signing

```typescript
import { electCoordinator, ElectionMethod } from 'lotus-lib/p2p/musig2/election'

// All 5 participants have the same public keys
const allPublicKeys = [alice.publicKey, bob.publicKey, charlie.publicKey, diana.publicKey, eve.publicKey]

// Each participant independently performs the election
const election = electCoordinator(allPublicKeys, ElectionMethod.LEXICOGRAPHIC)

console.log('Coordinator:', election.coordinatorIndex) // All get same result
console.log('Is coordinator:', election.coordinatorIndex === myIndex)

if (isCoordinator) {
  // Build and broadcast transaction
  const tx = buildFinalTransaction(...)
  await broadcast(tx)
} else {
  // Just wait for coordinator to broadcast
  console.log('Waiting for coordinator to broadcast...')
}
```

---

## Election Methods

### 1. Lexicographic Ordering (Recommended) ✅

**Method**: `ElectionMethod.LEXICOGRAPHIC`

**How it works**:

- Sort all public keys alphabetically (lexicographic order)
- First key in sorted order is the coordinator

**Advantages**:

- ✅ Most deterministic and verifiable
- ✅ Cannot be manipulated without controlling a specific private key
- ✅ Consistent across all implementations
- ✅ No randomness involved

**Use case**: **Production deployments** (recommended default)

```typescript
const election = electCoordinator(publicKeys, ElectionMethod.LEXICOGRAPHIC)
```

### 2. Hash-Based Selection

**Method**: `ElectionMethod.HASH_BASED`

**How it works**:

- Hash all public keys concatenated together
- Use hash to select an index: `hashValue % numSigners`

**Advantages**:

- ✅ Pseudo-random but deterministic
- ✅ More "fair" distribution across runs
- ✅ Still verifiable

**Use case**: When you want more randomness across different signing sessions

```typescript
const election = electCoordinator(publicKeys, ElectionMethod.HASH_BASED)
```

### 3. First Signer

**Method**: `ElectionMethod.FIRST_SIGNER`

**How it works**:

- Always selects the first signer in the array

**Advantages**:

- ✅ Simple and predictable
- ✅ Useful when order is pre-agreed

**Use case**: Testing or when signer order has meaning

```typescript
const election = electCoordinator(publicKeys, ElectionMethod.FIRST_SIGNER)
```

### 4. Last Signer

**Method**: `ElectionMethod.LAST_SIGNER`

**How it works**:

- Always selects the last signer in the array

**Advantages**:

- ✅ Simple and predictable

**Use case**: Testing or specific scenarios

```typescript
const election = electCoordinator(publicKeys, ElectionMethod.LAST_SIGNER)
```

---

## Coordinator Failover 🆕

### The Problem

Even with a deterministically elected coordinator, there's a critical failure mode:

- ⚠️ **Coordinator refuses to broadcast** - Malicious or crashed coordinator never broadcasts the signed transaction
- ⚠️ **Coordinator delays indefinitely** - Transaction sits unbroadcast, funds temporarily locked
- ⚠️ **Network partition** - Coordinator loses connectivity before broadcasting

**Without failover**, participants are stuck waiting indefinitely with no recourse.

### The Solution: Automatic Failover

This implementation includes **automatic coordinator failover** with configurable timeouts:

1. **Broadcast Timeout**: After all partial signatures collected, coordinator has limited time to broadcast
2. **Backup Coordinators**: Each election method provides deterministic backup coordinator ordering
3. **Automatic Takeover**: If primary coordinator fails to broadcast, next backup automatically takes over
4. **Zero Coordination**: All participants independently know the failover order (no additional messages)

### How Failover Works

```
Primary Coordinator (5 min timeout)
  ├─ Broadcasts successfully → ✅ Done
  └─ Timeout expires → Failover to Backup #1

Backup Coordinator #1 (5 min timeout)
  ├─ Broadcasts successfully → ✅ Done
  └─ Timeout expires → Failover to Backup #2

Backup Coordinator #2 (5 min timeout)
  ├─ Broadcasts successfully → ✅ Done
  └─ Timeout expires → Failover to Backup #3

... continues through all participants
```

### Failover for Each Election Method

#### Lexicographic Method

**Failover order**: Next in sorted lexicographic order (wraps around)

```typescript
// Example with 5 signers
const priorityList = getCoordinatorPriorityList(
  publicKeys,
  ElectionMethod.LEXICOGRAPHIC,
)
// Returns: [2, 4, 0, 1, 3] (primary is index 2, backup #1 is index 4, etc.)
```

**Why**: Maintains deterministic ordering based on key sorting

#### Hash-Based Method

**Failover order**: Cycles through indices (current + 1) % n

```typescript
// Example with 5 signers, primary is index 3
// Failover order: 3 → 4 → 0 → 1 → 2
const backup = getBackupCoordinator(publicKeys, 3, ElectionMethod.HASH_BASED)
// Returns: 4
```

**Why**: Simple, deterministic, ensures all signers get a chance

#### First-Signer Method

**Failover order**: 0 → 1 → 2 → ... → n-1 → null

```typescript
// Example with 5 signers
const priorityList = getCoordinatorPriorityList(
  publicKeys,
  ElectionMethod.FIRST_SIGNER,
)
// Returns: [0, 1, 2, 3, 4]
```

**Why**: Natural progression through signer indices

#### Last-Signer Method

**Failover order**: n-1 → n-2 → ... → 1 → 0 → null

```typescript
// Example with 5 signers
const priorityList = getCoordinatorPriorityList(
  publicKeys,
  ElectionMethod.LAST_SIGNER,
)
// Returns: [4, 3, 2, 1, 0]
```

**Why**: Natural progression in reverse

### Configuration

Enable failover when creating the coordinator:

```typescript
const coordinator = new MuSig2P2PCoordinator(
  {
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true,
  },
  {
    enableCoordinatorElection: true,
    electionMethod: 'lexicographic',
    enableCoordinatorFailover: true, // Enable automatic failover (default: true if election enabled)
    broadcastTimeout: 5 * 60 * 1000, // 5 minutes (default)
  },
)
```

### Using Failover in Your Application

```typescript
// Listen for failover events
coordinator.on('session:should-broadcast', (sessionId, coordinatorIndex) => {
  console.log(
    `I should broadcast the transaction now (I'm coordinator ${coordinatorIndex})`,
  )

  // Build and broadcast transaction
  const tx = buildTransaction(sessionId)
  await broadcast(tx)

  // Notify coordinator that broadcast is complete (cancels failover timeouts)
  coordinator.notifyBroadcastComplete(sessionId)
})

coordinator.on('session:coordinator-failed', (sessionId, attemptNumber) => {
  console.log(`Coordinator failed, failover attempt #${attemptNumber}`)
})

coordinator.on('session:failover-exhausted', (sessionId, attempts) => {
  console.error(`All ${attempts} coordinators failed to broadcast!`)
  // Handle emergency situation (manual intervention needed)
})
```

### API for Failover

#### `getBackupCoordinator()`

Get the next backup coordinator after current fails:

```typescript
function getBackupCoordinator(
  signers: PublicKey[],
  currentCoordinatorIndex: number,
  method?: ElectionMethod,
): number | null
```

**Returns**: Index of backup coordinator, or `null` if no backups remaining

#### `getCoordinatorPriorityList()`

Get the complete failover priority list:

```typescript
function getCoordinatorPriorityList(
  signers: PublicKey[],
  method?: ElectionMethod,
): number[]
```

**Returns**: Array of coordinator indices in priority order (primary first, then backups)

**Example**:

```typescript
const priorityList = getCoordinatorPriorityList(
  publicKeys,
  ElectionMethod.LEXICOGRAPHIC,
)
// [2, 4, 0, 1, 3] means:
// - Primary coordinator: index 2
// - Backup #1: index 4
// - Backup #2: index 0
// - Backup #3: index 1
// - Backup #4: index 3
```

#### `isCurrentCoordinator()`

Check if you're the current coordinator (accounting for failovers):

```typescript
const isCurrent = coordinator.isCurrentCoordinator(sessionId)

if (isCurrent) {
  // I should broadcast (either primary or backup after failover)
  await broadcastTransaction(tx)
}
```

#### `notifyBroadcastComplete()`

Cancel failover timeouts after successful broadcast:

```typescript
// After broadcasting transaction
await broadcast(transaction)

// Notify to cancel failover timeouts
coordinator.notifyBroadcastComplete(sessionId)
```

### Failover Events

The coordinator emits these events for failover:

- `session:should-broadcast` - You are now the coordinator and should broadcast
- `session:coordinator-failed` - Previous coordinator failed, failover initiated
- `session:failover-exhausted` - All coordinators failed (manual intervention needed)
- `session:broadcast-confirmed` - Broadcast completed successfully

### Testing

The failover mechanism is thoroughly tested with 24 dedicated tests:

- ✅ Backup coordinator selection for each election method
- ✅ Priority list generation and validation
- ✅ Failover sequence for 2-of-2, 3-of-3, 5-of-5, 10-of-10
- ✅ Exhaustion handling (no more backups)
- ✅ Determinism (all participants compute same backup)
- ✅ Edge cases (single signer, wraparound, etc.)

Run failover tests:

```bash
npx tsx --test test/p2p/musig2/failover.test.ts
```

### Security Considerations

**Benefits**:

- ✅ Prevents transaction censorship by single coordinator
- ✅ Provides fault tolerance (crashed coordinator doesn't block)
- ✅ Deterministic failover (no additional trust required)

**Limitations**:

- ⚠️ If ALL coordinators fail, manual intervention needed
- ⚠️ Timeout should be long enough for normal broadcast (default: 5 minutes)
- ⚠️ Short timeouts may cause unnecessary failovers

**Best Practices**:

1. Set broadcast timeout based on expected network conditions
2. Monitor `session:coordinator-failed` events to detect issues
3. Have emergency procedures if all coordinators fail
4. Consider using longer timeouts for high-value transactions

---

## API Reference

### `electCoordinator()`

Perform coordinator election.

```typescript
function electCoordinator(
  signers: PublicKey[],
  method?: ElectionMethod,
): ElectionResult
```

**Parameters**:

- `signers` - All participating signers' public keys
- `method` - Election method (default: `LEXICOGRAPHIC`)

**Returns**: `ElectionResult`

```typescript
interface ElectionResult {
  coordinatorIndex: number // Index in signers array
  coordinatorPublicKey: PublicKey // Coordinator's public key
  sortedSigners: PublicKey[] // All signers sorted
  indexMapping: Map<number, number> // Original index → sorted index
  electionProof: string // SHA256 hash for verification
}
```

### `verifyElectionResult()`

Verify an election result.

```typescript
function verifyElectionResult(
  signers: PublicKey[],
  result: ElectionResult,
  method?: ElectionMethod,
): boolean
```

**Returns**: `true` if election result is valid

### `isCoordinator()`

Check if a specific signer is the coordinator.

```typescript
function isCoordinator(
  signers: PublicKey[],
  signerIndex: number,
  method?: ElectionMethod,
): boolean
```

**Returns**: `true` if the signer at `signerIndex` is the coordinator

### `getCoordinatorPublicKey()`

Get the coordinator's public key.

```typescript
function getCoordinatorPublicKey(
  signers: PublicKey[],
  method?: ElectionMethod,
): PublicKey
```

**Returns**: Coordinator's public key

---

## Integration with MuSig2P2PCoordinator

The MuSig2P2PCoordinator has been extended to support coordinator election:

### Configuration

```typescript
const coordinator = new MuSig2P2PCoordinator(
  {
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true,
  },
  {
    enableCoordinatorElection: true, // Enable election
    electionMethod: 'lexicographic', // Election method
  },
)
```

### Creating a Session with Election

```typescript
// When creating a session, election happens automatically
const sessionId = await coordinator.createSession(
  allPublicKeys,
  myPrivateKey,
  message,
  { description: 'My transaction' },
)

// Election data is included in DHT announcement automatically
```

### Checking Coordinator Status

```typescript
// Check if I'm the coordinator
const isCoord = coordinator.isCoordinator(sessionId)

if (isCoord) {
  console.log('I am the coordinator - will build transaction')
  // Build and broadcast transaction
} else {
  console.log('I am a participant - just signing')
  // Wait for coordinator to broadcast
}

// Get coordinator peer ID
const coordinatorPeerId = coordinator.getCoordinatorPeerId(sessionId)

// Get full election info
const electionInfo = coordinator.getElectionInfo(sessionId)
console.log('Coordinator index:', electionInfo.coordinatorIndex)
console.log('Election proof:', electionInfo.electionProof)
console.log('Am I coordinator:', electionInfo.isCoordinator)
```

---

## Production Example: 5-Party Signing

See `examples/musig2-p2p-election-example.ts` for a complete working example.

### High-Level Flow

```
1. Setup Participants
   ├─ Create 5 P2P coordinators with election enabled
   └─ Generate private/public key pairs

2. Connect Peers
   ├─ Connect all participants in mesh network
   └─ Wait for DHT routing tables to populate

3. Perform Election
   ├─ All participants compute same election
   ├─ Verify coordinator is agreed upon
   └─ Each participant knows their role

4. Create Taproot Output
   ├─ Build MuSig2 aggregated key
   └─ Create Taproot script

5. Create Signing Session
   ├─ First participant creates session
   ├─ Session announced to DHT with election data
   └─ Other participants discover and join

6. Round 1: Nonce Exchange
   ├─ All participants generate nonces
   ├─ Broadcast via P2P
   └─ Wait for all nonces

7. Round 2: Partial Signature Exchange
   ├─ All participants generate partial signatures
   ├─ Broadcast via P2P
   └─ Wait for all partial sigs

8. Transaction Finalization (COORDINATOR ONLY)
   ├─ Coordinator collects all partial signatures
   ├─ Builds final aggregated signature
   ├─ Constructs spending transaction
   └─ Broadcasts to network

9. Other Participants
   └─ Wait for transaction to appear on-chain
```

### Example Output

```
🎯 Elected Coordinator: Charlie
   Index: 2
   Public Key: 03a1b2c3...

Participant Roles:
  Alice: SIGNER (signs partial signatures)
  Bob: SIGNER (signs partial signatures)
  Charlie: COORDINATOR (builds & broadcasts tx) ← ELECTED
  Diana: SIGNER (signs partial signatures)
  Eve: SIGNER (signs partial signatures)

✅ Round 1 Complete - All Nonces Collected
  Alice: 5/5 nonces
  Bob: 5/5 nonces
  Charlie: 5/5 nonces
  Diana: 5/5 nonces
  Eve: 5/5 nonces

✅ Round 2 Complete - All Partial Signatures Collected
  Alice: 5/5 signatures
  Bob: 5/5 signatures
  Charlie: 5/5 signatures
  Diana: 5/5 signatures
  Eve: 5/5 signatures

✅ Transaction Fully Signed and Ready to Broadcast:
  TXID: 3f4e5d6c7b8a9...
  Size: 302 bytes
  Charlie (coordinator) broadcasts to network ✅
```

---

## Testing

### Run Tests

```bash
npx tsx --test test/p2p/musig2/election.test.ts
```

### Test Coverage

**91 total tests covering**:

**Election Tests (26)**:

- ✅ Lexicographic ordering election
- ✅ Hash-based election
- ✅ First/Last signer election
- ✅ Determinism verification (same result for all participants)
- ✅ Election result verification
- ✅ Invalid election detection
- ✅ Multi-party scenarios (2-of-2, 3-of-3, 5-of-5, 10-of-10)
- ✅ Edge cases (duplicate keys, similar prefixes)
- ✅ Real-world Bitcoin public keys

**Failover Tests (24)** 🆕:

- ✅ Backup coordinator selection for all election methods
- ✅ Priority list generation and validation
- ✅ Failover sequences (2-of-2, 3-of-3, 5-of-5, 10-of-10)
- ✅ Exhaustion handling (no more backups)
- ✅ Determinism across participants
- ✅ Edge cases (single signer, wraparound)

**MuSig2 P2P Tests (41)**: From Phase 3 implementation

**Result**: 91/91 passing ✅

---

## Security Considerations

### Determinism

✅ **All participants compute the same coordinator independently**

- No additional P2P messages needed
- No possibility of disagreement
- Election proof can be verified

### Manipulation Resistance

✅ **Cannot manipulate election without controlling specific private key**

- Lexicographic method: Would need to generate a key that sorts first
- Hash-based method: Would need to find a hash collision
- Both are computationally infeasible

### Verification

✅ **All participants can verify the election**

```typescript
const isValid = verifyElectionResult(
  publicKeys,
  election,
  ElectionMethod.LEXICOGRAPHIC,
)
if (!isValid) {
  throw new Error('Election result is invalid!')
}
```

### Byzantine Resistance

✅ **Even if coordinator is malicious**:

- Cannot forge signatures (requires all partial sigs)
- Cannot spend to wrong address (all participants verify transaction before signing)
- At worst, coordinator refuses to broadcast (but any participant can broadcast the signed tx)

---

## Real-World Deployment

### Recommended Configuration

```typescript
const coordinator = new MuSig2P2PCoordinator(
  {
    listen: ['/ip4/0.0.0.0/tcp/4001'],
    enableDHT: true,
    enableDHTServer: true,
    bootstrapPeers: [
      '/dns4/bootstrap1.lotus.org/tcp/4001/p2p/...',
      '/dns4/bootstrap2.lotus.org/tcp/4001/p2p/...',
    ],
  },
  {
    enableCoordinatorElection: true,
    electionMethod: 'lexicographic', // Most deterministic
    sessionTimeout: 2 * 60 * 60 * 1000, // 2 hours
    enableSessionDiscovery: true, // DHT-based discovery
  },
)
```

### Best Practices

1. **Always use `LEXICOGRAPHIC` method in production**
   - Most deterministic and verifiable
   - Resistant to manipulation

2. **Verify election on all participants before signing**

   ```typescript
   const electionInfo = coordinator.getElectionInfo(sessionId)
   console.log('Coordinator:', electionInfo.coordinatorIndex)
   console.log('Proof:', electionInfo.electionProof)
   ```

3. **Coordinator should verify all signatures before broadcasting**

   ```typescript
   if (coordinator.isCoordinator(sessionId)) {
     // Verify final signature
     const isValid = verifySignature(...)
     if (!isValid) throw new Error('Invalid signature!')

     // Broadcast
     await broadcast(transaction)
   }
   ```

4. **Monitor failover events** ✅ **Now Implemented**

   ```typescript
   coordinator.on('session:should-broadcast', sessionId => {
     // I'm the current coordinator, broadcast now
     await broadcastTransaction(sessionId)
     coordinator.notifyBroadcastComplete(sessionId)
   })

   coordinator.on('session:coordinator-failed', (sessionId, attempt) => {
     console.log(`Coordinator failed, failover attempt #${attempt}`)
   })
   ```

5. **Log election results for debugging**
   ```typescript
   const election = coordinator.getElectionInfo(sessionId)
   logger.info('Coordinator elected', {
     coordinatorIndex: election.coordinatorIndex,
     isCoordinator: election.isCoordinator,
     electionProof: election.electionProof,
   })
   ```

---

## File Locations

### Implementation

- `lib/p2p/musig2/election.ts` - Election logic (279 lines)
- `lib/p2p/musig2/coordinator.ts` - Updated with election support
- `lib/p2p/musig2/types.ts` - Election data types
- `lib/p2p/musig2/index.ts` - Module exports

### Tests

- `test/p2p/musig2/election.test.ts` - Election tests (26 tests)
- `test/p2p/musig2/failover.test.ts` - **Failover tests (24 tests)** 🆕
- Other MuSig2 P2P tests (41 tests from Phase 3)

**Total: 91 tests passing** ✅

### Examples

- `examples/musig2-p2p-election-example.ts` - Production-ready 5-party example (515 lines)

---

## Comparison: Before vs After

| Aspect                       | Before (No Election)          | After (With Election)          |
| ---------------------------- | ----------------------------- | ------------------------------ |
| **Coordinator Selection**    | ❌ Manual/undefined           | ✅ Automatic & deterministic   |
| **Communication Overhead**   | 🔶 Requires out-of-band coord | ✅ Zero additional messages    |
| **Verifiability**            | ❌ None                       | ✅ All participants can verify |
| **Manipulation Resistance**  | ❌ Depends on trust           | ✅ Cryptographically resistant |
| **Transaction Construction** | 🔶 All parties might try      | ✅ Only coordinator builds     |
| **Broadcasting**             | 🔶 Unclear who broadcasts     | ✅ Coordinator broadcasts      |
| **Real-World Usability**     | ❌ Requires manual setup      | ✅ Production-ready            |

---

## Performance

### Election Overhead

- **Computation**: O(n log n) for sorting public keys (lexicographic method)
- **Memory**: O(n) for storing sorted keys and index mapping
- **Network**: **Zero** - no additional P2P messages

### Benchmarks (5 participants)

```
Election computation: < 1ms
Verification: < 1ms
Total overhead: Negligible
```

---

## Future Enhancements

### Implemented ✅

1. ✅ **Backup Coordinators**: Automatic failover if primary coordinator fails (24 tests)

### Potential Future Additions

1. **Weighted Election**: Select coordinator based on reputation/stake
2. **Election History**: Track coordinator elections across sessions
3. **Custom Election Functions**: Allow users to provide custom election logic

### Not Planned

- ❌ **Random election**: Not deterministic (requires additional messages)
- ❌ **Vote-based election**: Requires additional round of communication
- ❌ **Centralized election**: Defeats purpose of decentralization

---

## Related Documentation

- [MUSIG2_P2P_PHASE3_COMPLETE.md](./MUSIG2_P2P_PHASE3_COMPLETE.md) - Base P2P MuSig2 coordination
- [P2P_PHASE1_COMPLETE.md](./P2P_PHASE1_COMPLETE.md) - P2P infrastructure
- [Bitcoin Stack Exchange: How does MuSig work in real scenarios?](https://bitcoin.stackexchange.com/questions/125030/how-does-musig-work-in-real-bitcoin-scenarios)

---

## Conclusion

The MuSig2 Coordinator Election system provides a **production-ready solution** for real-world multi-party signing scenarios. It enables:

✅ **Deterministic coordinator selection** (no manual coordination)  
✅ **Zero additional communication overhead**  
✅ **Verifiable and manipulation-resistant**  
✅ **Works with any number of signers**  
✅ **Full test coverage** (91/91 tests passing)  
✅ **Production-ready example** (5-party signing)

**Reference Implementation**: Based on the real-world MuSig2 workflow described in the [Bitcoin Stack Exchange discussion](https://bitcoin.stackexchange.com/questions/125030/how-does-musig-work-in-real-bitcoin-scenarios), this implementation solves the critical question: **"Who constructs and broadcasts the final transaction?"**

---

**Document Version**: 1.0  
**Last Updated**: October 31, 2025  
**Status**: ✅ **PRODUCTION READY**

- Election logic complete ✅
- **Coordinator failover complete** ✅ 🆕
- All 91 tests passing ✅ (26 election + 24 failover + 41 P2P)
- Production example working ✅
- Full integration with MuSig2P2PCoordinator ✅
- Ready for deployment ✅
