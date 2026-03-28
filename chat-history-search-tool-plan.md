# Chat History Search Tool - Implementation Plan

## Overview

This document outlines the implementation plan for a comprehensive Chat History Search Tool that enables the AI to freely and easily search its chat history across multiple sessions in MongoDB using Atlas Vector Search.

## Requirements Analysis

Based on the existing documentation and architecture:

### Current State
- MongoDB schemas for `Message` and `Session` models
- Embedding service using Mistral's API (`generateEmbedding`)
- Existing search tools that need semantic enhancement
- Plans to integrate Atlas Vector Search to replace Pinecone

### Target Capabilities
1. **Semantic Search**: Natural language queries converted to vectors
2. **Multi-Session Navigation**: Jump between sessions based on relevance
3. **Hybrid Filtering**: Combine semantic search with traditional filters
4. **Session Summaries**: Quick overviews before deep diving
5. **Context-Aware Results**: Messages with full session context

## Implementation Architecture

### 1. Schema Enhancements

#### Message Schema Updates (`src/models/Message.js`)
```javascript
const messageSchema = new Schema({
  session: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
  role: { type: String, enum: ['user', 'assistant', 'system', 'tool'], required: true },
  content: { type: String, default: "" },
  
  // --- VECTOR SEARCH ENHANCEMENTS ---
  embedding: {
    type: [Number], // 1024 dimensions for Mistral-embed (CORRECTED)
    required: false,
    index: false // Atlas Vector Index defined in UI
  },
  // Victor optimization: short summary for token efficiency
  summary: { type: String },
  // -----------------------------------
  
  toolCalls: [{
    id: { type: String, required: true },
    type: { type: String, default: "function" },
    function: {
      name: { type: String, required: true },
      arguments: { type: String, required: true }
    }
  }],
  toolCallId: { type: String },
  metadata: {
    tokens: { type: Number, default: 0 },
    model: { type: String },
    isPopped: { type: Boolean, default: false }
  }
}, { timestamps: true });

// New index for hybrid search optimization
messageSchema.index({ 'metadata.isPopped': 1, role: 1 });
```

#### Session Schema Updates (`src/models/Session.js`)
```javascript
const sessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lastActivity: { type: Date, default: Date.now },
  
  // --- SEMANTIC EXPLORATION FIELDS ---
  topic: { type: String, trim: true }, // e.g., "Fixing MongoDB Retry Logic"
  summary: { type: String },         // Paragraph summarizing the whole session
  sessionEmbedding: { type: [Number] }, // Embedding of session summary
  // -----------------------------------
  
  modelConfig: {
    model: { type: String, default: "mistral-medium-2505" },
    contextLimit: { type: Number, default: 131072 }
  }
}, { timestamps: true });
```

### 2. Core Search Tool Implementation (Pure Function)

#### File: `src/tools/chatHistorySearchTool.js`

**Primary Actions:**

1. **`semanticSearch`** - Convert natural language query to vector and perform semantic search
2. **`sessionSearch`** - Search across session summaries for high-level navigation  
3. **`getMessageContext`** - Retrieve conversation context around a specific message
4. **`hybridSearch`** - Combine semantic search with traditional filters

#### Implementation Details (Pure Function Pattern)

