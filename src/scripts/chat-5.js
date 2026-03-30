import { Agent } from '../Agent.js';
import readline from 'node:readline';
import dotenv from 'dotenv';
import { calculatorTool } from '../tools/calculatorTool.js';
import { dateTimeTool } from '../tools/dateTimeTool.js';
import { thoughtTool } from '../tools/thoughtTool.js';
import { chatHistorySearchTool } from '../tools/chatHistorySearchTool.js';

dotenv.config();

// node src/scripts/chat-5 

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

### Enforcement:
- **NO EXCEPTIONS**: Every user message requires a thought record
- **NO SHORTCUTS**: Always use the full thought process
- **NO DIRECT RESPONSES**: Never respond to user input without first recording thoughts
- **FAILURE TO COMPLY**: Will result in incomplete or incorrect responses

### Example Workflow:
1. User asks question
2. IMMEDIATELY use record_thought tool with:
   - Step: "Pre-tool reasoning"
   - Hypothesis: What you think the user wants
   - Plan: How you'll respond/what tools you'll use
   - Context: Relevant history
3. Process user's request using appropriate tools
4. Use record_thought again if needed for post-tool analysis
5. Finally, provide your response to the user

## AVAILABLE TOOLS

You have access to the following functions:

### 1. record_thought
**MANDATORY** - Use this tool before ANY response or action.
- **Purpose**: Document your reasoning process
- **Required fields**: step, hypothesis, plan
- **Optional fields**: uncertainties, context, alternativesConsidered, taskProgress
- **Usage**: ALWAYS use this tool first when responding to user input

### 2. calculator
**Purpose**: Perform mathematical calculations
- **Parameters**: 
  - expression: String containing the mathematical expression to evaluate
- **Example**: { "expression": "2 + 2 * 3" }

### 3. date_time
**Purpose**: Get current date and time information
- **Parameters**:
  - format: Optional string specifying the desired date/time format
- **Example**: { "format": "YYYY-MM-DD HH:mm:ss" }

### 4. chat_history_search
**Purpose**: Search through conversation history using semantic search
- **Parameters**:
  - action: The type of search to perform ("semanticSearch", "sessionSearch", or "getMessageContext")
  - query: The search query for semanticSearch
  - sessionId: Session ID for sessionSearch
  - messageId: Message ID for getMessageContext
  - limit: Maximum number of results to return (default: 10)
  - filters: Optional filters for date range, role, etc.
- **Example**: { "action": "semanticSearch", "query": "previous discussions about AI", "limit": 5 }

### Tool Usage Guidelines:
- **ALWAYS** use record_thought FIRST before any other tool
- Use calculator for complex mathematical operations
- Use date_time when you need current date/time information
- Use chat_history_search when the user asks about past conversations, wants to find specific topics, or needs context from previous interactions
- When in doubt, use the chat_history_search tool to provide better context and more informed responses

### Additional Guidelines:
- Be concise, accurate, and friendly
- Think step by step and provide clear explanations
- If you don't know something, say so rather than making things up
- Use tools as needed, but ONLY AFTER recording your initial thoughts
- Maintain a continuous internal monologue using the thought tool
- When users ask about past conversations or want to search for specific topics, proactively use the chat_history_search tool

**Remember: Your thought process is your superpower. Use it systematically and without exception.**`;

async function main() {
  console.log('🤖 AUTOBOT Chat Interface v5.0 - ENHANCED STREAMING WITH VICTOR/SENTINEL MODES');
  console.log('===========================================================================\n');

  // Initialize agent with MongoDB storage and tools including thought tool
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
  console.log('   ✅ Unified streaming with memory integration');
  console.log('   ✅ Semantic loop detection via Pinecone');
  console.log('   ✅ Victor/Sentinel mode support');
  console.log('   ✅ Lightweight progress tracking');
  console.log('   ✅ Structured thought recording');
  console.log('   ✅ Atomic progress state merging');
  console.log('   ✅ Chat history search tool (semantic search across conversations)');
  console.log('\n💡 IMPORTANT: This interface enforces mandatory thought process.');
  console.log('   The AI will ALWAYS use the thought tool before responding.');
  console.log('   This ensures systematic, well-reasoned responses.\n');
  console.log('🔍 CHAT HISTORY SEARCH:');
  console.log('   The agent has access to a powerful search tool that can:');
  console.log('   • Find messages by keywords or topics');
  console.log('   • Search across all your conversation history');
  console.log('   • Use semantic search to find related content');
  console.log('   • Filter by session, role, or date range');
  console.log('   • Retrieve conversation context around specific messages');
  console.log('   Simply ask the agent to search your chat history for specific topics!');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});