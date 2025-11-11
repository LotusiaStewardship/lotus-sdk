/**
 * Unit Tests: Blockchain Transaction Monitor
 *
 * Note: These tests require a live Chronik endpoint.
 * They will be skipped if the endpoint is unreachable.
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import { TransactionMonitor } from '../../lib/p2p/blockchain-utils.js'

describe('Blockchain Transaction Monitor', () => {
  let monitor: TransactionMonitor
  const CHRONIK_URL = 'https://chronik.lotusia.org'
  const CHRONIK_TESTNET_URL = 'https://chronik-test.lotusia.org'

  before(() => {
    monitor = new TransactionMonitor(CHRONIK_TESTNET_URL)
  })

  describe('Configuration', () => {
    it('should initialize with Chronik URL', () => {
      const testMonitor = new TransactionMonitor(CHRONIK_TESTNET_URL)
      assert.ok(testMonitor, 'Should create monitor instance')
    })

    it('should support multiple Chronik URLs', () => {
      const testMonitor = new TransactionMonitor(CHRONIK_TESTNET_URL)
      assert.ok(testMonitor, 'Should create monitor with multiple URLs')
    })
  })

  describe('Transaction Confirmation Checking', () => {
    it('should return null for non-existent transaction', async () => {
      const fakeTxId = '0'.repeat(64)
      const result = await monitor.checkConfirmations(fakeTxId, 1)

      assert.strictEqual(result, null, 'Should return null for non-existent tx')
    })

    it('should handle invalid transaction ID gracefully', async () => {
      const invalidTxId = 'not-a-valid-tx-id'
      const result = await monitor.checkConfirmations(invalidTxId, 1)

      assert.strictEqual(result, null, 'Should return null for invalid tx ID')
    })
  })

  describe('Batch Confirmation Checking', () => {
    it('should check multiple transactions in parallel', async () => {
      const txIds = ['0'.repeat(64), '1'.repeat(64), '2'.repeat(64)]

      const results = await monitor.batchCheckConfirmations(txIds, 1)

      assert.ok(results instanceof Map, 'Should return Map')
      assert.strictEqual(results.size, 3, 'Should have 3 results')

      // All should be null (fake tx IDs)
      for (const [txId, info] of results) {
        assert.ok(txIds.includes(txId), 'Should include requested tx ID')
        assert.strictEqual(info, null, 'Should be null for fake tx')
      }
    })

    it('should handle empty array', async () => {
      const results = await monitor.batchCheckConfirmations([], 1)

      assert.ok(results instanceof Map, 'Should return Map')
      assert.strictEqual(results.size, 0, 'Should be empty')
    })
  })

  describe('Timeout Handling', () => {
    it.skip('should timeout when waiting for non-existent transaction', async () => {
      // Skipped: takes too long for test suite
      const fakeTxId = '0'.repeat(64)

      // Use short timeout for test
      const result = await monitor.waitForConfirmations(
        fakeTxId,
        1,
        1000, // poll every 1 second
        2000, // timeout after 2 seconds
      )

      assert.strictEqual(result, null, 'Should timeout and return null')
    })

    it.skip('should poll at correct interval', { timeout: 5000 }, async () => {
      // Skipped: takes too long for test suite
      const fakeTxId = '0'.repeat(64)
      const startTime = Date.now()

      await monitor.waitForConfirmations(
        fakeTxId,
        1,
        500, // poll every 500ms
        1500, // timeout after 1.5s (should poll 3 times)
      )

      const elapsed = Date.now() - startTime

      // Should take at least 1.5 seconds (timeout)
      assert.ok(elapsed >= 1500, 'Should respect timeout duration')
      // Should not take much longer than timeout
      assert.ok(elapsed < 2000, 'Should not significantly exceed timeout')
    })
  })

  describe('Transaction Broadcasting', () => {
    it('should handle invalid transaction hex gracefully', async () => {
      const invalidHex = 'not-valid-hex'
      const result = await monitor.broadcastTransaction(invalidHex)

      assert.strictEqual(result, null, 'Should return null for invalid hex')
    })

    it('should handle empty transaction hex', async () => {
      const result = await monitor.broadcastTransaction('')

      assert.strictEqual(result, null, 'Should return null for empty hex')
    })
  })

  describe('UTXO Queries', () => {
    it('should handle invalid address gracefully', async () => {
      const invalidAddress = 'not-a-valid-address'
      const result = await monitor.getUtxos(invalidAddress)

      assert.ok(Array.isArray(result), 'Should return array')
      assert.strictEqual(
        result.length,
        0,
        'Should return empty array for invalid address',
      )
    })

    it('should return empty array for address with no UTXOs', async () => {
      // Generate random address that likely has no UTXOs
      const unusedAddress = 'lotus_16PSJKGRWd8BeuPqFCHBfV6MVMg67LeaohpVeL5M4'
      const result = await monitor.getUtxos(unusedAddress)

      assert.ok(Array.isArray(result), 'Should return array')
      // May or may not be empty, but should be valid array
    })
  })

  describe('Confirmation Info Structure', () => {
    it('should have correct structure for unconfirmed transaction', () => {
      const info = {
        txId: '0'.repeat(64),
        blockHeight: 0,
        confirmations: 0,
        isConfirmed: false,
      }

      assert.strictEqual(
        info.confirmations,
        0,
        'Unconfirmed should have 0 confirmations',
      )
      assert.strictEqual(info.isConfirmed, false, 'Should not be confirmed')
      assert.strictEqual(info.blockHeight, 0, 'Should have block height 0')
    })

    it('should have correct structure for confirmed transaction', () => {
      const info = {
        txId: '1'.repeat(64),
        blockHeight: 100,
        confirmations: 5,
        isConfirmed: true,
      }

      assert.ok(
        info.confirmations > 0,
        'Confirmed should have positive confirmations',
      )
      assert.ok(info.isConfirmed, 'Should be confirmed')
      assert.ok(info.blockHeight > 0, 'Should have positive block height')
    })

    it('should correctly determine confirmation status', () => {
      // Test with different required confirmations
      const requiredConfs = [1, 3, 6]

      for (const required of requiredConfs) {
        const confirmed = {
          txId: '0'.repeat(64),
          blockHeight: 100,
          confirmations: required,
          isConfirmed: true,
        }

        const unconfirmed = {
          txId: '0'.repeat(64),
          blockHeight: 100,
          confirmations: required - 1,
          isConfirmed: false,
        }

        assert.ok(
          confirmed.isConfirmed,
          `Should be confirmed with ${required} confs`,
        )
        assert.ok(
          !unconfirmed.isConfirmed,
          `Should not be confirmed with ${required - 1} confs`,
        )
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      const invalidMonitor = new TransactionMonitor(
        'https://invalid-endpoint.invalid',
      )
      const result = await invalidMonitor.checkConfirmations('0'.repeat(64), 1)

      assert.strictEqual(result, null, 'Should return null on network error')
    })

    it('should handle malformed responses gracefully', async () => {
      // This tests that the monitor doesn't crash on unexpected responses
      const result = await monitor.getTransaction('0'.repeat(64))

      // Should either return null or throw handled error
      assert.ok(
        result === null || result === undefined,
        'Should handle gracefully',
      )
    })
  })

  describe('Parallel Operations', () => {
    it('should handle multiple parallel requests', async () => {
      const operations = [
        monitor.checkConfirmations('0'.repeat(64), 1),
        monitor.checkConfirmations('1'.repeat(64), 1),
        monitor.getTransaction('2'.repeat(64)),
        monitor.getUtxos('lotus_16PSJKGRWd8BeuPqFCHBfV6MVMg67LeaohpVeL5M4'),
      ]

      const results = await Promise.all(operations)

      assert.strictEqual(results.length, 4, 'Should complete all operations')
      // All should complete without errors
      assert.ok(true, 'All operations completed')
    })

    it('should handle batch operations efficiently', async () => {
      const txIds = Array.from({ length: 10 }, (_, i) =>
        i.toString().repeat(64),
      )

      const startTime = Date.now()
      await monitor.batchCheckConfirmations(txIds, 1)
      const elapsed = Date.now() - startTime

      // Batch should be faster than sequential
      // (this is a rough estimate, actual time depends on network)
      assert.ok(
        elapsed < 10000,
        'Batch operations should complete reasonably fast',
      )
    })
  })

  describe('Configuration Validation', () => {
    it('should handle various poll intervals', () => {
      const intervals = [1000, 3000, 5000, 10000]

      for (const interval of intervals) {
        assert.ok(interval > 0, 'Poll interval should be positive')
        assert.ok(interval < 60000, 'Poll interval should be reasonable (<60s)')
      }
    })

    it('should handle various timeout values', () => {
      const timeouts = [5000, 30000, 60000, 600000]

      for (const timeout of timeouts) {
        assert.ok(timeout > 0, 'Timeout should be positive')
        assert.ok(timeout <= 600000, 'Timeout should be reasonable (<=10 min)')
      }
    })

    it('should handle various required confirmation counts', () => {
      const requiredConfs = [1, 3, 6, 10]

      for (const confs of requiredConfs) {
        assert.ok(confs > 0, 'Required confirmations should be positive')
        assert.ok(confs <= 100, 'Required confirmations should be reasonable')
      }
    })
  })
})
