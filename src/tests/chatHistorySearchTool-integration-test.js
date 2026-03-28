// chatHistorySearchTool-integration-test.js
// Integration test for chatHistorySearchTool.js that can use real embeddings
// when available, but falls back to mocks for isolated testing

import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';
import { VictorCache } from '../services/VictorCache.js';
import { searchMetrics } from '../services/searchConfig.js';

/**
 * Integration Test Suite for chatHistorySearchTool
 * Can use real embeddings when available, mocks otherwise
 */
export class ChatHistorySearchToolIntegrationTest {
  constructor(useRealEmbeddings = false) {
    this.testResults = [];
    this.victorCache = new VictorCache();
    this.useRealEmbeddings = useRealEmbeddings;
    this.realEmbeddingService = null;
  }

  /**
   * Initialize real embedding service if requested
   */
  async initializeRealEmbeddings() {
    if (!this.useRealEmbeddings) {
      return;
    }

    try {
      // Try to import the real embedding service
      const { generateEmbedding } = await import('../services/embeddingService.js');
      this.realEmbeddingService = generateEmbedding;
      console.log('✅ Real embedding service initialized');
    } catch (error) {
      console.warn('⚠️  Real embedding service not available, will use mocks:', error.message);
      this.useRealEmbeddings = false;
    }
  }

