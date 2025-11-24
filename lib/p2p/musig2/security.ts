/**
 * MuSig2 Security and Validation
 *
 * Protocol-specific security validation for MuSig2 sessions
 * Enhanced with validation layer integration (Phase 5)
 */

import type { IProtocolValidator, P2PMessage, PeerInfo } from '../types.js'
import type { SessionAnnouncement } from './types.js'
import { MuSig2MessageType, DEFAULT_MUSIG2_P2P_CONFIG } from './types.js'
import { PublicKey } from '../../bitcore/publickey.js'
import {
  validateMessageStructure,
  validateSessionJoinPayload,
  validateSessionJoinAckPayload,
  validateNonceSharePayload,
  validatePartialSigSharePayload,
  validateSessionAbortPayload,
  validateSessionCompletePayload,
  validateSessionAnnouncementPayload,
} from './validation.js'
import { ValidationError, SecurityError, ErrorCode } from './errors.js'

/**
 * MuSig2 security configuration
 */
export interface MuSig2SecurityConfig {
  /** Minimum signers per session */
  minSigners?: number

  /** Maximum signers per session */
  maxSigners?: number

  /** Maximum session duration in milliseconds */
  maxSessionDuration?: number

  /** Require valid public keys in announcements */
  requireValidPublicKeys?: boolean

  // ============================================================================
  // Validation Security (Phase 5)
  // ============================================================================

  /** Maximum message size in bytes (DoS protection) */
  maxMessageSize?: number

  /** Maximum timestamp skew in milliseconds */
  maxTimestampSkew?: number

  /** Maximum invalid messages per peer before blocking */
  maxInvalidMessagesPerPeer?: number

  /** Enable validation-based security checks */
  enableValidationSecurity?: boolean

  /** Track validation violations for reputation */
  trackValidationViolations?: boolean
}

/**
 * Default security configuration
 */
export const DEFAULT_MUSIG2_SECURITY: Required<MuSig2SecurityConfig> = {
  minSigners: 2,
  maxSigners: 15,
  maxSessionDuration: 10 * 60 * 1000, // 10 minutes
  requireValidPublicKeys: true,

  // Validation Security (Phase 5)
  maxMessageSize: 100_000, // 100KB - DoS protection
  maxTimestampSkew: 5 * 60 * 1000, // 5 minutes
  maxInvalidMessagesPerPeer: 10, // Block peer after 10 invalid messages
  enableValidationSecurity: true,
  trackValidationViolations: true,
}

/**
 * MuSig2 Protocol Validator
 *
 * Implements protocol-specific validation for MuSig2 sessions
 * Enhanced with validation layer integration (Phase 5)
 */
export class MuSig2SecurityValidator implements IProtocolValidator {
  // Validation violation tracking (Phase 5)
  private validationViolations: Map<string, number> = new Map()
  private blockedPeers: Set<string> = new Set()

  constructor(
    private readonly config: MuSig2SecurityConfig = DEFAULT_MUSIG2_SECURITY,
  ) {}

