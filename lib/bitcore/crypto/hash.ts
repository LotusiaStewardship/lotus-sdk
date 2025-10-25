/**
 * Cryptographic hash functions
 * Migrated from bitcore-lib-xpi with ESM support
 */

import { createHash } from 'crypto'

export interface HashFunction {
  (buf: Buffer): Buffer
  blocksize: number
}

// Create hash function objects with blocksize property
const sha1Func: HashFunction = (buf: Buffer): Buffer => {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('Argument must be a Buffer')
  }
  return createHash('sha1').update(buf).digest()
}
sha1Func.blocksize = 512

const sha256Func: HashFunction = (buf: Buffer): Buffer => {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('Argument must be a Buffer')
  }
  return createHash('sha256').update(buf).digest()
}
sha256Func.blocksize = 512

const sha512Func: HashFunction = (buf: Buffer): Buffer => {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('Argument must be a Buffer')
  }
  return createHash('sha512').update(buf).digest()
}
sha512Func.blocksize = 1024

export class Hash {
  static sha1 = sha1Func
  static sha256 = sha256Func
  static sha512 = sha512Func

  static sha256sha256 = function (buf: Buffer): Buffer {
    if (!Buffer.isBuffer(buf)) {
      throw new Error('Argument must be a Buffer')
    }
    return Hash.sha256(Hash.sha256(buf))
  }

  static ripemd160 = function (buf: Buffer): Buffer {
    if (!Buffer.isBuffer(buf)) {
      throw new Error('Argument must be a Buffer')
    }
    return createHash('ripemd160').update(buf).digest()
  }

  static sha256ripemd160 = function (buf: Buffer): Buffer {
    if (!Buffer.isBuffer(buf)) {
      throw new Error('Argument must be a Buffer')
    }
    return Hash.ripemd160(Hash.sha256(buf))
  }

  /**
   * HMAC implementation
   * http://en.wikipedia.org/wiki/Hash-based_message_authentication_code
   * http://tools.ietf.org/html/rfc4868#section-2
   */
  static hmac(hashf: HashFunction, data: Buffer, key: Buffer): Buffer {
    if (!Buffer.isBuffer(data)) {
      throw new Error('Data must be a Buffer')
    }
    if (!Buffer.isBuffer(key)) {
      throw new Error('Key must be a Buffer')
    }
    if (!hashf.blocksize) {
      throw new Error('Hash function must have blocksize property')
    }

    const blocksize = hashf.blocksize / 8
    let processedKey = key

    if (key.length > blocksize) {
      processedKey = hashf(key)
    } else if (key.length < blocksize) {
      const fill = Buffer.alloc(blocksize)
      fill.fill(0)
      key.copy(fill)
      processedKey = fill
    }

    const o_key = Buffer.alloc(blocksize)
    o_key.fill(0x5c)

    const i_key = Buffer.alloc(blocksize)
    i_key.fill(0x36)

    const o_key_pad = Buffer.alloc(blocksize)
    const i_key_pad = Buffer.alloc(blocksize)

    for (let i = 0; i < blocksize; i++) {
      o_key_pad[i] = o_key[i] ^ processedKey[i]
      i_key_pad[i] = i_key[i] ^ processedKey[i]
    }

    return hashf(
      Buffer.concat([o_key_pad, hashf(Buffer.concat([i_key_pad, data]))]),
    )
  }

  static sha256hmac(data: Buffer, key: Buffer): Buffer {
    return Hash.hmac(Hash.sha256, data, key)
  }

  static sha512hmac(data: Buffer, key: Buffer): Buffer {
    return Hash.hmac(Hash.sha512, data, key)
  }
}
