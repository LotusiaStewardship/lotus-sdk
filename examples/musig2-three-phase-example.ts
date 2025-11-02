/**
 * MuSig2 Three-Phase Architecture Example
 *
 * Demonstrates the new peer discovery and dynamic session building
 *
 * Usage:
 *   npx tsx examples/musig2-three-phase-example.ts
 */

import { MuSig2P2PCoordinator } from '../lib/p2p/musig2/coordinator.js'
import { PrivateKey } from '../lib/bitcore/privatekey.js'
import { PublicKey } from '../lib/bitcore/publickey.js'

// ============================================================================
// Example: Complete Three-Phase MuSig2 Coordination
// ============================================================================

async function threePhaseExample() {
  console.log('=== MuSig2 Three-Phase Architecture Example ===\n')

  // Create three wallets
  const aliceKey = new PrivateKey()
  const bobKey = new PrivateKey()
  const charlieKey = new PrivateKey()

  // Create coordinators for each wallet
  const aliceCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: false,
  })

  const bobCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: false,
  })

  const charlieCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: false,
  })

  // Start all coordinators
  await Promise.all([
    aliceCoordinator.start(),
    bobCoordinator.start(),
    charlieCoordinator.start(),
  ])

  console.log('✅ All coordinators started')
  console.log(`   Alice: ${aliceCoordinator.peerId}`)
  console.log(`   Bob: ${bobCoordinator.peerId}`)
  console.log(`   Charlie: ${charlieCoordinator.peerId}\n`)

  // Connect wallets
  const aliceAddrs = aliceCoordinator.getStats().multiaddrs
  const bobAddrs = bobCoordinator.getStats().multiaddrs

  await Promise.all([
    bobCoordinator.connectToPeer(aliceAddrs[0]),
    charlieCoordinator.connectToPeer(aliceAddrs[0]),
    charlieCoordinator.connectToPeer(bobAddrs[0]),
  ])

  console.log('✅ Wallets connected\n')

  await new Promise(resolve => setTimeout(resolve, 500))

  // ========================================================================
  // PHASE 0: Signer Advertisement
  // ========================================================================

  console.log('--- PHASE 0: Signer Advertisement ---\n')

  // Bob and Charlie advertise their availability
  await Promise.all([
    bobCoordinator.advertiseSigner(
      bobKey,
      {
        transactionTypes: ['spend', 'swap'],
        minAmount: 1_000_000, // 1 XPI
        maxAmount: 50_000_000, // 50 XPI
      },
      {
        ttl: 24 * 60 * 60 * 1000,
        metadata: {
          nickname: 'BobWallet',
          description: 'Available for spend and swap transactions',
          fees: 0,
        },
      },
    ),
    charlieCoordinator.advertiseSigner(
      charlieKey,
      {
        transactionTypes: ['spend', 'custody'],
        minAmount: 10_000_000, // 10 XPI
        maxAmount: 100_000_000, // 100 XPI
      },
      {
        metadata: {
          nickname: 'CharlieCustody',
          description: 'Professional custody service',
          fees: 10000, // 10k satoshis per signature
        },
      },
    ),
  ])

  console.log('✅ Bob and Charlie advertised their availability')

  await new Promise(resolve => setTimeout(resolve, 300))

  // ========================================================================
  // PHASE 1: Matchmaking & Discovery
  // ========================================================================

  console.log('\n--- PHASE 1: Matchmaking & Discovery ---\n')

  // Alice wants to create a 3-of-3 multisig for a 5 XPI spend transaction
  console.log('Alice needs 2 co-signers for a 5 XPI spend transaction...')

  const availableSigners = await aliceCoordinator.findAvailableSigners({
    transactionType: 'spend',
    maxAmount: 5_000_000,
    maxResults: 10,
  })

  console.log(`✅ Found ${availableSigners.length} available signers:`)
  availableSigners.forEach(signer => {
    console.log(
      `   - ${signer.metadata?.nickname || 'Unknown'}: ${signer.publicKey.toString().slice(0, 20)}...`,
    )
    console.log(`     Types: ${signer.criteria.transactionTypes.join(', ')}`)
    console.log(`     Fees: ${signer.metadata?.fees || 0} satoshis`)
  })

  // Alice selects Bob (first available signer matching criteria)
  const selectedSigner = availableSigners[0]

  console.log(`\n✅ Alice selected: ${selectedSigner.metadata?.nickname}\n`)

  // ========================================================================
  // PHASE 2: Signing Request Creation
  // ========================================================================

  console.log('--- PHASE 2: Signing Request Creation ---\n')

  // Now Alice knows the public keys!
  const requiredPublicKeys = [
    aliceKey.publicKey,
    selectedSigner.publicKey,
    charlieKey.publicKey, // MuSig2 = 3-of-3 (all must sign)
  ]

  console.log('Public keys assembled:')
  console.log(`   1. Alice: ${aliceKey.publicKey.toString().slice(0, 20)}...`)
  console.log(
    `   2. ${selectedSigner.metadata?.nickname}: ${selectedSigner.publicKey.toString().slice(0, 20)}...`,
  )
  console.log(
    `   3. Charlie: ${charlieKey.publicKey.toString().slice(0, 20)}...\n`,
  )

  // Create transaction message (simplified)
  const transactionMessage = Buffer.from(
    'Transaction: Send 5 XPI to recipient',
    'utf8',
  )

  console.log('Creating signing request...')
  console.log('Note: MuSig2 requires ALL 3 participants to sign (n-of-n)\n')

  const requestId = await aliceCoordinator.announceSigningRequest(
    requiredPublicKeys,
    transactionMessage,
    aliceKey,
    {
      metadata: {
        amount: 5_000_000, // 5 XPI
        transactionType: 'spend',
        purpose: 'Send funds to recipient',
      },
    },
  )

  console.log(`✅ Signing request created: ${requestId}`)
  console.log('   Participants required: 3-of-3 (all must sign)')
  console.log('   Amount: 5 XPI\n')

  await new Promise(resolve => setTimeout(resolve, 300))

  // ========================================================================
  // PHASE 3: Dynamic Session Building
  // ========================================================================

  console.log('--- PHASE 3: Dynamic Session Building ---\n')

  // Bob discovers the signing request
  console.log('Bob checking for signing requests...')
  const bobRequests = await bobCoordinator.findSigningRequestsForMe(
    bobKey.publicKey,
  )

  console.log(`✅ Bob found ${bobRequests.length} signing request(s)`)

  if (bobRequests.length > 0) {
    const request = bobRequests[0]
    console.log(`   Request ID: ${request.requestId}`)
    console.log(`   Amount: ${request.metadata?.amount} satoshis`)
    console.log(`   Purpose: ${request.metadata?.purpose}`)
    console.log(
      `   Participants required: ${request.requiredPublicKeys.length}-of-${request.requiredPublicKeys.length} (MuSig2 = n-of-n)\n`,
    )

    // Bob joins the request
    console.log('Bob joining signing request...')

    await bobCoordinator.joinSigningRequest(request.requestId, bobKey)

    console.log('✅ Bob joined the signing request')
    console.log('   Participants: 2/3 (need all 3 for MuSig2)\n')
  }

  await new Promise(resolve => setTimeout(resolve, 300))

  // Charlie discovers the request
  console.log('Charlie checking for signing requests...')
  const charlieRequests = await charlieCoordinator.findSigningRequestsForMe(
    charlieKey.publicKey,
  )

  console.log(`✅ Charlie found ${charlieRequests.length} signing request(s)`)

  // Setup event listeners before Charlie joins (threshold will be met)
  const aliceReadyPromise = new Promise(resolve => {
    aliceCoordinator.once('session:ready', sessionId => {
      console.log(`\n🎉 Alice: Session ready! ${sessionId}`)
      resolve(sessionId)
    })
  })

  const bobReadyPromise = new Promise(resolve => {
    bobCoordinator.once('session:ready', sessionId => {
      console.log(`🎉 Bob: Session ready! ${sessionId}`)
      resolve(sessionId)
    })
  })

  const charlieReadyPromise = new Promise(resolve => {
    charlieCoordinator.once('session:ready', sessionId => {
      console.log(`🎉 Charlie: Session ready! ${sessionId}`)
      resolve(sessionId)
    })
  })

  if (charlieRequests.length > 0) {
    const request = charlieRequests[0]

    console.log('Charlie joining signing request...')

    await charlieCoordinator.joinSigningRequest(request.requestId, charlieKey)

    console.log('✅ Charlie joined the signing request')
    console.log('   Participants: 3/3')
    console.log('   All participants joined! (MuSig2 = n-of-n)\n')
  }

  // Wait for session ready on all participants
  await Promise.all([aliceReadyPromise, bobReadyPromise, charlieReadyPromise])

  console.log('\n✅ Session ready on all participants!')
  console.log('   Can now proceed with MuSig2 signing protocol\n')

  // ========================================================================
  // Cleanup
  // ========================================================================

  console.log('--- Cleanup ---\n')

  await Promise.all([
    aliceCoordinator.stop(),
    bobCoordinator.stop(),
    charlieCoordinator.stop(),
  ])

  console.log('✅ All coordinators stopped\n')

  console.log('=== Example Complete ===\n')
  console.log('Summary:')
  console.log('  Phase 0: Bob & Charlie advertised availability')
  console.log('  Phase 1: Alice discovered available signers')
  console.log('  Phase 2: Alice created signing request with discovered keys')
  console.log('  Phase 3: Bob & Charlie joined dynamically')
  console.log('  Result: Session ready for MuSig2 signing! 🎉')
}

