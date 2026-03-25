import mongoose from 'mongoose';
import { connect } from '../mongodb.js';
import AdvancedMemory from '../models/AdvancedMemory.js';
import { generateEmbedding } from '../pinecone/embeddingService.js';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

// Initialize Pinecone client
dotenv.config();

// Initialize Pinecone only if API key is available
let pineconeIndex;
if (process.env.PINECONE_API_KEY) {
  try {
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    // Get the index name from environment or use default
    const indexName = process.env.PINECONE_INDEX_NAME || 'varjis-2';
    console.log(`[DEBUG] Attempting to initialize Pinecone index: ${indexName}`);

    // Get the index
    pineconeIndex = pinecone.Index(indexName);
    console.log(`[DEBUG] Pinecone index initialized: ${indexName}`);
  } catch (error) {
    console.error(`[DEBUG] Failed to initialize Pinecone: ${error.message}`);
    pineconeIndex = null;
  }
} else {
  console.warn("[DEBUG] Pinecone API key not found. Pinecone functionality will be disabled.");
}

/**
 * Hybrid Memory Tools using MongoDB + Pinecone
 *
 * This implements a professional Long-Term Memory (LTM) system with:
 * - MongoDB for structured, flexible storage (Cortex)
 * - Pinecone for semantic search (Hippocampus)
 * - Mistral for embedding generation
 */

// Tool 1: Commit to Long-Term Memory
export const commitToLongTermMemoryTool = {
  function: {
    name: "commit_to_long_term_memory",
    description: "Saves important facts, preferences, or complex data structures for future sessions. " +
                 "This tool uses a hybrid architecture with MongoDB for structured storage and Pinecone for semantic search.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "A natural language summary used for semantic searching later. " +
                       "This should be a concise description of what's being stored."
        },
        category: {
          type: "string",
          enum: ["preference", "history", "technical_spec", "personal_fact", "project_knowledge"],
          description: "High-level category for filtering and organization."
        },
        payload: {
          type: "object",
          description: "The flexible, nested JSON object containing the deep data to be stored. " +
                       "This can include any structured information that should be remembered."
        },
        importance: {
          type: "number",
          description: "Importance rating from 1-10 (10 being most important). " +
                       "Higher importance memories will be prioritized in search results and retained longer.",
          minimum: 1,
          maximum: 10,
          default: 5
        }
      },
      required: ["summary", "category", "payload"]
    }
  },
  handler: async ({ summary, category, payload, importance = 5 }) => {
    try {
      const sessionId = process.env.SESSION_ID;
      if (!sessionId) {
        throw new Error("SESSION_ID environment variable is required.");
      }

      // Step 1: Check for semantic duplicates
      let duplicateCheck = { exists: false };
      if (pineconeIndex) {
        duplicateCheck = await checkForDuplicates(summary, category, sessionId);
        if (duplicateCheck.exists) {
          return {
            success: false,
            message: `A similar memory already exists (ID: ${duplicateCheck.id}) with score ${duplicateCheck.score.toFixed(2)}. ` +
                     "Should I update the existing memory or create a new one?",
            duplicate_id: duplicateCheck.id,
            similarity_score: duplicateCheck.score
          };
        }
      } else {
        console.warn("[DEBUG] Pinecone index not available, skipping duplicate check");
      }

      // Step 2: Save to MongoDB
      const memoryDoc = {
        owner_id: sessionId,
        text: summary, // Required field for the schema
        vector: [], // Placeholder - will be updated after embedding generation
        metadata: {
          category: category,
          importance: importance,
          tokens: summary.split(' ').length, // Required field
          created_at: new Date(),
          last_accessed: new Date(),
          entities: extractEntities(summary),
          decay_rate: calculateDecayRate(importance)
        },
        payload: payload
      };

      await connect();
      const mongoResult = await AdvancedMemory.create(memoryDoc);

      // Step 3: Generate embedding
      const vector = await generateEmbedding(summary);

      // Debug: Check if vector is valid
      console.log(`[DEBUG] Generated vector length: ${vector.length}`);
      console.log(`[DEBUG] Vector sample: [${vector.slice(0, 5).join(', ')}]`);

      // Step 4: Update MongoDB document with the vector
      await AdvancedMemory.updateOne(
        { _id: mongoResult._id },
        { $set: { vector: vector } }
      );

      // Step 5: Save to Pinecone
      const pineconeRecord = {
        id: mongoResult._id.toString(),
        values: vector,
        metadata: {
          owner_id: sessionId,
          category: category,
          importance: importance,
          mongo_id: mongoResult._id.toString()
        }
      };

      // Debug: Log the Pinecone record
      console.log("[DEBUG] Pinecone record:", {
        id: pineconeRecord.id,
        values_length: pineconeRecord.values.length,
        values_sample: pineconeRecord.values.slice(0, 5),
        metadata: pineconeRecord.metadata
      });

      // Check if the record is valid before upserting
      if (!pineconeRecord.id || !pineconeRecord.values || pineconeRecord.values.length === 0) {
        console.error("Invalid Pinecone record:", pineconeRecord);
        throw new Error("Invalid Pinecone record: missing required fields");
      }

      // Check if Pinecone is available
      if (!pineconeIndex) {
        console.warn("[DEBUG] Pinecone index not available, skipping Pinecone upsert");
      } else {
        // Debug: Check if Pinecone index is available
        const indexName = process.env.PINECONE_INDEX_NAME || 'varjis-2';
        console.log("[DEBUG] Pinecone index name:", indexName);

        // Try to upsert with error handling
        try {
          await pineconeIndex.namespace(process.env.PINECONE_NAMESPACE).upsert({ records: [pineconeRecord] });
          console.log("[DEBUG] Pinecone upsert successful");
        } catch (error) {
          console.error("[DEBUG] Pinecone upsert error:", error);
          // Don't throw error - we can still function with just MongoDB
          console.warn("[DEBUG] Continuing with MongoDB-only storage");
        }
      }

      console.log(`🔧 [HYBRID MEMORY] Committed to long-term memory: ${summary}`);

      return {
        success: true,
        message: `Memory successfully committed to long-term storage.`,
        memory_id: mongoResult._id.toString(),
        category: category,
        summary: summary
      };
    } catch (error) {
      console.error(`[HYBRID MEMORY ERROR] ${error.message}`);
      return {
        success: false,
        message: `Failed to commit to long-term memory: ${error.message}`
      };
    }
  }
};

