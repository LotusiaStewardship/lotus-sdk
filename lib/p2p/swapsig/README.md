# SwapSig Protocol Implementation

**Version**: 1.0 (Base Implementation)  
**Status**: Core protocol structure complete, transaction building pending

---

## Architecture Overview

SwapSig is a **MuSig2 P2P application** that extends `MuSig2P2PCoordinator` to provide CoinJoin-equivalent privacy using multi-signatures.

### Key Design Decision

**`SwapSigCoordinator extends MuSig2P2PCoordinator`**

This inheritance structure reflects the reality that SwapSig IS a MuSig2 P2P application, not just a consumer of one. This provides:

- ✅ Direct access to all P2P methods (`this.advertiseSigner()`, `this.announceResource()`, etc.)
- ✅ Access to `this.libp2pNode` for peer ID and network operations
- ✅ Automatic event handling from parent MuSig2 events
- ✅ Cleaner code without delegation through a private field
- ✅ Proper protocol layering (SwapSig builds ON TOP of MuSig2)

---

## Implemented Components

### 1. Type Definitions (`types.ts`)

Complete type system for SwapSig protocol:

- **`SwapPhase`**: State machine for pool lifecycle
- **`SwapPool`**: Complete pool state
- **`SwapParticipant`**: Participant data and commitments
- **`SharedOutput`**: MuSig2 shared outputs from Round 1
- **`SettlementInfo`**: Settlement mapping (who receives from which output)
- **`BurnConfig`**: XPI burn configuration for Sybil defense
- **`GroupSizeStrategy`**: Dynamic group sizing (2, 3, 5, or 10-of-n)

### 2. Pool Manager (`pool.ts`)

Manages pool state and participant registration:

- **Pool creation** with configurable parameters
- **Participant registration** with ownership proofs
- **Phase transitions** (discovery → registration → setup → ... → complete)
- **Dynamic group sizing** algorithm:
  - 3-9 participants → 2-of-2
  - 10-14 participants → 3-of-3
  - 15-49 participants → 5-of-5 (SWEET SPOT)
  - 50+ participants → 10-of-10
- **Pool statistics** and health monitoring

### 3. Burn Mechanism (`burn.ts`)

XPI burn-based Sybil defense:

- **Burn amount calculation** (0.1% default, clamped to min/max)
- **OP_RETURN output creation** with pool ID
- **Burn validation** in setup transactions
- **Economic cost calculator** for Sybil attacks

### 4. SwapSig Coordinator (`coordinator.ts`)

Main protocol coordinator extending `MuSig2P2PCoordinator`:

**Core Methods:**

- `createPool()` - Create new swap pool
- `joinPool()` - Join existing pool
- `executeSwap()` - Full swap execution (convenience method)
- `discoverPools()` - Find available pools via DHT

**Three-Phase Integration:**

- Listens for `'signing-request:received'` events
- Automatically joins requests for SwapSig settlements
- Coordinates MuSig2 sessions for shared output spending

**Protocol Phases** (partially implemented):

- ✅ Phase 0: Discovery & Pool Formation
- ✅ Phase 1: Registration
- 🔶 Phase 2: Setup Round (Round 1) - TODO
- 🔶 Phase 3: Setup Confirmation - TODO
- 🔶 Phase 4: Destination Reveal - TODO
- 🔶 Phase 5: Settlement Round (Round 2) - TODO
- 🔶 Phase 6: Settlement Confirmation - TODO
- 🔶 Phase 7: Completion - TODO

---

## Usage Example

```typescript
import { SwapSigCoordinator } from 'lotus-lib/lib/p2p/swapsig'
import { PrivateKey } from 'lotus-lib/lib/bitcore'

// Create coordinator (extends MuSig2P2PCoordinator - IS-A relationship!)
const privateKey = new PrivateKey()
const coordinator = new SwapSigCoordinator(
  privateKey,
  {
    // P2P config (passed to parent)
    listen: ['/ip4/0.0.0.0/tcp/4001'],
    enableDHT: true,
    enableDHTServer: true,
  },
  {
    // MuSig2 config (passed to parent)
    enableSessionDiscovery: true,
  },
  {
    // SwapSig-specific config
    minParticipants: 3,
    maxParticipants: 10,
    feeRate: 1,
  },
)

// Start coordinator (starts parent MuSig2P2PCoordinator)
await coordinator.start()

// Create pool
const poolId = await coordinator.createPool({
  denomination: 1_000_000, // 1 XPI
  minParticipants: 3,
  maxParticipants: 10,
  burnPercentage: 0.001, // 0.1%
})

// Or join existing pool
await coordinator.joinPool(poolId, myInput, myFinalAddress)

// Execute full swap
const txId = await coordinator.executeSwap(poolId, myInput, myFinalAddress)

// Access parent MuSig2 methods directly!
const signers = await coordinator.findAvailableSigners({
  transactionType: 'swap',
  minAmount: 100_000_000,
})
```