  /**
   * Validate session announcement before accepting
   */
  async validateResourceAnnouncement(
    resourceType: string,
    resourceId: string,
    data: unknown,
    peerId: string,
  ): Promise<boolean> {
    // Only validate musig2-session announcements
    if (!resourceType.startsWith('musig2-session')) {
      return true
    }

    if (!data || typeof data !== 'object') {
      console.warn('[MuSig2Security] Invalid announcement data type')
      return false
    }

    const announcement = data as SessionAnnouncement

    // Validate required fields
    if (!announcement.sessionId || !announcement.coordinatorPeerId) {
      console.warn('[MuSig2Security] Missing required announcement fields')
      return false
    }

    // Validate session ID format
    if (announcement.sessionId !== resourceId) {
      console.warn('[MuSig2Security] Session ID mismatch')
      return false
    }

    // Validate signer count
    const minSigners =
      this.config.minSigners ?? DEFAULT_MUSIG2_SECURITY.minSigners
    const maxSigners =
      this.config.maxSigners ?? DEFAULT_MUSIG2_SECURITY.maxSigners

    if (announcement.requiredSigners < minSigners) {
      console.warn(
        `[MuSig2Security] Too few signers: ${announcement.requiredSigners} < ${minSigners}`,
      )
      return false
    }

    if (announcement.requiredSigners > maxSigners) {
      console.warn(
        `[MuSig2Security] Too many signers: ${announcement.requiredSigners} > ${maxSigners}`,
      )
      return false
    }

    // Validate signers array if provided
    if (announcement.signers) {
      if (announcement.signers.length !== announcement.requiredSigners) {
        console.warn('[MuSig2Security] Signer count mismatch')
        return false
      }

      // Validate public keys if required
      if (
        this.config.requireValidPublicKeys ??
        DEFAULT_MUSIG2_SECURITY.requireValidPublicKeys
      ) {
        for (const signerPubKey of announcement.signers) {
          try {
            PublicKey.fromString(signerPubKey)
          } catch (error) {
            console.warn(
              `[MuSig2Security] Invalid signer public key: ${signerPubKey}`,
            )
            return false
          }
        }
      }
    }

    // Validate timestamps
    const now = Date.now()
    if (announcement.createdAt > now + 60000) {
      // Allow 1 minute clock skew
      console.warn('[MuSig2Security] Announcement timestamp in future')
      return false
    }

    if (announcement.expiresAt < now) {
      console.warn('[MuSig2Security] Announcement expired')
      return false
    }

    const maxDuration =
      this.config.maxSessionDuration ??
      DEFAULT_MUSIG2_SECURITY.maxSessionDuration
    if (announcement.expiresAt - announcement.createdAt > maxDuration) {
      console.warn('[MuSig2Security] Announcement duration too long')
      return false
    }

    // Validate message hash format (should be 64 hex characters)
    if (!/^[0-9a-f]{64}$/i.test(announcement.messageHash)) {
      console.warn('[MuSig2Security] Invalid message hash format')
      return false
    }

    return true
  }

  /**
   * Validate MuSig2 message before processing
   * Enhanced with validation layer integration (Phase 5)
   */
  async validateMessage(message: P2PMessage, from: PeerInfo): Promise<boolean> {
    // Check if peer is blocked due to too many violations
    if (this.blockedPeers.has(from.peerId)) {
      console.warn(
        `[MuSig2Security] Blocked peer attempted message: ${from.peerId}`,
      )
      return false
    }

    // Check message size (DoS protection)
    const maxMessageSize =
      this.config.maxMessageSize ?? DEFAULT_MUSIG2_SECURITY.maxMessageSize
    if (this._isMessageTooLarge(message, maxMessageSize)) {
      this._trackValidationViolation(from.peerId, 'message_too_large')
      return false
    }

    // Basic validation
    if (!message.payload || typeof message.payload !== 'object') {
      console.warn('[MuSig2Security] Invalid message payload')
      this._trackValidationViolation(from.peerId, 'invalid_payload')
      return false
    }

    const payload = message.payload as Record<string, unknown>

    // All MuSig2 messages must have sessionId and timestamp
    if (!payload.sessionId || !payload.timestamp) {
      console.warn('[MuSig2Security] Missing sessionId or timestamp')
      this._trackValidationViolation(from.peerId, 'missing_fields')
      return false
    }

    // Validate timestamp with configurable skew
    const maxTimestampSkew =
      this.config.maxTimestampSkew ?? DEFAULT_MUSIG2_SECURITY.maxTimestampSkew
    const now = Date.now()
    const messageTime = payload.timestamp as number
    if (Math.abs(now - messageTime) > maxTimestampSkew) {
      console.warn('[MuSig2Security] Message timestamp too old or in future')
      this._trackValidationViolation(from.peerId, 'timestamp_skew')
      return false
    }

    // Use validation layer for type-specific validation (Phase 5 integration)
    const enableValidationSecurity =
      this.config.enableValidationSecurity ??
      DEFAULT_MUSIG2_SECURITY.enableValidationSecurity
    if (enableValidationSecurity) {
      try {
        this._validatePayloadWithValidationLayer(message.type, payload)
      } catch (error) {
        if (error instanceof ValidationError) {
          console.warn(
            `[MuSig2Security] Validation failed for ${message.type}: ${error.message}`,
          )
          this._trackValidationViolation(
            from.peerId,
            `validation_${error.reason}`,
          )
          return false
        }
        throw error
      }
    }

    // Legacy type-specific validation (fallback)
    switch (message.type) {
      case MuSig2MessageType.SESSION_JOIN:
        return this.validateJoinMessage(payload)

      case MuSig2MessageType.NONCE_SHARE:
        return this.validateNonceMessage(payload)

      case MuSig2MessageType.PARTIAL_SIG_SHARE:
        return this.validatePartialSigMessage(payload)

      default:
        // Other messages pass basic validation
        return true
    }
  }

