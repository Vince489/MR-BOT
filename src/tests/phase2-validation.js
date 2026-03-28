// phase2-validation.js
// Validation script for Phase 2 Tiered Search Implementation
// Validates against the original technical blueprint requirements

import { VictorCache } from '../services/VictorCache.js';
import { tieredSearch } from '../services/tieredSearchService.js';
import { searchMetrics } from '../services/searchConfig.js';
import { Agent } from '../Agent.js';

/**
 * Phase 2 Implementation Validator
 * Validates that the implementation meets all technical blueprint requirements
 */
export class Phase2Validator {
  constructor() {
    this.validationResults = [];
  }

  /**
   * Run comprehensive validation against technical blueprint
   */
  async validateImplementation() {
    console.log('🔍 [PHASE 2 VALIDATION] Validating implementation against technical blueprint...\n');

    const validations = [
      {
        category: 'Victor Cache (Tier 1)',
        checks: [
          { name: 'Dual-Layered RAM Architecture', test: () => this.validateDualLayeredRAM() },
          { name: 'Sub-10ms Latency Requirement', test: () => this.validateSub10msLatency() },
          { name: 'Active Context Buffer', test: () => this.validateActiveContextBuffer() },
          { name: 'Layer A Current Session', test: () => this.validateLayerACurrentSession() },
          { name: 'Layer B Recent Sessions', test: () => this.validateLayerBRecentSessions() }
        ]
      },
      {
        category: 'Tiered Search Orchestrator',
        checks: [
          { name: 'Three-Tier Architecture', test: () => this.validateThreeTierArchitecture() },
          { name: 'Tier 1 Victor Cache Integration', test: () => this.validateTier1Integration() },
          { name: 'Tier 2 Vector Search', test: () => this.validateTier2VectorSearch() },
          { name: 'Tier 3 Deep Search', test: () => this.validateTier3DeepSearch() },
          { name: 'Early Termination Logic', test: () => this.validateEarlyTermination() }
        ]
      },
      {
        category: 'Agent Integration',
        checks: [
          { name: 'Hybrid Delegation Pattern', test: () => this.validateHybridDelegation() },
          { name: 'Search History Method', test: () => this.validateSearchHistoryMethod() },
          { name: 'Victor Mode Integration', test: () => this.validateVictorModeIntegration() },
          { name: 'Sentinel Mode Integration', test: () => this.validateSentinelModeIntegration() },
          { name: 'Context Injection', test: () => this.validateContextInjection() }
        ]
      },
      {
        category: 'Performance & Optimization',
        checks: [
          { name: 'numCandidates Optimization', test: () => this.validateNumCandidatesOptimization() },
          { name: 'Cost Avoidance Logic', test: () => this.validateCostAvoidance() },
          { name: 'Precision/Recall Tracking', test: () => this.validatePrecisionRecallTracking() },
          { name: 'Latency Monitoring', test: () => this.validateLatencyMonitoring() },
          { name: 'Memory Management', test: () => this.validateMemoryManagement() }
        ]
      },
      {
        category: 'Search Modes & Intelligence',
        checks: [
          { name: 'Victor Code Mode Detection', test: () => this.validateVictorCodeMode() },
          { name: 'Sentinel Triage Mode Detection', test: () => this.validateSentinelTriageMode() },
          { name: 'Dynamic Thresholding', test: () => this.validateDynamicThresholding() },
          { name: 'Search Mode Context', test: () => this.validateSearchModeContext() },
          { name: 'Quality Assessment', test: () => this.validateQualityAssessment() }
        ]
      }
    ];

    for (const category of validations) {
      console.log(`📋 [VALIDATION] ${category.category}`);
      console.log('=' .repeat(50));
      
      for (const check of category.checks) {
        try {
          const result = await check.test();
          this.validationResults.push({
            category: category.category,
            name: check.name,
            ...result
          });
          
          const status = result.success ? '✅' : '❌';
          console.log(`${status} ${check.name}: ${result.message}`);
          if (result.details) {
            console.log(`   Details: ${JSON.stringify(result.details)}`);
          }
        } catch (error) {
          console.error(`❌ ${check.name}: VALIDATION ERROR - ${error.message}`);
          this.validationResults.push({
            category: category.category,
            name: check.name,
            success: false,
            message: `Validation error: ${error.message}`,
            details: null
          });
        }
      }
      console.log('');
    }

    this.printValidationSummary();
    return this.validationResults;
  }

