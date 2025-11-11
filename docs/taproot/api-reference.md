# Taproot API Reference

**Your Complete Guide to Taproot in lotus-lib**

Welcome! This is your one-stop reference for building with Taproot on Lotus. Whether you're creating NFTs, implementing multi-sig wallets, or building advanced smart contracts, you'll find everything you need here.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Core Functions](#core-functions)
  - [Script Building](#script-building)
  - [Key Tweaking](#key-tweaking)
  - [Hashing](#hashing)
  - [Tree Building](#tree-building)
  - [Verification](#verification)
- [Classes](#classes)
  - [NFT](#nft-class)
  - [NFTUtil](#nftutil-class)
  - [TaprootInput](#taprootinput-class)
- [MuSig2 Integration](#musig2-integration)
  - [High-Level API](#high-level-api)
  - [MuSig2Signer Class](#musig2signer-class)
  - [Session-Based Signing](#session-based-signing)
  - [Low-Level Taproot Functions](#low-level-taproot-functions)
- [Types & Interfaces](#types--interfaces)
- [Constants](#constants)
- [Transaction Integration](#transaction-integration)
- [Address Support](#address-support)
- [Common Patterns](#common-patterns)
- [Error Handling](#error-handling)
- [Type Guards](#type-guards)
- [Advanced Functions](#advanced-functions)

---

## Quick Start

### Installation

```bash
npm install lotus-lib
```

### 30-Second Example

```typescript
import {
  Transaction,
  PrivateKey,
  Signature,
  buildKeyPathTaproot,
} from 'lotus-lib'

// Create Taproot output
const privateKey = new PrivateKey()
const taprootScript = buildKeyPathTaproot(privateKey.publicKey)

// Spend it
const tx = new Transaction()
  .from({
    txId: 'previous_tx',
    outputIndex: 0,
    script: taprootScript,
    satoshis: 100000,
  })
  .to('lotus:qz...recipient', 95000)
  .sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'schnorr')
```

**Remember**: Taproot key path spending requires:

1. ✅ `SIGHASH_LOTUS` (not `SIGHASH_FORKID`)
2. ✅ Schnorr signatures (not ECDSA)
3. ✅ Full UTXO information

---

## Core Functions

### Script Building

#### `buildKeyPathTaproot()`

Create a simple key-path-only Taproot output. This is the most common and private way to use Taproot.

```typescript
function buildKeyPathTaproot(internalPubKey: PublicKey, state?: Buffer): Script
```

**Parameters:**

- `internalPubKey` - The public key for spending (will be tweaked)
- `state` - Optional 32-byte state data (used for NFTs, contracts, etc.)

**Returns:** Taproot script (36 bytes without state, 69 bytes with state)

**Algorithm:**

1. Computes merkle root as 32 zero bytes (key-only, no scripts)
2. Calculates tweak: `tagged_hash("TapTweak", internal_pubkey || merkle_root)`
3. Tweaks public key: `commitment = internal_pubkey + tweak × G`
4. Builds script: `OP_SCRIPTTYPE OP_1 <33-byte commitment> [<32-byte state>]`

**Important:** For key path spending, the state parameter does NOT affect address derivation. Multiple outputs with the same commitment but different states will have the same address.

**Example:**

```typescript
import { buildKeyPathTaproot, PrivateKey } from 'lotus-lib'

const privateKey = new PrivateKey()
const taprootScript = buildKeyPathTaproot(privateKey.publicKey)

console.log('Script ASM:', taprootScript.toASM())
// Output: OP_SCRIPTTYPE OP_1 <33-byte commitment>
```

**With State (for NFTs):**

```typescript
const metadata = { name: 'My NFT', image: 'ipfs://...' }
const metadataHash = Hash.sha256(Buffer.from(JSON.stringify(metadata)))
const nftScript = buildKeyPathTaproot(privateKey.publicKey, metadataHash)
```

---

#### `buildScriptPathTaproot()`

Create a Taproot output with alternative spending conditions in a script tree.

```typescript
function buildScriptPathTaproot(
  internalPubKey: PublicKey,
  tree: TapNode,
  state?: Buffer,
): {
  script: Script
  commitment: PublicKey
  merkleRoot: Buffer
  leaves: TapLeaf[]
}
```

**Parameters:**

- `internalPubKey` - Internal public key (for key path)
- `tree` - Script tree structure (see [Tree Building](#tree-building))
- `state` - Optional 32-byte state

**Returns:** Object with script, commitment, merkle root, and leaf information

**Example:**

```typescript
import { buildScriptPathTaproot, Script, Opcode } from 'lotus-lib'

// Create timelock script
const timelockScript = new Script()
  .add(720) // ~24 hours at 2 min/block
  .add(Opcode.OP_CHECKLOCKTIMEVERIFY)
  .add(Opcode.OP_DROP)
  .add(publicKey.toBuffer())
  .add(Opcode.OP_CHECKSIG)

// Simple tree with one leaf
const tree = {
  script: timelockScript,
}

const result = buildScriptPathTaproot(publicKey, tree)

console.log('Merkle root:', result.merkleRoot.toString('hex'))
console.log('Leaves:', result.leaves.length)
```

**Multi-Script Tree:**

```typescript
// Tree with multiple spending conditions
const tree = {
  left: { script: immediateScript },
  right: {
    left: { script: timelockScript1 },
    right: { script: timelockScript2 },
  },
}

const result = buildScriptPathTaproot(publicKey, tree)
// Creates 3 alternative spending paths
```

---

#### `buildPayToTaproot()`

Low-level function to create a P2TR script from a commitment public key.

```typescript
function buildPayToTaproot(commitment: PublicKey, state?: Buffer): Script
```

**Parameters:**

- `commitment` - The tweaked public key (commitment), 33 bytes
- `state` - Optional 32-byte state data

**Returns:** P2TR script (36 bytes without state, 69 bytes with state)

**Output Format:**

- Without state: `OP_SCRIPTTYPE OP_1 0x21 <33-byte commitment>`
- With state: `OP_SCRIPTTYPE OP_1 0x21 <33-byte commitment> 0x20 <32-byte state>`

**Validation:**

- Commitment must be exactly 33 bytes (compressed public key format)
- State must be exactly 32 bytes if provided
- Throws error if size requirements not met

**When to use:** When you've already computed the commitment yourself. Most developers should use `buildKeyPathTaproot()` or `buildScriptPathTaproot()` instead.

**Example:**

```typescript
import { buildPayToTaproot, tweakPublicKey } from 'lotus-lib'

const internalPubKey = privateKey.publicKey
const merkleRoot = Buffer.alloc(32)
const commitment = tweakPublicKey(internalPubKey, merkleRoot)

// Without state
const script = buildPayToTaproot(commitment)
console.log('Size:', script.toBuffer().length) // 36 bytes

// With state (e.g., NFT metadata hash)
const metadataHash = Hash.sha256(Buffer.from(JSON.stringify(metadata)))
const nftScript = buildPayToTaproot(commitment, metadataHash)
console.log('Size:', nftScript.toBuffer().length) // 69 bytes
```

---

### Key Tweaking

#### `tweakPublicKey()`

Tweak a public key for Taproot commitment.

```typescript
function tweakPublicKey(
  internalPubKey: PublicKey,
  merkleRoot?: Buffer,
): PublicKey
```

**Parameters:**

- `internalPubKey` - The internal public key
- `merkleRoot` - 32-byte merkle root (defaults to all zeros for key-only)

**Returns:** Tweaked public key (commitment)

**Algorithm:**

```
tweak = tagged_hash("TapTweak", internal_pubkey || merkle_root)
commitment = internal_pubkey + tweak * G
```

**Example:**

```typescript
import { tweakPublicKey, PrivateKey } from 'lotus-lib'

const privateKey = new PrivateKey()
const internalPubKey = privateKey.publicKey

// Key-path only (no scripts)
const commitment = tweakPublicKey(internalPubKey, Buffer.alloc(32))

console.log('Internal:', internalPubKey.toString())
console.log('Commitment:', commitment.toString())
```

---

#### `tweakPrivateKey()`

Tweak a private key for Taproot spending.

```typescript
function tweakPrivateKey(
  internalPrivKey: PrivateKey,
  merkleRoot?: Buffer,
): PrivateKey
```

**Parameters:**

- `internalPrivKey` - The internal private key
- `merkleRoot` - 32-byte merkle root (defaults to all zeros)

**Returns:** Tweaked private key

**Algorithm:**

```
tweak = tagged_hash("TapTweak", internal_pubkey || merkle_root)
tweaked_privkey = (internal_privkey + tweak) mod n
```

**Example:**

```typescript
import { tweakPrivateKey, PrivateKey } from 'lotus-lib'

const privateKey = new PrivateKey()
const merkleRoot = Buffer.alloc(32) // Key-only

const tweakedPrivKey = tweakPrivateKey(privateKey, merkleRoot)

// Use tweakedPrivKey for signing
```

**Note:** When using `Transaction.sign()` with Taproot inputs, tweaking is handled automatically. You only need this for manual signing.

---

#### `calculateTapTweak()`

Calculate the tweak value (without applying it).

```typescript
function calculateTapTweak(
  internalPubKey: PublicKey,
  merkleRoot?: Buffer,
): Buffer
```

**Parameters:**

- `internalPubKey` - Internal public key
- `merkleRoot` - 32-byte merkle root (defaults to all zeros)

**Returns:** 32-byte tweak value

**When to use:** Advanced scenarios where you need the raw tweak value (e.g., MuSig2 integration).

---

### Hashing

#### `taggedHash()`

BIP340-style tagged hashing for Taproot.

```typescript
function taggedHash(tag: string, data: Buffer): Buffer
```

**Parameters:**

- `tag` - Tag string (e.g., "TapTweak", "TapLeaf", "TapBranch")
- `data` - Data to hash

**Returns:** 32-byte hash

**Algorithm:**

```
tag_hash = SHA256(tag)
tagged_hash = SHA256(tag_hash || tag_hash || data)
```

**Example:**

```typescript
import { taggedHash } from 'lotus-lib'

const data = Buffer.from('hello taproot', 'utf8')
const hash = taggedHash('CustomTag', data)

console.log('Tagged hash:', hash.toString('hex'))
```

**Standard Tags:**

- `TapTweak` - For tweaking internal keys
- `TapLeaf` - For hashing individual scripts
- `TapBranch` - For combining merkle branches

---

#### `calculateTapLeaf()`

Hash a tapscript leaf.

```typescript
function calculateTapLeaf(script: Script | Buffer, leafVersion?: number): Buffer
```

**Parameters:**

- `script` - The tapscript
- `leafVersion` - Leaf version byte (default: 0xc0 for tapscript)

**Returns:** 32-byte leaf hash

**Algorithm:**

```
tapleaf_hash = tagged_hash("TapLeaf", leaf_version || compact_size(script) || script)
```

**Example:**

```typescript
import { calculateTapLeaf, Script, Opcode } from 'lotus-lib'

const script = new Script().add(publicKey.toBuffer()).add(Opcode.OP_CHECKSIG)

const leafHash = calculateTapLeaf(script)
console.log('Leaf hash:', leafHash.toString('hex'))
```

---

#### `calculateTapBranch()`

Combine two branch hashes into a parent hash.

```typescript
function calculateTapBranch(left: Buffer, right: Buffer): Buffer
```

**Parameters:**

- `left` - Left branch hash (32 bytes)
- `right` - Right branch hash (32 bytes)

**Returns:** 32-byte parent hash

**Algorithm:**

```
// Hashes are ordered lexicographically
(sorted_left, sorted_right) = sort([left, right])
tapbranch_hash = tagged_hash("TapBranch", sorted_left || sorted_right)
```

**Example:**

```typescript
import { calculateTapBranch, calculateTapLeaf } from 'lotus-lib'

const leaf1Hash = calculateTapLeaf(script1)
const leaf2Hash = calculateTapLeaf(script2)

const branchHash = calculateTapBranch(leaf1Hash, leaf2Hash)
console.log('Branch hash:', branchHash.toString('hex'))
```

---

### Tree Building

#### `buildTapTree()`

Build a complete Taproot script tree with merkle paths.

```typescript
function buildTapTree(tree: TapNode): TapTreeBuildResult

interface TapTreeBuildResult {
  merkleRoot: Buffer
  leaves: TapLeaf[]
}
```

**Parameters:**

- `tree` - Tree structure (leaf or branch nodes)

**Returns:** Object with merkle root and leaf information

**Example:**

```typescript
import { buildTapTree } from 'lotus-lib'

const tree = {
  left: { script: script1 },
  right: {
    left: { script: script2 },
    right: { script: script3 },
  },
}

const result = buildTapTree(tree)

console.log('Merkle root:', result.merkleRoot.toString('hex'))
console.log('Leaf count:', result.leaves.length)

result.leaves.forEach((leaf, i) => {
  console.log(`Leaf ${i}:`)
  console.log('  Script:', leaf.script.toString())
  console.log('  Hash:', leaf.leafHash.toString('hex'))
  console.log('  Path length:', leaf.merklePath.length)
})
```

**Tree Structure:**

```typescript
// Single leaf
const simpleTree = { script: myScript }

// Two leaves (branch)
const twoLeaves = {
  left: { script: script1 },
  right: { script: script2 },
}

// Complex tree
const complexTree = {
  left: {
    left: { script: script1 },
    right: { script: script2 },
  },
  right: {
    left: { script: script3 },
    right: { script: script4 },
  },
}
```

---

#### `createControlBlock()`

Create a control block for script path spending.

```typescript
function createControlBlock(
  internalPubKey: PublicKey,
  leafIndex: number,
  tree: TapNode,
): Buffer
```

**Parameters:**

- `internalPubKey` - Internal public key (33 bytes)
- `leafIndex` - Index of the leaf being spent (0-based)
- `tree` - Taproot tree structure

**Returns:** Control block buffer (33 + 32\*n bytes)

**Control Block Format:**

```
Byte 0:     (leaf_version & 0xfe) | parity_bit
Bytes 1-32: internal public key X-coordinate (32 bytes, without 0x02/0x03 prefix)
Bytes 33+:  merkle path (32 bytes per node, up to 128 nodes max)
```

**Format Details:**

- **Byte 0**: Upper 7 bits = leaf version (must be 0xc0), bit 0 = parity
- **Parity bit**: Indicates internal pubkey's Y-coordinate (0 = even, 1 = odd)
- **X-coordinate**: 32 bytes only (reconstructed to 33-byte compressed key using parity)
- **Merkle path**: Variable length, each node is 32 bytes
- **Size**: 33 + (32 × n) bytes where n ≤ 128

**Critical:** The control block contains the 32-byte X-coordinate of the **internal** pubkey, not the full 33-byte compressed key. The parity bit is used to reconstruct the prefix (0x02 for even, 0x03 for odd).

**Example:**

```typescript
import { createControlBlock } from 'lotus-lib'

const tree = {
  left: { script: script1 },
  right: { script: script2 },
}

// Create control block for spending script1 (leaf 0)
const controlBlock = createControlBlock(internalPubKey, 0, tree)

console.log('Control block size:', controlBlock.length)
// Output: 65 bytes (33 base + 32 merkle path)
```

---

### Verification

#### `isPayToTaproot()`

Check if a script is a valid Pay-To-Taproot script.

```typescript
function isPayToTaproot(script: Script): boolean
```

**Parameters:**

- `script` - Script to check

**Returns:** `true` if valid P2TR, `false` otherwise

**Valid Formats:**

- **Without state**: `OP_SCRIPTTYPE OP_1 0x21 <33-byte commitment>` (36 bytes)
- **With state**: `OP_SCRIPTTYPE OP_1 0x21 <33-byte commitment> 0x20 <32-byte state>` (69 bytes)

**Validation:**

- Bytes 0-1: Must be `0x62 0x51` (OP_SCRIPTTYPE OP_1)
- Byte 2: Must be `0x21` (push 33 bytes)
- Bytes 3-35: 33-byte compressed public key (commitment)
- Byte 36 (if present): Must be `0x20` (push 32 bytes)
- Bytes 37-68 (if present): 32-byte state data
- Size: Must be exactly 36 or 69 bytes (no other sizes allowed)

**Example:**

```typescript
import { isPayToTaproot, buildKeyPathTaproot } from 'lotus-lib'

const taprootScript = buildKeyPathTaproot(publicKey)
const regularScript = Script.buildPublicKeyHashOut(address)

console.log('Is P2TR:', isPayToTaproot(taprootScript)) // true
console.log('Is P2TR:', isPayToTaproot(regularScript)) // false
```

---

#### `extractTaprootCommitment()`

Extract the commitment public key from a Taproot script.

```typescript
function extractTaprootCommitment(script: Script): PublicKey
```

**Parameters:**

- `script` - P2TR script

**Returns:** The commitment public key (33 bytes)

**Throws:** Error if not a valid P2TR script

**Example:**

```typescript
import { extractTaprootCommitment, buildKeyPathTaproot } from 'lotus-lib'

const taprootScript = buildKeyPathTaproot(publicKey)
const commitment = extractTaprootCommitment(taprootScript)

console.log('Commitment:', commitment.toString())
```

---

#### `extractTaprootState()`

Extract the state parameter from a Taproot script (if present).

```typescript
function extractTaprootState(script: Script): Buffer | null
```

**Parameters:**

- `script` - P2TR script

**Returns:** 32-byte state buffer or `null` if no state

**Extraction Details:**

- Returns `null` for 36-byte outputs (no state)
- Returns 32-byte buffer for 69-byte outputs (with state)
- Extracts bytes 37-68 (skips byte 36 which is the 0x20 push opcode)

**Example:**

```typescript
import { extractTaprootState, buildKeyPathTaproot } from 'lotus-lib'

// Script with state
const metadataHash = Buffer.alloc(32, 0xff)
const nftScript = buildKeyPathTaproot(publicKey, metadataHash)
const state = extractTaprootState(nftScript)

console.log('Has state:', state !== null) // true
console.log('State:', state?.toString('hex'))

// Script without state
const plainScript = buildKeyPathTaproot(publicKey)
const plainState = extractTaprootState(plainScript)

console.log('Has state:', plainState !== null) // false
```

**Important:** When converting a Taproot script to an address and back, the state parameter is lost. Addresses encode only the commitment (33 bytes), not the full output script.

```typescript
const scriptWithState = buildKeyPathTaproot(pubkey, stateBuffer) // 69 bytes
const address = scriptWithState.toAddress()
const reconstructed = Script.fromAddress(address) // Only 36 bytes, state lost!

// To preserve state, store it separately:
const outputData = {
  address: scriptWithState.toAddress().toString(),
  state: extractTaprootState(scriptWithState)?.toString('hex'),
}
```

---

#### `verifyTaprootCommitment()`

Verify that a commitment matches an internal key and merkle root.

```typescript
function verifyTaprootCommitment(
  commitmentPubKey: PublicKey,
  internalPubKey: PublicKey,
  merkleRoot: Buffer,
): boolean
```

**Parameters:**

- `commitmentPubKey` - The commitment public key (from script)
- `internalPubKey` - The internal public key
- `merkleRoot` - The merkle root (32 bytes)

**Returns:** `true` if commitment is valid

**Algorithm:**

```
expected_commitment = internal_pubkey + tweak * G
valid = (commitment == expected_commitment)
```

**Example:**

```typescript
import {
  verifyTaprootCommitment,
  tweakPublicKey,
  extractTaprootCommitment,
} from 'lotus-lib'

const merkleRoot = Buffer.alloc(32)
const commitment = tweakPublicKey(internalPubKey, merkleRoot)

const script = buildKeyPathTaproot(internalPubKey)
const extractedCommitment = extractTaprootCommitment(script)

const isValid = verifyTaprootCommitment(
  extractedCommitment,
  internalPubKey,
  merkleRoot,
)

console.log('Valid commitment:', isValid) // true
```

---

#### `verifyTaprootScriptPath()`

Verify that a script is correctly committed in a Taproot output via merkle proof.

```typescript
function verifyTaprootScriptPath(
  internalPubKey: Buffer,
  script: Script,
  commitmentPubKey: Buffer,
  leafVersion: number,
  merklePath: Buffer[],
  parity: number,
): boolean
```

**Parameters:**

- `internalPubKey` - Internal public key X-coordinate (32 bytes, without 0x02/0x03 prefix)
- `script` - Script being revealed and verified
- `commitmentPubKey` - Commitment public key from scriptPubKey (33 bytes)
- `leafVersion` - Leaf version from control block (must be 0xc0)
- `merklePath` - Array of 32-byte merkle proof nodes
- `parity` - Parity bit from control block (0 = even Y, 1 = odd Y)

**Returns:** `true` if verification succeeds, `false` otherwise

**Algorithm:**

1. Reconstructs 33-byte compressed internal pubkey from x-coordinate + parity
2. Calculates leaf hash: `tagged_hash("TapLeaf", leaf_version || script_length || script)`
3. Walks merkle tree with lexicographic ordering
4. Computes expected commitment: `internal_pubkey + tagged_hash("TapTweak", internal_pubkey || merkle_root) × G`
5. Compares with actual commitment

**Example:**

```typescript
import { verifyTaprootScriptPath, createControlBlock } from 'lotus-lib'

// Extract data from control block
const controlBlock = createControlBlock(internalPubKey, 0, tree)
const parity = controlBlock[0] & 0x01
const internalPubKeyXCoord = controlBlock.slice(1, 33)
const merklePath = [] // Extract merkle proof nodes

const isValid = verifyTaprootScriptPath(
  internalPubKeyXCoord,
  script,
  commitmentPubKey,
  0xc0,
  merklePath,
  parity,
)

console.log('Script path valid:', isValid)
```

---

#### `verifyTaprootSpend()`

Main verification function for Taproot spending (handles both key path and script path).

```typescript
function verifyTaprootSpend(
  scriptPubkey: Script,
  stack: Buffer[],
  flags: number,
): TaprootVerifyResult

interface TaprootVerifyResult {
  success: boolean
  error?: string
  scriptToExecute?: Script
  stack?: Buffer[]
}
```

**Parameters:**

- `scriptPubkey` - The Taproot scriptPubKey being spent
- `stack` - Stack from scriptSig execution
- `flags` - Script verification flags

**Returns:** Verification result with success status, optional error message, and script/stack for execution

**Verification Logic:**

- **Stack size = 1**: Key path spending (signature only)
- **Stack size ≥ 2**: Script path spending (script + control block + data)

**Checks Performed:**

1. Taproot not disabled (SCRIPT_DISABLE_TAPROOT_SIGHASH_LOTUS flag)
2. Valid P2TR scriptPubKey format
3. Stack not empty
4. No annex element (0x50 prefix not supported)
5. For script path: control block size, leaf version, merkle proof, state handling

**Example:**

```typescript
import { verifyTaprootSpend } from 'lotus-lib'

// For key path
const stack = [signatureBuffer] // 65 bytes
const result = verifyTaprootSpend(scriptPubkey, stack, flags)

if (result.success) {
  console.log('Key path spend valid')
  // Signature verification happens in interpreter
}

// For script path
const stack = [arg1, arg2, scriptBuffer, controlBlockBuffer]
const result = verifyTaprootSpend(scriptPubkey, stack, flags)

if (result.success && result.scriptToExecute) {
  console.log('Script path verification passed')
  console.log('Execute script:', result.scriptToExecute.toString())
  console.log('Stack for execution:', result.stack)
}
```

**Reference:** lotusd/src/script/interpreter.cpp lines 2074-2156

---

## Classes

### NFT Class

Complete NFT implementation using Taproot state parameter.

#### Constructor

```typescript
new NFT(config: {
  metadata: NFTMetadata
  ownerKey: PublicKey
  satoshis?: number
  network?: Network
  scriptTree?: TapNode
  collectionHash?: Buffer
  txid?: string
  outputIndex?: number
})
```

**Parameters:**

- `metadata` - NFT metadata (name, description, image, etc.)
- `ownerKey` - Owner's public key
- `satoshis` - NFT value in satoshis (default: 1000)
- `network` - Network for address (default: livenet)
- `scriptTree` - Optional script tree for advanced spending
- `collectionHash` - Optional collection identifier
- `txid` - Optional transaction ID if already minted
- `outputIndex` - Optional output index if already minted

**Example:**

```typescript
import { NFT, PrivateKey } from 'lotus-lib'

const ownerKey = new PrivateKey()

const nft = new NFT({
  metadata: {
    name: 'Lotus NFT #1',
    description: 'A beautiful digital collectible',
    image: 'ipfs://QmX...',
    attributes: [
      { trait_type: 'Rarity', value: 'Legendary' },
      { trait_type: 'Color', value: 'Gold' },
    ],
  },
  ownerKey: ownerKey.publicKey,
  satoshis: 1000,
  network: 'livenet',
})

console.log('NFT address:', nft.address.toString())
console.log('Metadata hash:', nft.metadataHash.toString('hex'))
```

---

#### Static Methods

##### `NFT.fromScript()`

Create NFT from an existing Taproot script.

```typescript
static fromScript(
  script: Script,
  metadata: NFTMetadata,
  satoshis: number,
  txid?: string,
  outputIndex?: number
): NFT
```

**Example:**

```typescript
const nft = NFT.fromScript(taprootScript, metadata, 1000, 'abc123...', 0)
```

---

##### `NFT.fromUTXO()`

Create NFT from a UTXO.

```typescript
static fromUTXO(
  utxo: UnspentOutput | NFTUtxo,
  metadata: NFTMetadata
): NFT
```

**Example:**

```typescript
const utxo = {
  txid: 'abc123...',
  outputIndex: 0,
  script: nftScript,
  satoshis: 1000,
}

const nft = NFT.fromUTXO(utxo, metadata)
```

---

#### Instance Methods

##### `verifyMetadata()`

Verify that the metadata matches the on-chain hash.

```typescript
verifyMetadata(): boolean
```

**Returns:** `true` if metadata is valid

**Example:**

```typescript
if (nft.verifyMetadata()) {
  console.log('✓ Metadata is authentic')
} else {
  console.log('✗ Metadata has been tampered with')
}
```

---

##### `transfer()`

Create a transfer transaction to a new owner.

```typescript
transfer(
  newOwnerKey: PublicKey,
  currentOwnerKey: PrivateKey,
  fee?: number
): Transaction
```

**Parameters:**

- `newOwnerKey` - New owner's public key
- `currentOwnerKey` - Current owner's private key (for signing)
- `fee` - Optional transaction fee in satoshis

**Returns:** Signed transaction ready to broadcast

**Example:**

```typescript
const newOwner = new PrivateKey()

const transferTx = nft.transfer(
  newOwner.publicKey,
  currentOwner,
  500, // 500 sat fee
)

console.log('Transfer TX:', transferTx.serialize())

// Broadcast the transaction
await broadcastTransaction(transferTx.serialize())
```

---

##### `updateUTXO()`

Update UTXO information after minting or transfer.

```typescript
updateUTXO(txid: string, outputIndex: number): void
```

**Example:**

```typescript
// After broadcasting mint transaction
const txid = await broadcast(mintTx.serialize())
nft.updateUTXO(txid, 0)

console.log('NFT now spendable at:', nft.txid)
```

---

##### `getInfo()`

Get comprehensive NFT information.

```typescript
getInfo(): NFTInfo
```

**Returns:**

```typescript
{
  commitment: PublicKey
  metadataHash: Buffer
  address: Address
}
```

---

##### `toOutput()`

Create a transaction Output for this NFT.

```typescript
toOutput(): Output
```

**Example:**

```typescript
const tx = new Transaction()
  .from(someUtxo)
  .addOutput(nft.toOutput())
  .sign(privateKey)
```

---

##### `toUnspentOutput()`

Create an UnspentOutput for spending this NFT.

```typescript
toUnspentOutput(): UnspentOutput
```

**Example:**

```typescript
const utxo = nft.toUnspentOutput()

const tx = new Transaction()
  .from(utxo)
  .to(recipient, 95000)
  .sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'schnorr')
```

---

##### `toJSON()`

Serialize NFT to JSON.

```typescript
toJSON(): NFTObject
```

**Example:**

```typescript
const json = nft.toJSON()
console.log(JSON.stringify(json, null, 2))

// Save to file or database
fs.writeFileSync('nft.json', JSON.stringify(json))
```

---

#### Properties

```typescript
// Read-only properties
nft.script // Script
nft.address // Address
nft.metadataHash // Buffer
nft.metadata // NFTMetadata
nft.satoshis // number
nft.txid // string | undefined
nft.outputIndex // number | undefined
nft.commitment // PublicKey | undefined
nft.merkleRoot // Buffer | undefined
nft.leaves // TapLeaf[] | undefined
nft.collectionHash // Buffer | undefined

// Methods
nft.hasScriptTree() // boolean
nft.isCollectionNFT() // boolean
```

---

### NFTUtil Class

Utility functions for NFT operations.

#### `NFTUtil.hashMetadata()`

Hash NFT metadata to 32-byte commitment.

```typescript
static hashMetadata(metadata: NFTMetadata): Buffer
```

**Example:**

```typescript
import { NFTUtil } from 'lotus-lib'

const metadata = {
  name: 'My NFT',
  description: 'Cool NFT',
  image: 'ipfs://Qm...',
}

const hash = NFTUtil.hashMetadata(metadata)
console.log('Metadata hash:', hash.toString('hex'))
```

---

#### `NFTUtil.createKeyPathNFT()`

Create a simple key-path-only NFT.

```typescript
static createKeyPathNFT(
  ownerKey: PublicKey,
  metadata: NFTMetadata,
  satoshis?: number,
  network?: Network
): NFTData
```

**Example:**

```typescript
const nft = NFTUtil.createKeyPathNFT(
  ownerKey.publicKey,
  metadata,
  1000,
  'livenet',
)

console.log('NFT address:', nft.address.toString())
```

---

#### `NFTUtil.mintNFT()`

Create a transaction that mints an NFT.

```typescript
static mintNFT(config: NFTMintConfig): Transaction
```

**Example:**

```typescript
const mintTx = NFTUtil.mintNFT({
  ownerKey: privateKey,
  metadata: {
    name: 'Genesis NFT',
    description: 'First in collection',
    image: 'ipfs://Qm...',
  },
  satoshis: 1000,
})

// Add funding and sign
mintTx.from(utxo).change(changeAddress).sign(privateKey)

// Broadcast
const txid = await broadcast(mintTx.serialize())
```

---

#### `NFTUtil.mintBatch()`

Mint multiple NFTs in a single transaction.

```typescript
static mintBatch(
  ownerKey: PrivateKey,
  nftMetadataList: NFTMetadata[],
  satoshisPerNFT?: number,
  network?: Network
): Transaction
```

**Example:**

```typescript
const nfts = [
  { name: 'NFT #1', description: '...', image: 'ipfs://...' },
  { name: 'NFT #2', description: '...', image: 'ipfs://...' },
  { name: 'NFT #3', description: '...', image: 'ipfs://...' },
]

const batchTx = NFTUtil.mintBatch(ownerKey, nfts, 1000)
batchTx.from(utxo).change(changeAddress).sign(privateKey)

console.log('Minting 3 NFTs in one transaction')
```

---

#### `NFTUtil.transferNFT()`

Transfer an NFT to a new owner.

```typescript
static transferNFT(config: NFTTransferConfig): Transaction
```

**Example:**

```typescript
const transferTx = NFTUtil.transferNFT({
  currentOwnerKey: currentOwner,
  newOwnerKey: newOwner.publicKey,
  nftUtxo: {
    txid: 'abc123...',
    outputIndex: 0,
    script: nftScript,
    satoshis: 1000,
  },
  metadataHash: metadataHash,
  fee: 500,
})

console.log('Transfer ready:', transferTx.serialize())
```

---

#### `NFTUtil.validateTransfer()`

Verify NFT transfer preserves metadata.

```typescript
static validateTransfer(
  inputScript: Script,
  outputScript: Script
): boolean
```

**Example:**

```typescript
const isValid = NFTUtil.validateTransfer(previousNFTScript, currentNFTScript)

if (isValid) {
  console.log('✓ NFT is authentic')
}
```

---

#### More NFTUtil Methods

```typescript
// Collection support
NFTUtil.hashCollection(collectionInfo)
NFTUtil.createCollectionNFT(ownerKey, collectionHash, metadata)
NFTUtil.mintCollection(ownerKey, collectionInfo, nftList)

// Verification
NFTUtil.verifyMetadata(metadata, hash)
NFTUtil.verifyProvenance(transfers)
NFTUtil.isNFT(script)

// Information extraction
NFTUtil.extractMetadataHash(script)
NFTUtil.getNFTInfo(script)
```

---

### TaprootInput Class

Specialized input class for Taproot spending.

**Note:** Usually created automatically by `Transaction.from()` when the UTXO script is Taproot. You rarely need to create this manually.

#### Properties

```typescript
class TaprootInput extends Input {
  internalPubKey?: PublicKey // Internal key (for script path)
  merkleRoot?: Buffer // Merkle root (for script path)
  controlBlock?: Buffer // Control block (for script path)
  tapScript?: Script // Script being executed (for script path)
}
```

#### Methods

```typescript
getSignatures(tx, privateKey, index, sigtype, hashData): TransactionSignature[]
addSignature(tx, signature): this
isValidSignature(tx, sig): boolean
clearSignatures(): this
isFullySigned(): boolean
```

---

## MuSig2 Integration

Multi-signature using MuSig2 key aggregation with Taproot.

### High-Level API

For most use cases, use the high-level `MuSig2Signer` class which simplifies the MuSig2 workflow.

#### `MuSig2Signer` Class

Simplified, developer-friendly wrapper for MuSig2 operations.

**Features:**

- Simplified 2-step workflow (prepare → sign)
- Automatic message hashing (ensures 32-byte messages)
- Built-in validation and error handling
- Taproot transaction signing support
- Session-based coordination

**Constructor:**

```typescript
new MuSig2Signer(config: MuSig2SignerConfig)

interface MuSig2SignerConfig {
  signers: PublicKey[]        // All signers' public keys (in order)
  myPrivateKey: PrivateKey    // This signer's private key
  extraInput?: Buffer         // Optional: Extra randomness for nonce generation
}
```

**Example - Simple 2-of-2 Signing:**

```typescript
import { MuSig2Signer, PrivateKey } from 'lotus-lib'

const alice = new PrivateKey()
const bob = new PrivateKey()

// Alice creates signer
const aliceSigner = new MuSig2Signer({
  signers: [alice.publicKey, bob.publicKey],
  myPrivateKey: alice,
})

// Bob creates signer
const bobSigner = new MuSig2Signer({
  signers: [alice.publicKey, bob.publicKey],
  myPrivateKey: bob,
})

const message = Buffer.from('Sign this message', 'utf8')

// Round 1: Generate nonces
const alicePrepare = aliceSigner.prepare(message)
const bobPrepare = bobSigner.prepare(message)

// Share public nonces...

// Round 2: Create partial signatures
const alicePartialSig = aliceSigner.createPartialSignature(
  alicePrepare,
  [alicePrepare.myPublicNonces, bobPrepare.myPublicNonces],
  message,
)

const bobPartialSig = bobSigner.createPartialSignature(
  bobPrepare,
  [alicePrepare.myPublicNonces, bobPrepare.myPublicNonces],
  message,
)

// Share partial signatures...

// Aggregate into final signature
const finalSig = aliceSigner.sign(
  alicePrepare,
  [alicePrepare.myPublicNonces, bobPrepare.myPublicNonces],
  message,
  [alicePartialSig, bobPartialSig],
)

console.log('Final signature:', finalSig.signature.toString())
```

---

#### `MuSig2Signer` Methods

##### `prepare()`

Prepare for signing (Round 1: Generate nonces).

```typescript
prepare(message: Buffer | string, useSession?: boolean): MuSig2PrepareResult
```

**Parameters:**

- `message` - Message to sign (will be hashed to 32 bytes if needed)
- `useSession` - If true, use session manager for state tracking

**Returns:**

```typescript
interface MuSig2PrepareResult {
  keyAggContext: MuSigKeyAggContext
  myPublicNonces: [Point, Point] // Share with other signers
  mySecretNonces: [BN, BN] // KEEP PRIVATE!
  myIndex: number
  sessionId?: string
}
```

**Security Note:** Automatically adds 32 bytes of random entropy for defense-in-depth on top of RFC6979 deterministic generation.

---

##### `createPartialSignature()`

Create your partial signature (Round 2).

```typescript
createPartialSignature(
  prepare: MuSig2PrepareResult,
  allPublicNonces: Array<[Point, Point]>,
  message: Buffer | string,
): BN
```

**Parameters:**

- `prepare` - Result from `prepare()` method
- `allPublicNonces` - All signers' public nonces (in signer order!)
- `message` - Same message used in `prepare()`

**Returns:** Partial signature (BN) to share with other signers

**Important:** Nonces must be in the same order as signers array!

---

##### `verifyPartialSignature()`

Verify a partial signature from another signer.

```typescript
verifyPartialSignature(
  partialSig: BN,
  publicNonce: [Point, Point],
  publicKey: PublicKey,
  signerIndex: number,
  prepare: MuSig2PrepareResult,
  allPublicNonces: Array<[Point, Point]>,
  message: Buffer | string,
): boolean
```

**Returns:** `true` if partial signature is valid

**Example:**

```typescript
const isValid = aliceSigner.verifyPartialSignature(
  bobPartialSig,
  bobPrepare.myPublicNonces,
  bob.publicKey,
  1, // Bob's index
  alicePrepare,
  [alicePrepare.myPublicNonces, bobPrepare.myPublicNonces],
  message,
)

if (!isValid) {
  throw new Error('Invalid partial signature from Bob!')
}
```

---

##### `sign()`

Aggregate all partial signatures into final signature.

```typescript
sign(
  prepare: MuSig2PrepareResult,
  allPublicNonces: Array<[Point, Point]>,
  message: Buffer | string,
  allPartialSigs: BN[],
): MuSig2SignResult
```

**Parameters:**

- `prepare` - Result from `prepare()`
- `allPublicNonces` - All signers' public nonces (in order)
- `message` - Message being signed
- `allPartialSigs` - All partial signatures (in signer order!)

**Returns:**

```typescript
interface MuSig2SignResult {
  signature: Signature
  aggregatedPubKey: PublicKey
  isAggregator: boolean
}
```

---

##### `prepareTaproot()`

Prepare for Taproot MuSig2 signing.

```typescript
prepareTaproot(merkleRoot?: Buffer): MuSigTaprootKeyResult & {
  keyAggContext: MuSigKeyAggContext
}
```

**Parameters:**

- `merkleRoot` - Optional script tree merkle root (default: all zeros for key-only)

**Returns:** Taproot-specific preparation result with commitment, script, tweak, etc.

**Example:**

```typescript
const taprootPrep = aliceSigner.prepareTaproot()

console.log('Taproot address:', taprootPrep.script.toAddress().toString())
console.log('Commitment:', taprootPrep.commitment.toString())
```

---

##### `signTaprootInput()`

Create partial signature for Taproot transaction input.

```typescript
signTaprootInput(
  prepare: MuSigTaprootKeyResult & { keyAggContext: MuSigKeyAggContext },
  allPublicNonces: Array<[Point, Point]>,
  transaction: Transaction,
  inputIndex: number,
  amount: number,
  sighashType?: number,
): BN
```

**Parameters:**

- `prepare` - Result from `prepareTaproot()`
- `allPublicNonces` - All signers' public nonces
- `transaction` - Transaction being signed
- `inputIndex` - Index of input to sign
- `amount` - Amount of output being spent (in satoshis)
- `sighashType` - Signature hash type (default: SIGHASH_ALL | SIGHASH_LOTUS)

**Returns:** Partial signature for Taproot spending

**Example:**

```typescript
const taprootPrep = aliceSigner.prepareTaproot()

// Prepare nonces
const alicePrepare = aliceSigner.prepare(Buffer.from('taproot-tx', 'utf8'))
const bobPrepare = bobSigner.prepare(Buffer.from('taproot-tx', 'utf8'))

// Create transaction
const tx = new Transaction()
  .from({
    txId: 'previous_tx',
    outputIndex: 0,
    script: taprootPrep.script,
    satoshis: 100000,
  })
  .to('lotus:qz...', 95000)

// Sign
const alicePartialSig = aliceSigner.signTaprootInput(
  taprootPrep,
  [alicePrepare.myPublicNonces, bobPrepare.myPublicNonces],
  tx,
  0, // Input index
  100000, // Amount
)
```

---

##### `completeTaprootSigning()`

Aggregate all partial signatures for Taproot spending.

```typescript
completeTaprootSigning(
  prepare: MuSigTaprootKeyResult & { keyAggContext: MuSigKeyAggContext },
  allPublicNonces: Array<[Point, Point]>,
  allPartialSigs: BN[],
  transaction: Transaction,
  inputIndex: number,
  amount: number,
  sighashType?: number,
): Signature
```

**Returns:** Final signature for Taproot input

---

##### `createSession()`

Create a session for coordinated multi-party signing.

```typescript
createSession(
  message: Buffer | string,
  metadata?: Record<string, unknown>,
): {
  manager: MuSigSessionManager
  session: MuSigSession
}
```

**Returns:** Session manager and initialized session

**When to use:** Advanced scenarios requiring fine-grained control over the signing process.

---

##### Properties

```typescript
signer.myPublicKey // PublicKey - This signer's public key
signer.allSigners // PublicKey[] - All signers' public keys
signer.myIndex // number - This signer's index (sorted order)
```

---

#### `createMuSig2Signer()`

Helper function to quickly create a MuSig2 signer.

```typescript
function createMuSig2Signer(
  signers: PublicKey[],
  myPrivateKey: PrivateKey,
): MuSig2Signer
```

**Example:**

```typescript
const signer = createMuSig2Signer(
  [alice.publicKey, bob.publicKey, carol.publicKey],
  alice,
)
```

---

### Session-Based Signing

For coordinated multi-party signing with state management, use `MuSigSessionManager`.

#### `MuSigSessionManager` Class

Manages the lifecycle of MuSig2 signing sessions including nonce exchange, partial signature collection, and finalization.

**Methods:**

```typescript
// Create new session
createSession(
  signers: PublicKey[],
  myPrivateKey: PrivateKey,
  message: Buffer,
  metadata?: Record<string, unknown>,
): MuSigSession

// Generate nonces (Round 1)
generateNonces(
  session: MuSigSession,
  privateKey: PrivateKey,
  extraInput?: Buffer,
): [Point, Point]

// Receive nonce from another signer
receiveNonce(
  session: MuSigSession,
  signerIndex: number,
  publicNonce: [Point, Point],
): void

// Check if all nonces received
hasAllNonces(session: MuSigSession): boolean

// Create partial signature (Round 2)
createPartialSignature(
  session: MuSigSession,
  privateKey: PrivateKey,
): BN

// Receive partial signature from another signer
receivePartialSignature(
  session: MuSigSession,
  signerIndex: number,
  partialSig: BN,
): void

// Check if all partial signatures received
hasAllPartialSignatures(session: MuSigSession): boolean

// Get final aggregated signature
getFinalSignature(session: MuSigSession): Signature

// Abort session
abortSession(session: MuSigSession, reason: string): void

// Get session status
getSessionStatus(session: MuSigSession): {
  phase: MuSigSessionPhase
  noncesCollected: number
  noncesTotal: number
  partialSigsCollected: number
  partialSigsTotal: number
  isComplete: boolean
  isAborted: boolean
  abortReason?: string
}
```

**Example - Session-Based Signing:**

```typescript
import { MuSigSessionManager, MuSigSessionPhase } from 'lotus-lib'

const manager = new MuSigSessionManager()

// Create session
const session = manager.createSession(
  [alice.publicKey, bob.publicKey],
  alice,
  Buffer.from('Sign this', 'utf8'),
)

// Generate nonces
const myNonces = manager.generateNonces(session, alice)
// Share myNonces with Bob...

// Receive Bob's nonces
manager.receiveNonce(session, 1, bobNonces)

// Check if ready to sign
if (manager.hasAllNonces(session)) {
  // Create partial signature
  const myPartialSig = manager.createPartialSignature(session, alice)
  // Share myPartialSig with Bob...

  // Receive Bob's partial signature
  manager.receivePartialSignature(session, 1, bobPartialSig)

  // Check if complete
  if (manager.hasAllPartialSignatures(session)) {
    const finalSig = manager.getFinalSignature(session)
    console.log('Complete!', finalSig.toString())
  }
}

// Check status
const status = manager.getSessionStatus(session)
console.log('Phase:', status.phase)
console.log(
  'Progress:',
  `${status.noncesCollected}/${status.noncesTotal} nonces`,
)
```

---

#### `MuSigSessionPhase` Enum

Session lifecycle phases:

```typescript
enum MuSigSessionPhase {
  INIT = 'init', // Session created
  NONCE_EXCHANGE = 'nonce-exchange', // Round 1: Collecting nonces
  PARTIAL_SIG_EXCHANGE = 'partial-sig-exchange', // Round 2: Collecting signatures
  COMPLETE = 'complete', // Signature aggregated
  ABORTED = 'aborted', // Session aborted (validation failure)
}
```

---

#### `MuSigSession` Interface

Represents a single multi-party signing session:

```typescript
interface MuSigSession {
  sessionId: string
  signers: PublicKey[]
  myIndex: number
  keyAggContext: MuSigKeyAggContext
  message: Buffer
  metadata?: Record<string, unknown>

  // Round 1 state
  mySecretNonce?: MuSigNonce
  myPublicNonce?: [Point, Point]
  receivedPublicNonces: Map<number, [Point, Point]>

  // Round 2 state
  aggregatedNonce?: MuSigAggregatedNonce
  myPartialSig?: BN
  receivedPartialSigs: Map<number, BN>

  // Final state
  finalSignature?: Signature
  phase: MuSigSessionPhase
  createdAt: number
  updatedAt: number
  abortReason?: string
}
```

---

### MuSig2 Security Best Practices

**🔒 Critical Security Rules:**

1. **NEVER Reuse Nonces**

   ```typescript
   // ❌ WRONG - Nonce reuse reveals private key!
   const nonce = signer.prepare(message1)
   const sig1 = signer.sign(nonce, allNonces, message1, partialSigs1)
   const sig2 = signer.sign(nonce, allNonces, message2, partialSigs2) // DANGER!

   // ✅ CORRECT - Generate fresh nonces for each message
   const nonce1 = signer.prepare(message1)
   const sig1 = signer.sign(nonce1, allNonces1, message1, partialSigs1)
   const nonce2 = signer.prepare(message2) // Fresh nonces
   const sig2 = signer.sign(nonce2, allNonces2, message2, partialSigs2)
   ```

2. **Always Verify Partial Signatures**

   ```typescript
   // ✅ Verify before aggregating
   const isValid = aliceSigner.verifyPartialSignature(
     bobPartialSig,
     bobNonce,
     bob.publicKey,
     1,
     prepare,
     allNonces,
     message,
   )

   if (!isValid) {
     throw new Error('Invalid partial signature - aborting')
   }
   ```

3. **Consistent Signer Ordering**

   ```typescript
   // ✅ CORRECT - Same order everywhere
   const signers = [alice.publicKey, bob.publicKey, carol.publicKey]
   const allNonces = [aliceNonce, bobNonce, carolNonce] // Same order!
   const allPartialSigs = [alicePartialSig, bobPartialSig, carolPartialSig] // Same order!

   // ❌ WRONG - Different orderings will fail
   const signers = [alice.publicKey, bob.publicKey, carol.publicKey]
   const allNonces = [bobNonce, aliceNonce, carolNonce] // Wrong order!
   ```

4. **Secure Nonce Generation**
   - The `MuSig2Signer` automatically adds 32 bytes of random entropy
   - This provides defense-in-depth on top of RFC6979 deterministic generation
   - For testing with known vectors, pass `Buffer.alloc(32)` as `extraInput`

5. **Never Share Secret Nonces**

   ```typescript
   const prepare = signer.prepare(message)

   // ✅ Share this
   shareWithOthers(prepare.myPublicNonces)

   // ❌ NEVER share this!
   // prepare.mySecretNonces - Keep private!
   ```

**Common MuSig2 Errors:**

| Error                                              | Cause                                      | Solution                                               |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| "Nonces already generated for this session"        | Attempting nonce reuse                     | Generate fresh nonces for each signing session         |
| "Invalid number of public nonces"                  | Nonces array length mismatch               | Ensure nonces array matches signers array length       |
| "Invalid partial signature from signer X"          | Corrupted or malicious signature           | Verify signatures before aggregating; abort if invalid |
| "My private key does not correspond to any signer" | Private key not in signers list            | Ensure private key's public key is in signers array    |
| "Cannot receive nonce from self"                   | Trying to add own nonce to received nonces | Only add nonces from other signers                     |
| "Missing nonce from signer X"                      | Incomplete nonce collection                | Wait for all signers to share nonces before signing    |

**Session State Management:**

When using `MuSigSessionManager`, always check session phase:

```typescript
const status = manager.getSessionStatus(session)

if (status.phase === MuSigSessionPhase.ABORTED) {
  console.error('Session aborted:', status.abortReason)
  // Handle error...
}

if (status.phase === MuSigSessionPhase.COMPLETE) {
  const finalSig = manager.getFinalSignature(session)
  // Use signature...
}

console.log(`Progress: ${status.noncesCollected}/${status.noncesTotal} nonces`)
console.log(
  `Progress: ${status.partialSigsCollected}/${status.partialSigsTotal} signatures`,
)
```

---

### Low-Level Taproot Functions

For advanced use cases, these low-level functions provide direct access to Taproot MuSig2 operations.

#### `buildMuSigTaprootKey()`

Create a MuSig2 aggregated key for Taproot (key-path only).

```typescript
function buildMuSigTaprootKey(
  signerPubKeys: PublicKey[],
  state?: Buffer,
): MuSigTaprootKeyResult
```

**Parameters:**

- `signerPubKeys` - Array of signer public keys
- `state` - Optional 32-byte state

**Returns:**

```typescript
{
  aggregatedPubKey: PublicKey
  commitment: PublicKey
  script: Script
  keyAggContext: MuSigKeyAggContext
  merkleRoot: Buffer
  tweak: Buffer
}
```

**Example:**

```typescript
import { buildMuSigTaprootKey } from 'lotus-lib'

const result = buildMuSigTaprootKey([
  alice.publicKey,
  bob.publicKey,
  carol.publicKey,
])

console.log('MuSig2 Taproot script:', result.script.toString())
console.log('Aggregated key:', result.aggregatedPubKey.toString())

// When spent via key path, looks like single-sig (privacy!)
```

---

### `buildMuSigTaprootKeyWithScripts()`

Create MuSig2 Taproot with script tree fallback.

```typescript
function buildMuSigTaprootKeyWithScripts(
  signerPubKeys: PublicKey[],
  scriptTree: TapNode,
  state?: Buffer,
): MuSigTaprootKeyResult & { leaves: TapLeaf[] }
```

**Example:**

```typescript
// 3-of-3 MuSig2 with timelock fallback
const timelockScript = new Script()
  .add(21600) // 30 days
  .add(Opcode.OP_CHECKLOCKTIMEVERIFY)
  .add(Opcode.OP_DROP)
  .add(alice.publicKey.toBuffer())
  .add(Opcode.OP_CHECKSIG)

const tree = { script: timelockScript }

const result = buildMuSigTaprootKeyWithScripts(
  [alice.publicKey, bob.publicKey, carol.publicKey],
  tree,
)

console.log('Cooperative path: MuSig2 (private)')
console.log('Fallback path: Timelock script (public)')
```

---

### `signTaprootKeyPathWithMuSig2()`

Create MuSig2 partial signature for Taproot key path.

```typescript
function signTaprootKeyPathWithMuSig2(
  secretNonce: MuSigNonce,
  privateKey: PrivateKey,
  keyAggContext: MuSigKeyAggContext,
  signerIndex: number,
  aggregatedNonce: MuSigAggregatedNonce,
  message: Buffer,
  tweak: Buffer,
): BN
```

**Example:**

```typescript
// Each signer creates a partial signature
const partialSig = signTaprootKeyPathWithMuSig2(
  secretNonce,
  alicePrivateKey,
  result.keyAggContext,
  0, // Alice is signer 0
  aggregatedNonce,
  sighash,
  result.tweak,
)

// Aggregate partial signatures
const fullSignature = musigAggregateSignatures(partialSigs)
```

---

### `createMuSigTaprootAddress()`

Utility to create Taproot address from MuSig2 aggregated key.

```typescript
function createMuSigTaprootAddress(
  signerPubKeys: PublicKey[],
  network?: string,
  state?: Buffer,
): {
  address: Address
  script: Script
  commitment: PublicKey
  keyAggContext: MuSigKeyAggContext
}
```

**Example:**

```typescript
const multisig = createMuSigTaprootAddress(
  [alice.publicKey, bob.publicKey],
  'livenet',
)

console.log('2-of-2 address:', multisig.address.toString())

// Send funds to this address
// Spend requires both Alice and Bob to cooperatively sign
```

---

## Types & Interfaces

### NFT Types

```typescript
interface NFTMetadata {
  name: string
  description: string
  image: string // IPFS CID, Arweave, or URL
  attributes?: NFTAttribute[]
  collection?: string
  creator?: string
  external_url?: string
  animation_url?: string
  background_color?: string // Hex without #
}

interface NFTAttribute {
  trait_type: string
  value: string | number
  display_type?: 'number' | 'boost_percentage' | 'boost_number' | 'date'
}

interface NFTCollectionMetadata {
  name: string
  description: string
  totalSupply: number
  creator: string
  royalty?: number // 0-100
  image?: string
  external_url?: string
}

interface NFTData {
  script: Script
  address: Address
  metadataHash: Buffer
  metadata: NFTMetadata
  satoshis: number
  txid?: string
  outputIndex?: number
}

interface NFTUtxo {
  txid: string
  outputIndex: number
  script: Script
  satoshis: number
}
```

---

### Taproot Types

```typescript
interface TapLeafNode {
  script: Script | Buffer
  leafVersion?: number // Default: 0xc0
}

interface TapBranchNode {
  left: TapNode
  right: TapNode
}

type TapNode = TapLeafNode | TapBranchNode

interface TapLeaf {
  script: Script
  leafVersion: number
  leafHash: Buffer
  merklePath: Buffer[]
}

interface TapTreeBuildResult {
  merkleRoot: Buffer
  leaves: TapLeaf[]
}

interface TaprootVerifyResult {
  success: boolean // Whether verification succeeded
  error?: string // Error message if failed
  scriptToExecute?: Script // Script to execute (script path only)
  stack?: Buffer[] // Updated stack (includes state if present)
}
```

---

### MuSig2 Types

```typescript
// High-Level API Types

interface MuSig2SignerConfig {
  signers: PublicKey[] // All signers' public keys (in order)
  myPrivateKey: PrivateKey // This signer's private key
  extraInput?: Buffer // Optional: Extra randomness for nonce generation
}

interface MuSig2PrepareResult {
  keyAggContext: MuSigKeyAggContext
  myPublicNonces: [Point, Point] // Share with other signers
  mySecretNonces: [BN, BN] // KEEP PRIVATE!
  myIndex: number
  sessionId?: string
}

interface MuSig2SignResult {
  signature: Signature
  aggregatedPubKey: PublicKey
  isAggregator: boolean
}

interface MuSig2TaprootSignResult extends MuSig2SignResult {
  commitment: PublicKey
  script: Script
  address: Address
}

// Session Management Types

interface MuSigSession {
  sessionId: string
  signers: PublicKey[]
  myIndex: number
  keyAggContext: MuSigKeyAggContext
  message: Buffer
  metadata?: Record<string, unknown>

  // Round 1 state
  mySecretNonce?: MuSigNonce
  myPublicNonce?: [Point, Point]
  receivedPublicNonces: Map<number, [Point, Point]>

  // Round 2 state
  aggregatedNonce?: MuSigAggregatedNonce
  myPartialSig?: BN
  receivedPartialSigs: Map<number, BN>

  // Final state
  finalSignature?: Signature
  phase: MuSigSessionPhase
  createdAt: number
  updatedAt: number
  abortReason?: string
}

enum MuSigSessionPhase {
  INIT = 'init',
  NONCE_EXCHANGE = 'nonce-exchange',
  PARTIAL_SIG_EXCHANGE = 'partial-sig-exchange',
  COMPLETE = 'complete',
  ABORTED = 'aborted',
}

// Low-Level Types

interface MuSigTaprootKeyResult {
  aggregatedPubKey: PublicKey
  commitment: PublicKey
  script: Script
  keyAggContext: MuSigKeyAggContext
  merkleRoot: Buffer
  tweak: Buffer
}

interface MuSigKeyAggContext {
  aggregatedPubKey: PublicKey
  pubkeys: PublicKey[] // Sorted signers
  keyAggCoeffs: BN[]
  // Internal fields omitted
}

interface MuSigNonce {
  secretNonces: [BN, BN]
  publicNonces: [Point, Point]
}

interface MuSigAggregatedNonce {
  R1: Point
  R2: Point
  // Internal fields omitted
}
```

---

## Constants

All constants match the lotusd consensus implementation exactly.

```typescript
// Leaf version and mask
TAPROOT_LEAF_TAPSCRIPT = 0xc0 // 192 - Only supported leaf version
TAPROOT_LEAF_MASK = 0xfe // 254 - Mask to extract leaf version from control byte

// Control block sizing
TAPROOT_CONTROL_BASE_SIZE = 33 // Control byte (1) + x-coordinate (32)
TAPROOT_CONTROL_NODE_SIZE = 32 // Size of each merkle proof node
TAPROOT_CONTROL_MAX_NODE_COUNT = 128 // Maximum merkle proof nodes
TAPROOT_CONTROL_MAX_SIZE = 4129 // Maximum control block size (33 + 128×32)

// Script sizing
TAPROOT_INTRO_SIZE = 3 // OP_SCRIPTTYPE + OP_1 + push opcode
TAPROOT_SIZE_WITHOUT_STATE = 36 // Full scriptPubKey without state
TAPROOT_SIZE_WITH_STATE = 69 // Full scriptPubKey with state

// Script type markers
TAPROOT_SCRIPTTYPE = Opcode.OP_1 // 0x51 (81) - Version byte
OP_SCRIPTTYPE = 0x62 // 98 - Taproot marker

// Signature hash type
TAPROOT_SIGHASH_TYPE = 0x61 // SIGHASH_ALL | SIGHASH_LOTUS

// Annex
TAPROOT_ANNEX_TAG = 0x50 // 80 - Annex marker (not supported)

// Signature components
Signature.SIGHASH_ALL = 0x01
Signature.SIGHASH_LOTUS = 0x60 // 96 - Required for key path spending
Signature.SIGHASH_FORKID = 0x40 // 64 - Implicitly included in LOTUS
```

**Key Values:**

- **Control block size**: 33 + (32 × n) bytes where n ≤ 128
- **Schnorr signature**: 64 bytes (without sighash byte)
- **Full signature**: 65 bytes (64-byte Schnorr + 1-byte sighash type)
- **State parameter**: Exactly 32 bytes (optional)

**Reference:** lotusd/src/script/taproot.h lines 15-33

---

## Transaction Integration

### Automatic Taproot Detection

```typescript
// Transaction automatically detects Taproot outputs
const taprootScript = buildKeyPathTaproot(publicKey)

const tx = new Transaction().from({
  txId: 'abc123...',
  outputIndex: 0,
  script: taprootScript,
  satoshis: 100000,
})

// Automatically creates TaprootInput!
```

---

### Signing Taproot Inputs

```typescript
// For key path spending (most common)
tx.sign(
  privateKey,
  Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, // Required!
  'schnorr', // Required!
)

// Other sighash types
tx.sign(
  privateKey,
  Signature.SIGHASH_SINGLE | Signature.SIGHASH_LOTUS,
  'schnorr',
)

tx.sign(
  privateKey,
  Signature.SIGHASH_ALL |
    Signature.SIGHASH_LOTUS |
    Signature.SIGHASH_ANYONECANPAY,
  'schnorr',
)
```

---

### Complete Transaction Example

```typescript
import {
  Transaction,
  PrivateKey,
  Signature,
  buildKeyPathTaproot,
} from 'lotus-lib'

// Create Taproot output
const privateKey = new PrivateKey()
const taprootScript = buildKeyPathTaproot(privateKey.publicKey)

// Fund the Taproot output
const fundingTx = new Transaction()
  .from(someUtxo)
  .addOutput(
    new Output({
      script: taprootScript,
      satoshis: 100000,
    }),
  )
  .sign(fundingKey)

// Spend the Taproot output
const spendingTx = new Transaction()
  .from({
    txId: fundingTx.id,
    outputIndex: 0,
    script: taprootScript,
    satoshis: 100000,
  })
  .to('lotus:qz...recipient', 95000)
  .sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'schnorr')

console.log('✓ Transaction signed')
console.log('TX ID:', spendingTx.id)
console.log('Valid:', spendingTx.verify())
```

---

## Address Support

### Creating Taproot Addresses

```typescript
import { Address, tweakPublicKey } from 'lotus-lib'

// Method 1: From commitment
const commitment = tweakPublicKey(publicKey, Buffer.alloc(32))
const address = Address.fromTaprootCommitment(commitment, 'livenet')

console.log('Taproot address:', address.toString())
console.log('Type:', address.type) // 'taproot'
console.log('Is Taproot:', address.isTaproot()) // true
```

---

### From Script

```typescript
const taprootScript = buildKeyPathTaproot(publicKey)
const address = taprootScript.toAddress('livenet')

console.log('Address:', address.toString())
```

---

### XAddress Format

```typescript
// XAddress format (type byte 2)
const xaddress = address.toXAddress()
console.log(xaddress)
// Output: lotus_X<base58_encoded_commitment_and_checksum>

// XAddress encodes the 33-byte commitment only
console.log('Encoded data:', address.hashBuffer.length) // 33 bytes
```

**Important:** XAddresses encode only the commitment (33 bytes), never the state parameter:

- ✅ Valid XAddress payload: 33 bytes (commitment)
- ✅ Valid XAddress payload: 36 bytes (full P2TR script without state)
- ❌ Invalid XAddress payload: 69 bytes (full P2TR script with state)

If you need to share a full Taproot output with state, use:

```typescript
// Share full script as hex
const scriptHex = script.toString()

// Or share as structured data
const outputData = {
  address: script.toAddress().toString(),
  state: extractTaprootState(script)?.toString('hex'),
}
```

---

### Converting Back to Script

```typescript
import { Script, Address } from 'lotus-lib'

const address = Address.fromString('lotus_X...') // P2TR address
const script = Script.fromAddress(address)

console.log(script.isPayToTaproot()) // true
```

---

### Checking Address Types

```typescript
const address = Address.fromString(addressString)

if (address.isPayToTaproot()) {
  console.log('This is a Taproot address')
  console.log('Type:', address.type) // 'taproot'
  console.log('Commitment (33 bytes):', address.hashBuffer.toString('hex'))
}

if (address.isPayToPublicKeyHash()) {
  console.log('This is a P2PKH address')
}

if (address.isPayToScriptHash()) {
  console.log('This is a P2SH address')
}
```

**Important:** For Taproot addresses:

- `address.hashBuffer` contains the 33-byte commitment (not the full script)
- State parameter is NOT included in addresses
- `Script.fromAddress(taprootAddress)` creates a 36-byte script (no state)
- To get the full script with state, use the script hex or store state separately

---

## Common Patterns

### Pattern 1: Simple Single-Sig Taproot

**Use case:** Maximum privacy for single-signature wallets

```typescript
import { PrivateKey, buildKeyPathTaproot, Transaction } from 'lotus-lib'

const privateKey = new PrivateKey()
const taprootScript = buildKeyPathTaproot(privateKey.publicKey)

// Send to this script
// When spent, looks identical to any other Taproot spend
```

---

### Pattern 2: Time-Locked Voting

**Use case:** Prevent vote manipulation by locking funds

```typescript
import { Script, Opcode, buildScriptPathTaproot } from 'lotus-lib'

const voterKey = new PrivateKey()
const unlockHeight = currentHeight + 720 // 24 hours

const timeLockScript = new Script()
  .add(Buffer.from(unlockHeight.toString(16), 'hex'))
  .add(Opcode.OP_CHECKLOCKTIMEVERIFY)
  .add(Opcode.OP_DROP)
  .add(voterKey.publicKey.toBuffer())
  .add(Opcode.OP_CHECKSIG)

const tree = { script: timeLockScript }
const result = buildScriptPathTaproot(voterKey.publicKey, tree)

// Create RANK vote transaction with locked commitment
const tx = new Transaction()
  .from(utxo)
  .addOutput(
    new Output({
      script: Script.fromBuffer(rankScript),
      satoshis: 1_000_000,
    }),
  )
  .to(result.script.toAddress(), 10000) // Lock 10k sats
  .sign(voterKey)
```

---

### Pattern 3: Moderated Comments (RNKC)

**Use case:** Economic spam prevention with refunds

```typescript
const commenterKey = new PrivateKey()
const moderatorKey = new PrivateKey()

// Refund script (1 week delay)
const refundScript = new Script()
  .add(5040) // ~1 week
  .add(Opcode.OP_CHECKLOCKTIMEVERIFY)
  .add(Opcode.OP_DROP)
  .add(commenterKey.publicKey.toBuffer())
  .add(Opcode.OP_CHECKSIG)

// Penalty script (moderator can spend)
const penaltyScript = new Script()
  .add(moderatorKey.publicKey.toBuffer())
  .add(Opcode.OP_CHECKSIG)

const tree = {
  left: { script: refundScript },
  right: { script: penaltyScript },
}

const result = buildScriptPathTaproot(commenterKey.publicKey, tree)

// Create comment with stake
const tx = new Transaction()
  .from(utxo)
  .addOutput(new Output({ script: rnkcMetadata, satoshis: 0 }))
  .addOutput(new Output({ script: commentData, satoshis: 0 }))
  .to(result.script.toAddress(), 50000) // Stake 50k sats
  .sign(commenterKey)
```

---

### Pattern 4: MuSig2 Multi-Signature

**Use case:** Private multi-sig (looks like single-sig)

```typescript
import { MuSig2Signer, Transaction, Signature } from 'lotus-lib'

// Setup: 3-of-3 MuSig2 (all must sign)
const alice = new PrivateKey()
const bob = new PrivateKey()
const carol = new PrivateKey()

// Each party creates a signer
const aliceSigner = new MuSig2Signer({
  signers: [alice.publicKey, bob.publicKey, carol.publicKey],
  myPrivateKey: alice,
})

const bobSigner = new MuSig2Signer({
  signers: [alice.publicKey, bob.publicKey, carol.publicKey],
  myPrivateKey: bob,
})

const carolSigner = new MuSig2Signer({
  signers: [alice.publicKey, bob.publicKey, carol.publicKey],
  myPrivateKey: carol,
})

// Create Taproot output
const taprootPrep = aliceSigner.prepareTaproot()
const multisigAddress = taprootPrep.script.toAddress()
console.log('3-of-3 MuSig2 address:', multisigAddress.toString())

// Send funds to multisigAddress...

// Later: Spend the funds cooperatively

// Step 1: Create transaction
const tx = new Transaction()
  .from({
    txId: 'funding_tx',
    outputIndex: 0,
    script: taprootPrep.script,
    satoshis: 100000,
  })
  .to('lotus:qz...recipient', 95000)

// Step 2: Round 1 - Generate nonces
const alicePrepare = aliceSigner.prepare(tx.id)
const bobPrepare = bobSigner.prepare(tx.id)
const carolPrepare = carolSigner.prepare(tx.id)

// Share public nonces with all parties...
const allNonces = [
  alicePrepare.myPublicNonces,
  bobPrepare.myPublicNonces,
  carolPrepare.myPublicNonces,
]

// Step 3: Round 2 - Create partial signatures
const alicePartialSig = aliceSigner.signTaprootInput(
  taprootPrep,
  allNonces,
  tx,
  0, // input index
  100000, // amount
)

const bobPartialSig = bobSigner.signTaprootInput(
  taprootPrep,
  allNonces,
  tx,
  0,
  100000,
)

const carolPartialSig = carolSigner.signTaprootInput(
  taprootPrep,
  allNonces,
  tx,
  0,
  100000,
)

// Share partial signatures with all parties...
const allPartialSigs = [alicePartialSig, bobPartialSig, carolPartialSig]

// Step 4: Aggregate signatures
const finalSignature = aliceSigner.completeTaprootSigning(
  taprootPrep,
  allNonces,
  allPartialSigs,
  tx,
  0,
  100000,
)

// Add signature to transaction
tx.inputs[0].setScript(Script.fromBuffer(finalSignature.toBuffer()))

console.log('Transaction signed with 3-of-3 MuSig2')
console.log('On-chain footprint: identical to single-sig!')
console.log('Privacy: No one knows it was multi-sig')

// Broadcast
await broadcast(tx.serialize())
```

**Benefits:**

- ✅ On-chain looks identical to single-sig (perfect privacy)
- ✅ Lower transaction fees than script-based multisig
- ✅ All parties must cooperate (true n-of-n)
- ✅ No revealing of multi-sig setup unless spending via script path

---

### Pattern 5: NFT Creation

**Use case:** Provably unique digital assets

```typescript
import { NFT, Hash } from 'lotus-lib'

const metadata = {
  name: 'Lotus Genesis NFT',
  description: 'First NFT in the collection',
  image: 'ipfs://QmX...',
  attributes: [
    { trait_type: 'Rarity', value: 'Legendary' },
    { trait_type: 'Edition', value: 1 },
  ],
}

const nft = new NFT({
  metadata,
  ownerKey: ownerPrivateKey.publicKey,
  satoshis: 1000,
})

// Mint the NFT
const mintTx = new Transaction()
  .from(fundingUtxo)
  .addOutput(nft.toOutput())
  .change(changeAddress)
  .sign(fundingKey)

await broadcast(mintTx.serialize())
nft.updateUTXO(mintTx.id, 0)

// Transfer to new owner
const transferTx = nft.transfer(newOwner.publicKey, ownerPrivateKey)
await broadcast(transferTx.serialize())
```

---

### Pattern 6: Lightning-Style Channel

**Use case:** Payment channels with HTLC

```typescript
import { Script, Opcode, Hash } from 'lotus-lib'

const alice = new PrivateKey()
const bob = new PrivateKey()
const preimage = Buffer.from('secret', 'utf8')
const paymentHash = Hash.sha256(preimage)

// Success path: Alice reveals preimage
const htlcSuccess = new Script()
  .add(Opcode.OP_SIZE)
  .add(32)
  .add(Opcode.OP_EQUALVERIFY)
  .add(Opcode.OP_HASH256)
  .add(paymentHash)
  .add(Opcode.OP_EQUALVERIFY)
  .add(alice.publicKey.toBuffer())
  .add(Opcode.OP_CHECKSIG)

// Timeout path: Bob refunds
const htlcTimeout = new Script()
  .add(144) // CSV timeout
  .add(Opcode.OP_CHECKSEQUENCEVERIFY)
  .add(Opcode.OP_DROP)
  .add(bob.publicKey.toBuffer())
  .add(Opcode.OP_CHECKSIG)

const tree = {
  left: { script: htlcSuccess },
  right: { script: htlcTimeout },
}

const result = buildScriptPathTaproot(alice.publicKey, tree)

console.log('HTLC Taproot created')
console.log('Alice can claim by revealing preimage')
console.log('Bob can refund after timeout')
```

---

### Pattern 7: Organizational Voting

**Use case:** Multi-sig governance with privacy

```typescript
import { buildMuSigTaprootKey } from 'lotus-lib'

// 3-of-5 board members
const boardMembers = [
  alice.publicKey,
  bob.publicKey,
  carol.publicKey,
  dave.publicKey,
  eve.publicKey,
]

const result = buildMuSigTaprootKey(boardMembers)

// Create RANK vote with large stake
const tx = new Transaction()
  .from(orgUtxo)
  .addOutput(new Output({ script: rankVote, satoshis: 0 }))
  .to(result.script.toAddress(), 1000000) // 1M sats = vote weight
  .sign(orgKey)

console.log('Organization vote: 1M sats weight')
console.log('Privacy: Looks like single-sig on-chain')
```

---

## Error Handling

### Consensus Error Codes

These error codes match the lotusd consensus implementation:

| Error Code                                  | Cause                      | Solution                               |
| ------------------------------------------- | -------------------------- | -------------------------------------- |
| `TAPROOT_PHASEOUT`                          | Taproot disabled by flag   | Check network supports Taproot         |
| `SCRIPTTYPE_MALFORMED_SCRIPT`               | Invalid P2TR format        | Verify script format is correct        |
| `INVALID_STACK_OPERATION`                   | Empty stack                | Ensure scriptSig provides data         |
| `TAPROOT_ANNEX_NOT_SUPPORTED`               | Annex element present      | Remove annex (not supported in Lotus)  |
| `TAPROOT_KEY_SPEND_SIGNATURE_NOT_SCHNORR`   | ECDSA used for key path    | Use Schnorr signature (64 bytes)       |
| `TAPROOT_KEY_SPEND_MUST_USE_LOTUS_SIGHASH`  | Missing SIGHASH_LOTUS      | Add SIGHASH_LOTUS flag to sighash type |
| `TAPROOT_VERIFY_SIGNATURE_FAILED`           | Invalid signature          | Check private key and sighash          |
| `TAPROOT_WRONG_CONTROL_SIZE`                | Invalid control block size | Must be 33 + (32 × n) bytes            |
| `TAPROOT_LEAF_VERSION_NOT_SUPPORTED`        | Leaf version not 0xc0      | Use TAPROOT_LEAF_TAPSCRIPT (0xc0)      |
| `TAPROOT_CONTROL_BLOCK_VERIFICATION_FAILED` | Merkle proof invalid       | Verify control block and script        |
| `EVAL_FALSE`                                | Script returned false      | Check script logic                     |

---

### Common Errors and Solutions

#### "Taproot key spend signatures must use SIGHASH_LOTUS"

**Problem:** Using `SIGHASH_FORKID` instead of `SIGHASH_LOTUS`

```typescript
// ❌ Wrong
tx.sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID, 'schnorr')

// ✅ Correct
tx.sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'schnorr')
```

**Why:** Taproot key path spending requires SIGHASH_LOTUS (0x60) by consensus rules.

---

#### "Taproot key spend signature must be Schnorr"

**Problem:** Using ECDSA instead of Schnorr for key path

```typescript
// ❌ Wrong - ECDSA forbidden for key path
tx.sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'ecdsa')

// ✅ Correct - Must use Schnorr
tx.sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'schnorr')
```

**Why:** Key path spending requires 64-byte Schnorr signatures. ECDSA is explicitly forbidden.

**Note:** Script path spending CAN use ECDSA if the revealed script allows it.

---

#### "SIGHASH_LOTUS requires spent outputs for all inputs"

**Problem:** Missing output information for SIGHASH_LOTUS computation

```typescript
// ❌ Wrong - No output info
tx.from({
  txId: 'abc123...',
  outputIndex: 0,
  satoshis: 100000,
  // Missing script!
})

// ✅ Correct - Include full UTXO info
tx.from({
  txId: 'abc123...',
  outputIndex: 0,
  script: taprootScript, // Required!
  satoshis: 100000,
})
```

**Why:** SIGHASH_LOTUS commits to all spent outputs via merkle tree. The transaction needs complete output information for all inputs.

---

#### "Not a valid Pay-To-Taproot script"

**Problem:** Trying to use Taproot functions on non-Taproot scripts

```typescript
// ❌ Wrong - No validation
const commitment = extractTaprootCommitment(someScript)

// ✅ Correct - Check first
if (!isPayToTaproot(script)) {
  console.log('Not a Taproot script')
  return
}

const commitment = extractTaprootCommitment(script)
```

---

#### "Taproot state must be exactly 32 bytes"

**Problem:** State parameter wrong size

```typescript
// ❌ Wrong - Only 5 bytes
const state = Buffer.from('hello', 'utf8')

// ✅ Correct - Always hash to 32 bytes
const state = Hash.sha256(Buffer.from('hello', 'utf8'))
const script = buildKeyPathTaproot(publicKey, state)
```

**Tip:** Always hash your data to 32 bytes before using as state parameter.

---

#### "State parameter lost when converting to address"

**Problem:** Expecting state to be preserved through address conversion

```typescript
// ❌ Wrong assumption
const scriptWithState = buildKeyPathTaproot(publicKey, stateBuffer)
const address = scriptWithState.toAddress()
const reconstructed = Script.fromAddress(address)
const state = extractTaprootState(reconstructed) // null! State lost

// ✅ Correct approach - Store state separately
const outputData = {
  address: scriptWithState.toAddress().toString(),
  script: scriptWithState.toString(), // Full script hex
  state: extractTaprootState(scriptWithState)?.toString('hex'),
  commitment: extractTaprootCommitment(scriptWithState).toString(),
}

// Later, reconstruct full script
const fullScript = Script.fromHex(outputData.script)
// OR
const commitment = PublicKey.fromString(outputData.commitment)
const state = Buffer.from(outputData.state, 'hex')
const reconstructed = buildPayToTaproot(commitment, state)
```

**Why:** Addresses encode the commitment only (33 bytes), not the full output script. The state parameter is output-specific data, not addressing data. Same commitment with different states = same address.

---

#### "Output value below dust limit (546 satoshis)"

**Problem:** Creating outputs with too little value

```typescript
// ❌ Wrong
const nft = new NFT({ metadata, ownerKey, satoshis: 100 })

// ✅ Correct - Minimum 546 satoshis
const nft = new NFT({ metadata, ownerKey, satoshis: 1000 })
```

---

#### "Cannot transfer NFT without UTXO information"

**Problem:** Trying to transfer NFT that doesn't have txid/outputIndex

```typescript
const nft = new NFT({ metadata, ownerKey })

// ❌ Wrong - NFT not minted yet
nft.transfer(newOwner.publicKey, ownerKey)

// ✅ Correct - Update UTXO info first
const mintTx = new Transaction()
  .from(fundingUtxo)
  .addOutput(nft.toOutput())
  .sign(fundingKey)

const txid = await broadcast(mintTx.serialize())
nft.updateUTXO(txid, 0)

// Now transfer works
nft.transfer(newOwner.publicKey, ownerKey)
```

---

#### "Metadata does not match on-chain hash"

**Problem:** Metadata has been tampered with or is incorrect

```typescript
// Verify metadata before using
if (!nft.verifyMetadata()) {
  console.error('⚠️ Metadata hash mismatch - possible forgery')
  return
}

// Or check manually
const computedHash = NFTUtil.hashMetadata(metadata)
if (!computedHash.equals(onChainHash)) {
  console.error('⚠️ Metadata verification failed')
}
```

---

### Validation Best Practices

```typescript
// Always verify before broadcasting
const tx = new Transaction()
  .from(taprootUtxo)
  .to(address, amount)
  .sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'schnorr')

const isValid = tx.verify()
if (isValid !== true) {
  console.error('Transaction invalid:', isValid)
  throw new Error('Invalid transaction')
}

// Now safe to broadcast
await broadcast(tx.serialize())
```

---

### Debug Helpers

```typescript
// Inspect Taproot script
console.log('Script size:', script.toBuffer().length)
console.log('Is P2TR:', isPayToTaproot(script))

if (isPayToTaproot(script)) {
  const commitment = extractTaprootCommitment(script)
  const state = extractTaprootState(script)

  console.log('Commitment:', commitment.toString())
  console.log('Has state:', state !== null)
  if (state) {
    console.log('State:', state.toString('hex'))
  }
}

// Check transaction
console.log('Inputs:', tx.inputs.length)
console.log('Outputs:', tx.outputs.length)
console.log('Size:', tx.toBuffer().length, 'bytes')
console.log('Fee:', tx.getFee(), 'satoshis')
console.log('Fully signed:', tx.isFullySigned())
```

---

## Type Guards

### `isTapLeafNode()`

Type guard to check if a tree node is a leaf.

```typescript
function isTapLeafNode(node: TapNode): node is TapLeafNode
```

**Parameters:**

- `node` - Tree node to check

**Returns:** `true` if node is a leaf (has `script` property)

**Example:**

```typescript
import { isTapLeafNode } from 'lotus-lib'

const tree = {
  left: { script: script1 },
  right: { script: script2 },
}

if (isTapLeafNode(tree.left)) {
  console.log('Left is a leaf with script:', tree.left.script)
}
```

---

### `isTapBranchNode()`

Type guard to check if a tree node is a branch.

```typescript
function isTapBranchNode(node: TapNode): node is TapBranchNode
```

**Parameters:**

- `node` - Tree node to check

**Returns:** `true` if node is a branch (has `left` and `right` properties)

**Example:**

```typescript
import { isTapBranchNode } from 'lotus-lib'

if (isTapBranchNode(tree)) {
  console.log('This is a branch node')
  console.log('Left subtree:', tree.left)
  console.log('Right subtree:', tree.right)
}
```

---

## Advanced Functions

### Control Block Parsing

When working with raw control blocks:

```typescript
// Extract components from control block
const controlByte = controlBlock[0]
const leafVersion = controlByte & 0xfe // Upper 7 bits
const parity = controlByte & 0x01 // Bit 0

// Extract internal pubkey X-coordinate (32 bytes)
const internalPubKeyXCoord = controlBlock.slice(1, 33)

// Extract merkle proof nodes
const merkleProof: Buffer[] = []
for (let i = 33; i < controlBlock.length; i += 32) {
  merkleProof.push(controlBlock.slice(i, i + 32))
}

// Reconstruct full 33-byte compressed pubkey
const prefix = parity === 0 ? 0x02 : 0x03
const internalPubKey = Buffer.concat([
  Buffer.from([prefix]),
  internalPubKeyXCoord,
])
```

---

### Merkle Root Calculation

For manual merkle tree construction:

```typescript
import { calculateTapLeaf, calculateTapBranch } from 'lotus-lib'

// Calculate leaf hashes
const leaf1 = calculateTapLeaf(script1, 0xc0)
const leaf2 = calculateTapLeaf(script2, 0xc0)
const leaf3 = calculateTapLeaf(script3, 0xc0)
const leaf4 = calculateTapLeaf(script4, 0xc0)

// Build tree bottom-up with lexicographic ordering
const branch1 = calculateTapBranch(leaf1, leaf2)
const branch2 = calculateTapBranch(leaf3, leaf4)
const root = calculateTapBranch(branch1, branch2)

console.log('Merkle root:', root.toString('hex'))
```

**Important:** Hashes are automatically sorted lexicographically in `calculateTapBranch()`, matching lotusd implementation.

---

### Manual Key Tweaking

For advanced scenarios requiring manual key manipulation:

```typescript
import { calculateTapTweak, PublicKey, PrivateKey } from 'lotus-lib'

const privateKey = new PrivateKey()
const internalPubKey = privateKey.publicKey
const merkleRoot = Buffer.alloc(32) // Key-only

// Calculate tweak manually
const tweak = calculateTapTweak(internalPubKey, merkleRoot)
console.log('Tweak:', tweak.toString('hex'))

// Apply tweak to public key: commitment = internal + tweak × G
const commitment = internalPubKey.addScalar(tweak)

// Apply tweak to private key: tweaked = (internal + tweak) mod n
const tweakBN = new BN(tweak)
const privKeyBN = privateKey.bn
const tweakedBN = privKeyBN.add(tweakBN).umod(PublicKey.getN())
const tweakedPrivKey = new PrivateKey(tweakedBN)

console.log('Commitment:', commitment.toString())
```

---

## Tips & Best Practices

### 1. Use Key Path for Privacy

```typescript
// Key path spending looks identical to any other Taproot spend
// Observers cannot tell if there were alternative scripts
const taprootScript = buildKeyPathTaproot(publicKey)
```

---

### 2. Put Most Likely Path as Key Path

```typescript
// If cooperative close is most likely (e.g., Lightning):
// - Key path = MuSig(alice, bob)
// - Script paths = timeout/dispute resolution

const cooperativeKey = buildMuSigTaprootKey([alice, bob])
// 99% of closes use key path (cooperative)
// 1% reveal scripts (disputes)
```

---

### 3. Order Scripts by Likelihood

```typescript
// Put most likely scripts higher in tree (shorter merkle path)
const tree = {
  left: { script: likelyScript }, // Shorter path
  right: { script: unlikelyScript }, // Longer path
}
```

---

### 4. Always Validate Before Broadcasting

```typescript
const isValid = tx.verify()
if (isValid !== true) {
  throw new Error('Invalid transaction: ' + isValid)
}

await broadcastTransaction(tx.serialize())
```

---

### 5. Store NFT Metadata Off-Chain

```typescript
// ❌ Don't store full metadata on-chain (expensive)

// ✅ Store only hash on-chain, full metadata on IPFS/Arweave
const metadataJSON = JSON.stringify(metadata)
const ipfsCID = await uploadToIPFS(metadataJSON)

const nft = new NFT({
  metadata: { ...metadata, image: `ipfs://${ipfsCID}` },
  ownerKey,
})
```

---

### 6. Use Collections for Related NFTs

```typescript
// Create collection hash once
const collectionInfo = {
  name: 'Genesis Collection',
  totalSupply: 1000,
  creator: 'lotus:qz...',
}
const collectionHash = NFTUtil.hashCollection(collectionInfo)

// Mint all NFTs in collection
for (const metadata of nftList) {
  const nft = NFTUtil.createCollectionNFT(
    ownerKey.publicKey,
    collectionHash,
    metadata,
  )
  // Mint nft...
}
```

---

### 7. Test on Testnet First

```typescript
// Use testnet for development
const network = 'testnet'
const taprootScript = buildKeyPathTaproot(publicKey)
const address = taprootScript.toAddress(network)

console.log('Testnet address:', address.toString())
```

---

## Quick Reference Cheat Sheet

```typescript
// IMPORTS
import {
  Transaction,
  PrivateKey,
  Signature,
  Address,
  buildKeyPathTaproot,
  buildScriptPathTaproot,
  tweakPublicKey,
  isPayToTaproot,
  NFT,
  NFTUtil,
  // MuSig2 - High-Level API
  MuSig2Signer,
  createMuSig2Signer,
  MuSigSessionManager,
  MuSigSessionPhase,
  // MuSig2 - Low-Level
  buildMuSigTaprootKey,
  buildMuSigTaprootKeyWithScripts,
  signTaprootKeyPathWithMuSig2,
} from 'lotus-lib'

// CREATE TAPROOT OUTPUT
const script = buildKeyPathTaproot(publicKey)
const script = buildKeyPathTaproot(publicKey, stateBuffer)

// WITH SCRIPT TREE
const result = buildScriptPathTaproot(publicKey, tree)
const result = buildScriptPathTaproot(publicKey, tree, stateBuffer)

// SPEND TAPROOT
tx.from(taprootUtxo)
  .to(address, amount)
  .sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'schnorr')

// CREATE ADDRESS
const address = Address.fromTaprootCommitment(commitment, 'livenet')
const address = script.toAddress('livenet')

// CHECK SCRIPT TYPE
isPayToTaproot(script) // Function from taproot module
script.isPayToTaproot() // Method on Script class
address.isPayToTaproot() // Method on Address class (note: not isTaproot)

// EXTRACT INFO
extractTaprootCommitment(script)
extractTaprootState(script)

// NFT
const nft = new NFT({ metadata, ownerKey: publicKey })
const nft = NFT.fromScript(script, metadata, satoshis)
const transferTx = nft.transfer(newOwner, currentOwner)

// MUSIG2 - High-Level API (Recommended)
import { MuSig2Signer, createMuSig2Signer } from 'lotus-lib'

// Create signer
const signer = new MuSig2Signer({
  signers: [alice.publicKey, bob.publicKey],
  myPrivateKey: alice,
})
// Or use helper
const signer = createMuSig2Signer([alice.publicKey, bob.publicKey], alice)

// Round 1: Generate nonces
const prepare = signer.prepare(message)
// Share prepare.myPublicNonces

// Round 2: Create partial signature
const partialSig = signer.createPartialSignature(prepare, allNonces, message)
// Share partialSig

// Aggregate signatures
const finalSig = signer.sign(prepare, allNonces, message, allPartialSigs)

// Taproot MuSig2
const taprootPrep = signer.prepareTaproot()
const taprootPartialSig = signer.signTaprootInput(
  taprootPrep,
  allNonces,
  tx,
  inputIndex,
  amount,
)
const taprootSig = signer.completeTaprootSigning(
  taprootPrep,
  allNonces,
  allPartialSigs,
  tx,
  inputIndex,
  amount,
)

// MUSIG2 - Session-Based (Advanced)
import { MuSigSessionManager } from 'lotus-lib'
const manager = new MuSigSessionManager()
const session = manager.createSession(signers, myPrivateKey, message)
const nonces = manager.generateNonces(session, myPrivateKey)
manager.receiveNonce(session, signerIndex, theirNonces)
const partialSig = manager.createPartialSignature(session, myPrivateKey)
manager.receivePartialSignature(session, signerIndex, theirPartialSig)
const finalSig = manager.getFinalSignature(session)

// MUSIG2 - Low-Level Functions
const result = buildMuSigTaprootKey([alice, bob, carol])
const address = result.script.toAddress()

// CONSTANTS
Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS // 0x61
TAPROOT_SIZE_WITHOUT_STATE // 36 bytes
TAPROOT_SIZE_WITH_STATE // 69 bytes
TAPROOT_CONTROL_BASE_SIZE // 33 bytes
TAPROOT_CONTROL_MAX_SIZE // 4129 bytes

// IMPORTANT NOTES
// - Control block contains 32-byte x-coordinate (not 33-byte key)
// - State parameter is NOT part of address (only commitment is)
// - Key path requires Schnorr + SIGHASH_LOTUS (ECDSA forbidden)
// - Script path can use either Schnorr or ECDSA
```

---

## Need Help?

- 📖 **Full Docs**: See [TAPROOT_IMPLEMENTATION.md](../TAPROOT_IMPLEMENTATION.md)
- 💡 **Examples**: Check [TAPROOT_EXAMPLES.md](../TAPROOT_EXAMPLES.md)
- 🚀 **Quick Start**: Read [TAPROOT_QUICKSTART.md](../TAPROOT_QUICKSTART.md)
- 🏗️ **RANK Integration**: See [TAPROOT_RANK.md](../TAPROOT_RANK.md)

---

**Last Updated**: November 10, 2025  
**Version**: 1.1.0  
**Status**: Production Ready - Fully Compliant with lotusd

**Critical Reminders**:

**Signature Requirements:**

- ✅ Key path: MUST use Schnorr + SIGHASH_LOTUS (ECDSA forbidden)
- ✅ Script path: Can use Schnorr OR ECDSA (script determines)
- ✅ Always combine with base type: `SIGHASH_ALL | SIGHASH_LOTUS` (0x61)

**State Parameter:**

- ✅ Must be exactly 32 bytes (hash your data)
- ✅ State is NOT part of the address (only commitment is)
- ✅ Converting to address loses state (store separately)
- ✅ State pushed onto stack for script path only (not key path)

**Control Block:**

- ✅ Contains 32-byte X-coordinate (not 33-byte compressed key)
- ✅ Parity bit indicates internal pubkey Y-coordinate
- ✅ Size must be 33 + (32 × n) bytes where n ≤ 128

**SIGHASH_LOTUS:**

- ✅ Requires full UTXO info for all inputs (script + satoshis)
- ✅ Uses merkle tree commitments (not simple hashes)
- ✅ Implicitly includes SIGHASH_FORKID (0x40)

**Best Practices:**

- ✅ Always validate transactions before broadcasting
- ✅ Use key path for privacy (hides alternative scripts)
- ✅ Test on testnet first
- ✅ Check `tx.verify()` returns `true`

Happy building! 🚀
