# SwapSig API Reference

**Version**: 1.1  
**Date**: November 2, 2025  
**Status**: Specification - Updated for Three-Phase MuSig2 Architecture

---

## Overview

This document provides complete API reference for the SwapSig protocol implementation. SwapSig achieves CoinJoin-equivalent privacy using MuSig2 multi-signatures and P2P coordination.

**✨ NEW: Three-Phase MuSig2 Architecture**

SwapSig now uses the three-phase MuSig2 P2P coordination architecture for automatic peer discovery and session building:

- **Phase 0**: Signer Advertisement (automatic at pool join)
- **Phase 1**: Matchmaking (implicit - pool participants are known)
- **Phase 2**: Signing Requests (created during settlement)
- **Phase 3**: Dynamic Session Building (ALL must join for n-of-n MuSig2)

This eliminates manual session coordination and enables automatic discovery of signing requests.

**Related Documents**:

- [SWAPSIG_PROTOCOL.md](./SWAPSIG_PROTOCOL.md) - Full protocol specification
- [P2P_DHT_ARCHITECTURE.md](./P2P_DHT_ARCHITECTURE.md) - Three-phase MuSig2 architecture (REQUIRED READING)
- [MUSIG2_P2P_COORDINATION.md](./MUSIG2_P2P_COORDINATION.md) - Underlying P2P architecture

---

## Table of Contents

