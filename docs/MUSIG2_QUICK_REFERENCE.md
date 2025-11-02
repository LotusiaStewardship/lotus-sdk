# MuSig2 Quick Reference for lotus-lib

**TL;DR**: MuSig2 implementation with P2P three-phase coordination architecture for decentralized peer discovery and dynamic session building.

---

## P2P Coordination (Three-Phase Architecture)

### Quick Start

```typescript
import { MuSig2P2PCoordinator } from 'lotus-lib/p2p/musig2'

// Create coordinator
const coordinator = new MuSig2P2PCoordinator({
  listen: ['/ip4/0.0.0.0/tcp/4001'],
  enableDHT: true,
})

await coordinator.start()

// Phase 0: Advertise availability
await coordinator.advertiseSigner(myPrivateKey, {
  transactionTypes: ['spend', 'swap'],
  minAmount: 1_000_000, // 1 XPI
  maxAmount: 100_000_000, // 100 XPI
})

// Phase 1: Discover signers
const signers = await coordinator.findAvailableSigners({
  transactionType: 'spend',
  maxAmount: 5_000_000,
})

// Phase 2: Create signing request (3-of-3 MuSig2)
const requestId = await coordinator.announceSigningRequest(
  [myKey, signer1.publicKey, signer2.publicKey],
  transactionSighash,
  myPrivateKey,
)

// Phase 3: Join request (as participant)
const requests = await coordinator.findSigningRequestsForMe(myPublicKey)
await coordinator.joinSigningRequest(requestId, myPrivateKey)

// Session auto-created when ALL participants join (n-of-n)
coordinator.on('session:ready', sessionId => {
  // Ready for MuSig2 signing protocol
})
```

**See [P2P_DHT_ARCHITECTURE.md](P2P_DHT_ARCHITECTURE.md) for complete details**

---

## What Needs to Be Built

### 1. Core Module (`lib/bitcore/crypto/musig2.ts`) - ~800 lines

**Key Functions**:

- `musigKeyAgg()` - Aggregate multiple public keys
- `musigNonceGen()` - Generate secret/public nonce pairs
- `musigNonceAgg()` - Aggregate public nonces from all signers
- `musigPartialSign()` - Create partial signature
- `musigPartialSigVerify()` - Verify a partial signature
- `musigSigAgg()` - Combine partial signatures into final signature

### 2. Session Manager (`lib/bitcore/crypto/musig2-session.ts`) - ~600 lines

**Purpose**: Track multi-party signing state

- Nonce exchange coordination
- Partial signature collection
- Session validation

### 3. Taproot Integration (`lib/bitcore/taproot-musig.ts`) - ~400 lines

**Purpose**: Connect MuSig2 with Taproot

- MuSig2 key as Taproot internal key
- Tweak handling for aggregated keys
- Transaction signing integration

### 4. Transaction Input (`lib/bitcore/transaction/musig-taproot-input.ts`) - ~300 lines

**Purpose**: New input type for MuSig2 Taproot

- Extends TaprootInput
- Manages signing session
- Coordinates multi-party signing

---

## Key Algorithms

### Algorithm 1: Key Aggregation

```
Input: Public keys [P₁, P₂, ..., Pₙ] (33-byte compressed)

1. Compute L = H(P₁ || P₂ || ... || Pₙ)
2. For each i:
   aᵢ = H(L || Pᵢ)
3. Q = Σ(aᵢ · Pᵢ)

Output: Aggregated key Q
```

### Algorithm 2: Nonce Generation

```
Input: Private key x, aggregated key Q, message m

1. Generate random k₁, k₂ (32 bytes each)
2. R₁ = k₁ · G
3. R₂ = k₂ · G

Output: Secret nonces (k₁, k₂), Public nonces (R₁, R₂)
```

### Algorithm 3: Partial Signature

```
Input: Secret nonce (k₁, k₂), private key x, message m

1. Compute b = H(Q || R₁_agg || R₂_agg || m)
2. Compute k = k₁ + b·k₂ (mod n)
3. Compute R = R₁_agg + b·R₂_agg
4. Compute e = H(R.x || compressed(Q) || m)  [Lotus format!]
5. Compute sᵢ = k + e·aᵢ·x (mod n)

Output: Partial signature sᵢ
```

### Algorithm 4: Signature Aggregation

```
Input: Partial signatures [s₁, s₂, ..., sₙ], aggregated R

1. s = Σ(sᵢ) mod n
2. Signature = (R.x, s)

Output: 64-byte Schnorr signature
```

---

## Critical Lotus-Specific Adaptations

### 1. Challenge Hash Format

**BIP340**:

```typescript
e = Hash(R.x || P.x || m) // 32 + 32 + 32 = 96 bytes
```

**Lotus** (REQUIRED):

```typescript
e = Hash(R.x || compressed(P) || m) // 32 + 33 + 32 = 97 bytes
```

### 2. Public Key Format

**BIP340**: 32-byte x-only keys  
**Lotus**: 33-byte compressed keys (0x02 or 0x03 prefix)

### 3. Nonce Quadratic Residue

**Lotus** requires checking if R.y is a quadratic residue and negating k if not. This adds complexity to MuSig2:

