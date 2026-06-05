import { EventEmitter } from "events";
import { Mistral } from "@mistralai/mistralai";
import { DatabaseManager } from "./DatabaseManager.js";
import { SessionManager } from "./SessionManager.js";

export class Agent extends EventEmitter {
    /**
     * Creates a new Agent instance
     * @param {Object} config - Configuration object
     * @param {string} config.apiKey - Mistral API key
     * @param {string} [config.model="mistral-medium-2505"] - Model to use
     * @param {string} config.systemPrompt - System instructions for the agent
     * @param {number} [config.temperature=0.7] - Temperature for response generation
     * @param {Array} [config.tools=[]] - Array of tool definitions
     * @param {string} [config.tool_choice="auto"] - Tool choice strategy
     * @param {boolean} [config.parallelToolCalls=true] - Execute multiple tool calls concurrently
     * @param {Object} [config.response_format] - Response format configuration
     * @param {string} [config.sessionId] - Optional session ID for conversation tracking
     * @param {string} [config.mongoUri] - MongoDB connection URI
     */
    constructor(config) {
        super();

        // Basic validation
        if (!config.apiKey) throw new Error("apiKey is required");
        if (!config.systemPrompt) throw new Error("systemPrompt is required");

        this.apiKey = config.apiKey;
        this.model = config.model || "mistral-medium-2505";
        this.systemPrompt = config.systemPrompt || "You are a helpful assistant.";
        this.temperature = config.temperature ?? 0.7;
        this.tools = config.tools || [];
        this.tool_choice = config.tool_choice || "auto";
        this.parallelToolCalls = config.parallelToolCalls !== false;
        this.response_format = config.response_format;

        // Initialize session manager
        this.sessionManager = new SessionManager();
        if (config.sessionId) {
            this.sessionManager.setSessionId(config.sessionId);
        }

        // Initialize Mistral client
        this.client = new Mistral({
            apiKey: config.apiKey,
            retryConfig: {
                strategy: "backoff",
                backoff: {
                    initialInterval: 1000,
                    maxInterval: 16000,
                    exponent: 2,
                    maxElapsedTime: 60000,
                },
                retryConnectionErrors: true,
            },
        });

        // Initialize database manager if mongoUri is provided
        this.dbManager = null;
        if (config.mongoUri) {
            this.dbManager = new DatabaseManager();
            this.dbManager.setMongoUri(config.mongoUri);

            // Forward database events
            this.dbManager.on("database_connected", (connection) => {
                this.emit("database_connected", connection);
            });

            this.dbManager.on("database_error", (error) => {
                this.emit("database_error", error);
            });

            this.dbManager.on("database_disconnected", () => {
                this.emit("database_disconnected");
            });
        }
    }

    /**
     * Get conversation history from MongoDB
     * @returns {Promise<Array>} - Array of message objects for history
     */
    async getConversationHistory() {
        if (!this.dbManager) {
            return [];
        }

        const messages = await this.dbManager.findMessages({ sessionId: this.sessionManager.getSessionId() });
        return messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    /**
     * Save a conversation turn to MongoDB
     * @param {Array} messages - Array of message objects for this turn
     * @param {Object} response - Mistral API response
     */
    async saveConversationTurn(messages, response) {
        if (!this.dbManager) {
            return;
        }

        // Save user message
        const userMessage = messages.find(m => m.role === "user");
        if (userMessage) {
            await this.dbManager.saveMessage({
                sessionId: this.sessionManager.getSessionId(),
                role: userMessage.role,
                content: userMessage.content
            });
        }

        // Save assistant message
        await this.dbManager.saveMessage({
            sessionId: this.sessionManager.getSessionId(),
            role: "assistant",
            content: response.choices[0].message.content
        });
    }

    /**
     * Send a message to the Mistral API using MongoDB conversation history with streaming
     * @param {Array} messages - Array of message objects for this turn
     * @returns {AsyncIterable<string>} - Async iterable of response chunks
     */
    async *sendMessage(messages) {
        try {
            // Get conversation history from MongoDB
            const dbHistory = await this.getConversationHistory();

            // Start streaming response
            const responseStream = await this.client.chat.stream({
                model: this.model,
                messages: [
                    { role: "system", content: this.systemPrompt },
                    ...dbHistory, // Use MongoDB conversation history
                    ...messages,  // Add current messages
                ],
                ...(this.tools.length > 0 && { tools: this.tools }),
                temperature: this.temperature,
                tool_choice: this.tool_choice,
                ...(this.response_format && { response_format: this.response_format }),
            });

            let fullResponse = '';

            // Process and yield each chunk
            for await (const chunk of responseStream) {
                // Extract content from the Mistral API response format
                const content = chunk.data?.choices[0]?.delta?.content || '';
                if (content) {
                    fullResponse += content;
                    yield content;
                }
            }

            // Save to history after stream completes
            const completeResponse = {
                choices: [{
                    message: {
                        role: "assistant",
                        content: fullResponse
                    }
                }]
            };
            await this.saveConversationTurn(messages, completeResponse);
            this.emit("message", completeResponse);
        } catch (error) {
            this.emit("error", error);
            throw error;
        }
    }

    /**
     * Disconnect from MongoDB
     */
    async disconnectFromDatabase() {
        if (this.dbManager) {
            await this.dbManager.disconnectFromDatabase();
        }
    }
}
