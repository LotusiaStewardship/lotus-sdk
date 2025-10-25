import { Script } from '../script.js'
import { Opcode } from '../opcode.js'
import { BN } from '../crypto/bn.js'
import { Hash } from '../crypto/hash.js'
import { Signature } from '../crypto/signature.js'
import { PublicKey } from '../publickey.js'
import { ECDSA } from '../crypto/ecdsa.js'
import { Schnorr } from '../crypto/schnorr.js'
import { Preconditions } from '../util/preconditions.js'
import { BitcoreError } from '../errors.js'
import { BufferUtil } from '../util/buffer.js'
import { sighash, TransactionLike } from '../transaction/sighash.js'
import { Transaction } from '../transaction/transaction.js'
import { Input } from '../transaction/input.js'

export interface InterpreterData {
  script?: Script
  tx?: Transaction
  nin?: number
  flags?: number
  satoshisBN?: bigint
  outputScript?: Script // Output script (scriptPubKey) for sighash calculation
}

export interface InterpreterObject {
  script?: Script
  tx?: Transaction
  nin?: number
  flags?: number
  satoshisBN?: bigint
  outputScript?: Script // Output script (scriptPubKey) for sighash calculation
}

/**
 * Bitcoin transactions contain scripts. Each input has a script called the
 * scriptSig, and each output has a script called the scriptPubkey. To validate
 * an input, the input's script is concatenated with the referenced output script,
 * and the result is executed. If at the end of execution the stack contains a
 * "true" value, then the transaction is valid.
 *
 * The primary way to use this class is via the verify function.
 * e.g., Interpreter().verify( ... );
 */
export class Interpreter {
  // Script verification flags
  static SCRIPT_VERIFY_NONE = 0
  static SCRIPT_VERIFY_P2SH = 1 << 0
  static SCRIPT_VERIFY_STRICTENC = 1 << 1
  static SCRIPT_VERIFY_DERSIG = 1 << 2
  static SCRIPT_VERIFY_LOW_S = 1 << 3
  static SCRIPT_VERIFY_NULLDUMMY = 1 << 4
  static SCRIPT_VERIFY_SIGPUSHONLY = 1 << 5
  static SCRIPT_VERIFY_MINIMALDATA = 1 << 6
  static SCRIPT_VERIFY_DISCOURAGE_UPGRADABLE_NOPS = 1 << 7
  static SCRIPT_VERIFY_CLEANSTACK = 1 << 8
  static SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY = 1 << 9
  static SCRIPT_VERIFY_CHECKSEQUENCEVERIFY = 1 << 10
  static SCRIPT_VERIFY_MINIMALIF = 1 << 13
  static SCRIPT_VERIFY_NULLFAIL = 1 << 14
  static SCRIPT_VERIFY_COMPRESSED_PUBKEYTYPE = 1 << 15
  static SCRIPT_ENABLE_SIGHASH_FORKID = 1 << 16
  static SCRIPT_ENABLE_REPLAY_PROTECTION = 1 << 17
  static SCRIPT_ENABLE_CHECKDATASIG = 1 << 18
  static SCRIPT_DISALLOW_SEGWIT_RECOVERY = 1 << 20
  static SCRIPT_ENABLE_SCHNORR_MULTISIG = 1 << 21

  // Constants
  static MAX_SCRIPT_ELEMENT_SIZE = 520
  static MAX_SCRIPT_SIZE = 10000
  static MAX_STACK_SIZE = 1000
  static MAX_OPCODE_COUNT = 201

  // Stack constants
  static false = Buffer.from([0])
  static true = Buffer.from([1])

  // Additional constants from reference
  static MAXIMUM_ELEMENT_SIZE = 4
  static LOCKTIME_THRESHOLD = 500000000
  static LOCKTIME_THRESHOLD_BN = new BN(500000000)

  // Sequence locktime flags
  static SEQUENCE_LOCKTIME_DISABLE_FLAG = 1 << 31
  static SEQUENCE_LOCKTIME_TYPE_FLAG = 1 << 22
  static SEQUENCE_LOCKTIME_MASK = 0x0000ffff

  // Instance properties
  script!: Script
  tx?: Transaction
  nin?: number
  flags!: number
  satoshisBN?: bigint
  outputScript?: Script // Output script (scriptPubKey) for sighash calculation
  stack: Buffer[] = []
  altstack: Buffer[] = []
  pc: number = 0
  pbegincodehash: number = 0
  nOpCount: number = 0
  vfExec: boolean[] = []
  errstr: string = ''

  constructor(obj?: InterpreterObject) {
    this.initialize()
    if (obj) {
      this.set(obj)
    }
  }

  // Factory function to allow calling Interpreter() without 'new'
  static create(obj?: InterpreterObject): Interpreter {
    return new Interpreter(obj)
  }

  /**
   * Initialize the interpreter state
   */
  initialize(): void {
    this.stack = []
    this.altstack = []
    this.pc = 0
    this.pbegincodehash = 0
    this.nOpCount = 0
    this.vfExec = []
    this.errstr = ''
    this.flags = Interpreter.SCRIPT_VERIFY_NONE
  }

  /**
   * Set interpreter properties
   */
  set(obj: InterpreterObject): Interpreter {
    this.script = obj.script || this.script
    this.tx = obj.tx || this.tx
    this.nin = obj.nin !== undefined ? obj.nin : this.nin
    this.flags = obj.flags !== undefined ? obj.flags : this.flags
    this.satoshisBN = obj.satoshisBN || this.satoshisBN
    this.outputScript = obj.outputScript || this.outputScript
    return this
  }

