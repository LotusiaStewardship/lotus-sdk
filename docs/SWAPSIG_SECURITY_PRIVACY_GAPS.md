# SwapSig Security & Privacy Gap Analysis

**Author**: The Lotusia Stewardship  
**Date**: November 28, 2025  
**Version**: 1.0  
**Status**: Critical Review for Re-Implementation

---

## Executive Summary

This document analyzes critical security and privacy vulnerabilities in the SwapSig protocol specification following the MuSig2 P2P architecture rearchitecture. The analysis identifies gaps that must be addressed in the new implementation.

### Overall Assessment

| Category                   | Current Spec | Gap Severity | Priority |
| -------------------------- | ------------ | ------------ | -------- |
| **Cryptographic Security** | ✅ Strong    | Low          | -        |
| **Network Privacy**        | 🔶 Partial   | **HIGH**     | P0       |
| **Destination Commitment** | 🔴 Weak      | **CRITICAL** | P0       |
| **Timing Correlation**     | 🔶 Partial   | HIGH         | P1       |
| **Pool Metadata Leakage**  | 🔴 Missing   | **CRITICAL** | P0       |
| **DHT Privacy**            | 🔴 Missing   | **CRITICAL** | P0       |
| **Coordinator Trust**      | 🔶 Partial   | MEDIUM       | P1       |
| **Burn Verification**      | 🔶 Partial   | MEDIUM       | P2       |

---

## Critical Vulnerabilities

### 1. Destination Commitment Scheme Weakness

**Severity**: 🔴 **CRITICAL**

**Current Specification**:

```typescript
// Current approach (WEAK):
const encrypted = encryptAddress(finalDestination, poolSecret)
const commitment = Hash.sha256(encrypted)
```

**Vulnerability**:
The current scheme uses a shared `poolSecret` for encryption. This creates several attack vectors:

1. **Pool Secret Derivation Attack**: If the pool secret derivation is deterministic from public pool parameters, any participant can derive it and decrypt all destinations before setup.

2. **Coordinator Knowledge Attack**: The coordinator (or any participant who knows the pool secret) can decrypt all destinations during registration, enabling front-running.

3. **Replay Attack**: If the same pool secret is reused across pools, commitments can be correlated.

**Root Cause**: The specification doesn't define:

- How `poolSecret` is derived
- Who has access to `poolSecret` and when
- Whether encryption is to individual participants or shared

**Recommended Fix**:

```typescript
// SECURE: Per-participant asymmetric encryption
interface SecureDestinationCommitment {
  // Each participant encrypts their destination to ALL other participants
  // using their public keys (threshold encryption or individual)
  encryptedDestinations: Map<string, Buffer> // peerId -> encrypted

  // Commitment is hash of the plaintext destination
  commitment: Buffer // SHA256(destination || nonce)

  // Reveal requires threshold of participants to decrypt
  revealThreshold: number
}

// Alternative: Pedersen commitment (information-theoretically hiding)
const commitment = pedersenCommit(destination, blindingFactor)
// Reveal: (destination, blindingFactor) - verifiable but hidden until reveal
```

**Implementation Priority**: P0 - Must fix before any implementation

---

### 2. DHT Privacy Leakage

**Severity**: 🔴 **CRITICAL**

**Current Specification**:

```typescript
// Pool announcement stored in DHT
await p2pCoordinator.announceResource('swapsig-pool', poolId, {
  poolId,
  denomination,
  minParticipants,
  maxParticipants,
  creatorPeerId, // ❌ LEAKS CREATOR IDENTITY
  creatorSignature,
  phase: 'discovery',
})
```

**Vulnerability**:

1. **Creator Deanonymization**: Pool creator's peer ID is publicly visible in DHT
2. **Participant Enumeration**: DHT queries can enumerate all participants
3. **Pool Correlation**: Same creator across pools can be linked
4. **Timing Analysis**: DHT PUT timestamps reveal participation timing

**Attack Scenario**:

```
Observer queries DHT for all 'swapsig-pool' resources
→ Learns all active pools, their creators, and parameters
→ Monitors DHT for 'signer-advertisement' entries
→ Correlates signers to pools by timing
→ Deanonymizes all participants before swap even begins!
```

**Recommended Fix**:

```typescript
// SECURE: Anonymous pool announcements
interface AnonymousPoolAnnouncement {
  poolId: string // Random, not derived from creator
  denomination: number
  minParticipants: number
  maxParticipants: number

  // NO creator identity - use ring signature or blind signature
  creatorProof: Buffer // Proves valid creation without revealing who

  // Encrypted participant list (only participants can decrypt)
  encryptedParticipantList: Buffer

  // Onion-routed announcement (creator hidden)
  routingPath: string[] // Intermediate nodes
}

// Use DHT with privacy-preserving queries
// - Query through Tor/onion routing
// - Use PIR (Private Information Retrieval) if available
// - Minimize DHT footprint
```

