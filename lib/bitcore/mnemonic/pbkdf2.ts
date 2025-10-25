/**
 * PBKDF2 implementation for mnemonic seed generation
 * Migrated from @abcpros/bitcore-mnemonic with ESM support and TypeScript
 */

import { createHmac } from 'crypto'

/**
 * PBKDF2 implementation using SHA512
 * Credit to: https://github.com/stayradiated/pbkdf2-sha512
 * Copyright (c) 2014, JP Richardson Copyright (c) 2010-2011 Intalio Pte, All Rights Reserved
 */
export function pbkdf2(
  key: string | Buffer,
  salt: string | Buffer,
  iterations: number,
  dkLen: number,
): Buffer {
  const hLen = 64 // SHA512 Mac length
  if (dkLen > (Math.pow(2, 32) - 1) * hLen) {
    throw new Error('Requested key length too long')
  }

  if (typeof key !== 'string' && !Buffer.isBuffer(key)) {
    throw new TypeError('key must a string or Buffer')
  }

  if (typeof salt !== 'string' && !Buffer.isBuffer(salt)) {
    throw new TypeError('salt must a string or Buffer')
  }

  if (typeof key === 'string') {
    key = Buffer.from(key)
  }

  if (typeof salt === 'string') {
    salt = Buffer.from(salt)
  }

  const DK = Buffer.alloc(dkLen)
  const U = Buffer.alloc(hLen)
  const T = Buffer.alloc(hLen)
  const block1 = Buffer.alloc(salt.length + 4)

  const l = Math.ceil(dkLen / hLen)
  const r = dkLen - (l - 1) * hLen

  salt.copy(block1, 0, 0, salt.length)
  for (let i = 1; i <= l; i++) {
    block1[salt.length + 0] = (i >> 24) & 0xff
    block1[salt.length + 1] = (i >> 16) & 0xff
    block1[salt.length + 2] = (i >> 8) & 0xff
    block1[salt.length + 3] = i & 0xff

    const hmac = createHmac('sha512', key as Buffer)
    hmac.update(block1)
    const digest = hmac.digest()
    digest.copy(U, 0, 0, hLen)

    U.copy(T, 0, 0, hLen)

    for (let j = 1; j < iterations; j++) {
      const hmac2 = createHmac('sha512', key as Buffer)
      hmac2.update(U)
      const digest2 = hmac2.digest()
      digest2.copy(U, 0, 0, hLen)

      for (let k = 0; k < hLen; k++) {
        T[k] ^= U[k]
      }
    }

    const destPos = (i - 1) * hLen
    const len = i === l ? r : hLen
    T.copy(DK, destPos, 0, len)
  }

  return DK
}
