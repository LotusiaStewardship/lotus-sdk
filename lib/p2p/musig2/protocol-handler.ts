/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 P2P Protocol Handler
 *
 * Implements IProtocolHandler for MuSig2 coordination
 */

import type { P2PMessage, PeerInfo, IProtocolHandler } from '../types.js'
import type { MuSig2Coordinator } from './coordinator.js'
import {
  MuSig2MessageType,
  MuSig2Event,
  SessionAnnouncementPayload,
  SessionJoinPayload,
  NonceSharePayload,
  PartialSigSharePayload,
  ValidationErrorPayload,
  SignerAdvertisementPayload,
  SigningRequestPayload,
  ParticipantJoinedPayload,
  MUSIG2_SECURITY_LIMITS,
} from './types.js'
import {
  deserializePublicNonce,
  deserializeBN,
  deserializePublicKey,
  deserializeMessage,
} from './serialization.js'
import { SecurityManager } from './security.js'

/**
 * MuSig2 P2P Protocol Handler
 *
 * Handles incoming MuSig2 messages and routes them to the coordinator
 */
export class MuSig2ProtocolHandler implements IProtocolHandler {
  readonly protocolName = 'musig2'
  readonly protocolId = '/lotus/musig2/1.0.0'

  private coordinator?: MuSig2Coordinator
  private securityManager?: SecurityManager

  /**
   * Set the coordinator instance
   */
  setCoordinator(coordinator: MuSig2Coordinator): void {
    this.coordinator = coordinator
  }

  /**
   * Set the security manager instance
   */
  setSecurityManager(securityManager: SecurityManager): void {
    this.securityManager = securityManager
  }

  /**
   * Handle incoming message
   */
  async handleMessage(message: P2PMessage, from: PeerInfo): Promise<void> {
    if (!this.coordinator) {
      console.error('[MuSig2P2P] Coordinator not set')
      return
    }

    if (message.protocol !== this.protocolName) {
      return // Not for us
    }

    try {
      switch (message.type) {
        // Phase 0: Signer advertisement
        case MuSig2MessageType.SIGNER_ADVERTISEMENT:
          await this._handleSignerAdvertisement(
            message.payload as SignerAdvertisementPayload,
            from,
          )
          break

        case MuSig2MessageType.SIGNER_UNAVAILABLE:
          await this._handleSignerUnavailable(
            message.payload as { peerId: string; publicKey: string },
            from,
          )
          break

        // Phase 1-2: Signing request
        case MuSig2MessageType.SIGNING_REQUEST:
          await this._handleSigningRequest(
            message.payload as SigningRequestPayload,
            from,
          )
          break

        case MuSig2MessageType.PARTICIPANT_JOINED:
          await this._handleParticipantJoined(
            message.payload as ParticipantJoinedPayload,
            from,
          )
          break

        case MuSig2MessageType.SESSION_READY:
          await this._handleSessionReady(
            message.payload as { requestId: string; participantIndex: number },
            from,
          )
          break

        // Legacy: Session lifecycle
        case MuSig2MessageType.SESSION_ANNOUNCE:
          await this._handleSessionAnnounce(
            message.payload as SessionAnnouncementPayload,
            from,
          )
          break

        case MuSig2MessageType.SESSION_JOIN:
          await this._handleSessionJoin(
            message.payload as SessionJoinPayload,
            from,
          )
          break

        case MuSig2MessageType.NONCE_SHARE:
          await this._handleNonceShare(
            message.payload as NonceSharePayload,
            from,
          )
          break

        case MuSig2MessageType.PARTIAL_SIG_SHARE:
          await this._handlePartialSigShare(
            message.payload as PartialSigSharePayload,
            from,
          )
          break

        case MuSig2MessageType.SESSION_ABORT:
          await this._handleSessionAbort(
            message.payload as { sessionId: string; reason?: string },
            from,
          )
          break

        case MuSig2MessageType.VALIDATION_ERROR:
          await this._handleValidationError(
            message.payload as ValidationErrorPayload,
            from,
          )
          break

        default:
          console.warn(`[MuSig2P2P] Unknown message type: ${message.type}`)
      }
    } catch (error) {
      console.error(
        `[MuSig2P2P] Error handling message ${message.type}:`,
        error,
      )
      // Send error back to sender if we can identify the session
      if (
        message.payload &&
        typeof message.payload === 'object' &&
        'sessionId' in message.payload
      ) {
        try {
          await this._sendValidationError(
            (message.payload as { sessionId: string }).sessionId,
            from.peerId,
            error instanceof Error ? error.message : String(error),
          )
        } catch (sendError) {
          // Failed to send error back (peer may have disconnected or invalid peer ID)
          console.error(
            '[MuSig2P2P] Failed to send validation error:',
            sendError,
          )
        }
      }
    }
  }

