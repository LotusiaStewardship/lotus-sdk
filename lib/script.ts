/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */
import OpCode from './opcode'

/**
 * Check provided script for OP_RETURN op code
 * @param script - The script to check, as a `Buffer`
 * @returns true if the output is an OP_RETURN, false otherwise
 */
export function isOpReturn(script: Buffer | undefined): boolean {
  return script ? script.readUInt8(0) === OpCode.OP_RETURN : false
}
