import { Agent } from '../Agent.js';
import readline from 'node:readline';
import dotenv from 'dotenv';

dotenv.config();

// node src/scripts/chat.js

const SYSTEM_PROMPT = `You are a helpful AI assistant. Be concise, accurate, and friendly.
When asked to perform tasks, think step by step and provide clear explanations.
If you don't know something, say so rather than making things up.`;

async function main() {
  console.log('🤖 AUTOBOT Chat Interface');
  console.log('========================\n');

  // Initialize agent with JSON storage (no manual imports needed)
  const agent = new Agent({
    apiKey: process.env.MISTRAL_API_KEY,
    systemPrompt: SYSTEM_PROMPT,
    storageType: 'json', // Just specify the storage type
    tools: [],
    debug: false
  });

  // Load existing history
  const history = await agent.loadHistory();
  if (history.length > 0) {
    console.log(`📁 Loaded ${history.length} previous messages.\n`);
  }

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💬 You: '
  });

  // Track current conversation messages
  let messages = [...history];

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
        console.log('🗑️  Chat history cleared.');
        rl.prompt();
        return;
      }

      if (command === '/history') {
        const stats = await agent.getStorageStats();
        console.log(`\n📊 History Stats:`);
        console.log(`   Total messages: ${stats.totalMessages}`);
        console.log(`   User messages: ${stats.userMessages}`);
        console.log(`   Assistant messages: ${stats.assistantMessages}`);
        if (stats.fileSize) {
          console.log(`   File size: ${(stats.fileSize / 1024).toFixed(2)} KB`);
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
        console.log('🆕 Started new conversation (history saved).');
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

      // Execute with streaming
      const result = await agent.executeStream(messages, trimmed, (chunk) => {
        if (typeof chunk === 'string') {
          process.stdout.write(chunk);
        }
      });

      process.stdout.write('\n');

      // Update messages with the full conversation
      messages = result.fullMessages;

      // Save history (filter out system messages)
      const historyToSave = messages.filter(msg => msg.role !== 'system');
      await agent.saveHistory(historyToSave);

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

  rl.on('SIGINT', () => {
    console.log('\n\n👋 Goodbye!');
    rl.close();
  });
}

function printHelp() {
  console.log('\n📖 Commands:');
  console.log('   /help    - Show this help message');
  console.log('   /clear   - Clear chat history file');
  console.log('   /history - Show history statistics');
  console.log('   /new     - Start new conversation (keeps saved history)');
  console.log('   /quit    - Exit the chat');
  console.log('\n💡 Just type your message to chat with the AI.\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});