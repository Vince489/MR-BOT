/**
 * Array storage implementation
 * Stores data in memory using a simple array - persists during runtime but lost on restart
 */
class ArrayStorage {
  constructor() {
    // Initialize empty array to store messages in memory
    this.messages = [];
    this.debug = false; // Will be set by StorageManager
  }

  setDebug(debug) {
    this.debug = debug;
  }

  /**
   * Load chat history from memory
   */
  async loadHistory() {
    if (this.debug) console.log(`📁 Array storage: loaded ${this.messages.length} messages from memory`);
    return [...this.messages]; // Return a copy to prevent external mutations
  }

  /**
   * Save chat history to memory
   */
  async saveHistory(messages) {
    try {
      // Filter out system prompts before saving to prevent duplication
      this.messages = messages.filter(msg => msg.role !== 'system');
      if (this.debug) console.log(`📁 Array storage: saved ${this.messages.length} messages to memory`);
      return true;
    } catch (error) {
      if (this.debug) console.log('⚠️  Error saving to array storage:', error.message);
      return false;
    }
  }

  /**
   * Clear chat history from memory
   */
  async clearHistory() {
    try {
      this.messages = [];
      if (this.debug) console.log('📁 Array storage: history cleared from memory');
      return true;
    } catch (error) {
      if (this.debug) console.log('⚠️  Error clearing array storage:', error.message);
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    const userMessages = this.messages.filter(msg => msg.role === 'user').length;
    const assistantMessages = this.messages.filter(msg => msg.role === 'assistant').length;
    
    return {
      totalMessages: this.messages.length,
      userMessages,
      assistantMessages,
      oldestMessage: this.messages.length > 0 ? new Date(0) : null, // Array storage doesn't store timestamps
      newestMessage: this.messages.length > 0 ? new Date(0) : null,
      fileSize: this.messages.length * 100, // Rough estimate of memory usage
      storageType: 'array'
    };
  }

  /**
   * Get storage status
   */
  getStatus() {
    return {
      type: 'Array',
      description: 'In-memory storage - data persists during runtime only',
      initialized: true,
      messageCount: this.messages.length
    };
  }

  /**
   * Get current messages array (for debugging/testing)
   */
  getMessages() {
    return [...this.messages]; // Return a copy to prevent external mutations
  }

  /**
   * Set messages array (for testing)
   */
  setMessages(messages) {
    this.messages = messages.filter(msg => msg.role !== 'system');
  }
}

export { ArrayStorage };