import { Agent } from "./Agent2.js";

// Example configuration
const config = {
  apiKey: "awcqLWKIvfxYVF9hkAAqFelBVzlKJ8uB", 
  systemPrompt: "You are a helpful assistant.",
  model: "mistral-medium-2505",
  temperature: 0.7,
};

// Create an instance of Agent2
const agent = new Agent(config);

// External conversation history
const history = [
  { role: "user", content: "Hello!" },
  { role: "assistant", content: "Hi there! How can I help?" }
];

// Current messages to send
const messages = [
  { role: "user", content: "What's the weather today?" }
];

// Test the agent
async function testAgent() {
  try {
    console.log("Testing Agent2 with external history...");
    console.log("Session ID:", agent.sessionId);
    console.log("External History:", history);
    console.log("Current Messages:", messages);

    // Send the message with external history
    const response = await agent.sendMessage(messages, history);

    // Log the full response, including the assistant's reply
    console.log("Full Response:", response);
    console.log("Assistant's Reply:", response.choices[0].message.content);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

// Run the test
testAgent();