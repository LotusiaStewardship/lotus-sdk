/**
 * MuSig2 Identity Manager
 *
 * Manages blockchain-anchored identities with burn mechanism
 * Enforces MuSig2-specific burn policies and reputation tracking
 */

import { EventEmitter } from 'events'
import { PublicKey } from '../../bitcore/publickey.js'
import { Hash } from '../../bitcore/crypto/hash.js'
import { Schnorr } from '../../bitcore/crypto/schnorr.js'
import { Signature } from '../../bitcore/crypto/signature.js'
import { BN } from '../../bitcore/crypto/bn.js'
import { BurnVerifier, BurnVerificationResult } from '../blockchain-utils.js'
import {
  SignerIdentity,
  BurnProof,
  IdentityCommitment,
  IdentityReputation,
  KeyRotationEntry,
  SessionRecord,
  MUSIG2_LOKAD,
  MUSIG2_BURN_REQUIREMENTS,
  MUSIG2_MATURATION_PERIODS,
} from './types.js'

// ============================================================================
// Events
// ============================================================================

export interface IdentityManagerEvents {
  'identity:registered': (identityId: string, burnProof: BurnProof) => void
  'identity:verified': (identityId: string, publicKey: string) => void
  'identity:banned': (identityId: string, reason: string) => void
  'key:rotated': (identityId: string, oldKey: string, newKey: string) => void
  'reputation:updated': (
    identityId: string,
    oldScore: number,
    newScore: number,
  ) => void
}

// ============================================================================
// MuSig2 Identity Manager
// ============================================================================

/**
 * Manages MuSig2 identities with burn-based registration
 *
 * CRITICAL DESIGN:
 * - Identity is tied to burn transaction (txId + outputIndex), NOT public key
 * - Public keys can be rotated without losing reputation
 * - Burn verification is delegated to BurnVerifier (core P2P)
 * - Burn policy enforcement is MuSig2-specific (here)
 */
export class MuSig2IdentityManager extends EventEmitter {
  private burnVerifier: BurnVerifier
  private identities: Map<string, SignerIdentity> = new Map()
  private publicKeyToIdentity: Map<string, string> = new Map()
  private bannedIdentities: Set<string> = new Set()
  private cleanupIntervalId?: NodeJS.Timeout
  private maturationPeriod: number

  /**
   * Create a new identity manager
   * @param chronikUrl - Chronik API URL (e.g., 'https://chronik.lotusia.org')
   * @param maturationPeriod - Maturation period in blocks (default: 144 blocks ≈ 4.8 hours)
   */
  constructor(
    chronikUrl: string | string[],
    maturationPeriod: number = MUSIG2_MATURATION_PERIODS.IDENTITY_REGISTRATION,
  ) {
    super()
    this.burnVerifier = new BurnVerifier(chronikUrl)
    this.maturationPeriod = maturationPeriod
    this.startCleanup()

    console.log(
      `[IdentityManager] Initialized with maturation period: ${maturationPeriod} blocks`,
    )
  }

  // ==========================================================================
  // Identity Registration & Verification
  // ==========================================================================

