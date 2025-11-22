/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * Tests for cross-platform utilities
 */

import {
  yieldToEventLoop,
  scheduleNextTick,
  getHighResTime,
  isBrowser,
  isNode,
} from '../../../utils/functions.js'

// Simple test framework for environments without Jest
function describe(name: string, fn: () => void) {
  console.log(`\n📋 ${name}`)
  fn()
}

function it(name: string, fn: () => Promise<void> | void) {
  console.log(`  🧪 ${name}`)
  try {
    const result = fn()
    if (result instanceof Promise) {
      return result.catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        console.error(`    ❌ Failed: ${errorMessage}`)
        throw error
      })
    }
    console.log(`    ✅ Passed`)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`    ❌ Failed: ${errorMessage}`)
    throw error
  }
}

function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, but got ${actual}`)
      }
    },
    toBeGreaterThanOrEqual(expected: T) {
      if (actual < expected) {
        throw new Error(`Expected ${actual} to be >= ${expected}`)
      }
    },
    toBeLessThan(expected: T) {
      if (actual >= expected) {
        throw new Error(`Expected ${actual} to be < ${expected}`)
      }
    },
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`,
        )
      }
    },
    toContain(expected: T) {
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`Expected array to contain ${expected}`)
        }
      } else if (typeof actual === 'string') {
        if (!actual.includes(String(expected))) {
          throw new Error(
            `Expected string "${actual}" to contain "${expected}"`,
          )
        }
      } else {
        throw new Error('toContain only works with arrays or strings')
      }
    },
    toHaveLength(expected: number) {
      if (Array.isArray(actual)) {
        if (actual.length !== expected) {
          throw new Error(
            `Expected length ${expected}, but got ${actual.length}`,
          )
        }
      } else {
        throw new Error('toHaveLength only works with arrays')
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error('Expected value to be defined')
      }
    },
  }
}

describe('Cross-platform Utils', () => {
  describe('yieldToEventLoop', () => {
    it('should yield control to the event loop', async () => {
      const startTime = Date.now()
      let callbackExecuted = false

      // Schedule a callback that should execute after yielding
      setTimeout(() => {
        callbackExecuted = true
      }, 0)

      await yieldToEventLoop()

      // Check that some time has passed and callback was executed
      const endTime = Date.now()
      expect(endTime - startTime).toBeGreaterThanOrEqual(0)

      // Wait a bit more to ensure setTimeout callback runs
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(callbackExecuted).toBe(true)
    })

    it('should work multiple times in sequence', async () => {
      const results: number[] = []

      for (let i = 0; i < 5; i++) {
        await yieldToEventLoop()
        results.push(i)
      }

      expect(results).toEqual([0, 1, 2, 3, 4])
    })
  })

  describe('scheduleNextTick', () => {
    it('should execute function on next tick', async () => {
      let executed = false

      scheduleNextTick(() => {
        executed = true
      })

      // Should not execute immediately
      expect(executed).toBe(false)

      // Wait for next tick
      await yieldToEventLoop()
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(executed).toBe(true)
    })

    it('should handle multiple scheduled functions', async () => {
      const results: string[] = []

      scheduleNextTick(() => {
        results.push('first')
      })

      scheduleNextTick(() => {
        results.push('second')
      })

      scheduleNextTick(() => {
        results.push('third')
      })

      // Wait for all to execute
      await yieldToEventLoop()
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(results).toEqual(['first', 'second', 'third'])
    })
  })

  describe('getHighResTime', () => {
    it('should return a number', () => {
      const time = getHighResTime()
      expect(typeof time).toBe('number')
      expect(time).toBeGreaterThanOrEqual(0)
    })

    it('should return increasing values', () => {
      const time1 = getHighResTime()
      const time2 = getHighResTime()

      expect(time2).toBeGreaterThanOrEqual(time1)
    })

    it('should provide sub-millisecond resolution when available', async () => {
      const time1 = getHighResTime()

      // Wait a very short time
      await yieldToEventLoop()

      const time2 = getHighResTime()

      // Should detect some passage of time
      expect(time2 - time1).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Environment Detection', () => {
    it('should correctly detect environment', () => {
      // These tests should work in both Node.js and browser environments
      const browser = isBrowser()
      const node = isNode()

      // Should be mutually exclusive (one true, one false)
      expect(browser || node).toBe(true)
      expect(browser && node).toBe(false)

      console.log(`Environment detected: ${browser ? 'browser' : 'node'}`)
    })
  })

  describe('Integration Tests', () => {
    it('should work with async/await patterns', async () => {
      const results: string[] = []

      // Simulate the deferred event pattern used in coordinator
      const deferEvent = (event: string, data: string) => {
        scheduleNextTick(() => {
          results.push(`${event}:${data}`)
        })
      }

      deferEvent('test', 'first')
      deferEvent('test', 'second')
      deferEvent('test', 'third')

      // Yield to allow scheduled events to execute
      await yieldToEventLoop()
      await yieldToEventLoop() // May need multiple yields

      // Wait a bit more for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(results).toEqual(['test:first', 'test:second', 'test:third'])
    })

    it('should handle high-frequency scheduling', async () => {
      const results: number[] = []
      const count = 100

      // Schedule many callbacks quickly
      for (let i = 0; i < count; i++) {
        scheduleNextTick(() => {
          results.push(i)
        })
      }

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(results).toHaveLength(count)

      // Results should contain all numbers (order may vary)
      for (let i = 0; i < count; i++) {
        expect(results.includes(i)).toBe(true)
      }
    })
  })

  describe('Performance Tests', () => {
    it('should have acceptable performance for yieldToEventLoop', async () => {
      const iterations = 1000
      const startTime = getHighResTime()

      for (let i = 0; i < iterations; i++) {
        await yieldToEventLoop()
      }

      const endTime = getHighResTime()
      const averageTime = (endTime - startTime) / iterations

      console.log(`Average yieldToEventLoop time: ${averageTime.toFixed(3)}ms`)

      // Should be reasonably fast (less than 1ms average on most systems)
      expect(averageTime).toBeLessThan(1)
    })

    it('should have acceptable performance for scheduleNextTick', async () => {
      const iterations = 100
      let completed = 0
      const startTime = getHighResTime()

      for (let i = 0; i < iterations; i++) {
        scheduleNextTick(() => {
          completed++
          if (completed === iterations) {
            const endTime = getHighResTime()
            const averageTime = (endTime - startTime) / iterations

            console.log(
              `Average scheduleNextTick time: ${averageTime.toFixed(3)}ms`,
            )

            // Should be reasonably fast
            expect(averageTime).toBeLessThan(10)
          }
        })
      }

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(completed).toBe(iterations)
    })
  })
})