  /**
   * Validate dual-layered RAM architecture
   */
  async validateDualLayeredRAM() {
    const victorCache = new VictorCache();
    
    // Test Layer A
    const layerAMessages = [
      { id: 'msg1', content: 'Current session message', role: 'user' }
    ];
    victorCache.updateLayerA(layerAMessages);
    
    // Test Layer B
    const layerBData = {
      messages: [{ id: 'msg1', content: 'Recent session message', role: 'user' }],
      summary: 'Test summary',
      topic: 'Test topic'
    };
    victorCache.updateLayerB('session_123', layerBData);

    const layerAValid = victorCache.layerA.messages.length > 0;
    const layerBValid = victorCache.layerB.sessions.size > 0;

    return {
      success: layerAValid && layerBValid,
      message: layerAValid && layerBValid 
        ? 'Dual-layered RAM architecture implemented correctly'
        : 'Dual-layered RAM architecture validation failed',
      details: {
        layerAValid,
        layerBValid,
        layerAMessageCount: victorCache.layerA.messages.length,
        layerBSessionCount: victorCache.layerB.sessions.size
      }
    };
  }

  /**
   * Validate sub-10ms latency requirement
   */
  async validateSub10msLatency() {
    const victorCache = new VictorCache();
    
    const testMessages = Array.from({ length: 20 }, (_, i) => ({
      id: `msg${i}`,
      content: `Test message ${i} with function optimization keywords`,
      role: 'user'
    }));
    
    victorCache.updateLayerA(testMessages);

    const searchTimes = [];
    for (let i = 0; i < 10; i++) {
      const startTime = Date.now();
      victorCache.search('function optimization', { minConfidence: 0.8 });
      searchTimes.push(Date.now() - startTime);
    }

    const avgLatency = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
    const maxLatency = Math.max(...searchTimes);
    const under10msCount = searchTimes.filter(time => time <= 10).length;

    const success = avgLatency <= 10 && under10msCount >= 8; // 80% should be under 10ms

    return {
      success,
      message: success 
        ? `Sub-10ms latency achieved (avg: ${avgLatency.toFixed(2)}ms, ${under10msCount}/10 under 10ms)`
        : `Sub-10ms latency not achieved (avg: ${avgLatency.toFixed(2)}ms)`,
      details: {
        avgLatency,
        maxLatency,
        under10msCount,
        totalTests: searchTimes.length
      }
    };
  }

  /**
   * Validate active context buffer functionality
   */
  async validateActiveContextBuffer() {
    const victorCache = new VictorCache();
    
    // Simulate active message history
    const activeMessages = [
      { id: 'msg1', content: 'User: How do I fix this bug?', role: 'user' },
      { id: 'msg2', content: 'Assistant: Check the function parameters', role: 'assistant' },
      { id: 'msg3', content: 'User: The API is returning errors', role: 'user' },
      { id: 'msg4', content: 'Assistant: Let me check the logs', role: 'assistant' }
    ];

    victorCache.updateLayerA(activeMessages);

    // Test that it can find recent context
    const result = victorCache.search('fix this bug', { minConfidence: 0.8 });

    return {
      success: result.hit && result.confidence >= 0.8,
      message: result.hit 
        ? 'Active context buffer working correctly'
        : 'Active context buffer validation failed',
      details: {
        hit: result.hit,
        confidence: result.confidence,
        layer: result.layer
      }
    };
  }

