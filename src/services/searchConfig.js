// searchConfig.js
// Configuration and utilities for enhanced semantic search

/**
 * Dynamic threshold configuration based on search mode
 */
export const SEARCH_THRESHOLDS = {
  'victor-code': 0.8,      // High precision for code analysis
  'sentinel-triage': 0.7,  // Balanced for issue detection  
  'general-search': 0.6,   // High recall for general queries
  'default': 0.65          // Fallback threshold
};

/**
 * Search mode detection based on query patterns and context
 */
export function detectSearchMode(query, context = {}) {
  const queryLower = (query || '').toLowerCase();
  
  // Victor/Code mode indicators
  const codePatterns = [
    /function|method|class|interface|type|variable|const|let|var/i,
    /bug|error|fix|debug|issue|problem/i,
    /optimization|performance|refactor|architecture/i,
    /javascript|typescript|python|java|rust|go/i,
    /api|endpoint|database|query|schema/i
  ];
  
  // Sentinel/Triage mode indicators  
  const triagePatterns = [
    /duplicate|similar|same|again|repeat/i,
    /help|support|troubleshoot|assistance/i,
    /urgent|critical|emergency|immediate/i,
    /how to|tutorial|guide|example/i
  ];
  
  // Check for Victor patterns
  const hasCodePattern = codePatterns.some(pattern => pattern.test(queryLower));
  
  // Check for Sentinel patterns
  const hasTriagePattern = triagePatterns.some(pattern => pattern.test(queryLower));
  
  // Context-based detection
  const isVictorMode = context.mode === 'victor' || context.role === 'developer';
  const isSentinelMode = context.mode === 'sentinel' || context.role === 'support';
  
  // Priority: Context > Patterns > Default
  if (isVictorMode || hasCodePattern) {
    return 'victor-code';
  } else if (isSentinelMode || hasTriagePattern) {
    return 'sentinel-triage';
  }
  
  return 'general-search';
}

/**
 * Get appropriate threshold for search mode
 */
export function getSearchThreshold(mode) {
  return SEARCH_THRESHOLDS[mode] || SEARCH_THRESHOLDS.default;
}

/**
 * Calculate optimal numCandidates based on dataset size and performance requirements
 */
export function calculateNumCandidates(limit, estimatedDatasetSize = 10000) {
  // Minimum candidates for quality results
  const minimumCandidates = 100;
  
  // Scale candidates based on dataset size
  const scaleFactor = estimatedDatasetSize > 50000 ? 25 : 20;
  
  // Calculate candidates with minimum floor
  const calculatedCandidates = Math.max(minimumCandidates, limit * scaleFactor);
  
  // Cap at reasonable maximum to prevent performance issues
  return Math.min(calculatedCandidates, 1000);
}

/**
 * Enhanced search configuration with performance optimizations
 */
export const SEARCH_CONFIG = {
  // Performance settings
  maxResults: 20,
  defaultLimit: 5,
  contextSize: 5,
  
  // Caching settings
  enableCache: true,
  cacheTTL: 5 * 60 * 1000, // 5 minutes
  
  // Vector search settings
  similarityMetric: 'cosine',
  minScoreThreshold: 0.5,
  
  // Batch processing
  batchSize: 100,
  maxConcurrentRequests: 3
};

/**
 * Search result quality assessment
 */
export function assessResultQuality(results, threshold) {
  if (!results || results.length === 0) {
    return {
      quality: 'poor',
      reason: 'No results found',
      confidence: 0
    };
  }
  
  const highQualityResults = results.filter(r => r.score >= threshold);
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  
  if (highQualityResults.length === 0) {
    return {
      quality: 'poor',
      reason: 'No results meet threshold',
      confidence: avgScore
    };
  }
  
  if (highQualityResults.length >= 3 && avgScore >= threshold + 0.1) {
    return {
      quality: 'excellent',
      reason: 'Multiple high-quality matches',
      confidence: avgScore
    };
  }
  
  if (highQualityResults.length >= 1) {
    return {
      quality: 'good',
      reason: 'At least one good match found',
      confidence: avgScore
    };
  }
  
  return {
    quality: 'fair',
    reason: 'Results below optimal threshold',
    confidence: avgScore
  };
}

