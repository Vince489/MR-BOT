import { Agent } from '../Agent.js';
import dotenv from 'dotenv';

dotenv.config();

// node src/scripts/simple.js

const agent = new Agent({
  apiKey: process.env.MISTRAL_API_KEY,
  systemPrompt: 'You are a poem writer.',
  tools: []
});

const result = await agent.execute([], 'Write a 4-line poem about mangoes.');
console.log(result.response);