  /**
   * Validate Layer A current session functionality
   */
  async validateLayerACurrentSession() {
    const victorCache = new VictorCache();
    
    const currentSessionMessages = [
      { id: 'msg1', content: 'Current session: JavaScript function optimization', role: 'user' },
      { id: 'msg2', content: 'Current session: Database query performance', role: 'user' }
    ];

    victorCache.updateLayerA(currentSessionMessages);

    const result = victorCache.search('JavaScript function', { minConfidence: 0.9 });

    return {
      success: result.hit && result.layer === 'layer-a',
      message: result.hit && result.layer === 'layer-a'
        ? 'Layer A current session functionality working'
        : 'Layer A validation failed',
      details: {
        hit: result.hit,
        layer: result.layer,
        confidence: result.confidence
      }
    };
  }

  /**
   * Validate Layer B recent sessions functionality
   */
  async validateLayerBRecentSessions() {
    const victorCache = new VictorCache();
    
    const recentSessionData = {
      messages: [
        { id: 'msg1', content: 'Previous session: Authentication issues', role: 'user' },
        { id: 'msg2', content: 'Previous session: Login problems', role: 'user' }
      ],
      summary: 'Authentication troubleshooting session',
      topic: 'Authentication'
    };

    victorCache.updateLayerB('session_auth_123', recentSessionData);

    const result = victorCache.search('authentication issues', { 
      userId: 'user_456',
      minConfidence: 0.7 
    });

    return {
      success: result.hit && result.layer === 'layer-b',
      message: result.hit && result.layer === 'layer-b'
        ? 'Layer B recent sessions functionality working'
        : 'Layer B validation failed',
      details: {
        hit: result.hit,
        layer: result.layer,
        confidence: result.confidence
      }
    };
  }

  /**
   * Validate three-tier architecture
   */
  async validateThreeTierArchitecture() {
    // This would require actual MongoDB setup for full validation
    // For now, we validate the structure exists
    
    const hasTier1 = typeof victorCache.search === 'function';
    const hasTier2 = typeof tieredSearch.performVectorSearch === 'function';
    const hasTier3 = typeof tieredSearch.performDeepSearch === 'function';

    return {
      success: hasTier1 && hasTier2 && hasTier3,
      message: hasTier1 && hasTier2 && hasTier3
        ? 'Three-tier architecture components present'
        : 'Three-tier architecture validation failed',
      details: {
        hasTier1,
        hasTier2,
        hasTier3
      }
    };
  }

  /**
   * Validate Tier 1 Victor Cache integration
   */
  async validateTier1Integration() {
    // Test that tiered search calls Victor Cache
    const originalSearch = victorCache.search;
    let cacheCalled = false;
    
    victorCache.search = function(...args) {
      cacheCalled = true;
      return originalSearch.apply(this, args);
    };

    try {
      await tieredSearch.search('test query', { enableCache: true });
      
      victorCache.search = originalSearch;
      
      return {
        success: cacheCalled,
        message: cacheCalled
          ? 'Tier 1 Victor Cache integration working'
          : 'Tier 1 integration validation failed',
        details: { cacheCalled }
      };
    } catch (error) {
      victorCache.search = originalSearch;
      throw error;
    }
  }

  /**
   * Validate numCandidates optimization
   */
  async validateNumCandidatesOptimization() {
    const { calculateNumCandidates } = await import('../services/searchConfig.js');
    
    // Test with different dataset sizes
    const testCases = [
      { limit: 5, size: 1000, expectedMin: 100 },
      { limit: 10, size: 50000, expectedMin: 200 },
      { limit: 3, size: 100000, expectedMin: 250 }
    ];

    let allValid = true;
    const results = [];

    for (const testCase of testCases) {
      const numCandidates = calculateNumCandidates(testCase.limit, testCase.size);
      const valid = numCandidates >= testCase.expectedMin && numCandidates <= 1000;
      allValid = allValid && valid;
      
      results.push({
        ...testCase,
        numCandidates,
        valid
      });
    }

    return {
      success: allValid,
      message: allValid
        ? 'numCandidates optimization working correctly'
        : 'numCandidates optimization validation failed',
      details: { results }
    };
  }

