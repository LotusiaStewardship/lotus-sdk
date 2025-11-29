/**
 * DHT Discoverer Implementation
 *
 * Handles discovering peers based on criteria from DHT.
 * Uses GossipSub for real-time subscription notifications (event-driven).
 * Uses DHT for one-time queries and initial state fetch.
 *
 * Architecture:
 * - discover(): One-time DHT query for current state
 * - subscribe(): GossipSub subscription for real-time updates
 */

import type { P2PCoordinator } from '../coordinator.js'
import type { P2PMessage } from '../types.js'
import {
  type IDiscoveryDiscoverer,
  type DiscoveryCriteria,
  type DiscoveryAdvertisement,
  type DiscoveryOptions,
  type DiscoverySubscription,
  type SubscriptionOptions,
  type SecurityValidationResult,
  DiscoveryError,
  DiscoveryErrorType,
  DEFAULT_DISCOVERY_OPTIONS,
} from './types.js'
import { DiscoverySecurityValidator } from './security.js'

// ============================================================================
// Constants
// ============================================================================

/**
 * GossipSub topic prefix for discovery advertisements
 */
const DISCOVERY_TOPIC_PREFIX = 'lotus/discovery'

/**
 * Default subscription options
 */
const DEFAULT_SUBSCRIPTION_OPTIONS: Required<SubscriptionOptions> = {
  fetchExisting: true,
  fetchTimeout: 5000,
  deduplicate: true,
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Cache entry
 */
interface CacheEntry {
  /** Advertisement data */
  advertisement: DiscoveryAdvertisement

  /** Cache timestamp */
  timestamp: number

  /** Access count */
  accessCount: number

  /** Last access time */
  lastAccess: number
}

/**
 * Subscription record
 */
interface SubscriptionRecord {
  /** Subscription ID */
  id: string

  /** Subscription criteria */
  criteria: DiscoveryCriteria

  /** GossipSub topic */
  topic: string

  /** Event handler */
  handler: (advertisement: DiscoveryAdvertisement) => void

  /** Whether subscription is active */
  active: boolean

  /** Creation timestamp */
  createdAt: number

  /** Last update timestamp */
  lastUpdate: number

  /** Seen advertisements set (for deduplication) */
  seenAdvertisements: Set<string>

  /** Subscription options */
  options: Required<SubscriptionOptions>
}

/**
 * Cache statistics
 */
interface CacheStats {
  size: number
  hits: number
  misses: number
  hitRate: number
}

// ============================================================================
// DHT Discoverer Class
// ============================================================================

/**
 * DHT-based discovery discoverer with GossipSub subscriptions
 *
 * This implementation follows the proper libp2p architecture:
 * - DHT for persistent storage and one-time queries
 * - GossipSub for real-time event-driven subscriptions
 */
export class DHTDiscoverer implements IDiscoveryDiscoverer {
  private readonly coordinator: P2PCoordinator
  private readonly cache = new Map<string, CacheEntry>()
  private readonly subscriptions = new Map<string, SubscriptionRecord>()
  private readonly rateLimitTracker = new Map<
    string,
    { count: number; windowStart: number }
  >()
  private started = false
  private cleanupTimer?: NodeJS.Timeout
  private cacheStats: CacheStats = {
    size: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
  }

  constructor(coordinator: P2PCoordinator) {
    this.coordinator = coordinator
  }

  // ========================================================================
  // Public Methods
  // ========================================================================

  /**
   * Discover peers based on criteria (one-time DHT query)
   *
   * This performs a point-in-time query of the DHT for matching advertisements.
   * For real-time updates, use subscribe() instead.
   */
  async discover(
    criteria: DiscoveryCriteria,
    options?: Partial<DiscoveryOptions>,
  ): Promise<DiscoveryAdvertisement[]> {
    if (!this.started) {
      throw new DiscoveryError(
        DiscoveryErrorType.CONFIGURATION_ERROR,
        'Discoverer not started',
      )
    }

    const opts = { ...DEFAULT_DISCOVERY_OPTIONS, ...options }

    // Check rate limits
    this.checkRateLimits(criteria.protocol, opts)

    // Generate DHT keys for the criteria
    const keys = this.getDHTKeys(criteria)

    // Query DHT for each key
    const results: DiscoveryAdvertisement[] = []
    const seenIds = new Set<string>()

    for (const key of keys) {
      try {
        const announcement = await this.coordinator.discoverResource(
          'discovery:advertisement',
          key,
          5000, // 5 second timeout
        )

        if (announcement && announcement.data) {
          const advertisement = announcement.data as DiscoveryAdvertisement

          // Skip duplicates
          if (seenIds.has(advertisement.id)) {
            continue
          }
          seenIds.add(advertisement.id)

          // Validate advertisement
          if (this.isValidAdvertisement(advertisement, Date.now())) {
            // Apply filters
            if (this.matchesCriteria(advertisement, criteria)) {
              // Validate security
              const securityResult =
                await this.validateAdvertisementSecurity(advertisement)
              if (securityResult.valid && securityResult.securityScore >= 50) {
                results.push(advertisement)
                this.addToCache(advertisement)
              }
            }
          }
        }
      } catch (error) {
        // Log error but continue with other keys
        console.error(`DHT discovery failed for key ${key}:`, error)
      }
    }

    // Sort results by reputation (descending) and cache relevance
    results.sort((a, b) => {
      const cacheEntryA = this.cache.get(a.id)
      const cacheEntryB = this.cache.get(b.id)

      // Prioritize by reputation, then by cache access frequency
      if (a.reputation !== b.reputation) {
        return b.reputation - a.reputation
      }

      return (cacheEntryB?.accessCount || 0) - (cacheEntryA?.accessCount || 0)
    })

    // Apply maxResults limit
    if (criteria.maxResults && results.length > criteria.maxResults) {
      return results.slice(0, criteria.maxResults)
    }

    return results
  }

  /**
   * Subscribe to discovery updates via GossipSub (event-driven)
   *
   * This creates a real-time subscription using GossipSub pub/sub.
   * New advertisements matching the criteria will trigger the callback
   * immediately when published, without polling.
   *
   * @param criteria - Discovery criteria to match
   * @param callback - Callback invoked for each matching advertisement
   * @param subscriptionOptions - Options for the subscription
   * @returns Subscription handle
   */
  async subscribe(
    criteria: DiscoveryCriteria,
    callback: (advertisement: DiscoveryAdvertisement) => void,
    subscriptionOptions?: SubscriptionOptions,
  ): Promise<DiscoverySubscription> {
    if (!this.started) {
      throw new DiscoveryError(
        DiscoveryErrorType.CONFIGURATION_ERROR,
        'Discoverer not started',
      )
    }

    const opts = { ...DEFAULT_SUBSCRIPTION_OPTIONS, ...subscriptionOptions }
    const subscriptionId = this.generateSubscriptionId(criteria)
    const topic = this.criteriaToTopic(criteria)

    // Create subscription record
    const subscription: SubscriptionRecord = {
      id: subscriptionId,
      criteria,
      topic,
      handler: callback,
      active: true,
      createdAt: Date.now(),
      lastUpdate: Date.now(),
      seenAdvertisements: new Set(),
      options: opts,
    }

    this.subscriptions.set(subscriptionId, subscription)

    // Subscribe to GossipSub topic for real-time updates
    await this.coordinator.subscribeToTopic(topic, (data: Uint8Array) => {
      this.handleGossipSubMessage(subscriptionId, data)
    })

    console.log(
      `[Discovery] Subscribed to GossipSub topic: ${topic} (subscription: ${subscriptionId})`,
    )

    // Optionally fetch existing advertisements from DHT
    if (opts.fetchExisting) {
      try {
        const fetchCriteria = {
          ...criteria,
          timeout: opts.fetchTimeout,
        }
        const existing = await this.discover(fetchCriteria)

        // Notify about existing advertisements
        for (const advertisement of existing) {
          if (
            !opts.deduplicate ||
            !subscription.seenAdvertisements.has(advertisement.id)
          ) {
            subscription.seenAdvertisements.add(advertisement.id)
            subscription.lastUpdate = Date.now()

            // Call handler asynchronously to avoid blocking
            setImmediate(() => {
              if (subscription.active) {
                callback(advertisement)
              }
            })
          }
        }
      } catch (error) {
        console.warn(
          `[Discovery] Failed to fetch existing advertisements for subscription ${subscriptionId}:`,
          error,
        )
        // Continue anyway - subscription is still active for new advertisements
      }
    }

    // Return subscription object
    return {
      id: subscriptionId,
      criteria,
      callback,
      active: true,
      createdAt: subscription.createdAt,
      lastActivity: subscription.lastUpdate,
      topic,
    }
  }

  /**
   * Unsubscribe from discovery updates
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      return
    }

    // Mark as inactive first
    subscription.active = false

    // Unsubscribe from GossipSub topic
    try {
      await this.coordinator.unsubscribeFromTopic(subscription.topic)
      console.log(
        `[Discovery] Unsubscribed from GossipSub topic: ${subscription.topic}`,
      )
    } catch (error) {
      console.warn(
        `[Discovery] Failed to unsubscribe from topic ${subscription.topic}:`,
        error,
      )
    }

    // Remove from subscriptions
    this.subscriptions.delete(subscriptionId)
  }

  /**
   * Get active subscriptions
   */
  getActiveSubscriptions(): string[] {
    return Array.from(this.subscriptions.entries())
      .filter(([, record]) => record.active)
      .map(([id]) => id)
  }

  /**
   * Clear discovery cache
   */
  clearCache(protocol?: string): void {
    if (protocol) {
      // Clear only specific protocol entries
      for (const [key, entry] of Array.from(this.cache.entries())) {
        if (entry.advertisement.protocol === protocol) {
          this.cache.delete(key)
        }
      }
    } else {
      // Clear all cache
      this.cache.clear()
    }

    this.updateCacheStats()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number
    hits: number
    misses: number
    hitRate: number
  } {
    this.updateCacheStats()
    return { ...this.cacheStats }
  }

  /**
   * Start the discoverer
   */
  async start(): Promise<void> {
    if (this.started) {
      return
    }

    this.started = true

    // Start cleanup timer
    this.cleanupTimer = setInterval(
      () => {
        this.cleanupCache()
        this.cleanupSubscriptions()
      },
      5 * 60 * 1000,
    ) // Every 5 minutes
  }

  /**
   * Stop the discoverer
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return
    }

    this.started = false

    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }

    // Unsubscribe from all GossipSub topics
    const subscriptionIds = Array.from(this.subscriptions.keys())
    await Promise.allSettled(subscriptionIds.map(id => this.unsubscribe(id)))
  }

  // ========================================================================
  // Private Methods - GossipSub Handling
  // ========================================================================

  /**
   * Handle incoming GossipSub message
   */
  private handleGossipSubMessage(
    subscriptionId: string,
    data: Uint8Array,
  ): void {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || !subscription.active) {
      return
    }

    try {
      // Parse the advertisement from the message
      const messageStr = new TextDecoder().decode(data)
      const advertisement = JSON.parse(messageStr) as DiscoveryAdvertisement

      // Validate advertisement structure
      if (!this.isValidAdvertisement(advertisement, Date.now())) {
        console.warn(
          `[Discovery] Invalid advertisement received on topic ${subscription.topic}`,
        )
        return
      }

      // Check if it matches criteria
      if (!this.matchesCriteria(advertisement, subscription.criteria)) {
        // Doesn't match criteria - ignore
        return
      }

      // Deduplicate if enabled
      if (
        subscription.options.deduplicate &&
        subscription.seenAdvertisements.has(advertisement.id)
      ) {
        return
      }

      // Mark as seen
      subscription.seenAdvertisements.add(advertisement.id)
      subscription.lastUpdate = Date.now()

      // Add to cache
      this.addToCache(advertisement)

      // Invoke callback
      subscription.handler(advertisement)
    } catch (error) {
      console.error(
        `[Discovery] Error processing GossipSub message for subscription ${subscriptionId}:`,
        error,
      )
    }
  }

  /**
   * Convert criteria to GossipSub topic
   *
   * Topic naming convention:
   * - lotus/discovery/{protocol} - All advertisements for a protocol
   * - lotus/discovery/{protocol}/{capability} - Capability-specific (future)
   */
  private criteriaToTopic(criteria: DiscoveryCriteria): string {
    // Base topic is protocol-specific
    return `${DISCOVERY_TOPIC_PREFIX}/${criteria.protocol}`
  }

  // ========================================================================
  // Private Methods - DHT Operations
  // ========================================================================

  /**
   * Get DHT keys for discovery criteria
   */
  private getDHTKeys(criteria: DiscoveryCriteria): string[] {
    const keys: string[] = []

    // Protocol-specific key
    keys.push(`discovery:${criteria.protocol}:all`)

    // Capability-specific keys
    if (criteria.capabilities) {
      for (const capability of criteria.capabilities) {
        keys.push(`discovery:${criteria.protocol}:capability:${capability}`)
      }
    }

    // Location-based key (if location filter is specified)
    if (criteria.location) {
      const latGrid = Math.floor(criteria.location.latitude / 5) * 5 // 5-degree grid
      const lonGrid = Math.floor(criteria.location.longitude / 5) * 5
      keys.push(`discovery:${criteria.protocol}:location:${latGrid}:${lonGrid}`)
    }

    return keys
  }

  /**
   * Check if advertisement is valid
   */
  private isValidAdvertisement(
    advertisement: DiscoveryAdvertisement,
    now: number,
  ): boolean {
    // Check required fields
    if (
      !advertisement.id ||
      !advertisement.protocol ||
      !advertisement.peerInfo
    ) {
      return false
    }

    // Check expiration
    if (advertisement.expiresAt <= now) {
      return false
    }

    // Check peer info
    if (
      !advertisement.peerInfo.peerId ||
      !advertisement.peerInfo.multiaddrs?.length
    ) {
      return false
    }

    return true
  }

  /**
   * Check if advertisement matches criteria
   */
  private matchesCriteria(
    advertisement: DiscoveryAdvertisement,
    criteria: DiscoveryCriteria,
  ): boolean {
    // Protocol match
    if (advertisement.protocol !== criteria.protocol) {
      return false
    }

    // Capabilities match
    if (criteria.capabilities) {
      const hasAllCapabilities = criteria.capabilities.every(cap =>
        advertisement.capabilities.includes(cap),
      )
      if (!hasAllCapabilities) {
        return false
      }
    }

    // Reputation filter
    if (
      criteria.minReputation &&
      advertisement.reputation < criteria.minReputation
    ) {
      return false
    }

    // Location filter
    if (criteria.location && advertisement.location) {
      const distance = this.calculateDistance(
        criteria.location.latitude,
        criteria.location.longitude,
        advertisement.location.latitude,
        advertisement.location.longitude,
      )
      if (distance > criteria.location.radiusKm) {
        return false
      }
    }

    // Custom criteria
    if (criteria.customCriteria) {
      if (!advertisement.customCriteria) {
        return false
      }

      // Check if all custom criteria keys match
      for (const [key, expectedValue] of Object.entries(
        criteria.customCriteria,
      )) {
        const actualValue = advertisement.customCriteria[key]
        if (actualValue !== expectedValue) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Validate advertisement security
   */
  private async validateAdvertisementSecurity(
    advertisement: DiscoveryAdvertisement,
  ): Promise<SecurityValidationResult> {
    const now = Date.now()
    const result: SecurityValidationResult = {
      valid: true,
      securityScore: 100,
      details: {
        signatureValid: true,
        notExpired: advertisement.expiresAt > now,
        reputationAcceptable: advertisement.reputation >= 50,
        criteriaMatch: true,
        customValidation: true,
      },
    }

    // Check expiration
    if (!result.details.notExpired) {
      result.valid = false
      result.error = 'Advertisement expired'
      result.securityScore -= 50
    }

    // Check reputation
    if (!result.details.reputationAcceptable) {
      result.valid = false
      result.error = 'Reputation too low'
      result.securityScore -= 30
    }

    // Validate signature if present
    if (advertisement.signature) {
      try {
        // Use the security validator to verify the signature
        const securityValidator = new DiscoverySecurityValidator(
          this.coordinator,
          {
            enableSignatureVerification: true,
            enableReplayPrevention: true,
            enableRateLimiting: false, // Skip rate limiting for validation
            rateLimits: {
              maxAdvertisementsPerPeer: 0,
              maxDiscoveryQueriesPerPeer: 0,
              windowSizeMs: 0,
            },
            minReputation: 0, // Minimum reputation threshold
            maxAdvertisementAge: 24 * 60 * 60 * 1000, // 24 hours
            customValidators: [],
          },
        )

        const validation = await securityValidator.validateAdvertisement(
          advertisement,
          {} as DiscoveryCriteria, // Empty criteria for signature validation only
        )
        result.details.signatureValid = validation.details.signatureValid
      } catch (error) {
        result.details.signatureValid = false
        result.securityScore -= 20
      }
    }

    return result
  }

  // ========================================================================
  // Private Methods - Cache Management
  // ========================================================================

  /**
   * Add advertisement to cache
   */
  private addToCache(advertisement: DiscoveryAdvertisement): void {
    const existing = this.cache.get(advertisement.id)

    if (existing) {
      // Update existing entry
      existing.timestamp = Date.now()
      existing.accessCount++
      existing.lastAccess = Date.now()
    } else {
      // Add new entry
      this.cache.set(advertisement.id, {
        advertisement,
        timestamp: Date.now(),
        accessCount: 1,
        lastAccess: Date.now(),
      })
    }

    this.updateCacheStats()
  }

  /**
   * Check rate limits
   */
  private checkRateLimits(
    protocol: string,
    options: Required<DiscoveryOptions>,
  ): void {
    if (!options.enableCache) {
      return
    }

    const now = Date.now()
    const windowStart = now - options.cacheTTL
    const key = `discover:${protocol}`

    let tracker = this.rateLimitTracker.get(key)
    if (!tracker || tracker.windowStart < windowStart) {
      tracker = { count: 0, windowStart: now }
      this.rateLimitTracker.set(key, tracker)
    }

    if (tracker.count >= 100) {
      // Max 100 discoveries per cache TTL
      throw new DiscoveryError(
        DiscoveryErrorType.RATE_LIMIT_EXCEEDED,
        'Discovery rate limit exceeded',
      )
    }

    tracker.count++
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now()
    const maxAge = 30 * 60 * 1000 // 30 minutes

    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now - entry.timestamp > maxAge) {
        this.cache.delete(key)
      }
    }

    this.updateCacheStats()
  }

  /**
   * Clean up inactive subscriptions
   */
  private cleanupSubscriptions(): void {
    const now = Date.now()
    const maxAge = 60 * 60 * 1000 // 1 hour

    const inactiveIds: string[] = []
    for (const [id, subscription] of Array.from(this.subscriptions.entries())) {
      if (!subscription.active || now - subscription.lastUpdate > maxAge) {
        inactiveIds.push(id)
      }
    }

    for (const id of inactiveIds) {
      this.unsubscribe(id).catch(() => {
        // Best effort cleanup
      })
    }
  }

  // ========================================================================
  // Private Methods - Utilities
  // ========================================================================

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371 // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1)
    const dLon = this.toRadians(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180)
  }

  /**
   * Generate subscription ID
   */
  private generateSubscriptionId(criteria: DiscoveryCriteria): string {
    const hash = this.simpleHash(JSON.stringify(criteria) + Date.now())
    return `sub:${hash}`
  }

  /**
   * Simple hash function for generating IDs
   */
  private simpleHash(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }

  /**
   * Update cache statistics
   */
  private updateCacheStats(): void {
    this.cacheStats.size = this.cache.size
    const total = this.cacheStats.hits + this.cacheStats.misses
    this.cacheStats.hitRate = total > 0 ? this.cacheStats.hits / total : 0
  }
}
