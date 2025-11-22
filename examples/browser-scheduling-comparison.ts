/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * Example demonstrating different browser scheduling methods
 *
 * This shows the various ways to schedule "next tick" execution
 * in browsers without using setTimeout.
 */

import {
  yieldToEventLoop,
  scheduleNextTick,
  isBrowser,
  isNode,
} from '../utils/functions.js'

/**
 * Demonstrate browser scheduling methods
 */
async function demonstrateSchedulingMethods() {
  console.log('🚀 Browser Scheduling Methods Comparison')
  console.log('='.repeat(50))
  console.log(`Environment: ${isBrowser() ? 'Browser' : 'Node.js'}`)
  console.log()

  // Test 1: queueMicrotask (if available)
  if (typeof queueMicrotask !== 'undefined') {
    console.log('✅ queueMicrotask available (microtask scheduling)')

    let microtaskExecuted = false
    queueMicrotask(() => {
      microtaskExecuted = true
      console.log('  📬 Microtask executed')
    })

    // Continue with synchronous code
    console.log('  🔄 Synchronous code after microtask scheduling')

    // Wait a bit to see the result
    await new Promise(resolve => setTimeout(resolve, 10))
    console.log(`  Result: ${microtaskExecuted ? 'Executed' : 'Not executed'}`)
    console.log()
  }

  // Test 2: MessageChannel (if available)
  if (typeof MessageChannel !== 'undefined') {
    console.log('✅ MessageChannel available (macrotask scheduling)')

    let messageChannelExecuted = false
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      messageChannelExecuted = true
      console.log('  📡 MessageChannel executed')
      channel.port1.close()
      channel.port2.close()
    }
    channel.port2.postMessage(null)

    // Continue with synchronous code
    console.log('  🔄 Synchronous code after MessageChannel scheduling')

    // Wait a bit to see the result
    await new Promise(resolve => setTimeout(resolve, 10))
    console.log(
      `  Result: ${messageChannelExecuted ? 'Executed' : 'Not executed'}`,
    )
    console.log()
  }

  // Test 3: Cross-platform utilities
  console.log('✅ Cross-platform utilities')

  let utilityExecuted = false
  scheduleNextTick(() => {
    utilityExecuted = true
    console.log('  🛠️ scheduleNextTick executed')
  })

  console.log('  🔄 Synchronous code after scheduleNextTick')

  // Wait a bit to see the result
  await new Promise(resolve => setTimeout(resolve, 10))
  console.log(`  Result: ${utilityExecuted ? 'Executed' : 'Not executed'}`)
  console.log()

  // Test 4: Async version
  console.log('✅ Async yieldToEventLoop')

  console.log('  🔄 Before yieldToEventLoop')
  await yieldToEventLoop()
  console.log('  🔄 After yieldToEventLoop')
  console.log()
}

/**
 * Performance comparison
 */
async function performanceComparison() {
  console.log('⚡ Performance Comparison')
  console.log('='.repeat(30))

  const iterations = 1000

  // Test queueMicrotask performance
  if (typeof queueMicrotask !== 'undefined') {
    let completed = 0
    const startTime = performance.now()

    for (let i = 0; i < iterations; i++) {
      queueMicrotask(() => {
        completed++
        if (completed === iterations) {
          const endTime = performance.now()
          const avgTime = (endTime - startTime) / iterations
          console.log(`queueMicrotask: ${avgTime.toFixed(3)}ms average`)
        }
      })
    }

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Test MessageChannel performance
  if (typeof MessageChannel !== 'undefined') {
    let completed = 0
    const startTime = performance.now()

    for (let i = 0; i < Math.min(iterations, 100); i++) {
      // Fewer iterations for MessageChannel
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        completed++
        channel.port1.close()
        channel.port2.close()
        if (completed === Math.min(iterations, 100)) {
          const endTime = performance.now()
          const avgTime = (endTime - startTime) / completed
          console.log(`MessageChannel: ${avgTime.toFixed(3)}ms average`)
        }
      }
      channel.port2.postMessage(null)
    }

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Test cross-platform utility performance
  {
    let completed = 0
    const startTime = performance.now()

    for (let i = 0; i < iterations; i++) {
      scheduleNextTick(() => {
        completed++
        if (completed === iterations) {
          const endTime = performance.now()
          const avgTime = (endTime - startTime) / iterations
          console.log(`scheduleNextTick: ${avgTime.toFixed(3)}ms average`)
        }
      })
    }

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log()
}

/**
 * Demonstrate execution order
 */
async function demonstrateExecutionOrder() {
  console.log('📋 Execution Order Demonstration')
  console.log('='.repeat(40))

  console.log('1. Synchronous code start')

  // Schedule different types of tasks
  if (typeof queueMicrotask !== 'undefined') {
    queueMicrotask(() => console.log('3. Microtask (queueMicrotask)'))
  }

  scheduleNextTick(() => console.log('4. scheduleNextTick'))

  if (typeof MessageChannel !== 'undefined') {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      console.log('5. MessageChannel macrotask')
      channel.port1.close()
      channel.port2.close()
    }
    channel.port2.postMessage(null)
  }

  setTimeout(() => console.log('6. setTimeout(0)'), 0)

  console.log('2. Synchronous code end')

  // Wait for all to complete
  await new Promise(resolve => setTimeout(resolve, 100))
  console.log('7. All tasks completed')
  console.log()
}

/**
 * Main demonstration
 */
async function main() {
  try {
    await demonstrateSchedulingMethods()
    await performanceComparison()
    await demonstrateExecutionOrder()

    console.log('🎉 Browser scheduling demonstration completed!')
    console.log()
    console.log('📋 Summary of browser scheduling methods:')
    console.log(
      '  - queueMicrotask: Fastest, microtask timing, modern browsers',
    )
    console.log('  - MessageChannel: Zero-delay macrotask, widely supported')
    console.log(
      '  - Cross-platform utilities: Best method automatically selected',
    )
    console.log('  - setTimeout(0): Last resort, may be throttled')
  } catch (error) {
    console.error('❌ Demo failed:', error)
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export {
  demonstrateSchedulingMethods,
  performanceComparison,
  demonstrateExecutionOrder,
}
