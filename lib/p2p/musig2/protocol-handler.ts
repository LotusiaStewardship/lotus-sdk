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

import { P2PMessage, PeerInfo, IProtocolHandler } from '../types.js'
import {
  MuSig2MessageType,
  SessionAnnouncementPayload,
  SessionJoinPayload,
  NonceSharePayload,
  PartialSigSharePayload,
  ValidationErrorPayload,
} from './types.js'
import {
  deserializePublicNonce,
  deserializeBN,
  deserializePublicKey,
  deserializeMessage,
} from './serialization.js'
import { Point } from '../../bitcore/crypto/point.js'
import { BN } from '../../bitcore/crypto/bn.js'
import { MuSig2P2PCoordinator } from './index.js'

/**
 * MuSig2 P2P Protocol Handler
 *
 * Handles incoming MuSig2 messages and routes them to the coordinator
 */
export class MuSig2P2PProtocolHandler implements IProtocolHandler {
  readonly protocolName = 'musig2'
  readonly protocolId = '/lotus/musig2/1.0.0'

  private coordinator?: MuSig2P2PCoordinator

  /**
   * Set the coordinator instance
   */
  setCoordinator(coordinator: MuSig2P2PCoordinator): void {
    this.coordinator = coordinator
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
}
