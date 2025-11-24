/**
 * MuSig2 Security and Validation
 *
 * Protocol-specific security validation for MuSig2 sessions
 */

import type { IProtocolValidator, P2PMessage, PeerInfo } from '../types.js'
import type { SessionAnnouncement } from './types.js'
import { MuSig2MessageType } from './types.js'
import { PublicKey } from '../../bitcore/publickey.js'

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
}

/**
 * Default security configuration
 */
export const DEFAULT_MUSIG2_SECURITY: Required<MuSig2SecurityConfig> = {
  minSigners: 2,
  maxSigners: 15,
  maxSessionDuration: 10 * 60 * 1000, // 10 minutes
  requireValidPublicKeys: true,
}

/**
 * MuSig2 Protocol Validator
 *
 * Implements protocol-specific validation for MuSig2 sessions
 */
export class MuSig2SecurityValidator implements IProtocolValidator {
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
   */
  async validateMessage(message: P2PMessage, from: PeerInfo): Promise<boolean> {
    // Basic validation
    if (!message.payload || typeof message.payload !== 'object') {
      console.warn('[MuSig2Security] Invalid message payload')
      return false
    }

    const payload = message.payload as Record<string, unknown>

    // All MuSig2 messages must have sessionId and timestamp
    if (!payload.sessionId || !payload.timestamp) {
      console.warn('[MuSig2Security] Missing sessionId or timestamp')
      return false
    }

    // Validate timestamp (within 5 minutes)
    const now = Date.now()
    const messageTime = payload.timestamp as number
    if (Math.abs(now - messageTime) > 5 * 60 * 1000) {
      console.warn('[MuSig2Security] Message timestamp too old or in future')
      return false
    }

    // Type-specific validation
    switch (message.type) {
      case MuSig2MessageType.SESSION_JOIN:
        return this.validateJoinMessage(payload)

      case MuSig2MessageType.NONCE_COMMITMENT:
        return this.validateCommitmentMessage(payload)

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
    // Basic check - can be extended with reputation system
    if (!resourceType.startsWith('musig2-session')) {
      return true
    }

    // For now, allow all peers to announce
    // In production, could check reputation, rate limits, etc.
    return true
  }
}
