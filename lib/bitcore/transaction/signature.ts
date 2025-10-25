import { Preconditions } from '../util/preconditions.js'
import { BufferUtil } from '../util/buffer.js'
import { JSUtil } from '../util/js.js'
import { PublicKey, PublicKeyInput } from '../publickey.js'
import { BitcoreError } from '../errors.js'
import { Signature } from '../crypto/signature.js'
import { BN } from '../crypto/bn.js'

export interface TransactionSignatureData {
  publicKey: PublicKey | Buffer | string
  prevTxId: Buffer | string
  outputIndex: number
  inputIndex: number
  signature: Signature | Buffer | string
  sigtype: number
}

export interface TransactionSignatureObject {
  publicKey: string
  prevTxId: string
  outputIndex: number
  inputIndex: number
  signature: string
  sigtype: number
}

/**
 * Wrapper around Signature with fields related to signing a transaction specifically
 */
export class TransactionSignature extends Signature {
  publicKey!: PublicKey
  prevTxId!: Buffer
  outputIndex!: number
  inputIndex!: number
  sigtype!: number
  signature!: Signature

  constructor(arg?: TransactionSignatureData | TransactionSignature | string) {
    super(BN.fromNumber(0) as BN, BN.fromNumber(0) as BN)

    if (arg instanceof TransactionSignature) {
      return arg
    }

    if (typeof arg === 'object' && arg !== null) {
      this._fromObject(arg)
    } else {
      throw new BitcoreError(
        'TransactionSignatures must be instantiated from an object',
      )
    }
  }

  // Factory function to allow calling TransactionSignature() without 'new'
  static create(
    arg?: TransactionSignatureData | TransactionSignature | string,
  ): TransactionSignature {
    return new TransactionSignature(arg)
  }

  private _fromObject(arg: TransactionSignatureData): TransactionSignature {
    this._checkObjectArgs(arg)
    this.publicKey = new PublicKey(arg.publicKey as PublicKeyInput)
    this.prevTxId = Buffer.isBuffer(arg.prevTxId)
      ? arg.prevTxId
      : Buffer.from(arg.prevTxId, 'hex')
    this.outputIndex = arg.outputIndex
    this.inputIndex = arg.inputIndex
    this.signature =
      arg.signature instanceof Signature
        ? arg.signature
        : Buffer.isBuffer(arg.signature)
          ? Signature.fromDER(arg.signature)
          : Signature.fromString(arg.signature)
    this.sigtype = arg.sigtype
    return this
  }

  private _checkObjectArgs(arg: TransactionSignatureData): void {
    Preconditions.checkArgument(
      arg.publicKey !== undefined,
      'publicKey is required',
    )
    Preconditions.checkArgument(
      arg.inputIndex !== undefined,
      'inputIndex is required',
    )
    Preconditions.checkArgument(
      arg.outputIndex !== undefined,
      'outputIndex is required',
    )
    Preconditions.checkState(
      typeof arg.inputIndex === 'number',
      'inputIndex must be a number',
    )
    Preconditions.checkState(
      typeof arg.outputIndex === 'number',
      'outputIndex must be a number',
    )
    Preconditions.checkArgument(
      arg.signature !== undefined,
      'signature is required',
    )
    Preconditions.checkArgument(
      arg.prevTxId !== undefined,
      'prevTxId is required',
    )
    Preconditions.checkState(
      arg.signature instanceof Signature ||
        Buffer.isBuffer(arg.signature) ||
        JSUtil.isHexa(arg.signature),
      'signature must be a buffer or hexa value',
    )
    Preconditions.checkState(
      Buffer.isBuffer(arg.prevTxId) || JSUtil.isHexa(arg.prevTxId),
      'prevTxId must be a buffer or hexa value',
    )
    Preconditions.checkArgument(
      arg.sigtype !== undefined,
      'sigtype is required',
    )
    Preconditions.checkState(
      typeof arg.sigtype === 'number',
      'sigtype must be a number',
    )
  }

  /**
   * Convert to object representation
   */
  toObject(): TransactionSignatureObject {
    return {
      publicKey: this.publicKey.toString(),
      prevTxId: this.prevTxId.toString('hex'),
      outputIndex: this.outputIndex,
      inputIndex: this.inputIndex,
      signature: this.signature.toString(),
      sigtype: this.sigtype,
    }
  }

  /**
   * Convert to JSON
   */
  toJSON = this.toObject

  /**
   * Create from object
   */
  static fromObject(obj: TransactionSignatureData): TransactionSignature {
    return new TransactionSignature(obj)
  }

  /**
   * Clone this transaction signature
   */
  clone(): TransactionSignature {
    return new TransactionSignature({
      publicKey: this.publicKey,
      prevTxId: Buffer.from(this.prevTxId),
      outputIndex: this.outputIndex,
      inputIndex: this.inputIndex,
      signature: this.signature,
      sigtype: this.sigtype,
    })
  }

  /**
   * Check if this signature is valid
   */
  isValid(): boolean {
    return (
      this.publicKey !== undefined &&
      this.prevTxId !== undefined &&
      this.outputIndex >= 0 &&
      this.inputIndex >= 0 &&
      this.signature !== undefined &&
      this.sigtype !== undefined &&
      PublicKey.isValid(this.publicKey) &&
      this.signature.r !== undefined &&
      this.signature.s !== undefined
    )
  }

  /**
   * String representation
   */
  toString(): string {
    return `TransactionSignature(${this.inputIndex}:${this.outputIndex})`
  }
}
