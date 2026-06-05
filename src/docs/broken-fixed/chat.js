import { Agent } from "./A3.js";
import readline from 'readline';

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Example configuration
const config = {
    apiKey: process.env.MISTRAL_API_KEY,
    systemPrompt: "You are a helpful assistant.",
    mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/newbot"
};

// Create an instance of the Agent
const agent = new Agent(config);

// Function to start the chat
async function startChat() {
    console.log("Welcome to the Mistral AI Chat Interface!");
    console.log("Type 'exit' or 'quit' to end the chat.\n");

    // The database connection is automatically handled in the constructor
    // if mongoUri is provided in the config
    console.log("Chat started. Conversation history will be saved to MongoDB if connected.\n");

    // Start the chat loop
    chatLoop();
}

// Chat loop function
async function chatLoop() {
    rl.question('You: ', async (input) => {
        // Exit conditions
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
            console.log("Goodbye!");

            // Disconnect from MongoDB if connected
            try {
                await agent.disconnectFromDatabase();
            } catch (error) {
                console.error("Error disconnecting from MongoDB:", error);
            }

            rl.close();
            return;
        }

        try {
            // Display the assistant's response as it streams
            console.log("Assistant: ");

            // Send the message to the agent and process the stream
            let fullResponse = '';
            for await (const chunk of agent.sendMessage([
                { role: "user", content: input }
            ])) {
                process.stdout.write(chunk);
                fullResponse += chunk;
            }

            console.log("\n"); // Add newline after response completes

            // Continue the chat loop
            chatLoop();
        } catch (error) {
            console.error("Error:", error.message);
            // Continue the chat loop even if there's an error
            chatLoop();
        }
    });
}

// Start the chat
startChat();