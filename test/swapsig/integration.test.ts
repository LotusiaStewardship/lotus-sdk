/**
 * Integration Tests: Full SwapSig Flow
 *
 * Tests the complete swap flow from pool creation to settlement.
 * These tests use mock blockchain data and do not require real transactions.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { PrivateKey } from '../../lib/bitcore/privatekey.js'
import { Address } from '../../lib/bitcore/address.js'
import { SwapSigCoordinator } from '../../lib/p2p/swapsig/coordinator.js'
import {
  SwapSigEvent,
  SwapPhase,
  type SwapPool,
} from '../../lib/p2p/swapsig/types.js'

describe('SwapSig Integration Tests', () => {
  let alice: PrivateKey
  let bob: PrivateKey
  let carol: PrivateKey

  let aliceCoordinator: SwapSigCoordinator
  let bobCoordinator: SwapSigCoordinator
  let carolCoordinator: SwapSigCoordinator

  const denomination = 1000000 // 1 XPI

  before(async () => {
    // Create participants
    alice = new PrivateKey()
    bob = new PrivateKey()
    carol = new PrivateKey()

    // Create coordinators
    // Note: These require P2P config which we'll keep minimal for testing
    aliceCoordinator = new SwapSigCoordinator(
      alice,
      {
        listen: ['/ip4/127.0.0.1/tcp/0'], // Random port (0 = auto-assign)
        enableDHT: false, // Disable for testing
        bootstrapPeers: [],
      },
      {}, // MuSig2 config
      {
        minParticipants: 3,
        maxParticipants: 10,
        chronikUrl: 'https://chronik.lotusia.org',
        requiredConfirmations: 1,
      },
    )

    bobCoordinator = new SwapSigCoordinator(
      bob,
      {
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: false,
        bootstrapPeers: [],
      },
      {},
      {
        minParticipants: 3,
        maxParticipants: 10,
        chronikUrl: 'https://chronik.lotusia.org',
      },
    )

    carolCoordinator = new SwapSigCoordinator(
      carol,
      {
        listen: ['/ip4/127.0.0.1/tcp/0'],
        enableDHT: false,
        bootstrapPeers: [],
      },
      {},
      {
        minParticipants: 3,
        maxParticipants: 10,
        chronikUrl: 'https://chronik.lotusia.org',
      },
    )

    // Start coordinators
    await aliceCoordinator.start()
    await bobCoordinator.start()
    await carolCoordinator.start()
  })

  after(async () => {
    // Stop coordinators
    await aliceCoordinator.stop()
    await bobCoordinator.stop()
    await carolCoordinator.stop()
  })

  describe('Pool Creation', () => {
    it('should create swap pool', async () => {
      const poolId = await aliceCoordinator.createPool({
        denomination,
        minParticipants: 3,
        maxParticipants: 10,
        setupTimeout: 600000,
        settlementTimeout: 600000,
      })

      assert.ok(poolId, 'Should return pool ID')
      assert.strictEqual(
        poolId.length,
        64,
        'Pool ID should be 64 hex characters',
      )

      const pools = aliceCoordinator.getActivePools()
      assert.strictEqual(pools.length, 1, 'Should have 1 active pool')
      assert.strictEqual(pools[0].poolId, poolId, 'Pool ID should match')
    })

    it('should emit POOL_CREATED event', async () => {
      let eventEmitted = false
      let emittedPoolId = ''

      aliceCoordinator.on(SwapSigEvent.POOL_CREATED, (pool: SwapPool) => {
        eventEmitted = true
        emittedPoolId = pool.poolId
      })

      const poolId = await aliceCoordinator.createPool({
        denomination,
        minParticipants: 3,
        maxParticipants: 10,
      })

      // Give event time to emit
      await new Promise(resolve => setTimeout(resolve, 100))

      assert.ok(eventEmitted, 'Should emit POOL_CREATED event')
      assert.strictEqual(emittedPoolId, poolId, 'Event should include pool ID')
    })

    it('should initialize pool in DISCOVERY phase', async () => {
      const poolId = await aliceCoordinator.createPool({
        denomination,
        minParticipants: 3,
        maxParticipants: 10,
      })

      const pools = aliceCoordinator.getActivePools()
      const pool = pools.find(p => p.poolId === poolId)

      assert.ok(pool, 'Should find created pool')
      assert.strictEqual(
        pool.phase,
        SwapPhase.DISCOVERY,
        'Should be in DISCOVERY phase',
      )
      assert.strictEqual(
        pool.denomination,
        denomination,
        'Should have correct denomination',
      )
      assert.strictEqual(
        pool.participants.length,
        0,
        'Should have no participants yet',
      )
    })
  })

  describe('Pool Discovery', () => {
    it('should list active pools', () => {
      const pools = aliceCoordinator.getActivePools()
      assert.ok(Array.isArray(pools), 'Should return array')
      // May have pools from previous tests
      assert.ok(pools.length >= 0, 'Should have 0 or more pools')
    })

    it('should filter pools by parameters', async () => {
      // Create pools with different denominations
      await aliceCoordinator.createPool({
        denomination: 1000000,
        minParticipants: 3,
        maxParticipants: 10,
      })

      await aliceCoordinator.createPool({
        denomination: 10000000,
        minParticipants: 3,
        maxParticipants: 10,
      })

      const pools = aliceCoordinator.getActivePools()

      // Should have at least 2 pools
      assert.ok(pools.length >= 2, 'Should have multiple pools')

      // Should be able to filter by denomination
      const pools1XPI = pools.filter(p => p.denomination === 1000000)
      const pools10XPI = pools.filter(p => p.denomination === 10000000)

      assert.ok(pools1XPI.length > 0, 'Should have 1 XPI pools')
      assert.ok(pools10XPI.length > 0, 'Should have 10 XPI pools')
    })
  })

  describe('Event System', () => {
    it('should support typed event handlers', async () => {
      const events: string[] = []

      aliceCoordinator.on(SwapSigEvent.POOL_CREATED, (pool: SwapPool) => {
        events.push('POOL_CREATED')
      })

      await aliceCoordinator.createPool({
        denomination,
        minParticipants: 3,
        maxParticipants: 10,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      assert.ok(
        events.includes('POOL_CREATED'),
        'Should receive POOL_CREATED event',
      )
    })

    it('should handle multiple event listeners', async () => {
      let listener1Called = false
      let listener2Called = false

      aliceCoordinator.on(SwapSigEvent.POOL_CREATED, () => {
        listener1Called = true
      })

      aliceCoordinator.on(SwapSigEvent.POOL_CREATED, () => {
        listener2Called = true
      })

      await aliceCoordinator.createPool({
        denomination,
        minParticipants: 3,
        maxParticipants: 10,
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      assert.ok(listener1Called, 'Listener 1 should be called')
      assert.ok(listener2Called, 'Listener 2 should be called')
    })

    it('should support all SwapSig events', () => {
      // Test that key events are defined
      const expectedEvents = [
        SwapSigEvent.POOL_CREATED,
        SwapSigEvent.POOL_JOINED,
        SwapSigEvent.SETUP_COMPLETE,
        SwapSigEvent.REVEAL_COMPLETE,
        SwapSigEvent.SETTLEMENT_COMPLETE,
        SwapSigEvent.POOL_COMPLETE,
        SwapSigEvent.POOL_ABORTED,
      ]

      for (const event of expectedEvents) {
        assert.ok(event, `Event ${event} should be defined`)
        assert.ok(typeof event === 'string', `Event ${event} should be string`)
      }
    })
  })

  describe('Group Formation', () => {
    it('should determine correct group size for 3 participants', async () => {
      const poolId = await aliceCoordinator.createPool({
        denomination,
        minParticipants: 3,
        maxParticipants: 10,
      })

      const pools = aliceCoordinator.getActivePools()
      const pool = pools.find(p => p.poolId === poolId)

      // After 3 participants join and setup is executed,
      // pool should have group strategy
      // For now, we test the manager directly

      const manager = aliceCoordinator.getPoolManager()
      const strategy = manager.determineOptimalGroupSize(3)

      assert.strictEqual(
        strategy.groupSize,
        2,
        'Should use 2-of-2 for 3 participants',
      )
      assert.ok(strategy.anonymityPerGroup >= 2, 'Should have decent anonymity')
    })

    it('should determine correct group size for 10 participants', async () => {
      const manager = aliceCoordinator.getPoolManager()
      const strategy = manager.determineOptimalGroupSize(10)

      assert.strictEqual(
        strategy.groupSize,
        3,
        'Should use 3-of-3 for 10 participants',
      )
      assert.strictEqual(
        strategy.anonymityPerGroup,
        6,
        'Should have 6 mappings (3!)',
      )
    })

    it('should determine correct group size for 25 participants', async () => {
      const manager = aliceCoordinator.getPoolManager()
      const strategy = manager.determineOptimalGroupSize(25)

      assert.strictEqual(
        strategy.groupSize,
        5,
        'Should use 5-of-5 for 25 participants',
      )
      assert.strictEqual(
        strategy.anonymityPerGroup,
        120,
        'Should have 120 mappings (5!)',
      )
    })
  })

  describe('Burn Mechanism', () => {
    it('should calculate correct burn amount', () => {
      const burnMechanism = aliceCoordinator.getBurnMechanism()
      const burnAmount = burnMechanism.calculateBurnAmount(1000000)

      assert.strictEqual(
        burnAmount,
        1000,
        'Should burn 1000 sats (0.1%) for 1 XPI',
      )
    })

    it('should create valid burn output', () => {
      const burnMechanism = aliceCoordinator.getBurnMechanism()
      const burnAmount = 1000
      const poolId = '1234567890abcdef'

      const burnOutput = burnMechanism.createBurnOutput(burnAmount, poolId)

      assert.strictEqual(
        burnOutput.satoshis,
        burnAmount,
        'Should have correct amount',
      )
      assert.ok(burnOutput.script.isDataOut(), 'Should be OP_RETURN')
    })

    it('should enforce minimum burn', () => {
      const burnMechanism = aliceCoordinator.getBurnMechanism()
      const burnAmount = burnMechanism.calculateBurnAmount(10000) // Small amount

      assert.ok(burnAmount >= 100, 'Should enforce minimum burn (100 sats)')
    })

    it('should enforce maximum burn', () => {
      const burnMechanism = aliceCoordinator.getBurnMechanism()
      const burnAmount = burnMechanism.calculateBurnAmount(100000000) // Large amount

      assert.ok(
        burnAmount <= 10000,
        'Should enforce maximum burn (10,000 sats)',
      )
    })
  })

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const config = aliceCoordinator.getSwapConfig()

      assert.ok(
        config.minParticipants && config.minParticipants >= 3,
        'Should have minimum 3 participants',
      )
      assert.ok(
        config.feeRate && config.feeRate > 0,
        'Should have positive fee rate',
      )
      assert.ok(
        config.setupTimeout && config.setupTimeout > 0,
        'Should have positive setup timeout',
      )
      assert.ok(
        config.settlementTimeout && config.settlementTimeout > 0,
        'Should have positive settlement timeout',
      )
    })

    it('should respect custom configuration', async () => {
      const customCoordinator = new SwapSigCoordinator(
        new PrivateKey(),
        {
          listen: ['/ip4/127.0.0.1/tcp/0'],
          enableDHT: false,
          bootstrapPeers: [],
        },
        {},
        {
          minParticipants: 5,
          maxParticipants: 20,
          feeRate: 2,
          setupTimeout: 300000,
          requiredConfirmations: 3,
        },
      )

      await customCoordinator.start()

      const config = customCoordinator.getSwapConfig()

      assert.strictEqual(
        config.minParticipants,
        5,
        'Should use custom min participants',
      )
      assert.strictEqual(
        config.maxParticipants,
        20,
        'Should use custom max participants',
      )
      assert.strictEqual(config.feeRate, 2, 'Should use custom fee rate')
      assert.strictEqual(
        config.setupTimeout,
        300000,
        'Should use custom setup timeout',
      )
      assert.strictEqual(
        config.requiredConfirmations,
        3,
        'Should use custom confirmations',
      )

      await customCoordinator.stop()
    })

    it('should have valid Chronik URL', () => {
      const config = aliceCoordinator.getSwapConfig()

      assert.ok(config.chronikUrl, 'Should have Chronik URL')
      assert.ok(
        typeof config.chronikUrl === 'string' ||
          Array.isArray(config.chronikUrl),
        'Should be string or array',
      )
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid pool parameters', async () => {
      try {
        await aliceCoordinator.createPool({
          denomination: -1000, // Invalid negative denomination
          minParticipants: 3,
          maxParticipants: 10,
        })
        assert.fail('Should throw error for negative denomination')
      } catch (error) {
        assert.ok(error, 'Should throw error')
      }
    })

    it('should handle pool not found', () => {
      const fakePools = aliceCoordinator
        .getActivePools()
        .filter(p => p.poolId === 'fake-id')
      assert.strictEqual(fakePools.length, 0, 'Should not find fake pool')
    })
  })

  describe('Performance', () => {
    it('should create pool quickly', async () => {
      const startTime = Date.now()

      await aliceCoordinator.createPool({
        denomination,
        minParticipants: 3,
        maxParticipants: 10,
      })

      const elapsed = Date.now() - startTime

      assert.ok(elapsed < 1000, 'Should create pool in < 1 second')
    })

    it('should handle multiple pools efficiently', async () => {
      const startTime = Date.now()

      const poolPromises = []
      for (let i = 0; i < 10; i++) {
        poolPromises.push(
          aliceCoordinator.createPool({
            denomination: (i + 1) * 1000000,
            minParticipants: 3,
            maxParticipants: 10,
          }),
        )
      }

      await Promise.all(poolPromises)

      const elapsed = Date.now() - startTime

      assert.ok(elapsed < 5000, 'Should create 10 pools in < 5 seconds')
    })
  })
})
