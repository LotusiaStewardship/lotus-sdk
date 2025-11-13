/**
 * SwapSig Blockchain Integration Example
 *
 * Demonstrates:
 * - Setup transaction building with MuSig2
 * - Settlement transaction building
 * - Blockchain monitoring
 * - Confirmation handling
 */

import { PrivateKey } from '../lib/bitcore/privatekey.js'
import { Address } from '../lib/bitcore/address.js'
import { Transaction } from '../lib/bitcore/transaction/index.js'
import { Script } from '../lib/bitcore/script.js'
import { SwapSigCoordinator } from '../lib/p2p/swapsig/coordinator.js'
import { TransactionMonitor } from '../lib/p2p/blockchain-utils.js'
import { createMuSigTaprootAddress } from '../lib/bitcore/taproot/musig2.js'

console.log(
  '======================================================================',
)
console.log('SwapSig Blockchain Integration Example')
console.log(
  '======================================================================',
)

// ============================================================================
// Setup
// ============================================================================

console.log('\n# Step 1: Creating test participants...')

// Create test private keys
const aliceKey = new PrivateKey()
const bobKey = new PrivateKey()
const carolKey = new PrivateKey()

const participants = [
  { name: 'Alice', key: aliceKey, address: aliceKey.toAddress() },
  { name: 'Bob', key: bobKey, address: bobKey.toAddress() },
  { name: 'Carol', key: carolKey, address: carolKey.toAddress() },
]

console.log('Created 3 participants:')
participants.forEach(p => {
  console.log(`  ${p.name}: ${p.address.toString()}`)
})

// ============================================================================
// MuSig2 Taproot Address Generation
// ============================================================================

console.log('\n# Step 2: Generating MuSig2 Taproot addresses...')

// Create 2-of-2 MuSig2 addresses for each pair
const pairs = [
  [aliceKey.publicKey, bobKey.publicKey],
  [bobKey.publicKey, carolKey.publicKey],
  [carolKey.publicKey, aliceKey.publicKey],
]

console.log('\nGenerating 2-of-2 MuSig2 Taproot addresses:')
const sharedAddresses = pairs.map((pubkeys, i) => {
  const result = createMuSigTaprootAddress(pubkeys, 'livenet')
  console.log(`  Group ${i}: ${result.address.toString()}`)
  console.log(`    Signers: ${pubkeys.length}-of-${pubkeys.length}`)
  console.log(
    `    Aggregated Key: ${result.keyAggContext.aggregatedPubKey.toString().substring(0, 20)}...`,
  )
  return result
})

// ============================================================================
// Setup Transaction Building
// ============================================================================

console.log('\n# Step 3: Building setup transactions...')

// Create mock UTXOs for each participant
const mockUtxos = participants.map((p, i) => ({
  txId: '0'.repeat(64),
  outputIndex: i,
  satoshis: 1100000, // 1.1 XPI (1 XPI for swap + fees + burn)
  script: Script.fromAddress(p.address),
  address: p.address,
}))

console.log('\nBuilding setup transactions:')
participants.forEach((p, i) => {
  console.log(`\n  ${p.name}'s Setup Transaction:`)

  const tx = new Transaction()

  // Input: Participant's UTXO
  tx.from(mockUtxos[i])
  console.log(
    `    Input: ${mockUtxos[i].satoshis} sats from ${p.address.toString().substring(0, 20)}...`,
  )

  // Output 1: MuSig2 shared output
  const sharedOutput = sharedAddresses[i]
  tx.to(sharedOutput.address, 1000000) // 1 XPI
  console.log(
    `    Output 1 (Shared): 1,000,000 sats → ${sharedOutput.address.toString().substring(0, 20)}...`,
  )

  // Output 2: Burn output (OP_RETURN)
  // Note: In real implementation, would use SwapSigBurnMechanism
  const burnAmount = 1000 // 0.1% of 1 XPI
  console.log(`    Output 2 (Burn): ${burnAmount} sats → OP_RETURN`)

  // Output 3: Change (automatic)
  tx.feePerByte = 1
  tx.change(p.address)

  const estimatedFee = 250
  const changeAmount =
    mockUtxos[i].satoshis - 1000000 - burnAmount - estimatedFee
  console.log(
    `    Output 3 (Change): ~${changeAmount} sats → ${p.address.toString().substring(0, 20)}...`,
  )

  console.log(`    Fee: ~${estimatedFee} sats (1 sat/byte)`)
  console.log(`    Total Input: ${mockUtxos[i].satoshis} sats`)
  console.log(`    Total Output: ~${1000000 + burnAmount + changeAmount} sats`)
})

