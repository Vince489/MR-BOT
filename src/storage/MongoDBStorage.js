import Message from '../models/Message.js';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { mongoDBConnection } from './MongoDBConnection.js';

/**
 * MongoDB storage implementation
 */
class MongoDBStorage {
  constructor() {
    if (!process.env.SESSION_ID) {
      throw new Error('SESSION_ID environment variable must be set for MongoDB storage');
    }
    this.sessionId = process.env.SESSION_ID;
    this.debug = false; // Will be set by StorageManager
  }

  setDebug(debug) {
    this.debug = debug;
  }

  /**
   * Load chat history from MongoDB
   */
  async loadHistory() {
    try {
      // Try to connect to MongoDB
      await mongoDBConnection.connect();
      
      const history = await Message.loadHistory(this.sessionId);
      
      if (this.debug && history.length > 0) {
        console.log(`🗄️  Loaded ${history.length} messages from MongoDB history`);
      } else if (this.debug) {
        console.log('🗄️  No previous MongoDB history found. Starting fresh.');
      }
      
      return history;
    } catch (error) {
      if (this.debug) console.log('⚠️  Error loading MongoDB history:', error.message);
      if (this.debug) console.log('🗄️  Starting with empty history.');
      return [];
    }
  }

  /**
   * Save chat history to MongoDB
   */
  async saveHistory(messages) {
    try {
      // Ensure we're connected
      if (!mongoDBConnection.isReady()) {
        await mongoDBConnection.connect();
      }
      
      // Filter out system prompts but save all other messages including those with empty content
      const messagesToSave = messages.filter(msg => msg.role !== 'system');
      
      // Ensure User and Session exist before saving messages
      const success = await this.ensureUserAndSessionExists() && 
                     await Message.saveMessages(this.sessionId, messagesToSave);
      
      if (this.debug && success) {
        const filteredCount = messages.length - messagesToSave.length;
        console.log(`🗄️  Saved ${messagesToSave.length} messages to MongoDB (filtered out ${filteredCount} system prompts/empty messages)`);
      }
      
      return success;
    } catch (error) {
      if (this.debug) console.log('⚠️  Error saving to MongoDB:', error.message);
      return false;
    }
  }

  /**
   * Clear chat history from MongoDB
   */
  async clearHistory() {
    try {
      const success = await Message.clearHistory(this.sessionId);
      
      if (this.debug && success) {
        console.log('🗄️  MongoDB history cleared.');
      } else if (this.debug) {
        console.log('⚠️  Failed to clear MongoDB history.');
      }
      
      return success;
    } catch (error) {
      if (this.debug) console.log('⚠️  Error clearing MongoDB history:', error.message);
      return false;
    }
  }

  /**
   * Save ONLY new messages from the current turn (delta)
   * Prevents duplicates by not re-saving the entire history
   * @param {Array} newMessages - Only the messages from this specific turn
   */
  async saveNewMessages(newMessages) {
    try {
      if (!mongoDBConnection.isReady()) {
        await mongoDBConnection.connect();
      }

      // Filter out system prompts to keep DB clean
      const toSave = newMessages.filter(msg => msg.role !== 'system');

      if (toSave.length === 0) return true;

      // Ensure User and Session exist
      await this.ensureUserAndSessionExists();

      // Append only the new messages
      const saved = await Message.saveMessages(this.sessionId, toSave);
      
      // Pre-flight pruning: Mark old messages as popped
      await Message.pruneBeforeSend(this.sessionId);
      
      return saved;
    } catch (error) {
      if (this.debug) console.error('🗄️ MongoDB Save Error:', error.message);
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    try {
      const stats = await Message.getSessionStats(this.sessionId);
      
      return {
        totalMessages: stats.totalMessages || 0,
        userMessages: stats.userMessages || 0,
        assistantMessages: stats.assistantMessages || 0,
        oldestMessage: stats.oldestMessage,
        newestMessage: stats.newestMessage,
        sessionId: this.sessionId
      };
    } catch (error) {
      if (this.debug) console.error('Error getting MongoDB stats:', error);
      return {
        totalMessages: 0,
        userMessages: 0,
        assistantMessages: 0,
        oldestMessage: null,
        newestMessage: null,
        sessionId: this.sessionId
      };
    }
  }

  /**
   * Get storage status
   */
  getStatus() {
    return {
      type: 'MongoDB',
      sessionId: this.sessionId,
      connection: mongoDBConnection.getStatus()
    };
  }

  /**
   * Ensure User and Session documents exist before saving messages
   */
  async ensureUserAndSessionExists() {
    try {
      // Get user info from environment variables
      const userId = process.env.USER_ID || 'default';
      const userName = process.env.USER_NAME || 'Default User';
      
      // Check if user exists, create if not
      let user = await User.findOne({ userId });
      if (!user) {
        user = new User({
          userId,
          name: userName
        });
        await user.save();
        if (this.debug) console.log(`🗄️  Created new user: ${userName} (${userId})`);
      }
      
      // Check if session exists, create if not
      let session = await Session.findOne({ sessionId: this.sessionId });
      if (!session) {
        session = new Session({
          sessionId: this.sessionId,
          user: user._id
        });
        await session.save();
        if (this.debug) console.log(`🗄️  Created new session: ${this.sessionId}`);
      } else {
        // Update last activity
        session.lastActivity = new Date();
        await session.save();
      }
      
      return true;
    } catch (error) {
      if (this.debug) console.log('⚠️  Error ensuring User and Session exist:', error.message);
      return false;
    }
  }

  /**
   * Set session ID
   */
  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  /**
   * Get current session ID
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    await mongoDBConnection.disconnect();
  }
}

export { MongoDBStorage };