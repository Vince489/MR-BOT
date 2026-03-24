import mongoose from 'mongoose';

const Schema = mongoose.Schema;

// 1. THE USER (Top Level)
const userSchema = new Schema({
  userId: { type: String, required: true, unique: true, index: true },
  name: { type: String, trim: true }
}, { timestamps: true });

// Create model for user
const User = mongoose.model('User', userSchema);

export default User;