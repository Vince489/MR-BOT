import { JSONStorage } from './JSONStorage.js';
import { MongoDBStorage } from './MongoDBStorage.js';
import { NoMemoryStorage } from './NoMemoryStorage.js';
import { ArrayStorage } from './ArrayStorage.js';

/**
 * Storage manager that abstracts storage operations
 * Supports different storage types with set-and-forget initialization
 */
class StorageManager {
  constructor() {
    this.currentStorage = null;
    this.storageType = null;
    this.jsonStorage = new JSONStorage();
    this.mongoStorage = new MongoDBStorage();
    this.noMemoryStorage = new NoMemoryStorage();
    this.arrayStorage = new ArrayStorage();
    this.initialized = false;
  }

  /**
   * Initialize storage with the specified type (set-and-forget)
   */
   async initialize(storageType, debug = false) {
    if (this.initialized) {
      throw new Error('StorageManager already initialized. Restart application to change storage type.');
    }

    if (!storageType) {
      throw new Error('Storage type must be specified');
    }

    this.storageType = storageType.toLowerCase();

    if (this.storageType === 'mongodb' || this.storageType === 'mongo') {
      this.currentStorage = this.mongoStorage;
      this.mongoStorage.setDebug(debug);

      // Set session ID from environment if available
      if (process.env.SESSION_ID) {
        this.mongoStorage.setSessionId(process.env.SESSION_ID);
      }

      console.log('🗄️  Using MongoDB storage');

      // No need to test connection here - it will be initialized on first use
      // This avoids duplicate connection attempts and log messages
    } else if (this.storageType === 'json') {
      this.currentStorage = this.jsonStorage;
      this.jsonStorage.setDebug(debug);
      console.log('📁 Using JSON file storage');
    } else if (this.storageType === 'no-memory' || this.storageType === 'noMemory') {
      this.currentStorage = this.noMemoryStorage;
      this.noMemoryStorage.setDebug(debug);
      console.log('🚫 Using No Memory storage (no persistence)');
    } else if (this.storageType === 'array') {
      this.currentStorage = this.arrayStorage;
      this.arrayStorage.setDebug(debug);
      console.log('📁 Using Array storage (in-memory only)');
    } else {
      throw new Error(`Unknown storage type: ${storageType}. Use 'mongodb', 'json', 'no-memory', or 'array'.`);
    }

    this.initialized = true;

    // Load initial history
    const history = await this.loadHistory();
    return history;
  }

  /**
   * Load chat history for a specific session
   * @param {string} sessionId - Session ID to load history for
   */
  async loadHistory(sessionId) {
    if (!this.currentStorage) {
      throw new Error('Storage not initialized');
    }

    // Ensure session ID is set on the storage instance
    if (this.storageType === 'mongodb' || this.storageType === 'mongo') {
      this.mongoStorage.setSessionId(sessionId);
    }

    return await this.currentStorage.loadHistory(sessionId);
  }

  /**
   * Save chat history for a specific session
   * @param {string} sessionId - Session ID to save history for
   * @param {Array} messages - Messages to save
   */
  async saveHistory(sessionId, messages) {
    if (!this.currentStorage) {
      throw new Error('Storage not initialized');
    }

    // Ensure session ID is set on the storage instance
    if (this.storageType === 'mongodb' || this.storageType === 'mongo') {
      this.mongoStorage.setSessionId(sessionId);
    }

    return await this.currentStorage.saveHistory(sessionId, messages);
  }

  /**
   * Clear chat history for a specific session
   * @param {string} sessionId - Session ID to clear history for
   */
  async clearHistory(sessionId) {
    if (!this.currentStorage) {
      throw new Error('Storage not initialized');
    }

    // Ensure session ID is set on the storage instance
    if (this.storageType === 'mongodb' || this.storageType === 'mongo') {
      this.mongoStorage.setSessionId(sessionId);
    }

    return await this.currentStorage.clearHistory(sessionId);
  }

  /**
   * Get storage statistics for a specific session
   * @param {string} sessionId - Session ID to get stats for
   */
  async getStats(sessionId) {
    if (!this.currentStorage) {
      throw new Error('Storage not initialized');
    }

    // Ensure session ID is set on the storage instance
    if (this.storageType === 'mongodb' || this.storageType === 'mongo') {
      this.mongoStorage.setSessionId(sessionId);
    }

    return await this.currentStorage.getStats(sessionId);
  }

  /**
   * Get current storage status
   */
  async getStatus() {
    if (!this.currentStorage) {
      return {
        type: 'none',
        initialized: false
      };
    }
    
    const storageStatus = await this.currentStorage.getStatus();
    return {
      ...storageStatus,
      initialized: true,
      currentType: this.storageType
    };
  }


  /**
   * Export MongoDB data to JSON format
   */
  async exportToJSON() {
    if (this.storageType !== 'mongodb') {
      throw new Error('Export only available for MongoDB storage');
    }

    try {
      const stats = await this.getStats();
      const history = await this.loadHistory();
      
      const exportData = {
        exportDate: new Date().toISOString(),
        storageType: 'mongodb',
        sessionId: stats.sessionId,
        messageCount: history.length,
        messages: history
      };

      return exportData;
    } catch (error) {
      console.error('Error exporting MongoDB data:', error);
      throw error;
    }
  }
}

export { StorageManager };