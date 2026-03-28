// chatHistorySearchTool.js
// Comprehensive semantic search tool for MongoDB Atlas Vector Search
// Uses Mistral embeddings and stores vectors directly in MongoDB Atlas

import Message from '../models/Message.js';
import Session from '../models/Session.js';
import { generateEmbedding } from '../services/embeddingService.js';

console.log('🔍 [CHAT HISTORY SEARCH TOOL] Initialized with Mistral embeddings and MongoDB Atlas Vector Search');

/**
 * Helper function to build filters for semantic search
 */
function buildFilters(sessionId, dateRange, roleFilter) {
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
}

/**
 * Helper function to build session filters
 */
function buildSessionFilters(dateRange) {
  const filter = {};
  if (dateRange) {
    filter.lastActivity = {
      $gte: dateRange.start,
      $lte: dateRange.end
    };
  }
  return filter;
}

/**
 * Ensure message has embedding before search
 * If no embedding exists, generate and store it
 */
async function ensureMessageEmbedding(messageId, content, role) {
  try {
    const message = await Message.findById(messageId);
    if (!message) return false;

    // Check if message already has embedding
    if (message.embedding && message.embedding.length > 0) {
      return true;
    }

    // Generate embedding using Mistral
    const vector = await generateEmbedding(content);
    
    // Store embedding in MongoDB Atlas
    await Message.findByIdAndUpdate(messageId, { embedding: vector });
    
    console.log(`✅ [CHAT HISTORY SEARCH TOOL] Generated and stored embedding for message ${messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ [CHAT HISTORY SEARCH TOOL] Failed to ensure embedding for message ${messageId}:`, error);
    return false;
  }
}

/**
 * Generate and store embedding for session summary
 */
async function ensureSessionEmbedding(sessionId, summary) {
  try {
    const session = await Session.findById(sessionId);
    if (!session) return false;

    // Check if session already has embedding
    if (session.sessionEmbedding && session.sessionEmbedding.length > 0) {
      return true;
    }

    // Generate embedding using Mistral
    const vector = await generateEmbedding(summary);
    
    // Store embedding in MongoDB Atlas
    await Session.findByIdAndUpdate(sessionId, { sessionEmbedding: vector });
    
    console.log(`✅ [CHAT HISTORY SEARCH TOOL] Generated and stored session embedding for ${sessionId}`);
    return true;
  } catch (error) {
    console.error(`❌ [CHAT HISTORY SEARCH TOOL] Failed to ensure session embedding for ${sessionId}:`, error);
    return false;
  }
}

/**
 * Perform semantic search across message history
 */
