/**
 * MessageFactory.js - The "Sanity Gate" of the Swarm.
 * 
 * Part of Phase 4: SDK-Agnostic Message Factory.
 * Enforces strict camelCase (toolCallId) internally while providing 
 * a "Corrective Edge" for non-deterministic model outputs.
 */

export class MessageFactory {
  /**
   * Creates a strictly validated Tool Response message.
   * This is the internal "Source of Truth" for tool results.
   * 
   * @param {string} id - The tool call ID (camelCase internally).
   * @param {any} content - The result from the tool handler.
   * @returns {Object} - A frozen, SDK-compliant tool message.
   * @throws {Error} - If the ID is missing or incorrectly formatted.
   */
  static createToolMessage(id, content) {
    if (!id) {
      throw new Error("[MESSAGE_FACTORY_ERROR]: Cannot create tool message without a toolCallId.");
    }

    // Phase 1.1 Implementation: Strict camelCase only.
    // We explicitly avoid checking for tool_call_id here to enforce developer discipline.
    const message = {
      role: "tool",
      content: typeof content === "object" ? JSON.stringify(content) : String(content),
      toolCallId: id
    };

    // Prevent downstream mutation to maintain architectural integrity.
    return Object.freeze(message);
  }

  /**
   * Phase 1.3: The Model Guard (Auto-Correction).
   * Normalizes raw tool calls from the LLM before they enter the system logic.
   * 
   * @param {Object} rawToolCall - The tool call object directly from the SDK/Model.
   * @returns {Object} - A normalized tool call object.
   */
  static normalizeToolCall(rawToolCall) {
    if (!rawToolCall) return null;

    // The "Model Typos" Sanitizer:
    // If the model hallucinations lead it to use 'tool_call_id' instead of 'id',
    // we correct it at the edge so the internal logic remains pristine.
    const id = rawToolCall.id || rawToolCall.tool_call_id || rawToolCall.toolCallId;

    if (!id) {
      console.warn("⚠️ [MESSAGE_FACTORY]: Received tool call without any identifiable ID mapping.");
    }

    return {
      id: id,
      type: "function",
      function: {
        name: rawToolCall.function?.name || "unknown",
        arguments: rawToolCall.function?.arguments || "{}"
      }
    };
  }

  /**
   * Normalizes an Assistant message to ensure SDK compliance.
   * Handles the camelCase/snake_case conversion for toolCalls arrays.
   * 
   * @param {Object} message - The assistant message from the loop.
   * @returns {Object} - A normalized assistant message.
   */
  static normalizeAssistantMessage(message) {
    if (message.role !== "assistant") return message;

    const normalized = {
      role: "assistant",
      content: message.content || ""
    };

    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      normalized.toolCalls = message.toolCalls.map(tc => this.normalizeToolCall(tc));
    }

    return Object.freeze(normalized);
  }

  /**
   * Formats a message for outbound SDK transmission.
   * Ensures that the 'toolCallId' required by Mistral is present and correctly mapped.
   * 
   * @param {Object} msg - Internal message object.
   * @returns {Object} - SDK-ready message object.
   */
  static toSDKFormat(msg) {
    if (msg.role === "tool") {
      return {
        role: "tool",
        content: msg.content,
        // Mistral SDK v1.x expects toolCallId (camelCase)
        toolCallId: msg.toolCallId
      };
    }

    if (msg.role === "assistant" && msg.toolCalls) {
      return {
        role: "assistant",
        content: msg.content || "",
        toolCalls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: tc.function
        }))
      };
    }

    return msg;
  }
}