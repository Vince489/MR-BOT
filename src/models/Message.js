import mongoose from 'mongoose';
import { countMessageTokens } from '../Tokenizer.js';
const Schema = mongoose.Schema;

/**
 * THE MESSAGE SCHEMA
 * Designed for Mistral/OpenAI compatibility.
 * Links to a 'Session' document to group conversations.
 * Enhanced with vector search capabilities using 1024-dimensional embeddings.
 */
const messageSchema = new Schema({
  // Reference to the parent session
  session: { 
    type: Schema.Types.ObjectId, 
    ref: 'Session', 
    required: true, 
    index: true 
  },
  // Roles: 'user', 'assistant', 'system', or 'tool'
  role: { 
    type: String, 
    enum: ['user', 'assistant', 'system', 'tool'], 
    required: true 
  },
  // The text content (can be empty for toolCalls messages)
  content: { 
    type: String, 
    default: "" 
  }, 
  // --- VECTOR SEARCH ENHANCEMENTS ---
  // 1024 dimensions for Mistral-embed model (CORRECTED from 1536)
  embedding: {
    type: [Number], 
    required: false,
    index: false // Atlas Vector Index defined in UI
  },
  // Victor optimization: short summary for token efficiency
  summary: { type: String },
  // -----------------------------------
  
  // Mistral/OpenAI toolCalls format
  toolCalls: [{
    id: { type: String, required: true },
    type: { type: String, default: "function" },
    function: {
      name: { type: String, required: true },
      arguments: { type: String, required: true } // JSON string
    }
  }],
  // Must match the ID from the assistant's toolCalls
  toolCallId: {
    type: String
  },
  // Metadata for tracking and context management
  metadata: {
    tokens: { type: Number, default: 0 },
    model: { type: String },
    isPopped: { type: Boolean, default: false }
  }
}, { timestamps: true });

/**
 * INDEXING
 * Optimized for high-speed retrieval of the most recent context.
 */
messageSchema.index({ session: 1, createdAt: -1 });

/**
 * TEXT INDEX FOR FULL-TEXT SEARCH
 * Enables efficient $text search operations in dbsearchTool
 */
messageSchema.index({ content: "text" });

/**
 * OPTIMIZED INDEX FOR ACTIVE CONTEXT QUERIES
 * Used by syncContextWindow and loadHistory to efficiently filter by isPopped
 */
messageSchema.index({ session: 1, 'metadata.isPopped': 1, createdAt: -1 });

/**
 * ENHANCED VECTOR SEARCH INDEX CONFIGURATION
 * Optimized for tiered search with Victor/Sentinel mode support
 * 
 * Note: This index should be created in MongoDB Atlas UI with these exact settings:
 * - Type: Vector Search
 * - Path: embedding
 * - Dimensions: 1024
 * - Similarity: cosine
 * - Filters: session, role, metadata.isPopped
 */
messageSchema.statics.createOptimizedVectorIndex = function() {
  console.log('💡 [MESSAGE SCHEMA] Vector index configuration ready for Atlas UI');
  console.log('💡 [MESSAGE SCHEMA] Create index with these settings in Atlas:');
  console.log('  - Type: Vector Search');
  console.log('  - Path: embedding');
  console.log('  - Dimensions: 1024');
  console.log('  - Similarity: cosine');
  console.log('  - Filters: session, role, metadata.isPopped');
  
  return {
    indexName: 'vectorIndex',
    type: 'vectorSearch',
    path: 'embedding',
    dimensions: 1024,
    similarity: 'cosine',
    filters: ['session', 'role', 'metadata.isPopped']
  };
};

/**
 * STATIC METHODS
 */

// 1. Load History: Fetches and formats messages for the LLM API
messageSchema.statics.loadHistory = async function(sessionId) {
  try {
    // Add timeout to prevent hanging if MongoDB is slow/unresponsive
    const sessionPromise = mongoose.model('Session').findOne({ sessionId });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Session lookup timeout')), 5000)
    );
    
    const session = await Promise.race([sessionPromise, timeoutPromise]);
    
    if (!session) return [];
    
    // Filter by isPopped: false for active context only
    // NO LIMIT - let the pruning logic handle context management
    // Use .lean() to return plain JS objects, avoiding Mongoose virtual id conflicts
    const messages = await this.find({ 
      session: session._id, 
      'metadata.isPopped': false 
    }).sort({ createdAt: 1 }).lean();
    
    return messages.map(msg => {
      const result = {
        role: msg.role,
        content: msg.content || ""
      };
      
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Clean up tool calls to ensure correct structure without Mongoose artifacts
        result.toolCalls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        }));
      }
      
      if (msg.toolCallId) {
        result.toolCallId = msg.toolCallId;
      }
      
      return result;
    });
  } catch (error) {
    // Only log the error if it's not a timeout (timeout is expected when no session exists)
    if (!error.message.includes('timeout')) {
      console.error('Error loading message history:', error);
    }
    return [];
  }
};

