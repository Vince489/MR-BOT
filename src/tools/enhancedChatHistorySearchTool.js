// enhancedChatHistorySearchTool.js
// Enhanced semantic search tool with Phase 1 optimizations
// Features: Dynamic thresholding, tiered search, two-for-one summarization, and performance metrics

import Message from '../models/Message.js';
import Session from '../models/Session.js';
import { detectSearchMode, getSearchThreshold, calculateNumCandidates, assessResultQuality, searchMetrics } from '../services/searchConfig.js';
import { generateEmbedding } from '../services/embeddingService.js';
import { tieredSearch } from '../services/tieredSearchService.js';
import { generateSessionSummary, summarizeSessionWithEmbedding } from '../services/summarizationService.js';

console.log('🚀 [ENHANCED CHAT HISTORY SEARCH TOOL] Initialized with Phase 1 optimizations');

/**
 * Enhanced semantic search with dynamic thresholding and tiered architecture
 */
async function performEnhancedSemanticSearch(params) {
  const {
    query,
    limit = 5,
    sessionId = null,
    dateRange = null,
    roleFilter = null,
    searchMode = null,
    enableCache = true,
    minConfidence = 0.9,
    estimatedDatasetSize = 10000
  } = params;

  try {
    // Detect search mode and get appropriate threshold
    const detectedMode = searchMode || detectSearchMode(query, params.context || {});
    const threshold = getSearchThreshold(detectedMode);
    
    console.log(`🎯 [ENHANCED SEARCH] Mode: ${detectedMode}, Threshold: ${threshold}`);

    // Use tiered search orchestrator
    const result = await tieredSearch.search(query, {
      limit,
      sessionId,
      dateRange,
      roleFilter,
      searchMode: detectedMode,
      enableCache,
      minConfidence,
      estimatedDatasetSize,
      context: params.context || {}
    });

    // Add search mode information to results
    return {
      ...result,
      searchMode: detectedMode,
      dynamicThreshold: threshold,
      phase: 'Phase 1 Enhanced'
    };

  } catch (error) {
    console.error('Error during enhanced semantic search:', error);
    return {
      success: false,
      message: `Enhanced semantic search failed: ${error.message}`,
      results: [],
      searchMode: searchMode || 'unknown',
      phase: 'Phase 1 Enhanced'
    };
  }
}

/**
 * Enhanced session search with category filtering
 */
async function performEnhancedSessionSearch(params) {
  const { 
    query, 
    limit = 3, 
    dateRange = null,
    category = null,
    searchMode = null
  } = params;

  try {
    // Detect search mode
    const detectedMode = searchMode || detectSearchMode(query, params.context || {});
    const threshold = getSearchThreshold(detectedMode);

    // Generate query vector
    const queryVector = await generateEmbedding(query);

    // Build enhanced pipeline with category filtering
    const pipeline = [
      {
        $vectorSearch: {
          index: "session_vector_index",
          path: "sessionEmbedding",
          queryVector: queryVector,
          numCandidates: calculateNumCandidates(limit, 10000),
          limit: limit,
          filter: buildEnhancedSessionFilters(dateRange, category)
        }
      },
      {
        $project: {
          sessionId: 1,
          topic: 1,
          summary: 1,
          category: 1,
          score: { $meta: "vectorSearchScore" },
          lastActivity: 1
        }
      }
    ];

    const results = await Session.aggregate(pipeline);
    
    // Filter by dynamic threshold
    const filteredResults = results.filter(result => result.score >= threshold);
    
    // Assess result quality
    const quality = assessResultQuality(filteredResults, threshold);

    return {
      success: true,
      results: filteredResults,
      query: query,
      totalFound: filteredResults.length,
      similarityThreshold: threshold,
      searchMode: detectedMode,
      category: category || 'all',
      quality: quality,
      phase: 'Phase 1 Enhanced'
    };

  } catch (error) {
    console.error('Error during enhanced session search:', error);
    return {
      success: false,
      message: `Enhanced session search failed: ${error.message}`,
      results: [],
      searchMode: searchMode || 'unknown',
      phase: 'Phase 1 Enhanced'
    };
  }
}