// Tool 2: Recall from Long-Term Memory
export const recallFromLongTermMemoryTool = {
  function: {
    name: "recall_from_long_term_memory",
    description: "Retrieves stored knowledge using semantic search and structured queries. " +
                 "This tool finds relevant information even if the exact topic isn't specified, " +
                 "using vector embeddings to understand the meaning of your query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query describing what knowledge you're looking for"
        },
        category: {
          type: "string",
          enum: ["preference", "history", "technical_spec", "personal_fact", "project_knowledge", "any"],
          description: "Category filter to narrow down results. Use 'any' to search all categories.",
          default: "any"
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return",
          default: 3,
          minimum: 1,
          maximum: 10
        },
        min_importance: {
          type: "number",
          description: "Minimum importance score (1-10) for results",
          default: 1,
          minimum: 1,
          maximum: 10
        }
      },
      required: ["query"]
    }
  },
  handler: async ({ query, category = "any", limit = 3, min_importance = 1 }) => {
    try {
      const sessionId = process.env.SESSION_ID;
      if (!sessionId) {
        throw new Error("SESSION_ID environment variable is required.");
      }

      // Check if Pinecone is available
      if (!pineconeIndex) {
        console.warn("[DEBUG] Pinecone index not available, falling back to MongoDB-only search");
        await connect();
        const mongoResults = await AdvancedMemory.find({
          owner_id: sessionId,
          "metadata.category": category !== "any" ? category : { $exists: true },
          "metadata.importance": { $gte: min_importance }
        }).limit(limit).lean();

        return {
          success: true,
          query: query,
          results: mongoResults,
          message: `Found ${mongoResults.length} relevant knowledge entries for your query (MongoDB-only search).`
        };
      }

      // Step 1: Generate query embedding
      const queryVector = await generateEmbedding(query);

      // Step 2: Build Pinecone filter
      const pineconeFilter = {
        owner_id: sessionId,
        importance: { $gte: min_importance }
      };

      if (category !== "any") {
        pineconeFilter.category = category;
      }

      // Step 3: Query Pinecone
      const pineconeResults = await pineconeIndex.query({
        vector: queryVector,
        topK: limit,
        filter: pineconeFilter,
        includeMetadata: true
      });

      // Step 4: Get MongoDB IDs from Pinecone results
      const mongoIds = pineconeResults.matches.map(match => match.id);

      if (mongoIds.length === 0) {
        console.log(`🔧 [HYBRID MEMORY] No results found for query: "${query}"`);
        return {
          success: true,
          query: query,
          results: [],
          message: `No relevant knowledge found for your query.`
        };
      }

      // Step 5: Fetch full documents from MongoDB
      await connect();
      const mongoResults = await AdvancedMemory.find({
        _id: { $in: mongoIds.map(id => new mongoose.Types.ObjectId(id)) }
      }).lean();

      // Step 6: Update last_accessed time
      await AdvancedMemory.updateMany(
        { _id: { $in: mongoIds.map(id => new mongoose.Types.ObjectId(id)) } },
        { $set: { "metadata.last_accessed": new Date() } }
      );

      // Combine Pinecone scores with MongoDB data
      const combinedResults = mongoResults.map(doc => {
        const pineconeMatch = pineconeResults.matches.find(m => m.id === doc._id.toString());
        return {
          ...doc,
          relevance_score: pineconeMatch.score,
          pinecone_metadata: pineconeMatch.metadata
        };
      });

      console.log(`🔧 [HYBRID MEMORY] Retrieved ${combinedResults.length} knowledge entries for query: "${query}"`);

      return {
        success: true,
        query: query,
        results: combinedResults,
        message: `Found ${combinedResults.length} relevant knowledge entries for your query.`
      };
    } catch (error) {
      console.error(`[HYBRID MEMORY ERROR] ${error.message}`);
      return {
        success: false,
        message: `Failed to recall from long-term memory: ${error.message}`
      };
    }
  }
};

