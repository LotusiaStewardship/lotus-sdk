/**
 * Random number generation utilities
 * Migrated from bitcore-lib-xpi with ESM support
 */

import { randomBytes } from 'crypto'

export class Random {
  /**
   * Secure random bytes that sometimes throws an error due to lack of entropy
   */
  static getRandomBuffer(size: number): Buffer {
    if (typeof globalThis !== 'undefined' && 'crypto' in globalThis) {
      return Random.getRandomBufferBrowser(size)
    } else {
      return Random.getRandomBufferNode(size)
    }
  }

  /**
   * Node.js implementation using crypto.randomBytes
   */
  static getRandomBufferNode(size: number): Buffer {
    return randomBytes(size)
  }

  /**
   * Browser implementation using globalThis.crypto
   */
  static getRandomBufferBrowser(size: number): Buffer {
    if (typeof globalThis === 'undefined' || !('crypto' in globalThis)) {
      throw new Error('crypto object not available')
    }

    const crypto = globalThis.crypto
    if (!crypto) {
      throw new Error('crypto not available')
    }

    if (!crypto.getRandomValues) {
      throw new Error('crypto.getRandomValues not available')
    }

    const bbuf = new Uint8Array(size)
    crypto.getRandomValues(bbuf)
    return Buffer.from(bbuf)
  }

  /**
   * Insecure random bytes, but it never fails
   */
  static getPseudoRandomBuffer(size: number): Buffer {
    const b32 = 0x100000000
    const b = Buffer.alloc(size)
    let r = 0

    for (let i = 0; i <= size; i++) {
      const j = Math.floor(i / 4)
      const k = i - j * 4
      if (k === 0) {
        r = Math.random() * b32
        b[i] = r & 0xff
      } else {
        r = r >>> 8
        b[i] = r & 0xff
      }
    }

    return b
  }
}
