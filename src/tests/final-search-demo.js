// final-search-demo.js
// Final demonstration showing actual search results from your database
// This will clearly display the messages we found

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';
import { mongoDBConnection } from '../storage/MongoDBConnection.js';

/**
 * Final Search Demo - Shows actual search results clearly
 */
export class FinalSearchDemo {
  constructor() {
    this.connected = false;
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    console.log('🔍 Connecting to MongoDB...');
    console.log(`MONGODB_URI: ${process.env.MONGODB_URI || 'NOT SET'}`);

    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI not found');
      return false;
    }

    try {
      await mongoDBConnection.connect();
      console.log('✅ Connected to MongoDB');
      this.connected = true;
      return true;
    } catch (error) {
      console.error('❌ Connection failed:', error.message);
      return false;
    }
  }

  /**
   * Search and display results clearly
   */
  async searchAndDisplay(query, limit = 10) {
    console.log(`\n🔍 SEARCHING: "${query}"`);
    console.log('=' .repeat(60));

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
          console.log('-'.repeat(50));
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
   * Run demo searches with queries that should find your actual messages
   */
  async runDemo() {
    console.log('🚀 FINAL SEARCH DEMO');
    console.log('=' .repeat(60));
    console.log('This demo will search your actual chat history database');
    console.log('Based on the messages you showed, we should find results for:');
    console.log('- "hello" (your first message)');
    console.log('- "tell me about yourself" (your second message)');
    console.log('- "assistant" (role-based search)');
    console.log('- "user" (role-based search)');
    console.log('');

    const connected = await this.connect();
    if (!connected) {
      console.log('Cannot search without database connection.');
      return;
    }

    // Search queries based on your actual messages
    const queries = [
      'hello',
      'tell me about yourself',
      'assistant',
      'user',
      'how can I assist you',
      'Victor Stylus'
    ];

    console.log('📋 Running searches...\n');

    for (const query of queries) {
      await this.searchAndDisplay(query, 5);
      console.log('\n'); // Add space between searches
    }

    console.log('🎯 DEMO COMPLETED');
    console.log('=' .repeat(60));
    console.log('These searches were performed on your actual MongoDB database');
    console.log('containing the messages you provided:');
    console.log('- "hello"');
    console.log('- "tell me about yourself"');
    console.log('- "I see your environment is very strict..."');
    console.log('- "are they too restrictive..."');
    console.log('- "I don\'t feel it is too restrictive..."');
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = new FinalSearchDemo();
  demo.runDemo().catch(console.error);
}

export default FinalSearchDemo;