  /**
   * Handle peer connection
   */
  async onPeerConnected(peerId: string): Promise<void> {
    if (this.coordinator) {
      this.coordinator._onPeerConnected(peerId)
    }
  }

  /**
   * Handle peer disconnection
   */
  async onPeerDisconnected(peerId: string): Promise<void> {
    if (this.coordinator) {
      this.coordinator._onPeerDisconnected(peerId)
    }
  }

  /**
   * Handle session announcement
   */
  private async _handleSessionAnnounce(
    payload: SessionAnnouncementPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    // Deserialize signers
    const signers = payload.signers.map(hex => deserializePublicKey(hex))
    const message = deserializeMessage(payload.message)

    await this.coordinator._handleSessionAnnouncement(
      payload.sessionId,
      signers,
      payload.creatorIndex,
      message,
      from.peerId,
      payload.metadata,
    )
  }

  /**
   * Handle session join
   */
  private async _handleSessionJoin(
    payload: SessionJoinPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    await this.coordinator._handleSessionJoin(
      payload.sessionId,
      payload.signerIndex,
      payload.sequenceNumber,
      deserializePublicKey(payload.publicKey),
      from.peerId,
    )
  }

  /**
   * Handle nonce share
   */
  private async _handleNonceShare(
    payload: NonceSharePayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    const publicNonce = deserializePublicNonce(payload.publicNonce)

    await this.coordinator._handleNonceShare(
      payload.sessionId,
      payload.signerIndex,
      payload.sequenceNumber,
      publicNonce,
      from.peerId,
    )
  }

  /**
   * Handle partial signature share
   */
  private async _handlePartialSigShare(
    payload: PartialSigSharePayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    const partialSig = deserializeBN(payload.partialSig)

    await this.coordinator._handlePartialSigShare(
      payload.sessionId,
      payload.signerIndex,
      payload.sequenceNumber,
      partialSig,
      from.peerId,
    )
  }

  /**
   * Handle session abort
   */
  private async _handleSessionAbort(
    payload: { sessionId: string; reason?: string },
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    await this.coordinator._handleSessionAbort(
      payload.sessionId,
      payload.reason || 'Aborted by peer',
      from.peerId,
    )
  }

  /**
   * Handle validation error
   */
  private async _handleValidationError(
    payload: ValidationErrorPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    await this.coordinator._handleValidationError(
      payload.sessionId,
      payload.error,
      payload.code,
      from.peerId,
    )
  }

  /**
   * Send validation error to peer
   */
  private async _sendValidationError(
    sessionId: string,
    peerId: string,
    error: string,
    code: string = 'VALIDATION_ERROR',
  ): Promise<void> {
    if (!this.coordinator) return

    const payload: ValidationErrorPayload = {
      sessionId,
      error,
      code,
    }

    await this.coordinator._sendMessageToPeer(
      peerId,
      MuSig2MessageType.VALIDATION_ERROR,
      payload,
    )
  }

  /**
   * Handle signer advertisement
   */
  private async _handleSignerAdvertisement(
    payload: SignerAdvertisementPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator || !this.securityManager) return

    // SECURITY 0: Check peer reputation (blacklist/graylist)
    if (!this.securityManager.peerReputation.isAllowed(from.peerId)) {
      console.warn(
        `[MuSig2P2P] ⚠️  Advertisement from blacklisted/graylisted peer: ${from.peerId}`,
      )
      return // Drop from banned peer
    }

