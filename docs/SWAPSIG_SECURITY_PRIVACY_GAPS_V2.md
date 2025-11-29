# SwapSig Security & Privacy Gap Analysis v2.0

**Author**: The Lotusia Stewardship  
**Date**: November 28, 2025  
**Version**: 2.0  
**Status**: Comprehensive Security Review

---

## Analysis Framework

This second-pass analysis uses established blockchain security frameworks:

1. **STRIDE Threat Model** (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)
2. **CoinJoin Research Corpus** (MIT DCI, WabiSabi, Whirlpool analysis)
3. **Lotus-Specific Capabilities** (SIGHASH_LOTUS, Taproot, OP_CHECKDATASIG, OP_CHECKLOCKTIMEVERIFY)
4. **Privacy Metrics** (Anonymity Set, Unlinkability, Undetectability, Plausible Deniability)

---

## Part I: Extended Vulnerability Analysis

### 1. Intersection Attack Vulnerability (NEW)

**Severity**: 🔴 **CRITICAL**

**Research Basis**: MIT DCI CoinJoin research, Spiral Blog Part 4 on intersection attacks

**Attack Description**:
When a participant uses post-mix outputs together in subsequent transactions, or uses pre-mix "toxic change" with post-mix outputs, the anonymity set is reduced through intersection analysis.

```
SwapSig Scenario:
- Alice participates in Pool A (5 participants)
- Alice participates in Pool B (5 participants)
- Alice later combines outputs from Pool A and Pool B in a single transaction

Intersection Attack:
- Pool A anonymity set: {Alice, Bob, Carol, Dave, Eve}
- Pool B anonymity set: {Alice, Frank, Grace, Henry, Ivan}
- Intersection: {Alice} ← DEANONYMIZED!
```

**Current Specification Gap**:

- No guidance on post-swap output handling
- No toxic change management
- No wallet integration for output isolation

**Recommended Fix**:

```typescript
interface PostSwapOutputPolicy {
  // Never combine outputs from different pools
  enforceOutputIsolation: boolean

  // Track which outputs came from which pools
  outputPoolMapping: Map<string, string> // utxo -> poolId

  // Warn user before combining pool outputs
  warnOnIntersectionRisk: boolean

  // Minimum time between using outputs from same pool
  outputCooldownBlocks: number // e.g., 100 blocks
}

// Wallet-level enforcement
class SwapSigWallet {
  async createTransaction(outputs: UTXO[]): Promise<Transaction> {
    // Check for intersection risk
    const pools = new Set(outputs.map(o => this.outputPoolMapping.get(o.txid)))
    if (pools.size > 1) {
      throw new Error(
        'INTERSECTION_RISK: Combining outputs from different pools',
      )
    }
    // ...
  }
}
```

**Implementation Priority**: P0 - Critical for real-world privacy

---

### 2. Fee Rate Fingerprinting (NEW)

**Severity**: 🔶 **HIGH**

**Research Basis**: MIT DCI research showing CoinJoin usage correlates with fee rates

**Attack Description**:
SwapSig transactions may have distinctive fee patterns that enable detection:

1. **Uniform Fee Rate**: All setup transactions use same fee rate (fingerprint)
2. **Fee Sensitivity**: SwapSig usage drops during high-fee periods (behavioral fingerprint)
3. **Fee Overpay for Burns**: Stealth burn via fee creates abnormal fee patterns

```
Detection Heuristic:
- Find transactions with fee rate X sats/vbyte
- Find transactions to Taproot addresses in same block
- If multiple transactions have identical fee rates → likely SwapSig pool
```

**Current Specification Gap**:

- Fixed fee rate per pool
- No fee rate randomization
- Burn-via-fee creates detectable patterns

**Recommended Fix**:

```typescript
interface FeeObfuscation {
  // Base fee rate (user-specified or estimated)
  baseFeeRate: number

  // Random variance range (e.g., ±20%)
  feeVariancePercent: number

  // Per-transaction fee randomization
  getRandomizedFeeRate(): number {
    const variance = this.baseFeeRate * this.feeVariancePercent
    return this.baseFeeRate + (Math.random() - 0.5) * 2 * variance
  }

  // For burn-via-fee: add random padding
  getBurnFeeWithPadding(burnAmount: number, baseFee: number): number {
    const padding = Math.random() * burnAmount * 0.5  // 0-50% extra
    return baseFee + burnAmount + padding
  }
}
```

