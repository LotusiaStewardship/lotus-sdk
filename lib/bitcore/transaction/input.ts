import { Preconditions } from '../util/preconditions.js'
import { BitcoreError } from '../errors.js'
import { BufferWriter } from '../encoding/bufferwriter.js'
import { BufferReader } from '../encoding/bufferreader.js'
import { BufferUtil } from '../util/buffer.js'
import { JSUtil } from '../util/js.js'
import { Script, empty } from '../script.js'
import { Opcode } from '../opcode.js'
import { BN } from '../crypto/bn.js'
import { Output } from './output.js'
import { PrivateKey } from '../privatekey.js'
import { PublicKey } from '../publickey.js'
import { Signature } from '../crypto/signature.js'
import { TransactionSignature } from './signature.js'
import { Transaction } from './transaction.js'
import { sighash, sign, verify, TransactionLike } from './sighash.js'
import { Hash } from '../crypto/hash.js'

export interface InputData {
  prevTxId?: Buffer | string
  outputIndex?: number
  sequenceNumber?: number
  script?: Script | Buffer | string
  scriptBuffer?: Buffer
  output?: Output // Output type
}

export interface InputObject {
  prevTxId?: Buffer | string
  outputIndex?: number
  sequenceNumber?: number
  script?: Script | Buffer | string
  scriptBuffer?: Buffer
  scriptString?: string
  output?: Output
}

/**
 * Represents a transaction input
 */
export class Input {
  // Constants
  static readonly MAXINT = 0xffffffff // Math.pow(2, 32) - 1
  static readonly DEFAULT_SEQNUMBER = 0xffffffff
  static readonly DEFAULT_LOCKTIME_SEQNUMBER = 0xfffffffe
  static readonly DEFAULT_RBF_SEQNUMBER = 0xfffffffd
  static readonly SEQUENCE_LOCKTIME_TYPE_FLAG = 0x400000 // (1 << 22)
  static readonly SEQUENCE_LOCKTIME_DISABLE_FLAG = 0x80000000 // (1 << 31)
  static readonly SEQUENCE_LOCKTIME_MASK = 0xffff
  static readonly SEQUENCE_LOCKTIME_GRANULARITY = 512 // 512 seconds
  static readonly SEQUENCE_BLOCKDIFF_LIMIT = 0xffff // 16 bits

  // Instance properties
  /**
   * The transaction ID of the previous output being spent, as a Buffer.
   * This buffer is stored in internal (little-endian) order, as per Lotus transaction format,
   * but is typically displayed in RPCs or hex as big-endian (human-readable) order.
   */
  prevTxId!: Buffer
  outputIndex!: number
  sequenceNumber!: number
  private _scriptBuffer!: Buffer
  private _script?: Script
  output?: Output // Output type

  constructor(params?: InputData) {
    if (params) {
      this._fromObject(params)
    }
  }

  // Factory function to allow calling Input() without 'new'
  static create(params?: InputData): Input {
    return new Input(params)
  }

  static fromObject(obj: InputData): Input {
    Preconditions.checkArgument(
      typeof obj === 'object' && obj !== null,
      'Must provide an object',
    )
    const input = new Input()
    return input._fromObject(obj)
  }

  private _fromObject(params: InputData): Input {
    let prevTxId: Buffer
    if (typeof params.prevTxId === 'string' && JSUtil.isHexa(params.prevTxId)) {
      prevTxId = Buffer.from(params.prevTxId, 'hex')
    } else if (Buffer.isBuffer(params.prevTxId)) {
      prevTxId = params.prevTxId
    } else {
      prevTxId = Buffer.alloc(0) // Default empty buffer
    }

    this.output = params.output
    this.prevTxId = prevTxId
    this.outputIndex = params.outputIndex ?? 0
    this.sequenceNumber =
      params.sequenceNumber !== undefined
        ? params.sequenceNumber
        : Input.DEFAULT_SEQNUMBER

    if (params.scriptBuffer === undefined && params.script === undefined) {
      throw new BitcoreError.Transaction.Input.MissingScript()
    }

    this.setScript(params.scriptBuffer || params.script!)
    return this
  }

  /**
   * Get the script for this input
   */
  get script(): Script | null {
    if (this.isNull()) {
      return null
    }
    if (!this._script) {
      this._script = new Script(this._scriptBuffer)
      // Mark as input script
      ;(this._script as Script & { _isInput?: boolean })._isInput = true
    }
    return this._script
  }