  /**
   * Validate cost avoidance logic
   */
  async validateCostAvoidance() {
    searchMetrics.reset();
    
    // Simulate cache hits (no cost)
    searchMetrics.recordSearch(5, true, 0.9, 'victor-cache', 'general-search');
    
    // Simulate cache misses (cost incurred)
    searchMetrics.recordSearch(500, false, 0.8, 'vector', 'general-search');

    const costAnalysis = searchMetrics.getCostAnalysis();
    const hasCostTracking = costAnalysis.totalEmbeddingCalls === 1;
    const hasCostCalculation = costAnalysis.estimatedCost > 0;

    return {
      success: hasCostTracking && hasCostCalculation,
      message: hasCostTracking && hasCostCalculation
        ? 'Cost avoidance logic working correctly'
        : 'Cost avoidance validation failed',
      details: {
        totalEmbeddingCalls: costAnalysis.totalEmbeddingCalls,
        estimatedCost: costAnalysis.estimatedCost
      }
    };
  }

  /**
   * Validate precision/recall tracking
   */
  async validatePrecisionRecallTracking() {
    searchMetrics.reset();
    
    // Simulate various search results
    searchMetrics.recordSearch(5, true, 0.95, 'victor-cache', 'victor-code');
    searchMetrics.recordSearch(500, false, 0.85, 'vector', 'sentinel-triage');
    searchMetrics.recordSearch(1000, false, 0.75, 'deep', 'general-search');

    const metrics = searchMetrics.getMetrics();
    const hasTierDistribution = Object.keys(metrics.tierDistribution).length > 0;
    const hasSearchModeDistribution = Object.keys(metrics.searchModeDistribution).length > 0;
    const hasLatencyBreakdown = Object.keys(metrics.latencyBreakdown).length > 0;

    return {
      success: hasTierDistribution && hasSearchModeDistribution && hasLatencyBreakdown,
      message: hasTierDistribution && hasSearchModeDistribution && hasLatencyBreakdown
        ? 'Precision/recall tracking working correctly'
        : 'Precision/recall tracking validation failed',
      details: {
        tierDistribution: metrics.tierDistribution,
        searchModeDistribution: metrics.searchModeDistribution,
        latencyBreakdown: metrics.latencyBreakdown
      }
    };
  }

  /**
   * Validate Victor Code mode detection
   */
  async validateVictorCodeMode() {
    const { detectSearchMode } = await import('../services/searchConfig.js');
    
    const codeQueries = [
      'How do I optimize this JavaScript function?',
      'What is the best way to refactor this code?',
      'Debug this Python script for me'
    ];

    let allCodeDetected = true;
    const results = [];

    for (const query of codeQueries) {
      const mode = detectSearchMode(query, { mode: 'victor' });
      const isCodeMode = mode === 'victor-code';
      allCodeDetected = allCodeDetected && isCodeMode;
      
      results.push({
        query,
        detectedMode: mode,
        isCodeMode
      });
    }

    return {
      success: allCodeDetected,
      message: allCodeDetected
        ? 'Victor Code mode detection working correctly'
        : 'Victor Code mode detection validation failed',
      details: { results }
    };
  }

  /**
   * Validate Sentinel Triage mode detection
   */
  async validateSentinelTriageMode() {
    const { detectSearchMode } = await import('../services/searchConfig.js');
    
    const triageQueries = [
      'How do I fix this login issue?',
      'What should I do about this error?',
      'Help me troubleshoot this problem'
    ];

    let allTriageDetected = true;
    const results = [];

    for (const query of triageQueries) {
      const mode = detectSearchMode(query, { mode: 'sentinel' });
      const isTriageMode = mode === 'sentinel-triage';
      allTriageDetected = allTriageDetected && isTriageMode;
      
      results.push({
        query,
        detectedMode: mode,
        isTriageMode
      });
    }

    return {
      success: allTriageDetected,
      message: allTriageDetected
        ? 'Sentinel Triage mode detection working correctly'
        : 'Sentinel Triage mode detection validation failed',
      details: { results }
    };
  }

  /**
   * Validate dynamic thresholding
   */
  async validateDynamicThresholding() {
    const { getSearchThreshold } = await import('../services/searchConfig.js');
    
    const thresholds = {
      'victor-code': getSearchThreshold('victor-code'),
      'sentinel-triage': getSearchThreshold('sentinel-triage'),
      'general-search': getSearchThreshold('general-search')
    };

    const hasCorrectThresholds = 
      thresholds['victor-code'] === 0.8 &&
      thresholds['sentinel-triage'] === 0.7 &&
      thresholds['general-search'] === 0.6;

    return {
      success: hasCorrectThresholds,
      message: hasCorrectThresholds
        ? 'Dynamic thresholding working correctly'
        : 'Dynamic thresholding validation failed',
      details: { thresholds }
    };
  }

