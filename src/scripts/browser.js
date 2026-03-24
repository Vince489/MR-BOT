import { Agent } from './Agent.js';
import dotenv from 'dotenv';
import { browserTool } from './src/tools/browserTool.js';

dotenv.config();

const agent = new Agent({
  apiKey: process.env.MISTRAL_API_KEY,
  systemPrompt: 'You are a browser automation agent.',
  tools: [browserTool]
});

const result = await agent.execute([], 'Open example.com in the browser.');
console.log(result.response);