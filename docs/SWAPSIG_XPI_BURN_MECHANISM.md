# SwapSig XPI Burn Mechanism

**Lotus-Native Sybil Defense using Token Economics**

**Version**: 1.0  
**Date**: November 1, 2025  
**Status**: Specification

---

## Overview

SwapSig uses **XPI token burning** as its primary Sybil attack defense mechanism. This leverages Lotus's proof-of-work token economics to create an **economic barrier** to fake participant creation while providing a **network-wide benefit** through deflationary pressure.

**Reference**: [Lotus Documentation](https://lotusia.org/docs)

---

## Lotus XPI Token Economics

### Token Specifications

**From Lotus Documentation** ([https://lotusia.org/docs](https://lotusia.org/docs)):

```
Lotus XPI Token:
├─ Decimal Places: 6 (1 XPI = 1,000,000 satoshis)
├─ Supply Model: Inflationary (no hard cap)
├─ Consensus: Proof-of-Work (SHA-256d)
├─ Block Reward: Decreasing but never reaches zero
└─ Network: Permissionless mining

Comparison with Bitcoin:
├─ Bitcoin: 8 decimals (1 BTC = 100,000,000 satoshis)
├─ Lotus: 6 decimals (1 XPI = 1,000,000 satoshis)
└─ Smaller denomination unit for practical use
```

### Inflationary Model

```
Lotus Supply:
├─ No maximum supply cap
├─ Continuous inflation through block rewards
├─ Inflation rate decreases over time
└─ Never reaches zero (perpetual inflation)

Implications for SwapSig:
├─ Token burning provides deflationary counterforce
├─ Helps maintain long-term token value
├─ Creates economic equilibrium
└─ Network-wide benefit from privacy usage ✅
```

**Source**: Lotus network design (see lotusd codebase)

---

## SwapSig Burn Mechanism

### Why Burn Instead of Computational PoW?

**Traditional Sybil Defense (Computational PoW)**:

```
Cost: CPU time (cheap, parallelizable)
├─ Can rent hashpower cheaply
├─ Can parallelize across many machines
├─ No permanent cost
├─ Hard to verify
└─ Effectiveness: 🔶 Moderate
```

**SwapSig Defense (Economic PoW via Token Burn)**:

```
Cost: Real XPI tokens (expensive, permanent)
├─ Must mine or buy XPI (proof-of-work!)
├─ Burned forever (permanent loss)
├─ Cannot be parallelized (must burn real tokens)
├─ Trivially verifiable on-chain
├─ Scales with swap value
└─ Effectiveness: ✅✅ EXCELLENT
```

**Key Insight**: Since XPI tokens are proof-of-work (mined), **burning XPI is burning proof-of-work**! This is economic PoW, not computational PoW.

---

## Burn Amount Calculation

### Formula

```typescript
function calculateBurnAmount(
  swapAmount: number, // in satoshis
  burnPercentage: number = 0.001, // 0.1% default
  config: BurnConfig,
): number {
  const rawBurn = Math.floor(swapAmount * burnPercentage)

  // Apply bounds
  return Math.max(
    config.minimumBurn, // 100 sats (0.0001 XPI)
    Math.min(rawBurn, config.maximumBurn), // 10,000 sats (0.01 XPI)
  )
}
```

### Examples (Lotus: 1 XPI = 1,000,000 satoshis)

```
Burn Percentage: 0.1% (default)

0.1 XPI swap:
├─ Swap amount: 100,000 satoshis
├─ Burn (0.1%): 100 satoshis = 0.0001 XPI
├─ Cost to user: ~$0.005 @ $50/XPI
└─ Acceptable: ✅ Minimal

1.0 XPI swap:
├─ Swap amount: 1,000,000 satoshis
├─ Burn (0.1%): 1,000 satoshis = 0.001 XPI
├─ Cost to user: ~$0.05 @ $50/XPI
└─ Acceptable: ✅✅ Very reasonable

10 XPI swap:
├─ Swap amount: 10,000,000 satoshis
├─ Burn (0.1%): 10,000 satoshis = 0.01 XPI
├─ Cost to user: ~$0.50 @ $50/XPI
└─ Acceptable: ✅ Reasonable for large swap

100 XPI swap:
├─ Swap amount: 100,000,000 satoshis
├─ Burn (0.1%): 10,000 satoshis = 0.01 XPI (capped)
├─ Cost to user: ~$0.50 @ $50/XPI (capped at max)
└─ Acceptable: ✅ Cap prevents excessive burns
```

---

## Setup Transaction Structure

### Standard Transaction (Without Burn)

```
Input:  1.0 XPI (1,000,000 sats)
Output: 1.0 XPI (1,000,000 sats) - fees
```

### SwapSig Setup Transaction (With Burn)

```typescript
const setupTransaction = new Transaction()

// Input: Participant's original UTXO
setupTransaction.from({
  txId: originalUTXO.txId,
  outputIndex: originalUTXO.outputIndex,
  satoshis: 1000000, // 1.0 XPI
  script: originalUTXO.script,
})

// Output 0: MuSig2 shared output (main)
setupTransaction.to(
  sharedMuSig2Address,
  989000, // 0.989 XPI
)

// Output 1: Burn output (OP_RETURN)
const burnAmount = calculateBurnAmount(1000000, 0.001) // 1,000 sats
setupTransaction.addOutput(
  new Transaction.Output({
    script: Script.buildDataOut(
      Buffer.concat([
        Buffer.from('SWAPSIG_BURN', 'utf8'),
        Buffer.from(poolId, 'hex'),
        Buffer.from([0x01]), // Version
      ]),
    ),
    satoshis: burnAmount, // 1,000 sats (0.001 XPI)
  }),
)

// Mining fee
setupTransaction.fee(10000) // 0.01 XPI

// Total: 1,000,000 sats
// = 989,000 (shared) + 1,000 (burn) + 10,000 (fee)
```

**On-Chain Result**:

```
Transaction ID: abc123...

Inputs:
  [0] Original_Address: 1,000,000 sats

Outputs:
  [0] MuSig2_Address: 989,000 sats (spendable)
  [1] OP_RETURN: 1,000 sats (BURNED - unspendable) ✅

Mining Fee: 10,000 sats

Verification:
├─ Burn output is provably unspendable (OP_RETURN)
├─ Burn amount verifiable by all participants
├─ Pool ID embedded in burn data
└─ Economic cost is real and permanent ✅
```

---

## Burn Verification

### Participant Verification Process

```typescript
async function verifyParticipantBurn(
  participant: SwapParticipant,
  pool: SwapPool,
): Promise<boolean> {
  // 1. Get setup transaction from blockchain
  const setupTx = await blockchain.getTransaction(participant.setupTxId)

  // 2. Calculate expected burn for this pool
  const expectedBurn = calculateBurnAmount(
    pool.denomination,
    pool.burnConfig.burnPercentage,
  )

  // 3. Find burn output (OP_RETURN with identifier)
  const burnOutput = setupTx.outputs.find(output => {
    if (!output.script.isDataOut()) return false

    const data = output.script.getData()
    // Check for SWAPSIG_BURN identifier + pool ID
    return (
      data.toString('utf8', 0, 12) === 'SWAPSIG_BURN' &&
      data.toString('hex', 12, 44) === pool.poolId
    )
  })

  if (!burnOutput) {
    console.error('❌ No burn output found')
    return false
  }

  // 4. Verify burn amount is sufficient
  if (burnOutput.satoshis < expectedBurn) {
    console.error(
      `❌ Insufficient burn: ${burnOutput.satoshis} < ${expectedBurn}`,
    )
    return false
  }

  // 5. Verify output is provably unspendable
  if (!burnOutput.script.isDataOut()) {
    console.error('❌ Burn output is not OP_RETURN')
    return false
  }

  console.log(`✅ Burn verified: ${burnOutput.satoshis} sats`)
  return true
}
```

### Pool-Wide Verification

```typescript
async function validateAllBurns(pool: SwapPool): Promise<boolean> {
  const requiredBurn = calculateBurnAmount(
    pool.denomination,
    pool.burnConfig.burnPercentage,
  )

  console.log(`Verifying burns for ${pool.participants.length} participants`)
  console.log(
    `Required burn: ${requiredBurn} sats (${requiredBurn / 1000000} XPI)`,
  )

  for (const participant of pool.participants) {
    const valid = await verifyParticipantBurn(participant, pool)

    if (!valid) {
      console.error(
        `❌ Participant ${participant.participantIndex} failed burn verification`,
      )

      // Exclude this participant from pool
      await excludeParticipant(pool, participant)
      return false
    }
  }

  const totalBurned = requiredBurn * pool.participants.length
  console.log(`✅ All burns verified!`)
  console.log(
    `Total burned: ${totalBurned} sats (${totalBurned / 1000000} XPI)`,
  )

  return true
}
```

---

## Sybil Attack Economics

### Attack Cost Analysis

**Scenario**: Attacker wants to control majority of 5-participant pool

```
Pool: 5 participants, 1.0 XPI denomination, 0.1% burn

Attacker needs: 3 fake participants (60% control)

Cost per fake participant:
├─ UTXO lock: 1,000,000 sats (1.0 XPI)
├─ Burn: 1,000 sats (0.001 XPI) PERMANENT
└─ Total: 1,001,000 sats per fake

Total attack cost (3 fakes):
├─ Locked: 3,000,000 sats = 3.0 XPI (temporary)
├─ Burned: 3,000 sats = 0.003 XPI (PERMANENT)
├─ At $50/XPI: ~$150 locked + $0.15 burned
└─ Attack benefit: Deanonymize 2 honest participants

Cost/Benefit:
├─ Cost: $150+ (plus 0.003 XPI lost forever)
├─ Benefit: Privacy of 2 users (low value)
├─ Ratio: TERRIBLE for attacker ✅
└─ Conclusion: Economically irrational ✅
```

**Scenario**: Attacker wants to control majority of 10-participant pool

```
Pool: 10 participants, 10 XPI denomination, 0.5% burn (stronger)

Attacker needs: 6 fake participants (60% control)

Cost per fake participant:
├─ UTXO lock: 10,000,000 sats (10 XPI)
├─ Burn: 50,000 sats (0.05 XPI) PERMANENT
└─ Total: 10,050,000 sats per fake

Total attack cost (6 fakes):
├─ Locked: 60,000,000 sats = 60 XPI (temporary)
├─ Burned: 300,000 sats = 0.3 XPI (PERMANENT)
├─ At $50/XPI: ~$3,000 locked + $15 burned forever
└─ Attack benefit: Deanonymize 4 honest participants

Cost/Benefit:
├─ Cost: $3,000+ (plus 0.3 XPI lost forever)
├─ Benefit: Privacy of 4 users (very low value)
├─ Ratio: EXTREMELY BAD for attacker ✅✅
└─ Conclusion: Economically infeasible ✅✅
```

### Defense Strength by Pool Size

| Pool Size | Attacker Needs | Burn Cost (0.1%) | Lock Cost | Total Cost @ $50/XPI |
| --------- | -------------- | ---------------- | --------- | -------------------- |
| 3         | 2 fakes        | 0.002 XPI        | 2 XPI     | ~$100                |
| 5         | 3 fakes        | 0.003 XPI        | 3 XPI     | ~$150                |
| 10        | 6 fakes        | 0.006 XPI        | 6 XPI     | ~$300                |
| 20        | 11 fakes       | 0.011 XPI        | 11 XPI    | ~$550                |
| 50        | 26 fakes       | 0.026 XPI        | 26 XPI    | ~$1,300              |
| 100       | 51 fakes       | 0.051 XPI        | 51 XPI    | ~$2,550              |

**Note**: Burn cost is **permanent loss**, making attacks increasingly expensive

---

## Network-Wide Economic Impact

### Deflationary Pressure from SwapSig Usage

**Daily Usage Scenarios**:

```
Low Volume (100 swaps/day @ 1.0 XPI avg):
├─ Daily burn: 100 × 1,000 sats = 100,000 sats = 0.1 XPI/day
├─ Monthly: ~3 XPI/month
├─ Yearly: ~36.5 XPI/year
└─ Impact: Minor deflation

Medium Volume (1,000 swaps/day @ 1.0 XPI avg):
├─ Daily burn: 1,000 × 1,000 sats = 1,000,000 sats = 1.0 XPI/day
├─ Monthly: ~30 XPI/month
├─ Yearly: ~365 XPI/year
└─ Impact: Noticeable deflation ✅

High Volume (10,000 swaps/day @ 1.0 XPI avg):
├─ Daily burn: 10,000 × 1,000 sats = 10,000,000 sats = 10 XPI/day
├─ Monthly: ~300 XPI/month
├─ Yearly: ~3,650 XPI/year
└─ Impact: Significant deflation ✅✅

Very High Volume (100,000 swaps/day @ 5.0 XPI avg):
├─ Daily burn: 100,000 × 5,000 sats = 500,000,000 sats = 500 XPI/day
├─ Monthly: ~15,000 XPI/month
├─ Yearly: ~182,500 XPI/year
└─ Impact: Major deflationary force ✅✅✅
```

### Economic Equilibrium

```
Privacy Demand ↑ → More Swaps → More Burns → Deflation → XPI Value ↑
                                                              ↓
                                                    Incentivizes Mining
                                                              ↓
                                                    Network Security ↑

Result: Privacy usage strengthens network economics ✅
```

**This creates a virtuous cycle**:

1. Users want privacy → SwapSig adoption increases
2. More swaps → More XPI burned
3. Inflation offset → XPI value supported
4. Higher value → Better network security (mining incentive)
5. Better security → More adoption → Loop continues ✅

---

## Burn Configuration

### Standard Denominations with Burn

**Recommended Pool Denominations** (Lotus: 1 XPI = 1,000,000 sats):

```typescript
const STANDARD_DENOMINATIONS = [
  100000, // 0.1 XPI
  1000000, // 1.0 XPI (most common)
  10000000, // 10 XPI
  100000000, // 100 XPI
]

// Burn calculations (0.1% default):
const DENOMINATION_BURNS = {
  100000: 100, // 0.1 XPI → 100 sats burn
  1000000: 1000, // 1.0 XPI → 1,000 sats burn
  10000000: 10000, // 10 XPI → 10,000 sats burn (capped)
  100000000: 10000, // 100 XPI → 10,000 sats burn (capped at max)
}
```

### Burn Configuration Interface

```typescript
export interface BurnConfig {
  // Percentage of swap amount to burn
  burnPercentage: number // 0.001 = 0.1%, 0.005 = 0.5%, 0.01 = 1.0%

  // Minimum burn (prevents dust, ensures cost)
  minimumBurn: number // 100 sats (0.0001 XPI)

  // Maximum burn (caps cost for large swaps)
  maximumBurn: number // 10,000 sats (0.01 XPI)

  // Burn identifier (for verification)
  burnIdentifier: string // 'SWAPSIG_BURN'

  // Optional: Pool-specific identifier
  poolIdInBurn: boolean // Include pool ID in burn data (default: true)

  // Optional: Version for future upgrades
  version: number // Protocol version (default: 1)
}

// Default configuration
export const DEFAULT_BURN_CONFIG: BurnConfig = {
  burnPercentage: 0.001, // 0.1%
  minimumBurn: 100, // 0.0001 XPI
  maximumBurn: 10000, // 0.01 XPI
  burnIdentifier: 'SWAPSIG_BURN',
  poolIdInBurn: true,
  version: 1,
}
```

### Pool-Specific Burn Configuration

```typescript
// Pool creator can adjust burn percentage within range
async function createPool(params: {
  denomination: number
  burnPercentage?: number // Optional: override default
}) {
  // Validate burn percentage
  const MIN_BURN = 0.0005 // 0.05%
  const MAX_BURN = 0.01 // 1.0%

  const burnPercentage = params.burnPercentage || 0.001 // Default 0.1%

  if (burnPercentage < MIN_BURN || burnPercentage > MAX_BURN) {
    throw new Error(
      `Burn percentage must be between ${MIN_BURN} and ${MAX_BURN}`,
    )
  }

  const pool: SwapPool = {
    // ... other fields
    burnConfig: {
      burnPercentage,
      minimumBurn: 100,
      maximumBurn: 10000,
      burnIdentifier: 'SWAPSIG_BURN',
      poolIdInBurn: true,
      version: 1,
    },
  }

  return pool
}
```

---

## Implementation Details

### Burn Output Creation

```typescript
export class SwapSigBurnMechanism {
  /**
   * Create OP_RETURN burn output for setup transaction
   */
  createBurnOutput(
    burnAmount: number,
    poolId: string,
    config: BurnConfig,
  ): Transaction.Output {
    // Construct burn data
    const burnData = Buffer.concat([
      // Identifier (12 bytes)
      Buffer.from(config.burnIdentifier, 'utf8').subarray(0, 12),

      // Pool ID (32 bytes hex = 64 chars, take first 32 bytes)
      Buffer.from(poolId, 'hex').subarray(0, 32),

      // Version (1 byte)
      Buffer.from([config.version || 0x01]),

      // Optional: Timestamp (4 bytes)
      Buffer.alloc(4).writeUInt32BE(Math.floor(Date.now() / 1000), 0),
    ])

    // Create OP_RETURN output
    return new Transaction.Output({
      script: Script.buildDataOut(burnData),
      satoshis: burnAmount,
    })
  }

  /**
   * Verify burn output in transaction
   */
  async verifyBurnOutput(
    txId: string,
    expectedBurn: number,
    poolId: string,
    config: BurnConfig,
  ): Promise<boolean> {
    // Fetch transaction
    const tx = await blockchain.getTransaction(txId)
    if (!tx) {
      console.error('Transaction not found')
      return false
    }

    // Find burn output
    let burnOutput: Transaction.Output | undefined

    for (const output of tx.outputs) {
      if (!output.script.isDataOut()) continue

      const data = output.script.getData()

      // Check identifier
      const identifier = data.toString('utf8', 0, 12)
      if (identifier !== config.burnIdentifier) continue

      // Check pool ID (if required)
      if (config.poolIdInBurn) {
        const embeddedPoolId = data.toString('hex', 12, 44)
        if (embeddedPoolId !== poolId) continue
      }

      burnOutput = output
      break
    }

    if (!burnOutput) {
      console.error('No valid burn output found')
      return false
    }

    // Verify amount
    if (burnOutput.satoshis < expectedBurn) {
      console.error(
        `Insufficient burn: ${burnOutput.satoshis} < ${expectedBurn}`,
      )
      return false
    }

    console.log(
      `✅ Burn verified: ${burnOutput.satoshis} sats (${burnOutput.satoshis / 1000000} XPI)`,
    )
    return true
  }

  /**
   * Calculate total burned for pool
   */
  calculateTotalPoolBurn(pool: SwapPool): number {
    const burnPerParticipant = calculateBurnAmount(
      pool.denomination,
      pool.burnConfig.burnPercentage,
    )

    return burnPerParticipant * pool.participants.length
  }
}
```

---

## Benefits to Lotus Network

### 1. Deflationary Counterbalance ✅

```
Lotus is Inflationary (by design):
├─ New XPI mined every block
├─ Supply increases continuously
├─ Potential downward price pressure

SwapSig Burns XPI:
├─ Removes XPI from circulation
├─ Permanent supply reduction
├─ Counteracts inflation ✅

Net Effect:
├─ High privacy adoption → High burn rate → Lower net inflation
├─ Low privacy adoption → Low burn rate → Higher net inflation
└─ Market-driven equilibrium ✅
```

### 2. Value Accrual to XPI Holders ✅

```
Burned XPI Benefits:
├─ Reduces circulating supply
├─ Increases scarcity
├─ Supports token value
├─ Benefits all XPI holders
└─ Incentivizes long-term holding ✅
```

### 3. Network Security Incentive ✅

```
Higher XPI value (from burns):
├─ Mining more profitable
├─ More miners join network
├─ Higher hashrate
├─ Better security
└─ Virtuous cycle ✅
```

### 4. Privacy as Public Good ✅

```
Traditional View:
└─ Privacy benefits only the user (private good)

SwapSig View:
├─ Privacy benefits user (private good)
├─ Burn benefits all holders (public good)
├─ Network security improved (public good)
└─ Privacy becomes public good! ✅✅
```

---

## Comparison with Alternative Mechanisms

### Fidelity Bonds (Temporary Lock)

```
Mechanism: Lock XPI for duration, get refund if honest

Pros:
├─ ✅ Recoverable (returned after swap)
├─ ✅ No permanent cost to honest users
└─ ✅ Economic deterrent to attackers

Cons:
├─ ❌ No network benefit (just temporary lock)
├─ ❌ Liquidity locked (opportunity cost)
├─ ❌ Complex refund mechanism needed
├─ ❌ Griefing still possible (low cost)
└─ ❌ Doesn't help with inflation

Verdict: Good but not optimal for Lotus
```

### XPI Burn (Permanent Destruction)

```
Mechanism: Burn percentage of swap value permanently

Pros:
├─ ✅ Permanent cost (strong deterrent)
├─ ✅ Network benefit (deflation)
├─ ✅ Simple verification (on-chain)
├─ ✅ Scales with value
├─ ✅ No refund complexity
└─ ✅ Aligns with Lotus economics

Cons:
├─ 🔶 Permanent cost to all users (but tiny: 0.1%)
└─ 🔶 Can't recover burn (but this is the point!)

Verdict: IDEAL for Lotus! ✅✅✅
```

### Why Burn is Better for Lotus

| Aspect              | Fidelity Bonds | XPI Burn          | Winner |
| ------------------- | -------------- | ----------------- | ------ |
| **Security**        |                |                   |        |
| Sybil Deterrence    | ✅ Good        | ✅✅ Excellent    | Burn   |
| Griefing Deterrence | ✅ Moderate    | ✅✅ Strong       | Burn   |
| Attack Cost         | Temporary      | Permanent         | Burn   |
| **Economics**       |                |                   |        |
| User Cost           | Opportunity    | Tiny % (0.1%)     | Burn   |
| Network Benefit     | None           | Deflation         | Burn   |
| Inflation Offset    | ❌ No          | ✅ Yes            | Burn   |
| **Implementation**  |                |                   |        |
| Complexity          | High           | Low               | Burn   |
| Verification        | Complex        | Simple (on-chain) | Burn   |
| Refund Mechanism    | Required       | Not needed        | Burn   |

**Verdict**: **XPI Burn is superior for Lotus** ✅✅✅

---

## User Experience

### Cost Transparency

```typescript
// Before joining pool, show user the burn cost
const poolInfo = await swapSig.getPool(poolId)
const burnAmount = calculateBurnAmount(
  poolInfo.denomination,
  poolInfo.burnConfig.burnPercentage,
)

console.log('Swap details:')
console.log(`Amount: ${poolInfo.denomination / 1000000} XPI`)
console.log(
  `Privacy burn: ${burnAmount / 1000000} XPI (${poolInfo.burnConfig.burnPercentage * 100}%)`,
)
console.log(`Mining fee: ~0.01 XPI`)
console.log(
  `Total cost: ~${(poolInfo.denomination + burnAmount + 10000) / 1000000} XPI`,
)

// User can decide if acceptable
const proceed = await userConfirm('Proceed with swap?')
```

### Wallet Integration Example

```typescript
// In wallet send dialog:

Send 1.0 XPI with privacy:
┌─────────────────────────────────────┐
│ Amount: 1.0 XPI                     │
│ Destination: lotus1q...             │
│                                     │
│ [x] Enable Privacy (SwapSig)        │
│                                     │
│ Privacy Cost:                       │
│ ├─ Burn: 0.001 XPI (~$0.05)         │
│ └─ Note: Helps reduce inflation ✅  │
│                                     │
│ Total: 1.011 XPI                    │
│ ├─ 1.0 XPI (recipient receives)     │
│ ├─ 0.001 XPI (burned for privacy)   │
│ └─ 0.01 XPI (mining fee)            │
└─────────────────────────────────────┘

[Send with Privacy] [Send Normal]
```

### User Cost Examples

| Swap Amount | Burn (0.1%) | USD @ $50/XPI | Acceptable? |
| ----------- | ----------- | ------------- | ----------- |
| 0.1 XPI     | 0.0001 XPI  | ~$0.005       | ✅ Yes      |
| 1.0 XPI     | 0.001 XPI   | ~$0.05        | ✅ Yes      |
| 10 XPI      | 0.01 XPI    | ~$0.50        | ✅ Yes      |
| 100 XPI     | 0.01 XPI\*  | ~$0.50        | ✅ Yes      |

\*Capped at maximum burn (0.01 XPI)

**User Acceptance**: Excellent (< 0.1% cost for undetectable privacy) ✅

---

## Lotus-Specific Implementation

### Reference: lotusd Codebase

From the lotusd source code, we can reference:

**Block Reward** (`src/validation.cpp`):

```cpp
// Lotus has inflationary block rewards
// Source: lotusd/src/validation.cpp
```

**OP_RETURN Support** (Transaction validation):

```cpp
// Lotus supports OP_RETURN outputs for data
// Burn outputs use standard OP_RETURN
// See: lotusd/src/script/ for script validation
```

**Transaction Structure** (Lotus format):

```cpp
// Lotus transactions support multiple outputs
// Including OP_RETURN outputs
// See: lotusd/src/primitives/transaction.h
```

### Burn Output Script

```typescript
// Lotus-compatible OP_RETURN script
function buildBurnScript(data: Buffer): Script {
  // OP_RETURN <data>
  return new Script().add(Opcode.OP_RETURN).add(data)

  // Result: Provably unspendable output ✅
  // Lotus nodes will validate but never attempt to spend
}

// Data format:
// [SWAPSIG_BURN(12)] [PoolID(32)] [Version(1)] [Timestamp(4)]
// Total: 49 bytes (well within OP_RETURN limits)
```

### Integration with Lotus Mempool

```typescript
// Burn transactions are standard Lotus transactions
// No special handling needed in lotusd

Benefits:
├─ ✅ Standard transaction validation
├─ ✅ Normal propagation through network
├─ ✅ Regular mining incentives (fees)
├─ ✅ No protocol changes needed
└─ ✅ Works with existing Lotus infrastructure

Reference: Lotus transaction validation
See: lotusd/src/validation.cpp (ProcessMessage, AcceptToMemoryPool)
```

---

## Advanced: Dynamic Burn Adjustment

### Future Enhancement: Inflation-Responsive Burn

```typescript
// Adjust burn based on network inflation rate
// Goal: Maintain target inflation rate

interface DynamicBurnConfig {
  targetInflationRate: number // e.g., 2% annual
  currentInflationRate: number // Fetched from network
  baseBurnPercentage: number // 0.001 (0.1%)
  maxBurnPercentage: number // 0.01 (1.0%)
}

function calculateDynamicBurn(
  swapAmount: number,
  config: DynamicBurnConfig,
): number {
  // If inflation above target, increase burn
  const inflationDelta =
    config.currentInflationRate - config.targetInflationRate

  // Adjust burn percentage (max 10x multiplier)
  const multiplier = Math.min(1 + inflationDelta * 5, 10)
  const adjustedBurn = config.baseBurnPercentage * multiplier

  // Cap at maximum
  const finalBurn = Math.min(adjustedBurn, config.maxBurnPercentage)

  return Math.floor(swapAmount * finalBurn)
}

// Examples:
// Inflation = 2% (at target) → Burn = 0.1% (normal)
// Inflation = 3% (1% above) → Burn = 0.6% (increased)
// Inflation = 5% (3% above) → Burn = 1.0% (max)

// This creates automatic stabilization mechanism ✅
```

---

## Monitoring and Analytics

### Tracking Burns

```typescript
// Track SwapSig burns across network

interface BurnStatistics {
  // Daily stats
  dailyBurns: number // satoshis burned today
  dailySwaps: number // number of swaps today

  // Historical
  totalBurned: number // all-time satoshis burned
  totalSwaps: number // all-time swaps

  // Rates
  averageBurnPerSwap: number // average burn amount
  burnRate: number // burns per day

  // Economics
  estimatedDeflation: number // % annual deflation from burns
  networkInflation: number // % annual inflation (minus burns)
}

// Query blockchain for burn outputs
async function calculateBurnStatistics(): Promise<BurnStatistics> {
  // Scan blockchain for SWAPSIG_BURN OP_RETURN outputs
  const burnOutputs = await blockchain.findOutputs({
    script: { contains: 'SWAPSIG_BURN' },
    type: 'OP_RETURN',
  })

  const totalBurned = burnOutputs.reduce((sum, out) => sum + out.satoshis, 0)
  const totalSwaps = burnOutputs.length

  return {
    totalBurned,
    totalSwaps,
    averageBurnPerSwap: totalBurned / totalSwaps,
    // ... calculate other metrics
  }
}
```

### Network Dashboard

```
SwapSig Network Statistics:
═══════════════════════════════════

Total Swaps: 10,523
Total Burned: 10,523,000 sats (10.523 XPI)
Average Burn: 1,000 sats (0.001 XPI)

Daily Metrics:
├─ Swaps today: 87
├─ Burned today: 87,000 sats (0.087 XPI)
└─ Burn rate: ~0.087 XPI/day

Impact on Inflation:
├─ Daily burn: 0.087 XPI
├─ Yearly burn (projected): ~31.8 XPI
├─ % of total supply: ~0.001% (example)
└─ Deflationary impact: Minor but growing ✅

Privacy Metrics:
├─ Average pool size: 5.2 participants
├─ Average anonymity set: ~140
├─ On-chain detection: 0 cases (undetectable) ✅
└─ Privacy success rate: 98.7% ✅
```

---

## Economic Game Theory

### Attacker vs Defender Economics

**Honest User**:

```
Cost per swap:
├─ Burn: 0.001 XPI (~$0.05)
├─ Benefit: Perfect privacy
├─ ROI: Infinite (privacy is priceless)
└─ Decision: USE SWAPSIG ✅
```

**Sybil Attacker** (trying to deanonymize):

```
Cost to control 60% of 5-person pool:
├─ 3 fake participants
├─ Lock: 3.0 XPI (~$150)
├─ Burn: 0.003 XPI (~$0.15) PERMANENT
├─ Benefit: Deanonymize 2 people (low value)
├─ ROI: NEGATIVE ❌
└─ Decision: DON'T ATTACK ✅

Cost to control 60% of 10-person pool:
├─ 6 fake participants
├─ Lock: 6.0 XPI (~$300)
├─ Burn: 0.006 XPI (~$0.30) PERMANENT
├─ Benefit: Still just deanonymize ~4 people
├─ ROI: VERY NEGATIVE ❌❌
└─ Decision: DEFINITELY DON'T ATTACK ✅✅
```

**Equilibrium**: Attacking is always irrational (cost >> benefit) ✅

---

## Configuration Recommendations

### By Use Case

**General Purpose (Default)**:

```typescript
{
  burnPercentage: 0.001,  // 0.1%
  minimumBurn: 100,       // 0.0001 XPI
  maximumBurn: 10000,     // 0.01 XPI
}
// Best balance: Low user cost, strong Sybil defense
```

**High-Value Swaps**:

```typescript
{
  burnPercentage: 0.005,  // 0.5%
  minimumBurn: 1000,      // 0.001 XPI
  maximumBurn: 50000,     // 0.05 XPI
}
// Stronger security for larger swaps
```

**Low-Value / High-Volume**:

```typescript
{
  burnPercentage: 0.0005, // 0.05%
  minimumBurn: 50,        // 0.00005 XPI
  maximumBurn: 5000,      // 0.005 XPI
}
// Lower barrier for frequent small swaps
```

---

## Testing Requirements

### Unit Tests

```typescript
// test/swapsig/burn.test.ts

describe('XPI Burn Mechanism', () => {
  it('calculates burn for 1.0 XPI (1M sats) at 0.1%', () => {
    const burn = calculateBurnAmount(1000000, 0.001)
    expect(burn).toBe(1000) // 0.001 XPI
  })

  it('respects minimum burn (100 sats)', () => {
    const burn = calculateBurnAmount(1000, 0.001) // 0.001 XPI swap
    expect(burn).toBe(100) // Minimum enforced
  })

  it('respects maximum burn (10,000 sats)', () => {
    const burn = calculateBurnAmount(100000000, 0.001) // 100 XPI swap
    expect(burn).toBe(10000) // Maximum enforced
  })

  it('creates valid OP_RETURN burn output', () => {
    const output = createBurnOutput(1000, poolId, config)
    expect(output.script.isDataOut()).toBe(true)
    expect(output.satoshis).toBe(1000)
  })

  it('verifies burn in setup transaction', async () => {
    const tx = await buildSetupTransaction()
    const valid = await verifyBurnOutput(tx.id, 1000, poolId, config)
    expect(valid).toBe(true)
  })

  it('rejects insufficient burn', async () => {
    const tx = await buildSetupTransactionWithBurn(500) // Too low
    const valid = await verifyBurnOutput(tx.id, 1000, poolId, config)
    expect(valid).toBe(false)
  })

  it('rejects missing burn output', async () => {
    const tx = await buildSetupTransactionWithoutBurn()
    const valid = await verifyBurnOutput(tx.id, 1000, poolId, config)
    expect(valid).toBe(false)
  })
})
```

### Integration Tests

```typescript
describe('Burn Verification in Swap Flow', () => {
  it('validates all participants burned required amount', async () => {
    const pool = await createPool({ denomination: 1000000 })

    // All participants create setup txs with burns
    await Promise.all(participants.map(p => p.broadcastSetup(pool)))

    // Verify all burns
    const allValid = await validateAllBurns(pool)
    expect(allValid).toBe(true)
  })

  it('excludes participant with invalid burn', async () => {
    const pool = await createPool({ denomination: 1000000 })

    // Honest participants burn correctly
    await participant1.broadcastSetup(pool) // ✅ Valid burn
    await participant2.broadcastSetup(pool) // ✅ Valid burn

    // Malicious participant burns too little
    await participant3.broadcastSetupWithBurn(500) // ❌ Insufficient

    // Verification should fail
    const allValid = await validateAllBurns(pool)
    expect(allValid).toBe(false)

    // Participant 3 should be excluded
    expect(pool.participants.length).toBe(2)
  })
})
```

---

## Conclusion

### Why XPI Burn is Perfect for SwapSig on Lotus

**Security**:

- ✅✅✅ **Strongest Sybil defense** (economic + permanent cost)
- ✅ Verifiable on-chain (Lotus blockchain)
- ✅ Scales with value (proportional protection)

**Economics**:

- ✅✅ **Benefits entire network** (deflationary pressure)
- ✅ Offsets inflation (Lotus-specific advantage)
- ✅ Minimal user cost (0.1% for privacy)

**Implementation**:

- ✅ Simple (standard OP_RETURN)
- ✅ Lotus-native (works with existing infrastructure)
- ✅ No protocol changes needed

**Alignment**:

- ✅ User incentive: Privacy worth tiny burn
- ✅ Network incentive: Deflation supports value
- ✅ Security incentive: Attacks too expensive
- ✅ Triple win scenario ✅✅✅

### Summary

The XPI burn mechanism transforms SwapSig from just a privacy protocol into a **network-beneficial public good**:

```
Privacy Usage → Token Burn → Reduced Inflation → Network Health ✅

Traditional privacy: Only user benefits
SwapSig privacy: EVERYONE benefits ✅✅

This is the ideal Sybil defense for Lotus!
```

**Reference**: [Lotus Documentation](https://lotusia.org/docs) for XPI token economics

---

**Document Version**: 1.0  
**Last Updated**: November 1, 2025  
**Status**: Specification  
**Lotus XPI**: 6 decimal places (1 XPI = 1,000,000 satoshis)

**See Also**:

- [SWAPSIG_SECURITY_ANALYSIS.md](./SWAPSIG_SECURITY_ANALYSIS.md) - Complete security analysis
- [SWAPSIG_PROTOCOL.md](./SWAPSIG_PROTOCOL.md) - Protocol specification
- [Lotus Documentation](https://lotusia.org/docs) - Lotus economics and specs