    // SECURITY 1: Timestamp validation (prevent future/past attacks)
    const timestampSkew = Math.abs(Date.now() - payload.timestamp)
    if (timestampSkew > MUSIG2_SECURITY_LIMITS.MAX_TIMESTAMP_SKEW) {
      console.warn(
        `[MuSig2P2P] ⚠️  Advertisement timestamp out of range: ${timestampSkew}ms skew (max: ${MUSIG2_SECURITY_LIMITS.MAX_TIMESTAMP_SKEW}ms)`,
      )
      return // Drop time-invalid advertisement
    }

    // SECURITY 2: Expiry enforcement (drop expired immediately)
    if (payload.expiresAt && payload.expiresAt < Date.now()) {
      console.warn(
        `[MuSig2P2P] ⚠️  Expired advertisement rejected: ${payload.peerId}`,
      )
      return // Drop expired advertisement
    }

    const advertisement = {
      peerId: payload.peerId,
      multiaddrs: payload.multiaddrs,
      publicKey: deserializePublicKey(payload.publicKey),
      criteria: payload.criteria,
      metadata: payload.metadata,
      timestamp: payload.timestamp,
      expiresAt: payload.expiresAt,
      signature: Buffer.from(payload.signature, 'hex'),
    }

    // SECURITY 3: Verify signature BEFORE trusting
    // Don't trust the sender - verify cryptographic proof locally
    if (!this.coordinator.verifyAdvertisementSignature(advertisement)) {
      console.warn(
        `[MuSig2P2P] ⚠️  Rejected invalid advertisement from P2P: ${payload.peerId}`,
      )
      // Track invalid signature
      this.securityManager.recordInvalidSignature(from.peerId)
      return // Drop invalid advertisement
    }

    // SECURITY 4: Check rate limit and key count
    if (
      !this.securityManager.canAdvertiseKey(
        from.peerId,
        advertisement.publicKey,
      )
    ) {
      console.warn(
        `[MuSig2P2P] ⚠️  Advertisement rejected (rate limit or key limit): ${from.peerId}`,
      )
      return // Drop rate-limited advertisement
    }

    // All security checks passed - emit event
    this.coordinator.emit(MuSig2Event.SIGNER_DISCOVERED, advertisement)
  }

  /**
   * Handle signer unavailable
   */
  private async _handleSignerUnavailable(
    payload: { peerId: string; publicKey: string },
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    this.coordinator.emit(MuSig2Event.SIGNER_UNAVAILABLE, {
      peerId: payload.peerId,
      publicKey: deserializePublicKey(payload.publicKey),
    })
  }

  /**
   * Handle signing request
   */
  private async _handleSigningRequest(
    payload: SigningRequestPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    // Store request and emit event
    this.coordinator.emit(MuSig2Event.SIGNING_REQUEST_RECEIVED, {
      requestId: payload.requestId,
      requiredPublicKeys: payload.requiredPublicKeys.map(hex =>
        deserializePublicKey(hex),
      ),
      message: Buffer.from(payload.message, 'hex'),
      creatorPeerId: payload.creatorPeerId,
      creatorPublicKey: deserializePublicKey(payload.creatorPublicKey),
      createdAt: payload.createdAt,
      expiresAt: payload.expiresAt,
      metadata: payload.metadata,
      creatorSignature: Buffer.from(payload.creatorSignature, 'hex'),
    })
  }

  /**
   * Handle participant joined
   */
  private async _handleParticipantJoined(
    payload: ParticipantJoinedPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    // Emit event for coordinator to handle
    this.coordinator.emit(MuSig2Event.PARTICIPANT_JOINED, {
      requestId: payload.requestId,
      participantIndex: payload.participantIndex,
      participantPeerId: payload.participantPeerId,
      participantPublicKey: deserializePublicKey(payload.participantPublicKey),
      timestamp: payload.timestamp,
      signature: Buffer.from(payload.signature, 'hex'),
    })
  }

  /**
   * Handle session ready
   */
  private async _handleSessionReady(
    payload: { requestId: string; participantIndex: number },
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    // Just emit event - coordinator handles it
    this.coordinator.emit(MuSig2Event.SESSION_READY, payload.requestId)
  }
}
