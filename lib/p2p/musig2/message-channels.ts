/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * Message Channel Architecture
 *
 * Defines authoritative message channels and routing for MuSig2 protocol.
 * This establishes clear separation between discovery and critical session messages.
 */

import { MuSig2MessageType } from './types.js'

/**
 * Message delivery channels
 */
export enum MessageChannel {
  /** Critical session messages via direct libp2p streams (reliable, ordered) */
  DIRECT = 'direct',

  /** Discovery and announcements via GossipSub (broadcast, best-effort) */
  GOSSIPSUB = 'gossipsub',
}

/**
 * Message authority levels
 */
export enum MessageAuthority {
  /** Only coordinator can send this message */
  COORDINATOR = 'coordinator',

  /** Only participants can send this message */
  PARTICIPANT = 'participant',

  /** Any peer can send this message */
  ANY = 'any',
}

/**
 * Message delivery requirements
 */
export type MessageDelivery = 'reliable' | 'broadcast'

/**
 * Channel configuration for a message type
 */
export interface MessageChannelConfig {
  /** Which channel this message should use */
  channel: MessageChannel

  /** Who is authorized to send this message */
  authority: MessageAuthority

  /** Delivery guarantee required */
  delivery: MessageDelivery

  /** Human-readable description */
  description: string
}

/**
 * Authoritative mapping of message types to channels
 *
 * CRITICAL ARCHITECTURE DECISION:
 * - DIRECT channel: Session lifecycle, nonces, signatures (critical, ordered)
 * - GOSSIPSUB channel: Discovery, advertisements (broadcast, best-effort)
 *
 * This separation eliminates dual-channel broadcasting and ensures:
 * 1. No duplicate message processing
 * 2. Clear delivery guarantees per message type
 * 3. Proper sequencing for critical operations
 * 4. Efficient discovery via pub/sub
 */
export const MESSAGE_CHANNELS: Record<MuSig2MessageType, MessageChannelConfig> =
  {
    // ==========================================================================
    // CRITICAL SESSION MESSAGES - DIRECT STREAMS ONLY
    // These require reliable, ordered delivery and must not be duplicated
    // ==========================================================================

    [MuSig2MessageType.PARTICIPANT_JOINED]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.PARTICIPANT,
      delivery: 'reliable',
      description:
        'Participant joins signing session - critical for session lifecycle',
    },

    [MuSig2MessageType.SESSION_READY]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.COORDINATOR,
      delivery: 'reliable',
      description:
        'Coordinator announces session is ready - critical for coordination',
    },

    [MuSig2MessageType.SESSION_JOIN]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.PARTICIPANT,
      delivery: 'reliable',
      description: 'Participant confirms session join - critical for tracking',
    },

    [MuSig2MessageType.NONCE_COMMIT]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.PARTICIPANT,
      delivery: 'reliable',
      description:
        'Round 1 nonce commitment - critical for MuSig2 security (prevents nonce reuse)',
    },

    [MuSig2MessageType.NONCE_SHARE]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.PARTICIPANT,
      delivery: 'reliable',
      description:
        'Round 1 nonce reveal - critical for MuSig2 aggregation (must match commitment)',
    },

    [MuSig2MessageType.NONCE_ACK]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.PARTICIPANT,
      delivery: 'reliable',
      description:
        'Round 1 nonce acknowledgment - confirms nonce receipt for coordination',
    },

    [MuSig2MessageType.NONCES_COMPLETE]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.COORDINATOR,
      delivery: 'reliable',
      description:
        'Round 1 completion notification - coordinator signals all nonces collected',
    },

    [MuSig2MessageType.PARTIAL_SIG_SHARE]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.PARTICIPANT,
      delivery: 'reliable',
      description:
        'Round 2 partial signature - critical for final signature aggregation',
    },

    [MuSig2MessageType.PARTIAL_SIG_ACK]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.PARTICIPANT,
      delivery: 'reliable',
      description:
        'Round 2 partial signature acknowledgment - confirms receipt for coordination',
    },

    [MuSig2MessageType.PARTIAL_SIGS_COMPLETE]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.COORDINATOR,
      delivery: 'reliable',
      description:
        'Round 2 completion notification - coordinator signals all partial sigs collected',
    },

    [MuSig2MessageType.SIGNATURE_FINALIZED]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.COORDINATOR,
      delivery: 'reliable',
      description:
        'Final signature ready - coordinator signals successful aggregation',
    },

    [MuSig2MessageType.SESSION_ABORT]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.ANY,
      delivery: 'reliable',
      description:
        'Abort session - critical for cleanup (any participant can abort)',
    },

    [MuSig2MessageType.VALIDATION_ERROR]: {
      channel: MessageChannel.DIRECT,
      authority: MessageAuthority.ANY,
      delivery: 'reliable',
      description:
        'Validation error notification - important for debugging and security',
    },

    // ==========================================================================
    // DISCOVERY MESSAGES - GOSSIPSUB ONLY
    // These benefit from broadcast propagation and can tolerate best-effort delivery
    // ==========================================================================

    [MuSig2MessageType.SIGNER_ADVERTISEMENT]: {
      channel: MessageChannel.GOSSIPSUB,
      authority: MessageAuthority.ANY,
      delivery: 'broadcast',
      description:
        'Advertise available signer - discovery via topic-based pub/sub',
    },

    [MuSig2MessageType.SIGNER_UNAVAILABLE]: {
      channel: MessageChannel.GOSSIPSUB,
      authority: MessageAuthority.ANY,
      delivery: 'broadcast',
      description:
        'Withdraw signer advertisement - discovery via topic-based pub/sub',
    },

    [MuSig2MessageType.SIGNING_REQUEST]: {
      channel: MessageChannel.GOSSIPSUB,
      authority: MessageAuthority.COORDINATOR,
      delivery: 'broadcast',
      description:
        'Broadcast signing request to discover participants - discovery via topic-based pub/sub',
    },
  }

/**
 * Get channel configuration for a message type
 */
export function getMessageChannelConfig(
  messageType: MuSig2MessageType,
): MessageChannelConfig {
  const config = MESSAGE_CHANNELS[messageType]
  if (!config) {
    throw new Error(`Unknown message type: ${messageType}`)
  }
  return config
}

/**
 * Check if a message type should use direct streams
 */
export function isDirectMessage(messageType: MuSig2MessageType): boolean {
  return getMessageChannelConfig(messageType).channel === MessageChannel.DIRECT
}

/**
 * Check if a message type should use GossipSub
 */
export function isGossipSubMessage(messageType: MuSig2MessageType): boolean {
  return (
    getMessageChannelConfig(messageType).channel === MessageChannel.GOSSIPSUB
  )
}

/**
 * Get all message types for a specific channel
 */
export function getMessageTypesForChannel(
  channel: MessageChannel,
): MuSig2MessageType[] {
  return Object.entries(MESSAGE_CHANNELS)
    .filter(([, config]) => config.channel === channel)
    .map(([type]) => type as MuSig2MessageType)
}

/**
 * Validate that a message type requires coordinator authority
 */
export function requiresCoordinatorAuthority(
  messageType: MuSig2MessageType,
): boolean {
  return (
    getMessageChannelConfig(messageType).authority ===
    MessageAuthority.COORDINATOR
  )
}

/**
 * Validate that a message type requires participant authority
 */
export function requiresParticipantAuthority(
  messageType: MuSig2MessageType,
): boolean {
  return (
    getMessageChannelConfig(messageType).authority ===
    MessageAuthority.PARTICIPANT
  )
}