  /**
   * Get the script buffer
   */
  get scriptBuffer(): Buffer {
    return this._scriptBuffer
  }

  /**
   * Set the script for this input
   */
  setScript(script: Script | Buffer | string | null): Input {
    this._script = undefined
    if (script instanceof Script) {
      this._script = script
      this._scriptBuffer = script.toBuffer()
    } else if (script === null) {
      this._script = empty()
      this._scriptBuffer = this._script.toBuffer()
    } else if (Buffer.isBuffer(script)) {
      this._scriptBuffer = script
      this._script = Script.fromBuffer(script)
    } else if (typeof script === 'string') {
      if (JSUtil.isHexa(script)) {
        this._scriptBuffer = Buffer.from(script, 'hex')
        this._script = Script.fromBuffer(this._scriptBuffer)
      } else {
        // Assume it's a script string
        this._scriptBuffer = Buffer.from(script, 'utf8')
        this._script = Script.fromBuffer(this._scriptBuffer)
      }
    } else {
      throw new TypeError('Invalid script type')
    }
    return this
  }

  /**
   * Check if this is a null input (coinbase)
   */
  isNull(): boolean {
    return (
      this.prevTxId.toString('hex') ===
        '0000000000000000000000000000000000000000000000000000000000000000' &&
      this.outputIndex === 0xffffffff
    )
  }

  /**
   * Check if this input is final
   */
  isFinal(): boolean {
    return this.sequenceNumber !== 4294967295
  }

  /**
   * Check if this input has a sequence number
   */
  hasSequence(): boolean {
    return this.sequenceNumber !== Input.DEFAULT_SEQNUMBER
  }

  /**
   * Check if this input has a relative lock time
   */
  hasRelativeLockTime(): boolean {
    return (
      (this.sequenceNumber & Input.SEQUENCE_LOCKTIME_DISABLE_FLAG) !==
        Input.SEQUENCE_LOCKTIME_DISABLE_FLAG &&
      this.sequenceNumber !== Input.DEFAULT_SEQNUMBER
    )
  }

  /**
   * Get the relative lock time value
   */
  getRelativeLockTime(): bigint {
    if (!this.hasRelativeLockTime()) {
      return BigInt(0)
    }
    return BigInt(this.sequenceNumber & Input.SEQUENCE_LOCKTIME_MASK)
  }

  /**
   * Check if the relative lock time is in blocks
   */
  isRelativeLockTimeInBlocks(): boolean {
    if (!this.hasRelativeLockTime()) {
      return false
    }
    return (this.sequenceNumber & Input.SEQUENCE_LOCKTIME_TYPE_FLAG) !== 0
  }

  /**
   * Get the relative lock time in blocks
   */
  getRelativeLockTimeInBlocks(): number {
    if (!this.isRelativeLockTimeInBlocks()) {
      return 0
    }
    return Number(this.getRelativeLockTime())
  }

  /**
   * Get the relative lock time in seconds
   */
  getRelativeLockTimeInSeconds(): number {
    if (this.isRelativeLockTimeInBlocks()) {
      return 0
    }
    return (
      Number(this.getRelativeLockTime()) *
      Number(Input.SEQUENCE_LOCKTIME_GRANULARITY)
    )
  }

  /**
   * Convert to object representation
   */
  toObject(): InputObject {
    const obj: InputObject = {
      prevTxId: Buffer.from(this.prevTxId).toString('hex'),
      outputIndex: this.outputIndex,
      sequenceNumber: this.sequenceNumber,
      script: this._scriptBuffer.toString('hex'),
    }

    // Add human readable form if input contains valid script
    if (this.script) {
      ;(obj as InputObject & { scriptString?: string }).scriptString =
        this.script.toASM()
    }

    if (this.output) {
      ;(obj as InputObject & { output?: Output }).output = this.output
    }

    return obj
  }

  /**
   * Convert to JSON
   */
  toJSON = this.toObject

  /**
   * Create from buffer reader
   */
  static fromBufferReader(br: BufferReader): Input {
    const input = new Input()
    input.prevTxId = br.readReverse(32)
    input.outputIndex = br.readUInt32LE()
    input._scriptBuffer = br.readVarLengthBuffer()
    input.sequenceNumber = br.readUInt32LE()
    return input
  }