  /**
   * Validate payload using the new validation layer (Phase 5)
   */
  private _validatePayloadWithValidationLayer(
    messageType: string,
    payload: Record<string, unknown>,
  ): void {
    switch (messageType) {
      case MuSig2MessageType.SESSION_JOIN:
        validateSessionJoinPayload(payload)
        break

      case MuSig2MessageType.SESSION_JOIN_ACK:
        validateSessionJoinAckPayload(payload)
        break

      case MuSig2MessageType.NONCE_SHARE:
        validateNonceSharePayload(payload)
        break

      case MuSig2MessageType.PARTIAL_SIG_SHARE:
        validatePartialSigSharePayload(payload)
        break

      case MuSig2MessageType.SESSION_ABORT:
        validateSessionAbortPayload(payload)
        break

      case MuSig2MessageType.SESSION_COMPLETE:
        validateSessionCompletePayload(payload)
        break

      // No validation for unknown types - let them pass
    }
  }

  /**
   * Check if message is too large (DoS protection)
   */
  private _isMessageTooLarge(message: P2PMessage, maxSize: number): boolean {
    try {
      const serialized = JSON.stringify(message)
      return serialized.length > maxSize
    } catch {
      return true // If we can't serialize, consider it too large
    }
  }

  /**
   * Track validation violations for reputation (Phase 5)
   */
  private _trackValidationViolation(
    peerId: string,
    violationType: string,
  ): void {
    const trackViolations =
      this.config.trackValidationViolations ??
      DEFAULT_MUSIG2_SECURITY.trackValidationViolations
    if (!trackViolations) {
      return
    }

    const currentCount = this.validationViolations.get(peerId) ?? 0
    const newCount = currentCount + 1
    this.validationViolations.set(peerId, newCount)

    console.warn(
      `[MuSig2Security] Validation violation from ${peerId}: ${violationType} (count: ${newCount})`,
    )

    // Block peer if too many violations
    const maxInvalidMessages =
      this.config.maxInvalidMessagesPerPeer ??
      DEFAULT_MUSIG2_SECURITY.maxInvalidMessagesPerPeer
    if (newCount >= maxInvalidMessages) {
      this.blockedPeers.add(peerId)
      console.warn(
        `[MuSig2Security] Blocked peer ${peerId} due to ${newCount} validation violations`,
      )
    }
  }

  /**
   * Validate join message
   */
  private validateJoinMessage(payload: Record<string, unknown>): boolean {
    if (!payload.signerPublicKey) {
      console.warn('[MuSig2Security] Missing signerPublicKey in join message')
      return false
    }

    // Validate public key format
    try {
      PublicKey.fromString(payload.signerPublicKey as string)
    } catch (error) {
      console.warn('[MuSig2Security] Invalid signerPublicKey format')
      return false
    }

    return true
  }

  /**
   * Validate nonce commitment message
   */
  private validateCommitmentMessage(payload: Record<string, unknown>): boolean {
    if (typeof payload.signerIndex !== 'number') {
      console.warn('[MuSig2Security] Invalid signerIndex')
      return false
    }

    if (!payload.commitment || typeof payload.commitment !== 'string') {
      console.warn('[MuSig2Security] Missing or invalid commitment')
      return false
    }

    // Validate hex format (should be 64 characters for 32-byte hash)
    if (!/^[0-9a-f]{64}$/i.test(payload.commitment)) {
      console.warn('[MuSig2Security] Invalid commitment format')
      return false
    }

    return true
  }

