// phase2-core-test.js
// Core Phase 2 test without MongoDB dependencies
// Tests Victor Cache, Tiered Search logic, and Agent integration

import { VictorCache } from '../services/VictorCache.js';
import { tieredSearch } from '../services/tieredSearchService.js';
import { searchMetrics } from '../services/searchConfig.js';

/**
 * Core Phase 2 Test Suite (No MongoDB Required)
 */
export class Phase2CoreTest {
  constructor() {
    this.testResults = [];
    this.victorCache = new VictorCache();
  }

  /**
   * Run all core Phase 2 tests
   */
  async runAllTests() {
    console.log('🧪 [PHASE 2 CORE TEST SUITE] Starting tests without MongoDB...\n');
    
    const tests = [
      { name: 'Victor Cache Performance', test: () => this.testVictorCachePerformance() },
      { name: 'Victor Cache Dual-Layer', test: () => this.testVictorCacheDualLayer() },
      { name: 'Tiered Search Logic', test: () => this.testTieredSearchLogic() },
      { name: 'Performance Metrics', test: () => this.testPerformanceMetrics() },
      { name: 'Cost Optimization', test: () => this.testCostOptimization() }
    ];

    for (const { name, test } of tests) {
      try {
        console.log(`🧪 [TEST] ${name}`);
        const result = await test();
        this.testResults.push({ name, ...result });
        console.log(`✅ ${name}: ${result.success ? 'PASSED' : 'FAILED'}\n`);
      } catch (error) {
        console.error(`❌ ${name}: FAILED - ${error.message}\n`);
        this.testResults.push({
          name,
          success: false,
          error: error.message,
          duration: 0
        });
      }
    }

    this.printTestSummary();
    return this.testResults;
  }

  /**
   * Test Victor Cache performance (sub-10ms requirement)
   */
  async testVictorCachePerformance() {
    const startTime = Date.now();
    
    // Create test messages
    const testMessages = [
      { id: 'msg1', content: 'Hello, this is a test message about function optimization', role: 'user' },
      { id: 'msg2', content: 'I need help with a bug in my JavaScript code', role: 'user' },
      { id: 'msg3', content: 'The function is not working as expected', role: 'assistant' },
      { id: 'msg4', content: 'Let me check the database connection', role: 'user' },
      { id: 'msg5', content: 'API endpoint returns 500 error', role: 'user' }
    ];

    // Update Layer A
    this.victorCache.updateLayerA(testMessages);

    // Test search performance
    const searchStartTime = Date.now();
    const result = this.victorCache.search('function optimization', {
      minConfidence: 0.8
    });
    const searchDuration = Date.now() - searchStartTime;

    const success = result.hit && searchDuration < 10;
    
    return {
      success,
      duration: Date.now() - startTime,
      details: {
        searchDuration: searchDuration,
        hit: result.hit,
        confidence: result.confidence,
        layer: result.layer
      }
    };
  }

  /**
   * Test Victor Cache dual-layer functionality
   */
  async testVictorCacheDualLayer() {
    const startTime = Date.now();

    // Test Layer A (current session)
    const currentMessages = [
      { id: 'msg1', content: 'Current session: How do I fix this bug?', role: 'user' },
      { id: 'msg2', content: 'The function is broken', role: 'assistant' }
    ];
    this.victorCache.updateLayerA(currentMessages);

    // Test Layer B (recent sessions)
    const recentSessionData = {
      messages: [
        { id: 'msg1', content: 'Previous session: Database optimization techniques', role: 'user' },
        { id: 'msg2', content: 'SQL query performance issues', role: 'assistant' }
      ],
      summary: 'Database optimization discussion',
      topic: 'Database Performance'
    };
    this.victorCache.updateLayerB('session_123', recentSessionData);

    // Test Layer A search
    const layerAResult = this.victorCache.search('fix this bug', { minConfidence: 0.8 });
    
    // Test Layer B search
    const layerBResult = this.victorCache.search('database optimization', { 
      userId: 'user_123',
      minConfidence: 0.8 
    });

    const success = layerAResult.hit && layerBResult.hit;

    return {
      success,
      duration: Date.now() - startTime,
      details: {
        layerAHit: layerAResult.hit,
        layerBHit: layerBResult.hit,
        layerAConfidence: layerAResult.confidence,
        layerBConfidence: layerBResult.confidence
      }
    };
  }

