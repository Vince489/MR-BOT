import { Agent } from './Agent.js';
import dotenv from 'dotenv';

dotenv.config();

const agent = new Agent({
  apiKey: process.env.MISTRAL_API_KEY,
  systemPrompt: 'You are a poem writer.',
  tools: []
});

await agent.executeStream([], 'Write a 4-line poem about mangoes.', (chunk) => {
  if (typeof chunk === 'string') {
    process.stdout.write(chunk);
  }
});