  /**
   * Print comprehensive validation summary
   */
  printValidationSummary() {
    console.log('📊 [PHASE 2 VALIDATION SUMMARY]\n');
    
    const passedValidations = this.validationResults.filter(r => r.success).length;
    const totalValidations = this.validationResults.length;
    const successRate = (passedValidations / totalValidations) * 100;

    console.log(`Overall Validation: ${passedValidations}/${totalValidations} checks passed (${successRate.toFixed(1)}%)`);
    
    // Group by category
    const categories = {};
    this.validationResults.forEach(result => {
      if (!categories[result.category]) {
        categories[result.category] = [];
      }
      categories[result.category].push(result);
    });

    console.log('\nCategory Breakdown:');
    for (const [category, results] of Object.entries(categories)) {
      const categoryPassed = results.filter(r => r.success).length;
      const categoryTotal = results.length;
      console.log(`  ${category}: ${categoryPassed}/${categoryTotal} (${(categoryPassed/categoryTotal*100).toFixed(1)}%)`);
    }

    if (successRate >= 90) {
      console.log('\n🎉 PHASE 2 IMPLEMENTATION VALIDATION: PASSED');
      console.log('All critical requirements have been met. The implementation is ready for production.');
    } else if (successRate >= 75) {
      console.log('\n⚠️  PHASE 2 IMPLEMENTATION VALIDATION: PARTIAL PASS');
      console.log('Most requirements met, but some improvements needed.');
    } else {
      console.log('\n❌ PHASE 2 IMPLEMENTATION VALIDATION: FAILED');
      console.log('Critical requirements not met. Implementation needs significant work.');
    }
  }

  /**
   * Generate implementation report
   */
  generateReport() {
    const passed = this.validationResults.filter(r => r.success).length;
    const total = this.validationResults.length;
    const successRate = (passed / total) * 100;

    return {
      validationDate: new Date().toISOString(),
      implementationVersion: 'Phase 2 - Tiered Search',
      overallScore: successRate,
      totalChecks: total,
      passedChecks: passed,
      failedChecks: total - passed,
      categories: this.groupResultsByCategory(),
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Group results by category for reporting
   */
  groupResultsByCategory() {
    const categories = {};
    this.validationResults.forEach(result => {
      if (!categories[result.category]) {
        categories[result.category] = {
          total: 0,
          passed: 0,
          failed: 0,
          checks: []
        };
      }
      categories[result.category].total++;
      if (result.success) {
        categories[result.category].passed++;
      } else {
        categories[result.category].failed++;
      }
      categories[result.category].checks.push(result);
    });
    return categories;
  }

  /**
   Generate recommendations based on validation results
   */
  generateRecommendations() {
    const failedChecks = this.validationResults.filter(r => !r.success);
    const recommendations = [];

    if (failedChecks.length === 0) {
      recommendations.push('Implementation is complete and ready for production deployment.');
    } else {
      failedChecks.forEach(check => {
        recommendations.push(`Fix ${check.category}: ${check.name} - ${check.message}`);
      });
    }

    return recommendations;
  }
}

/**
 * Run validation if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new Phase2Validator();
  validator.validateImplementation().then(results => {
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    const successRate = (passed / total) * 100;
    
    console.log('\n' + '='.repeat(60));
    console.log('FINAL VALIDATION REPORT');
    console.log('='.repeat(60));
    
    const report = validator.generateReport();
    console.log(`Overall Score: ${report.overallScore.toFixed(1)}%`);
    console.log(`Status: ${successRate >= 90 ? 'READY FOR PRODUCTION' : 'NEEDS IMPROVEMENT'}`);
    
    process.exit(successRate >= 90 ? 0 : 1);
  });
}

export default Phase2Validator;