  /**
   * Register a new identity with burn proof
   *
   * Requirements:
   * - Valid burn transaction (verified by BurnVerifier)
   * - Burn amount >= IDENTITY_REGISTRATION minimum
   * - LOKAD prefix matches MUSIG2_LOKAD.PREFIX
   * - LOKAD version matches MUSIG2_LOKAD.VERSION
   * - Public key in LOKAD payload
   * - Valid signature proving ownership of public key
   *
   * @param txId - Burn transaction ID
   * @param outputIndex - Burn output index
   * @param publicKey - Initial public key
   * @param signature - Signature proving ownership (signs identityId)
   * @param minConfirmations - Minimum confirmations (default: 6)
   * @returns Identity ID if successful, null otherwise
   */
  async registerIdentity(
    txId: string,
    outputIndex: number,
    publicKey: PublicKey,
    signature: Buffer,
  ): Promise<string | null> {
    try {
      // 1. Verify burn transaction exists on blockchain
      const burnResult = await this.burnVerifier.verifyBurnTransaction(
        txId,
        outputIndex,
        this.maturationPeriod,
      )

      if (!burnResult) {
        console.warn(
          `[IdentityManager] Burn verification failed for ${txId}:${outputIndex}`,
        )
        return null
      }

      // 2. Check maturation period (temporal security)
      if (!burnResult.isMatured) {
        console.warn(
          `[IdentityManager] Burn not matured yet: ${burnResult.confirmations} confirmations (need ${this.maturationPeriod}) for ${txId}:${outputIndex}`,
        )
        return null
      }

      // 3. Verify burn amount meets minimum
      if (
        burnResult.burnAmount < MUSIG2_BURN_REQUIREMENTS.IDENTITY_REGISTRATION
      ) {
        console.warn(
          `[IdentityManager] Insufficient burn amount: ${burnResult.burnAmount} (need ${MUSIG2_BURN_REQUIREMENTS.IDENTITY_REGISTRATION})`,
        )
        return null
      }

      // 4. Verify LOKAD prefix
      if (!burnResult.lokadPrefix?.equals(MUSIG2_LOKAD.PREFIX)) {
        console.warn(
          `[IdentityManager] Invalid LOKAD prefix: ${burnResult.lokadPrefix?.toString('hex')}`,
        )
        return null
      }

      // 5. Verify LOKAD version
      if (burnResult.lokadVersion !== MUSIG2_LOKAD.VERSION) {
        console.warn(
          `[IdentityManager] Invalid LOKAD version: ${burnResult.lokadVersion}`,
        )
        return null
      }

      // 6. Parse public key from LOKAD payload
      const payloadPubKey = this.burnVerifier.parsePublicKeyFromLokad(
        burnResult.lokadPayload,
      )
      if (!payloadPubKey) {
        console.warn(
          `[IdentityManager] Failed to parse public key from LOKAD payload`,
        )
        return null
      }

      // 7. Verify public key matches
      if (!publicKey.toBuffer().equals(payloadPubKey)) {
        console.warn(
          `[IdentityManager] Public key mismatch: provided ${publicKey.toString()} vs payload ${payloadPubKey.toString('hex')}`,
        )
        return null
      }

      // 8. Derive identity ID
      const identityId = this.burnVerifier.deriveIdentityId(txId, outputIndex)

      // 9. Check if already registered
      if (this.identities.has(identityId)) {
        console.warn(
          `[IdentityManager] Identity already registered: ${identityId}`,
        )
        return identityId // Already registered, return existing
      }

      // 10. Verify signature (proves ownership of public key)
      const message = Buffer.from(identityId, 'hex')
      const isValidSignature = this.verifySignature(
        message,
        signature,
        publicKey,
      )
      if (!isValidSignature) {
        console.warn(
          `[IdentityManager] Invalid signature for identity ${identityId}`,
        )
        return null
      }

      // 11. Create identity
      const now = Date.now()
      const identity: SignerIdentity = {
        identityId,
        burnProof: {
          txId,
          outputIndex,
          burnAmount: burnResult.burnAmount,
          burnHeight: burnResult.blockHeight,
          confirmations: burnResult.confirmations, // Snapshot at registration time
        },
        identityCommitment: {
          publicKey,
          signature,
          timestamp: now,
        },
        reputation: {
          identityId,
          score: 50, // Start at neutral reputation
          completedSignings: 0,
          failedSignings: 0,
          totalSignings: 0,
          averageResponseTime: 0,
          totalBurned: burnResult.burnAmount,
          firstSeen: now,
          lastUpdated: now,
        },
        keyHistory: [
          {
            publicKey: publicKey.toString(),
            activatedAt: now,
          },
        ],
        registeredAt: now,
        lastVerified: now,
      }

      // 12. Store identity
      this.identities.set(identityId, identity)
      this.publicKeyToIdentity.set(publicKey.toString(), identityId)

      console.log(
        `[IdentityManager] ✓ Registered identity ${identityId.slice(0, 20)}... with ${burnResult.confirmations} confirmations (matured)`,
      )

      this.emit('identity:registered', identityId, identity.burnProof)

      return identityId
    } catch (error) {
      console.error('[IdentityManager] Error registering identity:', error)
      return null
    }
  }