```typescript
// After aggregating nonces
if (!R.hasSquare()) {
  // Need to negate all k values
  // This requires coordination!
}
```

---

## File Structure

```
lotus-lib/
├── lib/bitcore/
│   ├── crypto/
│   │   ├── musig2.ts          ← NEW: Core MuSig2 functions
│   │   ├── musig2-session.ts  ← NEW: Session management
│   │   └── schnorr.ts         ← EXISTS: Used for final verification
│   ├── taproot.ts             ← UPDATE: Add MuSig2 helpers
│   ├── taproot-musig.ts       ← NEW: MuSig2 + Taproot integration
│   └── transaction/
│       ├── input.ts           ← UPDATE: Export new input type
│       └── musig-taproot-input.ts  ← NEW: MuSig2 input type
├── docs/
│   ├── MUSIG2_IMPLEMENTATION_PLAN.md  ← EXISTS: Full spec
│   ├── MUSIG2_QUICK_REFERENCE.md      ← THIS FILE
│   ├── MUSIG2_API.md          ← TODO: API reference
│   └── MUSIG2_EXAMPLES.md     ← TODO: Usage examples
└── examples/
    ├── musig2-simple.ts       ← TODO: Basic 2-of-2 example
    ├── musig2-taproot.ts      ← TODO: Taproot integration
    └── musig2-lightning.ts    ← TODO: Lightning-style channel
```

---

## Dependencies Matrix

| Feature             | Requires          | Status           |
| ------------------- | ----------------- | ---------------- |
| Key Aggregation     | Point, BN, Hash   | ✅ Available     |
| Nonce Generation    | Point, BN, Random | ✅ Available     |
| Partial Signing     | Schnorr, BN       | ✅ Available     |
| Session Management  | None              | ❌ Need to build |
| Taproot Integration | tweakPublicKey()  | ✅ Available     |
| Transaction Signing | TaprootInput      | ✅ Available     |

**Summary**: 90% of dependencies already exist in lotus-lib!

---

## Implementation Checklist

### Phase 1: Core Cryptography ⏳

- [ ] Create `lib/bitcore/crypto/musig2.ts`
- [ ] Implement `musigKeyAgg()`
- [ ] Implement `musigNonceGen()`
- [ ] Implement `musigNonceAgg()`
- [ ] Implement `musigPartialSign()`
- [ ] Implement `musigPartialSigVerify()`
- [ ] Implement `musigSigAgg()`
- [ ] Write unit tests for each function
- [ ] Test against BIP327 vectors (adapted)

### Phase 2: Session Management ⏳

- [ ] Create `lib/bitcore/crypto/musig2-session.ts`
- [ ] Define `MuSigSession` interface
- [ ] Implement `MuSigSessionManager` class
- [ ] Add nonce tracking
- [ ] Add partial signature tracking
- [ ] Write integration tests

### Phase 3: Taproot Integration ⏳

- [ ] Create `lib/bitcore/taproot-musig.ts`
- [ ] Implement `buildMuSigTaprootKey()`
- [ ] Implement `signTaprootWithMuSig2()`
- [ ] Add Taproot tweak handling
- [ ] Write Taproot + MuSig2 tests

### Phase 4: Transaction Integration ⏳

- [ ] Create `lib/bitcore/transaction/musig-taproot-input.ts`
- [ ] Implement `MuSigTaprootInput` class
- [ ] Update exports in `input.ts`
- [ ] Write transaction signing tests
- [ ] Test complete flow

### Phase 5: Documentation & Examples ⏳

- [ ] Write API documentation
- [ ] Create usage examples
- [ ] Document security considerations
- [ ] Create migration guide

---

## Estimated Effort

| Phase                 | Lines of Code | Time Estimate |
| --------------------- | ------------- | ------------- |
| Phase 1: Core         | ~800          | 1 week        |
| Phase 2: Sessions     | ~600          | 3-4 days      |
| Phase 3: Taproot      | ~400          | 3-4 days      |
| Phase 4: Transactions | ~300          | 2-3 days      |
| Phase 5: Docs         | ~2000         | 3-4 days      |
| **Total**             | **~4100**     | **3-4 weeks** |

---

## Code Size Comparison

**Existing lotus-lib Taproot**:

- `taproot.ts`: 542 lines
- `taproot-input.ts`: 222 lines
- Docs: ~2400 lines
- Examples: ~500 lines
- **Total**: ~3700 lines

**Proposed MuSig2**:

- Core module: ~800 lines
- Session manager: ~600 lines
- Taproot integration: ~400 lines
- Transaction input: ~300 lines
- Docs: ~2000 lines
- Examples: ~500 lines
- **Total**: ~4600 lines

**Similar scope to existing Taproot implementation!**

---

## Quick Start for Implementation

### Step 1: Create Core Module Structure

```bash
touch lib/bitcore/crypto/musig2.ts
```

### Step 2: Add Basic Exports