**Implementation Priority**: P1 - Important for undetectability

---

### 3. Taproot State Leakage (NEW - Lotus-Specific)

**Severity**: 🔶 **MEDIUM-HIGH**

**Lotus Feature**: Taproot outputs can include 32-byte state: `OP_SCRIPTTYPE OP_1 <33-byte commitment> <32-byte state>`

**Attack Description**:
If SwapSig uses Taproot state for protocol metadata, this creates on-chain fingerprints:

```
Lotus Taproot with State:
- Normal Taproot: OP_SCRIPTTYPE OP_1 <pubkey>  (36 bytes)
- Taproot+State:  OP_SCRIPTTYPE OP_1 <pubkey> <state>  (69 bytes)

If SwapSig uses state field for pool coordination:
→ All SwapSig outputs are 69 bytes (fingerprint!)
→ State content may leak pool information
```

**Current Specification Gap**:

- Unclear whether Taproot state is used
- No guidance on state field privacy

**Recommended Fix**:

```typescript
// NEVER use Taproot state for SwapSig
// All outputs should be standard 36-byte Taproot

interface TaprootOutputPolicy {
  // Enforce no-state Taproot outputs
  useStateField: false // ALWAYS false for privacy

  // Output size must match normal Taproot
  expectedOutputSize: 36 // OP_SCRIPTTYPE OP_1 <33-byte pubkey>
}

// Validation
function validateTaprootOutput(script: Script): boolean {
  return script.size === TAPROOT_SIZE_WITHOUT_STATE // 36 bytes
}
```

**Implementation Priority**: P1 - Lotus-specific privacy requirement

---

### 4. SIGHASH_LOTUS Fingerprinting (NEW - Lotus-Specific)

**Severity**: 🔶 **MEDIUM**

**Lotus Feature**: `SIGHASH_LOTUS` (0x60) is required for Taproot key-spend path

**Attack Description**:

```
Signature Analysis:
- SIGHASH_LOTUS signatures have specific structure
- Taproot key-spend MUST use SIGHASH_LOTUS + Schnorr
- If most Lotus transactions use SIGHASH_FORKID, SIGHASH_LOTUS is distinctive

Fingerprint:
- Settlement transactions use Taproot key-spend
- Taproot key-spend requires SIGHASH_LOTUS
- SIGHASH_LOTUS usage may be rare → SwapSig fingerprint
```

**Current Specification Gap**:

- No analysis of SIGHASH_LOTUS prevalence
- No consideration of signature-based fingerprinting

**Recommended Fix**:

```typescript
// This is a Lotus ecosystem issue, not SwapSig-specific
// Mitigation: Encourage broader Taproot adoption

interface SighashAnalysis {
  // Monitor SIGHASH_LOTUS prevalence on network
  lotusSignatureRatio: number // % of txs using SIGHASH_LOTUS

  // If ratio is low, SwapSig is fingerprintable
  // Mitigation: Promote Taproot usage across Lotus ecosystem

  // Alternative: Use script-spend path instead of key-spend
  // (But this reveals the script, which may be worse)
}

// Best mitigation: Lotus ecosystem should encourage Taproot adoption
// SwapSig benefits from larger Taproot anonymity set
```

**Implementation Priority**: P2 - Ecosystem-level concern

---

### 5. OP_CHECKDATASIG for Commitment Proofs (NEW - Lotus Enhancement)

**Severity**: ✅ **ENHANCEMENT**

**Lotus Feature**: `OP_CHECKDATASIG` allows signature verification over arbitrary data

**Opportunity**:
Use OP_CHECKDATASIG for on-chain commitment verification without revealing commitment content:

```
Current Approach (Off-chain):
- Participants exchange commitment proofs via P2P
- No on-chain verification
- Relies on honest majority

Enhanced Approach (On-chain with OP_CHECKDATASIG):
- Commitment proof embedded in setup transaction
- OP_CHECKDATASIG verifies signature over commitment
- On-chain accountability without revealing destination
```

**Proposed Enhancement**:

```typescript
// Setup transaction with commitment proof
interface SetupTransactionWithProof {
  // Standard outputs
  outputs: [
    { script: taprootOutput; amount: denomination },
    { script: burnOutput; amount: burnAmount },
  ]

  // OP_RETURN with commitment proof (optional)
  commitmentProof?: {
    // Hash of destination commitment
    commitmentHash: Buffer // 32 bytes

    // Signature over commitment (proves knowledge without revealing)
    // Using OP_CHECKDATASIG-compatible format
    commitmentSignature: Buffer // 64 bytes (Schnorr)
  }
}

// Script for commitment verification (in settlement):
// <sig> <commitment> <pubkey> OP_CHECKDATASIG
// Proves participant committed to this destination
```

