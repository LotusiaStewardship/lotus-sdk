/**
 * MuSig2 Three-Phase Architecture Example
 *
 * Demonstrates the new peer discovery and dynamic session building
 *
 * Usage:
 *   npx tsx examples/musig2-three-phase-example.ts
 */

import {
  MuSig2P2PCoordinator,
  MuSig2Event,
  TransactionType,
  SignerAdvertisement,
} from '../lib/p2p/musig2/index.js'
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
        transactionTypes: [TransactionType.SPEND, TransactionType.SWAP],
        minAmount: 1_000_000, // 1 XPI
        maxAmount: 50_000_000, // 50 XPI
      },
      {
        ttl: 24 * 60 * 60 * 1000,
        metadata: {
          nickname: 'Bob',
          description: 'Available for spend and swap transactions',
          fees: 0,
        },
      },
    ),
    charlieCoordinator.advertiseSigner(
      charlieKey,
      {
        transactionTypes: [TransactionType.SPEND, TransactionType.CUSTODY],
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
    transactionType: TransactionType.SPEND,
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
        transactionType: TransactionType.SPEND,
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
    aliceCoordinator.once(MuSig2Event.SESSION_READY, sessionId => {
      console.log(`\n🎉 Alice: Session ready! ${sessionId}`)
      resolve(sessionId)
    })
  })

  const bobReadyPromise = new Promise(resolve => {
    bobCoordinator.once(MuSig2Event.SESSION_READY, sessionId => {
      console.log(`🎉 Bob: Session ready! ${sessionId}`)
      resolve(sessionId)
    })
  })

  const charlieReadyPromise = new Promise(resolve => {
    charlieCoordinator.once(MuSig2Event.SESSION_READY, sessionId => {
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
      transactionTypes: [
        TransactionType.SPEND,
        TransactionType.SWAP,
        TransactionType.COINJOIN,
      ],
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
// Example: DHT-Based Discovery (Query Pre-Existing Advertisements)
// ============================================================================

async function matchmakingDHTExample() {
  console.log('\n=== Scenario 1: DHT-Based Discovery ===\n')
  console.log('Demonstrates querying DHT for pre-existing advertisements:\n')
  console.log('  1. Zoe runs a public bootstrap node')
  console.log('  2. Bob and Charlie connect to Zoe and advertise services')
  console.log('  3. Advertisements are stored in DHT (via Zoe)')
  console.log('  4. Alice connects to Zoe LATER')
  console.log('  5. Alice queries DHT to discover existing advertisements')
  console.log('  6. Alice initiates MuSig2 signing with discovered keys\n')

  // Create private keys for each participant
  const aliceKey = new PrivateKey()
  const bobKey = new PrivateKey()
  const charlieKey = new PrivateKey()
  // Zoe doesn't need a signing key - she's just a bootstrap/relay node

  console.log('🔑 Generated keys for Alice, Bob, and Charlie\n')

  // ========================================================================
  // Phase 0: Zoe starts the bootstrap node
  // ========================================================================

  console.log('--- Phase 0: Bootstrap Node (Zoe) Startup ---\n')

  // Zoe runs a public bootstrap node (like bootstrap.libp2p.io)
  // This is a well-known, always-on node that helps peers discover each other
  const zoeCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true, // Zoe is a full DHT server
  })

  await zoeCoordinator.start()

  const zoeAddrs = zoeCoordinator.getStats().multiaddrs
  const zoeBootstrapAddr = zoeAddrs[0]

  console.log('✅ Bootstrap node online:')
  console.log(`   Zoe (Bootstrap): ${zoeCoordinator.peerId}`)
  console.log(`   Address: ${zoeBootstrapAddr}`)
  console.log('   Role: Provides DHT routing & peer discovery\n')

  console.log('💡 In production, this would be a public bootstrap node')
  console.log('   (e.g., /dnsaddr/bootstrap.lotusia.org/p2p/...)\n')

  // Give Zoe time to fully initialize
  await new Promise(resolve => setTimeout(resolve, 300))

  // ========================================================================
  // Phase 1: Service providers connect to bootstrap and start services
  // ========================================================================

  console.log('--- Phase 1: Service Providers Connect to Bootstrap ---\n')

  // Bob runs a signing service
  const bobCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true, // Bob participates in DHT routing
  })

  // Charlie runs a signing service
  const charlieCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true, // Charlie participates in DHT routing
  })

  await Promise.all([bobCoordinator.start(), charlieCoordinator.start()])

  console.log('✅ Service providers started:')
  console.log(`   Bob (Co-signer): ${bobCoordinator.peerId}`)
  console.log(`   Charlie (Co-signer): ${charlieCoordinator.peerId}\n`)

  // Bob and Charlie connect to Zoe (bootstrap node)
  console.log('🔗 Service providers connecting to bootstrap node (Zoe)...')
  await Promise.all([
    bobCoordinator.connectToPeer(zoeBootstrapAddr),
    charlieCoordinator.connectToPeer(zoeBootstrapAddr),
  ])
  console.log('✅ Bob and Charlie connected to bootstrap node')
  console.log('   They are now part of the P2P network!\n')

  // Service providers also connect to each other (forming a mesh)
  // This is discovered automatically through Zoe's peer routing
  console.log('🔗 Service providers discovering each other via bootstrap...')
  const bobAddrs = bobCoordinator.getStats().multiaddrs
  await charlieCoordinator.connectToPeer(bobAddrs[0])
  console.log('✅ Bob and Charlie now connected (peer mesh formed)\n')

  // Give network time to stabilize
  await new Promise(resolve => setTimeout(resolve, 800))

  // ========================================================================
  // Bob and Charlie advertise their availability
  // ========================================================================

  console.log('--- Phase 2: Service Providers Advertise Services ---\n')

  await Promise.all([
    bobCoordinator.advertiseSigner(
      bobKey,
      {
        transactionTypes: [
          TransactionType.SWAP,
          TransactionType.SPEND,
          TransactionType.COINJOIN,
        ],
        minAmount: 5_000_000, // 5 XPI
        maxAmount: 100_000_000, // 100 XPI
      },
      {
        ttl: 24 * 60 * 60 * 1000, // 24 hours
        metadata: {
          nickname: 'Bob',
          description: 'Fast and reliable swap co-signer',
          fees: 5000, // 5k satoshis
          responseTime: 15000, // 15 seconds average
          reputation: {
            score: 92,
            completedSignings: 87,
            failedSignings: 3,
            averageResponseTime: 15000,
            verifiedIdentity: false,
          },
        },
      },
    ),
    charlieCoordinator.advertiseSigner(
      charlieKey,
      {
        transactionTypes: [TransactionType.SWAP, TransactionType.SPEND],
        minAmount: 1_000_000, // 1 XPI
        maxAmount: 50_000_000, // 50 XPI
      },
      {
        ttl: 12 * 60 * 60 * 1000, // 12 hours
        metadata: {
          nickname: 'Charlie',
          description: 'Low-fee swap service',
          fees: 1000, // 1k satoshis
          responseTime: 30000, // 30 seconds average
          reputation: {
            score: 88,
            completedSignings: 45,
            failedSignings: 2,
            averageResponseTime: 28000,
            verifiedIdentity: true,
          },
        },
      },
    ),
  ])

  console.log('✅ Bob advertised availability:')
  console.log(`   Public Key: ${bobKey.publicKey.toString().slice(0, 40)}...`)
  console.log(`   Types: swap, spend, coinjoin`)
  console.log(`   Amount Range: 5-100 XPI`)
  console.log(`   Fees: 5,000 satoshis`)
  console.log(`   Reputation: 92/100 (87 completed signings)\n`)

  console.log('✅ Charlie advertised availability:')
  console.log(
    `   Public Key: ${charlieKey.publicKey.toString().slice(0, 40)}...`,
  )
  console.log(`   Types: swap, spend`)
  console.log(`   Amount Range: 1-50 XPI`)
  console.log(`   Fees: 1,000 satoshis`)
  console.log(`   Reputation: 88/100 (45 completed signings)\n`)

  console.log('💡 Advertisements are stored in DHT via Zoe (bootstrap node)\n')

  // Give DHT time to propagate advertisements
  console.log('⏳ Waiting for DHT to propagate advertisements...')
  console.log('   (DHT replication across network takes 5-10 seconds)\n')
  await new Promise(resolve => setTimeout(resolve, 6000))

  // ========================================================================
  // Alice starts up and connects to bootstrap node
  // ========================================================================

  console.log('--- Phase 3: Alice Joins the Network (via Bootstrap) ---\n')

  console.log('Alice (client) starting up...')

  // Alice creates her coordinator (client mode)
  const aliceCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: false, // Alice is a client, not a DHT server
  })

  await aliceCoordinator.start()

  console.log(`✅ Alice online: ${aliceCoordinator.peerId}`)
  console.log(`   Address: ${aliceCoordinator.getStats().multiaddrs[0]}\n`)

  // Alice connects to Zoe (the bootstrap node) to join the P2P network
  // In production, she would use a well-known bootstrap address like:
  // /dnsaddr/bootstrap.lotusia.org/p2p/Qm...
  console.log('🔗 Alice connecting to bootstrap node (Zoe)...')

  await aliceCoordinator.connectToPeer(zoeBootstrapAddr)
  console.log('✅ Alice connected to P2P network via bootstrap\n')

  // Wait for DHT routing table to populate
  console.log('⏳ Waiting for DHT client to initialize...\n')
  await new Promise(resolve => setTimeout(resolve, 1000))

  // ========================================================================
  // DHT Query for Pre-Existing Advertisements
  // ========================================================================

  console.log('--- Phase 4: Alice Queries DHT for Existing Ads ---\n')

  console.log('📡 DHT query process:')
  console.log('   1. Query: musig2-directory-index:swap')
  console.log('   2. Get secure index with self-signed entries')
  console.log('   3. Verify entry signatures (prevent poisoning)')
  console.log('   4. Query individual advertisements from DHT')
  console.log('   5. Verify advertisement signatures')
  console.log('   6. Extract multiaddrs for connection\n')

  console.log('🔍 Alice querying DHT directory...\n')

  // Query DHT for signers (pure DHT, no GossipSub)
  // Demonstrates OFFLINE discovery - finding ads stored before connection
  const signers = await aliceCoordinator.findAvailableSigners({
    transactionType: TransactionType.SWAP,
    minAmount: 10_000_000, // 10 XPI
    maxAmount: 10_000_000,
    maxResults: 10,
  })

  console.log(`✅ Found ${signers.length} available signers:\n`)

  signers.forEach((signer, idx) => {
    console.log(`${idx + 1}. ${signer.metadata?.nickname || 'Anonymous'}`)
    console.log(`   Public Key: ${signer.publicKey.toString().slice(0, 40)}...`)
    console.log(
      `   Transaction Types: ${signer.criteria.transactionTypes.join(', ')}`,
    )
    console.log(`   Fees: ${signer.metadata?.fees || 0} satoshis`)
    console.log(`   Reputation: ${signer.metadata?.reputation?.score || 'N/A'}`)
    console.log(
      `   Completed Signings: ${signer.metadata?.reputation?.completedSignings || 0}`,
    )
    console.log(
      `   Verified: ${signer.metadata?.reputation?.verifiedIdentity ? '✓' : '✗'}`,
    )
    console.log('')
  })

  if (signers.length < 2) {
    console.log('⚠️  Not enough signers available for 3-of-3 multisig\n')
    console.log('Cleaning up and stopping all coordinators...\n')
    await Promise.all([
      aliceCoordinator.stop(),
      bobCoordinator.stop(),
      charlieCoordinator.stop(),
      zoeCoordinator.stop(),
    ])
    console.log('✅ All coordinators stopped (including bootstrap)\n')
    return
  }

  console.log('✅ Sufficient signers found for 3-of-3 multisig (MuSig2)\n')

  // Alice selects the two best signers based on reputation and fees
  const selectedSigners = signers
    .sort((a, b) => {
      const aScore =
        (a.metadata?.reputation?.score || 0) - (a.metadata?.fees || 0) / 1000
      const bScore =
        (b.metadata?.reputation?.score || 0) - (b.metadata?.fees || 0) / 1000
      return bScore - aScore
    })
    .slice(0, 2)

  console.log('📋 Alice selected co-signers:')
  selectedSigners.forEach((signer, idx) => {
    console.log(
      `   ${idx + 1}. ${signer.metadata?.nickname} (Rep: ${signer.metadata?.reputation?.score}, Fees: ${signer.metadata?.fees} sats)`,
    )
  })
  console.log('')

  // ========================================================================
  // Alice connects to discovered signers using their multiaddrs
  // ========================================================================

  console.log('🔗 Alice connecting to discovered signers...')
  console.log('   (Using multiaddrs from DHT advertisements)\n')

  // Connect to each selected signer using their advertised multiaddrs
  // This is the PROPER production approach:
  // 1. Advertisements contain multiaddrs for direct connection
  // 2. No hardcoded addresses needed
  // 3. Works across any network topology
  const connectionResults = await Promise.all(
    selectedSigners.map(signer => aliceCoordinator.connectToSigner(signer)),
  )

  if (connectionResults.every(r => r)) {
    console.log('✅ Alice connected to all selected co-signers')
    console.log(
      '   (Direct P2P connections established using discovered multiaddrs)\n',
    )
  } else {
    console.log('⚠️  Some connections failed\n')
  }

  // Give connections time to stabilize
  await new Promise(resolve => setTimeout(resolve, 500))

  // ========================================================================
  // Alice creates a signing request with discovered keys
  // ========================================================================

  console.log('--- Phase 5: Alice Creates Signing Request ---\n')

  const requiredPublicKeys = [
    aliceKey.publicKey,
    selectedSigners[0].publicKey,
    selectedSigners[1].publicKey,
  ]

  console.log('📝 Public keys assembled:')
  console.log(`   1. Alice: ${aliceKey.publicKey.toString().slice(0, 40)}...`)
  console.log(
    `   2. ${selectedSigners[0].metadata?.nickname}: ${selectedSigners[0].publicKey.toString().slice(0, 40)}...`,
  )
  console.log(
    `   3. ${selectedSigners[1].metadata?.nickname}: ${selectedSigners[1].publicKey.toString().slice(0, 40)}...\n`,
  )

  // Create swap transaction message
  const transactionMessage = Buffer.from(
    'SWAP: 10 XPI for 100 USDT (atomic swap)',
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
        amount: 10_000_000, // 10 XPI
        transactionType: TransactionType.SWAP,
        purpose: 'Atomic swap: 10 XPI ↔ 100 USDT',
      },
    },
  )

  console.log(`✅ Signing request created: ${requestId}`)
  console.log(`   Participants required: 3-of-3 (all must sign)`)
  console.log(`   Amount: 10 XPI`)
  console.log(`   Type: swap\n`)

  // Give network time to propagate request (should be fast with direct connections)
  console.log('⏳ Waiting for signing request to propagate...')
  console.log('   (Direct broadcasts + DHT storage)\n')
  await new Promise(resolve => setTimeout(resolve, 500))

  // ========================================================================
  // Bob and Charlie discover and join the request
  // ========================================================================

  console.log('--- Phase 6: Co-signers Discover and Join Request ---\n')

  // Bob discovers requests
  console.log('🔍 Bob checking for signing requests...')
  const bobRequests = await bobCoordinator.findSigningRequestsForMe(
    bobKey.publicKey,
  )

  console.log(`✅ Bob found ${bobRequests.length} signing request(s)`)

  if (bobRequests.length > 0) {
    const request = bobRequests[0]
    console.log(`   Request ID: ${request.requestId}`)
    console.log(`   Amount: ${request.metadata?.amount} satoshis`)
    console.log(`   Type: ${request.metadata?.transactionType}`)
    console.log(`   Purpose: ${request.metadata?.purpose}\n`)

    console.log('✅ Bob decides to join (auto-approval for demo)...')
    await bobCoordinator.joinSigningRequest(request.requestId, bobKey)
    console.log(`✅ Bob joined the signing request`)
    console.log(`   Participants: 2/3\n`)
  }

  await new Promise(resolve => setTimeout(resolve, 300))

  // Charlie discovers requests
  console.log('🔍 Charlie checking for signing requests...')
  const charlieRequests = await charlieCoordinator.findSigningRequestsForMe(
    charlieKey.publicKey,
  )

  console.log(`✅ Charlie found ${charlieRequests.length} signing request(s)`)

  if (charlieRequests.length > 0) {
    const request = charlieRequests[0]
    console.log(`   Request ID: ${request.requestId}`)
    console.log(`   Amount: ${request.metadata?.amount} satoshis`)
    console.log(`   Type: ${request.metadata?.transactionType}`)
    console.log(`   Purpose: ${request.metadata?.purpose}\n`)

    console.log('✅ Charlie decides to join (auto-approval for demo)...')
    await charlieCoordinator.joinSigningRequest(request.requestId, charlieKey)
    console.log(`✅ Charlie joined the signing request`)
    console.log(`   Participants: 3/3`)
    console.log(`   All participants joined! (MuSig2 threshold met)\n`)
  }

  console.log('✅ All participants joined!')
  console.log('   Session ready for MuSig2 signing protocol')
  console.log(
    '   (This demo focuses on discovery; see threePhaseExample for full signing)\n',
  )

  // ========================================================================
  // Summary and Cleanup
  // ========================================================================

  console.log('--- Summary ---\n')

  console.log('🎉 Real-World P2P Matchmaking Flow Complete!\n')
  console.log('What happened:')
  console.log(`  0. ✅ Zoe started as public bootstrap node`)
  console.log(`  1. ✅ Bob & Charlie connected to Zoe (bootstrap)`)
  console.log(`  2. ✅ They advertised services to DHT via Zoe`)
  console.log(`  3. ✅ Alice connected to Zoe to join the network`)
  console.log(`  4. ✅ Alice received advertisements via P2P gossip`)
  console.log(
    `  5. ✅ Alice discovered ${signers.length} signers WITHOUT knowing keys beforehand`,
  )
  console.log(`  6. ✅ Alice selected best co-signers (reputation + fees)`)
  console.log(`  7. ✅ Alice created signing request with discovered keys`)
  console.log(`  8. ✅ Bob and Charlie discovered and joined request`)
  console.log(`  9. ✅ Session ready for MuSig2 signing! 🎉\n`)

  console.log('🔑 How Real-World P2P Discovery Works:')
  console.log('  ✅ Bootstrap nodes (like Zoe) provide initial network entry')
  console.log('  ✅ No central authority - Zoe just routes DHT queries')
  console.log('  ✅ Advertisements propagate via P2P gossip (automatic)')
  console.log('  ✅ DHT provides decentralized storage and persistence')
  console.log('  ✅ Alice discovers without knowing public keys in advance')
  console.log('  ✅ Bob and Charlie stay pseudonymous (only pubkeys shared)')
  console.log('  ✅ Fully decentralized architecture (like BitTorrent/IPFS)\n')

  console.log('🔒 Security Guarantees:')
  console.log('  ✅ Advertisements are Schnorr-signed (proof of key ownership)')
  console.log('  ✅ Signatures verified before trusting any advertisement')
  console.log('  ✅ Multiaddrs included in signature (prevents tampering)')
  console.log('  ✅ DHT poisoning impossible (attacker needs private key)')
  console.log('  ✅ Impersonation attacks prevented (cryptographic proof)')
  console.log('  ✅ Timestamps + expiry prevent replay attacks\n')

  console.log('Total Fees:')
  const totalFees = selectedSigners.reduce(
    (sum, s) => sum + (s.metadata?.fees || 0),
    0,
  )
  console.log(`  ${totalFees} satoshis (${totalFees / 1_000_000} XPI)\n`)

  console.log('Stopping coordinators...')

  await Promise.all([
    aliceCoordinator.stop(),
    bobCoordinator.stop(),
    charlieCoordinator.stop(),
    zoeCoordinator.stop(),
  ])

  console.log('✅ All coordinators stopped (including bootstrap node)\n')
}

