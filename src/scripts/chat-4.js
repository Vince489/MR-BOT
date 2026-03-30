import { Agent } from '../Agent.js';
import readline from 'node:readline';
import dotenv from 'dotenv';
import { calculatorTool } from '../tools/calculatorTool.js';
import { dateTimeTool } from '../tools/dateTimeTool.js';
import { thoughtTool } from '../tools/thoughtTool.js';
import { dbsearchTool } from '../tools/dbsearchTool.js';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// node src/scripts/chat-4 

async function loadSystemPrompt() {
  try {
    const personaPath = path.join(process.cwd(), 'src', 'docs', 'persona-4.md');
    const content = await fs.readFile(personaPath, 'utf-8');
    
    // Get current timestamp using the Date/Time Tool for consistency
    const currentTimestamp = await dateTimeTool.handler({
      action: 'getCurrentTime',
      format: 'iso'
    });
    
    // Replace the placeholder with actual timestamp
    const systemPrompt = content.replace(
      '[Dynamic timestamp from Date/Time Tool]',
      currentTimestamp
    );
    
    // Use the entire content as the system prompt - markdown formatting is fine for LLMs
    return systemPrompt;
  } catch (error) {
    console.error('Failed to load persona-4.md:', error.message);
    process.exit(1);
  }
}

async function main() {
  console.log('🤖 AUTOBOT Chat Interface v4.0 - MANDATORY THOUGHT PROCESS');
  console.log('=========================================================\n');

  // Load the system prompt from persona-4.md
  const systemPrompt = await loadSystemPrompt();

  // Initialize agent with MongoDB storage and tools including thought tool
  const agent = new Agent({
    apiKey: process.env.MISTRAL_API_KEY,
    systemPrompt: systemPrompt,
    storageType: 'mongodb', // Just specify the storage type
    tools: [thoughtTool, calculatorTool, dateTimeTool, dbsearchTool],
    debug: false,
    sessionId: process.env.SESSION_ID // Use session ID from environment
  });

  // Load existing history
  const history = await agent.loadHistory();

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💬 You: '
  });

  // Track current conversation messages
  let messages = [...history];
  
  // Track the index of the last saved message to prevent duplicates
  let lastSavedIndex = history.length;

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

function printHelp() {
  console.log('\n📖 Commands:');
  console.log('   /help    - Show this help message');
  console.log('   /clear   - Clear chat history from MongoDB');
  console.log('   /history - Show history statistics');
  console.log('   /status  - Show MongoDB connection status');
  console.log('   /new     - Start new conversation (keeps saved history)');
  console.log('   /quit    - Exit the chat');
  console.log('\n💡 IMPORTANT: This interface enforces mandatory thought process.');
  console.log('   The AI will ALWAYS use the thought tool before responding.');
  console.log('   This ensures systematic, well-reasoned responses.\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});