**Implementation Priority**: P0 - Fundamental privacy requirement

---

### 3. Timing Correlation Attack Surface

**Severity**: 🔴 **HIGH**

**Current Specification**:

```typescript
// Setup transactions broadcast "around the same time"
// Settlement transactions broadcast "around the same time"
// No explicit timing obfuscation in core protocol
```

**Vulnerability**:

1. **Setup Transaction Clustering**: All setup transactions for a pool are broadcast within minutes, creating a temporal cluster
2. **Settlement Clustering**: Same issue for settlement transactions
3. **Cross-Pool Correlation**: Participant who joins multiple pools creates timing patterns
4. **Blockchain Timestamp Analysis**: Block timestamps reveal transaction submission order

**Attack Scenario**:

```
Observer monitors mempool/blockchain:
1. Sees 5 transactions to Taproot addresses at T0-T0+5min
2. All have similar amounts (denomination - fee - burn)
3. 10 minutes later, sees 5 transactions FROM those Taproot addresses
4. Conclusion: These 10 transactions are a SwapSig pool
5. Even without input→output linking, PROTOCOL DETECTED
```

**Recommended Fix**:

```typescript
interface TimingObfuscation {
  // Mandatory random delays for all broadcasts
  setupBroadcastWindow: number  // e.g., 30 minutes
  settlementBroadcastWindow: number  // e.g., 30 minutes

  // Per-transaction random delay within window
  getRandomDelay(window: number): number {
    // Exponential distribution to avoid uniform clustering
    return -Math.log(Math.random()) * (window / 3)
  }

  // Decoy transactions (optional, high privacy)
  enableDecoyTransactions: boolean
  decoyRate: number  // e.g., 0.2 = 20% decoys
}

// Implementation
async broadcastSetupTransaction(tx: Transaction): Promise<void> {
  const delay = this.getRandomDelay(this.config.setupBroadcastWindow)
  await sleep(delay)

  // Optionally broadcast through different nodes
  const broadcastNode = this.selectRandomBroadcastNode()
  await broadcastNode.broadcast(tx)
}
```

**Implementation Priority**: P1 - Important for protocol undetectability

---

### 4. Pool Metadata Correlation

**Severity**: 🔴 **CRITICAL**

**Current Specification**:

```typescript
// Burn output contains pool ID
const burnData = Buffer.concat([
  Buffer.from('SWAPSIG_BURN', 'utf8'), // ❌ PROTOCOL IDENTIFIER
  Buffer.from(poolId, 'hex'), // ❌ LINKS ALL POOL TXS
  Buffer.from([0x01]),
])
```

**Vulnerability**:

1. **Protocol Fingerprint**: `SWAPSIG_BURN` identifier makes all SwapSig transactions detectable
2. **Pool Linkage**: Pool ID in burn output links all transactions in a pool
3. **Permanent On-Chain Record**: Burn outputs are permanent, enabling historical analysis

**Attack Scenario**:

```
Blockchain analyst:
1. Search for all OP_RETURN outputs containing 'SWAPSIG_BURN'
2. Group by pool ID
3. For each pool: identify all setup transactions
4. Track Taproot outputs → settlement transactions
5. COMPLETE POOL RECONSTRUCTION from on-chain data alone!
```

**Recommended Fix**:

```typescript
// SECURE: Stealth burn mechanism
interface StealthBurn {
  // Option 1: Generic OP_RETURN (no identifier)
  // Just burn to OP_RETURN with random data
  burnData: Buffer // Random bytes, no identifier

  // Option 2: Burn to unspendable P2PKH
  // Hash160 of nothing = known unspendable address
  burnAddress: Address // Provably unspendable but looks normal

  // Option 3: Burn via transaction fee
  // Overpay fee by burn amount (miners receive, no OP_RETURN)
  burnViaFee: boolean

  // Verification: Off-chain commitment
  // Participants verify burn via signed attestation, not on-chain
  burnCommitment: Buffer // Hash of (txid || burnAmount || poolId)
  burnSignature: Buffer // Participant signs commitment
}

// Pool ID should NEVER appear on-chain
// Use off-chain verification with on-chain burn proof
```

**Implementation Priority**: P0 - Fundamental to on-chain privacy claim

---

### 5. Coordinator Trust Model Gaps

**Severity**: 🔶 **MEDIUM-HIGH**