  /**
   * Rotate public key for an existing identity
   *
   * Requirements:
   * - Identity exists
   * - Valid burn transaction for key rotation
   * - Burn amount >= KEY_ROTATION minimum
   * - Old key signature proving authorization
   * - New key signature proving ownership
   *
   * @param identityId - Identity ID
   * @param oldPublicKey - Current public key
   * @param newPublicKey - New public key
   * @param oldKeySignature - Signature from old key authorizing rotation
   * @param newKeySignature - Signature from new key proving ownership
   * @param rotationBurnTxId - Burn transaction for rotation
   * @param rotationBurnOutputIndex - Burn output index
   * @returns true if successful
   */
  async rotateKey(
    identityId: string,
    oldPublicKey: PublicKey,
    newPublicKey: PublicKey,
    oldKeySignature: Buffer,
    newKeySignature: Buffer,
    rotationBurnTxId: string,
    rotationBurnOutputIndex: number,
  ): Promise<boolean> {
    try {
      // 1. Get identity
      const identity = this.identities.get(identityId)
      if (!identity) {
        console.warn(`[IdentityManager] Identity not found: ${identityId}`)
        return false
      }

      // 2. Verify current key matches
      if (
        identity.identityCommitment.publicKey.toString() !==
        oldPublicKey.toString()
      ) {
        console.warn(
          `[IdentityManager] Current public key mismatch for identity ${identityId}`,
        )
        return false
      }

      // 3. Verify rotation burn with maturation
      const rotationMaturation = MUSIG2_MATURATION_PERIODS.KEY_ROTATION
      const burnResult = await this.burnVerifier.verifyBurnTransaction(
        rotationBurnTxId,
        rotationBurnOutputIndex,
        rotationMaturation,
      )

      if (!burnResult) {
        console.warn(
          `[IdentityManager] Rotation burn verification failed for identity ${identityId}`,
        )
        return false
      }

      // 4. Check rotation burn maturation
      if (!burnResult.isMatured) {
        console.warn(
          `[IdentityManager] Rotation burn not matured: ${burnResult.confirmations} confirmations (need ${rotationMaturation}) for identity ${identityId}`,
        )
        return false
      }

      // 5. Check rotation burn amount
      if (burnResult.burnAmount < MUSIG2_BURN_REQUIREMENTS.KEY_ROTATION) {
        console.warn(
          `[IdentityManager] Insufficient rotation burn: ${burnResult.burnAmount} (need ${MUSIG2_BURN_REQUIREMENTS.KEY_ROTATION}) for identity ${identityId}`,
        )
        return false
      }

      // 6. Verify old key signature (authorizes rotation)
      const rotationMessage = Buffer.concat([
        Buffer.from(identityId, 'hex'),
        Buffer.from('KEY_ROTATION', 'utf8'),
        newPublicKey.toBuffer(),
      ])

      const isOldKeyValid = this.verifySignature(
        rotationMessage,
        oldKeySignature,
        oldPublicKey,
      )
      if (!isOldKeyValid) {
        console.warn(
          `[IdentityManager] Invalid old key signature for identity ${identityId}`,
        )
        return false
      }

      // 7. Verify new key signature (proves ownership)
      const isNewKeyValid = this.verifySignature(
        rotationMessage,
        newKeySignature,
        newPublicKey,
      )
      if (!isNewKeyValid) {
        console.warn(
          `[IdentityManager] Invalid new key signature for identity ${identityId}`,
        )
        return false
      }

      // 8. Update identity
      const now = Date.now()

      // Revoke old key
      const currentKeyEntry =
        identity.keyHistory[identity.keyHistory.length - 1]
      currentKeyEntry.revokedAt = now

      // Add new key
      identity.keyHistory.push({
        publicKey: newPublicKey.toString(),
        activatedAt: now,
        rotationSignature: newKeySignature,
      })

      // Update commitment
      identity.identityCommitment = {
        publicKey: newPublicKey,
        signature: newKeySignature,
        timestamp: now,
      }

      // Update total burned
      identity.reputation.totalBurned += burnResult.burnAmount

      // Update mappings
      this.publicKeyToIdentity.delete(oldPublicKey.toString())
      this.publicKeyToIdentity.set(newPublicKey.toString(), identityId)

      console.log(
        `[IdentityManager] Rotated key for identity ${identityId}: ${oldPublicKey.toString()} -> ${newPublicKey.toString()}`,
      )

      this.emit(
        'key:rotated',
        identityId,
        oldPublicKey.toString(),
        newPublicKey.toString(),
      )

      return true
    } catch (error) {
      console.error('[IdentityManager] Error rotating key:', error)
      return false
    }
  }