async function performSemanticSearch(params) {
  const {
    query,
    limit = 5,
    sessionId = null,
    dateRange = null,
    roleFilter = null
  } = params;

  try {
    // Generate query vector using Mistral
    const queryVector = await generateEmbedding(query);

    // Build aggregation pipeline for MongoDB Atlas Vector Search
    const pipeline = [
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryVector,
          numCandidates: limit * 10,
          limit: limit,
          filter: buildFilters(sessionId, dateRange, roleFilter)
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

    const results = await Message.aggregate(pipeline);
    
    // Filter out low-quality matches (score < 0.6)
    const filteredResults = results.filter(result => result.score >= 0.6);
    
    return {
      success: true,
      results: filteredResults,
      query: query,
      totalFound: filteredResults.length,
      similarityThreshold: 0.6,
      database: "MongoDB Atlas Vector Search",
      embeddingModel: "Mistral-embed"
    };
  } catch (error) {
    console.error('❌ [CHAT HISTORY SEARCH TOOL] Error during semantic search:', error);
    return {
      success: false,
      message: `Semantic search failed: ${error.message}`,
      results: [],
      database: "MongoDB Atlas Vector Search"
    };
  }
}

/**
 * Search across session summaries for high-level navigation
 */
async function performSessionSearch(params) {
  const { query, limit = 3, dateRange = null } = params;

  try {
    // Generate query vector using Mistral
    const queryVector = await generateEmbedding(query);

    const pipeline = [
      {
        $vectorSearch: {
          index: "session_vector_index",
          path: "sessionEmbedding",
          queryVector: queryVector,
          numCandidates: limit * 5,
          limit: limit,
          filter: buildSessionFilters(dateRange)
        }
      },
      {
        $project: {
          sessionId: 1,
          topic: 1,
          summary: 1,
          score: { $meta: "vectorSearchScore" },
          lastActivity: 1
        }
      }
    ];

    const results = await Session.aggregate(pipeline);
    
    // Filter out low-quality matches (score < 0.6)
    const filteredResults = results.filter(result => result.score >= 0.6);
    
    return {
      success: true,
      results: filteredResults,
      query: query,
      totalFound: filteredResults.length,
      similarityThreshold: 0.6,
      database: "MongoDB Atlas Vector Search",
      embeddingModel: "Mistral-embed"
    };
  } catch (error) {
    console.error('❌ [CHAT HISTORY SEARCH TOOL] Error during session search:', error);
    return {
      success: false,
      message: `Session search failed: ${error.message}`,
      results: [],
      database: "MongoDB Atlas Vector Search"
    };
  }
}

/**
 * Get conversation context around a specific message
 */
async function performGetMessageContext(params) {
  const { messageId, contextSize = 5 } = params;

  try {
    const message = await Message.findById(messageId);
    if (!message) {
      return {
        success: false,
        message: "Message not found"
      };
    }

    // Ensure the target message has an embedding
    await ensureMessageEmbedding(messageId, message.content, message.role);

    const beforeMessages = await Message.find({
      session: message.session,
      createdAt: { $lt: message.createdAt }
    })
    .sort({ createdAt: -1 })
    .limit(contextSize)
    .sort({ createdAt: 1 });

    const afterMessages = await Message.find({
      session: message.session,
      createdAt: { $gt: message.createdAt }
    })
    .sort({ createdAt: 1 })
    .limit(contextSize);

    return {
      success: true,
      targetMessage: {
        id: message._id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        hasEmbedding: !!(message.embedding && message.embedding.length > 0)
      },
      contextBefore: beforeMessages.map(msg => ({
        id: msg._id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        hasEmbedding: !!(msg.embedding && msg.embedding.length > 0)
      })),
      contextAfter: afterMessages.map(msg => ({
        id: msg._id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        hasEmbedding: !!(msg.embedding && msg.embedding.length > 0)
      })),
      sessionInfo: {
        sessionId: message.session,
        contextSize: contextSize
      }
    };
  } catch (error) {
    console.error('❌ [CHAT HISTORY SEARCH TOOL] Error getting message context:', error);
    return {
      success: false,
      message: `Failed to get message context: ${error.message}`
    };
  }
}

/**
 * Generate embeddings for all messages in a session (bulk operation)
 */
async function generateSessionEmbeddings(params) {
  const { sessionId } = params;

  try {
    const messages = await Message.find({ session: sessionId })
      .select('_id content role embedding');

    let processed = 0;
    let skipped = 0;

    for (const message of messages) {
      // Skip if already has embedding
      if (message.embedding && message.embedding.length > 0) {
        skipped++;
        continue;
      }

      // Skip semantic junk
      if (!Message.shouldEmbed({ content: message.content, role: message.role })) {
        skipped++;
        continue;
      }

      // Generate and store embedding
      const vector = await generateEmbedding(message.content);
      await Message.findByIdAndUpdate(message._id, { embedding: vector });
      processed++;
    }

    return {
      success: true,
      message: `Processed ${processed} messages, skipped ${skipped} messages`,
      processedCount: processed,
      skippedCount: skipped,
      sessionId: sessionId
    };
  } catch (error) {
    console.error('❌ [CHAT HISTORY SEARCH TOOL] Error generating session embeddings:', error);
    return {
      success: false,
      message: `Failed to generate session embeddings: ${error.message}`
    };
  }
}

/**
 * Chat History Search Tool - Pure Function Implementation
 * Uses Mistral embeddings and MongoDB Atlas Vector Search
 */
export const chatHistorySearchTool = {
  type: "function",
  function: {
    name: 'chatHistorySearchTool',
    description: 'Enables semantic search across chat history using Mistral embeddings and MongoDB Atlas Vector Search. Supports natural language queries, multi-session navigation, and context-aware results. Automatically generates and stores embeddings in MongoDB Atlas.',
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: 'The specific search operation to perform.',
          enum: ['semanticSearch', 'sessionSearch', 'getMessageContext', 'generateSessionEmbeddings']
        },
        query: {
          type: "string",
          description: 'Natural language query for semantic search operations.'
        },
        limit: {
          type: "number",
          description: 'Maximum number of results to return (default: 5 for semantic, 3 for session).'
        },
        sessionId: {
          type: "string",
          description: 'Optional session ID to filter results to a specific session.'
        },
        dateRange: {
          type: "object",
          properties: {
            start: { type: "string", description: 'Start date in ISO format' },
            end: { type: "string", description: 'End date in ISO format' }
          },
          description: 'Optional date range filter for results.'
        },
        roleFilter: {
          type: "string",
          enum: ['user', 'assistant', 'system', 'tool'],
          description: 'Optional role filter for messages.'
        },
        messageId: {
          type: "string",
          description: 'Message ID for context retrieval.'
        },
        contextSize: {
          type: "number",
          description: 'Number of messages to retrieve before and after target message (default: 5).'
        },
        taskProgress: {
          type: "string",
          description: 'Markdown-formatted checklist to track task progress. Each line should be a checklist item (e.g., "- [ ] Step 1"). This parameter is optional and can be included in any tool call. Updates should include the complete current progress state.'
        }
      },
      required: ['action']
    }
  },
  handler: async (params) => {
    console.log('🔍 [CHAT HISTORY SEARCH TOOL] Executing with params:', params);

    const { taskProgress, ...restParams } = params;
    const { action, ...actionParams } = restParams;

    try {
      // Validate taskProgress format if provided
      if (taskProgress && !validateProgressFormat(taskProgress)) {
        console.warn('Invalid progress format provided to chatHistorySearchTool');
      }

      switch (action) {
        case 'semanticSearch':
          if (!actionParams.query) {
            return { 
              success: false, 
              message: "semanticSearch requires a 'query' parameter." 
            };
          }
          return await performSemanticSearch(actionParams);
          
        case 'sessionSearch':
          if (!actionParams.query) {
            return { 
              success: false, 
              message: "sessionSearch requires a 'query' parameter." 
            };
          }
          return await performSessionSearch(actionParams);
          
        case 'getMessageContext':
          if (!actionParams.messageId) {
            return { 
              success: false, 
              message: "getMessageContext requires a 'messageId' parameter." 
            };
          }
          return await performGetMessageContext(actionParams);
          
        case 'generateSessionEmbeddings':
          if (!actionParams.sessionId) {
            return { 
              success: false, 
              message: "generateSessionEmbeddings requires a 'sessionId' parameter." 
            };
          }
          return await generateSessionEmbeddings(actionParams);
          
        default:
          return { 
            success: false, 
            message: `Unknown action '${action}'. Please use: semanticSearch, sessionSearch, getMessageContext, or generateSessionEmbeddings.` 
          };
      }
    } catch (error) {
      console.error('❌ [CHAT HISTORY SEARCH TOOL] Error during execution:', error);
      return { 
        success: false, 
        message: `Chat history search error: ${error.message}` 
      };
    }
  }
};

/**
 * Validate progress format with enhanced checking
 * @param {string} progress - Progress string to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function validateProgressFormat(progress) {
  if (!progress || typeof progress !== 'string') {
    return false;
  }

  // Enhanced validation that handles multi-line progress updates
  // Each line should be a valid checklist item
  const lines = progress.split('\n');
  const checklistPattern = /^\s*-\s*\[\s*(x| )\s*\]\s*.+$/;

  return lines.every(line => {
    // Skip empty lines
    if (line.trim() === '') return true;
    return checklistPattern.test(line);
  });
}