**Trade-off Analysis**:

- **Pro**: On-chain accountability, reduces coordinator trust
- **Con**: Adds ~100 bytes per transaction, slight fingerprint risk
- **Recommendation**: Optional feature for high-security pools

**Implementation Priority**: P2 - Optional enhancement

---

### 6. Timelock-Based Refund Path (NEW - Lotus Enhancement)

**Severity**: ✅ **ENHANCEMENT**

**Lotus Features**: `OP_CHECKLOCKTIMEVERIFY`, `OP_CHECKSEQUENCEVERIFY`

**Current Gap**:
If settlement fails, funds in shared Taproot outputs may be stuck. Current spec relies on:

- All signers cooperating for refund
- Coordinator failover
- No on-chain fallback

**Proposed Enhancement**:
Use Taproot script-spend path with timelock for trustless refunds:

```typescript
// Taproot output with refund script
interface TaprootWithRefund {
  // Key-spend path: MuSig2 aggregated key (normal settlement)
  keySpendPubkey: PublicKey // Aggregated MuSig2 key

  // Script-spend path: Timelocked refund to original owner
  refundScript: Script

  // Commitment combines both paths
  taprootCommitment: PublicKey
}

// Refund script using OP_CHECKSEQUENCEVERIFY
function buildRefundScript(
  originalOwnerPubkey: PublicKey,
  timeoutBlocks: number, // e.g., 144 blocks = ~1 day
): Script {
  return new Script()
    .add(timeoutBlocks)
    .add(Opcode.OP_CHECKSEQUENCEVERIFY)
    .add(Opcode.OP_DROP)
    .add(originalOwnerPubkey.toBuffer())
    .add(Opcode.OP_CHECKSIG)
}

// Taproot construction
function buildTaprootWithRefund(
  musig2AggKey: PublicKey,
  refundScript: Script,
): { commitment: PublicKey; controlBlock: Buffer } {
  // Compute tapleaf hash
  const tapleafHash = Hash.taggedHash(
    'TapLeaf',
    Buffer.concat([
      Buffer.from([TAPROOT_LEAF_TAPSCRIPT]),
      refundScript.toBuffer(),
    ]),
  )

  // Tweak aggregated key with script commitment
  const tweakHash = Hash.taggedHash(
    'TapTweak',
    Buffer.concat([musig2AggKey.toBuffer(), tapleafHash]),
  )

  const commitment = musig2AggKey.add(Point.fromScalar(tweakHash))

  return {
    commitment,
    controlBlock: buildControlBlock(musig2AggKey, tapleafHash),
  }
}
```

**Benefits**:

1. **Trustless Refunds**: If settlement fails, original owner can reclaim after timeout
2. **No Coordinator Dependency**: Refund doesn't require coordinator cooperation
3. **Atomic Safety**: Either settlement succeeds OR refund after timeout
4. **Hidden Complexity**: Script-spend path is hidden unless used (Taproot privacy)

**Trade-off Analysis**:

- **Pro**: Eliminates stuck funds risk, reduces coordinator trust
- **Con**: Slightly larger control block if refund is used (~33 bytes)
- **Privacy**: Refund reveals script (but only in failure case)

**Implementation Priority**: P1 - Important for fund safety

---

### 7. Amount Correlation Attack (NEW)

**Severity**: 🔶 **HIGH**

**Research Basis**: CoinJoin detection heuristics (equal output amounts)

**Attack Description**:

```
SwapSig Detection via Amount Analysis:

Round 1 (Setup):
- Tx1: 1.0 XPI → Taproot (0.989 XPI)
- Tx2: 1.0 XPI → Taproot (0.989 XPI)
- Tx3: 1.0 XPI → Taproot (0.989 XPI)

Round 2 (Settlement):
- Tx4: Taproot (0.989 XPI) → Address (0.979 XPI)
- Tx5: Taproot (0.989 XPI) → Address (0.979 XPI)
- Tx6: Taproot (0.989 XPI) → Address (0.979 XPI)

Detection:
- Find all Taproot outputs with amount X
- Find all spends of those outputs with amount X - fee
- If multiple match → likely SwapSig pool
```

