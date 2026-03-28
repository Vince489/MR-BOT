// agent-with-search-test.js
// Test the Agent with chatHistorySearchTool integrated

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

import { Agent } from '../Agent.js';
import { thoughtTool } from '../tools/thoughtTool.js';
import { calculatorTool } from '../tools/calculatorTool.js';
import { dateTimeTool } from '../tools/dateTimeTool.js';
import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';

/**
 * Test Agent with integrated chatHistorySearchTool
 */
export class AgentWithSearchTest {
  constructor() {
    this.agent = null;
  }

  /**
   * Initialize agent with all tools including chat history search
   */
  async initializeAgent() {
    console.log('🤖 Initializing Agent with chatHistorySearchTool...');
    
    this.agent = new Agent({
      apiKey: process.env.MISTRAL_API_KEY,
      systemPrompt: `You are Victor Stylus, a highly advanced AI co-developer.
      
      IMPORTANT: Before responding to ANY user input, you MUST use the record_thought tool to externalize your reasoning process.
      
      You have access to the following tools:
      - record_thought: For mandatory thought process documentation
      - calculator: For mathematical calculations
      - date_time: For date and time operations
      - chat_history_search: For searching your conversation history
      
      When the user asks about past conversations or wants to search for specific topics, use the chat_history_search tool.`,
      storageType: 'mongodb',
      tools: [thoughtTool, calculatorTool, dateTimeTool, chatHistorySearchTool],
      debug: true,
      enableEvents: true
    });

    console.log('✅ Agent initialized with chatHistorySearchTool');
  }

  /**
   * Test search functionality
   */
  async testSearch() {
    if (!this.agent) {
      console.log('❌ Agent not initialized');
      return;
    }

    console.log('\n🔍 Testing chat history search functionality...');

    try {
      // Test semantic search
      console.log('\n1. Testing semantic search...');
      const searchResult = await this.agent.execute([
        { role: 'user', content: 'Search for messages about "hello" in our conversation history' }
      ]);

      console.log('Search result:', searchResult.response);

      // Test session search
      console.log('\n2. Testing session search...');
      const sessionResult = await this.agent.execute([
        { role: 'user', content: 'Search for sessions related to "assistant"' }
      ]);

      console.log('Session search result:', sessionResult.response);

      // Test context retrieval
      console.log('\n3. Testing context retrieval...');
      const contextResult = await this.agent.execute([
        { role: 'user', content: 'Get context around messages about "Victor Stylus"' }
      ]);

      console.log('Context retrieval result:', contextResult.response);

    } catch (error) {
      console.error('❌ Search test failed:', error.message);
    }
  }

  /**
   * Test normal conversation with search capability
   */
  async testConversation() {
    if (!this.agent) {
      console.log('❌ Agent not initialized');
      return;
    }

    console.log('\n💬 Testing normal conversation with search capability...');

    try {
      // Test normal conversation
      console.log('\n1. Testing normal conversation...');
      const normalResult = await this.agent.execute([
        { role: 'user', content: 'What is 2 + 2?' }
      ]);

      console.log('Normal conversation result:', normalResult.response);

      // Test conversation with search
      console.log('\n2. Testing conversation with search...');
      const searchConvResult = await this.agent.execute([
        { role: 'user', content: 'Can you search our history for any messages about "hello"?' }
      ]);

      console.log('Search conversation result:', searchConvResult.response);

    } catch (error) {
      console.error('❌ Conversation test failed:', error.message);
    }
  }

  /**
   * Run all tests
   */
  async runTests() {
    console.log('🚀 AGENT WITH SEARCH TOOL TEST');
    console.log('=' .repeat(50));

    await this.initializeAgent();
    await this.testSearch();
    await this.testConversation();

    console.log('\n🎯 TESTS COMPLETED');
    console.log('=' .repeat(50));
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = new AgentWithSearchTest();
  test.runTests().catch(console.error);
}

export default AgentWithSearchTest;