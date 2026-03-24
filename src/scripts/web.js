import { Agent } from '../Agent.js';
import dotenv from 'dotenv';
import { calculatorTool } from '../tools/calculator_tool.js';
import { browserTool } from '../tools/browser_tool.js';

dotenv.config();

const agent = new Agent({
  apiKey: process.env.MISTRAL_API_KEY,
  systemPrompt: `You are a methodical research agent. 
    You have access to a calculator for precise math, and a browser.`,
  tools: [calculatorTool, browserTool]
});

const triggerPrompt = `
1. Open the website https://example.com in the browser.
2. Calculate the square root of 486.
`;

console.log("🚀 Executing multi-step task with Progress Tracking...");

const result = await agent.execute([], triggerPrompt);

console.log("\n--- AGENT RESPONSE ---");
console.log(result.response);

// This will show you the checklist history captured via your _captureProgressIntent logic
console.log("\n--- CAPTURED PROGRESS CHECKLISTS ---");
const history = agent.getProgressHistory();
if (history.length > 0) {
  history.forEach((entry, index) => {
    console.log(`[Update ${index + 1}]:\n${entry.progress}\n`);
  });
} else {
  console.log("No progress updates were captured. (Check if the model decided to skip the optional parameter)");
}