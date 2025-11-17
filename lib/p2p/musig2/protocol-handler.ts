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

import type {
  P2PMessage,
  PeerInfo,
  IProtocolHandler,
  Stream,
  Connection,
} from '../types.js'
import type { MuSig2P2PCoordinator } from './coordinator.js'
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
import { DeserializationError, ValidationError } from './errors.js'
import {
  validateSessionAnnouncementPayload,
  validateSessionJoinPayload,
  validateNonceSharePayload,
  validatePartialSigSharePayload,
  validateSignerAdvertisementPayload,
  validateSigningRequestPayload,
  validateParticipantJoinedPayload,
} from './validation.js'

/**
 * MuSig2 P2P Protocol Handler
 *
 * Handles incoming MuSig2 messages and routes them to the coordinator
 */
export class MuSig2ProtocolHandler implements IProtocolHandler {
  readonly protocolName = 'musig2'
  readonly protocolId = '/lotus/musig2/1.0.0'

  private coordinator?: MuSig2P2PCoordinator
  private securityManager?: SecurityManager

  /**
   * Set the coordinator instance
   */
  setCoordinator(coordinator: MuSig2P2PCoordinator): void {
    this.coordinator = coordinator
  }

  /**
   * Set the security manager instance
   */
  setSecurityManager(securityManager: SecurityManager): void {
    this.securityManager = securityManager
  }