**Current Specification**:

```typescript
// Coordinator is elected deterministically
// Coordinator broadcasts settlement transactions
// Failover to backup coordinators
```

**Vulnerability**:

1. **Coordinator Sees All Destinations**: During reveal phase, coordinator learns all final destinations
2. **Coordinator Timing Control**: Coordinator controls when settlements are broadcast
3. **Selective Censorship**: Coordinator can delay specific settlements
4. **Deanonymization Window**: Between reveal and settlement, coordinator knows mapping

**Attack Scenario**:

```
Malicious coordinator:
1. Waits for destination reveal phase
2. Records all (participant, destination) pairs
3. Completes protocol normally (no detection)
4. Sells deanonymization data to chain analysis firms
```

**Recommended Fix**:

```typescript
// SECURE: Threshold reveal with coordinator blindness
interface BlindCoordinator {
  // Destinations encrypted to settlement partners only
  // Coordinator never sees plaintext destinations
  // Each settlement pair exchanges destinations directly
  // Using existing P2P direct messaging
  // Coordinator only sees:
  // - Encrypted destination blobs
  // - Signed settlement transactions (already public)
  // Settlement transaction construction:
  // - Each pair builds their own settlement tx
  // - Coordinator aggregates signatures only
  // - Coordinator never sees destination addresses
}

// Alternative: Rotating coordinator per settlement
// Different coordinator for each settlement transaction
// No single party sees all destinations
```

**Implementation Priority**: P1 - Important for trust minimization

---

### 6. Sybil Attack Economic Analysis Gaps

**Severity**: 🔶 **MEDIUM**

**Current Specification**:

```typescript
// 0.1% burn = 1,000 sats for 1 XPI swap
// Claim: "Economically infeasible" for Sybil attack
```

**Vulnerability**:
The economic analysis assumes:

1. Attacker values privacy deanonymization at $0
2. Attacker has no external incentives (e.g., government funding)
3. Burn cost is the only consideration

**Reality**:

- State actors have unlimited budgets
- Chain analysis firms profit from deanonymization
- 0.1% burn for 100 fake participants = 0.1 XPI (~$5) - trivial for funded adversary

**Recommended Fix**:

```typescript
// SECURE: Adaptive burn based on pool value and risk
interface AdaptiveBurn {
  // Base burn percentage
  baseBurnPercentage: number // 0.1%

  // Scale with pool size (larger pools = higher burn)
  poolSizeMultiplier: (size: number) => number

  // Scale with denomination (larger swaps = higher burn)
  denominationMultiplier: (amount: number) => number

  // Minimum absolute burn (prevents dust attacks)
  minimumBurn: number // e.g., 10,000 sats (0.01 XPI)

  // Maximum burn cap (prevents excessive cost)
  maximumBurn: number // e.g., 1,000,000 sats (1 XPI)

  // Time-locked burn (burn must mature before participation)
  burnMaturationBlocks: number // e.g., 6 blocks
}

// Additional Sybil defense: Proof of unique identity
// - Burn-based identity from existing infrastructure
// - Minimum identity age requirement
// - Cross-pool identity tracking (same identity = same participant)
```

**Implementation Priority**: P2 - Enhancement for high-security deployments

---

### 7. Network Layer Privacy Gaps

**Severity**: 🔶 **HIGH**

**Current Specification**:

```typescript
// "Recommend Tor usage"
// "Timing obfuscation optional"
// No mandatory network privacy
```

**Vulnerability**:

1. **IP Address Correlation**: Without Tor, IP addresses reveal participant identity
2. **ISP-Level Surveillance**: ISPs can correlate P2P traffic to SwapSig participation
3. **Connection Graph Analysis**: Who connects to whom reveals pool membership

**Recommended Fix**:

```typescript
// SECURE: Mandatory network privacy layer
interface NetworkPrivacy {
  // Require Tor or equivalent for all connections
  requireAnonymousTransport: boolean // Default: true

  // Supported transports
  anonymousTransports: ('tor' | 'i2p' | 'mixnet')[]

  // Fallback behavior
  allowClearnetFallback: boolean // Default: false for privacy pools

  // Connection diversity requirements
  minTransportDiversity: number // e.g., 2 different transports

  // Peer selection with privacy
  peerSelectionStrategy: 'random' | 'diverse' | 'onion-routed'
}

// Implementation: Integrate with existing P2P layer
// - Add Tor transport option
// - Add I2P transport option
// - Enforce transport requirements per pool configuration
```

**Implementation Priority**: P1 - Critical for network-level privacy

---

### 8. Group Size Selection Privacy Implications

