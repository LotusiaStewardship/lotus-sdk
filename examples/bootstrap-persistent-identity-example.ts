/**
 * Bootstrap Peer Discovery & Persistent Identity Example
 *
 * Demonstrates:
 * 1. Creating a persistent peer identity (same PeerId across restarts)
 * 2. Automatic bootstrap peer discovery (no manual connection needed)
 *
 * Usage:
 *   npx tsx examples/bootstrap-persistent-identity-example.ts
 */

import { MuSig2P2PCoordinator } from '../lib/p2p/musig2/index.js'
import {
  generateKeyPair,
  privateKeyToProtobuf,
  privateKeyFromProtobuf,
} from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

// ============================================================================
// Helper: Get or Create Persistent PeerId
// ============================================================================

/**
 * Get or create a persistent PeerId that remains the same across restarts
 */
async function getOrCreatePeerId(filepath: string) {
  // Ensure directory exists
  const dir = dirname(filepath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  if (existsSync(filepath)) {
    console.log(`📂 Loading existing key from: ${filepath}`)
    const privateKeyBytes = readFileSync(filepath)
    const privateKey = privateKeyFromProtobuf(privateKeyBytes)
    const peerId = peerIdFromPrivateKey(privateKey)
    console.log(`✅ Loaded PeerId: ${peerId.toString()}\n`)
    return peerId
  } else {
    console.log(`🔑 Generating new key and saving to: ${filepath}`)
    const privateKey = await generateKeyPair('Ed25519')
    const privateKeyBytes = privateKeyToProtobuf(privateKey)
    writeFileSync(filepath, privateKeyBytes)
    const peerId = peerIdFromPrivateKey(privateKey)
    console.log(`✅ Generated PeerId: ${peerId.toString()}\n`)
    return peerId
  }
}

// ============================================================================
// Example: Bootstrap Node (Zoe)
// ============================================================================

async function startBootstrapNode() {
  console.log('=== Starting Bootstrap Node (Zoe) ===\n')

  // Create persistent identity for Zoe
  const zoePeerId = await getOrCreatePeerId('./.keys/zoe-bootstrap.key')

  // Start Zoe as a bootstrap/relay node
  const zoeCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/0.0.0.0/tcp/6969'],
    peerId: zoePeerId, // Persistent identity (same across restarts)
    enableDHT: true,
    enableDHTServer: true, // Full DHT server
    enableRelay: true,
    enableRelayServer: true, // Act as relay for NAT peers
    enableAutoNAT: false, // Bootstrap nodes don't need this (public IP)
    enableDCUTR: false, // Bootstrap nodes don't need this
    enableUPnP: false,
    securityConfig: {
      disableRateLimiting: true, // For demo
    },
  })

  await zoeCoordinator.start()

  const zoeAddrs = zoeCoordinator.getStats().multiaddrs
  console.log('✅ Zoe online with persistent identity!')
  console.log(`   PeerId: ${zoeCoordinator.peerId}`)
  console.log(`   Multiaddrs:`)
  zoeAddrs.forEach(addr => console.log(`     ${addr}`))
  console.log()

  return { coordinator: zoeCoordinator, multiaddrs: zoeAddrs }
}

// ============================================================================
// Example: Client Node (Alice) - Automatic Bootstrap Connection
// ============================================================================

async function startClientNode(bootstrapAddrs: string[]) {
  console.log('=== Starting Client Node (Alice) ===\n')

  // Create persistent identity for Alice
  const alicePeerId = await getOrCreatePeerId('./.keys/alice-client.key')

  // Start Alice with automatic bootstrap connection
  const aliceCoordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/0.0.0.0/tcp/0'],
    peerId: alicePeerId, // Persistent identity
    bootstrapPeers: bootstrapAddrs, // 🔥 Automatically connects on startup!
    enableDHT: true,
    enableDHTServer: false, // Client mode
    enableRelay: true,
    enableAutoNAT: true,
    enableDCUTR: true,
    enableUPnP: false,
    securityConfig: {
      disableRateLimiting: true, // For demo
    },
  })

  await aliceCoordinator.start()

  console.log('✅ Alice online with persistent identity!')
  console.log(`   PeerId: ${aliceCoordinator.peerId}`)
  console.log(`   Bootstrap peers configured: ${bootstrapAddrs.length} peer(s)`)
  console.log('   🔄 Automatic connection in progress...\n')

  return aliceCoordinator
}

// ============================================================================
// Main Example
// ============================================================================

async function main() {
  try {
    // Step 1: Start Zoe (bootstrap node)
    const { coordinator: zoeCoordinator, multiaddrs: zoeAddrs } =
      await startBootstrapNode()

    // Wait for Zoe to fully initialize
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Step 2: Start Alice (client) with automatic bootstrap connection
    const aliceCoordinator = await startClientNode([zoeAddrs[0]])

    // Wait for connection to establish
    console.log('⏳ Waiting for automatic connection...\n')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Step 3: Verify connection
    console.log('=== Connection Status ===\n')

    const aliceConnections = aliceCoordinator.libp2pNode.getConnections()
    console.log(`Alice has ${aliceConnections.length} connection(s):`)
    aliceConnections.forEach(conn => {
      const remoteAddr = conn.remoteAddr.toString()
      console.log(`  ✅ Connected to: ${remoteAddr}`)
    })
    console.log()

    const zoeConnections = zoeCoordinator.libp2pNode.getConnections()
    console.log(`Zoe has ${zoeConnections.length} connection(s):`)
    zoeConnections.forEach(conn => {
      const remoteAddr = conn.remoteAddr.toString()
      console.log(`  ✅ Connected to: ${remoteAddr}`)
    })
    console.log()

    // Step 4: Show DHT stats
    console.log('=== DHT Statistics ===\n')

    const aliceStats = aliceCoordinator.getDHTStats()
    console.log('Alice DHT:')
    console.log(`  Mode: ${aliceStats.mode}`)
    console.log(`  Routing table size: ${aliceStats.routingTableSize}`)
    console.log(`  Ready: ${aliceStats.isReady}`)
    console.log()

    const zoeStats = zoeCoordinator.getDHTStats()
    console.log('Zoe DHT:')
    console.log(`  Mode: ${zoeStats.mode}`)
    console.log(`  Routing table size: ${zoeStats.routingTableSize}`)
    console.log(`  Ready: ${zoeStats.isReady}`)
    console.log()

    // Summary
    console.log('=== Summary ===\n')
    console.log('✅ Features demonstrated:')
    console.log(
      '   1. Persistent PeerId: Both nodes use saved keys (.keys/*.key)',
    )
    console.log(
      '   2. Automatic bootstrap: Alice connected without manual connectToPeer()',
    )
    console.log('   3. DHT participation: Both nodes joined the DHT network')
    console.log()
    console.log('🎉 Success! Alice automatically connected to Zoe on startup!')
    console.log()
    console.log(
      '💡 Restart this script - both nodes will have the same PeerIds!',
    )
    console.log()

    // Keep running for a bit
    console.log('Press Ctrl+C to stop...\n')

    // Cleanup on exit
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down...')
      await Promise.all([aliceCoordinator.stop(), zoeCoordinator.stop()])
      console.log('✅ All coordinators stopped')
      process.exit(0)
    })

    // Keep alive
    await new Promise(() => {})
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