  /**
   * Serialize to buffer
   */
  toBuffer(): Buffer {
    const bw = new BufferWriter()
    bw.writeReverse(this.prevTxId)
    bw.writeUInt32LE(this.outputIndex)
    bw.writeVarLengthBuffer(this._scriptBuffer)
    bw.writeUInt32LE(this.sequenceNumber)
    return bw.concat()
  }

  /**
   * Write to buffer writer
   */
  toBufferWriter(writer?: BufferWriter): BufferWriter {
    if (!writer) {
      writer = new BufferWriter()
    }
    writer.writeReverse(this.prevTxId)
    writer.writeUInt32LE(this.outputIndex)
    const script = this._scriptBuffer
    writer.writeVarintNum(script.length)
    writer.write(script)
    writer.writeUInt32LE(this.sequenceNumber)
    return writer
  }

  /**
   * Get the size of this input in bytes
   */
  getSize(): number {
    return (
      32 + // prevTxId
      4 + // outputIndex
      BufferWriter.varintBufNum(this._scriptBuffer.length).length +
      this._scriptBuffer.length + // script
      4 // sequenceNumber
    )
  }

  /**
   * Check if this input is valid
   */
  isValid(): boolean {
    if (this.isNull()) {
      return true
    }
    return (
      this.prevTxId.length === 32 &&
      this.outputIndex >= 0 &&
      this.outputIndex <= 0xffffffff &&
      this._scriptBuffer.length > 0
    )
  }

  /**
   * Clone this input
   */
  clone(): Input {
    return new Input({
      prevTxId: Buffer.from(this.prevTxId),
      outputIndex: this.outputIndex,
      sequenceNumber: this.sequenceNumber,
      scriptBuffer: Buffer.from(this._scriptBuffer),
      output: this.output,
    })
  }

  /**
   * Get signatures for the provided PrivateKey
   * @abstract
   */
  getSignatures(
    transaction: Transaction,
    privateKey: PrivateKey,
    index: number,
    sigtype?: number,
    hashData?: unknown,
    signingMethod?: string,
  ): TransactionSignature[] {
    Preconditions.checkState(
      this.output instanceof Output,
      'Output is required',
    )

    sigtype = sigtype || Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID
    const publicKey = privateKey.publicKey

    // Check if this is a P2PKH output
    if (this.output!.script.isPublicKeyHashOut()) {
      const addressHash = hashData || Hash.sha256ripemd160(publicKey.toBuffer())
      if (
        BufferUtil.equals(
          addressHash as Buffer,
          this.output!.script.getPublicKeyHash(),
        )
      ) {
        return [
          new TransactionSignature({
            publicKey: publicKey,
            prevTxId: this.prevTxId,
            outputIndex: this.outputIndex,
            inputIndex: index,
            signature: sign(
              transaction as unknown as TransactionLike,
              privateKey,
              sigtype,
              index,
              this.output!.script,
              new BN(this.output!.satoshis.toString()),
              undefined,
              signingMethod as 'ecdsa' | 'schnorr',
            ),
            sigtype: sigtype,
          }),
        ]
      }
    }
    // Check if this is a P2PK output
    else if (this.output!.script.isPublicKeyOut()) {
      if (
        publicKey.toString() ===
        this.output!.script.getPublicKey().toString('hex')
      ) {
        return [
          new TransactionSignature({
            publicKey: publicKey,
            prevTxId: this.prevTxId,
            outputIndex: this.outputIndex,
            inputIndex: index,
            signature: sign(
              transaction as unknown as TransactionLike,
              privateKey,
              sigtype,
              index,
              this.output!.script,
              new BN(this.output!.satoshis.toString()),
              undefined,
              signingMethod as 'ecdsa' | 'schnorr',
            ),
            sigtype: sigtype,
          }),
        ]
      }
    }

    return []
  }

  /**
   * Check if this input is fully signed
   * @abstract
   */
  isFullySigned(): boolean {
    throw new Error('Input#isFullySigned')
  }

  /**
   * Add signature to this input
   * @abstract
   */
  addSignature(
    transaction: Transaction,
    signature: TransactionSignature,
    signingMethod?: string,
  ): this {
    Preconditions.checkState(
      this.isValidSignature(transaction, signature, signingMethod),
      'Signature is invalid',
    )

    // Determine input type based on output script and create appropriate input script
    if (this.output?.script.isPublicKeyHashOut()) {
      // P2PKH input: signature + public key
      const script = new Script()
      script.add(signature.signature.toTxFormat(signingMethod))
      script.add(signature.publicKey.toBuffer())
      this.setScript(script)
    } else if (this.output?.script.isPublicKeyOut()) {
      // P2PK input: signature only
      const script = new Script()
      script.add(signature.signature.toTxFormat(signingMethod))
      this.setScript(script)
    } else {
      // For other input types, create a basic script with signature
      // This is a fallback for unknown input types
      const script = new Script()
      script.add(signature.signature.toTxFormat(signingMethod))
      if (signature.publicKey) {
        script.add(signature.publicKey.toBuffer())
      }
      this.setScript(script)
    }

    return this
  }

