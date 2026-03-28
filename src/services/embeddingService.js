// embeddingService.js
// Enhanced embedding service with MongoDB integration and automatic embedding generation

import { Mistral } from "@mistralai/mistralai";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { retry } from '../../pinecone/retry.js'; // Import the retry utility

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE || 'https://api.mistral.ai/v1';

console.log('🔍 [EMBEDDING SERVICE] Loading environment variables...');
console.log('   .env path:', path.join(__dirname, '..', '..', '.env'));
console.log('   MISTRAL_API_KEY loaded:', !!MISTRAL_API_KEY);
console.log('   MISTRAL_API_BASE:', MISTRAL_API_BASE);

if (!MISTRAL_API_KEY) {
  console.error("CRITICAL: MISTRAL_API_KEY is not set in environment variables. Embedding service will not work.");
}

let mistralClient; // Will store the Mistral client instance

try {
  if (MISTRAL_API_KEY) {
    mistralClient = new Mistral({ apiKey: MISTRAL_API_KEY });
    console.log("Mistral client initialized for embedding service.");
  } else {
    console.warn("CRITICAL: Embedding service could not be initialized due to missing MISTRAL_API_KEY.");
  }
} catch (error) {
  console.error("CRITICAL FAILURE initializing Mistral client for Embedding Service:", error);
  // mistralClient will remain undefined
}

/**
 * Generate embedding for a single text using Mistral-embed model (1024 dimensions)
 */
export async function generateEmbedding(text) {
  if (!mistralClient) {
    console.error("generateEmbedding: Mistral client is not initialized. This indicates a startup problem.");
    throw new Error("Mistral client is not initialized. Check server startup logs for initialization errors.");
  }

  if (!text || typeof text !== 'string' || text.trim() === "") {
    console.warn("generateEmbedding called with empty or invalid text.");
    throw new Error("Cannot generate embedding for empty or invalid text.");
  }

  // Check if text is too long for the embedding model
  // Mistral has a token limit, approximately 8K tokens for mistral-embed
  if (text.length > 32000) { // Conservative character limit (roughly 8K tokens)
    console.error(`Input text (length: ${text.length}) exceeds the approximate 32,000 character limit for the Mistral embedding model.`);
    throw new Error("Input text exceeds the maximum length for embedding.");
  }

  try {
    // Enhanced retry logic with more attempts and better error handling
    const result = await retry(async () => {
      try {
        const response = await mistralClient.embeddings.create({
          model: "mistral-embed",
          inputs: [text]
        });
        return response;
      } catch (error) {
        // Handle specific network errors
        if (error.message && error.message.includes("fetch failed")) {
          console.error("Network error during embedding generation. This could be due to connectivity issues or API rate limiting.");
          throw error;
        }
        // Handle API-specific errors
        if (error.code) {
          console.error(`API Error ${error.code}: ${error.message}`);
        }
        throw error;
      }
    }, {
      maxRetries: 5,          // Increased from 3 to 5
      initialDelay: 1000,     // Increased from 500 to 1000
      backoffFactor: 2,       // Exponential backoff
      jitter: true,           // Add jitter to avoid thundering herd
      retryOn: (error) => {
        // Retry on network errors and rate limiting
        return error.message.includes("fetch failed") ||
               error.message.includes("rate limit") ||
               error.message.includes("too many requests") ||
               error.code === 429; // HTTP 429 Too Many Requests
      }
    });

    if (result && result.data && result.data.length > 0 && result.data[0].embedding) {
      return result.data[0].embedding;
    } else {
      console.error("Embedding result from Mistral is invalid or does not contain expected structure (result.data[0].embedding):", result);
      throw new Error("Failed to generate valid embedding structure from Mistral.");
    }
  } catch (error) {
    console.error("Error during Mistral embeddings.create call (after retries):", error);

    // Log specific details if available from the error object
    if (error.message) {
      if (error.message.includes("token limit")) {
        console.error(`Input text (length: ${text.length}) likely exceeded the token limit for the Mistral embedding model.`);
      } else if (error.message.includes("API key not valid")) {
        console.error("The MISTRAL_API_KEY is likely invalid or missing required permissions.");
      } else if (error.message.includes("fetch failed")) {
        console.error("Network connectivity issue. Check your internet connection and API endpoint availability.");
      } else if (error.message.includes("rate limit") || error.message.includes("too many requests")) {
        console.error("API rate limit exceeded. Consider reducing request frequency or increasing your quota.");
      }
    }

    // Provide more detailed error information
    throw new Error(`Failed to generate embedding: ${error.message || error}`);
  }
}

