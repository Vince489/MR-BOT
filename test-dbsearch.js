import { dbsearchTool } from './src/tools/dbsearchTool.js';
import { mongoDBConnection } from './src/storage/MongoDBConnection.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Test script for the dbsearch tool
 * This script tests the basic functionality of the dbsearch tool
 */

async function testDbSearchTool() {
  console.log('🧪 Testing DB Search Tool...\n');

  // Initialize MongoDB connection
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoDBConnection.connect();
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    console.log('⚠️  Skipping tests due to connection failure');
    return;
  }

  try {
    // Test 1: List sessions
    console.log('Test 1: Listing sessions...');
    const listResult = await dbsearchTool.handler({
      action: 'listSessions',
      limit: 5
    });
    console.log('List sessions result:', JSON.stringify(listResult, null, 2));

    // Test 2: Search messages (if there are any sessions)
    if (listResult.sessions && listResult.sessions.length > 0) {
      const sessionId = listResult.sessions[0].sessionId;
      console.log(`\nTest 2: Searching messages in session ${sessionId}...`);
      const searchResult = await dbsearchTool.handler({
        action: 'searchMessages',
        sessionId: sessionId,
        query: 'test',
        limit: 10
      });
      console.log('Search messages result:', JSON.stringify(searchResult, null, 2));
    }

    // Test 3: Get session info
    if (listResult.sessions && listResult.sessions.length > 0) {
      const sessionId = listResult.sessions[0].sessionId;
      console.log(`\nTest 3: Getting session info for ${sessionId}...`);
      const infoResult = await dbsearchTool.handler({
        action: 'getSessionInfo',
        sessionId: sessionId
      });
      console.log('Session info result:', JSON.stringify(infoResult, null, 2));
    }

    // Test 4: Search by time
    console.log('\nTest 4: Searching messages from last 24 hours...');
    const timeResult = await dbsearchTool.handler({
      action: 'searchByTime',
      timePeriod: '24 hours',
      limit: 10
    });
    console.log('Time search result:', JSON.stringify(timeResult, null, 2));

    console.log('\n✅ All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testDbSearchTool();