  /**
   * Clear all signatures from this input
   * @abstract
   */
  clearSignatures(): this {
    throw new Error('Input#clearSignatures')
  }

  /**
   * Validate a signature for this input
   */
  isValidSignature(
    transaction: Transaction,
    signature: TransactionSignature,
    signingMethod?: string,
  ): boolean {
    // FIXME: Refactor signature so this is not necessary
    signature.signature.nhashtype = signature.sigtype
    return verify(
      transaction as unknown as TransactionLike,
      signature.signature,
      signature.publicKey,
      signature.inputIndex,
      this.output!.script,
      new BN(this.output!.satoshis.toString()),
      undefined,
      signingMethod as 'ecdsa' | 'schnorr',
    )
  }

  /**
   * Lock input for specified seconds
   */
  lockForSeconds(seconds: number): Input {
    Preconditions.checkArgument(
      typeof seconds === 'number',
      'seconds must be a number',
    )
    if (
      seconds < 0 ||
      seconds >=
        Input.SEQUENCE_LOCKTIME_GRANULARITY * Input.SEQUENCE_LOCKTIME_MASK
    ) {
      throw new Error('Lock time range error')
    }
    seconds = Math.floor(seconds / Input.SEQUENCE_LOCKTIME_GRANULARITY)
    this.sequenceNumber = seconds | Input.SEQUENCE_LOCKTIME_TYPE_FLAG
    return this
  }

  /**
   * Lock input until block height difference
   */
  lockUntilBlockHeight(heightDiff: number): Input {
    Preconditions.checkArgument(
      typeof heightDiff === 'number',
      'heightDiff must be a number',
    )
    if (heightDiff < 0 || heightDiff >= Input.SEQUENCE_BLOCKDIFF_LIMIT) {
      throw new Error('Block height out of range')
    }
    this.sequenceNumber = heightDiff
    return this
  }

  /**
   * Get lock time as Date or number
   */
  getLockTime(): Date | number | null {
    if (this.sequenceNumber & Input.SEQUENCE_LOCKTIME_DISABLE_FLAG) {
      return null
    }

    if (this.sequenceNumber & Input.SEQUENCE_LOCKTIME_TYPE_FLAG) {
      const seconds =
        Input.SEQUENCE_LOCKTIME_GRANULARITY *
        (this.sequenceNumber & Input.SEQUENCE_LOCKTIME_MASK)
      return seconds
    } else {
      const blockHeight = this.sequenceNumber & Input.SEQUENCE_LOCKTIME_MASK
      return blockHeight
    }
  }

  /**
   * Estimate the size of this input
   */
  _estimateSize(): number {
    return this.toBufferWriter().toBuffer().length
  }

  /**
   * String representation
   */
  toString(): string {
    if (this.isNull()) {
      return 'Input(coinbase)'
    }
    return `Input(${this.prevTxId.toString('hex')}:${this.outputIndex})`
  }
}

/**
 * Multisig input class
 */
export class MultisigInput extends Input {
  static readonly OPCODES_SIZE = 1 // 0
  static readonly SIGNATURE_SIZE = 73 // size (1) + DER (<=72)

  publicKeys!: PublicKey[]
  threshold!: number
  signatures!: (TransactionSignature | undefined)[]
  publicKeyIndex!: { [key: string]: number }