/**
 * Batch generate embeddings for multiple texts
 */
export async function batchGenerateEmbeddings(texts) {
  if (!Array.isArray(texts)) {
    throw new Error("Input must be an array of strings");
  }

  const batchSize = 10; // Mistral API limit
  const results = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await fetch(`${MISTRAL_API_BASE}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mistral-embed',
        input: batch
      })
    });

    const data = await response.json();
    results.push(...data.data);
  }

  return results.map(item => item.embedding);
}

/**
 * Semantic junk filtering - prevents embedding noise that reduces search accuracy
 */
export function shouldEmbed(message) {
  // Skip tool messages without human-readable content
  if (message.role === 'tool' && !message.content) return false;
  
  // Skip very short messages that don't contain meaningful information
  if (message.content && message.content.length < 20) return false;
  
  // Skip common noise patterns
  const noisePatterns = ['ok', 'hello', 'hi', 'thanks', 'thank you', 'bye'];
  if (message.content && noisePatterns.some(pattern => 
    message.content.toLowerCase().includes(pattern))) return false;
  
  return true;
}

/**
 * Background embedding for new messages with semantic filtering
 */
export async function backgroundEmbedMessage(messageId, content, role) {
  try {
    // Apply semantic filtering
    if (!shouldEmbed({ content, role })) {
      console.log(`Skipping embedding for semantic junk: ${content.substring(0, 30)}...`);
      return false;
    }
    
    const vector = await generateEmbedding(content);
    const Message = await import('../models/Message.js');
    await Message.default.findByIdAndUpdate(messageId, { embedding: vector });
    return true;
  } catch (error) {
    console.error(`Failed to embed message ${messageId}:`, error);
    return false;
  }
}

/**
 * Immediate embedding for current session to solve cold start problem
 */
export async function immediateEmbedCurrentSession(sessionId, content, role) {
  try {
    if (!shouldEmbed({ content, role })) return false;
    
    const vector = await generateEmbedding(content);
    const Message = await import('../models/Message.js');
    
    // Find the most recent message in this session and update it
    const latestMessage = await Message.default.findOne({ session: sessionId })
      .sort({ createdAt: -1 });
    
    if (latestMessage) {
      await Message.default.findByIdAndUpdate(latestMessage._id, { embedding: vector });
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Failed to immediate embed for session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Session summary automation - triggers every 10 messages or mode changes
 */
export async function summarizeSession(sessionId) {
  try {
    const Message = await import('../models/Message.js');
    const Session = await import('../models/Session.js');
    
    const messages = await Message.default.find({ session: sessionId })
      .sort({ createdAt: 1 })
      .limit(50); // Get last 50 messages for context
    
    if (messages.length === 0) return false;
    
    // Generate session summary using a small model
    const summaryPrompt = `Summarize the key topics and decisions from this conversation in 2-3 sentences:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
    
    // Use mistral-small for cost-effective summarization
    const summaryResponse = await fetch(`${MISTRAL_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mistral-small',
        messages: [{ role: 'user', content: summaryPrompt }],
        max_tokens: 200
      })
    });
    
    const summaryData = await summaryResponse.json();
    const summary = summaryData.choices[0].message.content;
    
    // Generate embedding for the summary
    const embedding = await generateEmbedding(summary);
    
    // Update session with summary and embedding
    await Session.default.findByIdAndUpdate(sessionId, {
      summary,
      sessionEmbedding: embedding,
      topic: extractTopic(summary) // Simple topic extraction
    });
    
    return true;
  } catch (error) {
    console.error(`Failed to summarize session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Simple topic extraction from session summary
 */
export function extractTopic(summary) {
  // Basic keyword extraction - could be enhanced with NLP
  const keywords = ['bug', 'feature', 'optimization', 'refactor', 'design', 'architecture', 'debugging', 'testing', 'deployment'];
  const summaryLower = summary.toLowerCase();
  for (const keyword of keywords) {
    if (summaryLower.includes(keyword)) return keyword;
  }
  return 'general';
}

/**
 * Auto-embed new messages when they are saved to MongoDB
 * This function should be called from the Message model's save hook
 */
export async function autoEmbedNewMessage(messageData) {
  try {
    // Only embed if the message doesn't already have an embedding
    if (messageData.embedding && messageData.embedding.length > 0) {
      return true; // Already embedded
    }
    
    // Apply semantic filtering
    if (!shouldEmbed(messageData)) {
      console.log(`Auto-embedding skipped for semantic junk: ${messageData.content?.substring(0, 30)}...`);
      return false;
    }
    
    const vector = await generateEmbedding(messageData.content || "");
    const Message = await import('../models/Message.js');
    
    // Update the message with the embedding
    await Message.default.findByIdAndUpdate(messageData._id, { embedding: vector });
    return true;
  } catch (error) {
    console.error('Auto-embedding failed:', error);
    return false;
  }
}

/**
 * Generate embeddings for all existing messages in a session (for migration)
 */
export async function migrateSessionEmbeddings(sessionId) {
  try {
    const Message = await import('../models/Message.js');
    const Session = await import('../models/Session.js');
    
    // Find all messages in the session without embeddings
    const messages = await Message.default.find({ 
      session: sessionId, 
      embedding: { $exists: false } 
    });
    
    if (messages.length === 0) {
      console.log(`No messages to migrate for session ${sessionId}`);
      return true;
    }
    
    console.log(`Migrating embeddings for ${messages.length} messages in session ${sessionId}`);
    
    let successCount = 0;
    let failureCount = 0;
    
    for (const message of messages) {
      try {
        if (await autoEmbedNewMessage(message)) {
          successCount++;
        } else {
          failureCount++;
        }
      } catch (error) {
        console.error(`Failed to migrate embedding for message ${message._id}:`, error);
        failureCount++;
      }
    }
    
    console.log(`Migration complete for session ${sessionId}: ${successCount} successful, ${failureCount} failed`);
    
    // Also generate session summary
    await summarizeSession(sessionId);
    
    return successCount > 0;
  } catch (error) {
    console.error(`Migration failed for session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Health check for embedding service
 */
export async function checkEmbeddingServiceHealth() {
  try {
    if (!mistralClient) {
      return {
        status: 'error',
        message: 'Mistral client not initialized',
        details: {
          apiKeySet: !!MISTRAL_API_KEY,
          clientInitialized: false
        }
      };
    }
    
    // Test with a simple embedding request
    const testVector = await generateEmbedding("test");
    const isHealthy = Array.isArray(testVector) && testVector.length === 1024;
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      message: isHealthy ? 'Embedding service is healthy' : 'Embedding service returned invalid vector',
      details: {
        apiKeySet: !!MISTRAL_API_KEY,
        clientInitialized: !!mistralClient,
        testVectorLength: testVector?.length || 0,
        expectedDimensions: 1024
      }
    };
  } catch (error) {
    return {
      status: 'error',
      message: `Embedding service health check failed: ${error.message}`,
      details: {
        apiKeySet: !!MISTRAL_API_KEY,
        clientInitialized: !!mistralClient,
        error: error.message
      }
    };
  }
}