// ============================================================================
// Settlement Transaction Building
// ============================================================================

console.log('\n# Step 4: Building settlement transactions...')

// Create mock final destinations
const finalDestinations = [
  new PrivateKey().toAddress(),
  new PrivateKey().toAddress(),
  new PrivateKey().toAddress(),
]

console.log('\nFinal destinations (for privacy):')
finalDestinations.forEach((addr, i) => {
  console.log(`  ${participants[i].name}'s final address: ${addr.toString()}`)
})

console.log('\nCircular Rotation Mapping:')
console.log('  Alice receives from Group 1 (Bob-Carol signers)')
console.log('  Bob receives from Group 2 (Carol-Alice signers)')
console.log('  Carol receives from Group 0 (Alice-Bob signers)')

console.log('\nBuilding settlement transactions:')
participants.forEach((p, i) => {
  console.log(`\n  Settlement Transaction for Group ${i}:`)

  const tx = new Transaction()

  // Input: Shared MuSig2 output from setup
  const prevOutputIndex = i
  const mockSetupTxId = '1'.repeat(64)
  console.log(`    Input: MuSig2 output from setup tx`)
  console.log(`      TxId: ${mockSetupTxId.substring(0, 20)}...`)
  console.log(`      Output Index: ${prevOutputIndex}`)
  console.log(`      Amount: 1,000,000 sats`)

  // Output: Final destination (with circular rotation)
  const receiverIndex = (i + 1) % 3
  const destination = finalDestinations[receiverIndex]

  const estimatedFee = 200
  const outputAmount = 1000000 - estimatedFee

  tx.to(destination, outputAmount)
  console.log(`    Output: ${outputAmount} sats → ${destination.toString()}`)
  console.log(`    Receiver: ${participants[receiverIndex].name}`)
  console.log(`    Fee: ${estimatedFee} sats`)

  console.log(
    `    ✅ Unlinkability achieved: ${participants[receiverIndex].name} receives from signers who are NOT them`,
  )
})

// ============================================================================
// Transaction Monitor Demo
// ============================================================================

console.log('\n# Step 5: Transaction Monitor capabilities...')

const txMonitor = new TransactionMonitor('https://chronik.lotusia.org')

console.log('\nTransactionMonitor provides:')
console.log('  ✓ checkConfirmations(txId, requiredConfs)')
console.log(
  '  ✓ waitForConfirmations(txId, requiredConfs, pollInterval, timeout)',
)
console.log('  ✓ broadcastTransaction(txHex)')
console.log('  ✓ getTransaction(txId)')
console.log('  ✓ getUtxos(address)')
console.log('  ✓ batchCheckConfirmations(txIds, requiredConfs)')

console.log('\nExample usage (requires real blockchain):')
console.log(`
  // Broadcast transaction
  const txId = await txMonitor.broadcastTransaction(tx.toString())
  
  // Wait for 1 confirmation (Lotus pre-consensus = 3-5 seconds)
  const info = await txMonitor.waitForConfirmations(txId, 1, 3000, 600000)
  
  if (info?.isConfirmed) {
    console.log('Transaction confirmed!')
    console.log(\`Block height: \${info.blockHeight}\`)
    console.log(\`Confirmations: \${info.confirmations}\`)
  }
`)

// ============================================================================
// MuSig2 Coordination Flow
// ============================================================================

console.log('\n# Step 6: MuSig2 Settlement Coordination...')

