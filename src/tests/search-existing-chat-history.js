// search-existing-chat-history.js
// Script to search existing chat history in MongoDB using chatHistorySearchTool
// This will search your actual chat history data

import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';
import { mongoDBConnection } from '../storage/MongoDBConnection.js';
import Message from '../models/Message.js';
import Session from '../models/Session.js';

/**
 * Search Existing Chat History
 * Uses the chatHistorySearchTool to search your actual MongoDB chat history
 */
export class SearchExistingChatHistory {
  constructor() {
    this.searchResults = [];
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      await mongoDBConnection.connect();
      console.log('✅ Connected to MongoDB');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error.message);
      throw error;
    }
  }

  /**
   * Get available sessions
   */
  async getAvailableSessions() {
    try {
      const sessions = await Session.find({})
        .sort({ lastActivity: -1 })
        .limit(10);

      console.log(`\n📚 Found ${sessions.length} sessions in database:`);
      sessions.forEach((session, index) => {
        console.log(`${index + 1}. ${session.sessionId} - "${session.topic}" (${session.lastActivity})`);
      });

      return sessions;
    } catch (error) {
      console.error('❌ Failed to get sessions:', error.message);
      return [];
    }
  }

  /**
   * Search chat history with semantic search
   */
  async searchChatHistory(query, options = {}) {
    console.log(`\n🔍 Searching chat history for: "${query}"`);

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: query,
        limit: options.limit || 10,
        sessionId: options.sessionId || null,
        roleFilter: options.roleFilter || null,
        dateRange: options.dateRange || null
      });

      if (result.success) {
        console.log(`✅ Found ${result.results.length} results:`);

        result.results.forEach((match, index) => {
          console.log(`\n${index + 1}. [Score: ${match.score.toFixed(3)}] ${match.role.toUpperCase()}:`);
          console.log(`   "${match.content.substring(0, 200)}${match.content.length > 200 ? '...' : ''}"`);
          console.log(`   Session: ${match.sessionId[0] || 'Unknown'}`);
          console.log(`   Date: ${match.createdAt}`);
        });

        return result.results;
      } else {
        console.log(`❌ Search failed: ${result.message}`);
        return [];
      }
    } catch (error) {
      console.error(`❌ Search error: ${error.message}`);
      return [];
    }
  }

  /**
   * Search sessions
   */
  async searchSessions(query, limit = 5) {
    console.log(`\n🔍 Searching sessions for: "${query}"`);

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'sessionSearch',
        query: query,
        limit: limit
      });

      if (result.success) {
        console.log(`✅ Found ${result.results.length} sessions:`);

        result.results.forEach((session, index) => {
          console.log(`\n${index + 1}. [Score: ${session.score.toFixed(3)}] ${session.sessionId}:`);
          console.log(`   Topic: "${session.topic}"`);
          console.log(`   Summary: ${session.summary.substring(0, 150)}${session.summary.length > 150 ? '...' : ''}`);
          console.log(`   Last Activity: ${session.lastActivity}`);
        });

        return result.results;
      } else {
        console.log(`❌ Session search failed: ${result.message}`);
        return [];
      }
    } catch (error) {
      console.error(`❌ Session search error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get message context
   */
  async getMessageContext(messageId, contextSize = 5) {
    console.log(`\n🔍 Getting context for message: ${messageId}`);

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'getMessageContext',
        messageId: messageId,
        contextSize: contextSize
      });

      if (result.success) {
        console.log('✅ Message context retrieved:');

        console.log('\n--- BEFORE ---');
        result.contextBefore.forEach((msg, index) => {
          console.log(`${index + 1}. [${msg.role.toUpperCase()}] ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
        });

        console.log('\n--- TARGET MESSAGE ---');
        console.log(`[${result.targetMessage.role.toUpperCase()}] ${result.targetMessage.content}`);

        console.log('\n--- AFTER ---');
        result.contextAfter.forEach((msg, index) => {
          console.log(`${index + 1}. [${msg.role.toUpperCase()}] ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
        });

        return result;
      } else {
        console.log(`❌ Context retrieval failed: ${result.message}`);
        return null;
      }
    } catch (error) {
      console.error(`❌ Context retrieval error: ${error.message}`);
      return null;
    }
  }

  /**
   * Run search demonstrations
   */
  async runSearchDemonstrations() {
    console.log('🚀 [SEARCH EXISTING CHAT HISTORY] Starting search demonstrations...\n');

    try {
      // Connect to database
      await this.connect();

      // Get available sessions
      const sessions = await this.getAvailableSessions();

      // Demo 1: Search for React-related content
      const reactResults = await this.searchChatHistory('React function component optimization', {
        limit: 5
      });

      // Demo 2: Search for database content
      const dbResults = await this.searchChatHistory('database optimization MongoDB', {
        limit: 5
      });

      // Demo 3: Search for error handling
      const errorResults = await this.searchChatHistory('error handling Node.js', {
        limit: 5
      });

      // Demo 4: Session search
      const sessionResults = await this.searchSessions('integration test', 3);

      // Demo 5: Role-filtered search (assistant messages only)
      const assistantResults = await this.searchChatHistory('React optimization', {
        limit: 3,
        roleFilter: 'assistant'
      });

      // Demo 6: If we have messages, get context for the first result
      if (reactResults.length > 0) {
        const firstMessageId = reactResults[0].sessionId[0]; // Get first session ID
        if (firstMessageId) {
          // Get a message from that session to demonstrate context
          const messages = await Message.find({ session: firstMessageId }).limit(1);
          if (messages.length > 0) {
            await this.getMessageContext(messages[0]._id.toString(), 3);
          }
        }
      }

      // Summary
      console.log('\n📊 [SEARCH SUMMARY]');
      console.log(`- React-related results: ${reactResults.length}`);
      console.log(`- Database-related results: ${dbResults.length}`);
      console.log(`- Error handling results: ${errorResults.length}`);
      console.log(`- Session search results: ${sessionResults.length}`);
      console.log(`- Assistant-only results: ${assistantResults.length}`);

      return {
        reactResults,
        dbResults,
        errorResults,
        sessionResults,
        assistantResults
      };

    } catch (error) {
      console.error('❌ Search demonstration failed:', error.message);
      return null;
    }
  }

  /**
   * Interactive search mode
   */
  async interactiveSearch() {
    console.log('🎯 [INTERACTIVE SEARCH MODE] Enter your search queries (type "exit" to quit):');

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

    try {
      await this.connect();
      const sessions = await this.getAvailableSessions();

      while (true) {
        const query = await question('\n🔍 Enter search query: ');

        if (query.toLowerCase() === 'exit') {
          console.log('👋 Exiting interactive search mode.');
          break;
        }

        if (query.toLowerCase() === 'sessions') {
          await this.searchSessions('test', 5);
          continue;
        }

        await this.searchChatHistory(query, { limit: 10 });
      }
    } catch (error) {
      console.error('❌ Interactive search failed:', error.message);
    } finally {
      rl.close();
    }
  }
}

/**
 * Run search if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const searcher = new SearchExistingChatHistory();

  // Check if interactive mode is requested
  const isInteractive = process.argv.includes('--interactive');

  if (isInteractive) {
    searcher.interactiveSearch().catch(console.error);
  } else {
    searcher.runSearchDemonstrations().then(async (results) => {
      console.log('\n✅ Search demonstrations completed successfully!');
      process.exit(0);
    }).catch(async (error) => {
      console.error('❌ Search demonstrations failed:', error);
      process.exit(1);
    });
  }
}

export default SearchExistingChatHistory;