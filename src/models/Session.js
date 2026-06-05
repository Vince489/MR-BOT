import mongoose from 'mongoose';
import { getModelLimit } from '../config/modelLimits.js';
const Schema = mongoose.Schema;

// 2. THE SESSION (The "Unit" - Points UP to User)
// Enhanced with vector search capabilities using 1024-dimensional embeddings
const sessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lastActivity: { type: Date, default: Date.now },
  messageCount: { type: Number, default: 0 }, // Track the number of messages in this session

  // --- SEMANTIC EXPLORATION FIELDS ---
  topic: { type: String, trim: true }, // e.g., "Fixing MongoDB Retry Logic"
  summary: { type: String },         // Paragraph summarizing the whole session
  sessionEmbedding: { type: [Number] }, // 1024 dimensions for Mistral-embed model
  category: {
    type: String,
    enum: ['technical', 'general', 'triage'],
    default: 'general'
  }, // Enhanced categorization for better search
  // -----------------------------------

  modelConfig: {
    model: { type: String, default: "mistral-medium-2505" },
    contextLimit: { type: Number, default: 131072 }
  }
}, { timestamps: true });

/**
 * ENHANCED SESSION VECTOR INDEX CONFIGURATION
 * Optimized for session-level semantic search with category filtering
 * 
 * Note: This index should be created in MongoDB Atlas UI with these exact settings:
 * - Type: Vector Search
 * - Path: sessionEmbedding
 * - Dimensions: 1024
 * - Similarity: cosine
 * - Filters: lastActivity, category
 */
sessionSchema.statics.createOptimizedSessionIndex = function() {
  console.log('💡 [SESSION SCHEMA] Session vector index configuration ready for Atlas UI');
  console.log('💡 [SESSION SCHEMA] Create index with these settings in Atlas:');
  console.log('  - Type: Vector Search');
  console.log('  - Path: sessionEmbedding');
  console.log('  - Dimensions: 1024');
  console.log('  - Similarity: cosine');
  console.log('  - Filters: lastActivity, category');
  
  return {
    indexName: 'sessionVectorIndex',
    type: 'vectorSearch',
    path: 'sessionEmbedding',
    dimensions: 1024,
    similarity: 'cosine',
    filters: ['lastActivity', 'category']
  };
};

// Create model for session
const Session = mongoose.model('Session', sessionSchema);

// Add helper method to Session schema for setting model configuration
Session.setSessionModel = async function(sessionId, modelName) {
  try {
    const session = await this.findOne({ sessionId });
    if (!session) return false;
    
    const modelLimit = getModelLimit(modelName);
    session.modelConfig = {
      model: modelName,
      contextLimit: modelLimit
    };
    await session.save();
    return true;
  } catch (error) {
    console.error('Error setting session model:', error);
    return false;
  }
};

// 1. Session Summary Generation: Create and embed session summaries
Session.generateSummary = async function(sessionId) {
  try {
    const messages = await mongoose.model('Message').find({ session: sessionId })
      .sort({ createdAt: 1 })
      .limit(50); // Get last 50 messages for context
    
    if (messages.length === 0) return false;
    
    // Generate session summary using a small model
    const summaryPrompt = `Summarize the key topics and decisions from this conversation in 2-3 sentences:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
    
    // Import embedding service - use dynamic import to avoid circular dependencies
    const { generateEmbedding } = await import('../services/embeddingService.js');
    
    // Use mistral-small for cost-effective summarization
    const summaryResponse = await fetch(`${process.env.MISTRAL_API_BASE || 'https://api.mistral.ai/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mistral-small',
        messages: [{ role: 'user', content: summaryPrompt }],
        maxTokens: 200
      })
    });
    
    const summaryData = await summaryResponse.json();
    const summary = summaryData.choices[0].message.content;
    
    // Generate embedding for the summary
    const embedding = await generateEmbedding(summary);
    
    // Update session with summary and embedding
    await this.findByIdAndUpdate(sessionId, {
      summary,
      sessionEmbedding: embedding,
      topic: this.extractTopic(summary) // Simple topic extraction
    });
    
    return true;
  } catch (error) {
    console.error(`Failed to summarize session ${sessionId}:`, error);
    return false;
  }
};

// 2. Topic Extraction: Simple topic extraction from session summary
Session.extractTopic = function(summary) {
  // Basic keyword extraction - could be enhanced with NLP
  const keywords = ['bug', 'feature', 'optimization', 'refactor', 'design', 'architecture', 'debugging', 'testing', 'deployment'];
  const summaryLower = summary.toLowerCase();
  for (const keyword of keywords) {
    if (summaryLower.includes(keyword)) return keyword;
  }
  return 'general';
};

// 3. Session Search: Perform vector search across session summaries
Session.sessionSearch = async function(params) {
  const { query, limit = 3, dateRange = null } = params;

  try {
    // Import embedding service - use dynamic import to avoid circular dependencies
    const { generateEmbedding } = await import('../services/embeddingService.js');
    
    const queryVector = await generateEmbedding(query);

    const pipeline = [
      {
          $vectorSearch: {
          index: "sessionVectorIndex",
          path: "sessionEmbedding",
          queryVector: queryVector,
          numCandidates: limit * 5,
          limit: limit,
          filter: this.buildSessionFilters(dateRange)
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

    return await this.aggregate(pipeline);
  } catch (error) {
    console.error('Error during session search:', error);
    return [];
  }
};

// 4. Helper function to build session filters
Session.buildSessionFilters = function(dateRange) {
  const filter = {};
  if (dateRange) {
    filter.lastActivity = {
      $gte: dateRange.start,
      $lte: dateRange.end
    };
  }
  return filter;
};

export default Session;