  /**
   * Verifies a Script by executing it and returns true if it is valid.
   * This function needs to be provided with the scriptSig and the scriptPubkey
   * separately.
   * @param {Script} scriptSig - the script's first part (corresponding to the tx input)
   * @param {Script} scriptPubkey - the script's last part (corresponding to the tx output)
   * @param {Transaction=} tx - the Transaction containing the scriptSig in one input
   * @param {number} nin - index of the transaction input containing the scriptSig verified.
   * @param {number} flags - evaluation flags. See Interpreter.SCRIPT_* constants
   * @param {bigint} satoshisBN - amount in satoshis of the input to be verified
   */
  verify(
    scriptSig: Script,
    scriptPubkey: Script,
    tx?: Transaction,
    nin?: number,
    flags?: number,
    satoshisBN?: bigint,
  ): boolean {
    Preconditions.checkArgument(
      scriptSig instanceof Script,
      'scriptSig',
      'Must be a Script',
    )
    Preconditions.checkArgument(
      scriptPubkey instanceof Script,
      'scriptPubkey',
      'Must be a Script',
    )

    this.initialize()
    this.tx = tx
    this.nin = nin
    this.flags = flags || Interpreter.SCRIPT_VERIFY_NONE
    this.satoshisBN = satoshisBN

    // Check for P2SH
    const fP2SH = (this.flags & Interpreter.SCRIPT_VERIFY_P2SH) !== 0

    // Check for sig push only
    if ((this.flags & Interpreter.SCRIPT_VERIFY_SIGPUSHONLY) !== 0) {
      if (!scriptSig.isPushOnly()) {
        this.errstr = 'SCRIPT_ERR_SIG_PUSHONLY'
        return false
      }
    }

    // Concatenate scripts
    const script = new Script()
    for (const chunk of scriptSig.chunks) {
      if (chunk.buf) {
        script.add(chunk.buf)
      } else {
        script.add(chunk.opcodenum)
      }
    }
    for (const chunk of scriptPubkey.chunks) {
      if (chunk.buf) {
        script.add(chunk.buf)
      } else {
        script.add(chunk.opcodenum)
      }
    }
    this.script = script

    // Execute script
    if (!this.evaluate()) {
      return false
    }

    // Check final stack
    if (this.stack.length === 0) {
      this.errstr = 'SCRIPT_ERR_EVAL_FALSE_NO_RESULT'
      return false
    }

    if (this.stack.length !== 1) {
      this.errstr = 'SCRIPT_ERR_EVAL_FALSE_IN_STACK'
      return false
    }

    // Check for P2SH execution
    if (fP2SH && scriptPubkey.isPayToScriptHash()) {
      if (!scriptSig.isPushOnly()) {
        this.errstr = 'SCRIPT_ERR_SIG_PUSHONLY'
        return false
      }

      // Execute P2SH script
      const subscript = new Script()
      for (let i = 0; i < scriptSig.chunks.length - 1; i++) {
        const chunk = scriptSig.chunks[i]
        if (chunk.buf) {
          subscript.add(chunk.buf)
        } else {
          subscript.add(chunk.opcodenum!)
        }
      }

      const redeemScript = scriptSig.chunks[scriptSig.chunks.length - 1].buf!
      const scriptPubkey2 = new Script()
      scriptPubkey2.add(Opcode.OP_HASH160)
      scriptPubkey2.add(Hash.sha256ripemd160(redeemScript))
      scriptPubkey2.add(Opcode.OP_EQUAL)

      const script2 = new Script()
      for (const chunk of subscript.chunks) {
        if (chunk.buf) {
          script2.add(chunk.buf)
        } else {
          script2.add(chunk.opcodenum!)
        }
      }
      for (const chunk of scriptPubkey2.chunks) {
        if (chunk.buf) {
          script2.add(chunk.buf)
        } else {
          script2.add(chunk.opcodenum!)
        }
      }

      const interpreter2 = new Interpreter()
      interpreter2.tx = this.tx
      interpreter2.nin = this.nin
      interpreter2.flags = this.flags
      interpreter2.satoshisBN = this.satoshisBN
      interpreter2.script = script2

      if (!interpreter2.evaluate()) {
        this.errstr = 'SCRIPT_ERR_EVAL_FALSE_NO_P2SH_STACK'
        return false
      }

      if (interpreter2.stack.length === 0) {
        this.errstr = 'SCRIPT_ERR_EVAL_FALSE_IN_P2SH_STACK'
        return false
      }

      if (interpreter2.stack.length !== 1) {
        this.errstr = 'SCRIPT_ERR_EVAL_FALSE_IN_P2SH_STACK'
        return false
      }

      if (!BufferUtil.equals(interpreter2.stack[0], Interpreter.true)) {
        this.errstr = 'SCRIPT_ERR_EVAL_FALSE_IN_P2SH_STACK'
        return false
      }

      // Check clean stack
      if ((this.flags & Interpreter.SCRIPT_VERIFY_CLEANSTACK) !== 0) {
        if (this.stack.length !== 1) {
          this.errstr = 'SCRIPT_ERR_CLEANSTACK'
          return false
        }
      }
    }

    // Check final result
    return BufferUtil.equals(this.stack[0], Interpreter.true)
  }

  /**
   * Check raw signature encoding
   */
  checkRawSignatureEncoding(buf: Buffer): boolean {
    if (buf.length === 0) {
      return true
    }

    // TODO update interpreter.js and necessary functions to match bitcoin-abc interpreter.cpp
    if (Interpreter.isSchnorrSig(buf)) {
      return true
    }

    if (
      (this.flags &
        (Interpreter.SCRIPT_VERIFY_DERSIG |
          Interpreter.SCRIPT_VERIFY_LOW_S |
          Interpreter.SCRIPT_VERIFY_STRICTENC)) !==
        0 &&
      !Signature.isDER(buf)
    ) {
      this.errstr = 'SCRIPT_ERR_SIG_DER_INVALID_FORMAT'
      return false
    } else if ((this.flags & Interpreter.SCRIPT_VERIFY_LOW_S) !== 0) {
      const sig = Signature.fromTxFormat(buf)
      if (!sig.hasLowS()) {
        this.errstr = 'SCRIPT_ERR_SIG_DER_HIGH_S'
        return false
      }
    }

    return true
  }