**Current Specification Gap**:

- Fixed denomination per pool
- Identical output amounts (minus fees)
- No amount obfuscation

**Recommended Fix**:

```typescript
interface AmountObfuscation {
  // Base denomination
  denomination: number

  // Random amount variance (e.g., ±1%)
  amountVariancePercent: number

  // Per-participant amount randomization
  getRandomizedAmount(): number {
    const variance = this.denomination * this.amountVariancePercent
    const randomOffset = (Math.random() - 0.5) * 2 * variance
    return this.denomination + randomOffset
  }

  // Ensure amounts are still "close enough" for privacy
  // but different enough to avoid exact-match detection
  validateAmountVariance(amounts: number[]): boolean {
    const avg = amounts.reduce((a, b) => a + b) / amounts.length
    return amounts.every(a => Math.abs(a - avg) / avg < this.amountVariancePercent)
  }
}

// Alternative: Use sub-satoshi precision if Lotus supports it
// Or: Add random "dust" outputs to obscure amounts
```

**Implementation Priority**: P1 - Important for undetectability

---

### 8. Transaction Graph Analysis (NEW)

**Severity**: 🔶 **HIGH**

**Research Basis**: Blockchain graph analysis, common input ownership heuristic

**Attack Description**:

```
Graph Analysis of SwapSig:

Setup Phase:
A_input → Taproot_AB
B_input → Taproot_BC
C_input → Taproot_CA

Settlement Phase:
Taproot_BC → A_final
Taproot_CA → B_final
Taproot_AB → C_final

Graph Pattern:
- 3 inputs create 3 Taproot outputs (star pattern)
- 3 Taproot outputs spend to 3 final addresses (star pattern)
- Temporal clustering (all within ~30 minutes)
- Amount similarity

Detection:
- Find star patterns in transaction graph
- Filter by temporal proximity
- Filter by amount similarity
- High confidence SwapSig detection
```

**Current Specification Gap**:

- No graph-level privacy analysis
- Temporal clustering creates patterns
- Star topology is distinctive

**Recommended Fix**:

```typescript
interface GraphObfuscation {
  // Temporal spreading (already in v1)
  broadcastWindowMs: number

  // Graph topology obfuscation
  enableDecoyTransactions: boolean
  decoyRate: number // e.g., 0.2 = 20% decoys

  // Chain multiple pools for graph complexity
  enablePoolChaining: boolean
  chainDepth: number // e.g., 2-3 pools

  // Use different transaction types
  mixTransactionTypes: boolean // Include normal sends
}

// Decoy transaction: Self-send that looks like SwapSig setup
async function createDecoyTransaction(
  wallet: Wallet,
  denomination: number,
): Promise<Transaction> {
  const input = await wallet.selectUTXO(denomination)
  const output = await wallet.getNewTaprootAddress()

  return new Transaction()
    .from(input)
    .to(output, denomination - fee)
    .sign(wallet.privateKey)
}

// Pool chaining: Output of Pool A becomes input to Pool B
// Creates complex graph that's harder to analyze
```

**Implementation Priority**: P1 - Important for graph-level privacy

---

## Part II: Protocol Optimizations

### 9. Reduced Network Communication (Optimization)

**Current Protocol**:

```
Phase 1: Discovery (DHT queries)
Phase 2: Registration (N messages)
Phase 3: Commitment (N messages)
Phase 4: Setup broadcast (N transactions)
Phase 5: Confirmation wait
Phase 6: Reveal (N messages)
Phase 7: MuSig2 signing (2N messages per group)
Phase 8: Settlement broadcast (G transactions)
Phase 9: Confirmation wait

Total: ~5N + 2NG messages + N + G transactions
For N=10, G=5: ~70 messages + 15 transactions
```

**Optimized Protocol**:

```typescript
// Combine phases to reduce round trips

interface OptimizedProtocol {
  // Phase 1-3: Combined Discovery + Registration + Commitment
  // Single DHT announcement includes commitment
  combinedRegistration: {
    poolId: string
    input: SwapInput
    ownershipProof: Buffer
    destinationCommitment: Buffer // Pedersen commitment
    encryptedDestinations: Map<string, Buffer> // Pre-encrypted for all
  }

  // Phase 4-5: Setup with embedded commitment proof
  // No separate commitment phase needed

  // Phase 6-7: Combined Reveal + MuSig2 Round 1
  // Reveal destination while exchanging nonces
  combinedRevealNonce: {
    destination: Address
    blindingFactor: Buffer
    publicNonces: [Point, Point]
  }

  // Phase 8: MuSig2 Round 2 + Settlement
  // Partial signatures + broadcast
}

// Reduced message count:
// ~3N messages + N + G transactions
// For N=10, G=5: ~30 messages + 15 transactions (57% reduction)
```

