import { EventEmitter } from "events";
import { Mistral } from "@mistralai/mistralai";

/**
 * Simplified Agent class - Core functionality for interacting with Mistral API
 * Supports stateless external history and session management
 */
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
     */
    constructor(config) {
        super();

        // Basic validation
        if (!config.apiKey) throw new Error("apiKey is required");
        if (!config.systemPrompt) throw new Error("systemPrompt is required");

        this.apiKey = config.apiKey;
        this.model = config.model || "mistral-medium-2505";
        this.systemPrompt = config.systemPrompt;
        this.temperature = config.temperature ?? 0.7;
        this.tools = config.tools || [];
        this.tool_choice = config.tool_choice || "auto";
        this.parallelToolCalls = config.parallelToolCalls !== false;
        this.response_format = config.response_format;

        // Optional session ID for external history management
        this.sessionId = config.sessionId || this._generateSessionId();

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
    }

    /**
     * Generate a unique session ID
     * @returns {string} - Generated session ID
     * @private
     */
    _generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Send a message to the Mistral API using external history
     * @param {Array} messages - Array of message objects for this turn
     * @param {Array} [history=[]] - Optional external conversation history
     * @returns {Promise<Object>} - Mistral API response
     */
    async sendMessage(messages, history = []) {
        try {
            const response = await this.client.chat.complete({
                model: this.model,
                messages: [
                    { role: "system", content: this.systemPrompt },
                    ...history, // Use external history
                    ...messages, // Add current messages
                ],
                ...(this.tools.length > 0 && { tools: this.tools }),
                temperature: this.temperature,
                tool_choice: this.tool_choice,
                ...(this.response_format && { response_format: this.response_format }),
            });

            this.emit("message", response);
            return response;
        } catch (error) {
            this.emit("error", error);
            throw error;
        }
    }
}
