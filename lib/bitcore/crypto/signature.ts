/**
 * Digital signature handling for ECDSA and Schnorr
 * Migrated from bitcore-lib-xpi with ESM support and BigInt
 */
import { BN } from './bn.js'

export interface SignatureData {
  r: BN
  s: BN
  i?: number
  compressed?: boolean
  isSchnorr?: boolean
  nhashtype?: number
}

export class Signature {
  r!: BN
  s!: BN
  i?: number
  compressed?: boolean
  isSchnorr?: boolean
  nhashtype?: number

  // Signature hash types
  static readonly SIGHASH_ALL = 0x01
  static readonly SIGHASH_NONE = 0x02
  static readonly SIGHASH_SINGLE = 0x03
  static readonly SIGHASH_FORKID = 0x40
  static readonly SIGHASH_ANYONECANPAY = 0x80

  constructor(r: BN | SignatureData, s?: BN, isSchnorr?: boolean) {
    if (r instanceof BN) {
      this.set({
        r: r,
        s: s!,
        isSchnorr: isSchnorr,
      })
    } else if (r) {
      this.set(r)
    }
  }

  // Factory function to allow calling Signature() without 'new'
  static create(
    r?: BN | SignatureData,
    s?: BN,
    isSchnorr?: boolean,
  ): Signature {
    return new Signature(r!, s, isSchnorr)
  }

  set(obj: SignatureData): Signature {
    this.r = obj.r || this.r || undefined!
    this.s = obj.s || this.s || undefined!
    this.i = typeof obj.i !== 'undefined' ? obj.i : this.i
    this.compressed =
      typeof obj.compressed !== 'undefined' ? obj.compressed : this.compressed
    this.isSchnorr = obj.isSchnorr
    this.nhashtype = obj.nhashtype || this.nhashtype || undefined
    return this
  }

  /**
   * Create signature from compact format
   */
  static fromCompact(buf: Buffer): Signature {
    if (!Buffer.isBuffer(buf)) {
      throw new Error('Argument is expected to be a Buffer')
    }

    const sig = new Signature(new BN(0), new BN(0))

    let compressed = true
    let i = buf.subarray(0, 1)[0] - 27 - 4
    if (i < 0) {
      compressed = false
      i = i + 4
    }

    const b2 = buf.subarray(1, 33)
    const b3 = buf.subarray(33, 65)

    if (!(i === 0 || i === 1 || i === 2 || i === 3)) {
      throw new Error('i must be 0, 1, 2, or 3')
    }
    if (b2.length !== 32) {
      throw new Error('r must be 32 bytes')
    }
    if (b3.length !== 32) {
      throw new Error('s must be 32 bytes')
    }

    sig.compressed = compressed
    sig.i = i
    sig.r = new BN(b2, 'le')
    sig.s = new BN(b3, 'le')

    return sig
  }

  /**
   * Create signature from DER format
   */
  static fromDER(buf: Buffer, strict: boolean = true): Signature {
    // Schnorr Signatures use 64-65 byte format
    if ((buf.length === 64 || buf.length === 65) && buf[0] !== 0x30) {
      const obj = Signature.parseSchnorrEncodedSig(buf)
      const sig = new Signature(new BN(0), new BN(0))
      sig.r = obj.r
      sig.s = obj.s
      sig.isSchnorr = true
      return sig
    }

    if (buf.length === 64 && buf[0] === 0x30) {
      throw new Error('64 DER (ecdsa) signatures not allowed')
    }

    const obj = Signature.parseDER(buf, strict)
    const sig = new Signature(new BN(0), new BN(0))
    sig.r = obj.r
    sig.s = obj.s
    return sig
  }

  /**
   * Create signature from buffer (alias for fromDER)
   */
  static fromBuffer(buf: Buffer, strict: boolean = true): Signature {
    return Signature.fromDER(buf, strict)
  }

  /**
   * Create signature from transaction format
   */
  static fromTxFormat(buf: Buffer): Signature {
    const nhashtype = buf.readUInt8(buf.length - 1)
    const derbuf = buf.subarray(0, buf.length - 1)
    const sig = Signature.fromDER(derbuf, false)
    sig.nhashtype = nhashtype
    return sig
  }

  /**
   * Create signature from data format
   */
  static fromDataFormat(buf: Buffer): Signature {
    const derbuf = buf.subarray(0, buf.length)
    return Signature.fromDER(derbuf, false)
  }

  /**
   * Create signature from hex string
   */
  static fromString(str: string): Signature {
    const buf = Buffer.from(str, 'hex')
    return Signature.fromDER(buf)
  }

  /**
   * Parse Schnorr encoded signature
   */
  static parseSchnorrEncodedSig(buf: Buffer): {
    r: BN
    s: BN
    nhashtype?: Buffer
  } {
    const r = buf.subarray(0, 32)
    const s = buf.subarray(32, 64)
    let hashtype: Buffer | undefined

    if (buf.length === 65) {
      hashtype = buf.subarray(64, 65)
    }

    return {
      r: new BN(r, 'le'),
      s: new BN(s, 'le'),
      nhashtype: hashtype,
    }
  }

