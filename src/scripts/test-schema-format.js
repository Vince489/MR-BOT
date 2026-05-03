import { Agent } from '../Agent.js';

// Mock tool for testing
const mockTool = {
  function: {
    name: "mock_tool",
    description: "A mock tool for testing schema format",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string" }
      },
      required: ["input"]
    }
  },
  handler: async (args) => {
    console.log("Mock tool called with args:", args);
    return { status: "success", result: `Processed: ${args.input}` };
  }
};

// Test function
async function testSchemaFormat() {
  const agent = new Agent({
    apiKey: process.env.MISTRAL_API_KEY,
    systemPrompt: "You are a helpful assistant. Use the provided tools when needed.",
    tools: [mockTool],
    debug: true
  });

  try {
    const response = await agent.execute([], "Test the schema format with a simple request.");
    console.log("Response:", response);
  } catch (error) {
    console.error("Error during test:", error);
  }
}

// Run the test
testSchemaFormat();