/**
 * Enhanced message context with Victor optimization
 */
async function performEnhancedGetMessageContext(params) {
  const { messageId, contextSize = 5, includePopped = false } = params;

  try {
    const message = await Message.findById(messageId);
    if (!message) {
      return {
        success: false,
        message: "Message not found"
      };
    }

    // Build filter based on includePopped parameter
    const filter = {
      session: message.session,
      createdAt: { $lt: message.createdAt }
    };
    
    if (!includePopped) {
      filter['metadata.isPopped'] = false;
    }

    const beforeMessages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(contextSize)
      .sort({ createdAt: 1 });

    const afterFilter = {
      session: message.session,
      createdAt: { $gt: message.createdAt }
    };
    
    if (!includePopped) {
      afterFilter['metadata.isPopped'] = false;
    }

    const afterMessages = await Message.find(afterFilter)
      .sort({ createdAt: 1 })
      .limit(contextSize);

    return {
      success: true,
      targetMessage: {
        id: message._id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        isPopped: message.metadata.isPopped || false
      },
      contextBefore: beforeMessages.map(msg => ({
        id: msg._id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        isPopped: msg.metadata.isPopped || false
      })),
      contextAfter: afterMessages.map(msg => ({
        id: msg._id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        isPopped: msg.metadata.isPopped || false
      })),
      sessionInfo: {
        sessionId: message.session,
        contextSize: contextSize,
        includePopped: includePopped
      },
      phase: 'Phase 1 Enhanced'
    };

  } catch (error) {
    console.error('Error getting enhanced message context:', error);
    return {
      success: false,
      message: `Failed to get enhanced message context: ${error.message}`
    };
  }
}

/**
 * Enhanced session summarization with two-for-one approach
 */
async function performEnhancedSessionSummarization(params) {
  const { sessionId, forceRegenerate = false } = params;

  try {
    // Check if session already has a summary
    const session = await Session.findById(sessionId);
    if (!session) {
      return {
        success: false,
        message: "Session not found"
      };
    }

    // Get recent messages for summarization
    const messages = await Message.find({ session: sessionId })
      .sort({ createdAt: 1 })
      .limit(50);

    if (messages.length === 0) {
      return {
        success: false,
        message: "No messages found for session"
      };
    }

    // Check if we should regenerate summary
    const shouldRegenerate = forceRegenerate || !session.summary || !session.sessionEmbedding;

    if (!shouldRegenerate) {
      return {
        success: true,
        message: "Session already has a summary and embedding",
        summary: session.summary,
        topic: session.topic,
        category: session.category,
        phase: 'Phase 1 Enhanced'
      };
    }

    // Generate enhanced summary with two-for-one approach
    const summaryData = await generateSessionSummary(messages, sessionId);
    
    if (!summaryData) {
      return {
        success: false,
        message: "Failed to generate session summary"
      };
    }

    // Generate embedding for the summary
    const embedding = await generateEmbedding(summaryData.summary);
    
    // Update session with enhanced summary and embedding
    await Session.findByIdAndUpdate(sessionId, {
      summary: summaryData.summary,
      sessionEmbedding: embedding,
      topic: summaryData.topic,
      category: summaryData.category
    });

    console.log(`✅ [ENHANCED SUMMARIZATION] Updated session ${sessionId} with enhanced summary`);

    return {
      success: true,
      summary: summaryData.summary,
      topic: summaryData.topic,
      category: summaryData.category,
      keyPoints: summaryData.keyPoints,
      messageCount: summaryData.messageCount,
      phase: 'Phase 1 Enhanced'
    };

  } catch (error) {
    console.error('Error during enhanced session summarization:', error);
    return {
      success: false,
      message: `Enhanced session summarization failed: ${error.message}`
    };
  }
}

/**
 * Get search performance metrics
 */
