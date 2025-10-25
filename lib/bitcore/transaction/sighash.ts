import { Signature } from '../crypto/signature.js'
import { Script, empty } from '../script.js'
import { Output } from './output.js'
import { BufferReader } from '../encoding/bufferreader.js'
import { BufferWriter } from '../encoding/bufferwriter.js'
import { BN } from '../crypto/bn.js'
import { Hash } from '../crypto/hash.js'
import { ECDSA } from '../crypto/ecdsa.js'
import { Schnorr } from '../crypto/schnorr.js'
import { Preconditions } from '../util/preconditions.js'
import { BufferUtil } from '../util/buffer.js'
import { Interpreter } from '../script/interpreter.js'
import { PrivateKey } from '../privatekey.js'
import { PublicKey } from '../publickey.js'
import { Transaction } from './transaction.js'
import { Input } from './input.js'

export interface TransactionLike {
  inputs: Array<{
    prevTxId: Buffer
    outputIndex: number
    sequenceNumber: number
    script?: Script | null
  }>
  outputs: Array<{
    satoshis: number
    script?: Script
    toBufferWriter(writer: BufferWriter): void
  }>
  toBuffer(): Buffer
  version?: number
  nLockTime?: number
}

const SIGHASH_SINGLE_BUG_CONST =
  '0000000000000000000000000000000000000000000000000000000000000001'
const BITS_64_ON_CONST = 'ffffffffffffffff'

// By default, we sign with sighash_forkid
const DEFAULT_SIGN_FLAGS_CONST = 1 << 16 // SCRIPT_ENABLE_SIGHASH_FORKID

/**
 * Get ForkId for UAHF
 */
function GetForkId(): number {
  return 0 // In the UAHF, a fork id of 0 is used (see [4] REQ-6-2 NOTE 4)
}

/**
 * Calculate sighash for ForkId signatures (BIP143)
 */
function sighashForForkId(
  transaction: TransactionLike,
  sighashType: number,
  inputNumber: number,
  subscript: Script,
  satoshisBN: BN,
): Buffer {
  const input = transaction.inputs[inputNumber]
  Preconditions.checkArgument(
    satoshisBN instanceof BN,
    'For ForkId=0 signatures, satoshis or complete input must be provided',
  )

  function GetPrevoutHash(tx: TransactionLike): Buffer {
    const writer = new BufferWriter()

    for (const input of tx.inputs) {
      writer.writeReverse(input.prevTxId)
      writer.writeUInt32LE(input.outputIndex)
    }

    const buf = writer.toBuffer()
    return Hash.sha256sha256(buf)
  }

  function GetSequenceHash(tx: TransactionLike): Buffer {
    const writer = new BufferWriter()

    for (const input of tx.inputs) {
      writer.writeUInt32LENumber(input.sequenceNumber)
    }

    const buf = writer.toBuffer()
    return Hash.sha256sha256(buf)
  }

  function GetOutputsHash(tx: TransactionLike, n?: number): Buffer {
    const writer = new BufferWriter()

    if (n === undefined) {
      for (const output of tx.outputs) {
        output.toBufferWriter(writer)
      }
    } else {
      tx.outputs[n].toBufferWriter(writer)
    }

    const buf = writer.toBuffer()
    return Hash.sha256sha256(buf)
  }

  let hashPrevouts = BufferUtil.emptyBuffer(32)
  let hashSequence = BufferUtil.emptyBuffer(32)
  let hashOutputs = BufferUtil.emptyBuffer(32)

  if (!(sighashType & Signature.SIGHASH_ANYONECANPAY)) {
    hashPrevouts = GetPrevoutHash(transaction)
  }

  if (
    !(sighashType & Signature.SIGHASH_ANYONECANPAY) &&
    (sighashType & 31) !== Signature.SIGHASH_SINGLE &&
    (sighashType & 31) !== Signature.SIGHASH_NONE
  ) {
    hashSequence = GetSequenceHash(transaction)
  }

  if (
    (sighashType & 31) !== Signature.SIGHASH_SINGLE &&
    (sighashType & 31) !== Signature.SIGHASH_NONE
  ) {
    hashOutputs = GetOutputsHash(transaction)
  } else if (
    (sighashType & 31) === Signature.SIGHASH_SINGLE &&
    inputNumber < transaction.outputs.length
  ) {
    hashOutputs = GetOutputsHash(transaction, inputNumber)
  }

  const writer = new BufferWriter()

  // Version
  writer.writeUInt32LE(transaction.version || 2)

  // Input prevouts/nSequence (none/all, depending on flags)
  writer.write(hashPrevouts)
  writer.write(hashSequence)

  // The input being signed (replacing the scriptSig with scriptCode + amount)
  writer.writeReverse(input.prevTxId)
  writer.writeUInt32LE(input.outputIndex)
  writer.writeVarintNum(subscript.toBuffer().length)
  writer.write(subscript.toBuffer())
  writer.writeUInt64LEBN(satoshisBN)
  writer.writeUInt32LENumber(input.sequenceNumber)

  // Outputs (none/one/all, depending on flags)
  writer.write(hashOutputs)

  // Locktime
  writer.writeUInt32LE(transaction.nLockTime || 0)

  // Sighash type
  writer.writeUInt32LE(sighashType >>> 0)

  const buf = writer.toBuffer()
  const hash = Hash.sha256sha256(buf)
  return new BufferReader(hash).readReverse(32)
}