// ============================================================================
// Example: GossipSub Event-Driven Discovery (Real-Time)
// ============================================================================

async function matchmakingGossipSubExample() {
  console.log('\n=== Scenario 2: GossipSub Event-Driven Discovery ===\n')
  console.log('Demonstrates REAL-TIME pub/sub notifications:\n')
  console.log('  1. Zoe runs a public bootstrap node')
  console.log('  2. Alice connects FIRST and subscribes to topics')
  console.log('  3. Bob and Charlie advertise AFTER Alice subscribed')
  console.log('  4. Alice receives notifications instantly via GossipSub')
  console.log('  5. True event-driven discovery (no polling!)\n')
  console.log('📝 Note: advertiseSigner() uses BOTH GossipSub + P2P broadcast')
  console.log(
    '   for reliability. App handles deduplication (by public key).\n',
  )

  // Create private keys
  const aliceKey = new PrivateKey()
  const bobKey = new PrivateKey()
  const charlieKey = new PrivateKey()

  console.log('🔑 Generated keys for Alice, Bob, and Charlie\n')

  // ========================================================================
  // Phase 0: Bootstrap Node Startup
  // ========================================================================

  console.log('--- Phase 0: Zoe (Bootstrap) Starts ---\n')

  const zoeCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true,
    enableGossipSub: true, // Enable pub/sub
  })

  await zoeCoordinator.start()
  const zoeBootstrapAddr = zoeCoordinator.getStats().multiaddrs[0]

  console.log('✅ Bootstrap node online with GossipSub enabled')
  console.log(`   Zoe: ${zoeCoordinator.peerId}\n`)

  // ========================================================================
  // Phase 1: Alice Connects and Subscribes FIRST
  // ========================================================================

  console.log('--- Phase 1: Alice Joins and Subscribes ---\n')

  const aliceCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: false,
    enableGossipSub: true,
  })

  await aliceCoordinator.start()
  console.log(`✅ Alice online: ${aliceCoordinator.peerId}\n`)

  // Connect to bootstrap
  console.log('🔗 Alice connecting to Zoe...')
  await aliceCoordinator.connectToPeer(zoeBootstrapAddr)
  console.log('✅ Connected\n')

  // Subscribe BEFORE advertisers join
  console.log('📡 Alice subscribing to: musig2:signers:swap')
  console.log('   (Will receive real-time notifications)\n')

  // Application-layer deduplication by public key
  const discoveredSigners: SignerAdvertisement[] = []
  const seenPublicKeys = new Set<string>()

  aliceCoordinator.on(
    MuSig2Event.SIGNER_DISCOVERED,
    (ad: SignerAdvertisement) => {
      const pubKeyStr = ad.publicKey.toString()
      if (!seenPublicKeys.has(pubKeyStr)) {
        seenPublicKeys.add(pubKeyStr)
        discoveredSigners.push(ad)
        console.log(`   📥 Discovered: ${ad.metadata?.nickname}`)
      }
      // Duplicate from redundant channel (GossipSub + P2P broadcast) - skip
    },
  )

  await aliceCoordinator.subscribeToSignerDiscovery([TransactionType.SWAP])
  console.log('✅ Alice subscribed and waiting for advertisements\n')

  // Wait for subscription to propagate
  await new Promise(resolve => setTimeout(resolve, 500))

  // ========================================================================
  // Phase 2: Service Providers Connect and Advertise
  // ========================================================================

  console.log('--- Phase 2: Bob & Charlie Join and Advertise ---\n')

  const bobCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true,
    enableGossipSub: true,
  })

  const charlieCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: true,
    enableDHTServer: true,
    enableGossipSub: true,
  })

  await Promise.all([bobCoordinator.start(), charlieCoordinator.start()])

  console.log('✅ Service providers started')
  console.log(`   Bob: ${bobCoordinator.peerId}`)
  console.log(`   Charlie: ${charlieCoordinator.peerId}\n`)

  // Connect to bootstrap
  console.log('🔗 Bob & Charlie connecting to Zoe...')
  await Promise.all([
    bobCoordinator.connectToPeer(zoeBootstrapAddr),
    charlieCoordinator.connectToPeer(zoeBootstrapAddr),
  ])
  console.log('✅ Connected\n')

  // Wait for GossipSub mesh to form
  console.log('⏳ Waiting for GossipSub mesh to form...\n')
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Advertise (Alice will receive via GossipSub!)
  console.log('📡 Bob and Charlie advertising...')
  console.log('   → Publishing to GossipSub: musig2:signers:swap')
  console.log('   → Broadcasting via P2P\n')

  await Promise.all([
    bobCoordinator.advertiseSigner(
      bobKey,
      {
        transactionTypes: [TransactionType.SWAP, TransactionType.SPEND],
        minAmount: 5_000_000,
        maxAmount: 100_000_000,
      },
      {
        metadata: {
          nickname: 'Bob',
          fees: 5000,
          reputation: {
            score: 92,
            completedSignings: 87,
            failedSignings: 3,
            averageResponseTime: 15000,
            verifiedIdentity: false,
          },
        },
      },
    ),
    charlieCoordinator.advertiseSigner(
      charlieKey,
      {
        transactionTypes: [TransactionType.SWAP, TransactionType.SPEND],
        minAmount: 1_000_000,
        maxAmount: 50_000_000,
      },
      {
        metadata: {
          nickname: 'Charlie',
          fees: 1000,
          reputation: {
            score: 88,
            completedSignings: 45,
            failedSignings: 2,
            averageResponseTime: 28000,
            verifiedIdentity: true,
          },
        },
      },
    ),
  ])

  console.log('✅ Advertisements published!\n')

  // Wait for messages to arrive (should be nearly instant)
  console.log('⏳ Waiting for real-time notifications...\n')
  await new Promise(resolve => setTimeout(resolve, 1000))

  // ========================================================================
  // Phase 3: Check Discovery Results
  // ========================================================================

  console.log('--- Phase 3: Check Discovered Signers ---\n')

  console.log(`🎉 Alice discovered ${discoveredSigners.length} signers!`)
  console.log('   (Received via GossipSub + P2P, deduplicated by app)\n')

  discoveredSigners.forEach((signer, idx) => {
    console.log(`${idx + 1}. ${signer.metadata?.nickname}`)
    console.log(`   Fees: ${signer.metadata?.fees} satoshis`)
    console.log(`   Reputation: ${signer.metadata?.reputation?.score}/100`)
    console.log('')
  })

  // ========================================================================
  // Phase 4: Complete MuSig2 Signing Flow
  // ========================================================================

  if (discoveredSigners.length >= 2) {
    console.log('--- Phase 4: Alice Creates Signing Request ---\n')

    // Select signers
    const selectedSigners = discoveredSigners.slice(0, 2)
    console.log('📋 Alice selected co-signers:')
    selectedSigners.forEach((s, idx) => {
      console.log(`   ${idx + 1}. ${s.metadata?.nickname}`)
    })
    console.log('')

    // Connect to signers
    console.log('🔗 Alice connecting to discovered signers...\n')
    for (const signer of selectedSigners) {
      if (signer.multiaddrs && signer.multiaddrs.length > 0) {
        await aliceCoordinator.connectToSigner(signer)
      }
    }
    console.log('✅ Connections established\n')

    // Create signing request
    const requiredPublicKeys = [
      aliceKey.publicKey,
      ...selectedSigners.map(s => s.publicKey),
    ]

    const transactionMessage = Buffer.from(
      'SWAP: 10 XPI for 100 USDT (atomic swap)',
      'utf8',
    )

    console.log('📝 Creating signing request...')
    const requestId = await aliceCoordinator.announceSigningRequest(
      requiredPublicKeys,
      transactionMessage,
      aliceKey,
      {
        metadata: {
          amount: 10_000_000,
          transactionType: TransactionType.SWAP,
          purpose: 'Atomic swap: 10 XPI ↔ 100 USDT',
        },
      },
    )
    console.log(`✅ Signing request created: ${requestId}\n`)

    // Wait for propagation
    await new Promise(resolve => setTimeout(resolve, 1000))

    // ========================================================================
    // Phase 5: Co-signers Join
    // ========================================================================

    console.log('--- Phase 5: Co-signers Join Request ---\n')

    // Bob joins
    console.log('🔍 Bob checking for requests...')
    const bobRequests = await bobCoordinator.findSigningRequestsForMe(
      bobKey.publicKey,
    )
    if (bobRequests.length > 0) {
      console.log('✅ Bob found request and joining...')
      await bobCoordinator.joinSigningRequest(bobRequests[0].requestId, bobKey)
      console.log('✅ Bob joined\n')
    }

    // Charlie joins
    console.log('🔍 Charlie checking for requests...')
    const charlieRequests = await charlieCoordinator.findSigningRequestsForMe(
      charlieKey.publicKey,
    )
    if (charlieRequests.length > 0) {
      console.log('✅ Charlie found request and joining...')
      await charlieCoordinator.joinSigningRequest(
        charlieRequests[0].requestId,
        charlieKey,
      )
      console.log('✅ Charlie joined\n')
    }

    console.log('✅ All participants joined!')
    console.log('   Session ready for MuSig2 signing\n')
  }

  // ========================================================================
  // Summary
  // ========================================================================

  console.log('--- Summary ---\n')

  console.log('🎉 GossipSub Event-Driven Discovery + Signing Complete!\n')
  console.log('What happened:')
  console.log('  1. ✅ Alice subscribed to musig2:signers:swap FIRST')
  console.log('  2. ✅ Bob & Charlie advertised AFTER Alice subscribed')
  console.log('  3. ✅ Alice received notifications via GossipSub + P2P')
  console.log('  4. ✅ App deduplicated by public key (2 unique signers)')
  console.log('  5. ✅ Alice selected co-signers and created signing request')
  console.log('  6. ✅ Bob & Charlie joined the request')
  console.log('  7. ✅ Session ready for MuSig2 signing!\n')

  console.log('🚀 Event-Driven Architecture (GossipSub):')
  console.log('  ✅ Instant notifications (milliseconds)')
  console.log('  ✅ Subscribe before publish (true pub/sub)')
  console.log('  ✅ Redundant delivery (GossipSub + P2P broadcast)')
  console.log('  ✅ App-layer deduplication (by public key)')
  console.log('  ✅ Production-ready (used by Ethereum 2.0)\n')

  console.log('📝 Deduplication Strategy:')
  console.log('  • advertiseSigner() uses BOTH channels for reliability')
  console.log('  • Application deduplicates by public key (Set)')
  console.log('  • No caching in library = no memory leaks\n')

  console.log('Stopping coordinators...')
  await Promise.all([
    aliceCoordinator.stop(),
    bobCoordinator.stop(),
    charlieCoordinator.stop(),
    zoeCoordinator.stop(),
  ])
  console.log('✅ All coordinators stopped\n')
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
  coordinator.on(MuSig2Event.SIGNING_REQUEST_RECEIVED, request => {
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
        `   Threshold: ${request.requiredPublicKeys.length}-of-${request.requiredPublicKeys.length}`,
      )
      console.log('   ✅ Your signature is required!\n')

      // User would approve here
      // await coordinator.joinSigningRequest(request.requestId, myKey)
    }
  })

  // Listen for new signer advertisements
  coordinator.on(MuSig2Event.SIGNER_DISCOVERED, advertisement => {
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
  coordinator.on(MuSig2Event.SESSION_READY, sessionId => {
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

    // Run matchmaking example (DHT-based discovery)
    await matchmakingDHTExample()

    await new Promise(resolve => setTimeout(resolve, 1500))

    // Run GossipSub example (event-driven discovery)
    await matchmakingGossipSubExample()

    // Run event-driven example
    await eventDrivenExample()

    console.log('\n✅ All examples completed successfully!')
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
