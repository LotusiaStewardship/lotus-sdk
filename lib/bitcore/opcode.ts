/**
 * Opcode implementation for Lotus
 * Migrated from bitcore-lib-xpi with ESM support
 */

import { Preconditions } from './util/preconditions.js'
import { JSUtil } from './util/js.js'

export interface OpcodeData {
  num: number
}

export class Opcode {
  readonly num!: number

  constructor(num: number | string) {
    if (typeof num === 'number') {
      JSUtil.defineImmutable(this, { num })
    } else if (typeof num === 'string') {
      const value = Opcode.map[num as keyof typeof Opcode.map]
      if (value === undefined) {
        throw new Error(`Unknown opcode: ${num}`)
      }
      JSUtil.defineImmutable(this, { num: value })
    } else {
      throw new TypeError(`Unrecognized num type: "${typeof num}" for Opcode`)
    }
  }

  static fromBuffer(buf: Buffer): Opcode {
    Preconditions.checkArgument(Buffer.isBuffer(buf), 'buf', 'Must be a Buffer')
    Preconditions.checkArgument(buf.length > 0, 'buf', 'Buffer cannot be empty')
    return new Opcode(buf[0])
  }

  toBuffer(): Buffer {
    return Buffer.from([this.num])
  }

  toString(): string {
    return this.num.toString()
  }

  // Opcode constants
  static readonly OP_0 = 0
  static readonly OP_FALSE = 0
  static readonly OP_PUSHDATA1 = 76
  static readonly OP_PUSHDATA2 = 77
  static readonly OP_PUSHDATA4 = 78
  static readonly OP_1NEGATE = 79
  static readonly OP_RESERVED = 80
  static readonly OP_1 = 81
  static readonly OP_TRUE = 81
  static readonly OP_2 = 82
  static readonly OP_3 = 83
  static readonly OP_4 = 84
  static readonly OP_5 = 85
  static readonly OP_6 = 86
  static readonly OP_7 = 87
  static readonly OP_8 = 88
  static readonly OP_9 = 89
  static readonly OP_10 = 90
  static readonly OP_11 = 91
  static readonly OP_12 = 92
  static readonly OP_13 = 93
  static readonly OP_14 = 94
  static readonly OP_15 = 95
  static readonly OP_16 = 96

  // Control
  static readonly OP_NOP = 97
  static readonly OP_VER = 98
  static readonly OP_IF = 99
  static readonly OP_NOTIF = 100
  static readonly OP_VERIF = 101
  static readonly OP_VERNOTIF = 102
  static readonly OP_ELSE = 103
  static readonly OP_ENDIF = 104
  static readonly OP_VERIFY = 105
  static readonly OP_RETURN = 106

  // Stack ops
  static readonly OP_TOALTSTACK = 107
  static readonly OP_FROMALTSTACK = 108
  static readonly OP_2DROP = 109
  static readonly OP_2DUP = 110
  static readonly OP_3DUP = 111
  static readonly OP_2OVER = 112
  static readonly OP_2ROT = 113
  static readonly OP_2SWAP = 114
  static readonly OP_IFDUP = 115
  static readonly OP_DEPTH = 116
  static readonly OP_DROP = 117
  static readonly OP_DUP = 118
  static readonly OP_NIP = 119
  static readonly OP_OVER = 120
  static readonly OP_PICK = 121
  static readonly OP_ROLL = 122
  static readonly OP_ROT = 123
  static readonly OP_SWAP = 124
  static readonly OP_TUCK = 125

  // Splice ops
  static readonly OP_CAT = 126
  static readonly OP_SPLIT = 127
  static readonly OP_NUM2BIN = 128
  static readonly OP_BIN2NUM = 129
  static readonly OP_SIZE = 130

  // Bit logic
  static readonly OP_INVERT = 131
  static readonly OP_AND = 132
  static readonly OP_OR = 133
  static readonly OP_XOR = 134
  static readonly OP_EQUAL = 135
  static readonly OP_EQUALVERIFY = 136
  static readonly OP_RESERVED1 = 137
  static readonly OP_RESERVED2 = 138

  // Numeric
  static readonly OP_1ADD = 139
  static readonly OP_1SUB = 140
  static readonly OP_2MUL = 141
  static readonly OP_2DIV = 142
  static readonly OP_NEGATE = 143
  static readonly OP_ABS = 144
  static readonly OP_NOT = 145
  static readonly OP_0NOTEQUAL = 146
  static readonly OP_ADD = 147
  static readonly OP_SUB = 148
  static readonly OP_MUL = 149
  static readonly OP_DIV = 150
  static readonly OP_MOD = 151
  static readonly OP_LSHIFT = 152
  static readonly OP_RSHIFT = 153
  static readonly OP_BOOLAND = 154
  static readonly OP_BOOLOR = 155
  static readonly OP_NUMEQUAL = 156
  static readonly OP_NUMEQUALVERIFY = 157
  static readonly OP_NUMNOTEQUAL = 158
  static readonly OP_LESSTHAN = 159
  static readonly OP_GREATERTHAN = 160
  static readonly OP_LESSTHANOREQUAL = 161
  static readonly OP_GREATERTHANOREQUAL = 162
  static readonly OP_MIN = 163
  static readonly OP_MAX = 164
  static readonly OP_WITHIN = 165

