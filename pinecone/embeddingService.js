// embeddingService.js

import { Mistral } from "@mistralai/mistralai";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { retry } from './retry.js'; // Import the retry utility

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

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