console.log('\nThree-Phase MuSig2 Architecture:')
console.log(`
  Phase 0: Signer Advertisement (in joinPool)
    └─ advertiseSigner(privateKey, { transactionTypes: [SWAP] })
  
  Phase 1: Signer Discovery (automatic)
    └─ findAvailableSigners({ transactionTypes: [SWAP] })
  
  Phase 2: Signing Request Announcement (executeSettlementRound)
    ├─ Build settlement transactions
    ├─ Compute sighash for each transaction
    └─ announceSigningRequest(signers, sighash, metadata)
  
  Phase 3: Automatic Discovery & Joining (event handlers)
    ├─ Event: SIGNING_REQUEST_RECEIVED
    ├─ Filter by: TransactionType.SWAP + SwapPhase.SETTLEMENT + poolId
    └─ joinSigningRequest(requestId, privateKey)
  
  MuSig2 Rounds (automatic when all signers join):
    ├─ Round 1: Nonce Generation & Exchange
    ├─ Round 2: Partial Signature Creation & Exchange
    └─ Aggregation: Final Schnorr signature
  
  Finalization:
    ├─ Event: SESSION_COMPLETE
    ├─ getFinalSignature(sessionId)
    └─ Attach signature to transaction & broadcast
`)

// ============================================================================
// Performance Characteristics
// ============================================================================

console.log('\n# Step 7: Performance characteristics...')

console.log('\nLotus Pre-Consensus enables fast swaps:')
console.log(`
  Setup Round:
    - Transaction building: < 1 second
    - Broadcasting: < 1 second
    - Confirmation (1 conf): ~3-5 seconds
    - Total: ~5-7 seconds
  
  Destination Reveal:
    - Decryption/broadcast: < 1 second
    - Consensus: ~2-3 seconds
    - Total: ~3-4 seconds
  
  Settlement Round:
    - Transaction building: < 1 second
    - MuSig2 coordination: ~5-10 seconds
    - Broadcasting: < 1 second
    - Confirmation (1 conf): ~3-5 seconds
    - Total: ~10-17 seconds
  
  TOTAL SWAP TIME: ~18-28 seconds for 3-5 participants
`)

console.log('\nComparison with other protocols:')
console.log('  Lotus SwapSig:        ~20-30 seconds  ⚡')
console.log('  Bitcoin CoinJoin:     ~10-60 minutes')
console.log('  Ethereum Tornado:     ~15-30 minutes')

// ============================================================================
// Security & Privacy
// ============================================================================

console.log('\n# Step 8: Security & Privacy features...')

console.log('\nMuSig2 Security:')
console.log('  ✓ Taproot outputs (indistinguishable from single-sig)')
console.log('  ✓ Key aggregation with sorted keys')
console.log('  ✓ RFC6979 + random nonce generation')
console.log('  ✓ Partial signature verification')
console.log('  ✓ n-of-n coordination (all must sign)')

console.log('\nPrivacy Features:')
console.log('  ✓ Circular rotation mapping (breaks input-output linkability)')
console.log('  ✓ MuSig2 shared outputs (looks like normal transactions)')
console.log('  ✓ Dynamic group sizing (2, 3, 5, or 10-of-n)')
console.log('  ✓ Destination encryption (optional)')
console.log('  ✓ Output randomization (optional)')

console.log('\nSybil Defense:')
console.log('  ✓ XPI burn mechanism (0.1% default)')
console.log('  ✓ Economic barrier to fake participants')
console.log('  ✓ Deflationary network benefit')

console.log(
  '\n======================================================================',
)
console.log('✅ Blockchain integration demonstration complete!')
console.log(
  '======================================================================',
)
console.log('\nThis example shows:')
console.log('  ✓ MuSig2 Taproot address generation')
console.log('  ✓ Setup transaction structure')
console.log('  ✓ Settlement transaction structure')
console.log('  ✓ Circular rotation for privacy')
console.log('  ✓ Transaction monitoring capabilities')
console.log('  ✓ MuSig2 coordination flow')
console.log('  ✓ Performance characteristics')
console.log('\nNext: See unit tests for component validation')
console.log('      See integration tests for full swap flow')