/**
 * Calculate sighash for legacy signatures
 */
function sighashLegacy(
  transaction: TransactionLike,
  sighashType: number,
  inputNumber: number,
  subscript: Script,
): Buffer {
  const input = transaction.inputs[inputNumber]

  function getHash(w: BufferWriter): Buffer {
    const buf = w.toBuffer()
    return Hash.sha256sha256(buf)
  }

  const writer = new BufferWriter()

  // Version
  writer.writeUInt32LE(2) // Assuming version 2

  // Input count
  writer.writeVarintNum(transaction.inputs.length)

  // Inputs
  for (let i = 0; i < transaction.inputs.length; i++) {
    const txInput = transaction.inputs[i]
    writer.writeReverse(txInput.prevTxId)
    writer.writeUInt32LE(txInput.outputIndex)

    if (i === inputNumber) {
      writer.writeVarLengthBuffer(subscript.toBuffer())
    } else {
      writer.writeVarintNum(0) // Empty script
    }

    writer.writeUInt32LENumber(txInput.sequenceNumber)
  }

  // Output count
  writer.writeVarintNum(transaction.outputs.length)

  // Outputs
  if (
    (sighashType & 31) !== Signature.SIGHASH_SINGLE &&
    (sighashType & 31) !== Signature.SIGHASH_NONE
  ) {
    for (const output of transaction.outputs) {
      output.toBufferWriter(writer)
    }
  } else if (
    (sighashType & 31) === Signature.SIGHASH_SINGLE &&
    inputNumber < transaction.outputs.length
  ) {
    transaction.outputs[inputNumber].toBufferWriter(writer)
  }

  // Locktime
  writer.writeUInt32LE(transaction.nLockTime || 0)

  // Sighash type
  writer.writeUInt32LE(sighashType)

  return getHash(writer)
}

/**
 * Calculate the sighash for a transaction
 */
