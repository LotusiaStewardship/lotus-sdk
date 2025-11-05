#!/usr/bin/env node
/**
 * Generate Ed25519 Keypair for P2P Identity
 *
 * This script generates a new Ed25519 keypair for use with libp2p.
 * The keypair can be used to create a persistent peer identity that
 * remains the same across restarts.
 *
 * Usage:
 *   npx tsx scripts/generate-p2p-keypair.ts [--save <filename>]
 *
 * Options:
 *   --save <filename>  Save the private key to a file (e.g., zoe-bootstrap.key)
 *   --env              Output in .env format
 *   --help             Show this help message
 *
 * Examples:
 *   # Generate and display keypair
 *   npx tsx scripts/generate-p2p-keypair.ts
 *
 *   # Generate and save to file
 *   npx tsx scripts/generate-p2p-keypair.ts --save ./keys/bootstrap.key
 *
 *   # Generate for .env file
 *   npx tsx scripts/generate-p2p-keypair.ts --env
 */

import { generateKeyPair, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

// Parse command line arguments
const args = process.argv.slice(2)
const saveFlag = args.indexOf('--save')
const envFlag = args.includes('--env')
const helpFlag = args.includes('--help')

if (helpFlag) {
  console.log(`
Generate Ed25519 Keypair for P2P Identity

Usage:
  npx tsx scripts/generate-p2p-keypair.ts [options]

Options:
  --save <filename>  Save the private key to a file
  --env              Output in .env format
  --help             Show this help message

Examples:
  # Generate and display keypair
  npx tsx scripts/generate-p2p-keypair.ts

  # Generate and save to file
  npx tsx scripts/generate-p2p-keypair.ts --save ./keys/bootstrap.key

  # Generate for .env file
  npx tsx scripts/generate-p2p-keypair.ts --env
`)
  process.exit(0)
}

async function main() {
  console.log('🔑 Generating Ed25519 keypair...\n')

  // Generate new Ed25519 keypair
  const privateKey = await generateKeyPair('Ed25519')

  // Create PeerId from the keypair
  const peerId = peerIdFromPrivateKey(privateKey)

  // Export private key as Protocol Buffers bytes
  const privateKeyBytes = privateKeyToProtobuf(privateKey)
  const privateKeyBase64 = Buffer.from(privateKeyBytes).toString('base64')

  // Export raw private key bytes (for @libp2p/crypto/keys privateKeyFromRaw)
  const privateKeyRaw = privateKey.raw
  const privateKeyRawBase64 = Buffer.from(privateKeyRaw).toString('base64')

  if (envFlag) {
    // Output in .env format
    console.log('# Add these to your .env file:\n')
    console.log(`P2P_PEER_ID=${peerId.toString()}`)
    console.log(`P2P_PRIVATE_KEY_BASE64=${privateKeyBase64}`)
    console.log(`P2P_PRIVATE_KEY_RAW_BASE64=${privateKeyRawBase64}`)
    console.log('')
  } else {
    // Display in human-readable format
    console.log('✅ Keypair generated successfully!\n')
    console.log('═══════════════════════════════════════════════════════════\n')
    console.log('📋 Peer ID (Public Identity):')
    console.log(`   ${peerId.toString()}\n`)
    console.log('🔐 Private Key (Protocol Buffers format):')
    console.log(`   ${privateKeyBase64}\n`)
    console.log('🔐 Private Key (Raw format):')
    console.log(`   ${privateKeyRawBase64}\n`)
    console.log('═══════════════════════════════════════════════════════════\n')
  }

  // Save to file if requested
  if (saveFlag !== -1 && args[saveFlag + 1]) {
    const filename = args[saveFlag + 1]

    // Ensure directory exists
    const dir = dirname(filename)
    if (dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Write private key to file (Protocol Buffers format)
    writeFileSync(filename, privateKeyBytes)

    console.log(`💾 Private key saved to: ${filename}`)
    console.log(`   File size: ${privateKeyBytes.length} bytes\n`)
  }

  if (!envFlag) {
    console.log('📝 Usage in TypeScript:\n')
    console.log('```typescript')
    console.log("import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'")
    console.log("import { peerIdFromPrivateKey } from '@libp2p/peer-id'")
    console.log("import { readFileSync } from 'fs'")
    console.log('')
    console.log('// Load from file:')
    console.log(
      `const keyBytes = readFileSync('${saveFlag !== -1 ? args[saveFlag + 1] : 'path/to/key.key'}')`,
    )
    console.log('const privateKey = privateKeyFromProtobuf(keyBytes)')
    console.log('const peerId = peerIdFromPrivateKey(privateKey)')
    console.log('')
    console.log('// Or load from environment variable:')
    console.log(
      "const keyBytes = Buffer.from(process.env.P2P_PRIVATE_KEY_BASE64!, 'base64')",
    )
    console.log('const privateKey = privateKeyFromProtobuf(keyBytes)')
    console.log('const peerId = peerIdFromPrivateKey(privateKey)')
    console.log('')
    console.log('// Use in coordinator:')
    console.log('const coordinator = new MuSig2P2PCoordinator({')
    console.log('  peerId: peerId,')
    console.log("  listen: ['/ip4/0.0.0.0/tcp/6969'],")
    console.log('  // ... other config')
    console.log('})')
    console.log('```\n')

    console.log('🔒 Security Warning:')
    console.log('   - Never commit private keys to git!')
    console.log('   - Add *.key to .gitignore')
    console.log('   - Keep .env files secure')
    console.log('   - Use appropriate file permissions (chmod 600)\n')

    console.log('💡 Next Steps:')
    if (saveFlag === -1) {
      console.log('   1. Run with --save to save the key to a file')
      console.log('   2. Or run with --env to output in .env format')
    } else {
      console.log('   1. Add the key file to .gitignore')
      console.log('   2. Use the peerId in your bootstrap configuration')
      console.log('   3. Share the multiaddr with clients:')
      console.log(`      /ip4/YOUR_IP/tcp/YOUR_PORT/p2p/${peerId.toString()}`)
    }
    console.log('')
  }
}

main().catch(error => {
  console.error('❌ Error:', error)
  process.exit(1)
})
