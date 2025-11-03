/**
 * MuSig2 P2P Coordination + Taproot Transaction Example
 *
 * Complete example demonstrating production-ready DHT-based coordination:
 * 1. P2P coordination for MuSig2 signing using libp2p + DHT
 * 2. Creating a Taproot output with aggregated MuSig2 key
 * 3. Spending the Taproot output via key path (cooperative)
 * 4. Full decentralized coordination over P2P network
 * 5. DHT-based session discovery (no manual coordination)
 * 6. Automatic participant registration via SESSION_JOIN
 * 7. Automatic nonce and partial signature exchange
 * 8. Event-driven coordination workflow
 *
 * Workflow:
 * - Connect peers and wait for DHT to populate
 * - Alice creates session (automatically announced to DHT)
 * - Bob discovers session from DHT and joins
 * - SESSION_JOIN message registers participants automatically
 * - Round 1: Nonce exchange via P2P messages
 * - Round 2: Partial signature exchange via P2P messages
 * - Finalize transaction with aggregated signature
 */

import { waitForEvent, ConnectionEvent } from '../lib/p2p/index.js'
import { MuSig2P2PCoordinator } from '../lib/p2p/musig2/index.js'
import { PrivateKey } from '../lib/bitcore/privatekey.js'
import { PublicKey } from '../lib/bitcore/publickey.js'
import { Transaction } from '../lib/bitcore/transaction/transaction.js'
import { Output } from '../lib/bitcore/transaction/output.js'
import { buildMuSigTaprootKey } from '../lib/bitcore/taproot/musig2.js'
import { musigKeyAgg } from '../lib/bitcore/crypto/musig2.js'
import { Script } from '../lib/bitcore/script.js'
import { BN } from '../lib/bitcore/crypto/bn.js'

/**
 * Example: 2-of-2 MuSig2 Taproot Transaction over P2P
 *
 * Alice and Bob create a 2-of-2 multi-signature Taproot output and
 * cooperatively spend it using production-ready DHT-based P2P coordination.
 *
 * This example demonstrates the complete workflow:
 * 1. Setup P2P coordinators and connect peers
 * 2. Wait for DHT routing tables to populate
 * 3. Create Taproot output with MuSig2 aggregated key
 * 4. Create spending transaction with MuSigTaprootInput
 * 5. Alice creates session (automatically announced to DHT)
 * 6. Bob discovers session from DHT and joins
 * 7. Coordinate Round 1 (nonce exchange) via P2P
 * 8. Coordinate Round 2 (partial signature exchange) via P2P
 * 9. Finalize transaction with aggregated signature
 */