```typescript
// lib/bitcore/crypto/musig2.ts
import { PublicKey } from '../publickey.js'
import { PrivateKey } from '../privatekey.js'
import { Point } from './point.js'
import { BN } from './bn.js'
import { Hash } from './hash.js'

export interface MuSigKeyAggContext {
  pubkeys: PublicKey[]
  keyAggCoeff: Map<number, BN>
  aggregatedPubKey: PublicKey
}

export interface MuSigNonce {
  secretNonces: [BN, BN]
  publicNonces: [Point, Point]
}

// TODO: Implement functions
export function musigKeyAgg(pubkeys: PublicKey[]): MuSigKeyAggContext {
  throw new Error('Not implemented')
}

// ... more functions
```

### Step 3: Write First Test

```typescript
// test/crypto/musig2.test.ts
import { musigKeyAgg } from '../../lib/bitcore/crypto/musig2.js'
import { PrivateKey } from '../../lib/bitcore/privatekey.js'

describe('MuSig2', () => {
  it('should aggregate 2 keys', () => {
    const key1 = new PrivateKey()
    const key2 = new PrivateKey()

    const ctx = musigKeyAgg([key1.publicKey, key2.publicKey])

    expect(ctx.pubkeys.length).toBe(2)
    expect(ctx.aggregatedPubKey).toBeDefined()
  })
})
```

### Step 4: Implement First Function

Start with `musigKeyAgg()` - it's the foundation!

---

## Common Pitfalls to Avoid

### ❌ Don't Use BIP340 Format

```typescript
// WRONG - This is BIP340, not Lotus!
const e = Hash.sha256(
  Buffer.concat([
    R.getX().toBuffer(), // 32 bytes
    Q.getX().toBuffer(), // 32 bytes - WRONG!
    message,
  ]),
)
```

```typescript
// CORRECT - This is Lotus Schnorr
const e = Hash.sha256(
  Buffer.concat([
    R.getX().toArrayLike(Buffer, 'be', 32), // 32 bytes
    Point.pointToCompressed(Q.point), // 33 bytes - CORRECT!
    message,
  ]),
)
```

### ❌ Don't Forget Nonce Negation

```typescript
// WRONG - Ignoring quadratic residue check
const R = R1_agg.add(R2_agg.mul(b))
// Use R directly - MIGHT BE INVALID!
```

```typescript
// CORRECT - Check and handle negation
const R = R1_agg.add(R2_agg.mul(b))
if (!R.hasSquare()) {
  // Need to coordinate negation with all signers!
}
```

### ❌ Don't Reuse Nonces

```typescript
// CATASTROPHIC - Reusing nonces
const nonce = musigNonceGen(...)
musigPartialSign(nonce, ...)  // First use
musigPartialSign(nonce, ...)  // REUSE = PRIVATE KEY LEAKED!
```

```typescript
// CORRECT - New nonce per message
const nonce1 = musigNonceGen(...)
musigPartialSign(nonce1, message1, ...)

const nonce2 = musigNonceGen(...)  // NEW nonce
musigPartialSign(nonce2, message2, ...)
```

---

## Testing Strategy

### Unit Tests (~20 tests)

```
✓ Key aggregation with 2 keys
✓ Key aggregation with N keys
✓ Key ordering is deterministic
✓ Nonce generation is random
✓ Nonce aggregation is correct
✓ Partial signature creation
✓ Partial signature verification
✓ Invalid partial signature rejected
✓ Signature aggregation (2 signers)
✓ Signature aggregation (N signers)
✓ Final signature verifies
```

### Integration Tests (~10 tests)

```
✓ Complete 2-of-2 MuSig2 flow
✓ Complete 3-of-3 MuSig2 flow
✓ MuSig2 with Taproot key path
✓ MuSig2 Taproot transaction
✓ Mixed MuSig2 and regular inputs
```

### Cross-Validation Tests (~5 tests)

```
⏳ Against lotusd (when available)
⏳ Against BIP327 vectors (adapted)
⏳ Interop with other implementations
```

---

## Resources

### Specifications

- **BIP327**: https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki
- **BIP340**: https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki
- **Lotus Docs**: https://lotusia.org/docs

### Reference Implementations

- **libsecp256k1-zkp**: https://github.com/ElementsProject/secp256k1-zkp
- **BIP327 test vectors**: https://github.com/bitcoin/bips/blob/master/bip-0327/vectors

### Existing Code to Reference

- `lib/bitcore/crypto/schnorr.ts` - Lotus Schnorr implementation
- `lib/bitcore/taproot.ts` - Taproot implementation
- `lib/bitcore/transaction/taproot-input.ts` - Taproot signing

---

## Summary

**What**: Implement MuSig2 multi-signature scheme adapted for Lotus Schnorr

**Why**:

- Enable private multi-sig via Taproot
- Reduce transaction size/fees by 50-90%
- Support Lightning and advanced protocols

**How**:

- ~4100 lines of TypeScript across 5-6 files
- Adapt BIP327 to Lotus Schnorr format
- 3-4 weeks of development time

**Next**: Begin Phase 1 by implementing `musigKeyAgg()` in `lib/bitcore/crypto/musig2.ts`

---

**Status**: ✅ Ready to start  
**Difficulty**: Medium-High (requires crypto expertise)  
**Priority**: High (significant ecosystem value)
