/**
 * Token counting utility using js-tiktoken.
 * Provides accurate token counting for messages arrays.
 * 
 * Note: Using cl100k_base encoding as an approximation for Mistral models.
 * Mistral uses a SentencePiece-based tokenizer, but cl100k_base provides
 * a reasonable approximation (typically within 10-15% accuracy).
 */

import { getEncoding } from 'js-tiktoken';

// Initialize once - encoding initialization is expensive
// cl100k_base is used for GPT-4/GPT-3.5-turbo and serves as a good approximation
const enc = getEncoding('cl100k_base');

/**
 * Count tokens in a string
 * @param {string} text - Text to count tokens for
 * @returns {number} - Token count
 */
export function countTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  return enc.encode(text).length;
}

/**
 * Count tokens in a messages array using js-tiktoken
 * @param {Array} messages - Array of message objects with role, content, and optionally tool_calls
 * @returns {number} - Total token count
 */
export function countMessageTokens(messages) {
  if (!Array.isArray(messages)) {
    return 0;
  }

  return messages.reduce((total, msg) => {
    let tokenCount = 0;
    
    // Count content tokens
    if (typeof msg.content === 'string') {
      tokenCount += enc.encode(msg.content).length;
    } else if (msg.content) {
      // Handle array content (e.g., vision messages)
      tokenCount += enc.encode(JSON.stringify(msg.content)).length;
    }
    
    // Count tool calls tokens if present
    if (msg.tool_calls) {
      tokenCount += enc.encode(JSON.stringify(msg.tool_calls)).length;
    }
    
    // +4 tokens per message for role/formatting overhead (name, role separators, etc.)
    return total + tokenCount + 4;
  }, 0);
}

/**
 * Get the encoding instance for direct use if needed
 * @returns {Object} - The tiktoken encoding instance
 */
export function getTokenizerEncoding() {
  return enc;
}