```javascript
import { generateEmbedding } from '../services/embeddingService.js';
import Message from '../models/Message.js';
import Session from '../models/Session.js';

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

  // 1. Generate query vector
  const queryVector = await generateEmbedding(query);

  // 2. Build aggregation pipeline
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

  return await Message.aggregate(pipeline);
}

/**
 * Search across session summaries for high-level navigation
 */
async function performSessionSearch(params) {
  const { query, limit = 3, dateRange = null } = params;

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

  return await Session.aggregate(pipeline);
}

/**
 * Get conversation context around a specific message
 */
async function performGetMessageContext(params) {
  const { messageId, contextSize = 5 } = params;

  const message = await Message.findById(messageId);
  if (!message) throw new Error("Message not found");

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
    targetMessage: message,
    contextBefore: beforeMessages,
    contextAfter: afterMessages
  };
}

/**
 * Chat History Search Tool - Pure Function Implementation
 */
export const chatHistorySearchTool = {
  type: "function",
  function: {
    name: 'chatHistorySearchTool',
    description: 'Enables semantic search across chat history using MongoDB Atlas Vector Search. Supports natural language queries, multi-session navigation, and context-aware results.',
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: 'The specific search operation to perform.',
          enum: ['semanticSearch', 'sessionSearch', 'getMessageContext']
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
        }
      },
      required: ['action']
    }
  },
  handler: async (params) => {
    console.log('🔍 [CHAT HISTORY SEARCH TOOL] Executing with params:', params);

    const { action, ...actionParams } = params;

    try {
      switch (action) {
        case 'semanticSearch':
          if (!actionParams.query) {
            return { success: false, message: "semanticSearch requires a 'query' parameter." };
          }
          return await performSemanticSearch(actionParams);
          
        case 'sessionSearch':
          if (!actionParams.query) {
            return { success: false, message: "sessionSearch requires a 'query' parameter." };
          }
          return await performSessionSearch(actionParams);
          
        case 'getMessageContext':
          if (!actionParams.messageId) {
            return { success: false, message: "getMessageContext requires a 'messageId' parameter." };
          }
          return await performGetMessageContext(actionParams);
          
        default:
          return { 
            success: false, 
            message: `Unknown action '${action}'. Please use: semanticSearch, sessionSearch, or getMessageContext.` 
          };
      }
    } catch (error) {
      console.error('🔍 [CHAT HISTORY SEARCH TOOL] Error during execution:', error);
      return { 
        success: false, 
        message: `Chat history search error: ${error.message}` 
      };
    }
  }
};
```

### 3. Atlas Vector Index Configuration (CORRECTED)

#### Required Atlas Indexes

**Messages Collection Index:**
```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1024,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "session"
    },
    {
      "type": "filter",
      "path": "role"
    },
    {
      "type": "filter",
      "path": "metadata.isPopped"
    }
  ]
}
```

**Sessions Collection Index:**
```json
{
  "fields": [
    {
      "type": "vector",
      "path": "sessionEmbedding",
      "numDimensions": 1024,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "lastActivity"
    }
  ]
}
```

### 4. Enhanced Background Embedding Service

#### File: `src/services/embeddingService.js` (Enhanced)

```javascript
// Add batch embedding capability
async function batchGenerateEmbeddings(texts) {
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
function shouldEmbed(message) {
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

// Background embedding for new messages with semantic filtering
async function backgroundEmbedMessage(messageId, content, role) {
  try {
    // Apply semantic filtering
    if (!shouldEmbed({ content, role })) {
      console.log(`Skipping embedding for semantic junk: ${content.substring(0, 30)}...`);
      return;
    }
    
    const vector = await generateEmbedding(content);
    await Message.findByIdAndUpdate(messageId, { embedding: vector });
  } catch (error) {
    console.error(`Failed to embed message ${messageId}:`, error);
  }
}

/**
 * Immediate embedding for current session to solve cold start problem
 */
async function immediateEmbedCurrentSession(sessionId, content, role) {
  try {
    if (!shouldEmbed({ content, role })) return;
    
    const vector = await generateEmbedding(content);
    // Find the most recent message in this session and update it
    const latestMessage = await Message.findOne({ session: sessionId })
      .sort({ createdAt: -1 });
    
    if (latestMessage) {
      await Message.findByIdAndUpdate(latestMessage._id, { embedding: vector });
    }
  } catch (error) {
    console.error(`Failed to immediate embed for session ${sessionId}:`, error);
  }
}

/**
 * Session summary automation - triggers every 10 messages or mode changes
 */
async function summarizeSession(sessionId) {
  try {
    const messages = await Message.find({ session: sessionId })
      .sort({ createdAt: 1 })
      .limit(50); // Get last 50 messages for context
    
    if (messages.length === 0) return;
    
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
    await Session.findByIdAndUpdate(sessionId, {
      summary,
      sessionEmbedding: embedding,
      topic: extractTopic(summary) // Simple topic extraction
    });
  } catch (error) {
    console.error(`Failed to summarize session ${sessionId}:`, error);
  }
}

/**
 * Simple topic extraction from session summary
 */
function extractTopic(summary) {
  // Basic keyword extraction - could be enhanced with NLP
  const keywords = ['bug', 'feature', 'optimization', 'refactor', 'design', 'architecture'];
  const summaryLower = summary.toLowerCase();
  for (const keyword of keywords) {
    if (summaryLower.includes(keyword)) return keyword;
  }
  return 'general';
}
```

### 5. Integration with Existing Tools

#### Update `src/tools/mongodb_search_tool.js`

