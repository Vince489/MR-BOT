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
   * Load chat history from MongoDB for a specific session
   * @param {string} sessionId - Session ID to load history for
   */
  async loadHistory(sessionId) {
    try {
      // Try to connect to MongoDB
      await mongoDBConnection.connect();
      
      const history = await Message.loadHistory(sessionId);
      
      if (this.debug && history.length > 0) {
        console.log(`🗄️  Loaded ${history.length} messages from MongoDB history for session ${sessionId}`);
      } else if (this.debug) {
        console.log(`🗄️  No previous MongoDB history found for session ${sessionId}. Starting fresh.`);
      }
      
      return history;
    } catch (error) {
      if (this.debug) console.log('⚠️  Error loading MongoDB history:', error.message);
      if (this.debug) console.log('🗄️  Starting with empty history.');
      return [];
    }
  }

  /**
   * Save chat history to MongoDB for a specific session
   * @param {string} sessionId - Session ID to save history for
   * @param {Array} messages - Messages to save
   */
  async saveHistory(sessionId, messages) {
    try {
      // Ensure we're connected
      if (!mongoDBConnection.isReady()) {
        await mongoDBConnection.connect();
      }
      
      // Filter out system prompts but save all other messages including those with empty content
      const messagesToSave = messages.filter(msg => msg.role !== 'system');
      
      // Ensure User and Session exist before saving messages
      const success = await this.ensureUserAndSessionExists(sessionId) && 
                     await Message.saveMessages(sessionId, messagesToSave);
      
      if (this.debug && success) {
        const filteredCount = messages.length - messagesToSave.length;
        console.log(`🗄️  Saved ${messagesToSave.length} messages to MongoDB for session ${sessionId} (filtered out ${filteredCount} system prompts/empty messages)`);
      }
      
      return success;
    } catch (error) {
      if (this.debug) console.log('⚠️  Error saving to MongoDB:', error.message);
      return false;
    }
  }

  /**
   * Clear chat history from MongoDB for a specific session
   * @param {string} sessionId - Session ID to clear history for
   */
  async clearHistory(sessionId) {
    try {
      const success = await Message.clearHistory(sessionId);
      
      if (this.debug && success) {
        console.log(`🗄️  MongoDB history cleared for session ${sessionId}.`);
      } else if (this.debug) {
        console.log(`⚠️  Failed to clear MongoDB history for session ${sessionId}.`);
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
   * Get storage statistics for a specific session
   * @param {string} sessionId - Session ID to get stats for
   */
  async getStats(sessionId) {
    try {
      const stats = await Message.getSessionStats(sessionId);
      
      return {
        totalMessages: stats.totalMessages || 0,
        userMessages: stats.userMessages || 0,
        assistantMessages: stats.assistantMessages || 0,
        oldestMessage: stats.oldestMessage,
        newestMessage: stats.newestMessage,
        sessionId: sessionId
      };
    } catch (error) {
      if (this.debug) console.error('Error getting MongoDB stats:', error);
      return {
        totalMessages: 0,
        userMessages: 0,
        assistantMessages: 0,
        oldestMessage: null,
        newestMessage: null,
        sessionId: sessionId
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
   * @param {string} sessionId - Session ID to ensure exists
   */
  async ensureUserAndSessionExists(sessionId) {
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
      let session = await Session.findOne({ sessionId: sessionId });
      if (!session) {
        session = new Session({
          sessionId: sessionId,
          user: user._id
        });
        await session.save();
        if (this.debug) console.log(`🗄️  Created new session: ${sessionId}`);
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