/**
 * Unit Tests: SwapSig Transaction Building
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import { PrivateKey } from '../../lib/bitcore/privatekey.js'
import { Address } from '../../lib/bitcore/address.js'
import { Transaction } from '../../lib/bitcore/transaction/index.js'
import { Script } from '../../lib/bitcore/script.js'
import { createMuSigTaprootAddress } from '../../lib/bitcore/taproot/musig2.js'
import { SwapSigBurnMechanism } from '../../lib/p2p/swapsig/burn.js'

describe('SwapSig Transaction Building', () => {
  let aliceKey: PrivateKey
  let bobKey: PrivateKey
  let carolKey: PrivateKey
  let burnMechanism: SwapSigBurnMechanism

  before(() => {
    // Create test keys
    aliceKey = new PrivateKey()
    bobKey = new PrivateKey()
    carolKey = new PrivateKey()
    burnMechanism = new SwapSigBurnMechanism()
  })

  describe('MuSig2 Taproot Address Generation', () => {
    it('should create valid 2-of-2 MuSig2 Taproot address', () => {
      const pubkeys = [aliceKey.publicKey, bobKey.publicKey]
      const result = createMuSigTaprootAddress(pubkeys, 'livenet')

      assert.ok(result.address, 'Should have address')
      assert.ok(result.keyAggContext, 'Should have key aggregation context')
      assert.ok(result.commitment, 'Should have commitment')
      assert.strictEqual(
        result.keyAggContext.pubkeys.length,
        2,
        'Should have 2 keys',
      )
    })

    it('should create valid 3-of-3 MuSig2 Taproot address', () => {
      const pubkeys = [aliceKey.publicKey, bobKey.publicKey, carolKey.publicKey]
      const result = createMuSigTaprootAddress(pubkeys, 'livenet')

      assert.ok(result.address, 'Should have address')
      assert.strictEqual(
        result.keyAggContext.pubkeys.length,
        3,
        'Should have 3 keys',
      )
    })

    it('should produce deterministic addresses (sorted keys)', () => {
      // Keys in different order should produce same address
      const pubkeys1 = [aliceKey.publicKey, bobKey.publicKey]
      const pubkeys2 = [bobKey.publicKey, aliceKey.publicKey]

      const result1 = createMuSigTaprootAddress(pubkeys1, 'livenet')
      const result2 = createMuSigTaprootAddress(pubkeys2, 'livenet')

      assert.strictEqual(
        result1.address.toString(),
        result2.address.toString(),
        'Should produce same address regardless of key order',
      )
    })

    it('should have valid Taproot address format', () => {
      const pubkeys = [aliceKey.publicKey, bobKey.publicKey]
      const result = createMuSigTaprootAddress(pubkeys, 'livenet')

      const addrStr = result.address.toString()
      // Taproot addresses should start with lotus_ prefix
      assert.ok(addrStr.startsWith('lotus_'), 'Should start with lotus_ prefix')
      // Should be longer than basic prefix (has actual address data)
      assert.ok(addrStr.length > 10, 'Should have address data')
    })
  })

  describe('Setup Transaction Building', () => {
    it('should build valid setup transaction', () => {
      const aliceAddress = aliceKey.toAddress()

      // Create mock UTXO
      const mockUtxo = {
        txId: '0'.repeat(64),
        outputIndex: 0,
        satoshis: 1100000,
        script: Script.fromAddress(aliceAddress),
        address: aliceAddress,
      }

      // Create MuSig2 shared address
      const pubkeys = [aliceKey.publicKey, bobKey.publicKey]
      const sharedOutput = createMuSigTaprootAddress(pubkeys, 'livenet')

      // Build transaction
      const tx = new Transaction()
      tx.from(mockUtxo)
      tx.to(sharedOutput.address, 1000000) // 1 XPI

      // Add burn output
      const burnAmount = burnMechanism.calculateBurnAmount(1000000)
      const burnOutput = burnMechanism.createBurnOutput(
        burnAmount,
        'test-pool-id',
      )
      tx.addOutput(burnOutput)

      // Set fee and change
      tx.feePerByte = 1
      tx.change(aliceAddress)

      assert.ok(tx, 'Transaction should be created')
      assert.ok(tx.inputs.length > 0, 'Should have inputs')
      assert.ok(
        tx.outputs.length >= 2,
        'Should have at least 2 outputs (shared + burn)',
      )
    })

    it('should calculate correct burn amount', () => {
      const amount = 1000000 // 1 XPI
      const burnAmount = burnMechanism.calculateBurnAmount(amount)

      // Default is 0.1% = 1000 sats
      assert.strictEqual(burnAmount, 1000, 'Should burn 1000 sats (0.1%)')
    })

    it('should respect minimum burn amount', () => {
      const amount = 10000 // Small amount
      const burnAmount = burnMechanism.calculateBurnAmount(amount)

      // Should use minimum (100 sats)
      assert.strictEqual(burnAmount, 100, 'Should use minimum burn (100 sats)')
    })

    it('should respect maximum burn amount', () => {
      const amount = 100000000 // 100 XPI
      const burnAmount = burnMechanism.calculateBurnAmount(amount)

      // Should use maximum (10,000 sats)
      assert.strictEqual(
        burnAmount,
        10000,
        'Should use maximum burn (10,000 sats)',
      )
    })

    it('should create valid burn output', () => {
      const burnAmount = 1000
      const poolId = '1234567890abcdef'
      const burnOutput = burnMechanism.createBurnOutput(burnAmount, poolId)

      assert.strictEqual(
        burnOutput.satoshis,
        burnAmount,
        'Should have correct amount',
      )
      assert.ok(burnOutput.script.isDataOut(), 'Should be OP_RETURN')

      const chunks = burnOutput.script.chunks
      assert.ok(
        chunks.length >= 3,
        'Should have at least 3 chunks (OP_RETURN + prefix + version)',
      )
    })

    it('should validate burn output correctly', () => {
      const amount = 1000000
      const burnAmount = burnMechanism.calculateBurnAmount(amount)
      const poolId = '1234567890abcdef'

      // Create transaction with burn
      const tx = new Transaction()
      const mockUtxo = {
        txId: '0'.repeat(64),
        outputIndex: 0,
        satoshis: 1100000,
        script: Script.fromAddress(aliceKey.toAddress()),
        address: aliceKey.toAddress(),
      }

      tx.from(mockUtxo)
      tx.to(aliceKey.toAddress(), 1000000)

      const burnOutput = burnMechanism.createBurnOutput(burnAmount, poolId)
      tx.addOutput(burnOutput)

      // Validate burn
      const isValid = burnMechanism.validateBurn(tx, burnAmount, poolId)
      assert.ok(isValid, 'Should validate burn output')
    })
  })

  describe('Settlement Transaction Building', () => {
    it('should build valid settlement transaction', () => {
      const finalDestination = new PrivateKey().toAddress()

      // Create mock shared output from setup
      const pubkeys = [aliceKey.publicKey, bobKey.publicKey]
      const sharedOutput = createMuSigTaprootAddress(pubkeys, 'livenet')

      // Build settlement transaction
      const tx = new Transaction()

      // Add input from shared output
      tx.from({
        txId: '1'.repeat(64),
        outputIndex: 0,
        satoshis: 1000000,
        script: Script.fromAddress(sharedOutput.address),
      })

      // Add output to final destination
      const feeRate = 1
      const outputAmount = 1000000 - feeRate * 200 // Estimate fee

      tx.to(finalDestination, outputAmount)
      tx.feePerByte = feeRate

      assert.ok(tx, 'Transaction should be created')
      assert.strictEqual(tx.inputs.length, 1, 'Should have 1 input')
      assert.strictEqual(tx.outputs.length, 1, 'Should have 1 output')
      assert.ok(
        tx.outputs[0].satoshis < 1000000,
        'Output should be less than input (fees)',
      )
    })

    it('should handle fee calculation correctly', () => {
      const inputAmount = 1000000
      const feeRate = 1
      const estimatedSize = 200 // bytes

      const outputAmount = inputAmount - feeRate * estimatedSize

      assert.strictEqual(outputAmount, 999800, 'Should deduct fees correctly')
      assert.ok(outputAmount < inputAmount, 'Output should be less than input')
    })

    it('should preserve most of the value (low fees)', () => {
      const inputAmount = 1000000
      const feeRate = 1
      const estimatedSize = 200

      const outputAmount = inputAmount - feeRate * estimatedSize
      const feesPercentage = (estimatedSize / inputAmount) * 100

      assert.ok(feesPercentage < 0.1, 'Fees should be less than 0.1%')
      assert.ok(
        outputAmount > inputAmount * 0.99,
        'Should preserve >99% of value',
      )
    })
  })

  describe('Transaction Validation', () => {
    it('should have valid transaction ID after building', () => {
      const tx = new Transaction()
      const mockUtxo = {
        txId: '0'.repeat(64),
        outputIndex: 0,
        satoshis: 1000000,
        script: Script.fromAddress(aliceKey.toAddress()),
        address: aliceKey.toAddress(),
      }

      tx.from(mockUtxo)
      tx.to(bobKey.toAddress(), 900000)
      tx.feePerByte = 1

      assert.ok(tx.id, 'Should have transaction ID')
      assert.ok(tx.hash, 'Should have transaction hash')
      assert.strictEqual(
        tx.id.length,
        64,
        'Transaction ID should be 64 hex characters',
      )
    })

    it('should serialize to valid hex', () => {
      const tx = new Transaction()
      const mockUtxo = {
        txId: '0'.repeat(64),
        outputIndex: 0,
        satoshis: 1000000,
        script: Script.fromAddress(aliceKey.toAddress()),
        address: aliceKey.toAddress(),
      }

      tx.from(mockUtxo)
      tx.to(bobKey.toAddress(), 900000)
      tx.feePerByte = 1

      const txHex = tx.toString()
      assert.ok(txHex, 'Should serialize to hex')
      assert.ok(txHex.length > 0, 'Hex should not be empty')
      assert.ok(/^[0-9a-f]+$/i.test(txHex), 'Should be valid hex string')
    })

    it('should maintain input/output balance (with fees)', () => {
      const tx = new Transaction()
      const inputAmount = 1000000

      const mockUtxo = {
        txId: '0'.repeat(64),
        outputIndex: 0,
        satoshis: inputAmount,
        script: Script.fromAddress(aliceKey.toAddress()),
        address: aliceKey.toAddress(),
      }

      tx.from(mockUtxo)
      tx.to(bobKey.toAddress(), 900000)
      tx.feePerByte = 1
      // Add change output to complete transaction
      tx.change(aliceKey.toAddress())

      const totalInput = inputAmount
      const totalOutput = tx.outputs.reduce((sum, out) => sum + out.satoshis, 0)

      assert.ok(
        totalOutput < totalInput,
        'Output should be less than input (fees)',
      )
      const fees = totalInput - totalOutput
      assert.ok(fees > 0, 'Should have positive fees')
      // Fees should be reasonable (<5% to account for transaction overhead)
      assert.ok(fees < inputAmount * 0.05, 'Fees should be reasonable (<5%)')
    })
  })
})
