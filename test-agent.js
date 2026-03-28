import { Agent } from './src/Agent.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Simple test to verify the Agent is working with the new dbsearch tool
 */

async function testAgent() {
  console.log('🧪 Testing Agent with dbsearch tool...\n');

  try {
    // Import the tools
    const { dbsearchTool } = await import('./src/tools/dbsearchTool.js');
    const { mongoDBConnection } = await import('./src/storage/MongoDBConnection.js');

    // Initialize MongoDB connection
    await mongoDBConnection.connect();
    console.log('✅ MongoDB connected');

    // Initialize agent with MongoDB storage and tools
    const agent = new Agent({
      apiKey: process.env.MISTRAL_API_KEY,
      systemPrompt: "You are a helpful assistant. Test the dbsearch tool.",
      storageType: 'mongodb',
      tools: [dbsearchTool],
      debug: true
    });

    console.log('✅ Agent initialized successfully');
    console.log('✅ Tools loaded:', agent.tools.length);
    console.log('✅ Tool handlers:', Object.keys(agent.handlers));

    // Test a simple message
    const result = await agent.execute([], "Hello, test the dbsearch tool");
    console.log('✅ Agent response:', result.response);

  } catch (error) {
    console.error('❌ Agent test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testAgent();