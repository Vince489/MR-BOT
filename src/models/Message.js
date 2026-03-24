import mongoose from 'mongoose';
import { countMessageTokens } from '../Tokenizer.js';
const Schema = mongoose.Schema;

/**
 * THE MESSAGE SCHEMA
 * Designed for Mistral/OpenAI compatibility.
 * Links to a 'Session' document to group conversations.
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
  // The text content (can be empty for tool_calls messages)
  content: { 
    type: String, 
    default: "" 
  }, 
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
 * OPTIMIZED INDEX FOR ACTIVE CONTEXT QUERIES
 * Used by syncContextWindow and loadHistory to efficiently filter by isPopped
 */
messageSchema.index({ session: 1, 'metadata.isPopped': 1, createdAt: -1 });


/**
 * STATIC METHODS
 */

// 1. Load History: Fetches and formats messages for the LLM API
messageSchema.statics.loadHistory = async function(sessionId) {
  try {
    const session = await mongoose.model('Session').findOne({ sessionId });
    if (!session) return [];
    
    // Filter by isPopped: false for active context only
    // NO LIMIT - let the pruning logic handle context management
    const messages = await this.find({ 
      session: session._id, 
      'metadata.isPopped': false 
    }).sort({ createdAt: -1 });
    
    return messages.reverse().map(msg => {
      const result = {
        role: msg.role,
        content: msg.content || ""
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
    console.error('Error loading message history:', error);
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

const Message = mongoose.model('Message', messageSchema);

export default Message;