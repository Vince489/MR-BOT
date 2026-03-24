import fs from 'node:fs';
import path from 'node:path';

/**
 * JSON file storage implementation
 */
class JSONStorage {
  constructor(historyFile = null) {
    // Use environment variable if available, otherwise use provided parameter
    // Fail fast if neither is provided
    const fileName = historyFile || process.env.JSON_STORAGE_FILE;
    if (!fileName) {
      throw new Error('JSON_STORAGE_FILE environment variable must be set or historyFile parameter must be provided');
    }
    this.historyFile = path.join(process.cwd(), fileName);
    this.debug = false; // Will be set by StorageManager
  }

  setDebug(debug) {
    this.debug = debug;
  }

  /**
   * Load chat history from JSON file
   */
  async loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf8');
        const loadedHistory = JSON.parse(data);
        
        // Validate the loaded history format
        if (Array.isArray(loadedHistory) && 
            loadedHistory.every(msg => 
              msg && typeof msg === 'object' && 
              ['user', 'assistant'].includes(msg.role) && 
              typeof msg.content === 'string')) {
          
          if (this.debug) console.log(`📁 Loaded ${loadedHistory.length} messages from JSON history`);
          return loadedHistory;
        } else {
          if (this.debug) console.log('⚠️  JSON history file format is invalid. Starting with empty history.');
          return [];
        }
      } else {
        if (this.debug) console.log('📁 No previous JSON history found. Starting fresh.');
        return [];
      }
    } catch (error) {
      if (this.debug) console.log('⚠️  Error loading JSON history:', error.message);
      if (this.debug) console.log('📁 Starting with empty history.');
      return [];
    }
  }

  /**
   * Save chat history to JSON file (excluding system prompts)
   */
  async saveHistory(messages) {
    try {
      // Filter out system prompts before saving to prevent duplication
      const historyToSave = messages.filter(msg => msg.role !== 'system');
      fs.writeFileSync(this.historyFile, JSON.stringify(historyToSave, null, 2));
      return true;
    } catch (error) {
      if (this.debug) console.log('⚠️  Warning: Could not save JSON history:', error.message);
      return false;
    }
  }

  /**
   * Clear chat history
   */
  async clearHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        fs.unlinkSync(this.historyFile);
        if (this.debug) console.log('📁 JSON history cleared.');
      }
      return true;
    } catch (error) {
      if (this.debug) console.log('⚠️  Error clearing JSON history:', error.message);
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    try {
      if (!fs.existsSync(this.historyFile)) {
        return {
          totalMessages: 0,
          userMessages: 0,
          assistantMessages: 0,
          oldestMessage: null,
          newestMessage: null,
          fileSize: 0
        };
      }

      const data = fs.readFileSync(this.historyFile, 'utf8');
      const messages = JSON.parse(data);
      
      const userMessages = messages.filter(msg => msg.role === 'user').length;
      const assistantMessages = messages.filter(msg => msg.role === 'assistant').length;
      
      // Calculate file size
      const stats = fs.statSync(this.historyFile);
      
      return {
        totalMessages: messages.length,
        userMessages,
        assistantMessages,
        oldestMessage: messages.length > 0 ? new Date(0) : null, // JSON doesn't store timestamps
        newestMessage: messages.length > 0 ? new Date(0) : null,
        fileSize: stats.size
      };
    } catch (error) {
      console.error('Error getting JSON stats:', error);
      return {
        totalMessages: 0,
        userMessages: 0,
        assistantMessages: 0,
        oldestMessage: null,
        newestMessage: null,
        fileSize: 0
      };
    }
  }

  /**
   * Get storage status
   */
  async getStatus() {
    const stats = await this.getStats();
    return {
      type: 'JSON',
      file: this.historyFile,
      exists: fs.existsSync(this.historyFile),
      messageCount: stats.totalMessages
    };
  }
}

export { JSONStorage };