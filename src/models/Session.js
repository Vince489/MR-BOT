import mongoose from 'mongoose';
import { getModelLimit } from '../config/modelLimits.js';
const Schema = mongoose.Schema;

// 2. THE SESSION (The "Unit" - Points UP to User)
const sessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lastActivity: { type: Date, default: Date.now },
  modelConfig: {
    model: { type: String, default: "mistral-medium-2505" },
    contextLimit: { type: Number, default: 131072 }
  }
}, { timestamps: true });

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

export default Session;
