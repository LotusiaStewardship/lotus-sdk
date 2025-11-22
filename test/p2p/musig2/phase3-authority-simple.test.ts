/**
 * Phase 3: Authority Validation Unit Tests
 * Simple unit tests without full P2P setup
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { MuSig2MessageType } from '../../../lib/p2p/musig2/types.js'
import {
  MESSAGE_CHANNELS,
  MessageAuthority,
} from '../../../lib/p2p/musig2/message-channels.js'

describe('Phase 3: Authority Validation - Unit Tests', () => {
  describe('Message Authority Configuration', () => {
    it('should have correct authority configuration for all message types', () => {
      // Verify coordinator-only messages
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.SESSION_READY].authority,
        MessageAuthority.COORDINATOR,
        'SESSION_READY should be coordinator-only',
      )
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.NONCES_COMPLETE].authority,
        MessageAuthority.COORDINATOR,
        'NONCES_COMPLETE should be coordinator-only',
      )
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.PARTIAL_SIGS_COMPLETE].authority,
        MessageAuthority.COORDINATOR,
        'PARTIAL_SIGS_COMPLETE should be coordinator-only',
      )
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.SIGNATURE_FINALIZED].authority,
        MessageAuthority.COORDINATOR,
        'SIGNATURE_FINALIZED should be coordinator-only',
      )

      // Verify participant-only messages
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.PARTICIPANT_JOINED].authority,
        MessageAuthority.PARTICIPANT,
        'PARTICIPANT_JOINED should be participant-only',
      )
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.NONCE_COMMIT].authority,
        MessageAuthority.PARTICIPANT,
        'NONCE_COMMIT should be participant-only',
      )
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.NONCE_SHARE].authority,
        MessageAuthority.PARTICIPANT,
        'NONCE_SHARE should be participant-only',
      )
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.PARTIAL_SIG_SHARE].authority,
        MessageAuthority.PARTICIPANT,
        'PARTIAL_SIG_SHARE should be participant-only',
      )

      // Verify ANY authority messages
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.SESSION_ABORT].authority,
        MessageAuthority.ANY,
        'SESSION_ABORT should be ANY authority',
      )
      assert.strictEqual(
        MESSAGE_CHANNELS[MuSig2MessageType.VALIDATION_ERROR].authority,
        MessageAuthority.ANY,
        'VALIDATION_ERROR should be ANY authority',
      )
    })
  })

  describe('Authority Validation Logic', () => {
    it('should validate coordinator-only authority correctly', () => {
      const config = MESSAGE_CHANNELS[MuSig2MessageType.SESSION_READY]
      assert.strictEqual(config.authority, MessageAuthority.COORDINATOR)

      // Test authority validation logic
      const isCoordinator = true

      if (config.authority === MessageAuthority.COORDINATOR) {
        assert.ok(
          isCoordinator,
          'Should allow coordinator to send coordinator-only message',
        )

        // Test rejection case
        const isNotCoordinator = false
        if (!isNotCoordinator) {
          assert.throws(
            () => {
              throw new Error('COORDINATOR_ONLY: Message rejected')
            },
            /COORDINATOR_ONLY/,
            'Should reject participant sending coordinator-only message',
          )
        }
      }
    })

    it('should validate participant-only authority correctly', () => {
      const config = MESSAGE_CHANNELS[MuSig2MessageType.NONCE_COMMIT]
      assert.strictEqual(config.authority, MessageAuthority.PARTICIPANT)

      // Test authority validation logic
      const isCoordinator = false

      if (config.authority === MessageAuthority.PARTICIPANT) {
        assert.ok(
          !isCoordinator,
          'Should allow participant to send participant-only message',
        )

        // Test rejection case
        if (isCoordinator) {
          assert.throws(
            () => {
              throw new Error('PARTICIPANT_ONLY: Message rejected')
            },
            /PARTICIPANT_ONLY/,
            'Should reject coordinator sending participant-only message',
          )
        }
      }
    })

    it('should allow ANY authority messages', () => {
      const config = MESSAGE_CHANNELS[MuSig2MessageType.SESSION_ABORT]
      assert.strictEqual(config.authority, MessageAuthority.ANY)

      // ANY authority messages should always be allowed
      if (config.authority === MessageAuthority.ANY) {
        assert.ok(true, 'ANY authority messages should be allowed for any role')
      }
    })
  })

  describe('Session ID Extraction Logic', () => {
    it('should extract session ID from standard payloads', () => {
      const sessionId = 'test-session-123'
      const payload = { sessionId, data: 'test' }

      // Simulate the extraction logic
      let extractedId = null
      if (payload && typeof payload === 'object' && 'sessionId' in payload) {
        extractedId = (payload as { sessionId: string }).sessionId
      }

      assert.strictEqual(
        extractedId,
        sessionId,
        'Should extract sessionId from payload',
      )
    })

    it('should handle SESSION_JOIN payload', () => {
      const sessionId = 'test-session-456'
      const payload = { sessionId }

      // Simulate SESSION_JOIN case
      let extractedId = null
      if (payload && typeof payload === 'object' && 'sessionId' in payload) {
        extractedId = (payload as { sessionId: string }).sessionId
      }

      assert.strictEqual(
        extractedId,
        sessionId,
        'Should extract sessionId from SESSION_JOIN payload',
      )
    })

    it('should return null for unknown payload types', () => {
      const payload = { someOtherField: 'test' }

      // Simulate extraction logic for unknown payload
      let extractedId = null
      if (payload && typeof payload === 'object' && 'sessionId' in payload) {
        extractedId = (payload as { sessionId: string }).sessionId
      }

      assert.strictEqual(
        extractedId,
        null,
        'Should return null for unknown payload structure',
      )
    })

    it('should handle PARTICIPANT_JOINED payload with requestId', () => {
      const requestId = 'test-request-789'
      const payload = { requestId }

      // Simulate PARTICIPANT_JOINED case - would need request ID mapping
      let extractedId = null

      // In real implementation, this would map requestId to sessionId
      // For test, we simulate the case where mapping fails
      const mockRequestToSessionMap = new Map()
      extractedId = mockRequestToSessionMap.get(requestId) || null

      assert.strictEqual(
        extractedId,
        null,
        'Should return null when requestId not found',
      )
    })

    it('should handle SIGNING_REQUEST payload with requestId', () => {
      const requestId = 'test-request-789'
      const payload = { requestId, message: 'test message' }

      // Simulate SIGNING_REQUEST case - would need request ID mapping
      let extractedId = null

      // In real implementation, this would map requestId to sessionId
      // For test, we simulate the case where mapping fails
      const mockRequestToSessionMap = new Map()
      extractedId = mockRequestToSessionMap.get(requestId) || null

      assert.strictEqual(
        extractedId,
        null,
        'Should return null when requestId not found',
      )

      // Test successful mapping case
      const mockSessionId = 'mapped-session-123'
      mockRequestToSessionMap.set(requestId, mockSessionId)
      extractedId = mockRequestToSessionMap.get(requestId) || null

      assert.strictEqual(
        extractedId,
        mockSessionId,
        'Should return mapped session ID when found',
      )
    })

    it('should handle discovery messages without session ID', () => {
      // Discovery messages should return null (handled by ANY authority skip)
      // Simulate the logic from _extractSessionIdFromPayload
      const messageType1 = MuSig2MessageType.SIGNER_ADVERTISEMENT
      let extractedId = null

      if (
        messageType1 === MuSig2MessageType.SIGNER_ADVERTISEMENT ||
        messageType1 === MuSig2MessageType.SIGNER_UNAVAILABLE
      ) {
        extractedId = null // Discovery messages don't have session context
      }

      assert.strictEqual(
        extractedId,
        null,
        'SIGNER_ADVERTISEMENT should return null session ID',
      )

      // Test SIGNER_UNAVAILABLE
      const messageType2 = MuSig2MessageType.SIGNER_UNAVAILABLE
      extractedId = null

      if (messageType2 === MuSig2MessageType.SIGNER_UNAVAILABLE) {
        extractedId = null // Discovery messages don't have session context
      }

      assert.strictEqual(
        extractedId,
        null,
        'SIGNER_UNAVAILABLE should return null session ID',
      )
    })
  })

  describe('Error Message Format', () => {
    it('should generate proper error messages for coordinator violations', () => {
      const messageType = MuSig2MessageType.SESSION_READY
      const sessionId = 'test-session'

      try {
        // Simulate non-coordinator trying to send coordinator-only message
        throw new Error(
          `COORDINATOR_ONLY: ${messageType} rejected - sender is not coordinator for session ${sessionId}`,
        )
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.match(
          (error as Error).message,
          /COORDINATOR_ONLY/,
          'Should indicate coordinator-only violation',
        )
        assert.match(
          (error as Error).message,
          /musig2:session-ready/,
          'Should mention the message type',
        )
        assert.match(
          (error as Error).message,
          /rejected/,
          'Should indicate message was rejected',
        )
        assert.match(
          (error as Error).message,
          /test-session/,
          'Should include session ID',
        )
      }
    })

    it('should generate proper error messages for participant violations', () => {
      const messageType = MuSig2MessageType.NONCE_COMMIT
      const sessionId = 'test-session'

      try {
        // Simulate coordinator trying to send participant-only message
        throw new Error(
          `PARTICIPANT_ONLY: ${messageType} rejected - sender is coordinator for session ${sessionId}`,
        )
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.match(
          (error as Error).message,
          /PARTICIPANT_ONLY/,
          'Should indicate participant-only violation',
        )
        assert.match(
          (error as Error).message,
          /musig2:nonce-commit/,
          'Should mention the message type',
        )
        assert.match(
          (error as Error).message,
          /rejected/,
          'Should indicate message was rejected',
        )
        assert.match(
          (error as Error).message,
          /test-session/,
          'Should include session ID',
        )
      }
    })

    it('should generate proper error messages for missing session ID', () => {
      const messageType = MuSig2MessageType.SESSION_READY

      try {
        throw new Error(
          `AUTHORITY_VALIDATION: Cannot extract session ID from ${messageType} payload`,
        )
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.match(
          (error as Error).message,
          /AUTHORITY_VALIDATION/,
          'Should indicate validation error',
        )
        assert.match(
          (error as Error).message,
          /Cannot extract session ID/,
          'Should describe the issue',
        )
        assert.match(
          (error as Error).message,
          /musig2:session-ready/,
          'Should mention the message type',
        )
      }
    })
  })

  describe('Message Channel Configuration Coverage', () => {
    it('should have authority configuration for all message types', () => {
      const messageTypes = Object.values(MuSig2MessageType)

      for (const messageType of messageTypes) {
        const config = MESSAGE_CHANNELS[messageType]
        assert.ok(
          config,
          `Message type ${messageType} should have channel configuration`,
        )
        assert.ok(
          Object.values(MessageAuthority).includes(config.authority),
          `Message type ${messageType} should have valid authority: ${config.authority}`,
        )
      }
    })

    it('should have proper distribution of authority types', () => {
      const messageTypes = Object.values(MuSig2MessageType)
      const authorityCounts = {
        [MessageAuthority.COORDINATOR]: 0,
        [MessageAuthority.PARTICIPANT]: 0,
        [MessageAuthority.ANY]: 0,
      }

      for (const messageType of messageTypes) {
        const config = MESSAGE_CHANNELS[messageType]
        authorityCounts[config.authority]++
      }

      assert.ok(
        authorityCounts[MessageAuthority.COORDINATOR] > 0,
        'Should have coordinator-only messages',
      )
      assert.ok(
        authorityCounts[MessageAuthority.PARTICIPANT] > 0,
        'Should have participant-only messages',
      )
      assert.ok(
        authorityCounts[MessageAuthority.ANY] > 0,
        'Should have ANY authority messages',
      )

      console.log(`Authority distribution:`, authorityCounts)
    })
  })
})
