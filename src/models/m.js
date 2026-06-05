import mongoose from 'mongoose';
const Schema = mongoose.Schema;

/**
 * PRODUCTION MESSAGE SCHEMA
 * Using conversationId as the primary anchor for the Belief State.
 */
const messageSchema = new Schema({
  // The unique thread identifier we've been discussing
  conversationId: { 
    type: String, 
    required: true, 
    index: true 
  },
  role: { 
    type: String, 
    enum: ['user', 'assistant', 'system', 'tool'], 
    required: true 
  },
  content: { 
    type: String, 
    default: "" 
  }, 
  // Weight for the 60% context calculation
  tokens: { 
    type: Number, 
    default: 0 
  },
  // Memory management flag
  isPopped: { 
    type: Boolean, 
    default: false,
    index: true
  },
  // Mistral Tooling Support
  toolCalls: [{
    id: String,
    type: { type: String, default: "function" },
    function: {
      name: String,
      arguments: String // JSON string
    }
  }],
  toolCallId: { type: String } // Links 'tool' response to 'assistant' call
}, { 
  timestamps: true 
});

/**
 * HOT-PATH INDEX
 * Optimized for retrieving the active 60% context window.
 */
messageSchema.index({ conversationId: 1, isPopped: 1, createdAt: -1 });

/**
 * BELIEF STATE RECOVERY
 * Pulls unpopped messages for the current conversation.
 */
messageSchema.statics.loadHistory = async function(conversationId) {
  return await this.find({ 
    conversationId, 
    isPopped: false 
  })
  .sort({ createdAt: 1 })
  .lean(); 
};

/**
 * ATOMIC PRUNING (The 60% Rule)
 * Marks messages as isPopped while preserving Tool Chain integrity.
 */
messageSchema.statics.syncContextWindow = async function(conversationId, modelLimit) {
  const target = modelLimit * 0.60;
  
  const messages = await this.find({ conversationId, isPopped: false })
    .sort({ createdAt: -1 });

  let total = 0;
  let keepIds = [];
  let lastSafeUserIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    total += messages[i].tokens;

    if (total <= target) {
      // We only want to "start" a conversation on a User message
      if (messages[i].role === 'user') {
        lastSafeUserIndex = i;
      }
      keepIds.push(messages[i]._id);
    } else {
      break;
    }
  }

  // Ensure we don't start the AI's memory in the middle of an Assistant/Tool exchange
  if (lastSafeUserIndex !== -1 && lastSafeUserIndex < keepIds.length - 1) {
    keepIds = keepIds.slice(0, lastSafeUserIndex + 1);
  }

  await this.updateMany(
    { conversationId, _id: { $nin: keepIds }, isPopped: false },
    { $set: { isPopped: true } }
  );
  
  return true;
};

const Message = mongoose.model('Message', messageSchema);
export default Message;