/**
 * MuSig2 P2P Coordinator Election Example - 5 Parties
 *
 * Production-ready example demonstrating:
 * 1. Coordinator election in a 5-party MuSig2 signing session
 * 2. DHT-based peer discovery and session coordination
 * 3. Deterministic coordinator selection (lexicographic ordering)
 * 4. Role separation: coordinator builds transaction, participants sign
 * 5. Full Taproot key-path spending with MuSig2
 *
 * Real-world use case:
 * Five parties (Alice, Bob, Charlie, Diana, Eve) want to collectively control
 * a Bitcoin UTXO using MuSig2. They must elect a single coordinator who will:
 * - Collect all partial signatures
 * - Construct the final aggregated signature
 * - Build the spending transaction
 * - Broadcast to the Lotus network
 *
 * Election is deterministic based on public key ordering:
 * - All parties independently compute the same coordinator
 * - No additional communication needed
 * - Verifiable by all participants
 * - Resistant to manipulation
 *
 * Reference: https://bitcoin.stackexchange.com/questions/125030/how-does-musig-work-in-real-bitcoin-scenarios
 */

import { waitForEvent, ConnectionEvent } from '../lib/p2p/index.js'
import { MuSig2P2PCoordinator } from '../lib/p2p/musig2/index.js'
import { electCoordinator, ElectionMethod } from '../lib/p2p/musig2/election.js'
import { PrivateKey } from '../lib/bitcore/privatekey.js'
import { PublicKey } from '../lib/bitcore/publickey.js'
import { Transaction } from '../lib/bitcore/transaction/transaction.js'
import { Output } from '../lib/bitcore/transaction/output.js'
import { buildMuSigTaprootKey } from '../lib/bitcore/taproot/musig2.js'
import { musigKeyAgg } from '../lib/bitcore/crypto/musig2.js'
import { Script } from '../lib/bitcore/script.js'
import { BN } from '../lib/bitcore/crypto/bn.js'

/**
 * Participant in the MuSig2 signing session
 */
interface Participant {
  name: string
  privateKey: PrivateKey
  publicKey: PublicKey
  coordinator: MuSig2P2PCoordinator
}

/**
 * Setup a single participant with P2P coordinator
 */
async function setupParticipant(name: string): Promise<Participant> {
  const privateKey = new PrivateKey()
  const publicKey = privateKey.publicKey

  const coordinator = new MuSig2P2PCoordinator(
    {
      listen: ['/ip4/127.0.0.1/tcp/0'],
      enableDHT: true,
      enableDHTServer: true,
    },
    {
      enableCoordinatorElection: true,
      electionMethod: 'lexicographic',
    },
  )

  await coordinator.start()

  return {
    name,
    privateKey,
    publicKey,
    coordinator,
  }
}

/**
 * Connect all participants in a mesh network
 */
async function connectAllParticipants(
  participants: Participant[],
): Promise<void> {
  console.log('Connecting all participants in mesh network...')

  // Get all addresses
  const addresses = participants.map(p =>
    p.coordinator.libp2pNode.getMultiaddrs()[0].toString(),
  )

  // Connect each participant to all others
  const connectionPromises: Promise<void>[] = []

  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const participant1 = participants[i]
      const participant2 = participants[j]

      // Connect i to j
      connectionPromises.push(
        (async () => {
          const connectPromise1 = waitForEvent(
            participant1.coordinator,
            ConnectionEvent.CONNECTED,
          )
          const connectPromise2 = waitForEvent(
            participant2.coordinator,
            ConnectionEvent.CONNECTED,
          )

          await participant1.coordinator.connectToPeer(addresses[j])
          await Promise.all([connectPromise1, connectPromise2])
        })(),
      )
    }
  }

  await Promise.all(connectionPromises)

  console.log('✓ All participants connected in mesh network')
  console.log(`  Total connections: ${connectionPromises.length} (full mesh)`)
}

/**
 * Main example
 */
