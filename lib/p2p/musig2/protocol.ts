/**
 * MuSig2 Protocol Handler
 *
 * Handles MuSig2-specific P2P messages and routing.
 *
 * ARCHITECTURE:
 * This module is the SINGLE POINT OF INGRESS VALIDATION for MuSig2 messages.
 *
 * Validation Flow:
 * 1. security.ts: validateMessage() - Security constraints only (DoS, blocking, timestamp)
 * 2. protocol.ts: _validateAndRouteMessage() - Payload structure validation (THIS MODULE)
 * 3. coordinator.ts: Event handlers - Business logic only (no re-validation)
 *
 * Egress Flow:
 * 1. coordinator.ts: _validatePayloadForMessage() - Validates before sending
 * 2. coordinator.ts: _broadcastToSessionParticipants() - Sends validated payload
 *
 * This separation ensures:
 * - No double validation on ingress
 * - Clear separation of concerns
 * - Security checks happen before payload parsing
 * - Business logic handlers receive pre-validated payloads
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
  type NonceSharePayload,
  type PartialSigSharePayload,
  type SessionAbortPayload,
  type SessionCompletePayload,
} from './types.js'
import { EventEmitter } from 'events'
import {
  validateMessageStructure,
  validateSessionJoinPayload,
  validateSessionJoinAckPayload,
  validateNonceSharePayload,
  validatePartialSigSharePayload,
  validateSessionAbortPayload,
  validateSessionCompletePayload,
} from './validation.js'
import {
  ValidationError,
  DeserializationError,
  SerializationError,
  ErrorCode,
} from './errors.js'
import type { MuSig2SecurityValidator } from './security.js'

type Message =
  | SessionJoinPayload
  | SessionJoinAckPayload
  | NonceSharePayload
  | PartialSigSharePayload
  | SessionAbortPayload
  | SessionCompletePayload

/**
 * MuSig2 Protocol Handler
 *
 * Implements IProtocolHandler for MuSig2-specific messages
 * Routes messages to appropriate event handlers
 * Integrates with security validator for message validation
 */
