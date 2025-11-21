/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 P2P Payload Validation
 *
 * Validates message payloads before deserialization to catch structural issues early
 */

import { ValidationError } from './errors.js'
import type {
  SessionAnnouncementPayload,
  SessionJoinPayload,
  NonceSharePayload,
  PartialSigSharePayload,
  SignerAdvertisementPayload,
  SigningRequestPayload,
  ParticipantJoinedPayload,
  NonceCommitmentPayload,
} from './types.js'

/**
 * Validate that a value is a non-empty string
 */
function validateString(
  value: unknown,
  fieldName: string,
  allowEmpty = false,
): void {
  if (typeof value !== 'string') {
    throw new ValidationError(
      `${fieldName} must be a string`,
      `invalid-type-${fieldName}`,
    )
  }

  if (!allowEmpty && value.length === 0) {
    throw new ValidationError(
      `${fieldName} cannot be empty`,
      `empty-${fieldName}`,
    )
  }
}

/**
 * Validate that a value is a number
 */
function validateNumber(value: unknown, fieldName: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(
      `${fieldName} must be a finite number`,
      `invalid-type-${fieldName}`,
    )
  }
}

/**
 * Validate that a value is an array
 */
function validateArray(value: unknown, fieldName: string, minLength = 0): void {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      `${fieldName} must be an array`,
      `invalid-type-${fieldName}`,
    )
  }
  if (value.length < minLength) {
    throw new ValidationError(
      `${fieldName} must have at least ${minLength} elements`,
      `insufficient-${fieldName}`,
    )
  }
}

/**
 * Validate session announcement payload
 */
export function validateSessionAnnouncementPayload(
  payload: unknown,
): asserts payload is SessionAnnouncementPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object', 'invalid-payload')
  }

  const p = payload as Record<string, unknown>
  validateString(p.sessionId, 'sessionId')
  validateArray(p.signers, 'signers', 1)
  validateNumber(p.creatorIndex, 'creatorIndex')
  validateString(p.message, 'message')
}

/**
 * Validate session join payload
 */
export function validateSessionJoinPayload(
  payload: unknown,
): asserts payload is SessionJoinPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object', 'invalid-payload')
  }

  const p = payload as Record<string, unknown>
  validateString(p.sessionId, 'sessionId')
  validateNumber(p.signerIndex, 'signerIndex')
  validateNumber(p.sequenceNumber, 'sequenceNumber')
  validateString(p.publicKey, 'publicKey')
}

/**
 * Validate nonce share payload
 */
export function validateNonceSharePayload(
  payload: unknown,
): asserts payload is NonceSharePayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object', 'invalid-payload')
  }

  const p = payload as Record<string, unknown>
  validateString(p.sessionId, 'sessionId')
  validateNumber(p.signerIndex, 'signerIndex')
  validateNumber(p.sequenceNumber, 'sequenceNumber')

  if (!p.publicNonce || typeof p.publicNonce !== 'object') {
    throw new ValidationError(
      'publicNonce must be an object',
      'invalid-publicNonce',
    )
  }
}

/**
 * Validate nonce commitment payload
 */
export function validateNonceCommitmentPayload(
  payload: unknown,
): asserts payload is NonceCommitmentPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object', 'invalid-payload')
  }

  const p = payload as Record<string, unknown>
  validateString(p.sessionId, 'sessionId')
  validateNumber(p.signerIndex, 'signerIndex')
  validateNumber(p.sequenceNumber, 'sequenceNumber')
  validateString(p.commitment, 'commitment')
}

/**
 * Validate partial signature share payload
 */
export function validatePartialSigSharePayload(
  payload: unknown,
): asserts payload is PartialSigSharePayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object', 'invalid-payload')
  }

  const p = payload as Record<string, unknown>
  validateString(p.sessionId, 'sessionId')
  validateNumber(p.signerIndex, 'signerIndex')
  validateNumber(p.sequenceNumber, 'sequenceNumber')
  validateString(p.partialSig, 'partialSig')
}

/**
 * Validate signer advertisement payload
 */
export function validateSignerAdvertisementPayload(
  payload: unknown,
): asserts payload is SignerAdvertisementPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object', 'invalid-payload')
  }

  const p = payload as Record<string, unknown>
  validateString(p.peerId, 'peerId')
  validateString(p.publicKey, 'publicKey')
  validateString(p.signature, 'signature')
  validateNumber(p.timestamp, 'timestamp')

  if (p.multiaddrs !== undefined) {
    validateArray(p.multiaddrs, 'multiaddrs')
  }
}

/**
 * Validate signing request payload
 */
export function validateSigningRequestPayload(
  payload: unknown,
): asserts payload is SigningRequestPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object', 'invalid-payload')
  }

  const p = payload as Record<string, unknown>
  validateString(p.requestId, 'requestId')
  validateArray(p.requiredPublicKeys, 'requiredPublicKeys', 1)
  validateString(p.message, 'message')
  validateString(p.creatorPeerId, 'creatorPeerId')
  validateString(p.creatorPublicKey, 'creatorPublicKey')
  validateString(p.creatorSignature, 'creatorSignature')
  validateNumber(p.createdAt, 'createdAt')
  validateParticipantJoinedPayload(p.creatorParticipation)
}

/**
 * Validate participant joined payload
 */
export function validateParticipantJoinedPayload(
  payload: unknown,
): asserts payload is ParticipantJoinedPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload must be an object', 'invalid-payload')
  }

  const p = payload as Record<string, unknown>
  validateString(p.requestId, 'requestId')
  validateNumber(p.participantIndex, 'participantIndex')
  validateString(p.participantPeerId, 'participantPeerId')
  validateString(p.participantPublicKey, 'participantPublicKey')
  validateString(p.signature, 'signature')
  validateNumber(p.timestamp, 'timestamp')
}
