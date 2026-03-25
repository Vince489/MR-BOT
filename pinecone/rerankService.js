/**
 * Rerank Service - Uses Mistral's rerank API for improved retrieval accuracy
 */

import { Mistral } from "@mistralai/mistralai";
import { retry } from './retry.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

let mistralClient;

try {
  if (MISTRAL_API_KEY) {
    mistralClient = new Mistral({ apiKey: MISTRAL_API_KEY });
    console.log("[Rerank] Mistral client initialized for reranking service.");
  } else {
    console.warn("[Rerank] CRITICAL: MISTRAL_API_KEY not set. Reranking will not work.");
  }
} catch (error) {
  console.error("[Rerank] CRITICAL FAILURE initializing Mistral client:", error);
}

/**
 * Rerank documents using Mistral's rerank API
 * @param {string} query - The search query
 * @param {Array} documents - Array of document objects with 'text' property
 * @param {number} topK - Number of top results to return
 * @returns {Promise<Array>} Reranked documents with scores
 */
export async function rerankDocuments(query, documents, topK = 10) {
  if (!mistralClient) {
    console.warn("[Rerank] Mistral client not available. Returning original documents.");
    return documents.slice(0, topK).map((doc, index) => ({
      ...doc,
      rerankScore: doc.score || 0,
      rank: index + 1
    }));
  }

  if (!query || !documents || documents.length === 0) {
    console.warn("[Rerank] Invalid input for reranking. Returning empty array.");
    return [];
  }

  try {
    // Prepare documents for Mistral rerank API
    const documentsForRerank = documents.map(doc => ({
      content: typeof doc === 'string' ? doc : (doc.text || doc.content || String(doc))
    }));

    console.log(`[Rerank] Reranking ${documentsForRerank.length} documents for query: "${query.substring(0, 50)}..."`);

    // Call Mistral rerank API with retry logic
    const rerankResponse = await retry(async () => {
      try {
        // Check if the client has a rerank method
        if (typeof mistralClient.rerank !== 'function') {
          console.warn("[Rerank] Mistral client does not have a rerank method. Using fallback.");
          throw new Error("Rerank method not available");
        }

        return await mistralClient.rerank({
          model: "mistral-rerank",
          query: query,
          documents: documentsForRerank,
          topK: Math.min(topK, documentsForRerank.length)
        });
      } catch (error) {
        // Handle specific API errors
        if (error.message && error.message.includes("fetch failed")) {
          console.error("[Rerank] Network error during reranking.");
          throw error;
        }
        if (error.code) {
          console.error(`[Rerank] API Error ${error.code}: ${error.message}`);
        }
        throw error;
      }
    }, {
      maxRetries: 3,
      initialDelay: 500,
      backoffFactor: 2,
      jitter: true
    });

    if (!rerankResponse || !rerankResponse.results) {
      console.warn("[Rerank] Invalid rerank response. Returning original documents.");
      return documents.slice(0, topK).map((doc, index) => ({
        ...doc,
        rerankScore: doc.score || 0,
        rank: index + 1
      }));
    }

    // Map reranked results back to original documents
    const rerankedDocuments = rerankResponse.results.map((result, index) => {
      const originalDoc = documents[result.index];
      return {
        ...originalDoc,
        rerankScore: result.relevance_score || 0,
        rank: index + 1,
        originalIndex: result.index
      };
    });

    console.log(`[Rerank] Successfully reranked ${rerankedDocuments.length} documents.`);
    return rerankedDocuments;

  } catch (error) {
    console.error("[Rerank] Error during reranking (after retries):", error);
    console.warn("[Rerank] Falling back to original document order.");

    // Fallback: return original documents with original scores
    return documents.slice(0, topK).map((doc, index) => ({
      ...doc,
      rerankScore: doc.score || 0,
      rank: index + 1
    }));
  }
}

/**
 * Check if reranking service is available
 * @returns {boolean} True if reranking can be used
 */
export function isRerankAvailable() {
  return !!mistralClient && !!process.env.MISTRAL_API_KEY && typeof mistralClient.rerank === 'function';
}