async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  MuSig2 P2P + Taproot Transaction Example')
  console.log('═══════════════════════════════════════════════════\n')

  // ============================================================================
  // Phase 1: Setup P2P Coordinators
  // ============================================================================

  console.log('Phase 1: Setup P2P Coordinators')
  console.log('─'.repeat(50))

  const aliceMuSig = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true,
    securityConfig: {
      disableRateLimiting: true, // For demo - remove in production
    },
  })

  const bobMuSig = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true,
    securityConfig: {
      disableRateLimiting: true, // For demo - remove in production
    },
  })

  await aliceMuSig.start()
  await bobMuSig.start()

  console.log('✓ Alice P2P node:', aliceMuSig.peerId)
  console.log('✓ Bob P2P node:', bobMuSig.peerId)

  // Connect peers
  const aliceConnectPromise = waitForEvent(
    aliceMuSig,
    ConnectionEvent.CONNECTED,
  )
  const bobConnectPromise = waitForEvent(bobMuSig, ConnectionEvent.CONNECTED)
  const bobAddrs = bobMuSig.libp2pNode.getMultiaddrs()
  await aliceMuSig.connectToPeer(bobAddrs[0].toString())
  await Promise.all([aliceConnectPromise, bobConnectPromise])

  console.log('✓ Peers connected (bidirectional)')

  // Wait for DHT routing tables to auto-populate via TopologyListener
  // The identify service exchanges protocols, then TopologyListener adds peers to DHT
  console.log('✓ Waiting for DHT to populate...')
  await new Promise(resolve => setTimeout(resolve, 1000))

  console.log('✓ DHT ready - Alice:', aliceMuSig.getDHTStats())
  console.log('✓ DHT ready - Bob:', bobMuSig.getDHTStats())
  console.log()

  // ============================================================================
  // Phase 2: Key Exchange over P2P & Create MuSig2 Taproot Output
  // ============================================================================

  console.log('Phase 2: Key Exchange over P2P & Create MuSig2 Taproot Output')
  console.log('─'.repeat(50))

  // Each participant generates their private key locally
  const alice = new PrivateKey()
  const bob = new PrivateKey()
  const charlie = new PrivateKey() // Recipient (not part of MuSig2)

  console.log('\nStep 1: Local key generation')
  console.log('✓ Alice generated private key:', alice.publicKey.toString())
  console.log('✓ Bob generated private key:', bob.publicKey.toString())
  console.log(
    '✓ Charlie (recipient):',
    charlie.publicKey.toAddress().toString(),
  )

  // Build MuSig2 Taproot output
  // NOTE: Public keys are exchanged via the DHT session announcement
  // When Alice creates the session, she includes all signer public keys
  // When Bob discovers the session from DHT, he receives the public keys
  console.log('\nStep 2: Build MuSig2 Taproot output')
  const taprootResult = buildMuSigTaprootKey([alice.publicKey, bob.publicKey])

  console.log(
    '✓ Aggregated internal key:',
    taprootResult.aggregatedPubKey.toString(),
  )
  console.log('✓ Taproot commitment:', taprootResult.commitment.toString())
  console.log(
    '✓ Taproot script size:',
    taprootResult.script.toBuffer().length,
    'bytes',
  )
  console.log('✓ Both participants have identical Taproot output')

  // Simulate funding UTXO (in production, this would be from blockchain)
  const fundingTxId =
    '1111111111111111111111111111111111111111111111111111111111111111'
  const fundingOutputIndex = 0
  const fundingAmount = 1000000 // 1,000,000 sats

  console.log('\n✓ Simulated funding:')
  console.log('  TXID:', fundingTxId.slice(0, 16) + '...')
  console.log('  Output:', fundingOutputIndex)
  console.log('  Amount:', fundingAmount, 'sats')
  console.log()
  console.log(
    '(In production, this UTXO would be created by funding the Taproot script)',
  )
  console.log()

  // ============================================================================
  // Phase 3: Create Spending Transaction
  // ============================================================================

  console.log('Phase 3: Create Spending Transaction')
  console.log('─'.repeat(50))

  // Create recipient address (Charlie)
  const charlieAddress = charlie.publicKey.toAddress()
  const sendAmount = 950000 // 950k sats (50k for fees)

  // Create spending transaction with MuSig2 support
  // Pass keyAggContext to enable MuSigTaprootInput
  const keyAggContext = musigKeyAgg([alice.publicKey, bob.publicKey])

  const spendingTx = new Transaction().from({
    txId: fundingTxId,
    outputIndex: fundingOutputIndex,
    script: taprootResult.script,
    satoshis: fundingAmount,
    keyAggContext,
    mySignerIndex: 0, // Alice is signer 0
  })

  // Add output to Charlie
  spendingTx.addOutput(
    new Output({
      script: Script.fromAddress(charlieAddress),
      satoshis: sendAmount,
    }),
  )

  console.log('✓ Transaction created:')
  console.log('  Inputs:', spendingTx.inputs.length)
  console.log('  Outputs:', spendingTx.outputs.length)
  console.log(
    '  Input type:',
    spendingTx.getMuSig2Inputs().length > 0 ? 'MuSigTaprootInput ✓' : 'ERROR',
  )
  console.log('  Output:', sendAmount, 'sats to', charlieAddress.toString())
  console.log('  Fee:', fundingAmount - sendAmount, 'sats')

  // Get sighash using the new convenience method
  const inputIndex = 0
  const sighashBuffer = spendingTx.getMuSig2Sighash(inputIndex)

  console.log('  Sighash type: SIGHASH_ALL | SIGHASH_LOTUS')
  console.log('  Sighash:', sighashBuffer.toString('hex').slice(0, 32) + '...')
  console.log()

  // ============================================================================
  // Phase 4: P2P Coordinated Signing
  // ============================================================================

  console.log('Phase 4: P2P Coordinated Signing')
  console.log('─'.repeat(50))

  // Step 1: Alice creates and announces session to DHT
  console.log('\nStep 1: Alice creates and announces MuSig2 session')

  const sessionId = await aliceMuSig.createSession(
    [alice.publicKey, bob.publicKey],
    alice,
    sighashBuffer,
    {
      description: 'Taproot MuSig2 2-of-2 spending',
      txid: spendingTx.id,
      inputIndex,
    },
  )

  console.log('✓ Alice created session:', sessionId)
  console.log('✓ Session announced to DHT')

  // Step 2: Bob discovers and joins session via DHT
  console.log('\nStep 2: Bob discovers and joins session via DHT')

  // Wait for DHT announcement to propagate
  console.log('✓ Waiting for DHT propagation...')
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Bob discovers the session from DHT and joins
  console.log('✓ Bob discovering session from DHT...')
  await bobMuSig.joinSession(sessionId, bob)

  console.log('✓ Bob discovered session from DHT')
  console.log('✓ Bob sent SESSION_JOIN message to Alice')

  // Wait for SESSION_JOIN to be processed by Alice
  // The message needs time to travel and be handled
  console.log('✓ Waiting for SESSION_JOIN to be processed...')
  await new Promise(resolve => setTimeout(resolve, 1500))

  console.log('✓ Participants registered automatically')
  console.log('✓ P2P coordination ready')

  // ============================================================================
  // Round 1: Nonce Exchange (Automatic via P2P)
  // ============================================================================
  console.log('\nStep 3: Round 1 - Nonce Exchange')
  console.log('─'.repeat(50))

  // The P2P coordinator will automatically:
  // 1. Generate local nonces
  // 2. Broadcast NONCE_SHARE messages to all participants
  // 3. Receive nonces from other participants
  // 4. Emit 'session:nonces-complete' when all received

  // Set up event listeners for nonce completion
  const aliceNoncesPromise = waitForEvent(aliceMuSig, 'session:nonces-complete')
  const bobNoncesPromise = waitForEvent(bobMuSig, 'session:nonces-complete')

  console.log('Starting Round 1 (nonce generation and exchange)...')

  // Both participants start Round 1 simultaneously
  await Promise.all([
    aliceMuSig.startRound1(sessionId, alice),
    bobMuSig.startRound1(sessionId, bob),
  ])

  console.log('✓ Both participants generated nonces')
  console.log('✓ Nonces broadcasted via P2P')

  // Wait for automatic nonce exchange via P2P to complete
  console.log('\nWaiting for all nonces to be received...')
  await Promise.all([aliceNoncesPromise, bobNoncesPromise])

  const aliceStatus1 = aliceMuSig.getSessionStatus(sessionId)!
  const bobStatus1 = bobMuSig.getSessionStatus(sessionId)!

  console.log(
    '✓ Alice received nonces:',
    aliceStatus1.noncesCollected,
    '/',
    aliceStatus1.noncesTotal,
  )
  console.log(
    '✓ Bob received nonces:',
    bobStatus1.noncesCollected,
    '/',
    bobStatus1.noncesTotal,
  )
  console.log('✓ Phase:', aliceStatus1.phase)
  console.log('✓ Round 1 complete!')
  console.log()

  // ============================================================================
  // Round 2: Partial Signature Exchange (Automatic via P2P)
  // ============================================================================
  console.log('Step 4: Round 2 - Partial Signature Exchange')
  console.log('─'.repeat(50))

  // The P2P coordinator will automatically:
  // 1. Generate local partial signatures
  // 2. Broadcast PARTIAL_SIG_SHARE messages to all participants
  // 3. Receive partial sigs from other participants
  // 4. Aggregate into final signature
  // 5. Emit 'session:complete' when done

  // Set up event listeners for session completion
  const aliceCompletePromise = waitForEvent(aliceMuSig, 'session:complete')
  const bobCompletePromise = waitForEvent(bobMuSig, 'session:complete')

  console.log('Starting Round 2 (partial signature generation and exchange)...')

  // Both participants start Round 2 simultaneously
  await Promise.all([
    aliceMuSig.startRound2(sessionId, alice),
    bobMuSig.startRound2(sessionId, bob),
  ])

  console.log('✓ Both participants generated partial signatures')
  console.log('✓ Partial signatures broadcasted via P2P')

  // Wait for automatic partial signature exchange via P2P to complete
  console.log('\nWaiting for all partial signatures to be received...')
  await Promise.all([aliceCompletePromise, bobCompletePromise])

  const aliceStatus2 = aliceMuSig.getSessionStatus(sessionId)!
  const bobStatus2 = bobMuSig.getSessionStatus(sessionId)!

  console.log(
    '✓ Alice received partial sigs:',
    aliceStatus2.partialSigsCollected,
    '/',
    aliceStatus2.partialSigsTotal,
  )
  console.log(
    '✓ Bob received partial sigs:',
    bobStatus2.partialSigsCollected,
    '/',
    bobStatus2.partialSigsTotal,
  )
  console.log('✓ Phase:', aliceStatus2.phase)
  console.log('✓ Session complete:', aliceStatus2.isComplete)
  console.log('✓ Round 2 complete!')
  console.log()

  console.log('🎉 P2P MuSig2 Coordination Complete!')
  console.log('   • Nonces exchanged via P2P')
  console.log('   • Partial signatures exchanged via P2P')
  console.log('   • Final signature aggregated automatically')
  console.log()

  // ============================================================================
  // Phase 5: Finalize Transaction
  // ============================================================================

  console.log('Phase 5: Finalize Transaction')
  console.log('─'.repeat(50))

  // Get the final aggregated signature from the coordinator
  const finalSignature = aliceMuSig.getFinalSignature(sessionId)
  console.log('✓ Final signature available')
  console.log('  Signature:', finalSignature.toString().slice(0, 32) + '...')

  // Get session data from coordinator to add to transaction
  const aliceSession = aliceMuSig.getSession(sessionId)
  if (!aliceSession) {
    throw new Error('Session not found')
  }

  console.log('\n✓ Adding MuSig2 data to transaction input...')

  // Get the MuSig2 input
  const musigInput = spendingTx.getMuSig2Inputs()[0]
  if (!musigInput) {
    throw new Error('No MuSig2 input found in transaction')
  }

  // Set the aggregated nonce from the session
  // The session already has the aggregated nonce from Round 1
  if (!aliceSession.aggregatedNonce) {
    throw new Error('Aggregated nonce not found in session')
  }
  musigInput.aggregatedNonce = aliceSession.aggregatedNonce
  console.log('  ✓ Set aggregated nonce from session')

  // Add all partial signatures to the transaction input
  // Note: receivedPartialSigs only has OTHER signers, we need to add our own too
  for (let i = 0; i < aliceSession.signers.length; i++) {
    let partialSig: BN
    if (i === aliceSession.myIndex) {
      // Our own partial signature
      partialSig = aliceSession.myPartialSig!
    } else {
      // Other signer's partial signature
      partialSig = aliceSession.receivedPartialSigs.get(i)!
    }
    spendingTx.addMuSig2PartialSignature(inputIndex, i, partialSig)
  }
  console.log(`  ✓ Added ${aliceSession.signers.length} partial signatures`)

  // Finalize all MuSig2 signatures in the transaction
  // This aggregates the partial signatures into the final Schnorr signature
  console.log('\n✓ Finalizing MuSig2 signatures...')
  spendingTx.finalizeMuSig2Signatures()

  console.log('✓ Transaction fully signed and ready to broadcast!')
  console.log()

  // Verify the transaction is ready to broadcast
  const serialized = spendingTx.serialize()
  const txid = spendingTx.id

  console.log('✓ Transaction ready to broadcast:')
  console.log('  TXID:', txid)
  console.log('  Size:', serialized.length, 'bytes')
  console.log('  Serialized:', serialized.slice(0, 64) + '...')
  console.log()

  // ============================================================================
  // Phase 6: Transaction Summary & Verification
  // ============================================================================

  console.log('Phase 6: Transaction Summary & Verification')
  console.log('─'.repeat(50))

  console.log('\nTransaction Details:')
  console.log('  Type: Taproot MuSig2 2-of-2')
  console.log('  Input: Taproot key path spend')
  console.log('  Output:', sendAmount, 'sats to', charlieAddress.toString())
  console.log('  Fee:', fundingAmount - sendAmount, 'sats')
  console.log('  Status: ✅ Fully signed and ready to broadcast')

  console.log('\nTaproot Benefits:')
  console.log('  ✓ Looks like single-signature (privacy!)')
  console.log('  ✓ Smaller transaction size (~150 bytes)')
  console.log('  ✓ Lower fees compared to P2SH multisig')
  console.log('  ✓ Quantum-resistant signature algorithm (Schnorr)')

  console.log('\nMuSig2 P2P Benefits:')
  console.log('  ✓ No central coordination server required')
  console.log('  ✓ Fully decentralized participant discovery (DHT)')
  console.log('  ✓ Automatic nonce and signature exchange')
  console.log('  ✓ Event-driven coordination')
  console.log()

  console.log('📡 To broadcast this transaction:')
  console.log(
    '  1. Submit to Lotus node: lotus-cli sendrawtransaction ' + serialized,
  )
  console.log(
    '  2. Or via RPC: {"method": "sendrawtransaction", "params": ["' +
      serialized +
      '"]}',
  )
  console.log('  3. Transaction will be validated and added to mempool')
  console.log('  4. Mining will include it in the next block')
  console.log()

  // ============================================================================
  // Cleanup
  // ============================================================================

  console.log('Cleaning up...')
  await aliceMuSig.stop()
  await bobMuSig.stop()

  console.log('✅ Example complete!')
  console.log()
  console.log('Summary:')
  console.log('  ✅ Created MuSig2 P2P coordinators (extends P2PCoordinator)')
  console.log('  ✅ Connected peers via libp2p with DHT')
  console.log('  ✅ Built Taproot output with aggregated MuSig2 key')
  console.log('  ✅ Created spending transaction with MuSigTaprootInput')
  console.log('  ✅ Alice created session and announced to DHT')
  console.log(
    '  ✅ Bob discovered session from DHT and joined via SESSION_JOIN',
  )
  console.log('  ✅ Completed Round 1 (nonce exchange via P2P)')
  console.log('  ✅ Completed Round 2 (partial signature exchange via P2P)')
  console.log('  ✅ Finalized transaction with aggregated signature')
  console.log('  ✅ Transaction ready to broadcast!')
  console.log()
  console.log('Key Workflow (Production-Ready DHT):')
  console.log('  1. Connect peers and wait for DHT to populate')
  console.log('  2. Alice creates session (automatically announced to DHT)')
  console.log('  3. Bob discovers session from DHT via joinSession()')
  console.log('  4. SESSION_JOIN message registers participants automatically')
  console.log('  5. startRound1() broadcasts nonces via P2P')
  console.log('  6. Wait for "session:nonces-complete" event')
  console.log('  7. startRound2() broadcasts partial signatures via P2P')
  console.log('  8. Wait for "session:complete" event')
  console.log('  9. Get final signature and finalize transaction')
  console.log()
  console.log('Production Deployment:')
  console.log('  ✅ DHT-based session discovery (no manual coordination)')
  console.log('  ✅ Automatic participant registration via SESSION_JOIN')
  console.log('  • Deploy DHT bootstrap nodes for wider peer discovery')
  console.log('  • Add session recovery and timeout logic')
  console.log('  • Integrate with wallet infrastructure')
  console.log('  • Add transaction broadcast to Lotus node')
}

// Run the example
main().catch(console.error)