---

## Implementation Status

### ✅ Complete

1. **Type System** - All interfaces defined
2. **Pool Manager** - Full state management
3. **Burn Mechanism** - Sybil defense implementation
4. **Coordinator Structure** - Extends MuSig2P2PCoordinator properly
5. **Event Handlers** - Three-phase integration
6. **Pool Discovery** - DHT and P2P announcements
7. **Participant Registration** - Ownership proofs and commitments

### 🔶 TODO (Next Steps)

1. **Transaction Building** (`_executeSetupRound`):
   - Build setup transactions (input → MuSig2 shared output + burn)
   - Generate MuSig2 aggregated keys
   - Create Lotus Taproot addresses
   - Add burn outputs

2. **Blockchain Integration** (`_waitForSetupConfirmations`):
   - Monitor blockchain for confirmations
   - Verify burn outputs
   - Transition phases based on confirmations

3. **Destination Reveal** (`_revealFinalDestinations`):
   - Decrypt final addresses
   - Broadcast reveals to participants
   - Verify commitments

4. **Settlement Round** (`_executeSettlementRound`):
   - Build settlement transactions
   - Announce signing requests (Phase 2)
   - Wait for participants to join (Phase 3)
   - Execute MuSig2 rounds
   - Broadcast settlement transactions

5. **Testing**:
   - Unit tests for all components
   - Integration tests (3-party, 5-party swaps)
   - Dynamic group sizing tests

---

## Architecture Benefits

### Extending MuSig2P2PCoordinator

```typescript
// BEFORE: Delegation pattern (wrapper)
class SwapSigCoordinator extends EventEmitter {
  private p2pCoordinator: MuSig2P2PCoordinator  // ❌ Delegation/composition

  async joinPool(...) {
    await this.p2pCoordinator.advertiseSigner(...)  // ❌ Verbose delegation
    const node = this.p2pCoordinator.getNode()       // ❌ Indirect access
    await this.p2pCoordinator.announceResource(...) // ❌ Wrapping every call
  }
}

// AFTER: Inheritance pattern (extends)
class SwapSigCoordinator extends MuSig2P2PCoordinator {  // ✅ IS-A relationship

  async joinPool(...) {
    await this.advertiseSigner(...)       // ✅ Direct access to MuSig2 methods
    const peerId = this.libp2pNode.peerId // ✅ Direct access to P2P node
    await this.announceResource(...)      // ✅ Direct DHT operations
  }
}
```

**Why This Is Correct:**

SwapSig **IS** a MuSig2 P2P application, not just a consumer of one:

- ✅ Uses MuSig2 for shared output signing
- ✅ Uses DHT for pool discovery
- ✅ Uses three-phase architecture for coordination
- ✅ Integrates directly with MuSig2 sessions
- ✅ Emits both MuSig2 and SwapSig events

**Benefits:**

1. **Proper Type Safety**: Interface declaration merging provides typed events
2. **Direct Access**: No delegation boilerplate
3. **Clean Code**: Less verbose, more readable
4. **Correct Semantics**: Models the actual relationship properly
5. **Full P2P Access**: Can use all MuSig2 and P2P methods directly

---

## References

- **Architecture**: [SWAPSIG_ARCHITECTURE.md](../../../docs/SWAPSIG_ARCHITECTURE.md)
- **Protocol Spec**: [SWAPSIG_PROTOCOL.md](../../../docs/SWAPSIG_PROTOCOL.md)
- **MuSig2 P2P**: [P2P_DHT_ARCHITECTURE.md](../../../docs/P2P_DHT_ARCHITECTURE.md)
- **Three-Phase Architecture**: Phase 0 (signer ads) → Phase 2 (signing requests) → Phase 3 (dynamic sessions)

---

**Next**: Implement transaction building and blockchain integration to complete the protocol.
