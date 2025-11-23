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
  NonceCommitmentPayload,
  NonceSharePayload,
  PartialSigSharePayload,
  ValidationErrorPayload,
  SignerAdvertisementPayload,
  SigningRequestPayload,
  ParticipantJoinedPayload,
  MUSIG2_SECURITY_LIMITS,
  SessionReadyPayload,
} from './types.js'
import {
  deserializePublicNonce,
  deserializeBN,
  deserializePublicKey,
  deserializeMessage,
} from './serialization.js'
import { SecurityManager, PEER_KEY_LIMITS } from './security.js'
import { DeserializationError, ValidationError } from './errors.js'
import {
  validateSessionAnnouncementPayload,
  validateSessionJoinPayload,
  validateNonceCommitmentPayload,
  validateNonceSharePayload,
  validatePartialSigSharePayload,
  validateSignerAdvertisementPayload,
  validateSigningRequestPayload,
  validateParticipantJoinedPayload,
} from './validation.js'
import { MESSAGE_CHANNELS } from './message-channels.js'
import { MessageValidator, MessageChannel } from './message-validator.js'

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
  private messageValidator: MessageValidator = new MessageValidator()
  // REMOVED participantJoinCache - duplicate prevention now handled by coordinator only

  private debugLog(
    context: string,
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    if (!this.coordinator) {
      return
    }

    this.coordinator.debugLog(`protocol:${context}`, message, extra)
  }

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
    const peerId = connection.remotePeer.toString()
    this.debugLog('stream', 'Handling incoming stream', { peerId })
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
            this.debugLog('stream', 'Aborted oversized message', {
              peerId,
              totalSize,
            })
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
      this.debugLog('stream', 'Decoded message from stream', {
        peerId,
        type: message.type,
      })

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
      this.debugLog('message', 'Ignored message for different protocol', {
        from: from.peerId,
        messageProtocol: message.protocol,
      })
      return // Not for us
    }

    // ARCHITECTURE CHANGE (2025-11-21): Filter self-messages to prevent duplicate processing
    //
    // PREVIOUS ARCHITECTURE: Sender received own broadcasts via GossipSub
    // - Caused duplicate event processing
    // - Required duplicate caches at multiple layers
    // - Created race conditions between local and broadcast events
    // - Made event ordering unpredictable
    //
    // NEW ARCHITECTURE: Local-first pattern
    // - Broadcaster updates local state immediately (synchronous)
    // - Broadcaster emits local events immediately (synchronous)
    // - Broadcast is sent to network (asynchronous, fire-and-forget)
    // - Self-messages are filtered out (this check)
    //
    // Benefits:
    // 1. No duplicate processing (self-messages ignored)
    // 2. Predictable event ordering (local events fire immediately)
    // 3. Single duplicate prevention point (in coordinator)
    // 4. Easier debugging (no race between local and broadcast events)
    //
    // CRITICAL: Ignore messages from self to prevent duplicate processing
    if (from.peerId === this.coordinator.peerId) {
      this.debugLog(
        'message',
        '⚠️  Ignoring self-message (local state already updated)',
        {
          type: message.type,
          from: from.peerId,
        },
      )
      return
    }

    this.debugLog('message', 'Routing message from remote peer', {
      type: message.type,
      from: from.peerId,
    })

    // PHASE 1: Channel validation - ENFORCED
    // Messages received via handleMessage come from direct libp2p streams (handleStream)
    // They should be DIRECT channel messages per our architecture
    try {
      this.messageValidator.validateChannel(
        message.type as MuSig2MessageType,
        MessageChannel.DIRECT,
      )
    } catch (error) {
      // REJECT messages on wrong channels - enforcement is now active
      console.error(
        `[MuSig2P2P] Channel violation - REJECTING: ${error instanceof Error ? error.message : String(error)}`,
      )
      this.debugLog('message', 'Channel validation failed - message rejected', {
        type: message.type,
        from: from.peerId,
        error: error instanceof Error ? error.message : String(error),
      })
      return // Reject message completely
    }

    try {
      // PHASE 4: Use switch statement with authority validation (sufficient for spec compliance)
      // Note: Centralized handler map is complex to implement due to method signature differences
      // The switch statement approach provides the same clean routing functionality

      // Validate authority before routing
      const config = MESSAGE_CHANNELS[message.type as MuSig2MessageType]
      if (config) {
        // Authority validation is handled in the coordinator sendMessage method
        // No need to duplicate here
      }

      switch (message.type) {
        // Phase 0: Signer advertisement
        case MuSig2MessageType.SIGNER_ADVERTISEMENT:
          this.debugLog('message', 'Handling SIGNER_ADVERTISEMENT', {
            from: from.peerId,
          })
          await this._handleSignerAdvertisement(
            message.payload as SignerAdvertisementPayload,
            from,
          )
          break

        case MuSig2MessageType.SIGNER_UNAVAILABLE:
          this.debugLog('message', 'Handling SIGNER_UNAVAILABLE', {
            from: from.peerId,
          })
          await this._handleSignerUnavailable(
            message.payload as { peerId: string; publicKey: string },
            from,
          )
          break

        // Phase 1-2: Signing request
        case MuSig2MessageType.SIGNING_REQUEST:
          this.debugLog('message', 'Handling SIGNING_REQUEST', {
            from: from.peerId,
          })
          await this._handleSigningRequest(
            message.payload as SigningRequestPayload,
            from,
          )
          break

        case MuSig2MessageType.PARTICIPANT_JOINED:
          this.debugLog('message', 'Handling PARTICIPANT_JOINED', {
            from: from.peerId,
          })
          await this._handleParticipantJoined(
            message.payload as ParticipantJoinedPayload,
            from,
          )
          break

        case MuSig2MessageType.SESSION_READY:
          this.debugLog('message', 'Handling SESSION_READY', {
            from: from.peerId,
          })
          await this._handleSessionReady(
            message.payload as SessionReadyPayload,
            from,
          )
          break

        case MuSig2MessageType.SESSION_JOIN:
          this.debugLog('message', 'Handling SESSION_JOIN', {
            from: from.peerId,
          })
          await this._handleSessionJoin(
            message.payload as SessionJoinPayload,
            from,
          )
          break

        case MuSig2MessageType.NONCE_COMMIT:
          this.debugLog('message', 'Handling NONCE_COMMIT', {
            from: from.peerId,
          })
          await this._handleNonceCommit(
            message.payload as NonceCommitmentPayload,
            from,
          )
          break

        case MuSig2MessageType.NONCE_SHARE:
          this.debugLog('message', 'Handling NONCE_SHARE', {
            from: from.peerId,
          })
          await this._handleNonceShare(
            message.payload as NonceSharePayload,
            from,
          )
          break

        case MuSig2MessageType.PARTIAL_SIG_SHARE:
          this.debugLog('message', 'Handling PARTIAL_SIG_SHARE', {
            from: from.peerId,
          })
          await this._handlePartialSigShare(
            message.payload as PartialSigSharePayload,
            from,
          )
          break

        case MuSig2MessageType.SESSION_ABORT:
          this.debugLog('message', 'Handling SESSION_ABORT', {
            from: from.peerId,
          })
          await this._handleSessionAbort(
            message.payload as { sessionId: string; reason?: string },
            from,
          )
          break

        case MuSig2MessageType.VALIDATION_ERROR:
          this.debugLog('message', 'Handling VALIDATION_ERROR', {
            from: from.peerId,
          })
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
      this.debugLog('message', 'Error handling message', {
        type: message.type,
        from: from.peerId,
        error: error instanceof Error ? error.message : String(error),
      })
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
      this.debugLog('peer', 'Peer discovered', {
        peerId: peerInfo.peerId,
      })
    }
  }

  /**
   * Handle peer connection (after successful connection)
   */
  async onPeerConnected(peerId: string): Promise<void> {
    if (this.coordinator) {
      this.coordinator._onPeerConnected(peerId)
      this.debugLog('peer', 'Peer connected', { peerId })
    }
  }

  /**
   * Handle peer disconnection
   */
  async onPeerDisconnected(peerId: string): Promise<void> {
    if (this.coordinator) {
      this.coordinator._onPeerDisconnected(peerId)
      this.debugLog('peer', 'Peer disconnected', { peerId })
    }
  }

  /**
   * Handle peer information update
   */
  async onPeerUpdated(peerInfo: PeerInfo): Promise<void> {
    if (this.coordinator) {
      this.coordinator._onPeerUpdated(peerInfo)
      this.debugLog('peer', 'Peer updated', { peerId: peerInfo.peerId })
    }
  }

  /**
   * Handle relay address changes from core P2P layer
   */
  async onRelayAddressesChanged(data: {
    peerId: string
    reachableAddresses: string[]
    relayAddresses: string[]
    timestamp: number
  }): Promise<void> {
    if (this.coordinator) {
      this.coordinator._onRelayAddressesChanged(data)
      this.debugLog('peer', 'Relay addresses changed', {
        peerId: data.peerId,
        relays: data.relayAddresses.length,
        reachable: data.reachableAddresses.length,
      })
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
      this.debugLog('session', 'Processed SESSION_JOIN payload', {
        sessionId: payload.sessionId,
        signerIndex: payload.signerIndex,
        from: from.peerId,
      })
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
   * Handle nonce commitment
   */
  private async _handleNonceCommit(
    payload: NonceCommitmentPayload,
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) return

    try {
      validateNonceCommitmentPayload(payload)

      await this.coordinator._handleNonceCommit(
        payload.sessionId,
        payload.signerIndex,
        payload.sequenceNumber,
        payload.commitment,
        from.peerId,
      )
      this.debugLog('nonce:commit', 'Processed NONCE_COMMIT payload', {
        sessionId: payload.sessionId,
        signerIndex: payload.signerIndex,
        from: from.peerId,
      })
    } catch (error) {
      if (
        error instanceof DeserializationError ||
        error instanceof ValidationError
      ) {
        console.warn(
          `[MuSig2P2P] ⚠️  Malformed nonce commitment from ${from.peerId}: ${error.message}`,
        )
        if (this.securityManager) {
          this.securityManager.recordInvalidSignature(from.peerId)
        }
        return
      }
      console.error(
        `[MuSig2P2P] ❌ Unexpected error handling nonce commitment from ${from.peerId}:`,
        error,
      )
      if (this.securityManager) {
        this.securityManager.peerReputation.recordSpam(from.peerId)
      }
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
      this.debugLog('nonce:share', 'Processed NONCE_SHARE payload', {
        sessionId: payload.sessionId,
        signerIndex: payload.signerIndex,
        from: from.peerId,
      })
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
      this.debugLog('partial-sig', 'Processed PARTIAL_SIG_SHARE payload', {
        sessionId: payload.sessionId,
        signerIndex: payload.signerIndex,
        from: from.peerId,
      })
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

      // ARCHITECTURE: Emit appropriate event based on sender
      // - If from self: emit SIGNER_ADVERTISED (we successfully advertised)
      // - If from others: emit SIGNER_DISCOVERED (we discovered a signer)
      const isSelfAdvertisement = from.peerId === this.coordinator.peerId

      if (isSelfAdvertisement) {
        // We advertised ourselves successfully (received our own broadcast)
        this.coordinator.emit(MuSig2Event.SIGNER_ADVERTISED, advertisement)
      } else {
        // We discovered a signer from another peer
        this.coordinator.emit(MuSig2Event.SIGNER_DISCOVERED, advertisement)
      }
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

      // ARCHITECTURE: Emit appropriate event based on sender
      // - If from self: emit SIGNER_WITHDRAWN (we withdrew our advertisement)
      // - If from others: emit SIGNER_UNAVAILABLE (a signer became unavailable)
      const isSelfWithdrawal = from.peerId === this.coordinator.peerId

      if (isSelfWithdrawal) {
        // We withdrew our advertisement (received our own broadcast)
        this.coordinator.emit(MuSig2Event.SIGNER_WITHDRAWN)
      } else {
        // Another signer became unavailable
        this.coordinator.emit(MuSig2Event.SIGNER_UNAVAILABLE, {
          peerId: payload.peerId,
          publicKey,
        })
      }
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

      // ARCHITECTURE: Emit appropriate event based on sender
      // - If from self: emit SIGNING_REQUEST_CREATED (we created the request)
      // - If from others: emit SIGNING_REQUEST_RECEIVED (we received a request)
      const request = {
        requestId: payload.requestId,
        requiredPublicKeys,
        message,
        creatorPeerId: payload.creatorPeerId,
        creatorPublicKey,
        createdAt: payload.createdAt,
        expiresAt: payload.expiresAt,
        metadata: payload.metadata,
        creatorSignature,
        creatorParticipation: payload.creatorParticipation,
      }

      const isSelfRequest = from.peerId === this.coordinator.peerId

      if (isSelfRequest) {
        // We created this request (received our own broadcast)
        this.coordinator.emit(MuSig2Event.SIGNING_REQUEST_CREATED, request)
      } else {
        // We received a request from another peer
        this.coordinator.emit(MuSig2Event.SIGNING_REQUEST_RECEIVED, request)
      }
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

      // ARCHITECTURE CHANGE (2025-11-21): Removed duplicate prevention from protocol handler
      // With local-first pattern and self-message filtering:
      // - Self-messages are already filtered (handleMessage checks from.peerId)
      // - Coordinator uses metadata.participants as SINGLE source of truth (protected by state lock)
      // - No need for duplicate cache at protocol handler level
      //
      // Benefits:
      // - Single point of duplicate prevention (in coordinator)
      // - No cache synchronization needed
      // - Simpler logic
      // - State lock protects against races

      // Always emit - coordinator will handle duplicates
      this.coordinator.emit(MuSig2Event.PARTICIPANT_JOINED, {
        requestId: payload.requestId,
        participantIndex: payload.participantIndex,
        participantPeerId: payload.participantPeerId,
        participantPublicKey,
        timestamp: payload.timestamp,
        signature,
      })

      // ARCHITECTURE: Also emit SIGNING_REQUEST_JOINED if this is our own participation
      // This provides a semantic "I successfully joined" event for the application
      const isSelfParticipation = from.peerId === this.coordinator.peerId
      if (isSelfParticipation) {
        // Emit event directly - no duplicate prevention needed
        this.coordinator.emit(
          MuSig2Event.SIGNING_REQUEST_JOINED,
          payload.requestId,
        )
      }
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
    payload: {
      requestId: string
      sessionId: string
      participantIndex?: number
      participantPeerId?: string
    },
    from: PeerInfo,
  ): Promise<void> {
    if (!this.coordinator) {
      this.debugLog(
        'session:ready',
        'Coordinator not initialized - skipping session ready',
        {
          requestId: payload.requestId,
          sessionId: payload.sessionId,
          participantIndex: payload.participantIndex,
          participantPeerId: payload.participantPeerId,
        },
      )
      return
    }

    await this.coordinator._handleRemoteSessionReady({
      requestId: payload.requestId,
      sessionId: payload.sessionId,
      participantIndex: payload.participantIndex,
      participantPeerId: payload.participantPeerId ?? from.peerId,
    })
  }

  // REMOVED _markParticipantJoinSeen() - duplicate prevention now in coordinator only
}