export class MuSig2ProtocolHandler
  extends EventEmitter
  implements IProtocolHandler
{
  readonly protocolName = 'musig2'
  readonly protocolId = '/lotus/musig2/1.0.0'

  // Security validator reference (set by coordinator)
  private securityValidator?: MuSig2SecurityValidator

  /**
   * Set the security validator for message validation
   */
  setSecurityValidator(validator: MuSig2SecurityValidator): void {
    this.securityValidator = validator
  }

  /**
   * Handle incoming MuSig2 message with security and validation integration
   */
  async handleMessage(message: P2PMessage, from: PeerInfo): Promise<void> {
    try {
      // Step 1: Basic protocol validation
      if (message.protocol !== this.protocolName) {
        console.warn(
          `[MuSig2Protocol] Ignoring message with wrong protocol: ${message.protocol}`,
        )
        return
      }

      // Step 2: Security validation (if validator is set)
      if (this.securityValidator) {
        const isSecure = await this.securityValidator.validateMessage(
          message,
          from,
        )
        if (!isSecure) {
          console.warn(
            `[MuSig2Protocol] Security validation failed for ${message.type} from ${from.peerId}`,
          )
          this.emit('security:rejected', {
            message,
            from,
            reason: 'security_validation_failed',
          })
          return
        }
      }

      // Step 3: Validate message structure (additional validation checks)
      validateMessageStructure(message)

      // Step 4: Route and validate payload based on message type
      const validatedPayload = this._validateAndRouteMessage(message)

      // Step 5: Emit events with validated payloads
      this._emitValidatedMessage(
        message.type as MuSig2MessageType,
        validatedPayload,
        from,
      )
    } catch (error) {
      // Handle validation and security errors
      this._handleMessageError(error, message, from)
    }
  }

  /**
   * Validate message payload and route to appropriate handler
   */
  private _validateAndRouteMessage(message: P2PMessage): Message {
    switch (message.type) {
      case MuSig2MessageType.SESSION_JOIN:
        validateSessionJoinPayload(message.payload)
        return message.payload as SessionJoinPayload

      case MuSig2MessageType.SESSION_JOIN_ACK:
        validateSessionJoinAckPayload(message.payload)
        return message.payload as SessionJoinAckPayload

      case MuSig2MessageType.NONCE_SHARE:
        validateNonceSharePayload(message.payload)
        return message.payload as NonceSharePayload

      case MuSig2MessageType.PARTIAL_SIG_SHARE:
        validatePartialSigSharePayload(message.payload)
        return message.payload as PartialSigSharePayload

      case MuSig2MessageType.SESSION_ABORT:
        validateSessionAbortPayload(message.payload)
        return message.payload as SessionAbortPayload

      case MuSig2MessageType.SESSION_COMPLETE:
        validateSessionCompletePayload(message.payload)
        return message.payload as SessionCompletePayload

      default:
        throw new ValidationError(
          ErrorCode.INVALID_PAYLOAD,
          `Unknown message type: ${message.type}`,
        )
    }
  }

  /**
   * Emit validated message events
   */
  private _emitValidatedMessage(
    type: MuSig2MessageType,
    payload: Message,
    from: PeerInfo,
  ): void {
    switch (type) {
      case MuSig2MessageType.SESSION_JOIN:
        this.emit('session:join', payload as SessionJoinPayload, from)
        break

      case MuSig2MessageType.SESSION_JOIN_ACK:
        this.emit('session:join-ack', payload as SessionJoinAckPayload, from)
        break

      case MuSig2MessageType.NONCE_SHARE:
        this.emit('nonce:share', payload as NonceSharePayload, from)
        break

      case MuSig2MessageType.PARTIAL_SIG_SHARE:
        this.emit('partial-sig:share', payload as PartialSigSharePayload, from)
        break

      case MuSig2MessageType.SESSION_ABORT:
        this.emit('session:abort', payload as SessionAbortPayload, from)
        break

      case MuSig2MessageType.SESSION_COMPLETE:
        this.emit('session:complete', payload as SessionCompletePayload, from)
        break
    }
  }

  /**
   * Handle message validation and security errors
   */
  private _handleMessageError(
    error: unknown,
    message: P2PMessage,
    from: PeerInfo,
  ): void {
    if (error instanceof ValidationError) {
      console.warn(
        `[MuSig2Protocol] Validation failed for ${message.type} from ${from.peerId}: ${error.message}`,
      )
      this.emit('validation:error', { error, message, from })
      return
    }

    if (error instanceof DeserializationError) {
      console.warn(
        `[MuSig2Protocol] Deserialization failed for ${message.type} from ${from.peerId}: ${error.message}`,
      )
      this.emit('deserialization:error', { error, message, from })
      return
    }

    if (error instanceof SerializationError) {
      console.warn(
        `[MuSig2Protocol] Serialization error for ${message.type} from ${from.peerId}: ${error.message}`,
      )
      this.emit('serialization:error', { error, message, from })
      return
    }

    // Unknown error
    console.error(
      `[MuSig2Protocol] Unexpected error processing ${message.type} from ${from.peerId}:`,
      error,
    )
    this.emit('unexpected:error', { error, message, from })
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
   * Enhanced message payload validation using comprehensive validation layer
   * @deprecated Use validateMessageStructure and specific payload validators instead
   */
  validateMessagePayload(type: MuSig2MessageType, payload: unknown): boolean {
    try {
      // Use the new comprehensive validation system
      switch (type) {
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

        default:
          return false
      }

      return true
    } catch (error) {
      // Validation failed
      return false
    }
  }

  /**
   * Get validation info for debugging and monitoring
   */
  getValidationInfo() {
    return {
      supportedMessageTypes: [
        MuSig2MessageType.SESSION_JOIN,
        MuSig2MessageType.SESSION_JOIN_ACK,
        MuSig2MessageType.NONCE_SHARE,
        MuSig2MessageType.PARTIAL_SIG_SHARE,
        MuSig2MessageType.SESSION_ABORT,
        MuSig2MessageType.SESSION_COMPLETE,
      ],
      validationEnabled: true,
      errorHandlingEnabled: true,
      securityChecksEnabled: true,
    }
  }
}