/**
 * Search performance metrics with enhanced tracking
 */
export class SearchMetrics {
  constructor() {
    this.metrics = {
      totalSearches: 0,
      searchTimes: [],
      cacheHits: 0,
      cacheMisses: 0,
      qualityScores: [],
      tierDistribution: {
        'victor-cache': 0,
        'vector': 0,
        'deep': 0,
        'error': 0
      },
      searchModes: {
        'victor-code': 0,
        'sentinel-triage': 0,
        'general-search': 0
      },
      costTracking: {
        embeddingCalls: 0,
        vectorSearchCalls: 0,
        deepSearchCalls: 0,
        estimatedCost: 0 // in USD
      },
      latencyBreakdown: {
        victorCache: [],
        vectorSearch: [],
        deepSearch: []
      }
    };
  }
  
  recordSearch(duration, cacheHit = false, quality = null, tier = 'unknown', searchMode = 'unknown') {
    this.metrics.totalSearches++;
    this.metrics.searchTimes.push(duration);
    this.metrics.searchTimes = this.metrics.searchTimes.slice(-100); // Keep last 100
    
    // Track tier distribution
    if (this.metrics.tierDistribution[tier] !== undefined) {
      this.metrics.tierDistribution[tier]++;
    }
    
    // Track search modes
    if (this.metrics.searchModes[searchMode] !== undefined) {
      this.metrics.searchModes[searchMode]++;
    }
    
    if (cacheHit) {
      this.metrics.cacheHits++;
      this.metrics.latencyBreakdown.victorCache.push(duration);
    } else {
      this.metrics.cacheMisses++;
      // Track latency by tier for non-cache hits
      if (tier === 'vector') {
        this.metrics.latencyBreakdown.vectorSearch.push(duration);
        this.metrics.costTracking.vectorSearchCalls++;
        this.metrics.costTracking.embeddingCalls++; // Each vector search requires an embedding
      } else if (tier === 'deep') {
        this.metrics.latencyBreakdown.deepSearch.push(duration);
        this.metrics.costTracking.deepSearchCalls++;
        this.metrics.costTracking.embeddingCalls++; // Each deep search requires an embedding
      } else if (tier === 'error') {
        // Error tracking
      }
    }
    
    if (quality) {
      this.metrics.qualityScores.push(quality);
      this.metrics.qualityScores = this.metrics.qualityScores.slice(-100);
    }
    
    // Calculate estimated cost (assuming $0.0001 per embedding call)
    this.metrics.costTracking.estimatedCost = this.metrics.costTracking.embeddingCalls * 0.0001;
  }
  
  getAverageSearchTime() {
    if (this.metrics.searchTimes.length === 0) return 0;
    const sum = this.metrics.searchTimes.reduce((a, b) => a + b, 0);
    return sum / this.metrics.searchTimes.length;
  }
  
  getCacheHitRate() {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    if (total === 0) return 0;
    return (this.metrics.cacheHits / total) * 100;
  }
  
  getAverageQualityScore() {
    if (this.metrics.qualityScores.length === 0) return 0;
    const sum = this.metrics.qualityScores.reduce((a, b) => a + b, 0);
    return sum / this.metrics.qualityScores.length;
  }
  
  getTierDistribution() {
    const total = Object.values(this.metrics.tierDistribution).reduce((a, b) => a + b, 0);
    if (total === 0) return {};
    
    const distribution = {};
    for (const [tier, count] of Object.entries(this.metrics.tierDistribution)) {
      distribution[tier] = {
        count: count,
        percentage: (count / total) * 100
      };
    }
    return distribution;
  }
  
  getSearchModeDistribution() {
    const total = Object.values(this.metrics.searchModes).reduce((a, b) => a + b, 0);
    if (total === 0) return {};
    
    const distribution = {};
    for (const [mode, count] of Object.entries(this.metrics.searchModes)) {
      distribution[mode] = {
        count: count,
        percentage: (count / total) * 100
      };
    }
    return distribution;
  }
  
