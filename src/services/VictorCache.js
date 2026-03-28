// VictorCache.js
// Active Context Buffer for Tier 1 RAM-based search
// Implements dual-layered RAM: Layer A (current session) and Layer B (recent sessions)

import { EventEmitter } from 'events';

/**
 * Victor Cache - Active Context Buffer
 * Provides sub-10ms search over active message history with dual-layered RAM approach
 */
export class VictorCache extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Configuration
    this.config = {
      layerASize: config.layerASize || 20,        // Current session messages to cache
      layerBSize: config.layerBSize || 5,         // Recent sessions to cache
      ttl: config.ttl || 10 * 60 * 1000,          // 10 minutes TTL for Layer B
      temporalDecay: config.temporalDecay || 0.1, // Temporal boost decay rate
      minConfidence: config.minConfidence || 0.9, // Confidence threshold for early termination
      enableLayerB: config.enableLayerB !== false // Enable Layer B by default
    };

    // Layer A: Current session active messages (synchronous, no TTL)
    this.layerA = {
      messages: [], // Array of { id, content, role, timestamp, index }
      index: new Map(), // keyword -> Set of message indices
      lastUpdated: Date.now()
    };

    // Layer B: Recent sessions cache (with TTL)
    this.layerB = {
      sessions: new Map(), // sessionId -> { messages, index, lastAccessed }
      lru: [], // LRU list of sessionIds
      size: 0
    };

    // Statistics
    this.stats = {
      layerAHits: 0,
      layerAMisses: 0,
      layerBHits: 0,
      layerBMisses: 0,
      totalQueries: 0,
      totalLatency: 0
    };

    console.log('🧠 [VICTOR CACHE] Initialized with dual-layered RAM architecture');
  }

  /**
   * Update Layer A with current session messages
   * This is called by the Agent when messages are added/updated
   */
  updateLayerA(messages) {
    const startTime = Date.now();
    
    // Clear existing Layer A
    this.layerA.messages = [];
    this.layerA.index.clear();
    
    // Build Layer A from current active messages
    messages.forEach((message, index) => {
      if (!message || !message.content) return;
      
      const messageData = {
        id: message.id || message._id || `msg_${index}`,
        content: message.content,
        role: message.role || 'user',
        timestamp: message.createdAt || message.timestamp || Date.now(),
        index: index
      };

      this.layerA.messages.push(messageData);
      this._addToIndex(this.layerA.index, messageData);
    });

    this.layerA.lastUpdated = Date.now();
    
    const latency = Date.now() - startTime;
    this.emit('layer-a-updated', {
      messageCount: this.layerA.messages.length,
      latency: latency,
      timestamp: Date.now()
    });

    console.log(`🧠 [VICTOR CACHE] Layer A updated: ${this.layerA.messages.length} messages in ${latency}ms`);
  }

  /**
   * Update Layer B with recent session data
   * Called when a session is accessed or when summarization completes
   */
  updateLayerB(sessionId, sessionData) {
    if (!this.config.enableLayerB) return;

    const startTime = Date.now();
    
    // Clean up expired sessions
    this._cleanupLayerB();

    // If session already exists, update it
    if (this.layerB.sessions.has(sessionId)) {
      const existing = this.layerB.sessions.get(sessionId);
      existing.messages = sessionData.messages || [];
      existing.index = this._buildIndex(sessionData.messages || []);
      existing.lastAccessed = Date.now();
      this._updateLRU(sessionId);
    } else {
      // Add new session
      const sessionEntry = {
        messages: sessionData.messages || [],
        index: this._buildIndex(sessionData.messages || []),
        lastAccessed: Date.now(),
        summary: sessionData.summary,
        topic: sessionData.topic
      };

      this.layerB.sessions.set(sessionId, sessionEntry);
      this.layerB.lru.push(sessionId);
      this.layerB.size++;

      // Enforce size limit
      if (this.layerB.size > this.config.layerBSize) {
        const evictedSessionId = this.layerB.lru.shift();
        this.layerB.sessions.delete(evictedSessionId);
        this.layerB.size--;
      }
    }

    const latency = Date.now() - startTime;
    this.emit('layer-b-updated', {
      sessionId: sessionId,
      messageCount: sessionData.messages?.length || 0,
      latency: latency,
      timestamp: Date.now()
    });

    console.log(`🧠 [VICTOR CACHE] Layer B updated: session ${sessionId} (${sessionData.messages?.length || 0} messages) in ${latency}ms`);
  }

  /**
   * Main search method - implements dual-layered search
   */
  search(query, options = {}) {
    const startTime = Date.now();
    this.stats.totalQueries++;

    const {
      sessionId = null,
      userId = null,
      temporalBoost = true,
      exactMatchBoost = 2.0,
      minConfidence = this.config.minConfidence
    } = options;

    // Normalize query
    const normalizedQuery = this._normalizeQuery(query);
    const queryWords = this._extractKeywords(normalizedQuery);

    if (queryWords.length === 0) {
      this._recordLatency(startTime);
      return {
        tier: 1,
        layer: 'none',
        results: [],
        confidence: 0,
        duration: Date.now() - startTime,
        hit: false
      };
    }

    // Layer A Search (Current Session)
    const layerAResults = this._searchLayerA(queryWords, temporalBoost, exactMatchBoost);
    
    if (layerAResults.confidence >= minConfidence) {
      this.stats.layerAHits++;
      this._recordLatency(startTime);
      
      console.log(`⚡ [VICTOR CACHE] Layer A HIT: confidence ${layerAResults.confidence.toFixed(3)} for "${query.substring(0, 30)}..."`);
      
      this.emit('search-hit', {
        layer: 'layer-a',
        confidence: layerAResults.confidence,
        resultCount: layerAResults.results.length,
        query: query,
        duration: Date.now() - startTime
      });

      return {
        tier: 1,
        layer: 'layer-a',
        results: layerAResults.results,
        confidence: layerAResults.confidence,
        duration: Date.now() - startTime,
        hit: true,
        source: 'current-session'
      };
    }

    this.stats.layerAMisses++;

    // Layer B Search (Recent Sessions) - only if userId provided
    if (this.config.enableLayerB && userId) {
      const layerBResults = this._searchLayerB(queryWords, temporalBoost, exactMatchBoost, userId);
      
      if (layerBResults.confidence >= minConfidence) {
        this.stats.layerBHits++;
        this._recordLatency(startTime);
        
        console.log(`🔍 [VICTOR CACHE] Layer B HIT: confidence ${layerBResults.confidence.toFixed(3)} for "${query.substring(0, 30)}..."`);
        
        this.emit('search-hit', {
          layer: 'layer-b',
          confidence: layerBResults.confidence,
          resultCount: layerBResults.results.length,
          query: query,
          duration: Date.now() - startTime
        });

        return {
          tier: 1,
          layer: 'layer-b',
          results: layerBResults.results,
          confidence: layerBResults.confidence,
          duration: Date.now() - startTime,
          hit: true,
          source: 'recent-sessions'
        };
      }

      this.stats.layerBMisses++;
    }

    // Cache miss
    this._recordLatency(startTime);
    
    const layerBConfidence = this.config.enableLayerB && userId ? layerBResults?.confidence || 0 : 0;
    console.log(`❌ [VICTOR CACHE] MISS: confidence ${Math.max(layerAResults.confidence, layerBConfidence).toFixed(3)} for "${query.substring(0, 30)}..."`);
    
    this.emit('search-miss', {
      layer: 'both',
      query: query,
      duration: Date.now() - startTime,
      layerAResults: layerAResults.confidence,
      layerBResults: layerBConfidence
    });

    return {
      tier: 1,
      layer: 'miss',
      results: [],
      confidence: Math.max(layerAResults.confidence, layerBConfidence),
      duration: Date.now() - startTime,
      hit: false
    };
  }

  /**
   * Search Layer A (Current Session)
   */
  _searchLayerA(queryWords, temporalBoost, exactMatchBoost) {
    if (this.layerA.messages.length === 0) {
      return { confidence: 0, results: [] };
    }

    const results = [];
    let maxScore = 0;

    // Search through messages in reverse order (most recent first)
    for (let i = this.layerA.messages.length - 1; i >= 0; i--) {
      const message = this.layerA.messages[i];
      const score = this._calculateMessageScore(message, queryWords, temporalBoost, exactMatchBoost, i);
      
      if (score > 0) {
        results.push({
          ...message,
          score: score,
          layer: 'layer-a'
        });
        maxScore = Math.max(maxScore, score);
      }
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    // Normalize confidence (0 to 1)
    const confidence = results.length > 0 ? Math.min(maxScore / exactMatchBoost, 1.0) : 0;

    return {
      confidence: confidence,
      results: results.slice(0, 5) // Return top 5 results
    };
  }

  /**
   * Search Layer B (Recent Sessions)
   */
  _searchLayerB(queryWords, temporalBoost, exactMatchBoost, userId) {
    if (this.layerB.sessions.size === 0) {
      return { confidence: 0, results: [] };
    }

    const results = [];
    let maxScore = 0;

    // Search through cached sessions
    for (const [sessionId, sessionData] of this.layerB.sessions.entries()) {
      const sessionScore = this._calculateSessionScore(sessionData, queryWords, temporalBoost, exactMatchBoost);
      
      if (sessionScore > 0) {
        results.push({
          sessionId: sessionId,
          score: sessionScore,
          summary: sessionData.summary,
          topic: sessionData.topic,
          messageCount: sessionData.messages.length,
          layer: 'layer-b'
        });
        maxScore = Math.max(maxScore, sessionScore);
      }
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    // Normalize confidence (0 to 1)
    const confidence = results.length > 0 ? Math.min(maxScore / exactMatchBoost, 1.0) : 0;

    return {
      confidence: confidence,
      results: results.slice(0, 3) // Return top 3 sessions
    };
  }

  /**
   * Calculate score for a single message
   */
  _calculateMessageScore(message, queryWords, temporalBoost, exactMatchBoost, messageIndex) {
    let score = 0;
    const content = message.content.toLowerCase();
    
    // Check for exact phrase match (highest boost)
    const queryPhrase = queryWords.join(' ');
    if (content.includes(queryPhrase)) {
      score += exactMatchBoost;
    }

    // Check for individual keyword matches
    let keywordMatches = 0;
    for (const word of queryWords) {
      if (content.includes(word)) {
        keywordMatches++;
      }
    }

    if (keywordMatches > 0) {
      score += (keywordMatches / queryWords.length);
    }

    // Temporal boost for recent messages
    if (temporalBoost && messageIndex >= 0) {
      const ageFactor = 1 - (messageIndex / this.layerA.messages.length);
      score *= (1 + (ageFactor * this.config.temporalDecay));
    }

    return score;
  }

  /**
   * Calculate score for a session (Layer B)
   */
  _calculateSessionScore(sessionData, queryWords, temporalBoost, exactMatchBoost) {
    let score = 0;
    
    // Check session summary
    if (sessionData.summary) {
      const summaryLower = sessionData.summary.toLowerCase();
      const queryPhrase = queryWords.join(' ');
      
      if (summaryLower.includes(queryPhrase)) {
        score += exactMatchBoost * 0.8; // Slightly lower than exact message match
      }
    }

    // Check topic
    if (sessionData.topic) {
      const topicLower = sessionData.topic.toLowerCase();
      const queryPhrase = queryWords.join(' ');
      
      if (topicLower.includes(queryPhrase)) {
        score += exactMatchBoost * 0.6;
      }
    }

    // Check individual messages (limited to avoid performance issues)
    const sampleSize = Math.min(10, sessionData.messages.length);
    for (let i = 0; i < sampleSize; i++) {
      const message = sessionData.messages[i];
      const messageScore = this._calculateMessageScore(message, queryWords, false, exactMatchBoost, i);
      if (messageScore > 0) {
        score += messageScore * 0.1; // Lower weight for Layer B messages
      }
    }

    return score;
  }

  /**
   * Build inverted index for a set of messages
   */
  _buildIndex(messages) {
    const index = new Map();
    
    messages.forEach((message, indexPos) => {
      if (!message || !message.content) return;
      
      const words = this._extractKeywords(message.content);
      words.forEach(word => {
        if (!index.has(word)) {
          index.set(word, new Set());
        }
        index.get(word).add(indexPos);
      });
    });

    return index;
  }

  /**
   * Add message to index
   */
  _addToIndex(index, message) {
    const words = this._extractKeywords(message.content);
    words.forEach(word => {
      if (!index.has(word)) {
        index.set(word, new Set());
      }
      index.get(word).add(message.index);
    });
  }

  /**
   * Extract keywords from text
   */
  _extractKeywords(text) {
    if (!text || typeof text !== 'string') return [];
    
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(word => word.length > 3) // Filter short words
      .filter((word, index, arr) => arr.indexOf(word) === index); // Remove duplicates
  }

  /**
   * Normalize query text
   */
  _normalizeQuery(query) {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Update LRU list
   */
  _updateLRU(sessionId) {
    const index = this.layerB.lru.indexOf(sessionId);
    if (index > -1) {
      this.layerB.lru.splice(index, 1);
    }
    this.layerB.lru.push(sessionId);
  }

  /**
   * Clean up expired sessions in Layer B
   */
  _cleanupLayerB() {
    const now = Date.now();
    const expiredSessions = [];
    
    for (const [sessionId, sessionData] of this.layerB.sessions.entries()) {
      if (now - sessionData.lastAccessed > this.config.ttl) {
        expiredSessions.push(sessionId);
      }
    }

    expiredSessions.forEach(sessionId => {
      this.layerB.sessions.delete(sessionId);
      const lruIndex = this.layerB.lru.indexOf(sessionId);
      if (lruIndex > -1) {
        this.layerB.lru.splice(lruIndex, 1);
      }
      this.layerB.size--;
    });

    if (expiredSessions.length > 0) {
      console.log(`🧹 [VICTOR CACHE] Cleaned up ${expiredSessions.length} expired sessions from Layer B`);
    }
  }

  /**
   * Record latency for statistics
   */
  _recordLatency(startTime) {
    const latency = Date.now() - startTime;
    this.stats.totalLatency += latency;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const layerAHitRate = this.stats.totalQueries > 0 
      ? (this.stats.layerAHits / this.stats.totalQueries) * 100 
      : 0;
    
    const layerBHitRate = this.stats.totalQueries > 0 
      ? (this.stats.layerBHits / this.stats.totalQueries) * 100 
      : 0;
    
    const overallHitRate = this.stats.totalQueries > 0 
      ? ((this.stats.layerAHits + this.stats.layerBHits) / this.stats.totalQueries) * 100 
      : 0;

    const avgLatency = this.stats.totalQueries > 0 
      ? this.stats.totalLatency / this.stats.totalQueries 
      : 0;

    return {
      layerA: {
        hits: this.stats.layerAHits,
        misses: this.stats.layerAMisses,
        hitRate: layerAHitRate,
        messageCount: this.layerA.messages.length
      },
      layerB: {
        hits: this.stats.layerBHits,
        misses: this.stats.layerBMisses,
        hitRate: layerBHitRate,
        sessionCount: this.layerB.sessions.size,
        lruSize: this.layerB.lru.length
      },
      overall: {
        totalQueries: this.stats.totalQueries,
        overallHitRate: overallHitRate,
        avgLatency: avgLatency,
        config: this.config
      }
    };
  }

  /**
   * Clear all cache data
   */
  clear() {
    this.layerA.messages = [];
    this.layerA.index.clear();
    this.layerA.lastUpdated = Date.now();
    
    this.layerB.sessions.clear();
    this.layerB.lru = [];
    this.layerB.size = 0;
    
    this.stats = {
      layerAHits: 0,
      layerAMisses: 0,
      layerBHits: 0,
      layerBMisses: 0,
      totalQueries: 0,
      totalLatency: 0
    };

    console.log('🧹 [VICTOR CACHE] Cache cleared');
    this.emit('cache-cleared');
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      // Test Layer A
      const testQuery = "test search query";
      const testResults = this.search(testQuery);
      
      const isHealthy = testResults.duration < 10; // Should be < 10ms
      
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        message: isHealthy ? 'Victor Cache is healthy' : 'Victor Cache latency exceeds 10ms threshold',
        details: {
          latency: testResults.duration,
          layerASize: this.layerA.messages.length,
          layerBSize: this.layerB.sessions.size,
          stats: this.getStats()
        }
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Victor Cache health check failed: ${error.message}`,
        details: {
          error: error.message
        }
      };
    }
  }
}

// Export singleton instance
export const victorCache = new VictorCache();