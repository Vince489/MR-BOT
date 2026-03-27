import mongoose from 'mongoose';

// Define schema for advanced memory with vector embeddings
const advancedMemorySchema = new mongoose.Schema({
  ownerId: { type: String, required: true, index: true },
  text: { type: String, required: true },
  vector: { type: [Number], required: true },
  metadata: {
    category: { type: String, required: true },
    importance: { type: Number, required: true, min: 1, max: 10 },
    tokens: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    lastAccessed: { type: Date, default: Date.now },
    entities: { type: [String], default: [] },
    decayRate: { type: Number, required: true }
  },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} }
});

// Create model for advanced memory
const AdvancedMemory = mongoose.model('AdvancedMemory', advancedMemorySchema);

export default AdvancedMemory;