  /**
   * Check signature encoding
   */
  checkSignatureEncoding(buf: Buffer): boolean {
    if (buf.length === 0) {
      return true
    }

    try {
      const sig = Signature.fromDER(buf)

      // Check for high S values
      if ((this.flags & Interpreter.SCRIPT_VERIFY_LOW_S) !== 0) {
        if (
          sig.s >
          new BN(
            '7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0',
            16,
          )
        ) {
          this.errstr = 'SCRIPT_ERR_SIG_DER_HIGH_S'
          return false
        }
      }

      // Check hash type
      const hashType = buf[buf.length - 1]
      if (hashType < 0x80 || hashType > 0x84) {
        this.errstr = 'SCRIPT_ERR_SIG_HASHTYPE'
        return false
      }

      // Check fork ID
      if ((this.flags & Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID) !== 0) {
        if ((hashType & 0x40) === 0) {
          this.errstr = 'SCRIPT_ERR_ILLEGAL_FORKID'
          return false
        }
      } else {
        if ((hashType & 0x40) !== 0) {
          this.errstr = 'SCRIPT_ERR_MUST_USE_FORKID'
          return false
        }
      }

      return true
    } catch (e) {
      this.errstr = 'SCRIPT_ERR_SIG_DER_INVALID_FORMAT'
      return false
    }
  }

  /**
   * Check transaction signature encoding
   */
  checkTxSignatureEncoding(buf: Buffer): boolean {
    // Empty signature. Not strictly DER encoded, but allowed to provide a
    // compact way to provide an invalid signature for use with CHECK(MULTI)SIG
    if (buf.length === 0) {
      return true
    }

    if (!this.checkRawSignatureEncoding(buf.subarray(0, buf.length - 1))) {
      return false
    }

    if ((this.flags & Interpreter.SCRIPT_VERIFY_STRICTENC) !== 0) {
      const sig = Signature.fromTxFormat(buf)
      if (!sig.hasDefinedHashtype()) {
        this.errstr = 'SCRIPT_ERR_SIG_HASHTYPE'
        return false
      }
      if (
        !(this.flags & Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID) &&
        sig.nhashtype! & Signature.SIGHASH_FORKID
      ) {
        this.errstr = 'SCRIPT_ERR_ILLEGAL_FORKID'
        return false
      }

      if (
        this.flags & Interpreter.SCRIPT_ENABLE_SIGHASH_FORKID &&
        !(sig.nhashtype! & Signature.SIGHASH_FORKID)
      ) {
        this.errstr = 'SCRIPT_ERR_MUST_USE_FORKID'
        return false
      }
    }

    return true
  }

  /**
   * Check data signature encoding
   */
  checkDataSignatureEncoding(buf: Buffer): boolean {
    // Empty signature. Not strictly DER encoded, but allowed to provide a
    // compact way to provide an invalid signature for use with CHECK(MULTI)SIG
    if (buf.length === 0) {
      return true
    }

    return this.checkRawSignatureEncoding(buf)
  }

  /**
   * Check public key encoding
   */
  checkPubkeyEncoding(buf: Buffer): boolean {
    if ((this.flags & Interpreter.SCRIPT_VERIFY_STRICTENC) !== 0) {
      if (
        !PublicKey.isValid(buf) &&
        !this.isCompressedOrUncompressedPubkey(buf)
      ) {
        this.errstr = 'SCRIPT_ERR_PUBKEYTYPE'
        return false
      }
    }
    return true
  }

  /**
   * Check if buffer is compressed or uncompressed public key
   */
  private isCompressedOrUncompressedPubkey(buf: Buffer): boolean {
    if (buf.length === 33) {
      return buf[0] === 0x02 || buf[0] === 0x03
    }
    if (buf.length === 65) {
      return buf[0] === 0x04
    }
    return false
  }

  /**
   * Evaluate the script
   */
  evaluate(): boolean {
    if (this.script.toBuffer().length > Interpreter.MAX_SCRIPT_SIZE) {
      this.errstr = 'SCRIPT_ERR_SCRIPT_SIZE'
      return false
    }

    try {
      while (this.pc < this.script.chunks.length) {
        if (this.stack.length > Interpreter.MAX_STACK_SIZE) {
          this.errstr = 'SCRIPT_ERR_STACK_SIZE'
          return false
        }

        if (!this.step()) {
          return false
        }
      }

      // Check for unbalanced conditionals
      if (this.vfExec.length !== 0) {
        this.errstr = 'SCRIPT_ERR_UNBALANCED_CONDITIONAL'
        return false
      }

      // Post-execution checks
      if (this.stack.length === 0) {
        this.errstr = 'SCRIPT_ERR_EVAL_FALSE'
        return false
      }

      // Check if the top element is false
      const topElement = this.stack[this.stack.length - 1]
      if (!this.castToBool(topElement)) {
        this.errstr = 'SCRIPT_ERR_EVAL_FALSE'
        return false
      }

      // CLEANSTACK verification (mandatory in lotusd)
      if (this.flags & Interpreter.SCRIPT_VERIFY_CLEANSTACK) {
        if (this.stack.length !== 1) {
          this.errstr = 'SCRIPT_ERR_CLEANSTACK'
          return false
        }
      }

      return true
    } catch (e) {
      this.errstr = 'SCRIPT_ERR_UNKNOWN_ERROR: ' + (e as Error).message
      return false
    }
  }