// Helper method to calculate tokens for a single message
messageSchema.statics.calculateMessageTokens = function(message) {
  try {
    // Create a single-message array for the tokenizer
    const singleMessageArray = [message];
    return countMessageTokens(singleMessageArray);
  } catch (error) {
    console.warn('Failed to calculate tokens for message:', error.message);
    return 0;
  }
};

// 2. Save Messages: APPENDS new messages to the existing history
messageSchema.statics.saveMessages = async function(sessionId, newMessages) {
  try {
    const session = await mongoose.model('Session').findOne({ sessionId });
    if (!session) {
      console.error(`Session ${sessionId} not found. Cannot save messages.`);
      return false;
    }
    
    const messageDocs = newMessages.map(msg => {
      // Calculate token count for this individual message
      const tokenCount = this.calculateMessageTokens(msg);
      
      return {
        session: session._id,
        role: msg.role,
        content: msg.content || "",
        // Accept camelCase format
        toolCalls: (msg.toolCalls && msg.toolCalls.length > 0) ? msg.toolCalls : undefined,
        toolCallId: msg.toolCallId || undefined,
        metadata: {
          tokens: tokenCount,
          model: msg.metadata?.model || "unknown",
          isPopped: msg.metadata?.isPopped || false
        }
      };
    });
    
    if (messageDocs.length > 0) {
      await this.insertMany(messageDocs);
    }
    
    return true;
  } catch (error) {
    console.error('Error saving messages:', error);
    return false;
  }
};

// 3. Clear History: Wipes messages for a specific session
messageSchema.statics.clearHistory = async function(sessionId) {
  try {
    const session = await mongoose.model('Session').findOne({ sessionId });
    if (!session) return false;
    
    await this.deleteMany({ session: session._id });
    return true;
  } catch (error) {
    console.error('Error clearing message history:', error);
    return false;
  }
};

// 4. Get Stats: Useful for monitoring token usage or message counts
messageSchema.statics.getSessionStats = async function(sessionId) {
  try {
    const session = await mongoose.model('Session').findOne({ sessionId });
    if (!session) return { totalMessages: 0, userMessages: 0, assistantMessages: 0, totalTokens: 0 };
    
    const stats = await this.aggregate([
      { $match: { session: session._id } },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          userMessages: {
            $sum: { $cond: [{ $eq: ['$role', 'user'] }, 1, 0] }
          },
          assistantMessages: {
            $sum: { $cond: [{ $eq: ['$role', 'assistant'] }, 1, 0] }
          },
          totalTokens: { $sum: '$metadata.tokens' }
        }
      }
    ]);
    
    // Return the first result or default values if no results
    return stats.length > 0 ? stats[0] : { 
      totalMessages: 0, 
      userMessages: 0, 
      assistantMessages: 0, 
      totalTokens: 0 
    };
  } catch (error) {
    console.error('Error getting session stats:', error);
    return { totalMessages: 0, userMessages: 0, assistantMessages: 0, totalTokens: 0 };
  }
};

// 5. Sync Context Window: Role-aware pruning logic with tool call chain preservation
messageSchema.statics.syncContextWindow = async function(sessionId, modelLimit) {
  const target = modelLimit * 0.65;
  const session = await mongoose.model('Session').findOne({ sessionId });
  
  if (!session) return false;
  
  // Get all unpopped messages, newest first
  const messages = await this.find({ 
    session: session._id, 
    'metadata.isPopped': false 
  }).sort({ createdAt: -1 });

  let total = 0;
  let keepIds = [];
  let requiredToolIds = new Set();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // Check if we need to keep this message due to tool dependencies
    const isRequiredByTool = requiredToolIds.has(msg._id.toString());
    const isToolResult = msg.role === 'tool';
    const isAssistantWithToolCalls = msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0;
    
    if (total <= target || isRequiredByTool) {
      keepIds.push(msg._id);
      total += msg.metadata.tokens;
      
      // Track tool call dependencies
      if (isToolResult && msg.toolCallId) {
        requiredToolIds.add(msg.toolCallId);
      }
      
      if (isAssistantWithToolCalls) {
        msg.toolCalls.forEach(tc => {
          if (requiredToolIds.has(tc.id)) {
            requiredToolIds.delete(tc.id);
          }
        });
      }
    } else {
      // We're over 65% and all tool chains are closed
      break;
    }
  }

  // Mark everything else as popped
  await this.updateMany(
    { session: session._id, _id: { $nin: keepIds } },
    { $set: { 'metadata.isPopped': true } }
  );
  
  return true;
};