// ============================================================================
// Example: Wallet Availability Advertisement
// ============================================================================

async function advertisementExample() {
  console.log('\n=== Signer Advertisement Example ===\n')

  const coordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
  })

  await coordinator.start()

  const myKey = new PrivateKey()

  console.log('Advertising wallet availability...\n')

  // Advertise for multiple transaction types
  await coordinator.advertiseSigner(
    myKey,
    {
      transactionTypes: ['spend', 'swap', 'coinjoin'],
      minAmount: 1_000_000, // 1 XPI minimum
      maxAmount: 1_000_000_000, // 1000 XPI maximum
    },
    {
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      metadata: {
        nickname: 'MyLotusWallet',
        description: 'Multi-purpose wallet, responsive, privacy-focused',
        fees: 0,
        responseTime: 30000, // 30 seconds average
        reputation: {
          score: 95,
          completedSignings: 150,
          failedSignings: 2,
          averageResponseTime: 25000,
          verifiedIdentity: false,
        },
      },
    },
  )

  console.log('✅ Advertisement published to DHT and P2P network')
  console.log('   Public Key:', myKey.publicKey.toString())
  console.log('   Transaction Types: spend, swap, coinjoin')
  console.log('   Amount Range: 1 - 1000 XPI')
  console.log('   TTL: 24 hours\n')

  // Later, withdraw advertisement
  setTimeout(async () => {
    console.log('Withdrawing advertisement...')
    await coordinator.withdrawAdvertisement()
    console.log('✅ Advertisement withdrawn\n')

    await coordinator.stop()
  }, 1000)
}

