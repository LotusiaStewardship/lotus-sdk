/**
 * MuSig2 Protocol Handler
 *
 * Handles MuSig2-specific P2P messages and routing
 */

import type {
  IProtocolHandler,
  P2PMessage,
  PeerInfo,
  Stream,
  Connection,
} from '../types.js'
import {
  MuSig2MessageType,
  type SessionJoinPayload,
  type SessionJoinAckPayload,
  type NonceCommitmentPayload,
  type NonceSharePayload,
  type PartialSigSharePayload,
  type SessionAbortPayload,
  type SessionCompletePayload,
} from './types.js'
import { EventEmitter } from 'events'

/**
 * MuSig2 Protocol Handler
 *
 * Implements IProtocolHandler for MuSig2-specific messages
 * Routes messages to appropriate event handlers
 */
export class MuSig2ProtocolHandler
  extends EventEmitter
  implements IProtocolHandler
{
  readonly protocolName = 'musig2'
  readonly protocolId = '/lotus/musig2/1.0.0'

  /**
   * Handle incoming MuSig2 message
   */
  async handleMessage(message: P2PMessage, from: PeerInfo): Promise<void> {
    // Validate message has protocol field
    if (message.protocol !== this.protocolName) {
      console.warn(
        `[MuSig2Protocol] Ignoring message with wrong protocol: ${message.protocol}`,
      )
      return
    }

    // Route based on message type
    switch (message.type) {
      case MuSig2MessageType.SESSION_JOIN:
        this.emit('session:join', message.payload as SessionJoinPayload, from)
        break

      case MuSig2MessageType.SESSION_JOIN_ACK:
        this.emit(
          'session:join-ack',
          message.payload as SessionJoinAckPayload,
          from,
        )
        break

      case MuSig2MessageType.NONCE_COMMITMENT:
        this.emit(
          'nonce:commitment',
          message.payload as NonceCommitmentPayload,
          from,
        )
        break

      case MuSig2MessageType.NONCE_SHARE:
        this.emit('nonce:share', message.payload as NonceSharePayload, from)
        break

      case MuSig2MessageType.PARTIAL_SIG_SHARE:
        this.emit(
          'partial-sig:share',
          message.payload as PartialSigSharePayload,
          from,
        )
        break

      case MuSig2MessageType.SESSION_ABORT:
        this.emit('session:abort', message.payload as SessionAbortPayload, from)
        break

      case MuSig2MessageType.SESSION_COMPLETE:
        this.emit(
          'session:complete',
          message.payload as SessionCompletePayload,
          from,
        )
        break

      default:
        console.warn(`[MuSig2Protocol] Unknown message type: ${message.type}`)
    }
  }

  /**
   * Handle peer connection
   */
  async onPeerConnected(peerId: string): Promise<void> {
    console.log(`[MuSig2Protocol] Peer connected: ${peerId}`)
    this.emit('peer:connected', peerId)
  }

  /**
   * Handle peer disconnection
   */
  async onPeerDisconnected(peerId: string): Promise<void> {
    console.log(`[MuSig2Protocol] Peer disconnected: ${peerId}`)
    this.emit('peer:disconnected', peerId)
  }

  /**
   * Handle peer discovery
   */
  async onPeerDiscovered(peerInfo: PeerInfo): Promise<void> {
    console.log(`[MuSig2Protocol] Peer discovered: ${peerInfo.peerId}`)
    this.emit('peer:discovered', peerInfo)
  }

  /**
   * Validate message payload structure
   */
  validateMessagePayload(type: MuSig2MessageType, payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false
    }

    const data = payload as Record<string, unknown>

    switch (type) {
      case MuSig2MessageType.SESSION_JOIN:
        return !!(data.sessionId && data.signerPublicKey && data.timestamp)

      case MuSig2MessageType.SESSION_JOIN_ACK:
        return !!(
          data.sessionId &&
          typeof data.accepted === 'boolean' &&
          data.timestamp
        )

      case MuSig2MessageType.NONCE_COMMITMENT:
        return !!(
          data.sessionId &&
          typeof data.signerIndex === 'number' &&
          data.commitment &&
          data.timestamp
        )

      case MuSig2MessageType.NONCE_SHARE:
        return !!(
          data.sessionId &&
          typeof data.signerIndex === 'number' &&
          data.publicNonce &&
          data.timestamp
        )

      case MuSig2MessageType.PARTIAL_SIG_SHARE:
        return !!(
          data.sessionId &&
          typeof data.signerIndex === 'number' &&
          data.partialSig &&
          data.timestamp
        )

      case MuSig2MessageType.SESSION_ABORT:
      case MuSig2MessageType.SESSION_COMPLETE:
        return !!(data.sessionId && data.timestamp)

      default:
        return false
    }
  }
}