  constructor(
    input: Input,
    pubkeys?: PublicKey[],
    threshold?: number,
    signatures?: TransactionSignature[],
    opts?: { noSorting?: boolean },
  ) {
    super({
      prevTxId: input.prevTxId,
      outputIndex: input.outputIndex,
      sequenceNumber: input.sequenceNumber,
      scriptBuffer: input.script?.toBuffer(),
      output: input.output,
    })

    opts = opts || {}
    pubkeys =
      pubkeys || (input as Input & { publicKeys?: PublicKey[] }).publicKeys
    threshold = threshold || (input as Input & { threshold?: number }).threshold
    signatures =
      signatures ||
      (input as Input & { signatures?: TransactionSignature[] }).signatures

    if (opts.noSorting) {
      this.publicKeys = pubkeys!
    } else {
      this.publicKeys = pubkeys!.sort((a, b) =>
        a.toString().localeCompare(b.toString()),
      )
    }

    Preconditions.checkState(
      Script.buildMultisigOut(this.publicKeys, threshold!).equals(
        this.output!.script,
      ),
      "Provided public keys don't match to the provided output script",
    )

    this.publicKeyIndex = {}
    this.publicKeys.forEach((publicKey, index) => {
      this.publicKeyIndex[publicKey.toString()] = index
    })

    this.threshold = threshold!
    this.signatures = signatures
      ? this._deserializeSignatures(signatures)
      : new Array(this.publicKeys.length)
  }

  toObject(): object {
    const obj = super.toObject()
    return {
      ...obj,
      threshold: this.threshold,
      publicKeys: this.publicKeys.map(pk => pk.toString()),
      signatures: this._serializeSignatures(),
    }
  }

  _deserializeSignatures(
    signatures: TransactionSignature[],
  ): (TransactionSignature | undefined)[] {
    return signatures.map(signature => {
      if (!signature) {
        return undefined
      }
      return new TransactionSignature(signature)
    })
  }

  _serializeSignatures(): (object | undefined)[] {
    return this.signatures.map(signature => {
      if (!signature) {
        return undefined
      }
      return signature.toObject()
    })
  }

  getSignatures(
    transaction: Transaction,
    privateKey: PrivateKey,
    index: number,
    sigtype?: number,
    hashData?: unknown,
    signingMethod?: string,
  ): TransactionSignature[] {
    Preconditions.checkState(
      this.output instanceof Output,
      'Output is required',
    )
    sigtype = sigtype || Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID

    const results: TransactionSignature[] = []
    this.publicKeys.forEach(publicKey => {
      if (publicKey.toString() === privateKey.publicKey.toString()) {
        results.push(
          new TransactionSignature({
            publicKey: privateKey.publicKey,
            prevTxId: this.prevTxId,
            outputIndex: this.outputIndex,
            inputIndex: index,
            signature: sign(
              transaction as unknown as TransactionLike,
              privateKey,
              sigtype,
              index,
              this.output!.script,
              new BN(this.output!.satoshis.toString()),
              undefined,
              signingMethod as 'ecdsa' | 'schnorr',
            ),
            sigtype: sigtype,
          }),
        )
      }
    })
    return results
  }

  addSignature(
    transaction: Transaction,
    signature: TransactionSignature,
    signingMethod?: string,
  ): this {
    Preconditions.checkState(
      !this.isFullySigned(),
      'All needed signatures have already been added',
    )
    Preconditions.checkArgument(
      this.publicKeyIndex[signature.publicKey.toString()] !== undefined,
      'Signature has no matching public key',
    )
    Preconditions.checkState(
      this.isValidSignature(transaction, signature, signingMethod),
      'Invalid signature',
    )

    this.signatures[this.publicKeyIndex[signature.publicKey.toString()]] =
      signature
    this._updateScript(signingMethod)
    return this
  }

  _updateScript(signingMethod?: string): this {
    // Create multisig input script manually
    const script = new Script()
    script.add(Opcode.OP_0)

    // Add signatures
    const signatures = this._createSignatures(signingMethod)
    for (const sig of signatures) {
      script.add(sig)
    }

    this.setScript(script)
    return this
  }

  _createSignatures(signingMethod?: string): Buffer[] {
    return this.signatures
      .filter(signature => signature !== undefined)
      .map(signature => {
        return Buffer.concat([
          signature!.toDER(signingMethod),
          Buffer.from([signature!.sigtype]),
        ])
      })
  }

  clearSignatures(): this {
    this.signatures = new Array(this.publicKeys.length)
    this._updateScript()
    return this
  }

  isFullySigned(): boolean {
    return this.countSignatures() === this.threshold
  }

  countMissingSignatures(): number {
    return this.threshold - this.countSignatures()
  }

  countSignatures(): number {
    return this.signatures.reduce(
      (sum, signature) => sum + (signature ? 1 : 0),
      0,
    )
  }

  publicKeysWithoutSignature(): PublicKey[] {
    return this.publicKeys.filter(publicKey => {
      return !this.signatures[this.publicKeyIndex[publicKey.toString()]]
    })
  }

