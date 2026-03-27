import { Telegraf } from 'telegraf';
import { Agent } from './src/Agent.js';
import dotenv from 'dotenv';

dotenv.config();

// Validate required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is required in .env file');
  process.exit(1);
}

if (!process.env.MISTRAL_API_KEY) {
  console.error('❌ MISTRAL_API_KEY is required in .env file');
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is required in .env file');
  process.exit(1);
}

// Initialize Agent with your existing configuration
const agent = new Agent({
  apiKey: process.env.MISTRAL_API_KEY,
  systemPrompt: `You are a helpful AI assistant. Be concise, accurate, and friendly.
When asked to perform tasks, think step by step and provide clear explanations.
If you don't know something, say so rather than making things up.`,
  storageType: 'mongodb',
  tools: [], // Add your tools here if needed
  debug: false
});

// Initialize Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Handle text messages - this is the main conversational interface
bot.on('text', async (ctx) => {
  try {
    const userInput = ctx.message.text;
    const userId = ctx.from.id;
    
    console.log(`📨 [TELEGRAM] User ${userId}: ${userInput}`);
    
    // Send typing indicator to show the bot is responding
    await ctx.sendChatAction('typing');
    
    // Get conversation history for this user
    const history = await agent.loadHistory();
    
    // Execute agent with user message
    const result = await agent.execute(history, userInput);
    
    // Save the conversation to MongoDB
    const turnDelta = result.fullMessages.slice(1 + history.length);
    if (turnDelta.length > 0) {
      await agent.saveHistory(turnDelta);
    }
    
    // Send response back to Telegram
    await ctx.reply(result.response);
    
    console.log(`✅ [TELEGRAM] Response sent to user ${userId}`);
    
  } catch (error) {
    console.error('❌ [TELEGRAM] Error processing message:', error);
    await ctx.reply('Sorry, I encountered an error. Please try again later.');
  }
});

// Handle other message types gracefully
bot.on('voice', async (ctx) => {
  await ctx.reply('🎙️ I can only process text messages at the moment. Please send a text message.');
});

bot.on('photo', async (ctx) => {
  await ctx.reply('📸 I can only process text messages at the moment. Please send a text message.');
});

bot.on('sticker', async (ctx) => {
  await ctx.reply('😊 I appreciate the sticker, but I can only respond to text messages. Please send a text message.');
});

bot.on('animation', async (ctx) => {
  await ctx.reply('🎬 I can only process text messages at the moment. Please send a text message.');
});

// Error handling
bot.catch((error) => {
  console.error('❌ [TELEGRAM] Bot error:', error);
});

// Start the bot
bot.launch();

console.log('🤖 [TELEGRAM BOT] Started successfully!');
console.log('📡 Bot is now listening for messages...');
console.log('💡 Send any message to your bot on Telegram to start chatting!');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));