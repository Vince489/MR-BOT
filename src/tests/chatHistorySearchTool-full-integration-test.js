// chatHistorySearchTool-full-integration-test.js
// Full integration test for chatHistorySearchTool.js using real MongoDB and services
// This test creates actual test data, runs real searches, and validates the complete functionality

import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';
import { VictorCache } from '../services/VictorCache.js';
import { searchMetrics } from '../services/searchConfig.js';
import Message from '../models/Message.js';
import Session from '../models/Session.js';
import { mongoDBConnection } from '../storage/MongoDBConnection.js';

/**
 * Full Integration Test Suite for chatHistorySearchTool
 * Uses real MongoDB, real embeddings, and real services
 */
export class ChatHistorySearchToolFullIntegrationTest {
  constructor() {
    this.testResults = [];
    this.victorCache = new VictorCache();
    this.testSessionId = 'integration-test-session-' + Date.now();
    this.testUserId = 'integration-test-user-' + Date.now();
  }

  /**
   * Connect to MongoDB for testing
   */
  async connectToDatabase() {
    try {
      await mongoDBConnection.connect();
      console.log('✅ Connected to MongoDB for integration test');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error.message);
      throw error;
    }
  }

  /**
   * Clean up test data
   */
  async cleanupTestData() {
    try {
      await Message.deleteMany({ session: this.testSessionId });
      await Session.deleteMany({ sessionId: this.testSessionId });
      console.log('🧹 Cleaned up test data');
    } catch (error) {
      console.warn('⚠️  Failed to clean up test data:', error.message);
    }
  }

  /**
   * Create test data in MongoDB
   */
  async createTestData() {
    try {
      // Create test session
      const testSession = new Session({
        sessionId: this.testSessionId,
        topic: 'Integration Test Session',
        summary: 'This session contains test data for chat history search integration tests',
        lastActivity: new Date()
      });
      await testSession.save();

      // Create test messages with different content for testing search functionality
      const testMessages = [
        {
          session: this.testSessionId,
          role: 'user',
          content: 'How do I optimize a React function component for better performance?',
          createdAt: new Date(Date.now() - 60000)
        },
        {
          session: this.testSessionId,
          role: 'assistant',
          content: 'To optimize React function components, consider memoization with useMemo and useCallback, avoid inline object/function creation, and implement proper state management.',
          createdAt: new Date(Date.now() - 50000)
        },
        {
          session: this.testSessionId,
          role: 'user',
          content: 'What are the best practices for database optimization in MongoDB?',
          createdAt: new Date(Date.now() - 40000)
        },
        {
          session: this.testSessionId,
          role: 'assistant',
          content: 'For MongoDB optimization, use proper indexing, avoid collection scans, implement aggregation pipeline optimization, and consider sharding for large datasets.',
          createdAt: new Date(Date.now() - 30000)
        },
        {
          session: this.testSessionId,
          role: 'user',
          content: 'Can you explain how to implement error handling in Node.js applications?',
          createdAt: new Date(Date.now() - 20000)
        },
        {
          session: this.testSessionId,
          role: 'assistant',
          content: 'Node.js error handling involves try-catch blocks, error middleware, proper logging, and graceful shutdown procedures.',
          createdAt: new Date(Date.now() - 10000)
        },
        {
          session: this.testSessionId,
          role: 'user',
          content: 'What is the difference between synchronous and asynchronous programming?',
          createdAt: new Date()
        }
      ];

      // Save messages to database
      for (const msgData of testMessages) {
        const message = new Message(msgData);
        await message.save();
      }

      console.log(`✅ Created ${testMessages.length} test messages for session ${this.testSessionId}`);
      return testMessages;
    } catch (error) {
      console.error('❌ Failed to create test data:', error.message);
      throw error;
    }
  }

  /**
   * Run all integration tests
   */
  async runAllTests() {
    console.log('🧪 [CHAT HISTORY SEARCH TOOL FULL INTEGRATION TEST SUITE] Starting...\n');

    try {
      // Connect to database
      await this.connectToDatabase();

      // Clean up any existing test data
      await this.cleanupTestData();

      // Create fresh test data
      await this.createTestData();

      const tests = [
        { name: 'Semantic Search - Function Optimization', test: () => this.testSemanticSearchFunctionOptimization() },
        { name: 'Semantic Search - Database Optimization', test: () => this.testSemanticSearchDatabaseOptimization() },
        { name: 'Session Search', test: () => this.testSessionSearch() },
        { name: 'Get Message Context', test: () => this.testGetMessageContext() },
        { name: 'Semantic Search with Filters', test: () => this.testSemanticSearchWithFilters() },
        { name: 'Error Handling - Invalid Action', test: () => this.testInvalidAction() },
        { name: 'Error Handling - Missing Parameters', test: () => this.testMissingParameters() }
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

      // Clean up after tests
      await this.cleanupTestData();

      this.printTestSummary();
      return this.testResults;
    } catch (error) {
      console.error('❌ Integration test suite failed:', error.message);
      return this.testResults;
    }
  }

  /**
   * Test semantic search for function optimization
   */
  async testSemanticSearchFunctionOptimization() {
    const startTime = Date.now();

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: 'React function component performance optimization',
        limit: 3,
        sessionId: this.testSessionId
      });

      const success = result.success === true &&
                     result.results.length > 0 &&
                     result.results.some(r => r.content.includes('React') || r.content.includes('function') || r.content.includes('performance'));

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          totalResults: result.results.length,
          foundRelevant: result.results.some(r => r.content.includes('React')),
          firstResult: result.results[0]?.content?.substring(0, 100) + '...'
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
   * Test semantic search for database optimization
   */
  async testSemanticSearchDatabaseOptimization() {
    const startTime = Date.now();

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: 'MongoDB database optimization best practices',
        limit: 3,
        sessionId: this.testSessionId
      });

      const success = result.success === true &&
                     result.results.length > 0 &&
                     result.results.some(r => r.content.includes('MongoDB') || r.content.includes('database') || r.content.includes('optimization'));

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          totalResults: result.results.length,
          foundRelevant: result.results.some(r => r.content.includes('MongoDB')),
          firstResult: result.results[0]?.content?.substring(0, 100) + '...'
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
      const result = await chatHistorySearchTool.handler({
        action: 'sessionSearch',
        query: 'integration test session',
        limit: 3
      });

      const success = result.success === true &&
                     result.results.length > 0 &&
                     result.results.some(r => r.topic.includes('Integration Test'));

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          totalResults: result.results.length,
          foundSession: result.results.some(r => r.topic.includes('Integration Test')),
          sessionTopic: result.results[0]?.topic
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
      // First, get a message ID from our test data
      const messages = await Message.find({ session: this.testSessionId }).limit(1);
      if (messages.length === 0) {
        return {
          success: false,
          duration: Date.now() - startTime,
          error: 'No test messages found'
        };
      }

      const messageId = messages[0]._id.toString();

      const result = await chatHistorySearchTool.handler({
        action: 'getMessageContext',
        messageId: messageId,
        contextSize: 3
      });

      const success = result.success === true &&
                     result.targetMessage !== undefined &&
                     result.contextBefore !== undefined &&
                     result.contextAfter !== undefined;

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          targetMessageContent: result.targetMessage?.content?.substring(0, 50) + '...',
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
   * Test semantic search with filters
   */
  async testSemanticSearchWithFilters() {
    const startTime = Date.now();

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: 'error handling',
        limit: 3,
        sessionId: this.testSessionId,
        roleFilter: 'assistant'
      });

      const success = result.success === true &&
                     result.results.length > 0 &&
                     result.results.every(r => r.role === 'assistant') &&
                     result.results.some(r => r.content.includes('error'));

      return {
        success,
        duration: Date.now() - startTime,
        details: {
          totalResults: result.results.length,
          allAssistant: result.results.every(r => r.role === 'assistant'),
          foundErrorContent: result.results.some(r => r.content.includes('error'))
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
   * Print comprehensive test summary
   */
  printTestSummary() {
    console.log('📊 [CHAT HISTORY SEARCH TOOL FULL INTEGRATION TEST SUMMARY]\n');

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

    console.log('\n🎯 Integration Test Notes:');
    console.log(`   - Test Session ID: ${this.testSessionId}`);
    console.log(`   - All test data has been cleaned up`);
    console.log(`   - Tests used real MongoDB, real embeddings, and real services`);
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

  /**
   * Close database connection
   */
  async closeConnection() {
    try {
      await mongoose.connection.close();
      console.log('🔌 Database connection closed');
    } catch (error) {
      console.warn('⚠️  Failed to close database connection:', error.message);
    }
  }
}

/**
 * Run tests if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const testSuite = new ChatHistorySearchToolFullIntegrationTest();
  
  testSuite.runAllTests().then(async results => {
    await testSuite.closeConnection();
    
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    process.exit(passed === total ? 0 : 1);
  }).catch(async (error) => {
    console.error('❌ Integration test failed:', error);
    await testSuite.closeConnection();
    process.exit(1);
  });
}

export default ChatHistorySearchToolFullIntegrationTest;