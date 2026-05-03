import { Agent } from '../Agent.js';
import readline from 'node:readline';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { calculatorTool } from '../tools/calculatorTool.js';
import { dateTimeTool } from '../tools/dateTimeTool.js';
import { thoughtTool } from '../tools/thoughtTool.js';
import { dbsearchTool } from '../tools/dbsearchTool.js';

dotenv.config();

// node src/scripts/chat-5

const SYSTEM_PROMPT = fs.readFileSync('./src/docs/persona-4.md', 'utf8');

async function main() {
console.log('🤖 AUTOBOT Chat Interface v5.0 - ENHANCED STREAMING');
  console.log('===========================================================================\n');

  // Initialize agent with MongoDB storage and tools including thought tool
  const agent = new Agent({
    apiKey: process.env.MISTRAL_API_KEY,
    systemPrompt: SYSTEM_PROMPT,
    storageType: 'mongodb', // Just specify the storage type
    sessionId: process.env.SESSION_ID, // Explicitly use the SESSION_ID from .env
    tools: [thoughtTool, calculatorTool, dateTimeTool, dbsearchTool],
    debug: true, // Enable debug mode to see enhanced streaming features
    enableEvents: true // Enable event system for progress tracking
  });

    // Load existing history - this will initialize the storage if needed
    // Explicitly pass the session ID to ensure it's used
    const history = await agent.loadHistory(process.env.SESSION_ID);

    // Create readline interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n💬 You: '
    });

    // For restarting chat, we need to handle tool calls and responses carefully
    // Only keep user and assistant messages (without tool calls) to avoid API errors
    const filteredHistory = history.filter(msg => {
      // Keep user messages
      if (msg.role === 'user') return true;

      // Keep assistant messages, but only if they don't contain tool calls
      // This prevents the "Not the same number of function calls and responses" error
      if (msg.role === 'assistant') {
        return !msg.toolCalls || msg.toolCalls.length === 0;
      }

      // Filter out tool messages and assistant messages with tool calls
      return false;
    });

    // Track current conversation messages
    let messages = [...filteredHistory];

    // Track the index of the last saved message to prevent duplicates
    let lastSavedIndex = filteredHistory.length;

  // Display help on start
  printHelp();

  // Start the prompt
  rl.prompt();

  rl.on('line', async (input) => {
    const trimmed = input.trim();

    // Handle empty input
    if (!trimmed) {
      rl.prompt();
      return;
    }

  // Handle special commands
  if (trimmed.startsWith('/')) {
    const command = trimmed.toLowerCase();

    if (command === '/quit' || command === '/exit') {
      console.log('\n👋 Goodbye!');
      rl.close();
      return;
    }

    if (command === '/clear') {
      await agent.clearHistory();
      messages = [];
      lastSavedIndex = 0; // Reset index tracker to prevent slicing errors
      console.log('🗑️  Chat history cleared.');
      rl.prompt();
      return;
    }

    if (command === '/history') {
      const stats = await agent.getStorageStats();
      console.log(`\n📊 History Stats:`);
      console.log(`   Session ID: ${stats.sessionId}`);
      console.log(`   Total messages: ${stats.totalMessages}`);
      console.log(`   User messages: ${stats.userMessages}`);
      console.log(`   Assistant messages: ${stats.assistantMessages}`);
      if (stats.oldestMessage) {
        console.log(`   Oldest message: ${new Date(stats.oldestMessage).toLocaleString()}`);
      }
      if (stats.newestMessage) {
        console.log(`   Newest message: ${new Date(stats.newestMessage).toLocaleString()}`);
      }
      rl.prompt();
      return;
    }

    if (command === '/status') {
      const status = await agent.getStorageStatus();
      console.log(`\n🔌 Connection Status:`);
      console.log(`   Type: ${status.type}`);
      console.log(`   Session ID: ${status.sessionId}`);
      if (status.connection) {
        console.log(`   Connected: ${status.connection.isConnected}`);
        console.log(`   State: ${status.connection.readyState}`);
      }
      rl.prompt();
      return;
    }

    if (command === '/progress') {
      const progress = agent.getProgress();
      const history = agent.getProgressHistory();
      console.log(`\n📊 Progress Tracking:`);
      console.log(`   Current Progress: ${progress || 'No progress tracked'}`);
      console.log(`   Progress Updates: ${history.length}`);
      if (history.length > 0) {
        console.log(`   Latest Update: ${new Date(history[history.length - 1].timestamp).toLocaleString()}`);
      }
      rl.prompt();
      return;
    }

    if (command === '/mode') {
      console.log(`\n🔧 Agent Mode Configuration:`);
      console.log(`   Debug Mode: ${agent.debug ? 'ENABLED' : 'DISABLED'}`);
      console.log(`   Events Enabled: ${agent.enableEvents ? 'ENABLED' : 'DISABLED'}`);
      console.log(`   Enhanced Streaming: ACTIVE (using StreamingResponseProcessor)`);
      console.log(`   Semantic Loop Detection: ACTIVE (using ToolExecutionManager)`);
      console.log(`   Memory Integration: ACTIVE`);
      rl.prompt();
      return;
    }

    if (command === '/help') {
      printHelp();
      rl.prompt();
      return;
    }

    if (command === '/new') {
      messages = [];
      lastSavedIndex = 0; // Reset index tracker to prevent slicing errors
      console.log('🆕 Started new conversation (history saved in MongoDB).');
      rl.prompt();
      return;
    }

    console.log(`❓ Unknown command: ${trimmed}. Type /help for available commands.`);
    rl.prompt();
    return;
  }

    // Process user message
    try {
      process.stdout.write('\n🤖 Assistant: ');

      // Use streaming execution to provide real-time responses
      const result = await agent.executeStream(messages, trimmed, (chunk) => {
        if (typeof chunk === 'string') {
          process.stdout.write(chunk);
        }
      });

      process.stdout.write('\n');

      // The Agent returns [System, ...oldMessages, ...newMessages]
      // We want to skip the System (1) and the oldMessages (countBefore)
      const countBefore = messages.length;
      const turnDelta = result.fullMessages.slice(1 + countBefore);

      // Save only the new messages (prevents duplicates)
      if (turnDelta.length > 0) {
        await agent.saveHistory(turnDelta);
      }

      // CRITICAL: Keep our local 'messages' variable clean (no system prompt)
      // This prevents the system prompt from doubling up every turn
      messages = result.fullMessages.slice(1);

      // Sync the index tracker
      lastSavedIndex = messages.length;

    } catch (error) {
      console.error(`\n❌ Error: ${error.message}`);

      if (error.message.includes('API key')) {
        console.error('   Please check your MISTRAL_API_KEY in .env file.');
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });

  rl.on('SIGINT', async () => {
    console.log('\n\n👋 Goodbye!');
    rl.close();
  });
}

// Empty printHelp function as requested
function printHelp() {
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});