**Severity**: 🔶 **MEDIUM**

**Current Specification**:

```typescript
// Automatic group size selection based on participant count
// 3-9: 2-of-2, 10-14: 3-of-3, 15-49: 5-of-5, 50+: 10-of-10
```

**Vulnerability**:

1. **Group Size Fingerprinting**: Different group sizes create different on-chain patterns
2. **Participant Count Inference**: Settlement transaction count reveals group size
3. **Pool Size Estimation**: From group size, can estimate total participants

**Attack Scenario**:

```
Observer sees:
- 5 settlement transactions from Taproot addresses
- Each Taproot address has 5 inputs (from 5 setup txs)
- Conclusion: 5-of-5 groups, likely 15-49 participants
- Narrows anonymity set significantly
```

**Recommended Fix**:

```typescript
// SECURE: Uniform group size or randomized selection
interface PrivacyPreservingGrouping {
  // Option 1: Always use same group size (e.g., 5-of-5)
  // Regardless of participant count
  // Pad with dummy participants if needed

  // Option 2: Randomize group size within acceptable range
  // Add noise to prevent exact inference

  // Option 3: Variable output counts per settlement
  // Some settlements have 1 output, some have 2
  // Breaks the 1:1 settlement:destination pattern

  groupSizeStrategy: 'fixed' | 'randomized' | 'variable-outputs'
  fixedGroupSize?: number // If fixed strategy
  groupSizeRange?: [number, number] // If randomized
}
```

**Implementation Priority**: P2 - Enhancement for maximum privacy

---

## Summary of Required Changes

### P0 - Critical (Must Fix Before Implementation)

1. **Destination Commitment Scheme**: Replace shared-secret encryption with per-participant asymmetric encryption or Pedersen commitments
2. **DHT Privacy**: Remove creator identity from pool announcements, use anonymous routing for DHT operations
3. **Burn Output Stealth**: Remove protocol identifier and pool ID from on-chain burn outputs

### P1 - High Priority (Required for Production)

4. **Timing Obfuscation**: Mandatory random delays with exponential distribution
5. **Coordinator Blindness**: Ensure coordinator never sees plaintext destinations
6. **Network Privacy**: Require anonymous transport (Tor/I2P) for privacy-critical operations

### P2 - Medium Priority (Recommended Enhancements)

7. **Adaptive Burn**: Scale burn with pool size and denomination
8. **Group Size Privacy**: Uniform or randomized group sizes to prevent fingerprinting

---

## Architectural Recommendations for Re-Implementation

### 1. Privacy-First Design

The new implementation should treat privacy as a first-class requirement, not an optional feature:

```typescript
interface SwapSigPrivacyConfig {
  // Network layer
  requireAnonymousTransport: boolean // Default: true
  allowedTransports: TransportType[]

  // Timing
  mandatoryTimingObfuscation: boolean // Default: true
  broadcastWindowMinutes: number

  // On-chain
  stealthBurnEnabled: boolean // Default: true
  noProtocolIdentifiers: boolean // Default: true

  // Coordination
  blindCoordinatorMode: boolean // Default: true
  thresholdReveal: boolean // Default: true
}
```

### 2. Layered Security Model

```
Layer 1: Cryptographic Security (MuSig2)
  └── Inherited from existing implementation ✅

Layer 2: Protocol Security (SwapSig)
  └── Destination commitments, burn verification, coordinator election

Layer 3: Network Security (P2P)
  └── Anonymous transport, timing obfuscation, traffic analysis resistance

Layer 4: On-Chain Privacy (Blockchain)
  └── Stealth burns, no protocol fingerprints, timing decorrelation
```

### 3. Threat Model Expansion

The current threat model should be expanded to include:

- **State-level adversaries** with ISP access
- **Chain analysis firms** with blockchain-wide visibility
- **Colluding participants** (not just single malicious actor)
- **Long-term correlation attacks** (historical analysis)

---

## Conclusion

The SwapSig protocol specification provides a strong foundation for privacy-preserving swaps, but contains several critical gaps that would undermine its privacy guarantees in practice. The re-implementation must address these gaps, particularly:

1. **On-chain fingerprinting** via burn outputs
2. **DHT-based deanonymization** via pool announcements
3. **Destination leakage** via weak commitment scheme
4. **Timing correlation** via synchronized broadcasts

With these fixes, SwapSig can achieve its goal of CoinJoin-equivalent privacy with perfect on-chain stealth.

---

**Document Version**: 1.0  
**Last Updated**: November 28, 2025  
**Status**: Critical Review Complete  
**Next Steps**: Implement fixes in new SwapSig architecture