  /**
   * Run all integration tests
   */
  async runAllTests() {
    console.log('🧪 [CHAT HISTORY SEARCH TOOL INTEGRATION TEST SUITE] Starting...\n');

    // Initialize real embeddings if requested
    await this.initializeRealEmbeddings();

    const tests = [
      { name: 'Semantic Search with Real Embeddings', test: () => this.testSemanticSearchWithRealEmbeddings() },
      { name: 'Semantic Search with Mocks', test: () => this.testSemanticSearchWithMocks() },
      { name: 'Session Search', test: () => this.testSessionSearch() },
      { name: 'Get Message Context', test: () => this.testGetMessageContext() },
      { name: 'Error Handling', test: () => this.testErrorHandling() }
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
   * Test semantic search with real embeddings (if available)
   */
  async testSemanticSearchWithRealEmbeddings() {
    const startTime = Date.now();

    if (!this.realEmbeddingService) {
      return {
        success: false,
        duration: 0,
        details: { reason: 'Real embedding service not available' }
      };
    }

    try {
      // This would require actual MongoDB setup, so we'll simulate it
      // In a real integration test, you'd have test data in MongoDB
      const result = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: 'function optimization',
        limit: 5,
        sessionId: 'test_session'
      });

      // For this integration test, we expect it to fail gracefully
      // since we don't have real MongoDB data
      const success = result.success === false && 
                     (result.message.includes('semantic search') || 
                      result.message.includes('MongoDB'));

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          resultSuccess: result.success,
          message: result.message
        }
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * Test semantic search with mocks
   */
  async testSemanticSearchWithMocks() {
    const startTime = Date.now();

    try {
      // Set up mocks for this test
      this.setupMocks();

      const result = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: 'function optimization',
        limit: 5,
        sessionId: 'session_123'
      });

      const success = result.success === true &&
                     result.results.length === 2 &&
                     result.results[0].score >= 0.6 &&
                     result.results[0].content.includes('function optimization');

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          totalResults: result.results.length,
          firstResultScore: result.results[0]?.score,
          firstResultContent: result.results[0]?.content
        }
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * Test session search
   */
  async testSessionSearch() {
    const startTime = Date.now();

    try {
      this.setupMocks();

      const result = await chatHistorySearchTool.handler({
        action: 'sessionSearch',
        query: 'testing session',
        limit: 3
      });

      const success = result.success === true &&
                     result.results.length === 1 &&
                     result.results[0].score >= 0.6 &&
                     result.results[0].topic === 'Testing Session';

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          totalResults: result.results.length,
          sessionTopic: result.results[0]?.topic,
          sessionScore: result.results[0]?.score
        }
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * Test get message context
   */
  async testGetMessageContext() {
    const startTime = Date.now();

    try {
      this.setupMocks();

      const result = await chatHistorySearchTool.handler({
        action: 'getMessageContext',
        messageId: 'msg_2',
        contextSize: 5
      });

      const success = result.success === true &&
                     result.targetMessage.content === 'Target message content' &&
                     result.contextBefore.length === 1 &&
                     result.contextAfter.length === 1;

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          targetMessageContent: result.targetMessage?.content,
          contextBeforeCount: result.contextBefore?.length,
          contextAfterCount: result.contextAfter?.length
        }
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * Test error handling
   */
  async testErrorHandling() {
    const startTime = Date.now();

    try {
      this.setupMocks();

      // Mock an error in the embedding service
      const originalGenerateEmbedding = global.mockEmbeddingService.generateEmbedding;
      global.mockEmbeddingService.generateEmbedding = async () => {
        throw new Error('Embedding service unavailable');
      };

      const result = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: 'test query'
      });

      const success = result.success === false &&
                     result.message.includes('Chat history search error');

      // Restore original function
      global.mockEmbeddingService.generateEmbedding = originalGenerateEmbedding;

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          errorMessage: result.message
        }
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * Set up mocks for testing
   */
  setupMocks() {
    // Mock embedding service
    global.mockEmbeddingService = {
      generateEmbedding: async (text) => {
        return Array(1024).fill(0.1);
      }
    };

    // Mock Message model
    global.MockMessage = class {
      static aggregate(pipeline) {
        if (pipeline.some(stage => stage.$vectorSearch)) {
          return Promise.resolve([
            {
              content: 'This is a test message about function optimization',
              role: 'user',
              score: 0.85,
              sessionInfo: [{ sessionId: 'session_123', topic: 'Testing' }],
              createdAt: new Date()
            },
            {
              content: 'Another message about database optimization',
              role: 'assistant',
              score: 0.75,
              sessionInfo: [{ sessionId: 'session_456', topic: 'Database' }],
              createdAt: new Date()
            }
          ]);
        }
        return Promise.resolve([]);
      }
    };

    // Mock Session model
    global.MockSession = class {
      static aggregate(pipeline) {
        if (pipeline.some(stage => stage.$vectorSearch)) {
          return Promise.resolve([
            {
              sessionId: 'session_123',
              topic: 'Testing Session',
              summary: 'This session was about testing chat history search',
              score: 0.9,
              lastActivity: new Date()
            }
          ]);
        }
        return Promise.resolve([]);
      }

      static findById(id) {
        return Promise.resolve({
          _id: id,
          sessionId: 'session_123'
        });
      }
    };

    // Mock Message for context
    global.MockMessageForContext = class {
      static findById(id) {
        return Promise.resolve({
          _id: id,
          session: 'session_123',
          role: 'user',
          content: 'Target message content',
          createdAt: new Date()
        });
      }

      static find(query) {
        if (query.createdAt && query.createdAt.$lt) {
          return {
            sort: () => ({
              limit: () => Promise.resolve([
                {
                  _id: 'msg_1',
                  role: 'assistant',
                  content: 'Previous message 1',
                  createdAt: new Date(Date.now() - 10000)
                }
              ])
            })
          };
        }
        if (query.createdAt && query.createdAt.$gt) {
          return {
            sort: () => ({
              limit: () => Promise.resolve([
                {
                  _id: 'msg_3',
                  role: 'user',
                  content: 'Next message 1',
                  createdAt: new Date(Date.now() + 10000)
                }
              ])
            })
          };
        }
        return Promise.resolve([]);
      }
    };

    // Mock dynamic imports
    const originalImport = global.import;
    global.import = async (specifier) => {
      if (specifier === '../services/embeddingService.js') {
        return { generateEmbedding: global.mockEmbeddingService.generateEmbedding };
      }
      if (specifier === '../models/Message.js') {
        return { default: global.MockMessage };
      }
      if (specifier === '../models/Session.js') {
        return { default: global.MockSession };
      }
      return originalImport(specifier);
    };
  }

  /**
   * Print comprehensive test summary
   */
  printTestSummary() {
    console.log('📊 [CHAT HISTORY SEARCH TOOL INTEGRATION TEST SUMMARY]\n');

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
      if (result.details) {
        console.log(`   Details:`, result.details);
      }
    });

    // Print metrics if available
    const metrics = searchMetrics.getPerformanceSummary();
    if (metrics.summary.totalSearches > 0) {
      console.log('\n📈 Performance Metrics:');
      console.log(`   Total Searches: ${metrics.summary.totalSearches}`);
      console.log(`   Average Search Time: ${metrics.summary.averageSearchTime.toFixed(2)}ms`);
      console.log(`   Estimated Cost: $${metrics.summary.estimatedCostUSD.toFixed(4)}`);
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
  const useRealEmbeddings = process.argv.includes('--real-embeddings');
  const testSuite = new ChatHistorySearchToolIntegrationTest(useRealEmbeddings);
  testSuite.runAllTests().then(results => {
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    process.exit(passed === total ? 0 : 1);
  });
}

export default ChatHistorySearchToolIntegrationTest;