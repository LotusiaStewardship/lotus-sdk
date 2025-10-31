/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 P2P Serialization Utilities
 *
 * Converts MuSig2 objects (Point, BN, PublicKey) to/from network-safe formats
 */

import { Point } from '../../bitcore/crypto/point.js'
import { BN } from '../../bitcore/crypto/bn.js'
import { PublicKey } from '../../bitcore/publickey.js'

/**
 * Serialize a Point to compressed format (hex string)
 */
export function serializePoint(point: Point): string {
  const compressed = Point.pointToCompressed(point)
  return compressed.toString('hex')
}

/**
 * Deserialize a compressed Point from hex string
 */
export function deserializePoint(hex: string): Point {
  const buffer = Buffer.from(hex, 'hex')
  if (buffer.length !== 33) {
    throw new Error(`Invalid compressed point length: ${buffer.length}`)
  }
  const prefix = buffer[0]
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new Error(`Invalid compressed point prefix: 0x${prefix.toString(16)}`)
  }
  const odd = prefix === 0x03
  const x = new BN(buffer.slice(1), 'be')
  return Point.fromX(odd, x)
}

/**
 * Serialize a public nonce [Point, Point] to compressed format
 */
export function serializePublicNonce(nonce: [Point, Point]): {
  R1: string
  R2: string
} {
  return {
    R1: serializePoint(nonce[0]),
    R2: serializePoint(nonce[1]),
  }
}

/**
 * Deserialize a public nonce from compressed format
 */
export function deserializePublicNonce(data: {
  R1: string
  R2: string
}): [Point, Point] {
  return [deserializePoint(data.R1), deserializePoint(data.R2)]
}

/**
 * Serialize a BN to hex string (32 bytes, big-endian)
 */
export function serializeBN(bn: BN): string {
  return bn.toBuffer({ endian: 'big', size: 32 }).toString('hex')
}

/**
 * Deserialize a BN from hex string
 */
export function deserializeBN(hex: string): BN {
  const buffer = Buffer.from(hex, 'hex')
  return new BN(buffer, 'be')
}

/**
 * Serialize a PublicKey to compressed format (hex string)
 */
export function serializePublicKey(publicKey: PublicKey): string {
  return publicKey.toBuffer().toString('hex')
}

/**
 * Deserialize a PublicKey from compressed format
 */
export function deserializePublicKey(hex: string): PublicKey {
  const buffer = Buffer.from(hex, 'hex')
  return new PublicKey(buffer)
}

/**
 * Serialize a message Buffer to hex string
 */
export function serializeMessage(message: Buffer): string {
  return message.toString('hex')
}

/**
 * Deserialize a message from hex string
 */
export function deserializeMessage(hex: string): Buffer {
  return Buffer.from(hex, 'hex')
}