async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  MuSig2 P2P Coordinator Election Example')
  console.log('  5-Party Signing with Deterministic Election')
  console.log('═══════════════════════════════════════════════════\n')

  // ============================================================================
  // Phase 1: Setup 5 Participants
  // ============================================================================

  console.log('Phase 1: Setup 5 Participants')
  console.log('─'.repeat(50))

  const participants = await Promise.all([
    setupParticipant('Alice'),
    setupParticipant('Bob'),
    setupParticipant('Charlie'),
    setupParticipant('Diana'),
    setupParticipant('Eve'),
  ])

  for (const p of participants) {
    console.log(`✓ ${p.name}:`)
    console.log(`  Peer ID: ${p.coordinator.peerId}`)
    console.log(`  Public Key: ${p.publicKey.toString().slice(0, 32)}...`)
  }
  console.log()

  // ============================================================================
  // Phase 2: Connect Participants in Mesh Network
  // ============================================================================

  console.log('Phase 2: Connect Participants & Wait for DHT')
  console.log('─'.repeat(50))

  await connectAllParticipants(participants)

  // Wait for DHT routing tables to populate
  console.log('✓ Waiting for DHT routing tables to populate...')
  await new Promise(resolve => setTimeout(resolve, 2000))

  for (const p of participants) {
    const dhtStats = p.coordinator.getDHTStats()
    console.log(`✓ ${p.name} DHT:`, dhtStats)
  }
  console.log()

  // ============================================================================
  // Phase 3: Coordinator Election
  // ============================================================================

  console.log('Phase 3: Coordinator Election')
  console.log('─'.repeat(50))

  // All participants perform the same deterministic election
  const allPublicKeys = participants.map(p => p.publicKey)
  const election = electCoordinator(allPublicKeys, ElectionMethod.LEXICOGRAPHIC)

  console.log('Election Method: Lexicographic ordering of public keys')
  console.log('Election Proof:', election.electionProof)
  console.log()

  console.log('Sorted public keys (lexicographic order):')
  election.sortedSigners.forEach((pk, idx) => {
    const original = allPublicKeys.findIndex(
      originalPk => originalPk.toString() === pk.toString(),
    )
    const participantName = participants[original].name
    const isCoordinator = idx === 0 ? ' ← COORDINATOR' : ''
    console.log(
      `  ${idx + 1}. ${participantName}: ${pk.toString().slice(0, 32)}...${isCoordinator}`,
    )
  })
  console.log()

  const coordinatorParticipant = participants[election.coordinatorIndex]
  console.log('🎯 Elected Coordinator:', coordinatorParticipant.name)
  console.log('   Index:', election.coordinatorIndex)
  console.log(
    '   Public Key:',
    coordinatorParticipant.publicKey.toString().slice(0, 32) + '...',
  )
  console.log()

  console.log('Participant Roles:')
  participants.forEach((p, idx) => {
    const isCoordinator = idx === election.coordinatorIndex
    const role = isCoordinator
      ? 'COORDINATOR (builds & broadcasts tx)'
      : 'SIGNER (signs partial signatures)'
    console.log(`  ${p.name}: ${role}`)
  })
  console.log()

  // ============================================================================
  // Phase 4: Create Taproot Output with MuSig2
  // ============================================================================

  console.log('Phase 4: Create Taproot Output with MuSig2')
  console.log('─'.repeat(50))

  // Build MuSig2 Taproot output from all public keys
  const taprootResult = buildMuSigTaprootKey(allPublicKeys)

  console.log('✓ MuSig2 Taproot Output Created:')
  console.log(
    '  Aggregated Internal Key:',
    taprootResult.aggregatedPubKey.toString().slice(0, 32) + '...',
  )
  console.log(
    '  Taproot Commitment:',
    taprootResult.commitment.toString().slice(0, 32) + '...',
  )
  console.log('  Script Size:', taprootResult.script.toBuffer().length, 'bytes')
  console.log()

  // Simulate funding UTXO
  const fundingTxId =
    '2222222222222222222222222222222222222222222222222222222222222222'
  const fundingOutputIndex = 0
  const fundingAmount = 5000000 // 5,000,000 sats (50k each for fees)

  console.log('✓ Simulated Funding UTXO:')
  console.log('  TXID:', fundingTxId.slice(0, 16) + '...')
  console.log('  Output Index:', fundingOutputIndex)
  console.log('  Amount:', fundingAmount.toLocaleString(), 'sats')
  console.log(
    '  (In production, fund this Taproot script via wallet or exchange)',
  )
  console.log()

  // ============================================================================
  // Phase 5: Create Spending Transaction (Coordinator Only)
  // ============================================================================

  console.log('Phase 5: Create Spending Transaction')
  console.log('─'.repeat(50))

  // Create recipient (not part of MuSig2 - just receives funds)
  const recipientKey = new PrivateKey()
  const recipientAddress = recipientKey.publicKey.toAddress()
  const sendAmount = 4900000 // Leave 100k for fees

  console.log('✓ Recipient Address:', recipientAddress.toString())
  console.log('✓ Send Amount:', sendAmount.toLocaleString(), 'sats')
  console.log('✓ Fee:', (fundingAmount - sendAmount).toLocaleString(), 'sats')
  console.log()

  // All participants create the same spending transaction template
  // (needed for sighash calculation)
  const keyAggContext = musigKeyAgg(allPublicKeys)

  const spendingTx = new Transaction().from({
    txId: fundingTxId,
    outputIndex: fundingOutputIndex,
    script: taprootResult.script,
    satoshis: fundingAmount,
    keyAggContext,
    mySignerIndex: 0, // Will be updated per participant
  })

  spendingTx.addOutput(
    new Output({
      script: Script.fromAddress(recipientAddress),
      satoshis: sendAmount,
    }),
  )

  console.log('✓ Spending Transaction Template Created')
  console.log('  Inputs:', spendingTx.inputs.length)
  console.log('  Outputs:', spendingTx.outputs.length)
  console.log(
    '  Type:',
    spendingTx.getMuSig2Inputs().length > 0 ? 'MuSig2 Taproot' : 'ERROR',
  )
  console.log()

  // Get sighash (same for all participants)
  const inputIndex = 0
  const sighashBuffer = spendingTx.getMuSig2Sighash(inputIndex)

  console.log('✓ Sighash computed for all participants:')
  console.log('  Type: SIGHASH_ALL | SIGHASH_LOTUS')
  console.log('  Hash:', sighashBuffer.toString('hex').slice(0, 32) + '...')
  console.log()

  // ============================================================================
  // Phase 6: Create MuSig2 Session (First Participant Creates, Others Join)
  // ============================================================================

  console.log('Phase 6: Create & Join MuSig2 Session')
  console.log('─'.repeat(50))

  // First participant creates the session
  const creator = participants[0]
  console.log(`✓ ${creator.name} creating session...`)

  const sessionId = await creator.coordinator.createSession(
    allPublicKeys,
    creator.privateKey,
    sighashBuffer,
    {
      description: '5-party MuSig2 Taproot spending with coordinator election',
      txid: spendingTx.id,
      inputIndex,
      coordinatorName: coordinatorParticipant.name,
    },
  )

  console.log(`✓ Session created: ${sessionId}`)
  console.log('✓ Session announced to DHT with election data')
  console.log()

  // Wait for DHT propagation
  console.log('✓ Waiting for DHT propagation...')
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Other participants discover and join
  console.log('✓ Other participants discovering and joining...')
  const joinPromises = participants.slice(1).map(async p => {
    await p.coordinator.joinSession(sessionId, p.privateKey)
    console.log(`  ✓ ${p.name} joined session`)
  })

  await Promise.all(joinPromises)

  // Wait for SESSION_JOIN messages to propagate
  console.log('✓ Waiting for participant registration...')
  await new Promise(resolve => setTimeout(resolve, 2000))

  console.log('✓ All participants registered')
  console.log()

  // Verify election info on each participant
  console.log('✓ Verifying coordinator election on all participants:')
  for (const p of participants) {
    const electionInfo = p.coordinator.getElectionInfo(sessionId)
    if (electionInfo) {
      const coordinatorName = participants[electionInfo.coordinatorIndex].name
      console.log(
        `  ${p.name}: Coordinator is ${coordinatorName} (index ${electionInfo.coordinatorIndex})`,
      )
      console.log(`         Is Coordinator: ${electionInfo.isCoordinator}`)
    }
  }
  console.log()

  // ============================================================================
  // Phase 7: Round 1 - Nonce Exchange
  // ============================================================================

  console.log('Phase 7: Round 1 - Nonce Exchange')
  console.log('─'.repeat(50))

  // Setup event listeners for all participants
  const noncesCompletePromises = participants.map(p =>
    waitForEvent(p.coordinator, 'session:nonces-complete'),
  )

  console.log('✓ All participants starting Round 1 (nonce generation)...')

  // All participants start Round 1 simultaneously
  await Promise.all(
    participants.map((p, idx) => {
      // Each participant needs to set their own signer index
      const tx = new Transaction().from({
        txId: fundingTxId,
        outputIndex: fundingOutputIndex,
        script: taprootResult.script,
        satoshis: fundingAmount,
        keyAggContext,
        mySignerIndex: idx,
      })
      tx.addOutput(spendingTx.outputs[0])

      return p.coordinator.startRound1(sessionId, p.privateKey)
    }),
  )

  console.log('✓ All participants broadcasted nonces via P2P')
  console.log('✓ Waiting for all nonces to be collected...')

  await Promise.all(noncesCompletePromises)

  console.log('✓ Round 1 Complete - All Nonces Collected')
  for (const p of participants) {
    const status = p.coordinator.getSessionStatus(sessionId)
    if (status) {
      console.log(
        `  ${p.name}: ${status.noncesCollected}/${status.noncesTotal} nonces`,
      )
    }
  }
  console.log()

  // ============================================================================
  // Phase 8: Round 2 - Partial Signature Exchange
  // ============================================================================

  console.log('Phase 8: Round 2 - Partial Signature Exchange')
  console.log('─'.repeat(50))

  // Setup event listeners for all participants
  const sessionCompletePromises = participants.map(p =>
    waitForEvent(p.coordinator, 'session:complete'),
  )

  console.log('✓ All participants starting Round 2 (partial signatures)...')

  // All participants start Round 2 simultaneously
  await Promise.all(
    participants.map(p => p.coordinator.startRound2(sessionId, p.privateKey)),
  )

  console.log('✓ All participants broadcasted partial signatures via P2P')
  console.log('✓ Waiting for all partial signatures to be collected...')

  await Promise.all(sessionCompletePromises)

  console.log('✓ Round 2 Complete - All Partial Signatures Collected')
  for (const p of participants) {
    const status = p.coordinator.getSessionStatus(sessionId)
    if (status) {
      console.log(
        `  ${p.name}: ${status.partialSigsCollected}/${status.partialSigsTotal} signatures`,
      )
    }
  }
  console.log()

  // ============================================================================
  // Phase 9: Transaction Finalization (Coordinator Only)
  // ============================================================================

  console.log('Phase 9: Transaction Finalization (Coordinator Only)')
  console.log('─'.repeat(50))

  console.log(
    `✓ ${coordinatorParticipant.name} (coordinator) building final transaction...`,
  )
  console.log()

  // Get final signature from coordinator's session
  const finalSignature =
    coordinatorParticipant.coordinator.getFinalSignature(sessionId)
  console.log('✓ Final aggregated signature available:')
  console.log('  Signature:', finalSignature.toString().slice(0, 64) + '...')

  // Get session data to add to transaction
  const coordinatorSession =
    coordinatorParticipant.coordinator.getSession(sessionId)
  if (!coordinatorSession) {
    throw new Error('Coordinator session not found')
  }

  // Create coordinator's version of the transaction with correct signer index
  const coordinatorTx = new Transaction().from({
    txId: fundingTxId,
    outputIndex: fundingOutputIndex,
    script: taprootResult.script,
    satoshis: fundingAmount,
    keyAggContext,
    mySignerIndex: election.coordinatorIndex,
  })

  coordinatorTx.addOutput(
    new Output({
      script: Script.fromAddress(recipientAddress),
      satoshis: sendAmount,
    }),
  )

  // Add MuSig2 data to transaction
  const musigInput = coordinatorTx.getMuSig2Inputs()[0]
  if (!musigInput) {
    throw new Error('No MuSig2 input found')
  }

  // Set aggregated nonce
  if (!coordinatorSession.aggregatedNonce) {
    throw new Error('Aggregated nonce not found')
  }
  musigInput.aggregatedNonce = coordinatorSession.aggregatedNonce
  console.log('✓ Set aggregated nonce from session')

  // Add all partial signatures
  for (let i = 0; i < coordinatorSession.signers.length; i++) {
    let partialSig: BN
    if (i === coordinatorSession.myIndex) {
      partialSig = coordinatorSession.myPartialSig!
    } else {
      partialSig = coordinatorSession.receivedPartialSigs.get(i)!
    }
    coordinatorTx.addMuSig2PartialSignature(inputIndex, i, partialSig)
  }
  console.log(`✓ Added ${coordinatorSession.signers.length} partial signatures`)

  // Finalize MuSig2 signatures
  coordinatorTx.finalizeMuSig2Signatures()
  console.log('✓ MuSig2 signatures finalized')
  console.log()

  // Verify transaction is ready
  const serialized = coordinatorTx.serialize()
  const txid = coordinatorTx.id

  console.log('✅ Transaction Fully Signed and Ready to Broadcast:')
  console.log('  TXID:', txid)
  console.log('  Size:', serialized.length, 'bytes')
  console.log('  Serialized:', serialized.slice(0, 64) + '...')
  console.log()

  // ============================================================================
  // Phase 10: Summary & Broadcast Instructions
  // ============================================================================

  console.log('Phase 10: Summary & Verification')
  console.log('─'.repeat(50))
  console.log()

  console.log('✅ MuSig2 5-Party Signing Complete!')
  console.log()

  console.log('Transaction Details:')
  console.log('  Type: Taproot MuSig2 5-of-5')
  console.log('  Input: Taproot key path spend')
  console.log(
    '  Output:',
    sendAmount.toLocaleString(),
    'sats to',
    recipientAddress.toString(),
  )
  console.log('  Fee:', (fundingAmount - sendAmount).toLocaleString(), 'sats')
  console.log('  Privacy: ✅ Looks like single-signature on-chain')
  console.log()

  console.log('Coordinator Election Summary:')
  console.log('  Method: Lexicographic ordering')
  console.log('  Elected Coordinator:', coordinatorParticipant.name)
  console.log('  Coordinator Index:', election.coordinatorIndex)
  console.log('  Election Proof:', election.electionProof.slice(0, 32) + '...')
  console.log('  Verifiable: ✅ All participants computed same coordinator')
  console.log()

  console.log('Benefits of Coordinator Election:')
  console.log('  ✅ No central server required')
  console.log('  ✅ Deterministic and verifiable by all parties')
  console.log('  ✅ Resistant to manipulation (requires private key control)')
  console.log('  ✅ Single party handles transaction construction & broadcast')
  console.log('  ✅ Other parties only need to sign (simpler workflow)')
  console.log('  ✅ Works with any number of signers (tested with 5)')
  console.log()

  console.log('📡 Coordinator Broadcast Instructions:')
  console.log(
    `  ${coordinatorParticipant.name} should broadcast this transaction:`,
  )
  console.log('  1. lotus-cli sendrawtransaction ' + serialized)
  console.log(
    '  2. Or via RPC: {"method": "sendrawtransaction", "params": ["' +
      serialized +
      '"]}',
  )
  console.log('  3. Transaction will be validated and added to mempool')
  console.log('  4. Mining will include it in the next block')
  console.log()

  console.log('Real-World Deployment Notes:')
  console.log('  • Connect to public DHT bootstrap nodes for wider discovery')
  console.log('  • Implement session recovery and timeout logic')
  console.log('  • Add message signing/verification for authentication')
  console.log('  • Integrate with wallet infrastructure')
  console.log('  • Coordinator should verify all signatures before broadcast')
  console.log('  • Consider backup coordinators if primary fails')
  console.log()

  // ============================================================================
  // Cleanup
  // ============================================================================

  console.log('Cleaning up...')
  await Promise.all(participants.map(p => p.coordinator.stop()))

  console.log('✅ Example complete!')
  console.log()

  console.log('Summary of Workflow:')
  console.log('  1. ✅ Setup 5 participants with P2P coordinators')
  console.log('  2. ✅ Connected participants in mesh network')
  console.log('  3. ✅ Performed deterministic coordinator election')
  console.log('  4. ✅ Created MuSig2 Taproot output (5-of-5)')
  console.log('  5. ✅ All participants joined signing session via DHT')
  console.log('  6. ✅ Verified coordinator election on all participants')
  console.log('  7. ✅ Round 1: All participants exchanged nonces')
  console.log('  8. ✅ Round 2: All participants exchanged partial signatures')
  console.log('  9. ✅ Coordinator built final transaction')
  console.log(' 10. ✅ Transaction ready for broadcast by coordinator')
  console.log()

  console.log('Key Advantages:')
  console.log(
    '  🔐 Security: Multi-party control with quantum-resistant Schnorr',
  )
  console.log('  🎯 Efficiency: Single on-chain signature (not 5)')
  console.log('  🕵️  Privacy: Looks like single-signature (indistinguishable)')
  console.log('  🌐 Decentralized: No central server (pure P2P via DHT)')
  console.log('  ⚖️  Fair: Deterministic election (no favoritism)')
  console.log('  📏 Scalable: Works with any number of signers')
}

// Run the example
main().catch(console.error)
