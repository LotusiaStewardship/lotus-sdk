/**
 * Blockchain Verification Utilities
 *
 * Protocol-agnostic utilities for blockchain verification
 * Provides infrastructure for burn verification without enforcing policy
 */

import { ChronikClient } from 'chronik-client'
import { Hash } from '../bitcore/crypto/hash.js'
import { Script } from '../bitcore/script.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Result of burn transaction verification
 * Generic data structure - protocols decide what to do with it
 */
export interface BurnVerificationResult {
  /** Transaction ID */
  txId: string

  /** Output index containing the burn */
  outputIndex: number

  /** Amount burned in satoshis */
  burnAmount: number

  /** Block height where transaction was mined */
  blockHeight: number

  /** Number of confirmations (blocks since transaction was mined) */
  confirmations: number

  /** Whether burn has matured (met minimum maturation period) */
  isMatured: boolean

  /** Script of the burn output */
  script: Script

  /** Raw script hex */
  scriptHex: string

  /** LOKAD prefix if present (4 bytes) */
  lokadPrefix?: Buffer

  /** LOKAD protocol version if present */
  lokadVersion?: number

  /** LOKAD payload data if present */
  lokadPayload?: Buffer
}

// ============================================================================
// Burn Verifier
// ============================================================================

/**
 * Generic burn verification class
 *
 * Provides blockchain verification infrastructure without enforcing policy
 * Protocols use this to verify burns, then apply their own requirements
 */
export class BurnVerifier {
  private chronik: ChronikClient

  /**
   * Create a new BurnVerifier
   * @param chronikUrl - Chronik indexer URL (e.g., 'https://chronik.lotusia.org')
   */
  constructor(chronikUrl: string | string[]) {
    this.chronik = new ChronikClient(chronikUrl)
  }

  /**
   * Verify burn transaction exists on blockchain
   *
   * Does NOT enforce:
   * - Minimum burn amounts (protocol decides)
   * - LOKAD prefix requirements (protocol decides)
   * - When burns are required (protocol decides)
   * - Whether maturation is required (protocol decides)
   *
   * Only verifies:
   * - Transaction exists
   * - Has sufficient confirmations
   * - Output is OP_RETURN
   * - Parses LOKAD data if present
   * - Calculates maturation status
   *
   * @param txId - Transaction ID
   * @param outputIndex - Output index (usually 0)
   * @param minConfirmations - Minimum confirmations for security (default: 6)
   * @param maturationPeriod - Minimum confirmations for maturation (default: 0 = no maturation required)
   * @returns Burn verification result or null if invalid
   */
  async verifyBurnTransaction(
    txId: string,
    outputIndex: number,
    minConfirmations: number = 6,
    maturationPeriod: number = 0,
  ): Promise<BurnVerificationResult | null> {
    try {
      // Fetch transaction from blockchain using Chronik
      const tx = await this.chronik.tx(txId)
      if (!tx) {
        console.warn(`[BurnVerifier] Transaction not found: ${txId}`)
        return null
      }

      // Check if transaction is mined (has block info)
      if (!tx.block) {
        console.warn(`[BurnVerifier] Transaction not mined yet: ${txId}`)
        return null
      }

      // Get current blockchain height and calculate confirmations
      const blockchainInfo = await this.chronik.blockchainInfo()
      const currentHeight = blockchainInfo.tipHeight
      const confirmations = currentHeight - tx.block.height + 1

      // Check minimum confirmations for security
      if (confirmations < minConfirmations) {
        console.warn(
          `[BurnVerifier] Insufficient confirmations: ${confirmations} (need ${minConfirmations})`,
        )
        return null
      }

      // Calculate maturation status
      // Note: We return the result even if not matured - protocol decides if maturation is required
      const isMatured =
        maturationPeriod === 0 || confirmations >= maturationPeriod

      if (!isMatured && maturationPeriod > 0) {
        console.log(
          `[BurnVerifier] Burn not yet matured: ${confirmations} confirmations (need ${maturationPeriod}) for ${txId}`,
        )
      }

      // Get the burn output
      const output = tx.outputs[outputIndex]
      if (!output) {
        console.warn(
          `[BurnVerifier] Output ${outputIndex} not found in transaction ${txId}`,
        )
        return null
      }

      // Parse script from hex
      const script = Script.fromHex(output.outputScript)

      // Verify it's an OP_RETURN
      if (!script.isDataOut()) {
        console.warn(
          `[BurnVerifier] Output ${outputIndex} is not OP_RETURN (script: ${output.outputScript})`,
        )
        return null
      }

      // Calculate burn amount (chronik returns value as string in satoshis)
      const burnAmount = parseInt(output.value, 10)

      // Parse LOKAD prefix if present
      let lokadPrefix: Buffer | undefined
      let lokadVersion: number | undefined
      let lokadPayload: Buffer | undefined

      const chunks = script.chunks
      // LOKAD format: OP_RETURN <4-byte-prefix> <version> <payload...>
      if (chunks.length >= 3 && chunks[1].buf && chunks[1].buf.length === 4) {
        lokadPrefix = chunks[1].buf

        // Version is next chunk (1 byte)
        if (chunks[2].buf && chunks[2].buf.length === 1) {
          lokadVersion = chunks[2].buf[0]
        }

        // Payload is next chunk(s) - can be combined from multiple chunks
        if (chunks.length > 3) {
          const payloadChunks: Buffer[] = []
          for (let i = 3; i < chunks.length; i++) {
            const chunkBuf = chunks[i].buf
            if (chunkBuf) {
              payloadChunks.push(chunkBuf)
            }
          }
          if (payloadChunks.length > 0) {
            lokadPayload = Buffer.concat(payloadChunks)
          }
        }
      }

      return {
        txId,
        outputIndex,
        burnAmount,
        blockHeight: tx.block.height,
        confirmations,
        isMatured,
        script,
        lokadPrefix,
        lokadVersion,
        lokadPayload,
        scriptHex: output.outputScript,
      }
    } catch (error) {
      console.error('[BurnVerifier] Error verifying burn transaction:', error)
      return null
    }
  }