  // Crypto
  static readonly OP_RIPEMD160 = 166
  static readonly OP_SHA1 = 167
  static readonly OP_SHA256 = 168
  static readonly OP_HASH160 = 169
  static readonly OP_HASH256 = 170
  static readonly OP_CODESEPARATOR = 171
  static readonly OP_CHECKSIG = 172
  static readonly OP_CHECKSIGVERIFY = 173
  static readonly OP_CHECKMULTISIG = 174
  static readonly OP_CHECKMULTISIGVERIFY = 175

  // Expansion
  static readonly OP_NOP1 = 176
  static readonly OP_CHECKLOCKTIMEVERIFY = 177
  static readonly OP_NOP2 = 177
  static readonly OP_CHECKSEQUENCEVERIFY = 178
  static readonly OP_NOP3 = 178
  static readonly OP_NOP4 = 179
  static readonly OP_NOP5 = 180
  static readonly OP_NOP6 = 181
  static readonly OP_NOP7 = 182
  static readonly OP_NOP8 = 183
  static readonly OP_NOP9 = 184
  static readonly OP_NOP10 = 185

  // Opcode map for string lookup
  static readonly map = {
    OP_0: 0,
    OP_FALSE: 0,
    OP_PUSHDATA1: 76,
    OP_PUSHDATA2: 77,
    OP_PUSHDATA4: 78,
    OP_1NEGATE: 79,
    OP_RESERVED: 80,
    OP_1: 81,
    OP_TRUE: 81,
    OP_2: 82,
    OP_3: 83,
    OP_4: 84,
    OP_5: 85,
    OP_6: 86,
    OP_7: 87,
    OP_8: 88,
    OP_9: 89,
    OP_10: 90,
    OP_11: 91,
    OP_12: 92,
    OP_13: 93,
    OP_14: 94,
    OP_15: 95,
    OP_16: 96,
    OP_NOP: 97,
    OP_VER: 98,
    OP_IF: 99,
    OP_NOTIF: 100,
    OP_VERIF: 101,
    OP_VERNOTIF: 102,
    OP_ELSE: 103,
    OP_ENDIF: 104,
    OP_VERIFY: 105,
    OP_RETURN: 106,
    OP_TOALTSTACK: 107,
    OP_FROMALTSTACK: 108,
    OP_2DROP: 109,
    OP_2DUP: 110,
    OP_3DUP: 111,
    OP_2OVER: 112,
    OP_2ROT: 113,
    OP_2SWAP: 114,
    OP_IFDUP: 115,
    OP_DEPTH: 116,
    OP_DROP: 117,
    OP_DUP: 118,
    OP_NIP: 119,
    OP_OVER: 120,
    OP_PICK: 121,
    OP_ROLL: 122,
    OP_ROT: 123,
    OP_SWAP: 124,
    OP_TUCK: 125,
    OP_CAT: 126,
    OP_SPLIT: 127,
    OP_NUM2BIN: 128,
    OP_BIN2NUM: 129,
    OP_SIZE: 130,
    OP_INVERT: 131,
    OP_AND: 132,
    OP_OR: 133,
    OP_XOR: 134,
    OP_EQUAL: 135,
    OP_EQUALVERIFY: 136,
    OP_RESERVED1: 137,
    OP_RESERVED2: 138,
    OP_1ADD: 139,
    OP_1SUB: 140,
    OP_2MUL: 141,
    OP_2DIV: 142,
    OP_NEGATE: 143,
    OP_ABS: 144,
    OP_NOT: 145,
    OP_0NOTEQUAL: 146,
    OP_ADD: 147,
    OP_SUB: 148,
    OP_MUL: 149,
    OP_DIV: 150,
    OP_MOD: 151,
    OP_LSHIFT: 152,
    OP_RSHIFT: 153,
    OP_BOOLAND: 154,
    OP_BOOLOR: 155,
    OP_NUMEQUAL: 156,
    OP_NUMEQUALVERIFY: 157,
    OP_NUMNOTEQUAL: 158,
    OP_LESSTHAN: 159,
    OP_GREATERTHAN: 160,
    OP_LESSTHANOREQUAL: 161,
    OP_GREATERTHANOREQUAL: 162,
    OP_MIN: 163,
    OP_MAX: 164,
    OP_WITHIN: 165,
    OP_RIPEMD160: 166,
    OP_SHA1: 167,
    OP_SHA256: 168,
    OP_HASH160: 169,
    OP_HASH256: 170,
    OP_CODESEPARATOR: 171,
    OP_CHECKSIG: 172,
    OP_CHECKSIGVERIFY: 173,
    OP_CHECKMULTISIG: 174,
    OP_CHECKMULTISIGVERIFY: 175,
    OP_NOP1: 176,
    OP_CHECKLOCKTIMEVERIFY: 177,
    OP_NOP2: 177,
    OP_CHECKSEQUENCEVERIFY: 178,
    OP_NOP3: 178,
    OP_NOP4: 179,
    OP_NOP5: 180,
    OP_NOP6: 181,
    OP_NOP7: 182,
    OP_NOP8: 183,
    OP_NOP9: 184,
    OP_NOP10: 185,
  } as const
}
