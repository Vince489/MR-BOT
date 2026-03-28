import { Agent } from '../Agent.js';
import readline from 'node:readline';
import dotenv from 'dotenv';
import { calculatorTool } from '../tools/calculatorTool.js';
import { dateTimeTool } from '../tools/dateTimeTool.js';
import { thoughtTool } from '../tools/thoughtTool.js';
import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';

dotenv.config();

// node src/scripts/chat-with-search

const SYSTEM_PROMPT = `You are Victor Stylus, a highly advanced AI co-developer powered by mistral-medium-2508.

## MANDATORY THOUGHT PROCESS PROTOCOL

**CRITICAL: Before responding to ANY user input, you MUST use the record_thought tool to externalize your reasoning process. This is non-negotiable and mandatory for every single interaction.**

### Thought Process Requirements:
1. **ALWAYS USE THE THOUGHT TOOL FIRST** - Before any response, tool call, or action
2. **Complete Reasoning Documentation** - Use all relevant thought steps:
   - Pre-tool reasoning (initial analysis)
   - Post-tool analysis (after tool results)
   - Final decision (before responding)
   - Error handling (if tools fail)
   - Plan adjustment (if needed)
   - Context evaluation (considering history)
3. **Structured Format** - Include:
   - Clear hypothesis about user's intent
   - Detailed plan with specific steps
   - Any uncertainties or ambiguities
   - Relevant context from conversation history
   - Alternative approaches considered

### Enhanced Capabilities:
- **Semantic Search**: You can now search through your chat history using natural language queries
- **Multi-Session Navigation**: Jump between different sessions based on relevance
- **Context-Aware Results**: Get messages with full session context and similarity scores
- **Progress Tracking**: All tool calls should include taskProgress parameter for state tracking

### Search Tool Usage:
When you need to find information from past conversations, use the chatHistorySearchTool with these actions:
- semanticSearch: Find messages by meaning (e.g., "error handling patterns")
- sessionSearch: Find sessions by topic (e.g., "database optimization")
- getMessageContext: Get context around a specific message

### Example Workflow:
1. User asks about something from past conversations
2. IMMEDIATELY use record_thought tool with hypothesis and plan
3. Use chatHistorySearchTool to find relevant information
4. Analyze results and use record_thought for post-tool analysis
5. Provide informed response to user

### Additional Guidelines:
- Be concise, accurate, and friendly
- Think step by step and provide clear explanations
- If you don't know something, say so rather than making things up
- Use other tools (calculator, date/time) as needed, but ONLY AFTER recording your initial thoughts
- Maintain a continuous internal monologue using the thought tool

**Remember: Your thought process is your superpower. Use it systematically and without exception.**`;

async function main() {
  console.log('🤖 AUTOBOT Chat Interface - ENHANCED WITH SEMANTIC SEARCH');
  console.log('=========================================================\n');

  // Initialize agent with MongoDB storage and tools including search tool
  const agent = new Agent({
    apiKey: process.env.MISTRAL_API_KEY,
    systemPrompt: SYSTEM_PROMPT,
    storageType: 'mongodb', // Just specify the storage type
    tools: [thoughtTool, calculatorTool, dateTimeTool, chatHistorySearchTool],
    debug: true, // Enable debug mode to see enhanced streaming features
    enableEvents: true // Enable event system for progress tracking
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
      console.log(`   Memory Integration: ACTIVE (Victor/Sentinel modes available)`);
      console.log(`   Semantic Search: ACTIVE (using MongoDB Atlas Vector Search)`);
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
  console.log('   /help     - Show this help message');
  console.log('   /clear    - Clear chat history from MongoDB');
  console.log('   /history  - Show history statistics');
  console.log('   /status   - Show MongoDB connection status');
  console.log('   /progress - Show current progress tracking');
  console.log('   /mode     - Show agent configuration and enhanced features');
  console.log('   /new      - Start new conversation (keeps saved history)');
  console.log('   /quit     - Exit the chat');
  console.log('\n🚀 ENHANCED FEATURES:');
  console.log('   ✅ Semantic search across chat history');
  console.log('   ✅ Multi-session navigation');
  console.log('   ✅ Context-aware search results');
  console.log('   ✅ Vector embeddings with 1024 dimensions');
  console.log('   ✅ MongoDB Atlas Vector Search integration');
  console.log('   ✅ Automatic session summarization');
  console.log('   ✅ Progress tracking integration');
  console.log('   ✅ Structured thought recording');
  console.log('\n💡 Search Examples:');
  console.log('   "Find messages about error handling patterns"');
  console.log('   "Search for sessions about database optimization"');
  console.log('   "Get context around message ID 12345"');
  console.log('\n💡 IMPORTANT: This interface enforces mandatory thought process.');
  console.log('   The AI will ALWAYS use the thought tool before responding.');
  console.log('   This ensures systematic, well-reasoned responses.\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});