  getLatencyBreakdown() {
    const breakdown = {};
    
    for (const [tier, times] of Object.entries(this.metrics.latencyBreakdown)) {
      if (times.length === 0) {
        breakdown[tier] = {
          avgLatency: 0,
          minLatency: 0,
          maxLatency: 0,
          count: 0
        };
      } else {
        const sum = times.reduce((a, b) => a + b, 0);
        breakdown[tier] = {
          avgLatency: sum / times.length,
          minLatency: Math.min(...times),
          maxLatency: Math.max(...times),
          count: times.length
        };
      }
    }
    
    return breakdown;
  }
  
  getCostAnalysis() {
    return {
      totalEmbeddingCalls: this.metrics.costTracking.embeddingCalls,
      vectorSearchCalls: this.metrics.costTracking.vectorSearchCalls,
      deepSearchCalls: this.metrics.costTracking.deepSearchCalls,
      estimatedCostUSD: this.metrics.costTracking.estimatedCost,
      costPerSearch: this.metrics.totalSearches > 0 
        ? this.metrics.costTracking.estimatedCost / this.metrics.totalSearches 
        : 0
    };
  }
  
  getPerformanceSummary() {
    const latencyBreakdown = this.getLatencyBreakdown();
    const tierDistribution = this.getTierDistribution();
    const searchModeDistribution = this.getSearchModeDistribution();
    
    return {
      summary: {
        totalSearches: this.metrics.totalSearches,
        averageSearchTime: this.getAverageSearchTime(),
        cacheHitRate: this.getCacheHitRate(),
        averageQualityScore: this.getAverageQualityScore(),
        estimatedCostUSD: this.metrics.costTracking.estimatedCost
      },
      tierPerformance: {
        victorCache: latencyBreakdown['victorCache'] || { avgLatency: 0, count: 0 },
        vectorSearch: latencyBreakdown['vectorSearch'] || { avgLatency: 0, count: 0 },
        deepSearch: latencyBreakdown['deepSearch'] || { avgLatency: 0, count: 0 }
      },
      distribution: {
        tiers: tierDistribution,
        searchModes: searchModeDistribution
      },
      costAnalysis: this.getCostAnalysis(),
      compliance: {
        victorCacheUnder10ms: latencyBreakdown['victorCache']?.avgLatency <= 10 || false,
        vectorSearchUnder500ms: latencyBreakdown['vectorSearch']?.avgLatency <= 500 || false,
        deepSearchUnder1200ms: latencyBreakdown['deepSearch']?.avgLatency <= 1200 || false
      }
    };
  }
  
  getMetrics() {
    return {
      totalSearches: this.metrics.totalSearches,
      averageSearchTime: this.getAverageSearchTime(),
      cacheHitRate: this.getCacheHitRate(),
      averageQualityScore: this.getAverageQualityScore(),
      tierDistribution: this.getTierDistribution(),
      searchModeDistribution: this.getSearchModeDistribution(),
      latencyBreakdown: this.getLatencyBreakdown(),
      costAnalysis: this.getCostAnalysis()
    };
  }
  
  reset() {
    this.metrics = {
      totalSearches: 0,
      searchTimes: [],
      cacheHits: 0,
      cacheMisses: 0,
      qualityScores: [],
      tierDistribution: {
        'victor-cache': 0,
        'vector': 0,
        'deep': 0,
        'error': 0
      },
      searchModes: {
        'victor-code': 0,
        'sentinel-triage': 0,
        'general-search': 0
      },
      costTracking: {
        embeddingCalls: 0,
        vectorSearchCalls: 0,
        deepSearchCalls: 0,
        estimatedCost: 0
      },
      latencyBreakdown: {
        victorCache: [],
        vectorSearch: [],
        deepSearch: []
      }
    };
  }
}

export const searchMetrics = new SearchMetrics();