1. [Three-Phase Architecture Integration](#three-phase-architecture-integration)
2. [SwapSigCoordinator](#swapsigcoordinator)
3. [SwapPool](#swappool)
4. [Configuration](#configuration)
5. [Events](#events)
6. [Helper Functions](#helper-functions)
7. [Error Handling](#error-handling)

---

## Three-Phase Architecture Integration

SwapSig seamlessly integrates with the MuSig2 P2P three-phase architecture for automatic coordination.

### How It Works

**Phase 0: Automatic Signer Advertisement**

When a participant joins a pool, they automatically advertise their availability:

```typescript
// Happens automatically in joinPool()
await coordinator.joinPool(poolId, myUTXO, finalAddress)
// → Internally calls p2pCoordinator.advertiseSigner()
```

**Phase 2: Signing Request Creation**

During settlement, signing requests are created automatically:

```typescript
// Called internally during executeSwap()
const requestId = await p2pCoordinator.announceSigningRequest(
  [signer1, signer2], // 2-of-2 signers (n-of-n)
  messageToSign,
  myPrivateKey,
  {
    metadata: {
      swapPoolId: poolId,
      transactionType: TransactionType.SWAP,
      swapPhase: SwapPhase.SETTLEMENT,
      // ... more metadata
    },
  },
)
```

**Phase 3: Automatic Discovery & Joining**

Participants automatically discover and join signing requests:

```typescript
// Event handler (automatic in SwapSigCoordinator)
coordinator.on('signing-request:received', async request => {
  if (
    request.metadata?.transactionType === TransactionType.SWAP &&
    request.metadata?.swapPhase === SwapPhase.SETTLEMENT
  ) {
    // Automatically join if we're a required signer
    await p2pCoordinator.joinSigningRequest(request.requestId, myPrivateKey)
    // Session auto-created when ALL participants join (n-of-n)
  }
})
```

### Benefits

✅ **No Manual Coordination**: Participants automatically discover when they're needed  
✅ **n-of-n Enforcement**: Sessions only created when ALL signers join (MuSig2 requirement)  
✅ **DHT-Based Discovery**: Uses existing P2P infrastructure for peer discovery  
✅ **Event-Driven**: Real-time notifications when sessions are ready  
✅ **Seamless Integration**: No changes needed to user-facing API

### Important Notes

⚠️ **MuSig2 is n-of-n**: ALL signers must participate. For m-of-n threshold signatures, use FROST protocol or Taproot script paths.

📖 **Read More**: See [P2P_DHT_ARCHITECTURE.md](./P2P_DHT_ARCHITECTURE.md) for complete technical details of the three-phase architecture.

---

## SwapSigCoordinator

Main entry point for SwapSig privacy protocol.

### Constructor

```typescript
constructor(config: SwapSigConfig)
```

**Parameters**:

```typescript
interface SwapSigConfig {
  // Required: Existing P2P coordinator
  p2pCoordinator: MuSig2P2PCoordinator

  // Swap parameters
  preferredDenominations?: number[] // Default: [0.1, 1.0, 10 XPI]
  minParticipants?: number // Default: 3
  maxParticipants?: number // Default: 10
  feeRate?: number // Default: 1 sat/byte

  // Timeouts (milliseconds)
  setupTimeout?: number // Default: 600000 (10 min)
  settlementTimeout?: number // Default: 600000 (10 min)
  confirmationTimeout?: number // Default: 3600000 (1 hour)

  // Privacy
  requireEncryptedDestinations?: boolean // Default: true
  randomizeOutputOrder?: boolean // Default: true

  // Security
  requireOwnershipProofs?: boolean // Default: true
  enableReputationFiltering?: boolean // Default: true
  minReputation?: number // Default: 0
}
```

**Example**:

```typescript
import { SwapSigCoordinator, MuSig2P2PCoordinator } from 'lotus-lib'

const p2p = new MuSig2P2PCoordinator(
  {
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
  },
  {
    enableCoordinatorElection: true,
  },
)

const swapSig = new SwapSigCoordinator({
  p2pCoordinator: p2p,
  preferredDenominations: [100000000], // 1.0 XPI
  minParticipants: 3,
  maxParticipants: 10,
})
```

---

### Pool Discovery & Creation

#### `discoverPools()`

Discover available swap pools via DHT with advanced filtering.

```typescript
async discoverPools(filters?: {
  denomination?: number
  minParticipants?: number
  maxParticipants?: number
  preferredGroupSize?: number // 2, 3, 5, or 10
  minAnonymityPerGroup?: number // e.g., 120
  maxAge?: number // Maximum pool age in milliseconds
  phase?: SwapPhase
  sortBy?: 'participants' | 'groupSize' | 'anonymity' | 'age' | 'recommended'
}): Promise<SwapPoolAnnouncement[]>
```

**Returns**: Array of available pools matching filters (sorted)

**Example 1: Browse all pools**

```typescript
const pools = await swapSig.discoverPools({
  denomination: 1000000, // 1.0 XPI
  sortBy: 'recommended', // Best pools first
})

// Display to user for manual selection
pools.forEach(pool => {
  console.log(`Pool: ${pool.poolId.substring(0, 8)}...`)
  console.log(
    `  Participants: ${pool.currentParticipants}/${pool.maxParticipants}`,
  )
  console.log(
    `  Group Size: ${pool.groupSizeStrategy.groupSize}-of-${pool.groupSizeStrategy.groupSize}`,
  )
  console.log(
    `  Anonymity: ${pool.groupSizeStrategy.anonymityPerGroup} mappings/group`,
  )
  console.log(`  ${pool.groupSizeStrategy.reasoning}`)
  console.log()
})
```

**Example 2: Find optimal pools for wallet UX**

```typescript
// Get recommended pools (automatic filtering + sorting)
const recommended = await swapSig.getRecommendedPools(1000000)

if (recommended.length > 0) {
  const best = recommended[0]
  console.log('Recommended pool:', best.poolId)
  console.log('Group strategy:', best.groupSizeStrategy.reasoning)
  console.log('Recommended rounds:', best.groupSizeStrategy.recommendedRounds)
}
```

**Example 3: Filter by group size preference**

```typescript
// User wants specifically 5-of-5 groups (sweet spot)
const mediumPools = await swapSig.discoverPools({
  denomination: 1000000,
  preferredGroupSize: 5, // Only 5-of-5 groups
  minAnonymityPerGroup: 120, // Want 120+ mappings
  phase: SwapPhase.DISCOVERY,
})

console.log(`Found ${mediumPools.length} pools with 5-of-5 groups`)
```

#### `getRecommendedPools()`

Get recommended pools for wallet UX (automatically filtered and sorted).

```typescript
async getRecommendedPools(
  denomination: number,
  myParticipantCount?: number,
): Promise<SwapPoolAnnouncement[]>
```

**Parameters**:

- `denomination` - Swap amount in satoshis
- `myParticipantCount` - Optional: how many participants you're adding (default: 1)

**Returns**: Recommended pools (best first, excludes full pools)

**Example**:

```typescript
// Get best pools for 1.0 XPI swap
const recommended = await swapSig.getRecommendedPools(1000000)

if (recommended.length > 0) {
  const best = recommended[0]
  console.log('Best pool:', best.poolId.substring(0, 8))
  console.log('Group size:', best.groupSizeStrategy.groupSize)
  console.log(
    'Participants:',
    `${best.currentParticipants}/${best.maxParticipants}`,
  )
  console.log('Reasoning:', best.groupSizeStrategy.reasoning)
  console.log('Recommended rounds:', best.groupSizeStrategy.recommendedRounds)

  // Join the recommended pool
  await swapSig.joinPool(best.poolId, myUTXO, finalAddress)
}
```

#### `createPool()`

Create new swap pool and announce to DHT.

```typescript
async createPool(params: {
  denomination: number
  minParticipants?: number
  maxParticipants?: number
  feeRate?: number
  setupTimeout?: number
}): Promise<string>
```

**Returns**: Pool ID (string)

**Example**:

```typescript
const poolId = await swapSig.createPool({
  denomination: 100000000, // 1.0 XPI
  minParticipants: 3,
  maxParticipants: 10,
  feeRate: 1,
  setupTimeout: 600, // 10 minutes
})

console.log('Created pool:', poolId)
```

---

### Participation

#### `joinPool()`

Join existing swap pool.

```typescript
async joinPool(
  poolId: string,
  input: UnspentOutput,
  finalDestination: Address,
): Promise<void>
```

**Parameters**:

- `poolId` - Pool identifier (from discovery)
- `input` - UTXO to swap (must match pool denomination)
- `finalDestination` - Address to receive swapped funds

**Throws**:

- `Error` if pool is full
- `Error` if input amount doesn't match denomination
- `Error` if input is already spent
- `Error` if destination address is reused

**Example**:

```typescript
const myUTXO = {
  txId: 'abc123...',
  outputIndex: 0,
  satoshis: 100000000, // 1.0 XPI
  script: Script.fromAddress(myAddress),
  address: myAddress,
}

const freshAddress = await wallet.getNewAddress()

await swapSig.joinPool(poolId, myUTXO, freshAddress)
console.log('Joined pool successfully')
```

#### `executeSwap()`

Complete end-to-end swap (convenience method).

```typescript
async executeSwap(
  poolId: string,
  input: UnspentOutput,
  finalDestination: Address,
): Promise<string>
```

**Returns**: Settlement transaction ID

**Phases executed**:

1. Registration
2. Setup transaction (Round 1)
3. Wait for confirmations
4. Reveal destinations
5. Settlement (Round 2 via MuSig2)
6. Completion

**Example**:

```typescript
// Execute complete swap (blocks until finished)
const settlementTxId = await swapSig.executeSwap(poolId, myUTXO, freshAddress)

console.log('Swap complete! Final tx:', settlementTxId)
```

---

### Pool Management

#### `getPool()`

Get pool information.

```typescript
getPool(poolId: string): SwapPool | undefined
```

**Returns**: Pool object or undefined if not found

**Example**:

```typescript
const pool = swapSig.getPool(poolId)

console.log('Pool status:', {
  phase: pool.phase,
  participants: pool.participants.length,
  minRequired: pool.minParticipants,
})
```

#### `getActivePools()`

Get all active pools.

```typescript
getActivePools(): SwapPool[]
```

**Returns**: Array of all active pools

**Example**:

```typescript
const pools = swapSig.getActivePools()
console.log(`Currently in ${pools.length} active pools`)
```

#### `leavePool()`

Leave pool before completion (only before Round 1).

```typescript
async leavePool(poolId: string): Promise<void>
```

**Throws**: Error if setup round already started

**Example**:

```typescript
// Can only leave during discovery/registration
await swapSig.leavePool(poolId)
```

#### `abortPool()`

Abort pool (emergency shutdown).

```typescript
async abortPool(poolId: string, reason: string): Promise<void>
```

**Example**:

```typescript
await swapSig.abortPool(poolId, 'Suspicious activity detected')
```

---

### Status & Monitoring

#### `getPoolStatus()`

Get detailed pool status.

```typescript
getPoolStatus(poolId: string): PoolStatus
```

**Returns**:

```typescript
interface PoolStatus {
  poolId: string
  phase: SwapPhase
  participants: number
  minRequired: number
  maxAllowed: number

  // Progress
  setupComplete: boolean
  setupConfirmed: boolean
  settlementsComplete: boolean

  // Timing
  age: number // Milliseconds since creation
  timeRemaining: number // Until timeout

  // My participation
  myIndex: number
  mySetupTxId?: string
  mySettlementTxId?: string

  // Health
  healthy: boolean
  warnings: string[]
}
```

**Example**:

```typescript
const status = swapSig.getPoolStatus(poolId)

console.log('Pool progress:', {
  phase: status.phase,
  participants: `${status.participants}/${status.minRequired}`,
  setupComplete: status.setupComplete,
  healthy: status.healthy,
})
```

#### `getMyRole()`

Get your role in pool.

```typescript
getMyRole(poolId: string): ParticipantRole
```

**Returns**:

```typescript
interface ParticipantRole {
  participantIndex: number
  publicKey: PublicKey

  // Setup (Round 1)
  setupTransaction?: Transaction
  setupTxId?: string
  setupConfirmed: boolean

  // Settlement (Round 2)
  settlementSessions: string[] // MuSig2 session IDs I'm involved in
  settlementTransactions: Transaction[]
  completedSettlements: number
  totalSettlements: number

  // Coordinator status
  isSetupCoordinator: boolean
  settlementCoordinatorFor: number[] // Which sessions am I coordinator for
}
```

**Example**:

```typescript
const role = swapSig.getMyRole(poolId)

console.log('My participant index:', role.participantIndex)
console.log('Setup complete:', role.setupConfirmed)
console.log(
  'Settlements:',
  `${role.completedSettlements}/${role.totalSettlements}`,
)
```

---

### Advanced Operations

#### `buildSetupTransaction()`

Manually build setup transaction (advanced).

```typescript
async buildSetupTransaction(
  poolId: string,
  input: UnspentOutput,
): Promise<Transaction>
```

**Returns**: Unsigned setup transaction

**Example**:

```typescript
const setupTx = await swapSig.buildSetupTransaction(poolId, myUTXO)
setupTx.sign(0, myPrivateKey)
await blockchain.broadcast(setupTx)
```

#### `getSettlementSessions()`

Get MuSig2 sessions for settlement round.

```typescript
getSettlementSessions(poolId: string): string[]
```

**Returns**: Array of MuSig2 session IDs

**Example**:

```typescript
const sessions = swapSig.getSettlementSessions(poolId)

for (const sessionId of sessions) {
  const status = swapSig.p2pCoordinator.getSessionStatus(sessionId)
  console.log('Session:', sessionId, 'Phase:', status.phase)
}
```

#### `monitorPool()`

Monitor pool progress (returns async iterator).

```typescript
async *monitorPool(poolId: string): AsyncGenerator<PoolUpdate>
```

**Returns**: Async generator yielding pool updates

**Example**:

```typescript
for await (const update of swapSig.monitorPool(poolId)) {
  console.log('Pool update:', update.phase, update.message)

  if (update.phase === SwapPhase.COMPLETE) {
    console.log('✅ Swap complete!')
    break
  }

  if (update.phase === SwapPhase.ABORTED) {
    console.error('❌ Swap aborted:', update.reason)
    break
  }
}
```

---

## Events

SwapSigCoordinator extends EventEmitter and emits the following events:

### Pool Lifecycle Events

#### `pool:created`

```typescript
coordinator.on('pool:created', (poolId: string, params: any) => {
  console.log('Pool created:', poolId)
})
```

#### `pool:joined`

```typescript
coordinator.on('pool:joined', (poolId: string, participantIndex: number) => {
  console.log('Joined pool:', poolId, 'as participant', participantIndex)
})
```

#### `pool:participant-joined`

```typescript
coordinator.on('pool:participant-joined', (poolId: string, peerId: string) => {
  console.log('New participant joined:', peerId)
})
```

#### `pool:phase-change`

```typescript
coordinator.on('pool:phase-change', (poolId: string, newPhase: SwapPhase) => {
  console.log('Pool phase changed to:', newPhase)
})
```

### Round 1 Events

#### `pool:setup-transaction-broadcast`

```typescript
coordinator.on(
  'pool:setup-transaction-broadcast',
  (poolId: string, participantIndex: number, txId: string) => {
    console.log(`Participant ${participantIndex} broadcast setup tx: ${txId}`)
  },
)
```

#### `pool:setup-confirmed`

```typescript
coordinator.on(
  'pool:setup-confirmed',
  (poolId: string, participantIndex: number, txId: string) => {
    console.log(`Setup tx confirmed: ${txId}`)
  },
)
```

#### `pool:all-setups-confirmed`

```typescript
coordinator.on('pool:all-setups-confirmed', (poolId: string) => {
  console.log('All setup transactions confirmed! Moving to settlement...')
})
```

### Round 2 Events

#### `pool:destination-revealed`

```typescript
coordinator.on(
  'pool:destination-revealed',
  (poolId: string, participantIndex: number, address: Address) => {
    console.log(
      `Participant ${participantIndex} destination:`,
      address.toString(),
    )
  },
)
```

#### `pool:settlement-session-created`

```typescript
coordinator.on(
  'pool:settlement-session-created',
  (poolId: string, outputIndex: number, sessionId: string) => {
    console.log(
      `MuSig2 session created for output ${outputIndex}: ${sessionId}`,
    )
  },
)
```

#### `pool:settlement-transaction-broadcast`

```typescript
coordinator.on(
  'pool:settlement-transaction-broadcast',
  (poolId: string, outputIndex: number, txId: string) => {
    console.log(`Settlement tx broadcast for output ${outputIndex}: ${txId}`)
  },
)
```

#### `pool:settlement-confirmed`

```typescript
coordinator.on(
  'pool:settlement-confirmed',
  (poolId: string, outputIndex: number, txId: string) => {
    console.log(`Settlement tx confirmed: ${txId}`)
  },
)
```

### Completion Events

#### `pool:complete`

```typescript
coordinator.on('pool:complete', (poolId: string, stats: SwapStats) => {
  console.log('✅ Swap complete!', stats)
})
```

**Stats object**:

```typescript
interface SwapStats {
  poolId: string
  participants: number
  denomination: number

  // Transactions
  setupTxIds: string[]
  settlementTxIds: string[]

  // Timing
  totalTime: number // Milliseconds
  setupTime: number
  settlementTime: number

  // Privacy
  anonymitySet: number // N!
  onChainPrivacy: 'perfect' // All txs look normal
}
```

### Error Events

#### `pool:error`

```typescript
coordinator.on('pool:error', (poolId: string, error: Error) => {
  console.error('Pool error:', error.message)
})
```

#### `pool:aborted`

```typescript
coordinator.on('pool:aborted', (poolId: string, reason: string) => {
  console.error('Pool aborted:', reason)
})
```

#### `pool:participant-timeout`

```typescript
coordinator.on(
  'pool:participant-timeout',
  (poolId: string, participantIndex: number, phase: SwapPhase) => {
    console.warn(`Participant ${participantIndex} timed out in ${phase}`)
  },
)
```

---

## Helper Functions

### Pool Discovery

#### `findBestPool()`

Find best matching pool for given criteria.

```typescript
async findBestPool(criteria: {
  denomination: number
  maxWaitTime?: number
  preferredParticipants?: number
}): Promise<string | null>
```

**Returns**: Pool ID of best match, or null if none found

**Example**:

```typescript
const bestPool = await swapSig.findBestPool({
  denomination: 100000000,
  maxWaitTime: 300, // 5 minutes
  preferredParticipants: 5,
})

if (bestPool) {
  await swapSig.joinPool(bestPool, myUTXO, finalAddress)
} else {
  const poolId = await swapSig.createPool({ denomination: 100000000 })
}
```

### Validation

#### `validateInput()`

Validate UTXO before joining pool.

```typescript
validateInput(
  input: UnspentOutput,
  pool: SwapPool,
): ValidationResult
```

**Returns**:

```typescript
interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}
```

**Example**:

```typescript
const validation = swapSig.validateInput(myUTXO, pool)

if (!validation.valid) {
  console.error('Invalid input:', validation.errors)
  return
}

if (validation.warnings.length > 0) {
  console.warn('Warnings:', validation.warnings)
}

await swapSig.joinPool(poolId, myUTXO, finalAddress)
```

#### `validateFinalAddress()`

Validate final destination address.

```typescript
validateFinalAddress(
  address: Address,
  pool: SwapPool,
): ValidationResult
```

**Checks**:

- Address is valid
- Address has not been used before
- Address type is compatible
- Address is not in pool already

**Example**:

```typescript
const addressValidation = swapSig.validateFinalAddress(freshAddress, pool)

if (!addressValidation.valid) {
  throw new Error('Invalid destination address')
}
```

### Privacy Utilities

#### `estimateAnonymitySet()`

Calculate anonymity set for pool size.

```typescript
estimateAnonymitySet(participantCount: number): bigint
```

**Returns**: Factorial (N!) as anonymity set

**Example**:

```typescript
const anonymitySet = swapSig.estimateAnonymitySet(5)
console.log('Anonymity set:', anonymitySet.toString()) // "120"
```

#### `analyzePrivacy()`

Analyze privacy properties of completed swap.

```typescript
analyzePrivacy(poolId: string): PrivacyAnalysis
```

**Returns**:

```typescript
interface PrivacyAnalysis {
  anonymitySet: bigint
  inputOutputUnlinkability: boolean
  onChainStealth: boolean
  protocolDetection: 'impossible' | 'hard' | 'medium' | 'easy'

  // Metrics
  averageHops: number // Between input and final output
  uniqueAddresses: number
  sharedOutputs: number

  // Warnings
  privacyWarnings: string[]
}
```

**Example**:

```typescript
const analysis = swapSig.analyzePrivacy(poolId)

console.log('Privacy analysis:', {
  anonymitySet: analysis.anonymitySet.toString(),
  stealth: analysis.onChainStealth,
  detection: analysis.protocolDetection,
})
```

---

## Configuration

### Default Configuration

```typescript
export const DEFAULT_SWAPSIG_CONFIG: SwapSigConfig = {
  // Denominations (in satoshis)
  preferredDenominations: [
    10000000, // 0.1 XPI
    100000000, // 1.0 XPI
    1000000000, // 10 XPI
    10000000000, // 100 XPI
  ],

  // Participants
  minParticipants: 3,
  maxParticipants: 10,

  // Fees
  feeRate: 1, // satoshis per byte

  // Timeouts
  setupTimeout: 600000, // 10 minutes
  settlementTimeout: 600000, // 10 minutes
  confirmationTimeout: 3600000, // 1 hour

  // Privacy
  requireEncryptedDestinations: true,
  randomizeOutputOrder: true,
  enableTimingObfuscation: false,

  // Security
  requireOwnershipProofs: true,
  enableReputationFiltering: true,
  minReputation: 0,
}
```

### Configuration Examples

#### High Privacy Configuration

```typescript
const highPrivacy: SwapSigConfig = {
  p2pCoordinator: p2p,
  minParticipants: 15, // Medium-large pool for 5-of-5 groups
  maxParticipants: 49,
  requireEncryptedDestinations: true,
  randomizeOutputOrder: true,
  // Note: Achieves 120 mappings per group with 5-of-5 (TARGET)
  // Timing: ~7-9 minutes with pre-consensus ⚡
}
```

#### Fast Swaps Configuration

```typescript
const fastSwaps: SwapSigConfig = {
  p2pCoordinator: p2p,
  minParticipants: 3, // Small pool for 2-of-2 pairs
  maxParticipants: 9,
  setupTimeout: 300000, // 5 minutes
  settlementTimeout: 300000,
  // Note: 2-of-2 pairs complete in ~5-7 minutes ⚡
}
```

#### High Security Configuration

```typescript
const highSecurity: SwapSigConfig = {
  p2pCoordinator: p2p,
  requireOwnershipProofs: true,
  enableReputationFiltering: true,
  minReputation: 50, // Require proven participants
  minParticipants: 5,
}
```

---

## Error Handling

### Error Types

```typescript
export enum SwapSigErrorCode {
  // Pool errors
  POOL_NOT_FOUND = 'POOL_NOT_FOUND',
  POOL_FULL = 'POOL_FULL',
  POOL_ABORTED = 'POOL_ABORTED',

  // Input errors
  INVALID_INPUT = 'INVALID_INPUT',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  INPUT_ALREADY_SPENT = 'INPUT_ALREADY_SPENT',
  OWNERSHIP_PROOF_FAILED = 'OWNERSHIP_PROOF_FAILED',

  // Output errors
  INVALID_DESTINATION = 'INVALID_DESTINATION',
  ADDRESS_REUSED = 'ADDRESS_REUSED',
  DESTINATION_COMMITMENT_FAILED = 'DESTINATION_COMMITMENT_FAILED',

  // Round errors
  SETUP_TIMEOUT = 'SETUP_TIMEOUT',
  SETUP_FAILED = 'SETUP_FAILED',
  SETTLEMENT_TIMEOUT = 'SETTLEMENT_TIMEOUT',
  SETTLEMENT_FAILED = 'SETTLEMENT_FAILED',

  // Participant errors
  PARTICIPANT_ABANDONED = 'PARTICIPANT_ABANDONED',
  INSUFFICIENT_PARTICIPANTS = 'INSUFFICIENT_PARTICIPANTS',

  // Validation errors
  INVALID_TRANSACTION = 'INVALID_TRANSACTION',
  FEE_TOO_HIGH = 'FEE_TOO_HIGH',
  FEE_TOO_LOW = 'FEE_TOO_LOW',
}

export class SwapSigError extends Error {
  constructor(
    public code: SwapSigErrorCode,
    message: string,
    public poolId?: string,
    public participantIndex?: number,
  ) {
    super(message)
    this.name = 'SwapSigError'
  }
}
```

### Error Handling Examples

```typescript
try {
  await swapSig.executeSwap(poolId, myUTXO, finalAddress)
} catch (error) {
  if (error instanceof SwapSigError) {
    switch (error.code) {
      case SwapSigErrorCode.POOL_FULL:
        console.log('Pool full, trying another...')
        break

      case SwapSigErrorCode.AMOUNT_MISMATCH:
        console.error('Input amount does not match denomination')
        break

      case SwapSigErrorCode.SETUP_TIMEOUT:
        console.error('Setup round timed out')
        // Can retry or join different pool
        break

      case SwapSigErrorCode.PARTICIPANT_ABANDONED:
        console.error('Participant abandoned swap')
        // Funds can be reclaimed after timeout
        break

      default:
        console.error('SwapSig error:', error.message)
    }
  } else {
    console.error('Unexpected error:', error)
  }
}
```

---

## Complete Usage Example

### Production-Ready Swap

```typescript
import {
  SwapSigCoordinator,
  MuSig2P2PCoordinator,
  PrivateKey,
  Address,
  SwapPhase,
} from 'lotus-lib'

async function executePrivateSwap() {
  // 1. Setup P2P coordinator (reuse existing infrastructure)
  const p2p = new MuSig2P2PCoordinator(
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
      electionMethod: 'lexicographic',
      sessionTimeout: 2 * 60 * 60 * 1000,
    },
  )

  // 2. Create SwapSig coordinator
  const swapSig = new SwapSigCoordinator({
    p2pCoordinator: p2p,
    preferredDenominations: [100000000], // 1.0 XPI
    minParticipants: 5,
    maxParticipants: 10,
    setupTimeout: 300000, // 5 minutes
    settlementTimeout: 300000, // 5 minutes
    // Note: With pre-consensus, swaps complete in ~5-8 minutes ⚡
  })

  // 3. Monitor progress
  swapSig.on('pool:phase-change', (poolId, phase) => {
    console.log('📊 Phase:', phase)
  })

  swapSig.on('pool:setup-confirmed', (poolId, idx, txId) => {
    console.log(`✅ Setup tx ${idx} confirmed: ${txId}`)
  })

  swapSig.on('pool:settlement-confirmed', (poolId, idx, txId) => {
    console.log(`✅ Settlement tx ${idx} confirmed: ${txId}`)
  })

  // 4. Find or create pool
  const pools = await swapSig.discoverPools({
    denomination: 100000000,
    minParticipants: 5,
  })

  let poolId: string
  if (pools.length > 0) {
    poolId = pools[0].poolId
    console.log('🔍 Found existing pool:', poolId)
  } else {
    poolId = await swapSig.createPool({
      denomination: 100000000,
      minParticipants: 5,
      maxParticipants: 10,
      feeRate: 1,
    })
    console.log('🆕 Created new pool:', poolId)
  }

  // 5. Prepare swap
  const myUTXO = await wallet.selectUTXO(100000000)
  const freshAddress = await wallet.getNewAddress()

  // Validate before joining
  const inputValidation = swapSig.validateInput(myUTXO, pool)
  if (!inputValidation.valid) {
    throw new Error(`Invalid input: ${inputValidation.errors.join(', ')}`)
  }

  const addressValidation = swapSig.validateFinalAddress(freshAddress, pool)
  if (!addressValidation.valid) {
    throw new Error(`Invalid address: ${addressValidation.errors.join(', ')}`)
  }

  // 6. Execute swap
  console.log('🚀 Starting swap...')

  try {
    const settlementTxId = await swapSig.executeSwap(
      poolId,
      myUTXO,
      freshAddress,
    )

    console.log('✅ Swap complete!')
    console.log('Settlement transaction:', settlementTxId)

    // 7. Analyze privacy
    const privacy = swapSig.analyzePrivacy(poolId)
    console.log('\n📊 Privacy Analysis:')
    console.log('Anonymity set:', privacy.anonymitySet.toString())
    console.log(
      'Input→Output linkability:',
      privacy.inputOutputUnlinkability ? '✅ Broken' : '❌ Still linked',
    )
    console.log(
      'On-chain stealth:',
      privacy.onChainStealth ? '✅ Perfect' : '🔶 Partial',
    )
    console.log('Protocol detection:', privacy.protocolDetection)
  } catch (error) {
    if (error instanceof SwapSigError) {
      console.error('SwapSig error:', error.code, error.message)

      // Handle specific errors
      if (error.code === SwapSigErrorCode.SETUP_TIMEOUT) {
        console.log('Setup timed out, trying different pool...')
        // Retry logic
      }
    }
    throw error
  }
}

executePrivateSwap().catch(console.error)
```

---

## Integration with Existing Systems

### Wallet Integration with Manual Pool Selection

```typescript
// Wallet UX: Browse and select pools

class LotusWallet {
  /**
   * Show available SwapSig pools for user selection
   */
  async showSwapPoolBrowser(amount: number): Promise<void> {
    const denomination = this._findMatchingDenomination(amount)

    // Get recommended pools (sorted by suitability)
    const pools = await this.swapSig.getRecommendedPools(denomination)

    // Display pools to user
    console.log('📋 Available SwapSig Pools:')
    console.log()

    pools.forEach((pool, index) => {
      console.log(`${index + 1}. Pool ${pool.poolId.substring(0, 8)}...`)
      console.log(`   Denomination: ${pool.denomination / 1000000} XPI`)
      console.log(
        `   Participants: ${pool.currentParticipants}/${pool.maxParticipants}`,
      )
      console.log(
        `   Group Size: ${pool.groupSizeStrategy.groupSize}-of-${pool.groupSizeStrategy.groupSize}`,
      )
      console.log(
        `   Anonymity: ${pool.groupSizeStrategy.anonymityPerGroup.toLocaleString()} mappings/group`,
      )
      console.log(`   ${pool.groupSizeStrategy.reasoning}`)
      console.log(
        `   Recommended Rounds: ${pool.groupSizeStrategy.recommendedRounds}`,
      )
      console.log(
        `   Est. Time: ~${this._estimateSwapTime(pool)} minutes (Lotus 2-min blocks)`,
      )
      console.log()
    })
  }

  /**
   * Send with privacy (manual pool selection)
   */
  async sendWithPrivacy(
    amount: number,
    destination: Address,
    options?: {
      autoSelect?: boolean // Default: false (user selects)
      preferredGroupSize?: number // 2, 3, 5, or 10
      createIfNone?: boolean // Default: true
    },
  ): Promise<string> {
    const denomination = this._findMatchingDenomination(amount)

    // 1. Discover available pools with filtering
    const pools = await this.swapSig.discoverPools({
      denomination,
      preferredGroupSize: options?.preferredGroupSize,
      sortBy: 'recommended',
    })

    let poolId: string

    if (pools.length > 0 && !options?.autoSelect) {
      // Manual selection: Show pools to user
      await this.showSwapPoolBrowser(denomination)

      // User selects from list (GUI interaction)
      const selectedIndex = await this.promptUserSelection(
        `Select pool (1-${pools.length}, or 0 to create new): `,
      )

      if (selectedIndex > 0 && selectedIndex <= pools.length) {
        poolId = pools[selectedIndex - 1].poolId
        console.log(`Selected pool: ${poolId.substring(0, 8)}...`)
      } else {
        // User chose to create new pool
        poolId = await this._createNewPool(denomination, options)
      }
    } else if (pools.length > 0 && options?.autoSelect) {
      // Automatic selection: Use best recommended pool
      poolId = pools[0].poolId
      console.log(`Auto-selected pool: ${poolId.substring(0, 8)}...`)
    } else {
      // No pools found: Create new one
      if (options?.createIfNone ?? true) {
        poolId = await this._createNewPool(denomination, options)
      } else {
        throw new Error('No pools available and createIfNone=false')
      }
    }

    // 2. Select UTXO
    const utxo = await this.selectUTXO(denomination)

    // 3. Execute swap
    console.log('Starting SwapSig privacy swap...')
    const txId = await this.swapSig.executeSwap(poolId, utxo, destination)

    return txId
  }

  private async _createNewPool(
    denomination: number,
    options?: { preferredGroupSize?: number },
  ): Promise<string> {
    // Determine min/max participants based on preferred group size
    let minParticipants = 3
    let maxParticipants = 10

    if (options?.preferredGroupSize) {
      switch (options.preferredGroupSize) {
        case 2:
          minParticipants = 3
          maxParticipants = 9
          break
        case 3:
          minParticipants = 9
          maxParticipants = 14
          break
        case 5:
          minParticipants = 15
          maxParticipants = 49
          break
        case 10:
          minParticipants = 50
          maxParticipants = 100
          break
      }
    }

    const poolId = await this.swapSig.createPool({
      denomination,
      minParticipants,
      maxParticipants,
    })

    console.log('Created new pool:', poolId.substring(0, 8))
    console.log('Waiting for other participants...')

    return poolId
  }

  private _estimateSwapTime(pool: SwapPoolAnnouncement): number {
    // Lotus pre-consensus provides finality in 3-5 seconds!
    // No need to wait for block confirmations between rounds
    const preConsensusTime = 0.1 // ~5 seconds = 0.1 minutes
    const baseTime = 2 // Discovery + registration + reveals
    const settlementTime = pool.groupSizeStrategy.groupSize * 0.5 // MuSig2 complexity (faster)

    // Total: ~5-12 minutes depending on group size
    return Math.ceil(
      baseTime + preConsensusTime + settlementTime + preConsensusTime,
    )
  }

  private _findMatchingDenomination(amount: number): number {
    // Find closest standard denomination
    const denominations = [100000, 1000000, 10000000] // 0.1, 1.0, 10 XPI

    for (const denom of denominations) {
      if (amount <= denom) return denom
    }

    return denominations[denominations.length - 1]
  }
}
```

**Wallet GUI Flow** (with Lotus Pre-Consensus):

```
1. User clicks "Send with Privacy"
2. Wallet discovers available pools (instant)
3. Shows list with group sizes, anonymity sets, estimated times:

   Pool 1: 5-of-5 groups | 25 participants | 120 mappings | ~7 min ⚡
   Pool 2: 2-of-2 pairs  | 7 participants  | 5040 total   | ~5 min ⚡
   Pool 3: 10-of-10 groups | 100 participants | 3.6M mappings | ~10 min ⚡

4. User selects preferred pool OR creates new one
5. Swap executes automatically
6. User sees progress:
   - "Setup txs broadcasting..." (30 sec)
   - "Waiting for pre-consensus..." (3-5 seconds) ⚡
   - "Setup finalized! Revealing destinations..." (1 min)
   - "Settlement MuSig2 signing..." (2-4 min)
   - "Waiting for pre-consensus..." (3-5 seconds) ⚡
   - "Complete! Privacy achieved in ~6 minutes ✅⚡"

🚀 Total time: 5-12 minutes (vs 40-60 min on Bitcoin!)
```

### Exchange Integration

```typescript
// Batch user withdrawals for privacy

class ExchangeWithdrawalProcessor {
  async processBatchWithPrivacy(withdrawals: Withdrawal[]): Promise<void> {
    // Group by denomination
    const byDenom = this._groupByDenomination(withdrawals)

    for (const [denomination, batch] of byDenom.entries()) {
      if (batch.length < 3) {
        // Not enough for privacy, process normally
        continue
      }

      // Create swap pool for this batch
      const poolId = await this.swapSig.createPool({
        denomination,
        minParticipants: batch.length,
        maxParticipants: batch.length,
      })

      // Process each withdrawal through SwapSig
      await Promise.all(
        batch.map(w =>
          this.swapSig.executeSwap(poolId, w.sourceUTXO, w.destination),
        ),
      )

      console.log(
        `✅ Batch of ${batch.length} withdrawals processed with privacy`,
      )
    }
  }
}
```

---

## Performance Optimization

### Parallel Processing

```typescript
// Process multiple pools simultaneously
async function multiPoolSwap() {
  // Split large amount across multiple denominations
  const amounts = [
    { denom: 100000000, count: 5 }, // 5× 1.0 XPI
    { denom: 10000000, count: 3 }, // 3× 0.1 XPI
  ]

  const swaps = []

  for (const { denom, count } of amounts) {
    for (let i = 0; i < count; i++) {
      const pool = await findOrCreatePool(denom)
      swaps.push(swapSig.executeSwap(pool, utxos[i], destinations[i]))
    }
  }

  // Execute all swaps in parallel
  const results = await Promise.all(swaps)

  console.log(`✅ Completed ${results.length} parallel swaps`)
}
```

### Connection Pooling

```typescript
// Reuse P2P connections across multiple swaps
const p2p = new MuSig2P2PCoordinator({
  /* config */
})

const swap1 = new SwapSigCoordinator({ p2pCoordinator: p2p })
const swap2 = new SwapSigCoordinator({ p2pCoordinator: p2p })
// Both share same P2P infrastructure
```

---

## Testing & Debugging

### Test Helpers

```typescript
// test/swapsig/helpers.ts

export async function createTestPool(
  participants: number = 3,
  denomination: number = 100000000,
): Promise<{ poolId: string; coordinators: SwapSigCoordinator[] }> {
  const coordinators: SwapSigCoordinator[] = []

  // Create participants
  for (let i = 0; i < participants; i++) {
    const p2p = new MuSig2P2PCoordinator({
      /* config */
    })
    coordinators.push(new SwapSigCoordinator({ p2pCoordinator: p2p }))
  }

  // First creates pool
  const poolId = await coordinators[0].createPool({
    denomination,
    minParticipants: participants,
    maxParticipants: participants,
  })

  return { poolId, coordinators }
}

export async function executeTestSwap(
  coordinators: SwapSigCoordinator[],
  poolId: string,
): Promise<string[]> {
  const utxos = await createTestUTXOs(coordinators.length)
  const addresses = coordinators.map(() => Address.generate())

  const txIds = await Promise.all(
    coordinators.map((coord, i) =>
      coord.executeSwap(poolId, utxos[i], addresses[i]),
    ),
  )

  return txIds
}
```

### Debug Mode

```typescript
// Enable verbose logging
const swapSig = new SwapSigCoordinator({
  p2pCoordinator: p2p,
  debug: true, // Enable debug logging
  logLevel: 'verbose',
})

// Debug events
swapSig.on('debug', (event: string, data: any) => {
  console.log('[DEBUG]', event, data)
})
```

---

## Security Best Practices

### Checklist for Production Deployment

- ✅ Use production-ready P2P coordinator (Grade: 9.5/10)
- ✅ Enable coordinator election with failover
- ✅ Require ownership proofs for all inputs
- ✅ Encrypt final destinations until setup confirms
- ✅ Validate all transactions before signing
- ✅ Set appropriate timeouts for your use case
- ✅ Monitor pool health and abort on suspicious activity
- ✅ Use fixed denominations for better privacy
- ✅ Enable reputation filtering for known participants
- ✅ Log all operations for debugging

### Privacy Best Practices

- ✅ Always use fresh addresses for final destinations
- ✅ Never reuse addresses across swaps
- ✅ Use standard denominations only
- ✅ Enable timing obfuscation in production
- ✅ Wait for adequate confirmations before considering complete
- ✅ Don't correlate multiple swaps in short time windows
- ✅ Use Tor or VPN for additional network privacy

---

## Conclusion

The SwapSig API provides a **complete, production-ready interface** for privacy-enhanced transactions using MuSig2 and P2P coordination. The API is designed to be:

- **Simple**: Easy to use for common cases
- **Powerful**: Advanced features available when needed
- **Secure**: Built on proven components (Grade: 9.5/10)
- **Well-Documented**: Comprehensive examples and reference

**Ready to start building privacy-preserving applications on Lotus!** 🚀

---

**Document Version**: 1.1  
**Last Updated**: November 2, 2025  
**Status**: Specification - Updated for Three-Phase Architecture  
**Changes**: Integrated three-phase MuSig2 P2P coordination for automatic peer discovery

**See Also**:

- [SWAPSIG_PROTOCOL.md](./SWAPSIG_PROTOCOL.md) - Full protocol design
- [P2P_DHT_ARCHITECTURE.md](./P2P_DHT_ARCHITECTURE.md) - Three-phase MuSig2 architecture ⭐
- [MUSIG2_P2P_COORDINATION.md](./MUSIG2_P2P_COORDINATION.md) - P2P architecture
- [MUSIG2_IMPLEMENTATION_STATUS.md](./MUSIG2_IMPLEMENTATION_STATUS.md) - MuSig2 status