// 6. Pre-flight Pruning Helper: Automatic pruning before sending to LLM
messageSchema.statics.pruneBeforeSend = async function(sessionId) {
  try {
    const session = await mongoose.model('Session').findOne({ sessionId });
    if (!session) return false;
    
    // Get model limit from session config
    const modelLimit = session.modelConfig?.contextLimit || 131072;
    
    // Perform pre-flight pruning
    return await this.syncContextWindow(sessionId, modelLimit);
  } catch (error) {
    console.error('Error during pre-flight pruning:', error);
    return false;
  }
};

// 7. Get Full History: Retrieves complete history for UI display (ignores isPopped)
messageSchema.statics.getFullHistory = async function(sessionId) {
  try {
    const session = await mongoose.model('Session').findOne({ sessionId });
    if (!session) return [];
    
    // Get ALL messages regardless of isPopped status
    // NO LIMIT - this is for UI display of complete history
    const messages = await this.find({ session: session._id })
      .sort({ createdAt: -1 });
    
    return messages.reverse().map(msg => {
      const result = {
        role: msg.role,
        content: msg.content || "",
        isPopped: msg.metadata.isPopped || false
      };
      
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        result.toolCalls = msg.toolCalls;
      }
      
      if (msg.toolCallId) {
        result.toolCallId = msg.toolCallId;
      }
      
      return result;
    });
  } catch (error) {
    console.error('Error loading full message history:', error);
    return [];
  }
};

// 8. Embedding Management: Generate and store embeddings for messages
messageSchema.statics.generateEmbedding = async function(messageId, content, role) {
  try {
    // Import embedding service - use dynamic import to avoid circular dependencies
    const { generateEmbedding } = await import('../services/embeddingService.js');
    
    // Apply semantic filtering
    if (!this.shouldEmbed({ content, role })) {
      console.log(`Skipping embedding for semantic junk: ${content.substring(0, 30)}...`);
      return false;
    }
    
    const vector = await generateEmbedding(content);
    await this.findByIdAndUpdate(messageId, { embedding: vector });
    return true;
  } catch (error) {
    console.error(`Failed to embed message ${messageId}:`, error);
    return false;
  }
};

// 9. Semantic Filtering: Prevent embedding noise that reduces search accuracy
messageSchema.statics.shouldEmbed = function(message) {
  // Skip tool messages without human-readable content
  if (message.role === 'tool' && !message.content) return false;
  
  // Skip very short messages that don't contain meaningful information
  if (message.content && message.content.length < 20) return false;
  
  // Skip common noise patterns
  const noisePatterns = ['ok', 'hello', 'hi', 'thanks', 'thank you', 'bye'];
  if (message.content && noisePatterns.some(pattern => 
    message.content.toLowerCase().includes(pattern))) return false;
  
  return true;
};

// 10. Semantic Search: Perform vector search across message history
messageSchema.statics.semanticSearch = async function(params) {
  const {
    query,
    limit = 5,
    sessionId = null,
    dateRange = null,
    roleFilter = null
  } = params;

  try {
    // Import embedding service - use dynamic import to avoid circular dependencies
    const { generateEmbedding } = await import('../services/embeddingService.js');
    
    // Generate query vector
    const queryVector = await generateEmbedding(query);

    // Build aggregation pipeline
    const pipeline = [
      {
        $vectorSearch: {
          index: "vectorIndex",
          path: "embedding",
          queryVector: queryVector,
          numCandidates: limit * 10,
          limit: limit,
          filter: this.buildFilters(sessionId, dateRange, roleFilter)
        }
      },
      {
        $lookup: {
          from: "sessions",
          localField: "session",
          foreignField: "_id",
          as: "sessionInfo"
        }
      },
      {
        $project: {
          content: 1,
          role: 1,
          score: { $meta: "vectorSearchScore" },
          sessionId: "$sessionInfo.sessionId",
          sessionTopic: "$sessionInfo.topic",
          createdAt: 1
        }
      }
    ];

    return await this.aggregate(pipeline);
  } catch (error) {
    console.error('Error during semantic search:', error);
    return [];
  }
};

// 11. Helper function to build filters for semantic search
messageSchema.statics.buildFilters = function(sessionId, dateRange, roleFilter) {
  const filter = {};
  
  if (sessionId) filter.session = sessionId;
  if (roleFilter) filter.role = roleFilter;
  if (dateRange) {
    filter.createdAt = {
      $gte: dateRange.start,
      $lte: dateRange.end
    };
  }
  
  return filter;
};

const Message = mongoose.model('Message', messageSchema);

// Re-export the model with all static methods properly attached
export default Message;