  isValidSignature(
    transaction: Transaction,
    signature: TransactionSignature,
    signingMethod?: string,
  ): boolean {
    signature.signature.nhashtype = signature.sigtype
    return verify(
      transaction as unknown as TransactionLike,
      signature.signature,
      signature.publicKey,
      signature.inputIndex,
      this.output!.script,
      new BN(this.output!.satoshis.toString()),
      undefined,
      signingMethod as 'ecdsa' | 'schnorr',
    )
  }

  normalizeSignatures(
    transaction: Transaction,
    input: Input,
    inputIndex: number,
    signatures: Buffer[],
    publicKeys: PublicKey[],
    signingMethod?: string,
  ): TransactionSignature[] {
    return publicKeys
      .map(pubKey => {
        let signatureMatch: TransactionSignature | null = null
        signatures = signatures.filter(signatureBuffer => {
          if (signatureMatch) {
            return true
          }

          const signature = new TransactionSignature({
            signature: Signature.fromTxFormat(signatureBuffer),
            publicKey: pubKey,
            prevTxId: input.prevTxId,
            outputIndex: input.outputIndex,
            inputIndex: inputIndex,
            sigtype: Signature.SIGHASH_ALL,
          })

          signature.signature.nhashtype = signature.sigtype
          const isMatch = verify(
            transaction as unknown as TransactionLike,
            signature.signature,
            signature.publicKey,
            signature.inputIndex,
            input.output!.script,
            new BN(input.output!.satoshis.toString()),
            undefined,
            signingMethod as 'ecdsa' | 'schnorr',
          )

          if (isMatch) {
            signatureMatch = signature
            return false
          }

          return true
        })

        return signatureMatch ? signatureMatch : null
      })
      .filter(sig => sig !== null) as TransactionSignature[]
  }

  _estimateSize(): number {
    return (
      MultisigInput.OPCODES_SIZE + this.threshold * MultisigInput.SIGNATURE_SIZE
    )
  }
}

/**
 * Multisig script hash input class
 */
export class MultisigScriptHashInput extends Input {
  static readonly OPCODES_SIZE = 7 // serialized size (<=3) + 0 .. N .. M OP_CHECKMULTISIG
  static readonly SIGNATURE_SIZE = 74 // size (1) + DER (<=72) + sighash (1)
  static readonly PUBKEY_SIZE = 34 // size (1) + DER (<=33)

  publicKeys!: PublicKey[]
  threshold!: number
  signatures!: (TransactionSignature | undefined)[]
  redeemScript!: Script
  publicKeyIndex!: { [key: string]: number }
  checkBitsField!: Uint8Array

  constructor(
    input: Input,
    pubkeys?: PublicKey[],
    threshold?: number,
    signatures?: TransactionSignature[],
    opts?: { noSorting?: boolean },
  ) {
    super({
      prevTxId: input.prevTxId,
      outputIndex: input.outputIndex,
      sequenceNumber: input.sequenceNumber,
      scriptBuffer: input.script?.toBuffer(),
      output: input.output,
    })

    opts = opts || {}
    pubkeys =
      pubkeys || (input as Input & { publicKeys?: PublicKey[] }).publicKeys
    threshold = threshold || (input as Input & { threshold?: number }).threshold
    signatures =
      signatures ||
      (input as Input & { signatures?: TransactionSignature[] }).signatures

    if (opts.noSorting) {
      this.publicKeys = pubkeys!
    } else {
      this.publicKeys = pubkeys!.sort((a, b) =>
        a.toString().localeCompare(b.toString()),
      )
    }

    this.redeemScript = Script.buildMultisigOut(
      this.publicKeys,
      threshold!,
      opts,
    )
    Preconditions.checkState(
      Script.buildScriptHashOut(this.redeemScript).equals(this.output!.script),
      "Provided public keys don't hash to the provided output",
    )

    this.publicKeyIndex = {}
    this.publicKeys.forEach((publicKey, index) => {
      this.publicKeyIndex[publicKey.toString()] = index
    })

    this.threshold = threshold!
    this.signatures = signatures
      ? this._deserializeSignatures(signatures)
      : new Array(this.publicKeys.length)
    this.checkBitsField = new Uint8Array(this.publicKeys.length)
  }

  toObject(): object {
    const obj = super.toObject()
    return {
      ...obj,
      threshold: this.threshold,
      publicKeys: this.publicKeys.map(pk => pk.toString()),
      signatures: this._serializeSignatures(),
    }
  }

