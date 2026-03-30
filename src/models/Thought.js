import mongoose from 'mongoose';
const Schema = mongoose.Schema;

// Validator function for array length
function arrayLimit(val) {
  return val.length > 0;
}

// Define schema for thought records (reasoning storage)
const thoughtSchema = new mongoose.Schema({
  session: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  messageReference: {
    chatMessageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    chatTimestamp: { type: Date }
  },
  step: { type: String, required: true, enum: [
    'Pre-tool reasoning',
    'Post-tool analysis',
    'Final decision',
    'Error handling',
    'Plan adjustment',
    'Context evaluation'
  ]},
  hypothesis: { type: String, required: true, maxlength: 500 },
  plan: { type: [String], required: true, validate: [arrayLimit, 'Plan must have at least 1 step'] },
  uncertainties: { type: [String], default: [] },
  context: { type: String, maxlength: 5000 },
  alternativesConsidered: { type: [String], default: [] },
  userInput: { type: String, maxlength: 5000 },
  agentId: { type: String, required: true },
  metadata: {
    importance: { type: Number, min: 1, max: 10, default: 5 },
    category: { type: String, default: 'general' },
    tags: { type: [String], default: [] }
  }
}, { timestamps: true });

// Create model for thought
const Thought = mongoose.model('Thought', thoughtSchema);

export default Thought;
