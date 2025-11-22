/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * Message Channel Validator
 *
 * Validates that messages are sent/received on the correct channels
 * and from authorized senders.
 */

import {
  MessageChannel,
  MessageAuthority,
  getMessageChannelConfig,
  requiresCoordinatorAuthority,
  requiresParticipantAuthority,
} from './message-channels.js'
import { MuSig2MessageType } from './types.js'

// Re-export for convenience
export { MessageChannel, MessageAuthority } from './message-channels.js'

/**
 * Error thrown when a message is received on the wrong channel
 */
export class ChannelViolationError extends Error {
  constructor(
    messageType: MuSig2MessageType,
    expectedChannel: MessageChannel,
    actualChannel: MessageChannel,
  ) {
    super(
      `Channel violation: ${messageType} received on ${actualChannel}, expected ${expectedChannel}`,
    )
    this.name = 'ChannelViolationError'
  }
}

/**
 * Error thrown when a message is sent by an unauthorized peer
 */
export class AuthorityViolationError extends Error {
  constructor(
    messageType: MuSig2MessageType,
    requiredAuthority: MessageAuthority,
    senderPeerId: string,
  ) {
    super(
      `Authority violation: ${messageType} requires ${requiredAuthority} authority, sent by ${senderPeerId}`,
    )
    this.name = 'AuthorityViolationError'
  }
}

/**
 * Message validator for channel and authority enforcement
 */
export class MessageValidator {
  /**
   * Validate that a message was received on the correct channel
   *
   * @param messageType - Type of message received
   * @param sourceChannel - Channel the message was received on
   * @throws {ChannelViolationError} If message received on wrong channel
   */
  validateChannel(
    messageType: MuSig2MessageType,
    sourceChannel: MessageChannel,
  ): void {
    const config = getMessageChannelConfig(messageType)

    if (config.channel !== sourceChannel) {
      throw new ChannelViolationError(
        messageType,
        config.channel,
        sourceChannel,
      )
    }
  }

  /**
   * Validate that a message sender has the required authority
   *
   * @param messageType - Type of message being validated
   * @param senderPeerId - Peer ID of the sender
   * @param coordinatorPeerId - Peer ID of the session coordinator (if known)
   * @throws {AuthorityViolationError} If sender lacks required authority
   */
  validateAuthority(
    messageType: MuSig2MessageType,
    senderPeerId: string,
    coordinatorPeerId?: string,
  ): void {
    const config = getMessageChannelConfig(messageType)

    // ANY authority - no validation needed
    if (config.authority === MessageAuthority.ANY) {
      return
    }

    // COORDINATOR authority - sender must be the coordinator
    if (
      config.authority === MessageAuthority.COORDINATOR &&
      coordinatorPeerId
    ) {
      if (senderPeerId !== coordinatorPeerId) {
        throw new AuthorityViolationError(
          messageType,
          MessageAuthority.COORDINATOR,
          senderPeerId,
        )
      }
    }

    // PARTICIPANT authority - sender must NOT be coordinator (if coordinator is known)
    // Note: This is a weak check since we may not always know the coordinator
    // The main purpose is to prevent coordinator from sending participant messages
    if (
      config.authority === MessageAuthority.PARTICIPANT &&
      coordinatorPeerId &&
      senderPeerId === coordinatorPeerId
    ) {
      throw new AuthorityViolationError(
        messageType,
        MessageAuthority.PARTICIPANT,
        senderPeerId,
      )
    }
  }

  /**
   * Validate both channel and authority in one call
   *
   * @param messageType - Type of message being validated
   * @param sourceChannel - Channel the message was received on
   * @param senderPeerId - Peer ID of the sender
   * @param coordinatorPeerId - Peer ID of the session coordinator (if known)
   */
  validateMessage(
    messageType: MuSig2MessageType,
    sourceChannel: MessageChannel,
    senderPeerId: string,
    coordinatorPeerId?: string,
  ): void {
    this.validateChannel(messageType, sourceChannel)
    this.validateAuthority(messageType, senderPeerId, coordinatorPeerId)
  }

  /**
   * Check if a message type should use direct streams
   * (convenience method for routing logic)
   */
  shouldUseDirect(messageType: MuSig2MessageType): boolean {
    return (
      getMessageChannelConfig(messageType).channel === MessageChannel.DIRECT
    )
  }

  /**
   * Check if a message type should use GossipSub
   * (convenience method for routing logic)
   */
  shouldUseGossipSub(messageType: MuSig2MessageType): boolean {
    return (
      getMessageChannelConfig(messageType).channel === MessageChannel.GOSSIPSUB
    )
  }

  /**
   * Get the required channel for a message type
   * (convenience method for routing logic)
   */
  getRequiredChannel(messageType: MuSig2MessageType): MessageChannel {
    return getMessageChannelConfig(messageType).channel
  }
}