  // ==========================================================================
  // Identity Lookup & Validation
  // ==========================================================================

  /**
   * Get identity by identity ID
   */
  getIdentity(identityId: string): SignerIdentity | undefined {
    return this.identities.get(identityId)
  }

  /**
   * Get identity by public key (current key)
   */
  getIdentityByPublicKey(publicKey: string): SignerIdentity | undefined {
    const identityId = this.publicKeyToIdentity.get(publicKey)
    if (!identityId) return undefined
    return this.identities.get(identityId)
  }

  /**
   * Check if identity exists
   */
  hasIdentity(identityId: string): boolean {
    return this.identities.has(identityId)
  }

  /**
   * Check if identity is banned
   */
  isBanned(identityId: string): boolean {
    return this.bannedIdentities.has(identityId)
  }

  /**
   * Check if identity is allowed to participate
   * (exists, not banned, meets minimum reputation)
   */
  isAllowed(identityId: string, minReputation: number = 0): boolean {
    if (this.isBanned(identityId)) return false

    const identity = this.getIdentity(identityId)
    if (!identity) return false

    return identity.reputation.score >= minReputation
  }

  /**
   * Verify that a public key belongs to a specific identity
   */
  verifyPublicKeyOwnership(identityId: string, publicKey: string): boolean {
    const identity = this.getIdentity(identityId)
    if (!identity) return false

    // Check current key
    if (identity.identityCommitment.publicKey.toString() === publicKey) {
      return true
    }

    // Check key history
    return identity.keyHistory.some(
      entry => entry.publicKey === publicKey && !entry.revokedAt,
    )
  }

  // ==========================================================================
  // Reputation Management
  // ==========================================================================

  /**
   * Record successful signing session
   */
  recordSuccessfulSigning(identityId: string, responseTimeMs: number): void {
    const identity = this.getIdentity(identityId)
    if (!identity) return

    const oldScore = identity.reputation.score

    identity.reputation.completedSignings++
    identity.reputation.totalSignings++

    // Update average response time
    const totalResponses = identity.reputation.completedSignings
    const currentAvg = identity.reputation.averageResponseTime
    identity.reputation.averageResponseTime =
      (currentAvg * (totalResponses - 1) + responseTimeMs) / totalResponses

    // Increase reputation score (max 100)
    identity.reputation.score = Math.min(100, identity.reputation.score + 2)

    identity.reputation.lastUpdated = Date.now()

    this.emit(
      'reputation:updated',
      identityId,
      oldScore,
      identity.reputation.score,
    )
  }