  _deserializeSignatures(
    signatures: TransactionSignature[],
  ): (TransactionSignature | undefined)[] {
    return signatures.map(signature => {
      if (!signature) {
        return undefined
      }
      return new TransactionSignature(signature)
    })
  }

  _serializeSignatures(): (object | undefined)[] {
    return this.signatures.map(signature => {
      if (!signature) {
        return undefined
      }
      return signature.toObject()
    })
  }

  getSignatures(
    transaction: Transaction,
    privateKey: PrivateKey,
    index: number,
    sigtype?: number,
    hashData?: unknown,
    signingMethod?: string,
  ): TransactionSignature[] {
    Preconditions.checkState(
      this.output instanceof Output,
      'Output is required',
    )
    sigtype = sigtype || Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID

    const results: TransactionSignature[] = []
    this.publicKeys.forEach(publicKey => {
      if (publicKey.toString() === privateKey.publicKey.toString()) {
        results.push(
          new TransactionSignature({
            publicKey: privateKey.publicKey,
            prevTxId: this.prevTxId,
            outputIndex: this.outputIndex,
            inputIndex: index,
            signature: sign(
              transaction as unknown as TransactionLike,
              privateKey,
              sigtype,
              index,
              this.redeemScript,
              new BN(this.output!.satoshis.toString()),
              undefined,
              signingMethod as 'ecdsa' | 'schnorr' | undefined,
            ),
            sigtype: sigtype,
          }),
        )
      }
    })
    return results
  }

  addSignature(
    transaction: Transaction,
    signature: TransactionSignature,
    signingMethod?: string,
  ): this {
    Preconditions.checkState(
      !this.isFullySigned(),
      'All needed signatures have already been added',
    )
    Preconditions.checkArgument(
      this.publicKeyIndex[signature.publicKey.toString()] !== undefined,
      'Signature has no matching public key',
    )
    Preconditions.checkState(
      this.isValidSignature(transaction, signature, signingMethod),
      'Invalid signature',
    )

    this.signatures[this.publicKeyIndex[signature.publicKey.toString()]] =
      signature
    this.checkBitsField[this.publicKeyIndex[signature.publicKey.toString()]] =
      signature !== undefined ? 1 : 0
    this._updateScript(signingMethod, this.checkBitsField)
    return this
  }

  _updateScript(signingMethod?: string, checkBitsField?: Uint8Array): this {
    // Create P2SH multisig input script manually
    const script = new Script()
    script.add(Opcode.OP_0)

    // Add signatures
    const signatures = this._createSignatures(signingMethod)
    for (const sig of signatures) {
      script.add(sig)
    }

    // Add redeem script
    script.add(this.redeemScript.toBuffer())

    this.setScript(script)
    return this
  }

  _createSignatures(signingMethod?: string): Buffer[] {
    return this.signatures
      .filter(signature => signature !== undefined)
      .map(signature => {
        return Buffer.concat([
          signature!.toDER(signingMethod),
          Buffer.from([signature!.sigtype]),
        ])
      })
  }

  clearSignatures(): this {
    this.signatures = new Array(this.publicKeys.length)
    this._updateScript()
    return this
  }

  isFullySigned(): boolean {
    return this.countSignatures() === this.threshold
  }

  countMissingSignatures(): number {
    return this.threshold - this.countSignatures()
  }

  countSignatures(): number {
    return this.signatures.reduce(
      (sum, signature) => sum + (signature ? 1 : 0),
      0,
    )
  }

  publicKeysWithoutSignature(): PublicKey[] {
    return this.publicKeys.filter(publicKey => {
      return !this.signatures[this.publicKeyIndex[publicKey.toString()]]
    })
  }

  isValidSignature(
    transaction: Transaction,
    signature: TransactionSignature,
    signingMethod?: string,
  ): boolean {
    signingMethod = signingMethod || 'ecdsa'
    signature.signature.nhashtype = signature.sigtype
    return verify(
      transaction as unknown as TransactionLike,
      signature.signature,
      signature.publicKey,
      signature.inputIndex,
      this.redeemScript,
      new BN(this.output!.satoshis.toString()),
      undefined,
      signingMethod as 'ecdsa' | 'schnorr' | undefined,
    )
  }