  /**
   * Parse DER format signature
   */
  static parseDER(buf: Buffer, strict: boolean = true): { r: BN; s: BN } {
    if (!Buffer.isBuffer(buf)) {
      throw new Error('DER formatted signature should be a buffer')
    }

    const header = buf[0]
    if (header !== 0x30) {
      throw new Error('Header byte should be 0x30')
    }

    let length = buf[1]
    const buflength = buf.subarray(2).length
    if (strict && length !== buflength) {
      throw new Error('Length byte should length of what follows')
    }

    length = length < buflength ? length : buflength

    const rheader = buf[2 + 0]
    if (rheader !== 0x02) {
      throw new Error('Integer byte for r should be 0x02')
    }

    const rlength = buf[2 + 1]
    const rbuf = buf.subarray(2 + 2, 2 + 2 + rlength)
    const r = new BN(rbuf, 'be')

    if (rlength !== rbuf.length) {
      throw new Error('Length of r incorrect')
    }

    const sheader = buf[2 + 2 + rlength + 0]
    if (sheader !== 0x02) {
      throw new Error('Integer byte for s should be 0x02')
    }

    const slength = buf[2 + 2 + rlength + 1]
    const sbuf = buf.subarray(
      2 + 2 + rlength + 2,
      2 + 2 + rlength + 2 + slength,
    )
    const s = new BN(sbuf, 'be')

    if (slength !== sbuf.length) {
      throw new Error('Length of s incorrect')
    }

    const sumlength = 2 + 2 + rlength + 2 + slength
    if (length !== sumlength - 2) {
      throw new Error('Length of signature incorrect')
    }

    return { r, s }
  }

  /**
   * Convert to compact format
   */
  toCompact(i?: number, compressed?: boolean): Buffer {
    const recoveryId = typeof i === 'number' ? i : this.i
    const isCompressed =
      typeof compressed === 'boolean' ? compressed : this.compressed

    if (
      !(
        recoveryId === 0 ||
        recoveryId === 1 ||
        recoveryId === 2 ||
        recoveryId === 3
      )
    ) {
      throw new Error('i must be equal to 0, 1, 2, or 3')
    }

    let val = recoveryId + 27 + 4
    if (isCompressed === false) {
      val = val - 4
    }

    const b1 = Buffer.from([val])
    const b2 = this.r.toArrayLike(Buffer, 'le', 32)
    const b3 = this.s.toArrayLike(Buffer, 'le', 32)

    return Buffer.concat([b1, b2, b3])
  }

  /**
   * Convert to DER format
   */
  toDER(signingMethod: string = 'ecdsa'): Buffer {
    if (signingMethod === 'schnorr') {
      return Buffer.concat([
        this.r.toArrayLike(Buffer, 'le', 32),
        this.s.toArrayLike(Buffer, 'le', 32),
      ])
    }

    const rnbuf = this.r.toArrayLike(Buffer, 'be')
    const snbuf = this.s.toArrayLike(Buffer, 'be')

    const rneg = (rnbuf[0] & 0x80) !== 0
    const sneg = (snbuf[0] & 0x80) !== 0

    const rbuf = rneg ? Buffer.concat([Buffer.from([0x00]), rnbuf]) : rnbuf
    const sbuf = sneg ? Buffer.concat([Buffer.from([0x00]), snbuf]) : snbuf

    const rlength = rbuf.length
    const slength = sbuf.length
    const length = 2 + rlength + 2 + slength
    const rheader = 0x02
    const sheader = 0x02
    const header = 0x30

    return Buffer.concat([
      Buffer.from([header, length, rheader, rlength]),
      rbuf,
      Buffer.from([sheader, slength]),
      sbuf,
    ])
  }

  /**
   * Convert to buffer (alias for toDER)
   */
  toBuffer(signingMethod: string = 'ecdsa'): Buffer {
    return this.toDER(signingMethod)
  }

  /**
   * Convert to hex string
   */
  toString(): string {
    const buf = this.toDER()
    return buf.toString('hex')
  }

  /**
   * Convert to transaction format
   */
  toTxFormat(signingMethod?: string): Buffer {
    const derbuf = this.toDER(signingMethod)
    const buf = Buffer.alloc(1)
    buf.writeUInt8(this.nhashtype || 0, 0)
    return Buffer.concat([derbuf, buf])
  }

  /**
   * Check if signature is valid DER format
   */
  static isDER(buf: Buffer): boolean {
    if (buf.length < 8 || buf.length > 72) {
      return false
    }

    if (buf[0] !== 0x30) {
      return false
    }

    if (buf[1] !== buf.length - 2) {
      return false
    }

    if (buf[2] !== 0x02) {
      return false
    }

    const lenR = buf[3]
    if (lenR === 0) {
      return false
    }

    if (buf[4] & 0x80) {
      return false
    }

    if (lenR > buf.length - 7) {
      return false
    }

    if (lenR > 1 && buf[4] === 0x00 && !(buf[5] & 0x80)) {
      return false
    }

    const startS = lenR + 4
    if (buf[startS] !== 0x02) {
      return false
    }

    const lenS = buf[startS + 1]
    if (lenS === 0) {
      return false
    }

    if (buf[startS + 2] & 0x80) {
      return false
    }

    if (startS + lenS + 2 !== buf.length) {
      return false
    }

    if (lenS > 1 && buf[startS + 2] === 0x00 && !(buf[startS + 3] & 0x80)) {
      return false
    }

    return true
  }

  /**
   * Check if signature has low S value
   */
  hasLowS(): boolean {
    const lowSThreshold = new BN(
      '7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0',
      16,
    )

    if (this.s.lt(new BN(1)) || this.s.gt(lowSThreshold)) {
      return false
    }
    return true
  }

  /**
   * Check if signature has defined hash type
   */
  hasDefinedHashtype(): boolean {
    if (typeof this.nhashtype !== 'number') {
      return false
    }

    const mask =
      ~(Signature.SIGHASH_FORKID | Signature.SIGHASH_ANYONECANPAY) >>> 0
    const temp = this.nhashtype & mask

    if (temp < Signature.SIGHASH_ALL || temp > Signature.SIGHASH_SINGLE) {
      return false
    }
    return true
  }

  /**
   * Check if signature is valid transaction DER format
   */
  static isTxDER(buf: Buffer): boolean {
    return Signature.isDER(buf.subarray(0, buf.length - 1))
  }
}
