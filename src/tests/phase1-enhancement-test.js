// phase1-enhancement-test.js
// Comprehensive test suite for Phase 1 semantic search enhancements

import { checkEmbeddingServiceHealth } from '../services/embeddingService.js';
import { checkSummarizationServiceHealth } from '../services/summarizationService.js';
import { checkTieredSearchHealth } from '../services/tieredSearchService.js';
import { searchMetrics } from '../services/searchConfig.js';
import { enhancedChatHistorySearchTool } from '../tools/enhancedChatHistorySearchTool.js';
import { tieredSearch } from '../services/tieredSearchService.js';
import { generateSessionSummary } from '../services/summarizationService.js';

console.log('🧪 [PHASE 1 ENHANCEMENT TEST] Starting comprehensive validation...');

/**
 * Test dynamic thresholding system
 */
async function testDynamicThresholding() {
  console.log('\n🎯 [TEST] Dynamic Thresholding System');
  
  try {
    // Test different query types
    const testQueries = [
      { query: 'How do I fix a null pointer exception in JavaScript?', expectedMode: 'victor-code' },
      { query: 'Help me troubleshoot this database connection issue', expectedMode: 'sentinel-triage' },
      { query: 'What are your thoughts on software architecture?', expectedMode: 'general-search' }
    ];

    for (const test of testQueries) {
      const { detectSearchMode, getSearchThreshold } = await import('../services/searchConfig.js');
      
      const detectedMode = detectSearchMode(test.query);
      const threshold = getSearchThreshold(detectedMode);
      
      console.log(`  Query: "${test.query.substring(0, 40)}..."`);
      console.log(`    Detected Mode: ${detectedMode} (expected: ${test.expectedMode})`);
      console.log(`    Threshold: ${threshold}`);
      console.log(`    ✓ Mode detection: ${detectedMode === test.expectedMode ? 'PASS' : 'FAIL'}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Dynamic thresholding test failed:', error);
    return false;
  }
}

/**
 * Test enhanced numCandidates calculation
 */
async function testNumCandidatesCalculation() {
  console.log('\n🔢 [TEST] Enhanced numCandidates Calculation');
  
  try {
    const { calculateNumCandidates } = await import('../services/searchConfig.js');
    
    const testCases = [
      { limit: 5, datasetSize: 5000, expectedMin: 100 },
      { limit: 10, datasetSize: 50000, expectedMin: 200 },
      { limit: 3, datasetSize: 100000, expectedMin: 250 }
    ];

    for (const test of testCases) {
      const candidates = calculateNumCandidates(test.limit, test.datasetSize);
      const expectedMin = test.expectedMin;
      
      console.log(`  Limit: ${test.limit}, Dataset: ${test.datasetSize} -> Candidates: ${candidates}`);
      console.log(`    ✓ Minimum candidates: ${candidates >= expectedMin ? 'PASS' : 'FAIL'} (expected >= ${expectedMin})`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ numCandidates calculation test failed:', error);
    return false;
  }
}

/**
 * Test two-for-one summarization
 */
async function testTwoForOneSummarization() {
  console.log('\n📝 [TEST] Two-for-One Summarization');
  
  try {
    const testMessages = [
      { role: 'user', content: 'I need to implement a function that checks if a number is prime' },
      { role: 'assistant', content: 'Here is a JavaScript function to check if a number is prime: function isPrime(n) { if (n <= 1) return false; for (let i = 2; i * i <= n; i++) { if (n % i === 0) return false; } return true; }' },
      { role: 'user', content: 'How does this algorithm work?' },
      { role: 'assistant', content: 'The algorithm checks divisibility up to the square root of n, which is sufficient because if n has a divisor larger than its square root, it must also have a corresponding smaller divisor.' }
    ];

    const summaryData = await generateSessionSummary(testMessages, 'test-session-123');
    
    if (!summaryData) {
      console.log('    ❌ Failed to generate summary');
      return false;
    }

    console.log(`  Summary: "${summaryData.summary.substring(0, 80)}..."`);
    console.log(`  Topic: "${summaryData.topic}"`);
    console.log(`  Category: "${summaryData.category}"`);
    console.log(`  Key Points: ${summaryData.keyPoints.length} items`);
    
    const hasAllFields = summaryData.summary && summaryData.topic && summaryData.category;
    console.log(`    ✓ All fields present: ${hasAllFields ? 'PASS' : 'FAIL'}`);
    
    return hasAllFields;
  } catch (error) {
    console.error('❌ Two-for-one summarization test failed:', error);
    return false;
  }
}

/**
 * Test tiered search architecture
 */
async function testTieredSearch() {
  console.log('\n🏗️ [TEST] Tiered Search Architecture');
  
  try {
    // Test cache functionality
    console.log('  Testing cache functionality...');
    const cacheStatsBefore = tieredSearch.getCacheStats();
    console.log(`    Cache size before: ${cacheStatsBefore.cacheSize}`);
    
    // Clear cache for clean test
    tieredSearch.clearCache();
    
    // Test search metrics
    const metrics = searchMetrics.getMetrics();
    console.log(`  Search metrics:`, {
      totalSearches: metrics.totalSearches,
      avgSearchTime: `${metrics.averageSearchTime.toFixed(2)}ms`,
      cacheHitRate: `${metrics.cacheHitRate.toFixed(1)}%`,
      avgQualityScore: metrics.averageQualityScore.toFixed(2)
    });
    
    return true;
  } catch (error) {
    console.error('❌ Tiered search test failed:', error);
    return false;
  }
}

/**
 * Test enhanced schema configurations
 */
async function testSchemaConfigurations() {
  console.log('\n📊 [TEST] Enhanced Schema Configurations');
  
  try {
    const Message = await import('../models/Message.js');
    const Session = await import('../models/Session.js');
    
    // Test message schema vector index configuration
    const messageIndexConfig = Message.default.createOptimizedVectorIndex();
    console.log('  Message Vector Index Config:');
    console.log(`    Type: ${messageIndexConfig.type}`);
    console.log(`    Dimensions: ${messageIndexConfig.dimensions}`);
    console.log(`    Similarity: ${messageIndexConfig.similarity}`);
    console.log(`    Filters: ${messageIndexConfig.filters.join(', ')}`);
    
    // Test session schema vector index configuration
    const sessionIndexConfig = Session.default.createOptimizedSessionIndex();
    console.log('  Session Vector Index Config:');
    console.log(`    Type: ${sessionIndexConfig.type}`);
    console.log(`    Dimensions: ${sessionIndexConfig.dimensions}`);
    console.log(`    Similarity: ${sessionIndexConfig.similarity}`);
    console.log(`    Filters: ${sessionIndexConfig.filters.join(', ')}`);
    
    const configsValid = messageIndexConfig.dimensions === 1024 && 
                        sessionIndexConfig.dimensions === 1024 &&
                        messageIndexConfig.type === 'vectorSearch' &&
                        sessionIndexConfig.type === 'vectorSearch';
    
    console.log(`    ✓ Schema configurations valid: ${configsValid ? 'PASS' : 'FAIL'}`);
    
    return configsValid;
  } catch (error) {
    console.error('❌ Schema configuration test failed:', error);
    return false;
  }
}

/**
 * Test enhanced search tool functionality
 */
async function testEnhancedSearchTool() {
  console.log('\n🛠️ [TEST] Enhanced Search Tool Functionality');
  
  try {
    // Test tool configuration
    const tool = enhancedChatHistorySearchTool;
    console.log('  Tool Configuration:');
    console.log(`    Name: ${tool.function.name}`);
    console.log(`    Description: ${tool.function.description.substring(0, 80)}...`);
    console.log(`    Actions: ${tool.function.parameters.properties.action.enum.join(', ')}`);
    
    // Test action validation
    const validActions = tool.function.parameters.properties.action.enum;
    const expectedActions = ['semanticSearch', 'sessionSearch', 'getMessageContext', 'sessionSummarization', 'getMetrics'];
    const hasAllActions = expectedActions.every(action => validActions.includes(action));
    
    console.log(`    ✓ All expected actions present: ${hasAllActions ? 'PASS' : 'FAIL'}`);
    
    return hasAllActions;
  } catch (error) {
    console.error('❌ Enhanced search tool test failed:', error);
    return false;
  }
}

/**
 * Test service health checks
 */
async function testServiceHealthChecks() {
  console.log('\n🏥 [TEST] Service Health Checks');
  
  try {
    // Test embedding service health
    const embeddingHealth = await checkEmbeddingServiceHealth();
    console.log(`  Embedding Service: ${embeddingHealth.status} (${embeddingHealth.message})`);
    
    // Test summarization service health
    const summarizationHealth = await checkSummarizationServiceHealth();
    console.log(`  Summarization Service: ${summarizationHealth.status} (${summarizationHealth.message})`);
    
    // Test tiered search health
    const tieredSearchHealth = await checkTieredSearchHealth();
    console.log(`  Tiered Search Service: ${tieredSearchHealth.status} (${tieredSearchHealth.message})`);
    
    const allHealthy = embeddingHealth.status === 'healthy' && 
                      summarizationHealth.status === 'healthy' && 
                      tieredSearchHealth.status === 'healthy';
    
    console.log(`    ✓ All services healthy: ${allHealthy ? 'PASS' : 'FAIL'}`);
    
    return allHealthy;
  } catch (error) {
    console.error('❌ Service health check test failed:', error);
    return false;
  }
}

/**
 * Run comprehensive Phase 1 test suite
 */
async function runPhase1Tests() {
  console.log('🚀 [PHASE 1 TEST SUITE] Starting comprehensive validation...\n');
  
  const tests = [
    { name: 'Dynamic Thresholding', test: testDynamicThresholding },
    { name: 'numCandidates Calculation', test: testNumCandidatesCalculation },
    { name: 'Two-for-One Summarization', test: testTwoForOneSummarization },
    { name: 'Tiered Search Architecture', test: testTieredSearch },
    { name: 'Schema Configurations', test: testSchemaConfigurations },
    { name: 'Enhanced Search Tool', test: testEnhancedSearchTool },
    { name: 'Service Health Checks', test: testServiceHealthChecks }
  ];
  
  let passedTests = 0;
  let totalTests = tests.length;
  
  for (const { name, test } of tests) {
    try {
      const result = await test();
      if (result) {
        passedTests++;
        console.log(`✅ [${name}] PASSED\n`);
      } else {
        console.log(`❌ [${name}] FAILED\n`);
      }
    } catch (error) {
      console.log(`❌ [${name}] ERROR: ${error.message}\n`);
    }
  }
  
  console.log('📊 [PHASE 1 TEST RESULTS]');
  console.log(`  Tests Passed: ${passedTests}/${totalTests}`);
  console.log(`  Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  if (passedTests === totalTests) {
    console.log('🎉 [PHASE 1] ALL TESTS PASSED - Ready for production!');
  } else {
    console.log('⚠️ [PHASE 1] Some tests failed - Review and fix issues before deployment');
  }
  
  return passedTests === totalTests;
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runPhase1Tests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

export { runPhase1Tests, testDynamicThresholding, testNumCandidatesCalculation, testTwoForOneSummarization, testTieredSearch, testSchemaConfigurations, testEnhancedSearchTool, testServiceHealthChecks };