// ============================================================================
// Example: Discovery and Matchmaking
// ============================================================================

async function matchmakingExample() {
  console.log('\n=== Matchmaking Example ===\n')

  const coordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
  })

  await coordinator.start()

  console.log('Finding available co-signers for a 10 XPI swap...\n')

  // Search for signers
  const signers = await coordinator.findAvailableSigners({
    transactionType: 'swap',
    minAmount: 10_000_000, // 10 XPI
    maxAmount: 10_000_000,
    maxResults: 5,
  })

  console.log(`Found ${signers.length} available signers:\n`)

  signers.forEach((signer, idx) => {
    console.log(`${idx + 1}. ${signer.metadata?.nickname || 'Anonymous'}`)
    console.log(`   Public Key: ${signer.publicKey.toString().slice(0, 30)}...`)
    console.log(
      `   Transaction Types: ${signer.criteria.transactionTypes.join(', ')}`,
    )
    console.log(`   Fees: ${signer.metadata?.fees || 0} satoshis`)
    console.log(`   Reputation: ${signer.metadata?.reputation?.score || 'N/A'}`)
    console.log(
      `   Completed Signings: ${signer.metadata?.reputation?.completedSignings || 0}`,
    )
    console.log('')
  })

  if (signers.length >= 2) {
    console.log('✅ Sufficient signers found for 2-of-3 multisig\n')
  } else {
    console.log('⚠️  Not enough signers available\n')
  }

  await coordinator.stop()
}

// ============================================================================
// Example: Event-Driven Discovery
// ============================================================================

async function eventDrivenExample() {
  console.log('\n=== Event-Driven Discovery Example ===\n')

  const coordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
  })

  await coordinator.start()

  const myKey = new PrivateKey()

  console.log('Setting up event listeners...\n')

  // Listen for signing requests
  coordinator.on('signing-request:received', request => {
    const myPubKeyStr = myKey.publicKey.toString()
    const isMyKeyRequired = request.requiredPublicKeys.some(
      (pk: PublicKey) => pk.toString() === myPubKeyStr,
    )

    if (isMyKeyRequired) {
      console.log('📬 New signing request received!')
      console.log(`   Request ID: ${request.requestId}`)
      console.log(`   Amount: ${request.metadata?.amount || 'N/A'} satoshis`)
      console.log(`   Type: ${request.metadata?.transactionType || 'N/A'}`)
      console.log(
        `   Threshold: ${request.threshold}-of-${request.requiredPublicKeys.length}`,
      )
      console.log('   ✅ Your signature is required!\n')

      // User would approve here
      // await coordinator.joinSigningRequest(request.requestId, myKey)
    }
  })

  // Listen for new signer advertisements
  coordinator.on('signer:discovered', advertisement => {
    console.log('👤 New signer discovered!')
    console.log(
      `   Nickname: ${advertisement.metadata?.nickname || 'Anonymous'}`,
    )
    console.log(
      `   Public Key: ${advertisement.publicKey.toString().slice(0, 30)}...`,
    )
    console.log(
      `   Types: ${advertisement.criteria.transactionTypes.join(', ')}`,
    )
    console.log('')
  })

  // Listen for session ready
  coordinator.on('session:ready', sessionId => {
    console.log('🎉 Session ready for signing!')
    console.log(`   Session ID: ${sessionId}`)
    console.log('   Can now start Round 1 (nonce exchange)\n')
  })

  console.log('✅ Event listeners configured')
  console.log('   Waiting for events... (simulated)\n')

  await new Promise(resolve => setTimeout(resolve, 2000))

  await coordinator.stop()
}

// ============================================================================
// Run Examples
// ============================================================================

async function main() {
  try {
    // Run full three-phase example
    await threePhaseExample()

    // Run advertisement example
    await advertisementExample()

    await new Promise(resolve => setTimeout(resolve, 1500))

    // Run matchmaking example
    await matchmakingExample()

    // Run event-driven example
    await eventDrivenExample()

    console.log('\n✅ All examples completed successfully!')
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