  /**
   * Handle incoming stream (required for protocol advertisement registration)
   */
  async handleStream(stream: Stream, connection: Connection): Promise<void> {
    try {
      const data: Uint8Array[] = []
      let totalSize = 0
      const MAX_MESSAGE_SIZE = 100_000 // 100KB limit (DoS protection)

      // Stream is AsyncIterable - iterate directly
      for await (const chunk of stream) {
        if (chunk instanceof Uint8Array) {
          totalSize += chunk.length

          // SECURITY: Check total size to prevent memory exhaustion
          if (totalSize > MAX_MESSAGE_SIZE) {
            console.warn(
              `[MuSig2P2P] Oversized message from ${connection.remotePeer.toString()}: ${totalSize} bytes (max: ${MAX_MESSAGE_SIZE})`,
            )
            stream.abort(new Error('Message too large'))
            return
          }

          data.push(chunk.subarray())
        } else {
          // Handle Uint8ArrayList
          totalSize += chunk.length

          // SECURITY: Check total size
          if (totalSize > MAX_MESSAGE_SIZE) {
            console.warn(
              `[MuSig2P2P] Oversized message from ${connection.remotePeer.toString()}: ${totalSize} bytes (max: ${MAX_MESSAGE_SIZE})`,
            )
            stream.abort(new Error('Message too large'))
            return
          }

          data.push(chunk.subarray())
        }
      }

      // Check if we received any data
      if (data.length === 0) {
        // Stream closed without sending data - this can happen during shutdown
        return
      }

      // Combine chunks
      const combined = Buffer.concat(data.map(d => Buffer.from(d)))

      // Check if combined buffer is empty
      if (combined.length === 0) {
        return
      }

      // Deserialize message
      const message: P2PMessage = JSON.parse(combined.toString('utf8'))

      // Get peer info
      const from: PeerInfo = {
        peerId: connection.remotePeer.toString(),
        lastSeen: Date.now(),
      }

      // Route to message handler
      await this.handleMessage(message, from)
    } catch (error) {
      console.error(`[MuSig2P2P] Error processing incoming stream:`, error)
    }
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

    // Filter out messages we sent ourselves - we already processed them internally
    // This eliminates the need for conditionals in peer handlers
    if (message.from === this.coordinator.peerId) {
      return // Ignore our own broadcasts
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
   * Handle peer discovery (before connection established)
   * Called when bootstrap nodes discover peers on the network
   */
  async onPeerDiscovered(peerInfo: PeerInfo): Promise<void> {
    if (this.coordinator) {
      this.coordinator._onPeerDiscovered(peerInfo)
    }
  }

  /**
   * Handle peer connection (after successful connection)
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
   * Handle peer information update
   */
  async onPeerUpdated(peerInfo: PeerInfo): Promise<void> {
    if (this.coordinator) {
      this.coordinator._onPeerUpdated(peerInfo)
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

    try {
      // SECURITY: Validate payload structure first
      validateSessionAnnouncementPayload(payload)

      // Deserialize signers - safely handle malformed data
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
    } catch (error) {
      if (
        error instanceof DeserializationError ||
        error instanceof ValidationError
      ) {
        console.warn(
          `[MuSig2P2P] ⚠️  Malformed session announcement from ${from.peerId}: ${error.message}`,
        )
        // Track malicious peer
        if (this.securityManager) {
          this.securityManager.recordInvalidSignature(from.peerId)
        }
        return
      }
      // SECURITY: Never re-throw - log and drop to prevent DoS
      console.error(
        `[MuSig2P2P] ❌ Unexpected error handling session announcement from ${from.peerId}:`,
        error,
      )
      if (this.securityManager) {
        this.securityManager.peerReputation.recordSpam(from.peerId)
      }
      return
    }
  }

  /**
   * Handle session join
   */
  private async _handleSessionJoin(
    payload: SessionJoinPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    try {
      // SECURITY: Validate payload structure
      validateSessionJoinPayload(payload)

      const publicKey = deserializePublicKey(payload.publicKey)

      await this.coordinator._handleSessionJoin(
        payload.sessionId,
        payload.signerIndex,
        payload.sequenceNumber,
        publicKey,
        from.peerId,
      )
    } catch (error) {
      if (
        error instanceof DeserializationError ||
        error instanceof ValidationError
      ) {
        console.warn(
          `[MuSig2P2P] ⚠️  Malformed session join from ${from.peerId}: ${error.message}`,
        )
        if (this.securityManager) {
          this.securityManager.recordInvalidSignature(from.peerId)
        }
        return
      }
      // SECURITY: Never re-throw - log and drop to prevent DoS
      console.error(
        `[MuSig2P2P] ❌ Unexpected error handling session join from ${from.peerId}:`,
        error,
      )
      if (this.securityManager) {
        this.securityManager.peerReputation.recordSpam(from.peerId)
      }
      return
    }
  }

  /**
   * Handle nonce share
   */
  private async _handleNonceShare(
    payload: NonceSharePayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    try {
      // SECURITY: Validate payload structure
      validateNonceSharePayload(payload)

      const publicNonce = deserializePublicNonce(payload.publicNonce)

      await this.coordinator._handleNonceShare(
        payload.sessionId,
        payload.signerIndex,
        payload.sequenceNumber,
        publicNonce,
        from.peerId,
      )
    } catch (error) {
      if (
        error instanceof DeserializationError ||
        error instanceof ValidationError
      ) {
        console.warn(
          `[MuSig2P2P] ⚠️  Malformed nonce share from ${from.peerId}: ${error.message}`,
        )
        if (this.securityManager) {
          this.securityManager.recordInvalidSignature(from.peerId)
        }
        return
      }
      // SECURITY: Never re-throw - log and drop to prevent DoS
      console.error(
        `[MuSig2P2P] ❌ Unexpected error handling nonce share from ${from.peerId}:`,
        error,
      )
      if (this.securityManager) {
        this.securityManager.peerReputation.recordSpam(from.peerId)
      }
      return
    }
  }

  /**
   * Handle partial signature share
   */
  private async _handlePartialSigShare(
    payload: PartialSigSharePayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    try {
      // SECURITY: Validate payload structure
      validatePartialSigSharePayload(payload)

      const partialSig = deserializeBN(payload.partialSig)

      await this.coordinator._handlePartialSigShare(
        payload.sessionId,
        payload.signerIndex,
        payload.sequenceNumber,
        partialSig,
        from.peerId,
      )
    } catch (error) {
      if (
        error instanceof DeserializationError ||
        error instanceof ValidationError
      ) {
        console.warn(
          `[MuSig2P2P] ⚠️  Malformed partial signature from ${from.peerId}: ${error.message}`,
        )
        if (this.securityManager) {
          this.securityManager.recordInvalidSignature(from.peerId)
        }
        return
      }
      // SECURITY: Never re-throw - log and drop to prevent DoS
      console.error(
        `[MuSig2P2P] ❌ Unexpected error handling partial signature from ${from.peerId}:`,
        error,
      )
      if (this.securityManager) {
        this.securityManager.peerReputation.recordSpam(from.peerId)
      }
      return
    }
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

    try {
      // SECURITY: Validate payload structure first
      validateSignerAdvertisementPayload(payload)

      // SECURITY: Safely deserialize public key and signature
      const publicKey = deserializePublicKey(payload.publicKey)
      const signature = Buffer.from(payload.signature, 'hex')

      const advertisement = {
        peerId: payload.peerId,
        multiaddrs: payload.multiaddrs,
        publicKey,
        criteria: payload.criteria,
        metadata: payload.metadata,
        timestamp: payload.timestamp,
        expiresAt: payload.expiresAt,
        signature,
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

      // Prevent duplicate emissions - check if signer already discovered
      const pubKeyStr = advertisement.publicKey.toString()
      if (this.coordinator.hasSignerAdvertisement(pubKeyStr)) {
        // Already discovered this signer, skip duplicate emission
        return
      }

      // All security checks passed - emit event
      this.coordinator.emit(MuSig2Event.SIGNER_DISCOVERED, advertisement)
    } catch (error) {
      if (
        error instanceof DeserializationError ||
        error instanceof ValidationError
      ) {
        console.warn(
          `[MuSig2P2P] ⚠️  Malformed advertisement from ${from.peerId}: ${error.message}`,
        )
        this.securityManager.recordInvalidSignature(from.peerId)
        return
      }
      // SECURITY: Never re-throw - log and drop to prevent DoS
      console.error(
        `[MuSig2P2P] ❌ Unexpected error handling advertisement from ${from.peerId}:`,
        error,
      )
      this.securityManager.peerReputation.recordSpam(from.peerId)
      return
    }
  }

  /**
   * Handle signer unavailable
   */
  private async _handleSignerUnavailable(
    payload: { peerId: string; publicKey: string },
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    try {
      const publicKey = deserializePublicKey(payload.publicKey)

      this.coordinator.emit(MuSig2Event.SIGNER_UNAVAILABLE, {
        peerId: payload.peerId,
        publicKey,
      })
    } catch (error) {
      if (error instanceof DeserializationError) {
        console.warn(
          `[MuSig2P2P] ⚠️  Malformed signer unavailable from ${from.peerId}: ${error.message}`,
        )
        if (this.securityManager) {
          this.securityManager.recordInvalidSignature(from.peerId)
        }
        return
      }
      // SECURITY: Never re-throw - log and drop to prevent DoS
      console.error(
        `[MuSig2P2P] ❌ Unexpected error handling signer unavailable from ${from.peerId}:`,
        error,
      )
      if (this.securityManager) {
        this.securityManager.peerReputation.recordSpam(from.peerId)
      }
      return
    }
  }

  /**
   * Handle signing request
   */
  private async _handleSigningRequest(
    payload: SigningRequestPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    try {
      // SECURITY: Validate payload structure
      validateSigningRequestPayload(payload)

      // Safely deserialize all keys and buffers
      const requiredPublicKeys = payload.requiredPublicKeys.map(hex =>
        deserializePublicKey(hex),
      )
      const message = Buffer.from(payload.message, 'hex')
      const creatorPublicKey = deserializePublicKey(payload.creatorPublicKey)
      const creatorSignature = Buffer.from(payload.creatorSignature, 'hex')

      // Store request and emit event
      this.coordinator.emit(MuSig2Event.SIGNING_REQUEST_RECEIVED, {
        requestId: payload.requestId,
        requiredPublicKeys,
        message,
        creatorPeerId: payload.creatorPeerId,
        creatorPublicKey,
        createdAt: payload.createdAt,
        expiresAt: payload.expiresAt,
        metadata: payload.metadata,
        creatorSignature,
      })
    } catch (error) {
      if (
        error instanceof DeserializationError ||
        error instanceof ValidationError
      ) {
        console.warn(
          `[MuSig2P2P] ⚠️  Malformed signing request from ${from.peerId}: ${error.message}`,
        )
        if (this.securityManager) {
          this.securityManager.recordInvalidSignature(from.peerId)
        }
        return
      }
      // SECURITY: Never re-throw - log and drop to prevent DoS
      console.error(
        `[MuSig2P2P] ❌ Unexpected error handling signing request from ${from.peerId}:`,
        error,
      )
      if (this.securityManager) {
        this.securityManager.peerReputation.recordSpam(from.peerId)
      }
      return
    }
  }

  /**
   * Handle participant joined
   */
  private async _handleParticipantJoined(
    payload: ParticipantJoinedPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    try {
      // SECURITY: Validate payload structure
      validateParticipantJoinedPayload(payload)

      // Safely deserialize public key and signature
      const participantPublicKey = deserializePublicKey(
        payload.participantPublicKey,
      )
      const signature = Buffer.from(payload.signature, 'hex')

      // Check if participant already joined (prevent duplicate processing)
      // The coordinator's PARTICIPANT_JOINED handler will check for duplicates,
      // but we can also check here to avoid unnecessary event emission
      // Note: We rely on the coordinator's internal duplicate prevention
      // since activeSigningSessions is private

      // Emit event for coordinator to handle
      this.coordinator.emit(MuSig2Event.PARTICIPANT_JOINED, {
        requestId: payload.requestId,
        participantIndex: payload.participantIndex,
        participantPeerId: payload.participantPeerId,
        participantPublicKey,
        timestamp: payload.timestamp,
        signature,
      })
    } catch (error) {
      if (
        error instanceof DeserializationError ||
        error instanceof ValidationError
      ) {
        console.warn(
          `[MuSig2P2P] ⚠️  Malformed participant joined from ${from.peerId}: ${error.message}`,
        )
        if (this.securityManager) {
          this.securityManager.recordInvalidSignature(from.peerId)
        }
        return
      }
      // SECURITY: Never re-throw - log and drop to prevent DoS
      console.error(
        `[MuSig2P2P] ❌ Unexpected error handling participant joined from ${from.peerId}:`,
        error,
      )
      if (this.securityManager) {
        this.securityManager.peerReputation.recordSpam(from.peerId)
      }
      return
    }
  }

  /**
   * Handle session ready
   */
  private async _handleSessionReady(
    payload: { requestId: string; participantIndex: number },
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    // When receiving SESSION_READY broadcast, ensure our own session is created
    // This handles race conditions where we receive SESSION_READY before local session creation completes
    await this.coordinator.ensureSessionCreated(payload.requestId)

    // Emit event with duplicate prevention - coordinator handles it
    this.coordinator.emitEventWithDuplicatePrevention(
      MuSig2Event.SESSION_READY,
      payload.requestId,
    )
  }
}
