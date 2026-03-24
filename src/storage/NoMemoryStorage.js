/**
 * No Memory storage implementation
 * This storage type doesn't persist any data - useful for testing, privacy, or temporary sessions
 */
class NoMemoryStorage {
  constructor() {
    // No initialization needed - this storage doesn't persist anything
    this.debug = false; // Will be set by StorageManager
  }

  setDebug(debug) {
    this.debug = debug;
  }

  /**
   * Load chat history - always returns empty array
   */
  async loadHistory() {
    if (this.debug) console.log('🚫 No Memory storage: returning empty history (no persistence)');
    return [];
  }

  /**
   * Save chat history - does nothing but returns success
   */
  async saveHistory(messages) {
    if (this.debug) console.log('🚫 No Memory storage: save operation ignored (no persistence)');
    return true;
  }

  /**
   * Clear chat history - does nothing but returns success
   */
  async clearHistory() {
    if (this.debug) console.log('🚫 No Memory storage: clear operation ignored (no persistence)');
    return true;
  }

  /**
   * Get storage statistics - always returns zero values
   */
  async getStats() {
    return {
      totalMessages: 0,
      userMessages: 0,
      assistantMessages: 0,
      oldestMessage: null,
      newestMessage: null,
      fileSize: 0,
      storageType: 'no-memory'
    };
  }

  /**
   * Get storage status
   */
  getStatus() {
    return {
      type: 'No Memory',
      description: 'No data persistence - all data is discarded',
      initialized: true
    };
  }
}

export { NoMemoryStorage };