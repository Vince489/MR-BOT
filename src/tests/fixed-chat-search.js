// fixed-chat-search.js
// Fixed version that properly loads environment variables and searches chat history
// This will show actual messages from your MongoDB database

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables first
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';
import { mongoDBConnection } from '../storage/MongoDBConnection.js';

/**
 * Fixed Chat Search - Properly loads environment and shows search results
 */
export class FixedChatSearch {
  constructor() {
    this.connected = false;
  }

  /**
   * Connect to MongoDB with explicit environment check
   */
  async connect() {
    console.log('🔍 Checking environment variables...');
    console.log(`MONGODB_URI: ${process.env.MONGODB_URI ? 'SET' : 'NOT SET'}`);
    console.log(`MISTRAL_API_KEY: ${process.env.MISTRAL_API_KEY ? 'SET' : 'NOT SET'}`);

    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI not found in environment variables');
      return false;
    }

    try {
      await mongoDBConnection.connect();
      console.log('✅ Connected to MongoDB');
      this.connected = true;
      return true;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      return false;
    }
  }

  /**
   * Search and display results clearly
   */
  async searchAndDisplay(query, limit = 10) {
    console.log(`\n🔍 SEARCHING: "${query}"`);
    console.log('=' .repeat(50));

    try {
      const result = await chatHistorySearchTool.handler({
        action: 'semanticSearch',
        query: query,
        limit: limit
      });

      if (result.success) {
        console.log(`✅ FOUND ${result.results.length} RESULTS\n`);

        if (result.results.length === 0) {
          console.log('No messages found for this query.');
          return [];
        }

        result.results.forEach((match, index) => {
          console.log(`${index + 1}. SCORE: ${match.score.toFixed(3)}`);
          console.log(`   ROLE: ${match.role.toUpperCase()}`);
          console.log(`   MESSAGE: ${match.content}`);
          console.log(`   SESSION: ${match.sessionId ? match.sessionId[0] : 'Unknown'}`);
          console.log(`   DATE: ${match.createdAt ? new Date(match.createdAt).toLocaleString() : 'Unknown'}`);
          console.log('-'.repeat(30));
        });

        return result.results;
      } else {
        console.log(`❌ SEARCH FAILED: ${result.message}`);
        return [];
      }
    } catch (error) {
      console.error(`❌ ERROR: ${error.message}`);
      return [];
    }
  }

  /**
   * Run searches with common queries
   */
  async runSearches() {
    console.log('🚀 FIXED CHAT HISTORY SEARCH');
    console.log('=' .repeat(60));

    // Connect first
    const connected = await this.connect();
    if (!connected) {
      console.log('Cannot search without database connection.');
      return;
    }

    // Common search queries
    const queries = [
      'React',
      'database',
      'error',
      'function',
      'Node.js',
      'JavaScript',
      'code',
      'help'
    ];

    console.log('\n📋 Running searches...\n');

    for (const query of queries) {
      await this.searchAndDisplay(query, 5);
      console.log('\n'); // Add space between searches
    }

    console.log('🎯 SEARCH COMPLETED');
    console.log('=' .repeat(60));
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const searcher = new FixedChatSearch();
  searcher.runSearches().catch(console.error);
}

export default FixedChatSearch;