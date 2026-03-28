// simple-chat-history-search.js
// Simple script to search existing chat history using chatHistorySearchTool
// This provides a straightforward way to search your actual MongoDB chat history

import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';
import { mongoDBConnection } from '../storage/MongoDBConnection.js';

/**
 * Simple Chat History Search
 * Basic search functionality for your existing chat history
 */
export class SimpleChatHistorySearch {
  constructor() {
    this.connected = false;
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    if (this.connected) return true;

    try {
      await mongoDBConnection.connect();
      this.connected = true;
      console.log('✅ Connected to MongoDB successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error.message);
      return false;
    }
  }

  /**
   * Search chat history with a simple query
   */
  async search(query, limit = 10) {
    if (!this.connected) {
      console.log('❌ Not connected to MongoDB. Please connect first.');
      return [];
    }

    console.log(`\n🔍 Searching for: "${query}"`);

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: query,
        limit: limit
      });

      if (result.success) {
        console.log(`✅ Found ${result.results.length} results:`);

        if (result.results.length === 0) {
          console.log('   No results found for this query.');
          return [];
        }

        result.results.forEach((match, index) => {
          console.log(`\n${index + 1}. [Score: ${match.score.toFixed(3)}] ${match.role.toUpperCase()}`);
          console.log(`   "${match.content.substring(0, 150)}${match.content.length > 150 ? '...' : ''}"`);
          if (match.sessionId && match.sessionId[0]) {
            console.log(`   Session: ${match.sessionId[0]}`);
          }
          if (match.createdAt) {
            console.log(`   Date: ${new Date(match.createdAt).toLocaleString()}`);
          }
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
    if (!this.connected) {
      console.log('❌ Not connected to MongoDB. Please connect first.');
      return [];
    }

    console.log(`\n🔍 Searching sessions for: "${query}"`);

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'sessionSearch',
        query: query,
        limit: limit
      });

      if (result.success) {
        console.log(`✅ Found ${result.results.length} sessions:`);

        if (result.results.length === 0) {
          console.log('   No sessions found for this query.');
          return [];
        }

        result.results.forEach((session, index) => {
          console.log(`\n${index + 1}. [Score: ${session.score.toFixed(3)}] ${session.sessionId}`);
          console.log(`   Topic: "${session.topic}"`);
          if (session.summary) {
            console.log(`   Summary: ${session.summary.substring(0, 100)}${session.summary.length > 100 ? '...' : ''}`);
          }
          if (session.lastActivity) {
            console.log(`   Last Activity: ${new Date(session.lastActivity).toLocaleString()}`);
          }
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
   * Run basic search examples
   */
  async runBasicSearches() {
    console.log('🚀 [SIMPLE CHAT HISTORY SEARCH] Starting basic searches...\n');

    // Connect to database
    const connected = await this.connect();
    if (!connected) {
      console.log('❌ Cannot proceed without database connection.');
      return;
    }

    // Example searches
    const searchQueries = [
      'React',
      'database',
      'error',
      'function',
      'Node.js'
    ];

    console.log('📋 Running example searches...\n');

    for (const query of searchQueries) {
      await this.search(query, 3);
      console.log(''); // Add spacing between searches
    }

    // Session search example
    await this.searchSessions('test', 3);

    console.log('\n✅ Basic searches completed!');
  }
}

/**
 * Run basic searches if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const searcher = new SimpleChatHistorySearch();

  searcher.runBasicSearches().then(() => {
    console.log('\n🎯 Search completed successfully!');
    process.exit(0);
  }).catch((error) => {
    console.error('\n❌ Search failed:', error);
    process.exit(1);
  });
}

export default SimpleChatHistorySearch;