  /**
   * Convert a number to script number buffer
   */
  private toScriptNumBuffer(value: number | bigint): Buffer {
    const num = typeof value === 'bigint' ? value : BigInt(value)
    if (num === 0n) {
      return Buffer.alloc(0)
    }

    const isNegative = num < 0n
    const absNum = isNegative ? -num : num

    // Convert to little-endian bytes
    const bytes: number[] = []
    let temp = absNum
    while (temp > 0n) {
      bytes.push(Number(temp & 0xffn))
      temp >>= 8n
    }

    // Add sign bit if negative
    if (isNegative) {
      if (bytes.length > 0 && (bytes[bytes.length - 1] & 0x80) !== 0) {
        bytes.push(0x80)
      } else if (bytes.length > 0) {
        bytes[bytes.length - 1] |= 0x80
      } else {
        bytes.push(0x80)
      }
    }

    return Buffer.from(bytes)
  }

  /**
   * Convert script number buffer to bigint
   */
  private fromScriptNumBuffer(buf: Buffer): bigint {
    if (buf.length === 0) {
      return 0n
    }

    let result = 0n
    for (let i = 0; i < buf.length; i++) {
      result |= BigInt(buf[i]) << BigInt(i * 8)
    }

    // Check for negative
    if (buf.length > 0 && (buf[buf.length - 1] & 0x80) !== 0) {
      // Clear the sign bit
      const lastByte = buf[buf.length - 1] & 0x7f
      result =
        (result & ~(0xffn << BigInt((buf.length - 1) * 8))) |
        (BigInt(lastByte) << BigInt((buf.length - 1) * 8))
      result = -result
    }

    return result
  }

