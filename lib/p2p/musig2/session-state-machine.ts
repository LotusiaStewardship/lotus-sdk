/**
 * Copyright 2025 The Lotusia Stewardship
 * Github: https://github.com/LotusiaStewardship
 * License: MIT
 */

/**
 * MuSig2 Session State Machine
 *
 * Phase 2 of the MuSig2 Protocol Refactoring Plan:
 * Implements a deterministic state machine that manages session phase transitions
 * with validation and consistency guarantees.
 *
 * This state machine is a WRAPPER around MuSigSession objects - it directly manages
 * the `session.phase` property rather than maintaining separate state tracking.
 * This ensures a single source of truth for session state.
 *
 * @module SessionStateMachine
 */

import { EventEmitter } from 'events'
import {
  MuSigSession,
  MuSigSessionPhase,
} from '../../bitcore/musig2/session.js'

/**
 * State transition event data
 */
export interface StateTransitionEvent {
  sessionId: string
  fromState: MuSigSessionPhase
  toState: MuSigSessionPhase
  reason: string
  timestamp: number
}

/**
 * Session State Machine
 *
 * Manages MuSig2 session phase transitions with validation.
 * Wraps a MuSigSession object and manages its `phase` property directly.
 *
 * Key Features:
 * - Validates all state transitions against protocol rules
 * - Prevents invalid state transitions
 * - Emits events on state changes for monitoring/debugging
 * - Single source of truth - manages session.phase directly
 *
 * Usage:
 * ```typescript
 * const session = sessionManager.createSession(...)
 * const stateMachine = new SessionStateMachine(session)
 *
 * // Transition to next state (validates automatically)
 * stateMachine.transition(MuSigSessionPhase.NONCE_EXCHANGE, 'Starting Round 1')
 *
 * // Check if transition is valid before attempting
 * if (stateMachine.canTransitionTo(MuSigSessionPhase.PARTIAL_SIG_EXCHANGE)) {
 *   stateMachine.transition(MuSigSessionPhase.PARTIAL_SIG_EXCHANGE, 'All nonces received')
 * }
 *
 * // Get current state (reads session.phase)
 * const currentPhase = stateMachine.state
 * ```
 */
export class SessionStateMachine extends EventEmitter {
  /**
   * Reference to the MuSigSession being managed
   * The state machine directly modifies session.phase
   */
  private session: MuSigSession

  /**
   * Valid state transitions for the MuSig2 protocol
   *
   * State flow:
   * 1. INIT - Session created, waiting to start Round 1
   * 2. NONCE_EXCHANGE - Round 1 in progress (collecting nonces)
   * 3. PARTIAL_SIG_EXCHANGE - Round 2 in progress (collecting partial sigs)
   * 4. COMPLETE - Signature aggregated successfully
   * 5. ABORTED - Session aborted due to error/timeout
   *
   * Terminal states: COMPLETE, ABORTED
   */
  private readonly validTransitions: Record<
    MuSigSessionPhase,
    MuSigSessionPhase[]
  > = {
    [MuSigSessionPhase.INIT]: [
      MuSigSessionPhase.NONCE_EXCHANGE,
      MuSigSessionPhase.ABORTED,
    ],
    [MuSigSessionPhase.NONCE_EXCHANGE]: [
      MuSigSessionPhase.PARTIAL_SIG_EXCHANGE,
      MuSigSessionPhase.ABORTED,
    ],
    [MuSigSessionPhase.PARTIAL_SIG_EXCHANGE]: [
      MuSigSessionPhase.COMPLETE,
      MuSigSessionPhase.ABORTED,
    ],
    [MuSigSessionPhase.COMPLETE]: [], // Terminal state
    [MuSigSessionPhase.ABORTED]: [], // Terminal state
  }

  /**
   * Create a new state machine for a MuSigSession
   *
   * @param session - The MuSigSession to manage
   */
  constructor(session: MuSigSession) {
    super()
    this.session = session

    // Validate initial state
    if (!this.isValidState(session.phase)) {
      throw new Error(
        `Invalid initial phase for session ${session.sessionId}: ${session.phase}`,
      )
    }
  }

  /**
   * Get the current state of the session
   * Reads directly from session.phase
   *
   * @returns Current phase of the session
   */
  get state(): MuSigSessionPhase {
    return this.session.phase
  }

  /**
   * Get the session ID
   *
   * @returns Session identifier
   */
  get sessionId(): string {
    return this.session.sessionId
  }