  normalizeSignatures(
    transaction: Transaction,
    input: Input,
    inputIndex: number,
    signatures: Buffer[],
    publicKeys: PublicKey[],
    signingMethod?: string,
  ): TransactionSignature[] {
    // Implementation would go here
    return []
  }

  _estimateSize(): number {
    return (
      MultisigScriptHashInput.OPCODES_SIZE +
      this.threshold * MultisigScriptHashInput.SIGNATURE_SIZE +
      this.publicKeys.length * MultisigScriptHashInput.PUBKEY_SIZE
    )
  }
}

/**
 * Public key input class
 */
export class PublicKeyInput extends Input {
  static readonly SCRIPT_MAX_SIZE = 73 // sigsize (1 + 72)

  getSignatures(
    transaction: Transaction,
    privateKey: PrivateKey,
    index: number,
    sigtype?: number,
    hashData?: unknown,
    signingMethod?: string,
  ): TransactionSignature[] {
    Preconditions.checkState(
      this.output instanceof Output,
      'Output is required',
    )
    sigtype = sigtype || Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID
    const publicKey = privateKey.publicKey

    if (
      publicKey.toString() ===
      this.output!.script.getPublicKey().toString('hex')
    ) {
      return [
        new TransactionSignature({
          publicKey: publicKey,
          prevTxId: this.prevTxId,
          outputIndex: this.outputIndex,
          inputIndex: index,
          signature: sign(
            transaction as unknown as TransactionLike,
            privateKey,
            sigtype,
            index,
            this.output!.script,
            new BN(this.output!.satoshis.toString()),
            undefined,
            signingMethod as 'ecdsa' | 'schnorr',
          ),
          sigtype: sigtype,
        }),
      ]
    }
    return []
  }

  addSignature(
    transaction: Transaction,
    signature: TransactionSignature,
    signingMethod?: string,
  ): this {
    Preconditions.checkState(
      this.isValidSignature(transaction, signature, signingMethod),
      'Signature is invalid',
    )

    // Create P2PK input script manually
    const script = new Script()
    script.add(signature.signature.toTxFormat(signingMethod))

    this.setScript(script)
    return this
  }

  clearSignatures(): this {
    this.setScript(new Script())
    return this
  }

  isFullySigned(): boolean {
    return this.script!.isPublicKeyIn()
  }

  _estimateSize(): number {
    return PublicKeyInput.SCRIPT_MAX_SIZE
  }
}

/**
 * Public key hash input class
 */
export class PublicKeyHashInput extends Input {
  static readonly SCRIPT_MAX_SIZE = 73 + 34 // sigsize (1 + 72) + pubkey (1 + 33)

  getSignatures(
    transaction: Transaction,
    privateKey: PrivateKey,
    index: number,
    sigtype?: number,
    hashData?: unknown,
    signingMethod?: string,
  ): TransactionSignature[] {
    Preconditions.checkState(
      this.output instanceof Output,
      'Output is required',
    )
    hashData = hashData || Hash.sha256ripemd160(privateKey.publicKey.toBuffer())
    sigtype = sigtype || Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID

    if (
      BufferUtil.equals(
        hashData as Buffer,
        this.output!.script.getPublicKeyHash(),
      )
    ) {
      return [
        new TransactionSignature({
          publicKey: privateKey.publicKey,
          prevTxId: this.prevTxId,
          outputIndex: this.outputIndex,
          inputIndex: index,
          signature: sign(
            transaction as unknown as TransactionLike,
            privateKey,
            sigtype,
            index,
            this.output!.script,
            new BN(this.output!.satoshis.toString()),
            undefined,
            signingMethod as 'ecdsa' | 'schnorr' | undefined,
          ),
          sigtype: sigtype,
        }),
      ]
    }
    return []
  }

  addSignature(
    transaction: Transaction,
    signature: TransactionSignature,
    signingMethod?: string,
  ): this {
    Preconditions.checkState(
      this.isValidSignature(transaction, signature, signingMethod),
      'Signature is invalid',
    )

    // Create P2PKH input script manually
    const script = new Script()
    script.add(signature.signature.toTxFormat(signingMethod))
    script.add(signature.publicKey.toBuffer())

    this.setScript(script)
    return this
  }

  clearSignatures(): this {
    this.setScript(new Script())
    return this
  }

  isFullySigned(): boolean {
    return this.script!.isPublicKeyHashIn()
  }

  _estimateSize(): number {
    return PublicKeyHashInput.SCRIPT_MAX_SIZE
  }
}