  /**
   * Record failed signing session
   */
  recordFailedSigning(identityId: string, reason: string): void {
    const identity = this.getIdentity(identityId)
    if (!identity) return

    const oldScore = identity.reputation.score

    identity.reputation.failedSignings++
    identity.reputation.totalSignings++

    // Decrease reputation score (min 0)
    identity.reputation.score = Math.max(0, identity.reputation.score - 5)

    identity.reputation.lastUpdated = Date.now()

    console.log(
      `[IdentityManager] Failed signing for identity ${identityId}: ${reason} (new score: ${identity.reputation.score})`,
    )

    this.emit(
      'reputation:updated',
      identityId,
      oldScore,
      identity.reputation.score,
    )

    // Auto-ban if reputation drops too low
    if (identity.reputation.score === 0) {
      this.banIdentity(identityId, 'Reputation dropped to zero')
    }
  }

  /**
   * Get reputation score
   */
  getReputation(identityId: string): number {
    const identity = this.getIdentity(identityId)
    return identity?.reputation.score ?? 0
  }

  /**
   * Get full reputation data
   */
  getReputationData(identityId: string): IdentityReputation | undefined {
    return this.getIdentity(identityId)?.reputation
  }

  // ==========================================================================
  // Ban Management
  // ==========================================================================

  /**
   * Ban an identity permanently
   */
  banIdentity(identityId: string, reason: string): void {
    this.bannedIdentities.add(identityId)
    console.log(`[IdentityManager] Banned identity ${identityId}: ${reason}`)
    this.emit('identity:banned', identityId, reason)
  }

  /**
   * Unban an identity
   */
  unbanIdentity(identityId: string): void {
    this.bannedIdentities.delete(identityId)
    console.log(`[IdentityManager] Unbanned identity ${identityId}`)
  }

  // ==========================================================================
  // Statistics & Monitoring
  // ==========================================================================

  /**
   * Get total number of registered identities
   */
  getIdentityCount(): number {
    return this.identities.size
  }

  /**
   * Get total XPI burned across all identities
   */
  getTotalBurned(): number {
    let total = 0
    for (const identity of this.identities.values()) {
      total += identity.reputation.totalBurned
    }
    return total
  }

  /**
   * Get all identities (for admin/monitoring)
   */
  getAllIdentities(): SignerIdentity[] {
    return Array.from(this.identities.values())
  }

  /**
   * Get identities with minimum reputation
   */
  getIdentitiesWithMinReputation(minReputation: number): SignerIdentity[] {
    return this.getAllIdentities().filter(
      identity =>
        identity.reputation.score >= minReputation &&
        !this.isBanned(identity.identityId),
    )
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Verify Schnorr signature
   */
  private verifySignature(
    message: Buffer,
    signatureBuffer: Buffer,
    publicKey: PublicKey,
  ): boolean {
    try {
      // Hash the message
      const hashbuf = Hash.sha256(message)

      // Parse signature (64 bytes: 32-byte r, 32-byte s)
      if (signatureBuffer.length !== 64) {
        console.warn(
          `[IdentityManager] Invalid signature length: ${signatureBuffer.length}`,
        )
        return false
      }
      const signature = new Signature({
        r: new BN(signatureBuffer.subarray(0, 32), 'be'),
        s: new BN(signatureBuffer.subarray(32, 64), 'be'),
        isSchnorr: true,
      })

      // Verify using Schnorr
      return Schnorr.verify(hashbuf, signature, publicKey, 'big')
    } catch (error) {
      console.error('[IdentityManager] Signature verification error:', error)
      return false
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    // Clean up stale data every hour
    this.cleanupIntervalId = setInterval(
      () => {
        this.cleanup()
      },
      60 * 60 * 1000,
    )
  }

  /**
   * Cleanup stale data
   */
  cleanup(): void {
    // Currently no cleanup needed - identities persist
    // Future: Could add cleanup for very old, inactive identities
  }

  /**
   * Shutdown manager
   */
  shutdown(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = undefined
    }
    this.removeAllListeners()
  }
}
