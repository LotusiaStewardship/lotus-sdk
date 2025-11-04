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
- [Types & Interfaces](#types--interfaces)
- [Constants](#constants)
- [Transaction Integration](#transaction-integration)
- [Address Support](#address-support)
- [Common Patterns](#common-patterns)
- [Error Handling](#error-handling)

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

- `commitment` - The tweaked public key (commitment)
- `state` - Optional 32-byte state

**Returns:** P2TR script

**When to use:** When you've already computed the commitment yourself. Most developers should use `buildKeyPathTaproot()` or `buildScriptPathTaproot()` instead.

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
Byte 0:     leaf_version | parity_bit
Bytes 1-32: internal public key X-coordinate (32 bytes)
Bytes 33+:  merkle path (32 bytes per node)
```

**Note:** Parity bit in byte 0 indicates whether the internal pubkey's Y-coordinate is even (0) or odd (1). The X-coordinate is stored without the 0x02/0x03 prefix.

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

- Without state: `OP_SCRIPTTYPE OP_1 0x21 <33-byte commitment>` (36 bytes)
- With state: `OP_SCRIPTTYPE OP_1 0x21 <33-byte commitment> 0x20 <32-byte state>` (69 bytes)

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

### `buildMuSigTaprootKey()`

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
```

---

### MuSig2 Types

```typescript
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
  keyAggCoeffs: BN[]
  // Internal fields omitted
}
```

---

## Constants

```typescript
// Leaf version
TAPROOT_LEAF_TAPSCRIPT = 0xc0

// Control block sizing
TAPROOT_CONTROL_BASE_SIZE = 33
TAPROOT_CONTROL_NODE_SIZE = 32
TAPROOT_CONTROL_MAX_NODE_COUNT = 128

// Script sizing
TAPROOT_INTRO_SIZE = 3
TAPROOT_SIZE_WITHOUT_STATE = 36 // bytes
TAPROOT_SIZE_WITH_STATE = 69 // bytes

// Script type marker
TAPROOT_SCRIPTTYPE = Opcode.OP_1 // 0x51

// Signature hash type
TAPROOT_SIGHASH_TYPE = Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS

// Opcodes
OP_SCRIPTTYPE = 0x62
OP_1 = 0x51
```

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
// Output: lotus_X<base32_encoded_commitment_and_checksum>
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
}

if (address.isPayToPublicKeyHash()) {
  console.log('This is a P2PKH address')
}

if (address.isPayToScriptHash()) {
  console.log('This is a P2SH address')
}
```

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
import { buildMuSigTaprootKey } from 'lotus-lib'

const result = buildMuSigTaprootKey([
  alice.publicKey,
  bob.publicKey,
  carol.publicKey,
])

// Send to result.script.toAddress()
// Requires all 3 to cooperatively sign
// On-chain footprint: identical to single-sig!
```

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

### Common Errors and Solutions

#### "Taproot key spend signatures must use SIGHASH_LOTUS"

**Problem:** Using `SIGHASH_FORKID` instead of `SIGHASH_LOTUS`

```typescript
// ❌ Wrong
tx.sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID, 'schnorr')

// ✅ Correct
tx.sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'schnorr')
```

---

#### "Taproot key spend signature must be Schnorr"

**Problem:** Using ECDSA instead of Schnorr

```typescript
// ❌ Wrong
tx.sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'ecdsa')

// ✅ Correct
tx.sign(privateKey, Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS, 'schnorr')
```

---

#### "Not a valid Pay-To-Taproot script"

**Problem:** Trying to use Taproot functions on non-Taproot scripts

```typescript
// Check first
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
// ❌ Wrong
const state = Buffer.from('hello', 'utf8') // Only 5 bytes

// ✅ Correct - Always 32 bytes
const state = Hash.sha256(Buffer.from('hello', 'utf8'))
const script = buildKeyPathTaproot(publicKey, state)
```

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
  buildMuSigTaprootKey,
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
isPayToTaproot(script)
script.isPayToTaproot()
address.isTaproot()

// EXTRACT INFO
extractTaprootCommitment(script)
extractTaprootState(script)

// NFT
const nft = new NFT({ metadata, ownerKey: publicKey })
const nft = NFT.fromScript(script, metadata, satoshis)
const transferTx = nft.transfer(newOwner, currentOwner)

// MUSIG2
const result = buildMuSigTaprootKey([alice, bob, carol])
const address = result.script.toAddress()

// CONSTANTS
Signature.SIGHASH_ALL | Signature.SIGHASH_LOTUS // 0x61
TAPROOT_SIZE_WITHOUT_STATE // 36 bytes
TAPROOT_SIZE_WITH_STATE // 69 bytes
```

---

## Need Help?

- 📖 **Full Docs**: See [TAPROOT_IMPLEMENTATION.md](../TAPROOT_IMPLEMENTATION.md)
- 💡 **Examples**: Check [TAPROOT_EXAMPLES.md](../TAPROOT_EXAMPLES.md)
- 🚀 **Quick Start**: Read [TAPROOT_QUICKSTART.md](../TAPROOT_QUICKSTART.md)
- 🏗️ **RANK Integration**: See [TAPROOT_RANK.md](../TAPROOT_RANK.md)

---

**Last Updated**: November 3, 2025  
**Version**: 1.0.0  
**Status**: Production Ready

**Remember**:

- ✅ Always use `SIGHASH_LOTUS` with Taproot
- ✅ Always use Schnorr signatures for key path
- ✅ State parameter must be exactly 32 bytes
- ✅ Verify transactions before broadcasting

Happy building! 🚀