  /**
   * Derive identity ID from burn transaction
   *
   * Generic deterministic calculation used by all protocols
   * Identity ID = SHA256(txId || outputIndex)
   *
   * @param txId - Transaction ID
   * @param outputIndex - Output index
   * @returns Identity ID as hex string
   */
  deriveIdentityId(txId: string, outputIndex: number): string {
    const data = Buffer.concat([
      Buffer.from(txId, 'hex'),
      Buffer.from([outputIndex]),
    ])
    return Hash.sha256(data).toString('hex')
  }

  /**
   * Verify LOKAD prefix matches expected value
   *
   * @param script - Script to check
   * @param expectedPrefix - Expected 4-byte LOKAD prefix
   * @returns true if prefix matches
   */
  verifyLokadPrefix(script: Script, expectedPrefix: Buffer): boolean {
    const chunks = script.chunks
    if (chunks.length < 2) return false

    const prefix = chunks[1].buf
    if (!prefix || prefix.length !== 4) return false

    return prefix.equals(expectedPrefix)
  }

  /**
   * Parse public key from LOKAD payload
   * Assumes payload starts with 33-byte compressed public key
   *
   * @param lokadPayload - LOKAD payload buffer
   * @returns Public key buffer or null
   */
  parsePublicKeyFromLokad(lokadPayload?: Buffer): Buffer | null {
    if (!lokadPayload || lokadPayload.length < 33) {
      return null
    }

    // First 33 bytes should be compressed public key
    const pubKeyBytes = lokadPayload.slice(0, 33)

    // Verify it has correct prefix (02 or 03)
    const prefix = pubKeyBytes[0]
    if (prefix !== 0x02 && prefix !== 0x03) {
      return null
    }

    return pubKeyBytes
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Convert satoshis to XPI
 * Lotus uses 6 decimals: 1 XPI = 1,000,000 satoshis
 */
export function satoshisToXPI(satoshis: number): number {
  return satoshis / 1_000_000
}

/**
 * Convert XPI to satoshis
 */
export function xpiToSatoshis(xpi: number): number {
  return Math.floor(xpi * 1_000_000)
}

/**
 * Format XPI amount for display
 */
export function formatXPI(satoshis: number): string {
  const xpi = satoshisToXPI(satoshis)
  return `${xpi.toFixed(6)} XPI`
}
