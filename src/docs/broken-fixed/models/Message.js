import mongoose from "mongoose";

// Define a simplified schema for messages
const messageSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    role: { type: String, required: true, enum: ['user', 'assistant', 'system', 'tool'] },
    content: { type: String, required: false },
    toolCalls: { type: Array, default: [] },
    toolCallId: { type: String, required: false }
}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

// Create a model for messages
const Message = mongoose.model("Message", messageSchema);

export default Message;