  /**
   * Check if a state is valid in the MuSig2 protocol
   *
   * @param state - State to validate
   * @returns True if state is valid
   */
  private isValidState(state: MuSigSessionPhase): boolean {
    return state in this.validTransitions
  }

  /**
   * Check if a state transition is valid
   *
   * @param toState - Target state
   * @returns True if transition is allowed from current state
   */
  canTransitionTo(toState: MuSigSessionPhase): boolean {
    const currentState = this.session.phase
    return this.validTransitions[currentState]?.includes(toState) ?? false
  }

  /**
   * Check if the session is in a terminal state
   * Terminal states: COMPLETE, ABORTED
   *
   * @returns True if session cannot transition to any other state
   */
  isTerminal(): boolean {
    return this.validTransitions[this.session.phase].length === 0
  }

  /**
   * Transition the session to a new phase
   *
   * This is the ONLY way to change session.phase when using the state machine.
   * Validates the transition and updates session.phase directly.
   *
   * @param toState - Target phase
   * @param reason - Reason for the transition (for logging/debugging)
   * @throws Error if transition is invalid
   */
  transition(toState: MuSigSessionPhase, reason?: string): void {
    const fromState = this.session.phase

    // Validate transition
    if (!this.canTransitionTo(toState)) {
      const allowedStates = this.validTransitions[fromState].join(', ')
      throw new Error(
        `Invalid state transition for session ${this.session.sessionId}: ` +
          `${fromState} -> ${toState}. ` +
          `Allowed transitions from ${fromState}: [${allowedStates}]. ` +
          `Reason: ${reason || 'no reason provided'}`,
      )
    }

    // Update session phase
    this.session.phase = toState
    this.session.updatedAt = Date.now()

    // Set abort reason if transitioning to ABORTED
    if (toState === MuSigSessionPhase.ABORTED && reason) {
      this.session.abortReason = reason
    }

    // Emit state change event
    const event: StateTransitionEvent = {
      sessionId: this.session.sessionId,
      fromState,
      toState,
      reason: reason || 'state transition',
      timestamp: this.session.updatedAt,
    }

    this.emit('stateChanged', event)
  }

  /**
   * Get a list of valid next states from the current state
   *
   * @returns Array of valid next states
   */
  getValidNextStates(): MuSigSessionPhase[] {
    return [...this.validTransitions[this.session.phase]]
  }

  /**
   * Get a human-readable description of the current state
   *
   * @returns State description
   */
  getStateDescription(): string {
    const descriptions: Record<MuSigSessionPhase, string> = {
      [MuSigSessionPhase.INIT]: 'Session created, ready to start Round 1',
      [MuSigSessionPhase.NONCE_EXCHANGE]:
        'Round 1 in progress: collecting nonces from all signers',
      [MuSigSessionPhase.PARTIAL_SIG_EXCHANGE]:
        'Round 2 in progress: collecting partial signatures from all signers',
      [MuSigSessionPhase.COMPLETE]:
        'Session complete: signature aggregated successfully',
      [MuSigSessionPhase.ABORTED]: `Session aborted${
        this.session.abortReason ? `: ${this.session.abortReason}` : ''
      }`,
    }

    return descriptions[this.session.phase] || 'Unknown state'
  }

  /**
   * Attempt to transition to ABORTED state with a reason
   *
   * This is a convenience method for error handling.
   * Can be called from any non-terminal state.
   *
   * @param reason - Reason for aborting the session
   * @returns True if transition succeeded, false if already in terminal state
   */
  abort(reason: string): boolean {
    if (this.isTerminal()) {
      return false
    }

    this.transition(MuSigSessionPhase.ABORTED, reason)
    return true
  }

  /**
   * Get diagnostic information about the session state
   *
   * Useful for debugging and monitoring.
   *
   * @returns Diagnostic information
   */
  getDiagnostics(): {
    sessionId: string
    currentState: MuSigSessionPhase
    stateDescription: string
    isTerminal: boolean
    validNextStates: MuSigSessionPhase[]
    createdAt: number
    updatedAt: number
    age: number
  } {
    const now = Date.now()
    return {
      sessionId: this.session.sessionId,
      currentState: this.session.phase,
      stateDescription: this.getStateDescription(),
      isTerminal: this.isTerminal(),
      validNextStates: this.getValidNextStates(),
      createdAt: this.session.createdAt,
      updatedAt: this.session.updatedAt,
      age: now - this.session.createdAt,
    }
  }
}