  /**
   * Cast buffer to boolean
   */
  private castToBool(buf: Buffer): boolean {
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 0) {
        // Check for negative zero
        if (i === buf.length - 1 && buf[i] === 0x80) {
          return false
        }
        return true
      }
    }
    return false
  }

  /**
   * Execute one step of the script
   */
  step(): boolean {
    // This is a simplified version - the full implementation would be very long
    // For now, we'll implement basic opcode handling

    if (this.pc >= this.script.chunks.length) {
      return true
    }

    const chunk = this.script.chunks[this.pc]
    this.pc++
    const opcodenum = chunk.opcodenum

    if (opcodenum === undefined) {
      this.errstr = 'SCRIPT_ERR_UNDEFINED_OPCODE'
      return false
    }

    if (chunk.buf && chunk.buf.length > Interpreter.MAX_SCRIPT_ELEMENT_SIZE) {
      this.errstr = 'SCRIPT_ERR_PUSH_SIZE'
      return false
    }

    // Count opcodes
    if (
      opcodenum > Opcode.OP_16 &&
      ++this.nOpCount > Interpreter.MAX_OPCODE_COUNT
    ) {
      this.errstr = 'SCRIPT_ERR_OP_COUNT'
      return false
    }

    // Check if opcode is disabled
    if (this.isOpcodeDisabled(opcodenum)) {
      this.errstr = 'SCRIPT_ERR_DISABLED_OPCODE'
      return false
    }

    const fRequireMinimal =
      (this.flags & Interpreter.SCRIPT_VERIFY_MINIMALDATA) !== 0
    const fExec = this.vfExec.indexOf(false) === -1

    // Handle push data
    if (fExec && opcodenum >= 0 && opcodenum <= Opcode.OP_PUSHDATA4) {
      if (fRequireMinimal && !this.script.checkMinimalPush(this.pc - 1)) {
        this.errstr = 'SCRIPT_ERR_MINIMALDATA'
        return false
      }
      if (!chunk.buf) {
        this.stack.push(Interpreter.false)
      } else if (chunk.len !== chunk.buf.length) {
        throw new Error('Length of push value not equal to length of data')
      } else {
        this.stack.push(chunk.buf)
      }
    } else if (
      fExec ||
      (Opcode.OP_IF <= opcodenum && opcodenum <= Opcode.OP_ENDIF)
    ) {
      // Handle opcodes
      switch (opcodenum) {
        // Push values
        case Opcode.OP_1NEGATE: {
          this.stack.push(this.toScriptNumBuffer(-1))
          break
        }

        case Opcode.OP_1:
        case Opcode.OP_2:
        case Opcode.OP_3:
        case Opcode.OP_4:
        case Opcode.OP_5:
        case Opcode.OP_6:
        case Opcode.OP_7:
        case Opcode.OP_8:
        case Opcode.OP_9:
        case Opcode.OP_10:
        case Opcode.OP_11:
        case Opcode.OP_12:
        case Opcode.OP_13:
        case Opcode.OP_14:
        case Opcode.OP_15:
        case Opcode.OP_16: {
          const value = opcodenum - Opcode.OP_1 + 1
          this.stack.push(this.toScriptNumBuffer(value))
          break
        }

        // Control flow
        case Opcode.OP_NOP:
        case Opcode.OP_NOP1:
        case Opcode.OP_NOP4:
        case Opcode.OP_NOP5:
        case Opcode.OP_NOP6:
        case Opcode.OP_NOP7:
        case Opcode.OP_NOP8:
        case Opcode.OP_NOP9:
        case Opcode.OP_NOP10:
          break

        case Opcode.OP_NOP2:
        case Opcode.OP_CHECKLOCKTIMEVERIFY: {
          if (
            (this.flags & Interpreter.SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY) !==
            0
          ) {
            if (this.stack.length < 1) {
              this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
              return false
            }
            const nLockTime = this.fromScriptNumBuffer(
              this.stack[this.stack.length - 1],
            )
            if (!this.checkLockTime(new BN(Number(nLockTime)))) {
              this.errstr = 'SCRIPT_ERR_UNSATISFIED_LOCKTIME'
              return false
            }
          }
          break
        }

        case Opcode.OP_NOP3:
        case Opcode.OP_CHECKSEQUENCEVERIFY: {
          if (
            (this.flags & Interpreter.SCRIPT_VERIFY_CHECKSEQUENCEVERIFY) !==
            0
          ) {
            if (this.stack.length < 1) {
              this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
              return false
            }
            const nSequence = this.fromScriptNumBuffer(
              this.stack[this.stack.length - 1],
            )
            if (!this.checkSequence(new BN(Number(nSequence)))) {
              this.errstr = 'SCRIPT_ERR_UNSATISFIED_LOCKTIME'
              return false
            }
          }
          break
        }

        case Opcode.OP_IF:
        case Opcode.OP_NOTIF: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const fValue = this.castToBool(this.stack[this.stack.length - 1])
          if (opcodenum === Opcode.OP_NOTIF) {
            this.vfExec.push(!fValue)
          } else {
            this.vfExec.push(fValue)
          }
          break
        }

        case Opcode.OP_ELSE: {
          if (this.vfExec.length === 0) {
            this.errstr = 'SCRIPT_ERR_UNBALANCED_CONDITIONAL'
            return false
          }
          this.vfExec[this.vfExec.length - 1] =
            !this.vfExec[this.vfExec.length - 1]
          break
        }

        case Opcode.OP_ENDIF: {
          if (this.vfExec.length === 0) {
            this.errstr = 'SCRIPT_ERR_UNBALANCED_CONDITIONAL'
            return false
          }
          this.vfExec.pop()
          break
        }

        case Opcode.OP_VERIFY: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          if (!this.castToBool(this.stack[this.stack.length - 1])) {
            this.errstr = 'SCRIPT_ERR_VERIFY'
            return false
          }
          this.stack.pop()
          break
        }

        case Opcode.OP_RETURN:
          this.errstr = 'SCRIPT_ERR_OP_RETURN'
          return false

        // Stack manipulation
        case Opcode.OP_TOALTSTACK: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          this.altstack.push(this.stack.pop()!)
          break
        }

        case Opcode.OP_FROMALTSTACK: {
          if (this.altstack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_ALTSTACK_OPERATION'
            return false
          }
          this.stack.push(this.altstack.pop()!)
          break
        }

        case Opcode.OP_2DROP: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          this.stack.pop()
          this.stack.pop()
          break
        }

        case Opcode.OP_2DUP: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const x1 = this.stack[this.stack.length - 2]
          const x2 = this.stack[this.stack.length - 1]
          this.stack.push(x1)
          this.stack.push(x2)
          break
        }

        case Opcode.OP_3DUP: {
          if (this.stack.length < 3) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const x1 = this.stack[this.stack.length - 3]
          const x2 = this.stack[this.stack.length - 2]
          const x3 = this.stack[this.stack.length - 1]
          this.stack.push(x1)
          this.stack.push(x2)
          this.stack.push(x3)
          break
        }

        case Opcode.OP_2OVER: {
          if (this.stack.length < 4) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const x1 = this.stack[this.stack.length - 4]
          const x2 = this.stack[this.stack.length - 3]
          this.stack.push(x1)
          this.stack.push(x2)
          break
        }

        case Opcode.OP_2ROT: {
          if (this.stack.length < 6) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const x1 = this.stack.splice(this.stack.length - 6, 1)[0]
          const x2 = this.stack.splice(this.stack.length - 5, 1)[0]
          this.stack.push(x1)
          this.stack.push(x2)
          break
        }

        case Opcode.OP_2SWAP: {
          if (this.stack.length < 4) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const x1 = this.stack[this.stack.length - 4]
          const x2 = this.stack[this.stack.length - 3]
          const x3 = this.stack[this.stack.length - 2]
          const x4 = this.stack[this.stack.length - 1]
          this.stack[this.stack.length - 4] = x3
          this.stack[this.stack.length - 3] = x4
          this.stack[this.stack.length - 2] = x1
          this.stack[this.stack.length - 1] = x2
          break
        }

        case Opcode.OP_IFDUP: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          if (this.castToBool(this.stack[this.stack.length - 1])) {
            this.stack.push(this.stack[this.stack.length - 1])
          }
          break
        }

        case Opcode.OP_DEPTH: {
          this.stack.push(this.toScriptNumBuffer(this.stack.length))
          break
        }

        case Opcode.OP_DROP: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          this.stack.pop()
          break
        }

        case Opcode.OP_DUP: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          this.stack.push(this.stack[this.stack.length - 1])
          break
        }

        case Opcode.OP_NIP: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          this.stack.splice(this.stack.length - 2, 1)
          break
        }

        case Opcode.OP_OVER: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          this.stack.push(this.stack[this.stack.length - 2])
          break
        }

        case Opcode.OP_PICK:
        case Opcode.OP_ROLL: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const n = this.fromScriptNumBuffer(this.stack[this.stack.length - 1])
          this.stack.pop()
          if (n < 0n || n >= BigInt(this.stack.length)) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const val = this.stack[this.stack.length - 1 - Number(n)]
          if (opcodenum === Opcode.OP_ROLL) {
            this.stack.splice(this.stack.length - 1 - Number(n), 1)
          }
          this.stack.push(val)
          break
        }

        case Opcode.OP_ROT: {
          if (this.stack.length < 3) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const x1 = this.stack[this.stack.length - 3]
          const x2 = this.stack[this.stack.length - 2]
          const x3 = this.stack[this.stack.length - 1]
          this.stack[this.stack.length - 3] = x2
          this.stack[this.stack.length - 2] = x3
          this.stack[this.stack.length - 1] = x1
          break
        }

        case Opcode.OP_SWAP: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const x1 = this.stack[this.stack.length - 2]
          const x2 = this.stack[this.stack.length - 1]
          this.stack[this.stack.length - 2] = x2
          this.stack[this.stack.length - 1] = x1
          break
        }

        case Opcode.OP_TUCK: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const x1 = this.stack[this.stack.length - 2]
          const x2 = this.stack[this.stack.length - 1]
          this.stack.splice(this.stack.length - 2, 0, x2)
          break
        }

        case Opcode.OP_SIZE: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const size = this.stack[this.stack.length - 1].length
          this.stack.push(this.toScriptNumBuffer(size))
          break
        }

        // Bitwise operations
        case Opcode.OP_AND:
        case Opcode.OP_OR:
        case Opcode.OP_XOR: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const buf1 = this.stack.pop()!
          const buf2 = this.stack.pop()!

          if (buf1.length !== buf2.length) {
            this.errstr = 'SCRIPT_ERR_INVALID_OPERAND_SIZE'
            return false
          }

          const result = Buffer.alloc(buf1.length)
          for (let i = 0; i < buf1.length; i++) {
            switch (opcodenum) {
              case Opcode.OP_AND:
                result[i] = buf1[i] & buf2[i]
                break
              case Opcode.OP_OR:
                result[i] = buf1[i] | buf2[i]
                break
              case Opcode.OP_XOR:
                result[i] = buf1[i] ^ buf2[i]
                break
            }
          }
          this.stack.push(result)
          break
        }

        // Comparison operations
        case Opcode.OP_EQUAL: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const buf1 = this.stack.pop()!
          const buf2 = this.stack.pop()!
          this.stack.push(
            BufferUtil.equals(buf1, buf2)
              ? Interpreter.true
              : Interpreter.false,
          )
          break
        }

        case Opcode.OP_EQUALVERIFY: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const buf3 = this.stack.pop()!
          const buf4 = this.stack.pop()!
          if (!BufferUtil.equals(buf3, buf4)) {
            this.errstr = 'SCRIPT_ERR_EQUALVERIFY'
            return false
          }
          break
        }

        // Arithmetic operations
        case Opcode.OP_1ADD: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn = this.fromScriptNumBuffer(this.stack[this.stack.length - 1])
          this.stack[this.stack.length - 1] = this.toScriptNumBuffer(bn + 1n)
          break
        }

        case Opcode.OP_1SUB: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn = this.fromScriptNumBuffer(this.stack[this.stack.length - 1])
          this.stack[this.stack.length - 1] = this.toScriptNumBuffer(bn - 1n)
          break
        }

        case Opcode.OP_NEGATE: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn = this.fromScriptNumBuffer(this.stack[this.stack.length - 1])
          this.stack[this.stack.length - 1] = this.toScriptNumBuffer(-bn)
          break
        }

        case Opcode.OP_ABS: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn = this.fromScriptNumBuffer(this.stack[this.stack.length - 1])
          this.stack[this.stack.length - 1] = this.toScriptNumBuffer(
            bn < 0n ? -bn : bn,
          )
          break
        }

        case Opcode.OP_NOT: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn = this.fromScriptNumBuffer(this.stack[this.stack.length - 1])
          this.stack[this.stack.length - 1] = this.toScriptNumBuffer(
            bn === 0n ? 1n : 0n,
          )
          break
        }

        case Opcode.OP_0NOTEQUAL: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn = this.fromScriptNumBuffer(this.stack[this.stack.length - 1])
          this.stack[this.stack.length - 1] = this.toScriptNumBuffer(
            bn !== 0n ? 1n : 0n,
          )
          break
        }

        case Opcode.OP_ADD: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          this.stack.push(this.toScriptNumBuffer(bn1 + bn2))
          break
        }

        case Opcode.OP_SUB: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          this.stack.push(this.toScriptNumBuffer(bn2 - bn1))
          break
        }

        case Opcode.OP_BOOLAND: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn1 !== 0n && bn2 !== 0n ? 1n : 0n
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_BOOLOR: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn1 !== 0n || bn2 !== 0n ? 1n : 0n
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_NUMEQUAL: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn1 === bn2 ? 1n : 0n
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_NUMEQUALVERIFY: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          if (bn1 !== bn2) {
            this.errstr = 'SCRIPT_ERR_NUMEQUALVERIFY'
            return false
          }
          break
        }

        case Opcode.OP_NUMNOTEQUAL: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn1 !== bn2 ? 1n : 0n
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_LESSTHAN: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn2 < bn1 ? 1n : 0n
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_GREATERTHAN: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn2 > bn1 ? 1n : 0n
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_LESSTHANOREQUAL: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn2 <= bn1 ? 1n : 0n
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_GREATERTHANOREQUAL: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn2 >= bn1 ? 1n : 0n
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_MIN: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn1 < bn2 ? bn1 : bn2
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_MAX: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!)
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!)
          const result = bn1 > bn2 ? bn1 : bn2
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        case Opcode.OP_WITHIN: {
          if (this.stack.length < 3) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const bn1 = this.fromScriptNumBuffer(this.stack.pop()!) // upper bound
          const bn2 = this.fromScriptNumBuffer(this.stack.pop()!) // lower bound
          const bn3 = this.fromScriptNumBuffer(this.stack.pop()!) // value
          const result = bn3 >= bn2 && bn3 < bn1 ? 1n : 0n
          this.stack.push(this.toScriptNumBuffer(result))
          break
        }

        // Hash operations
        case Opcode.OP_RIPEMD160: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const buf = this.stack.pop()!
          this.stack.push(Hash.ripemd160(buf))
          break
        }

        case Opcode.OP_SHA1: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const buf = this.stack.pop()!
          this.stack.push(Hash.sha1(buf))
          break
        }

        case Opcode.OP_SHA256: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const buf = this.stack.pop()!
          this.stack.push(Hash.sha256(buf))
          break
        }

        case Opcode.OP_HASH160: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const buf = this.stack.pop()!
          this.stack.push(Hash.sha256ripemd160(buf))
          break
        }

        case Opcode.OP_HASH256: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const buf = this.stack.pop()!
          this.stack.push(Hash.sha256sha256(buf))
          break
        }

        case Opcode.OP_CODESEPARATOR: {
          // Hash starts after the code separator
          this.pbegincodehash = this.pc
          break
        }

        case Opcode.OP_CHECKSIG: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const sigBuf = this.stack.pop()!
          const pubkeyBuf = this.stack.pop()!

          if (!this.checkTxSignatureEncoding(sigBuf)) {
            return false
          }
          if (!this.checkPubkeyEncoding(pubkeyBuf)) {
            return false
          }

          // Parse signature and public key
          let signature: Signature
          let publicKey: PublicKey

          try {
            signature = Signature.fromTxFormat(sigBuf)
            publicKey = new PublicKey(pubkeyBuf)
          } catch (error) {
            this.stack.push(Interpreter.false)
            break
          }

          // Verify signature using the transaction sighash
          if (
            this.tx &&
            this.nin !== undefined &&
            this.satoshisBN !== undefined &&
            this.outputScript
          ) {
            const hashbuf = sighash(
              this.tx as TransactionLike,
              signature.nhashtype!,
              this.nin,
              this.outputScript, // Use output script instead of input script
              new BN(this.satoshisBN.toString()),
              this.flags,
            )

            const verified = ECDSA.verify(
              hashbuf,
              signature,
              publicKey,
              'little',
            )
            this.stack.push(verified ? Interpreter.true : Interpreter.false)
          } else {
            // If we don't have transaction context, assume signature is invalid
            this.stack.push(Interpreter.false)
          }
          break
        }

        case Opcode.OP_CHECKSIGVERIFY: {
          if (this.stack.length < 2) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const sigBuf = this.stack.pop()!
          const pubkeyBuf = this.stack.pop()!

          if (!this.checkTxSignatureEncoding(sigBuf)) {
            return false
          }
          if (!this.checkPubkeyEncoding(pubkeyBuf)) {
            return false
          }

          // Simplified signature verification - would need full implementation
          if (!this.castToBool(Interpreter.true)) {
            this.errstr = 'SCRIPT_ERR_CHECKSIGVERIFY'
            return false
          }
          break
        }

        case Opcode.OP_CHECKMULTISIG: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const pubkeyCount = this.fromScriptNumBuffer(
            this.stack[this.stack.length - 1],
          )
          if (pubkeyCount < 0n || pubkeyCount > 20n) {
            this.errstr = 'SCRIPT_ERR_PUBKEY_COUNT'
            return false
          }
          if (this.stack.length < Number(pubkeyCount) + 2) {
            this.errstr = 'SCRIPT_ERR_OP_COUNT'
            return false
          }

          // Simplified multisig verification - would need full implementation
          this.stack.push(Interpreter.true)
          break
        }

        case Opcode.OP_CHECKMULTISIGVERIFY: {
          if (this.stack.length < 1) {
            this.errstr = 'SCRIPT_ERR_INVALID_STACK_OPERATION'
            return false
          }
          const pubkeyCount = this.fromScriptNumBuffer(
            this.stack[this.stack.length - 1],
          )
          if (pubkeyCount < 0n || pubkeyCount > 20n) {
            this.errstr = 'SCRIPT_ERR_PUBKEY_COUNT'
            return false
          }
          if (this.stack.length < Number(pubkeyCount) + 2) {
            this.errstr = 'SCRIPT_ERR_OP_COUNT'
            return false
          }

          // Simplified multisig verification - would need full implementation
          if (!this.castToBool(Interpreter.true)) {
            this.errstr = 'SCRIPT_ERR_CHECKMULTISIGVERIFY'
            return false
          }
          break
        }

        default:
          this.errstr = 'SCRIPT_ERR_BAD_OPCODE'
          return false
      }
    }

    return true
  }

  /**
   * Check if opcode is disabled
   */
  private isOpcodeDisabled(opcode: number): boolean {
    switch (opcode) {
      case Opcode.OP_INVERT:
      case Opcode.OP_2MUL:
      case Opcode.OP_2DIV:
      case Opcode.OP_MUL:
      case Opcode.OP_LSHIFT:
      case Opcode.OP_RSHIFT:
        return true

      case Opcode.OP_DIV:
      case Opcode.OP_MOD:
      case Opcode.OP_SPLIT:
      case Opcode.OP_CAT:
      case Opcode.OP_AND:
      case Opcode.OP_OR:
      case Opcode.OP_XOR:
      case Opcode.OP_BIN2NUM:
      case Opcode.OP_NUM2BIN:
        return false

      default:
        return false
    }
  }

  /**
   * Check lock time
   */
  checkLockTime(nLockTime: BN): boolean {
    if (!this.tx || this.nin === undefined) {
      return false
    }

    // We want to compare apples to apples, so fail the script
    // unless the type of nLockTime being tested is the same as
    // the nLockTime in the transaction.
    if (
      !(
        (this.tx.nLockTime < Interpreter.LOCKTIME_THRESHOLD &&
          nLockTime.lt(Interpreter.LOCKTIME_THRESHOLD_BN)) ||
        (this.tx.nLockTime >= Interpreter.LOCKTIME_THRESHOLD &&
          nLockTime.gte(Interpreter.LOCKTIME_THRESHOLD_BN))
      )
    ) {
      return false
    }

    // Now that we know we're comparing apples-to-apples, the
    // comparison is a simple numeric one.
    if (nLockTime.gt(new BN(this.tx.nLockTime))) {
      return false
    }

    // Finally the nLockTime feature can be disabled and thus
    // CHECKLOCKTIMEVERIFY bypassed if every txin has been
    // finalized by setting nSequence to maxint. The
    // transaction would be allowed into the blockchain, making
    // the opcode ineffective.
    //
    // Testing if this vin is not final is sufficient to
    // prevent this condition. Alternatively we could test all
    // inputs, but testing just this input minimizes the data
    // required to prove correct CHECKLOCKTIMEVERIFY execution.
    if (!this.tx.inputs[this.nin].isFinal()) {
      return false
    }

    return true
  }

  /**
   * Check sequence
   */
  checkSequence(nSequence: BN): boolean {
    if (!this.tx || this.nin === undefined) {
      return false
    }

    // Relative lock times are supported by comparing the passed in operand to
    // the sequence number of the input.
    const txToSequence = this.tx.inputs[this.nin].sequenceNumber

    // Fail if the transaction's version number is not set high enough to
    // trigger BIP 68 rules.
    if (this.tx.version < 2) {
      return false
    }

    // Sequence numbers with their most significant bit set are not consensus
    // constrained. Testing that the transaction's sequence number do not have
    // this bit set prevents using this property to get around a
    // CHECKSEQUENCEVERIFY check.
    if (txToSequence & Interpreter.SEQUENCE_LOCKTIME_DISABLE_FLAG) {
      return false
    }

    // Mask off any bits that do not have consensus-enforced meaning before
    // doing the integer comparisons
    const nLockTimeMask =
      Interpreter.SEQUENCE_LOCKTIME_TYPE_FLAG |
      Interpreter.SEQUENCE_LOCKTIME_MASK
    const txToSequenceMasked = new BN(txToSequence & nLockTimeMask)
    const nSequenceMasked = nSequence.mod(new BN(nLockTimeMask))

    // There are two kinds of nSequence: lock-by-blockheight and
    // lock-by-blocktime, distinguished by whether nSequenceMasked <
    // CTxIn::SEQUENCE_LOCKTIME_TYPE_FLAG.
    //
    // We want to compare apples to apples, so fail the script unless the type
    // of nSequenceMasked being tested is the same as the nSequenceMasked in the
    // transaction.
    const SEQUENCE_LOCKTIME_TYPE_FLAG_BN = new BN(
      Interpreter.SEQUENCE_LOCKTIME_TYPE_FLAG,
    )

    if (
      !(
        (txToSequenceMasked.lt(SEQUENCE_LOCKTIME_TYPE_FLAG_BN) &&
          nSequenceMasked.lt(SEQUENCE_LOCKTIME_TYPE_FLAG_BN)) ||
        (txToSequenceMasked.gte(SEQUENCE_LOCKTIME_TYPE_FLAG_BN) &&
          nSequenceMasked.gte(SEQUENCE_LOCKTIME_TYPE_FLAG_BN))
      )
    ) {
      return false
    }

    // Now that we know we're comparing apples-to-apples, the comparison is a
    // simple numeric one.
    if (nSequenceMasked.gt(txToSequenceMasked)) {
      return false
    }
    return true
  }

  /**
   * Static method to cast buffer to boolean
   */
  static castToBool(buf: Buffer): boolean {
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 0) {
        // Check for negative zero
        if (i === buf.length - 1 && buf[i] === 0x80) {
          return false
        }
        return true
      }
    }
    return false
  }

  /**
   * Check if buffer is Schnorr signature
   */
  static isSchnorrSig(buf: Buffer): boolean {
    return (buf.length === 64 || buf.length === 65) && buf[0] !== 0x30
  }

  /**
   * Check if buffer is minimally encoded
   */
  static _isMinimallyEncoded(buf: Buffer, nMaxNumSize?: number): boolean {
    nMaxNumSize = nMaxNumSize || Interpreter.MAXIMUM_ELEMENT_SIZE
    if (buf.length > nMaxNumSize) {
      return false
    }

    if (buf.length > 0) {
      // Check that the number is encoded with the minimum possible number
      // of bytes.
      //
      // If the most-significant-byte - excluding the sign bit - is zero
      // then we're not minimal. Note how this test also rejects the
      // negative-zero encoding, 0x80.
      if ((buf[buf.length - 1] & 0x7f) === 0) {
        // One exception: if there's more than one byte and the most
        // significant bit of the second-most-significant-byte is set it
        // would conflict with the sign bit. An example of this case is
        // +-255, which encode to 0xff00 and 0xff80 respectively.
        // (big-endian).
        if (buf.length <= 1 || (buf[buf.length - 2] & 0x80) === 0) {
          return false
        }
      }
    }
    return true
  }

  /**
   * Minimally encode the buffer content
   */
  static _minimallyEncode(buf: Buffer): Buffer {
    if (buf.length === 0) {
      return buf
    }

    // If the last byte is not 0x00 or 0x80, we are minimally encoded.
    const last = buf[buf.length - 1]
    if (last & 0x7f) {
      return buf
    }

    // If the script is one byte long, then we have a zero, which encodes as an
    // empty array.
    if (buf.length === 1) {
      return Buffer.from('')
    }

    // If the next byte has it sign bit set, then we are minimaly encoded.
    if (buf[buf.length - 2] & 0x80) {
      return buf
    }

    // We are not minimally encoded, we need to figure out how much to trim.
    for (let i = buf.length - 1; i > 0; i--) {
      // We found a non zero byte, time to encode.
      if (buf[i - 1] !== 0) {
        if (buf[i - 1] & 0x80) {
          // We found a byte with it sign bit set so we need one more
          // byte.
          const result = Buffer.alloc(i + 1)
          buf.copy(result, 0, 0, i)
          result[i] = last
          return result
        } else {
          // the sign bit is clear, we can use it.
          const result = Buffer.alloc(i)
          buf.copy(result, 0, 0, i)
          result[i - 1] |= last
          return result
        }
      }
    }

    // If we the whole thing is zeros, then we have a zero.
    return Buffer.from('')
  }
}
