// tieredSearchService.js
// Tiered search implementation with RAM cache, vector search, and session-level deep search

import { SEARCH_THRESHOLDS, detectSearchMode, getSearchThreshold, calculateNumCandidates, assessResultQuality, searchMetrics } from './searchConfig.js';
import { generateEmbedding } from './embeddingService.js';
import { victorCache } from './VictorCache.js';
import { dateTimeTool } from '../tools/dateTimeTool.js';

/**
 * RAM Cache for recent search results
 */
class SearchCache {
  constructor(ttl = 5 * 60 * 1000) { // 5 minutes default TTL
    this.cache = new Map();
    this.ttl = ttl;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

/**
 * Tiered Search Orchestrator
 * Implements the three-tier search architecture:
 * - Tier 1: RAM cache (Instant - <10ms)
 * - Tier 2: Atlas Vector Search (Fast - ~500ms)  
 * - Tier 3: Session-level deep search (Comprehensive - ~1s)
 */
export class TieredSearchOrchestrator {
  constructor() {
    this.cache = new SearchCache();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      totalRequests: 0
    };
  }

  /**
   * Main search orchestrator - decides which tier to use
   * Now integrates Victor Cache as Tier 1
   */
  async search(query, options = {}) {
    const startTime = Date.now();
    this.cacheStats.totalRequests++;

    // Parse natural language date expressions into a dateRange
    const parsedDateRange = this.parseDateRangeOptions(options);

    // Extract options with defaults
    const {
      limit = 5,
      sessionId = null,
      dateRange = parsedDateRange || null,
      roleFilter = null,
      searchMode = null,
      enableCache = true,
      minConfidence = 0.9,
      estimatedDatasetSize = 10000,
      userId = null
    } = options;

    // Detect search mode if not provided
    const detectedMode = searchMode || detectSearchMode(query, options.context || {});
    const threshold = getSearchThreshold(detectedMode);
    
    console.log(`🔍 [TIERED SEARCH] Starting search in mode: ${detectedMode} (threshold: ${threshold})`);

    try {
      // Tier 1: Victor Cache (Active Context Buffer)
      if (enableCache) {
        const victorResult = victorCache.search(query, {
          sessionId: sessionId,
          userId: userId,
          temporalBoost: true,
          exactMatchBoost: 2.0,
          minConfidence: minConfidence
        });
        
        if (victorResult.hit && victorResult.confidence >= minConfidence) {
          this.cacheStats.hits++;
          const duration = Date.now() - startTime;
          searchMetrics.recordSearch(duration, true, victorResult.confidence);
          
          console.log(`🧠 [TIER 1 - VICTOR CACHE] Hit with confidence ${victorResult.confidence.toFixed(3)} for "${query.substring(0, 30)}..."`);
          
          return {
            ...victorResult,
            searchTier: 'victor-cache',
            duration,
            searchMode: detectedMode,
            threshold,
            layer: victorResult.layer,
            source: victorResult.source
          };
        }
      }

      this.cacheStats.misses++;

      // Tier 2: Vector Search
      const vectorResult = await this.performVectorSearch(query, {
        ...options,
        limit,
        threshold,
        estimatedDatasetSize
      });

      if (vectorResult.success && vectorResult.results.length > 0) {
        const quality = assessResultQuality(vectorResult.results, threshold);
        
        // Check if we have high confidence results
        if (quality.confidence >= minConfidence) {
          const duration = Date.now() - startTime;
          searchMetrics.recordSearch(duration, false, quality.confidence);
          
          console.log(`🎯 [TIER 2 - VECTOR] High confidence results found: ${quality.reason}`);
          
          // Cache the result in our internal cache
          if (enableCache) {
            const cacheKey = this.generateCacheKey(query, options);
            this.cache.set(cacheKey, {
              ...vectorResult,
              confidence: quality.confidence,
              quality: quality.quality
            });
          }

          return {
            ...vectorResult,
            searchTier: 'vector',
            duration,
            searchMode: detectedMode,
            threshold,
            quality: quality.quality,
            confidence: quality.confidence
          };
        }
      }

      // Tier 3: Session-level Deep Search
      const deepResult = await this.performDeepSearch(query, {
        ...options,
        limit,
        threshold
      });

      const duration = Date.now() - startTime;
      searchMetrics.recordSearch(duration, false, 0.5); // Lower confidence for deep search

      console.log(`🔍 [TIER 3 - DEEP] Deep search completed with ${deepResult.totalFound} results`);

      return {
        ...deepResult,
        searchTier: 'deep',
        duration,
        searchMode: detectedMode,
        threshold,
        quality: 'deep',
        confidence: 0.5
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      searchMetrics.recordSearch(duration, false, 0);
      
      console.error('❌ [TIERED SEARCH] Search failed:', error);
      return {
        success: false,
        message: `Tiered search failed: ${error.message}`,
        results: [],
        searchTier: 'error',
        duration,
        searchMode: detectedMode,
        threshold
      };
    }
  }

  /**
   * Perform vector search with optimized numCandidates
   */
  async performVectorSearch(query, options) {
    const {
      limit,
      threshold,
      estimatedDatasetSize,
      sessionId,
      dateRange,
      roleFilter
    } = options;

    try {
      // Generate query vector
      const queryVector = await generateEmbedding(query);

      // Calculate optimal numCandidates
      const numCandidates = calculateNumCandidates(limit, estimatedDatasetSize);

      // Build aggregation pipeline
      const pipeline = [
        {
          $vectorSearch: {
            index: "vector_index",
            path: "embedding",
            queryVector: queryVector,
            numCandidates: numCandidates,
            limit: limit,
            filter: this.buildFilters(sessionId, dateRange, roleFilter)
          }
        },
        {
          $lookup: {
            from: "sessions",
            localField: "session",
            foreignField: "_id",
            as: "sessionInfo"
          }
        },
        {
          $project: {
            content: 1,
            role: 1,
            score: { $meta: "vectorSearchScore" },
            sessionId: "$sessionInfo.sessionId",
            sessionTopic: "$sessionInfo.topic",
            createdAt: 1
          }
        }
      ];

      // Import Message model
      const Message = await import('../models/Message.js');
      const results = await Message.default.aggregate(pipeline);
      
      // Filter by threshold
      const filteredResults = results.filter(result => result.score >= threshold);

      return {
        success: true,
        results: filteredResults,
        query: query,
        totalFound: filteredResults.length,
        similarityThreshold: threshold,
        numCandidates: numCandidates
      };

    } catch (error) {
      console.error('Error during vector search:', error);
      return {
        success: false,
        message: `Vector search failed: ${error.message}`,
        results: []
      };
    }
  }

  /**
   * Perform deep session-level search
   */
  async performDeepSearch(query, options) {
    const {
      limit,
      threshold,
      dateRange
    } = options;

    try {
      // Generate query vector
      const queryVector = await generateEmbedding(query);

      // Build session search pipeline
      const pipeline = [
        {
          $vectorSearch: {
            index: "session_vector_index",
            path: "sessionEmbedding",
            queryVector: queryVector,
            numCandidates: limit * 5,
            limit: limit,
            filter: this.buildSessionFilters(dateRange)
          }
        },
        {
          $project: {
            sessionId: 1,
            topic: 1,
            summary: 1,
            category: 1,
            score: { $meta: "vectorSearchScore" },
            lastActivity: 1
          }
        }
      ];

      // Import Session model
      const Session = await import('../models/Session.js');
      const results = await Session.default.aggregate(pipeline);
      
      // Filter by threshold
      const filteredResults = results.filter(result => result.score >= threshold);

      return {
        success: true,
        results: filteredResults,
        query: query,
        totalFound: filteredResults.length,
        similarityThreshold: threshold
      };

    } catch (error) {
      console.error('Error during deep search:', error);
      return {
        success: false,
        message: `Deep search failed: ${error.message}`,
        results: []
      };
    }
  }

  /**
   * Build filters for message search
   */
  buildFilters(sessionId, dateRange, roleFilter) {
    const filter = {};
    
    if (sessionId) filter.session = sessionId;
    if (roleFilter) filter.role = roleFilter;
    if (dateRange) {
      filter.createdAt = {
        $gte: dateRange.start,
        $lte: dateRange.end
      };
    }
    
    return filter;
  }

  /**
   * Build filters for session search
   */
  buildSessionFilters(dateRange) {
    const filter = {};
    if (dateRange) {
      filter.lastActivity = {
        $gte: dateRange.start,
        $lte: dateRange.end
      };
    }
    return filter;
  }

  /**
   * Generate cache key for query and options
   */
  generateCacheKey(query, options) {
    const keyData = {
      query: query.toLowerCase().trim(),
      sessionId: options.sessionId,
      roleFilter: options.roleFilter,
      dateRange: options.dateRange ? `${options.dateRange.start}-${options.dateRange.end}` : null
    };
    
    return JSON.stringify(keyData);
  }

  /**
   * Parses natural language date expressions into a dateRange object
   */
  async parseDateRangeOptions(options) {
    const { after, before, dateRange } = options;
    if (dateRange) return dateRange;

    const result = {};

    if (after) {
      const parsed = await dateTimeTool.handler({ action: 'parseNaturalLanguage', expression: after });
      if (parsed && !parsed.startsWith('Error')) result.start = new Date(parsed);
    }

    if (before) {
      const parsed = await dateTimeTool.handler({ action: 'parseNaturalLanguage', expression: before });
      if (parsed && !parsed.startsWith('Error')) result.end = new Date(parsed);
    }

    // If we have a start but no end, assume 'until now'
    if (result.start && !result.end) {
      result.end = new Date();
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const hitRate = this.cacheStats.totalRequests > 0 
      ? (this.cacheStats.hits / this.cacheStats.totalRequests) * 100 
      : 0;

    return {
      totalRequests: this.cacheStats.totalRequests,
      cacheHits: this.cacheStats.hits,
      cacheMisses: this.cacheStats.misses,
      hitRate: hitRate,
      cacheSize: this.cache.size()
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('🧹 [TIERED SEARCH] Cache cleared');
  }

  /**
   * Get search performance metrics
   */
  getMetrics() {
    return {
      cacheStats: this.getCacheStats(),
      searchMetrics: searchMetrics.getMetrics()
    };
  }
}

// Export singleton instance
export const tieredSearch = new TieredSearchOrchestrator();

/**
 * Health check for tiered search service
 */
export async function checkTieredSearchHealth() {
  try {
    const testQuery = "test search query";
    const result = await tieredSearch.search(testQuery, { limit: 1 });
    
    const isHealthy = result.success && result.searchTier !== 'error';
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      message: isHealthy ? 'Tiered search service is healthy' : 'Tiered search service failed health check',
      details: {
        cacheStats: tieredSearch.getCacheStats(),
        searchMetrics: searchMetrics.getMetrics(),
        lastResult: result
      }
    };
  } catch (error) {
    return {
      status: 'error',
      message: `Tiered search health check failed: ${error.message}`,
      details: {
        error: error.message
      }
    };
  }
}