  /**
   * Validate nonce message
   */
  private validateNonceMessage(payload: Record<string, unknown>): boolean {
    if (typeof payload.signerIndex !== 'number') {
      console.warn('[MuSig2Security] Invalid signerIndex')
      return false
    }

    if (!payload.publicNonce || typeof payload.publicNonce !== 'object') {
      console.warn('[MuSig2Security] Missing or invalid publicNonce')
      return false
    }

    const nonce = payload.publicNonce as Record<string, unknown>
    if (!nonce.r1 || !nonce.r2) {
      console.warn('[MuSig2Security] Missing nonce components')
      return false
    }

    // Validate hex format (should be 66 characters for compressed point)
    if (
      typeof nonce.r1 !== 'string' ||
      typeof nonce.r2 !== 'string' ||
      !/^[0-9a-f]{66}$/i.test(nonce.r1) ||
      !/^[0-9a-f]{66}$/i.test(nonce.r2)
    ) {
      console.warn('[MuSig2Security] Invalid nonce format')
      return false
    }

    return true
  }

  /**
   * Validate partial signature message
   */
  private validatePartialSigMessage(payload: Record<string, unknown>): boolean {
    if (typeof payload.signerIndex !== 'number') {
      console.warn('[MuSig2Security] Invalid signerIndex')
      return false
    }

    if (!payload.partialSig || typeof payload.partialSig !== 'string') {
      console.warn('[MuSig2Security] Missing or invalid partialSig')
      return false
    }

    // Validate hex format (should be 64 characters for 32-byte signature)
    if (!/^[0-9a-f]{64}$/i.test(payload.partialSig)) {
      console.warn('[MuSig2Security] Invalid partialSig format')
      return false
    }

    return true
  }

  /**
   * Check if peer can announce a session
   */
  async canAnnounceResource(
    resourceType: string,
    peerId: string,
  ): Promise<boolean> {
    // Check if peer is blocked
    if (this.blockedPeers.has(peerId)) {
      console.warn(
        `[MuSig2Security] Blocked peer ${peerId} attempted to announce resource`,
      )
      return false
    }

    // Basic check - can be extended with reputation system
    if (!resourceType.startsWith('musig2-session')) {
      return true
    }

    // For now, allow all non-blocked peers to announce
    // In production, could check reputation, rate limits, etc.
    return true
  }

  // ============================================================================
  // Security Status Methods (Phase 5)
  // ============================================================================

  /**
   * Get security status for monitoring
   */
  getSecurityStatus() {
    return {
      blockedPeers: Array.from(this.blockedPeers),
      blockedPeerCount: this.blockedPeers.size,
      validationViolations: Object.fromEntries(this.validationViolations),
      totalViolations: Array.from(this.validationViolations.values()).reduce(
        (a, b) => a + b,
        0,
      ),
      config: {
        maxMessageSize:
          this.config.maxMessageSize ?? DEFAULT_MUSIG2_SECURITY.maxMessageSize,
        maxTimestampSkew:
          this.config.maxTimestampSkew ??
          DEFAULT_MUSIG2_SECURITY.maxTimestampSkew,
        maxInvalidMessagesPerPeer:
          this.config.maxInvalidMessagesPerPeer ??
          DEFAULT_MUSIG2_SECURITY.maxInvalidMessagesPerPeer,
        enableValidationSecurity:
          this.config.enableValidationSecurity ??
          DEFAULT_MUSIG2_SECURITY.enableValidationSecurity,
        trackValidationViolations:
          this.config.trackValidationViolations ??
          DEFAULT_MUSIG2_SECURITY.trackValidationViolations,
      },
    }
  }

  /**
   * Check if a peer is blocked
   */
  isPeerBlocked(peerId: string): boolean {
    return this.blockedPeers.has(peerId)
  }

  /**
   * Get violation count for a peer
   */
  getViolationCount(peerId: string): number {
    return this.validationViolations.get(peerId) ?? 0
  }

  /**
   * Unblock a peer (for manual intervention)
   */
  unblockPeer(peerId: string): boolean {
    const wasBlocked = this.blockedPeers.delete(peerId)
    if (wasBlocked) {
      this.validationViolations.delete(peerId)
      console.log(`[MuSig2Security] Unblocked peer: ${peerId}`)
    }
    return wasBlocked
  }

  /**
   * Clear all violations (for testing or reset)
   */
  clearViolations(): void {
    this.validationViolations.clear()
    this.blockedPeers.clear()
    console.log('[MuSig2Security] Cleared all violations and blocked peers')
  }
}