**Implementation Priority**: P2 - Optimization

---

### 10. Improved Transaction Model (Optimization)

**Current Model**:

- Round 1: N setup transactions (1 input → 1 Taproot output + burn)
- Round 2: G settlement transactions (1 Taproot input → 1 output)
- Total: N + G transactions

**Optimized Model with Batching**:

```typescript
// Option A: Batched Setup (if participants trust coordinator)
interface BatchedSetup {
  // Single transaction with multiple inputs and outputs
  // Reduces on-chain footprint but requires coordinator

  inputs: SwapInput[] // All participant inputs
  outputs: TaprootOutput[] // All shared outputs
  burns: BurnOutput[] // All burn outputs

  // Requires all participants to sign (MuSig2 or multi-sig)
  // Trade-off: More efficient but more coordinator trust
}

// Option B: Atomic Setup with SIGHASH_ANYONECANPAY
interface AtomicSetup {
  // Each participant signs their input with SIGHASH_ANYONECANPAY
  // Coordinator combines into single transaction

  // Participant creates partial transaction:
  partialTx: {
    input: SwapInput
    signature: Buffer // SIGHASH_ANYONECANPAY | SIGHASH_ALL
  }

  // Coordinator combines:
  combinedTx: {
    inputs: SwapInput[] // All inputs
    outputs: TaprootOutput[] // All outputs
    signatures: Buffer[] // All ANYONECANPAY signatures
  }
}

// Trade-off Analysis:
// - Batched: Fewer transactions, but coordinator can censor
// - Atomic: Coordinator can't modify, but still combines
// - Current: Most decentralized, but most transactions
```

**Recommendation**: Keep current model for maximum decentralization, but offer batched mode as optional high-efficiency mode.

**Implementation Priority**: P3 - Future optimization

---

## Part III: Lotus-Specific Enhancements

### 11. Leveraging SIGHASH_LOTUS Features

**Lotus SIGHASH_LOTUS** includes:

- Input spent outputs merkle root
- Amount sums (inputs and outputs)
- Merkle roots with heights

**Enhancement Opportunity**:

```typescript
// SIGHASH_LOTUS commits to more transaction data
// This provides stronger binding for SwapSig

interface SighashLotusAdvantages {
  // 1. Amount commitment
  // SIGHASH_LOTUS commits to total input/output amounts
  // Prevents amount manipulation attacks
  // 2. Input merkle root
  // Commits to all inputs being spent
  // Prevents input substitution
  // 3. Output merkle root
  // Commits to all outputs
  // Prevents output substitution
}

// Use SIGHASH_LOTUS for all SwapSig signatures
// (Already required for Taproot key-spend)
```

---

### 12. Taproot Script Paths for Complex Policies

**Lotus Taproot** supports script-spend paths with up to 128 levels.

**Enhancement Opportunity**:

```typescript
// Complex spending policies hidden in Taproot

interface TaprootSpendingPolicies {
  // Key-spend: Normal MuSig2 settlement (most common)
  keySpend: PublicKey // Aggregated MuSig2 key

  // Script-spend options (hidden unless used):
  scriptPaths: [
    // Path 1: Timelocked refund to original owner
    {
      script: '<timeout> OP_CSV <owner_pubkey> OP_CHECKSIG'
      probability: 0.01 // Rarely used
    },

    // Path 2: Emergency recovery with 2-of-3 multisig
    {
      script: '<2> <key1> <key2> <key3> <3> OP_CHECKMULTISIG'
      probability: 0.001 // Very rarely used
    },

    // Path 3: Dispute resolution with arbiter
    {
      script: '<arbiter_pubkey> OP_CHECKSIGVERIFY <owner_pubkey> OP_CHECKSIG'
      probability: 0.0001 // Almost never used
    },
  ]
}

// Benefits:
// - Normal case: Key-spend reveals nothing about scripts
// - Failure case: Script-spend provides fallback
// - Privacy: Scripts only revealed when used
```