```javascript
// Add semantic search capability to existing tool
import ChatHistorySearchTool from './chatHistorySearchTool.js';

class MongoDBSearchTool {
  constructor() {
    this.semanticSearch = new ChatHistorySearchTool();
  }

  async performMongoDBSearch(params) {
    const { operation, ...rest } = params;

    switch (operation) {
      case 'semantic_search':
        return await this.semanticSearch.semanticSearch(rest);
      case 'session_search':
        return await this.semanticSearch.sessionSearch(rest);
      case 'get_context':
        return await this.semanticSearch.getMessageContext(rest);
      default:
        return await this.performTraditionalSearch(params);
    }
  }
}
```

## Implementation Roadmap

### Phase 1: Schema Updates (Week 1)
- [ ] Update `Message.js` schema with 1024-dimension embedding field
- [ ] Update `Session.js` schema with summary, topic, and sessionEmbedding fields
- [ ] Add `metadata.isPopped` filter index for Victor's popped messages
- [ ] Deploy schema changes to MongoDB

### Phase 2: Enhanced Background Embedding Service (Week 1-2)
- [ ] Implement semantic junk filtering (`shouldEmbed` function)
- [ ] Add immediate embedding for current session (solve cold start)
- [ ] Create session summary automation (`summarizeSession` function)
- [ ] Implement batch embedding with proper 1024-dimension handling

### Phase 3: Core Search Tool Implementation (Week 2)
- [ ] Create `chatHistorySearchTool.js` with pure function pattern
- [ ] Implement three core actions: `semanticSearch`, `sessionSearch`, `getMessageContext`
- [ ] Add similarity score threshold (0.6) to prevent irrelevant results
- [ ] Create comprehensive error handling and logging

### Phase 4: Atlas Configuration (Week 2)
- [ ] Create vector search indexes in MongoDB Atlas UI with 1024 dimensions
- [ ] Configure cosine similarity and proper filter fields
- [ ] Test index performance and adjust numCandidates as needed
- [ ] Add `metadata.isPopped` as filter field for Victor's workflow

### Phase 5: Integration & Testing (Week 3)
- [ ] Integrate with existing `mongodb_search_tool.js`
- [ ] Add tool to `ToolManager.js` registry
- [ ] Create comprehensive test suite with edge cases
- [ ] Performance testing with large datasets (100k+ messages)

### Phase 6: Migration & Optimization (Week 4)
- [ ] Backfill embeddings for existing message history using cursor-based approach
- [ ] Generate session summaries and embeddings for all existing sessions
- [ ] Optimize search performance based on usage patterns
- [ ] Add monitoring and metrics collection for search accuracy and response times

## Usage Examples

### Basic Semantic Search
```javascript
// Find messages about "error handling patterns"
const results = await chatHistorySearchTool.semanticSearch({
  query: "error handling patterns in JavaScript",
  limit: 10
});
```

### Session Navigation
```javascript
// Find sessions about "database optimization"
const sessions = await chatHistorySearchTool.sessionSearch({
  query: "database optimization techniques",
  limit: 5
});
```

### Context-Aware Search
```javascript
// Find messages about "API design" from specific sessions
const results = await chatHistorySearchTool.semanticSearch({
  query: "RESTful API design best practices",
  sessionId: "session_abc123",
  roleFilter: "assistant"
});
```

### Get Message Context
```javascript
// Get conversation context around a specific message
const context = await chatHistorySearchTool.getMessageContext({
  messageId: "msg_12345",
  contextSize: 3
});
```

## Benefits

1. **Enhanced Victor Capabilities**: Victor can now find relevant information from months ago using natural language
2. **Improved Sentinel Efficiency**: Sentinel can quickly identify duplicate issues across sessions
3. **Better User Experience**: Users can search their history conversationally
4. **Cost Optimization**: Background embedding prevents blocking the main chat loop
5. **Scalability**: Atlas Vector Search handles large datasets efficiently

## Success Metrics

- **Search Accuracy**: >85% of semantic search results are relevant to the query
- **Response Time**: <2 seconds for semantic searches on datasets up to 100k messages
- **Memory Efficiency**: Context retrieval uses <10% of available token budget
- **User Adoption**: >60% of Victor sessions use semantic search at least once

## Next Steps

1. Review and approve this implementation plan
2. Begin Phase 1 schema updates
3. Set up development environment for testing
4. Create detailed technical specifications for each component