// Helper function to check for duplicate memories
async function checkForDuplicates(summary, category, ownerId) {
  try {
    if (!pineconeIndex) {
      console.warn("[DEBUG] Pinecone index not available, skipping duplicate check");
      return { exists: false };
    }

    const queryVector = await generateEmbedding(summary);

    const results = await pineconeIndex.query({
      vector: queryVector,
      topK: 1,
      filter: {
        owner_id: ownerId,
        category: category
      }
    });

    if (results.matches && results.matches.length > 0 && results.matches[0].score > 0.95) {
      return {
        exists: true,
        id: results.matches[0].id,
        score: results.matches[0].score
      };
    }

    return { exists: false };
  } catch (error) {
    console.warn(`Duplicate check failed: ${error.message}`);
    return { exists: false };
  }
}

// Helper function to extract entities from text
function extractEntities(text) {
  const entities = new Set();

  // Add common entity patterns
  if (text.match(/python|javascript|java|c\+\+|rust|go|ruby/i)) {
    entities.add("programming_language");
  }

  if (text.match(/allerg(y|ies)|peanuts|gluten|dairy|nuts/i)) {
    entities.add("health_allergy");
  }

  // Add proper nouns (simple capitalized word detection)
  text.split(' ').forEach(word => {
    if (word.length > 3 && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
      entities.add(word.toLowerCase());
    }
  });

  return Array.from(entities);
}

// Helper function to calculate decay rate based on importance
function calculateDecayRate(importance) {
  // Higher importance = slower decay
  return 11 - importance; // 1-10 scale inverted
}