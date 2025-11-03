/**
 * SwapSig XPI Burn Mechanism
 *
 * Implements Sybil attack defense through XPI token burning.
 * Participants must burn XPI (permanently destroy) to join pools,
 * making fake participant attacks economically irrational.
 */

import { Output } from '../../bitcore/transaction/output.js'
import { Script } from '../../bitcore/script.js'
import { Opcode } from '../../bitcore/opcode.js'
import type { Transaction } from '../../bitcore/transaction/index.js'
import type { BurnConfig } from './types.js'
import { DEFAULT_BURN_CONFIG } from './types.js'

/**
 * SwapSig burn mechanism for Sybil defense
 */
export class SwapSigBurnMechanism {
  private config: BurnConfig

  constructor(config?: Partial<BurnConfig>) {
    this.config = { ...DEFAULT_BURN_CONFIG, ...config }
  }

  /**
   * Calculate required burn amount for a given swap amount
   *
   * @param swapAmount - Denomination in satoshis
   * @param burnPercentage - Percentage to burn (e.g., 0.001 = 0.1%)
   * @returns Burn amount in satoshis (clamped to min/max)
   */
  calculateBurnAmount(swapAmount: number, burnPercentage?: number): number {
    const percentage = burnPercentage ?? this.config.burnPercentage
    const rawBurn = Math.floor(swapAmount * percentage)

    // Apply bounds
    return Math.max(
      this.config.minimumBurn,
      Math.min(rawBurn, this.config.maximumBurn),
    )
  }

  /**
   * Create OP_RETURN burn output
   *
   * Format: OP_RETURN <burn_identifier> <pool_id> <version>
   *
   * @param burnAmount - Amount to burn in satoshis
   * @param poolId - Pool identifier (32-byte hex)
   * @param config - Optional burn config override
   * @returns Burn output
   */
  createBurnOutput(
    burnAmount: number,
    poolId: string,
    config?: BurnConfig,
  ): Output {
    const burnConfig = config ?? this.config

    // Construct burn data
    const burnId = Buffer.from(burnConfig.burnIdentifier, 'utf8')
    const poolIdBuf = Buffer.from(poolId, 'hex')
    const versionBuf = Buffer.from([burnConfig.version])

    // Build OP_RETURN script
    const script = new Script().add(Opcode.OP_RETURN).add(burnId)

    if (burnConfig.poolIdInBurn) {
      script.add(poolIdBuf)
    }

    script.add(versionBuf)

    return new Output({
      satoshis: burnAmount,
      script,
    })
  }

  /**
   * Validate burn output in a transaction
   *
   * Verifies:
   * 1. Transaction contains valid OP_RETURN output
   * 2. Burn amount matches expected
   * 3. Burn identifier is correct
   * 4. Pool ID matches (if required)
   * 5. Version is correct
   *
   * @param tx - Setup transaction to validate
   * @param expectedAmount - Expected burn amount
   * @param expectedPoolId - Expected pool ID
   * @param config - Optional burn config override
   * @returns True if burn is valid
   */
  validateBurn(
    tx: Transaction,
    expectedAmount: number,
    expectedPoolId: string,
    config?: BurnConfig,
  ): boolean {
    const burnConfig = config ?? this.config

    // Find burn output (OP_RETURN)
    const burnOutput = tx.outputs.find(output => {
      const script = output.script
      if (!script || script.chunks.length === 0) return false
      return script.chunks[0].opcodenum === Opcode.OP_RETURN
    })

    if (!burnOutput) {
      return false
    }

    // Verify amount
    if (burnOutput.satoshis !== expectedAmount) {
      return false
    }

    // Parse OP_RETURN data
    const script = burnOutput.script
    const chunks = script.chunks

    // Must have at least: OP_RETURN + burnId + version
    const minChunks = burnConfig.poolIdInBurn ? 4 : 3
    if (chunks.length < minChunks) {
      return false
    }

    // Verify OP_RETURN
    if (chunks[0].opcodenum !== Opcode.OP_RETURN) {
      return false
    }

    // Verify burn identifier
    const burnId = chunks[1].buf
    if (!burnId || burnId.toString('utf8') !== burnConfig.burnIdentifier) {
      return false
    }

    let chunkIndex = 2

    // Verify pool ID (if required)
    if (burnConfig.poolIdInBurn) {
      const poolIdBuf = chunks[chunkIndex].buf
      if (!poolIdBuf || poolIdBuf.toString('hex') !== expectedPoolId) {
        return false
      }
      chunkIndex++
    }

    // Verify version
    const versionBuf = chunks[chunkIndex].buf
    if (!versionBuf || versionBuf[0] !== burnConfig.version) {
      return false
    }

    return true
  }

  /**
   * Calculate total burned amount for all participants
   *
   * @param participantCount - Number of participants
   * @param denomination - Swap denomination
   * @returns Total burned in satoshis
   */
  calculateTotalBurned(participantCount: number, denomination: number): number {
    const burnPerParticipant = this.calculateBurnAmount(denomination)
    return participantCount * burnPerParticipant
  }

  /**
   * Calculate economic cost for Sybil attack
   *
   * Computes the irrecoverable cost (burned + fees) for creating
   * fake participants to attack a pool.
   *
   * @param fakeParticipants - Number of fake participants
   * @param denomination - Swap denomination
   * @param feePerTx - Fee per transaction
   * @returns Cost breakdown
   */
  calculateSybilAttackCost(
    fakeParticipants: number,
    denomination: number,
    feePerTx: number,
  ): {
    lockedFunds: number // Recoverable (denomination)
    burnedFunds: number // Irrecoverable (permanent loss)
    feesFunds: number // Irrecoverable (paid to miners)
    totalIrrecoverable: number // burnedFunds + feesFunds
    totalCost: number // lockedFunds + totalIrrecoverable
  } {
    const burnPerParticipant = this.calculateBurnAmount(denomination)

    const lockedFunds = fakeParticipants * denomination
    const burnedFunds = fakeParticipants * burnPerParticipant
    const feesFunds = fakeParticipants * 2 * feePerTx // Setup + settlement

    return {
      lockedFunds,
      burnedFunds,
      feesFunds,
      totalIrrecoverable: burnedFunds + feesFunds,
      totalCost: lockedFunds + burnedFunds + feesFunds,
    }
  }

  /**
   * Get burn configuration
   */
  getConfig(): BurnConfig {
    return { ...this.config }
  }

  /**
   * Update burn configuration
   */
  updateConfig(config: Partial<BurnConfig>): void {
    this.config = { ...this.config, ...config }
  }
}