async function getSearchMetrics(params = {}) {
  try {
    const metrics = searchMetrics.getMetrics();
    const cacheStats = tieredSearch.getCacheStats();
    
    return {
      success: true,
      metrics: {
        searchMetrics: metrics,
        cacheStats: cacheStats,
        phase: 'Phase 1 Enhanced',
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('Error getting search metrics:', error);
    return {
      success: false,
      message: `Failed to get search metrics: ${error.message}`
    };
  }
}

/**
 * Build enhanced session filters with category support
 */
function buildEnhancedSessionFilters(dateRange, category) {
  const filter = {};
  
  if (dateRange) {
    filter.lastActivity = {
      $gte: dateRange.start,
      $lte: dateRange.end
    };
  }
  
  if (category) {
    filter.category = category;
  }
  
  return filter;
}

/**
 * Enhanced Chat History Search Tool
 * Supports all Phase 1 optimizations: dynamic thresholding, tiered search, two-for-one summarization
 */
export const enhancedChatHistorySearchTool = {
  type: "function",
  function: {
    name: 'enhancedChatHistorySearchTool',
    description: 'Advanced semantic search tool with Phase 1 optimizations: dynamic thresholding, tiered search architecture, two-for-one summarization, and performance metrics. Supports natural language queries, multi-session navigation, and Victor/Sentinel mode optimization.',
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: 'The specific search operation to perform.',
          enum: ['semanticSearch', 'sessionSearch', 'getMessageContext', 'sessionSummarization', 'getMetrics']
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
        searchMode: {
          type: "string",
          enum: ['victor-code', 'sentinel-triage', 'general-search'],
          description: 'Override automatic search mode detection.'
        },
        enableCache: {
          type: "boolean",
          default: true,
          description: 'Enable RAM cache for faster repeated searches.'
        },
        minConfidence: {
          type: "number",
          default: 0.9,
          description: 'Minimum confidence threshold for early termination in tiered search.'
        },
        estimatedDatasetSize: {
          type: "number",
          default: 10000,
          description: 'Estimated dataset size for optimal numCandidates calculation.'
        },
        category: {
          type: "string",
          enum: ['technical', 'general', 'triage'],
          description: 'Filter sessions by category for more targeted search.'
        },
        includePopped: {
          type: "boolean",
          default: false,
          description: 'Include popped messages in context retrieval (Victor subconscious search).'
        },
        forceRegenerate: {
          type: "boolean",
          default: false,
          description: 'Force regeneration of session summary even if one exists.'
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
    console.log('🚀 [ENHANCED CHAT HISTORY SEARCH TOOL] Executing with params:', params);

    const { taskProgress, ...restParams } = params;
    const { action, ...actionParams } = restParams;

    try {
      // Validate taskProgress format if provided
      if (taskProgress && !validateProgressFormat(taskProgress)) {
        console.warn('Invalid progress format provided to enhanced chat history search tool');
      }

      switch (action) {
        case 'semanticSearch':
          if (!actionParams.query) {
            return { 
              success: false, 
              message: "semanticSearch requires a 'query' parameter." 
            };
          }
          return await performEnhancedSemanticSearch(actionParams);
          
        case 'sessionSearch':
          if (!actionParams.query) {
            return { 
              success: false, 
              message: "sessionSearch requires a 'query' parameter." 
            };
          }
          return await performEnhancedSessionSearch(actionParams);
          
        case 'getMessageContext':
          if (!actionParams.messageId) {
            return { 
              success: false, 
              message: "getMessageContext requires a 'messageId' parameter." 
            };
          }
          return await performEnhancedGetMessageContext(actionParams);
          
        case 'sessionSummarization':
          if (!actionParams.sessionId) {
            return { 
              success: false, 
              message: "sessionSummarization requires a 'sessionId' parameter." 
            };
          }
          return await performEnhancedSessionSummarization(actionParams);
          
        case 'getMetrics':
          return await getSearchMetrics(actionParams);
          
        default:
          return { 
            success: false, 
            message: `Unknown action '${action}'. Please use: semanticSearch, sessionSearch, getMessageContext, sessionSummarization, or getMetrics.` 
          };
      }
    } catch (error) {
      console.error('🚀 [ENHANCED CHAT HISTORY SEARCH TOOL] Error during execution:', error);
      return { 
        success: false, 
        message: `Enhanced chat history search error: ${error.message}` 
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