---

## Part IV: Updated Vulnerability Matrix

| Vulnerability             | Severity    | Category   | Lotus-Specific Fix | Priority |
| ------------------------- | ----------- | ---------- | ------------------ | -------- |
| Destination Commitment    | 🔴 CRITICAL | Privacy    | Pedersen + ECDH    | P0       |
| DHT Privacy Leakage       | 🔴 CRITICAL | Privacy    | Anonymous routing  | P0       |
| Pool Metadata On-Chain    | 🔴 CRITICAL | Privacy    | Stealth burns      | P0       |
| Intersection Attack       | 🔴 CRITICAL | Privacy    | Wallet integration | P0       |
| Timing Correlation        | 🔶 HIGH     | Privacy    | Exponential delays | P1       |
| Fee Rate Fingerprinting   | 🔶 HIGH     | Privacy    | Fee randomization  | P1       |
| Amount Correlation        | 🔶 HIGH     | Privacy    | Amount variance    | P1       |
| Transaction Graph         | 🔶 HIGH     | Privacy    | Decoys + chaining  | P1       |
| Taproot State Leakage     | 🔶 MEDIUM   | Privacy    | No-state policy    | P1       |
| Coordinator Trust         | 🔶 MEDIUM   | Security   | Timelock refunds   | P1       |
| SIGHASH_LOTUS Fingerprint | 🔶 MEDIUM   | Privacy    | Ecosystem adoption | P2       |
| Network Communication     | 🟢 LOW      | Efficiency | Phase combining    | P2       |
| Transaction Count         | 🟢 LOW      | Efficiency | Optional batching  | P3       |

---

## Part V: Recommended Architecture Changes

### 1. Privacy-First Wallet Integration

```typescript
interface SwapSigWallet {
  // Output isolation
  outputPoolMapping: Map<string, PoolInfo>

  // Intersection prevention
  validateTransactionPrivacy(tx: Transaction): PrivacyRisk

  // Automatic pool selection
  selectOptimalPool(amount: number): Pool

  // Post-swap output management
  enforceOutputCooldown(utxo: UTXO): boolean
}
```

### 2. Tiered Privacy Modes

```typescript
enum PrivacyMode {
  STANDARD = 'standard', // Basic SwapSig
  ENHANCED = 'enhanced', // + Timing + Fee obfuscation
  MAXIMUM = 'maximum', // + Tor + Decoys + Chaining
}

interface PrivacyModeConfig {
  [PrivacyMode.STANDARD]: {
    timingObfuscation: false
    feeRandomization: false
    decoyTransactions: false
    requireTor: false
  }
  [PrivacyMode.ENHANCED]: {
    timingObfuscation: true
    feeRandomization: true
    decoyTransactions: false
    requireTor: false
  }
  [PrivacyMode.MAXIMUM]: {
    timingObfuscation: true
    feeRandomization: true
    decoyTransactions: true
    requireTor: true
    poolChaining: true
  }
}
```

### 3. On-Chain Accountability with Privacy

```typescript
// Use OP_CHECKDATASIG for commitment proofs
// Use Taproot script paths for refunds
// Use SIGHASH_LOTUS for strong binding

interface OnChainAccountability {
  // Commitment proof in setup transaction
  commitmentProof: {
    hash: Buffer
    signature: Buffer // OP_CHECKDATASIG compatible
  }

  // Refund path in Taproot
  refundScript: Script // OP_CSV + OP_CHECKSIG

  // Strong signature binding
  sighashType: SIGHASH_LOTUS | SIGHASH_ALL
}
```

---

## Conclusion

This second-pass analysis identifies **4 additional critical vulnerabilities** (intersection attacks, fee fingerprinting, amount correlation, graph analysis) and proposes **3 Lotus-specific enhancements** (OP_CHECKDATASIG proofs, timelock refunds, Taproot script paths).

The key insight from CoinJoin research is that **post-mix behavior** is as important as the mixing protocol itself. SwapSig must include wallet-level integration to prevent intersection attacks.

Lotus-specific features (SIGHASH_LOTUS, Taproot, OP_CHECKDATASIG, OP_CSV) provide opportunities for enhanced security and trustless refunds that aren't available on other chains.

---

**Document Version**: 2.0  
**Last Updated**: November 28, 2025  
**Status**: Comprehensive Review Complete  
**Next Steps**: Update implementation plan with new findings