function sighash(
  transaction: TransactionLike,
  sighashType: number,
  inputNumber: number,
  subscript: Script,
  satoshisBN?: BN,
  flags?: number,
): Buffer {
  if (flags === undefined) {
    flags = DEFAULT_SIGN_FLAGS_CONST
  }

  // Copy transaction
  const txcopy = Transaction.shallowCopy(transaction as Transaction)

  // Copy script
  subscript = new Script(subscript)

  // Handle replay protection
  if (flags & Interpreter.SCRIPT_ENABLE_REPLAY_PROTECTION) {
    // Legacy chain's value for fork id must be of the form 0xffxxxx.
    // By xoring with 0xdead, we ensure that the value will be different
    // from the original one, even if it already starts with 0xff.
    const forkValue = sighashType >> 8
    const newForkValue = 0xff0000 | (forkValue ^ 0xdead)
    sighashType = (newForkValue << 8) | (sighashType & 0xff)
  }

  // Check if this is a ForkId signature
  if (
    sighashType & Signature.SIGHASH_FORKID &&
    flags & Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID
  ) {
    return sighashForForkId(
      txcopy,
      sighashType,
      inputNumber,
      subscript,
      satoshisBN!,
    )
  }

  // For no ForkId sighash, separators need to be removed.
  subscript.removeCodeseparators()

  // Blank signatures for other inputs
  for (let i = 0; i < txcopy.inputs.length; i++) {
    txcopy.inputs[i] = new Input({
      prevTxId: txcopy.inputs[i].prevTxId,
      outputIndex: txcopy.inputs[i].outputIndex,
      sequenceNumber: txcopy.inputs[i].sequenceNumber,
      script: empty(),
    })
  }

  txcopy.inputs[inputNumber] = new Input({
    prevTxId: txcopy.inputs[inputNumber].prevTxId,
    outputIndex: txcopy.inputs[inputNumber].outputIndex,
    sequenceNumber: txcopy.inputs[inputNumber].sequenceNumber,
    script: subscript,
  })

  // Handle SIGHASH_NONE and SIGHASH_SINGLE
  if (
    (sighashType & 31) === Signature.SIGHASH_NONE ||
    (sighashType & 31) === Signature.SIGHASH_SINGLE
  ) {
    // Clear all sequence numbers except for the input being signed
    for (let i = 0; i < txcopy.inputs.length; i++) {
      if (i !== inputNumber) {
        txcopy.inputs[i].sequenceNumber = 0
      }
    }
  }

  // Handle SIGHASH_NONE
  if ((sighashType & 31) === Signature.SIGHASH_NONE) {
    txcopy.outputs = []
  } else if ((sighashType & 31) === Signature.SIGHASH_SINGLE) {
    // The SIGHASH_SINGLE bug.
    // https://bitcointalk.org/index.php?topic=260595.0
    if (inputNumber >= txcopy.outputs.length) {
      return Buffer.from(SIGHASH_SINGLE_BUG_CONST, 'hex')
    }

    // Truncate outputs to inputNumber + 1
    txcopy.outputs.length = inputNumber + 1

    // Set outputs before inputNumber to have max value and empty script
    for (let i = 0; i < inputNumber; i++) {
      txcopy.outputs[i] = new Output({
        satoshis: BN.fromBuffer(Buffer.from(BITS_64_ON_CONST, 'hex')),
        script: empty(),
      })
    }
  }

  // Handle SIGHASH_ANYONECANPAY
  if (sighashType & Signature.SIGHASH_ANYONECANPAY) {
    txcopy.inputs = [txcopy.inputs[inputNumber]]
  }

  // Serialize the transaction
  const buf = new BufferWriter()
    .write(txcopy.toBuffer())
    .writeInt32LE(sighashType >>> 0)
    .toBuffer()

  const hash = Hash.sha256sha256(buf)
  return new BufferReader(hash).readReverse(32)
}

/**
 * Sign a transaction input
 */
function sign(
  transaction: TransactionLike,
  privateKey: PrivateKey,
  sighashType: number,
  inputIndex: number,
  subscript: Script,
  satoshisBN?: BN,
  flags?: number,
  signingMethod?: 'ecdsa' | 'schnorr',
): Signature {
  const hashbuf = sighash(
    transaction,
    sighashType,
    inputIndex,
    subscript,
    satoshisBN,
    flags,
  )

  signingMethod = signingMethod || 'ecdsa'
  let sig: Signature

  if (signingMethod === 'schnorr') {
    sig = Schnorr.sign(hashbuf, privateKey, 'little')
    sig.nhashtype = sighashType
    return sig
  } else if (signingMethod === 'ecdsa') {
    sig = ECDSA.sign(hashbuf, privateKey, 'little')
    sig.nhashtype = sighashType
    return sig
  } else {
    throw new Error('Invalid signing method. Must be "ecdsa" or "schnorr"')
  }
}

/**
 * Verify a transaction signature
 */
function verify(
  transaction: TransactionLike,
  signature: Signature,
  publicKey: PublicKey,
  inputIndex: number,
  subscript: Script,
  satoshisBN?: BN,
  flags?: number,
  signingMethod?: 'ecdsa' | 'schnorr',
): boolean {
  Preconditions.checkArgument(
    transaction !== undefined,
    'Transaction is required',
  )
  Preconditions.checkArgument(
    signature !== undefined && signature.nhashtype !== undefined,
    'Signature with nhashtype is required',
  )

  const hashbuf = sighash(
    transaction,
    signature.nhashtype!,
    inputIndex,
    subscript,
    satoshisBN,
    flags,
  )

  signingMethod = signingMethod || 'ecdsa'

  if (signingMethod === 'schnorr') {
    return Schnorr.verify(hashbuf, signature, publicKey, 'little')
  } else if (signingMethod === 'ecdsa') {
    return ECDSA.verify(hashbuf, signature, publicKey, 'little')
  } else {
    throw new Error('Invalid signing method. Must be "ecdsa" or "schnorr"')
  }
}

/**
 * Default sign flags
 */
export const DEFAULT_SIGN_FLAGS = DEFAULT_SIGN_FLAGS_CONST

/**
 * Constants
 */
export const SIGHASH_SINGLE_BUG = SIGHASH_SINGLE_BUG_CONST
export const BITS_64_ON = BITS_64_ON_CONST

/**
 * @namespace Signing
 */
export { sighash, sign, verify }