  /**
   * Test Tiered Search logic (mocked)
   */
  async testTieredSearchLogic() {
    const startTime = Date.now();

    // Mock the tiered search to test Victor Cache integration
    const mockQuery = 'test search query';
    const mockOptions = {
      limit: 5,
      sessionId: 'test_session',
      enableCache: true,
      minConfidence: 0.9
    };

    // Test that tiered search properly calls Victor Cache
    const result = await tieredSearch.search(mockQuery, mockOptions);

    // For this test, we expect it to hit Victor Cache (Tier 1)
    const success = result.searchTier === 'victor-cache' || result.searchTier === 'cache';

    return {
      success,
      duration: Date.now() - startTime,
      details: {
        searchTier: result.searchTier,
        confidence: result.confidence,
        duration: result.duration
      }
    };
  }

  /**
   * Test performance metrics tracking
   */
  async testPerformanceMetrics() {
    const startTime = Date.now();

    // Reset metrics
    searchMetrics.reset();

    // Perform multiple searches to generate metrics
    for (let i = 0; i < 5; i++) {
      const result = this.victorCache.search(`test query ${i}`, { minConfidence: 0.8 });
      searchMetrics.recordSearch(result.duration, result.hit, result.confidence, 'victor-cache', 'general-search');
    }

    const metrics = searchMetrics.getPerformanceSummary();

    const success = metrics.summary.totalSearches === 5 &&
                   metrics.compliance.victorCacheUnder10ms === true;

    return {
      success,
      duration: Date.now() - startTime,
      details: {
        totalSearches: metrics.summary.totalSearches,
        averageSearchTime: metrics.summary.averageSearchTime,
        compliance: metrics.compliance
      }
    };
  }

  /**
   * Test cost optimization
   */
  async testCostOptimization() {
    const startTime = Date.now();

    // Reset metrics
    searchMetrics.reset();

    // Test that Victor Cache hits reduce costs
    const cacheHitResult = this.victorCache.search('cache hit test', { minConfidence: 0.9 });
    searchMetrics.recordSearch(cacheHitResult.duration, true, cacheHitResult.confidence, 'victor-cache', 'general-search');

    // Test that cache misses incur costs
    const cacheMissResult = { duration: 500, confidence: 0.8 };
    searchMetrics.recordSearch(cacheMissResult.duration, false, cacheMissResult.confidence, 'vector', 'general-search');

    const costAnalysis = searchMetrics.getCostAnalysis();

    const success = costAnalysis.estimatedCost >= 0 && 
                   costAnalysis.totalEmbeddingCalls === 1; // Only one embedding call for cache miss

    return {
      success,
      duration: Date.now() - startTime,
      details: {
        estimatedCost: costAnalysis.estimatedCost,
        embeddingCalls: costAnalysis.totalEmbeddingCalls,
        costPerSearch: costAnalysis.costPerSearch
      }
    };
  }

  /**
   * Print comprehensive test summary
   */
  printTestSummary() {
    console.log('📊 [PHASE 2 CORE TEST SUMMARY]\n');
    
    const passedTests = this.testResults.filter(r => r.success).length;
    const totalTests = this.testResults.length;
    const successRate = (passedTests / totalTests) * 100;

    console.log(`Overall Results: ${passedTests}/${totalTests} tests passed (${successRate.toFixed(1)}%)`);
    console.log(`Total Duration: ${this.testResults.reduce((sum, r) => sum + r.duration, 0)}ms\n`);

    console.log('Detailed Results:');
    this.testResults.forEach(result => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.name}: ${result.duration}ms`);
      if (!result.success && result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    // Print metrics summary if available
    const metrics = searchMetrics.getPerformanceSummary();
    if (metrics.summary.totalSearches > 0) {
      console.log('\n📈 Performance Metrics:');
      console.log(`   Total Searches: ${metrics.summary.totalSearches}`);
      console.log(`   Average Search Time: ${metrics.summary.averageSearchTime.toFixed(2)}ms`);
      console.log(`   Estimated Cost: $${metrics.summary.estimatedCostUSD.toFixed(4)}`);
      console.log(`   Compliance: ${metrics.compliance.victorCacheUnder10ms ? '✅' : '❌'} Victor Cache <10ms`);
      console.log(`   Compliance: ${metrics.compliance.vectorSearchUnder500ms ? '✅' : '❌'} Vector Search <500ms`);
    }
  }

  /**
   * Run specific test by name
   */
  async runSpecificTest(testName) {
    const test = this.testResults.find(r => r.name === testName);
    if (test) {
      console.log(`🧪 [SPECIFIC TEST] ${testName}`);
      console.log(`Result: ${test.success ? 'PASSED' : 'FAILED'}`);
      console.log(`Duration: ${test.duration}ms`);
      console.log(`Details:`, test.details);
    } else {
      console.log(`❌ Test "${testName}" not found`);
    }
  }
}

/**
 * Run tests if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const testSuite = new Phase2CoreTest();
  testSuite.runAllTests().then(results => {
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    process.exit(passed === total ? 0 : 1);
  });
}

export default Phase2CoreTest;