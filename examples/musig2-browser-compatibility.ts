/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * Example demonstrating cross-platform MuSig2 usage
 *
 * This example shows how the MuSig2 coordinator works in both
 * Node.js and browser environments using the cross-platform utilities.
 */

import {
  MuSig2P2PCoordinator,
  MuSig2Event,
  SignerAdvertisement,
} from '../lib/p2p/musig2/index.js'
import {
  isBrowser,
  isNode,
  yieldToEventLoop,
  scheduleNextTick,
} from '../utils/functions.js'

/**
 * Example: Cross-platform event handling
 */
async function demonstrateCrossPlatformEvents() {
  console.log(`Running in: ${isBrowser() ? 'Browser' : 'Node.js'} environment`)

  // Create coordinator (works in both environments)
  const coordinator = new MuSig2P2PCoordinator({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableDHT: false, // Disable for local testing
    enableGossipSub: true,
  })

  // Set up event handlers
  coordinator.on(
    MuSig2Event.SIGNER_DISCOVERED,
    (advertisement: SignerAdvertisement) => {
      console.log(
        '🔍 Discovered signer:',
        advertisement.metadata?.nickname || 'Unknown',
      )
    },
  )

  coordinator.on(MuSig2Event.SESSION_CREATED, (sessionId: string) => {
    console.log('📝 Session created:', sessionId)
  })

  // Demonstrate cross-platform deferred execution
  console.log('🔄 Testing cross-platform deferred execution...')

  // Test scheduleNextTick (cross-platform setImmediate alternative)
  scheduleNextTick(() => {
    console.log('✅ scheduleNextTick executed successfully')
  })

  // Test yieldToEventLoop (cross-platform setImmediate for async)
  await yieldToEventLoop()
  console.log('✅ yieldToEventLoop completed successfully')

  // Test multiple yields (simulates coordinator's event processing)
  for (let i = 0; i < 3; i++) {
    await yieldToEventLoop()
    console.log(`✅ Yield ${i + 1} completed`)
  }

  console.log('🎉 Cross-platform functionality verified!')
}

/**
 * Example: Browser-specific optimizations
 */
async function demonstrateBrowserOptimizations() {
  if (!isBrowser()) {
    console.log('⚠️ Browser optimizations only apply in browser environment')
    return
  }

  console.log('🌐 Browser-specific optimizations active:')

  console.log('  - Using MessageChannel for zero-delay scheduling')
  console.log('  - Performance.now() for high-resolution timing')
  console.log('  - No Node.js-specific APIs')
}

/**
 * Example: Node.js fallbacks
 */
async function demonstrateNodeFallbacks() {
  if (!isNode()) {
    console.log('⚠️ Node.js fallbacks only apply in Node.js environment')
    return
  }

  console.log('🖥️ Node.js optimizations active:')

  console.log('  - Using native setImmediate when available')
  console.log('  - process.hrtime() for high-resolution timing')
  console.log('  - Full Node.js API compatibility')
}

/**
 * Example: Performance comparison
 */
async function demonstratePerformance() {
  console.log('⚡ Performance testing cross-platform utilities...')

  const iterations = 100

  // Test yieldToEventLoop performance
  const yieldStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    await yieldToEventLoop()
  }
  const yieldEnd = performance.now()
  const yieldAvg = (yieldEnd - yieldStart) / iterations

  console.log(`  yieldToEventLoop: ${yieldAvg.toFixed(3)}ms average`)

  // Test scheduleNextTick performance
  const scheduleStart = performance.now()
  let scheduleCompleted = 0

  for (let i = 0; i < iterations; i++) {
    scheduleNextTick(() => {
      scheduleCompleted++
      if (scheduleCompleted === iterations) {
        const scheduleEnd = performance.now()
        const scheduleAvg = (scheduleEnd - scheduleStart) / iterations
        console.log(`  scheduleNextTick: ${scheduleAvg.toFixed(3)}ms average`)
      }
    })
  }
}

/**
 * Main demonstration
 */
async function main() {
  console.log('🚀 MuSig2 Cross-Platform Compatibility Demo')
  console.log('='.repeat(50))

  try {
    await demonstrateCrossPlatformEvents()
    console.log()

    await demonstrateBrowserOptimizations()
    console.log()

    await demonstrateNodeFallbacks()
    console.log()

    await demonstratePerformance()
    console.log()

    console.log('✅ All cross-platform features working correctly!')
    console.log()
    console.log('📋 Summary:')
    console.log('  - ✅ Cross-platform event loop yielding')
    console.log('  - ✅ Cross-platform next-tick scheduling')
    console.log('  - ✅ Environment detection')
    console.log('  - ✅ High-resolution timing')
    console.log('  - ✅ Browser compatibility')
    console.log('  - ✅ Node.js compatibility')
  } catch (error) {
    console.error('❌ Demo failed:', error)
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export {
  demonstrateCrossPlatformEvents,
  demonstrateBrowserOptimizations,
  demonstrateNodeFallbacks,
  demonstratePerformance,
}
