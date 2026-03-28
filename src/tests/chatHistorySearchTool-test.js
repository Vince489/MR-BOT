// chatHistorySearchTool-test.js
// Comprehensive test suite for chatHistorySearchTool.js
// Tests all three actions: semanticSearch, sessionSearch, and getMessageContext

// Mock the dynamic imports before importing the actual modules
const mockEmbeddingService = {
  generateEmbedding: async (text) => {
    // Return a mock embedding vector (Mistral mistral-embed uses 1024 dimensions)
    return Array(1024).fill(0.1);
  }
};

// Mock the Message and Session models
const MockMessage = class {
  static aggregate(pipeline) {
    // Mock semantic search results
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

const MockSession = class {
  static aggregate(pipeline) {
    // Mock session search results
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

const MockMessageForContext = class {
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
      // Return messages before target
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
      // Return messages after target
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

// Mock the dynamic import for embedding service
const originalImport = global.import;
global.import = async (specifier) => {
  if (specifier === '../services/embeddingService.js') {
    return { generateEmbedding: mockEmbeddingService.generateEmbedding };
  }
  if (specifier === '../models/Message.js') {
    return { default: MockMessage };
  }
  if (specifier === '../models/Session.js') {
    return { default: MockSession };
  }
  return originalImport(specifier);
};

import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';
import { VictorCache } from '../services/VictorCache.js';
import { searchMetrics } from '../services/searchConfig.js';


/**
 * Chat History Search Tool Test Suite
 */
export class ChatHistorySearchToolTest {
  constructor() {
    this.testResults = [];
    this.victorCache = new VictorCache();
  }

  /**
   * Run all tests for chatHistorySearchTool
   */
  async runAllTests() {
    console.log('🧪 [CHAT HISTORY SEARCH TOOL TEST SUITE] Starting comprehensive tests...\n');

    // Set up mocks
    this.setupMocks();

    const tests = [
      { name: 'Semantic Search Action', test: () => this.testSemanticSearch() },
      { name: 'Session Search Action', test: () => this.testSessionSearch() },
      { name: 'Get Message Context Action', test: () => this.testGetMessageContext() },
      { name: 'Invalid Action Handling', test: () => this.testInvalidAction() },
      { name: 'Missing Required Parameters', test: () => this.testMissingParameters() },
      { name: 'Task Progress Validation', test: () => this.testTaskProgressValidation() },
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
   * Set up mocks for testing
   */
  setupMocks() {
    // Mock the dynamic imports
    global.mockEmbeddingService = mockEmbeddingService;
    
    // Mock the Message and Session models
    global.MockMessage = MockMessage;
    global.MockSession = MockSession;
    global.MockMessageForContext = MockMessageForContext;
  }

  /**
   * Test semantic search action
   */
  async testSemanticSearch() {
    const startTime = Date.now();

    try {
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
   * Test session search action
   */
  async testSessionSearch() {
    const startTime = Date.now();

    try {
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
   * Test get message context action
   */
  async testGetMessageContext() {
    const startTime = Date.now();

    try {
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
   * Test invalid action handling
   */
  async testInvalidAction() {
    const startTime = Date.now();

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'invalidAction',
        query: 'test query'
      });

      const success = result.success === false &&
                     result.message.includes('Unknown action');

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
   * Test missing required parameters
   */
  async testMissingParameters() {
    const startTime = Date.now();

    try {
      // Test missing query for semanticSearch
      const result1 = await chatHistorySearchTool.handler({
        action: 'semanticSearch'
      });

      const success1 = result1.success === false &&
                      result1.message.includes('requires a \'query\' parameter');

      // Test missing messageId for getMessageContext
      const result2 = await chatHistorySearchTool.handler({
        action: 'getMessageContext'
      });

      const success2 = result2.success === false &&
                      result2.message.includes('requires a \'messageId\' parameter');

      return {
        success: success1 && success2,
        duration: Date.now() - startTime,
        details: {
          semanticSearchError: result1.message,
          messageContextError: result2.message
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
   * Test task progress validation
   */
  async testTaskProgressValidation() {
    const startTime = Date.now();

    try {
      // Test valid progress format
      const result1 = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: 'test query',
        taskProgress: '- [x] Step 1\n- [ ] Step 2'
      });

      // Test invalid progress format
      const result2 = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: 'test query',
        taskProgress: 'Invalid format'
      });

      // Both should succeed as progress validation is non-blocking
      const success = result1.success === true && result2.success === true;

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          validProgressResult: result1.success,
          invalidProgressResult: result2.success
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
   * Print comprehensive test summary
   */
  printTestSummary() {
    console.log('📊 [CHAT HISTORY SEARCH TOOL TEST SUMMARY]\n');

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
  const testSuite = new ChatHistorySearchToolTest();
  testSuite.runAllTests().then(results => {
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    process.exit(passed === total ? 0 : 1);
  });
}

export default ChatHistorySearchToolTest;