/**
 * Loop Detection for Agent tool call sequences.
 * Detects simple repeated loops and complex A->B->A->B patterns.
 */
export class LoopDetector {
  /**
   * @param {Object} config
   * @param {number} [config.maxRecentCalls=3]    - How many recent calls to track
   * @param {number} [config.loopThreshold=2]     - Failed attempts before detecting a loop
   * @param {boolean} [config.enablePatternDetection=true] - Enable A->B->A->B detection
   */
  constructor(config = {}) {
    this.recentToolCalls = [];
    this.maxRecentCalls = config.maxRecentCalls || 3;
    this.loopThreshold = config.loopThreshold || 2;
    this.enablePatternDetection = config.enablePatternDetection !== false;
  }

  /**
   * Creates a deterministic signature for a tool call to handle JSON key ordering variations.
   * @param {string} name - Tool name
   * @param {string|Object} args - Tool arguments (JSON string or object)
   * @returns {string} - Normalized signature
   */
  getCallSignature(name, args) {
    try {
      const parsed = typeof args === 'string' ? JSON.parse(args) : args;
      // Sort keys so {"a":1,"b":2} === {"b":2,"a":1}
      const normalized = Object.keys(parsed).sort().reduce((obj, key) => {
        obj[key] = parsed[key];
        return obj;
      }, {});
      return `${name}:${JSON.stringify(normalized)}`;
    } catch (e) {
      return `${name}:${args}`; // Fallback to raw string
    }
  }

  /**
   * Detects if the same tool with the same arguments is being called repeatedly.
   * @param {Array} toolCalls - Array of tool calls to check
   * @returns {boolean} - True if a loop is detected
   */
  detectToolCallLoop(toolCalls) {
    // Single-call check: same signature failed loopThreshold times
    if (toolCalls.length === 1) {
      const call = toolCalls[0];
      const callSignature = this.getCallSignature(call.function.name, call.function.arguments);
      const recentMatches = this.recentToolCalls.filter(
        tc => tc.signature === callSignature && tc.success === false
      );
      if (recentMatches.length >= this.loopThreshold) {
        return true;
      }
    }

    // Advanced A->B->A->B pattern detection
    if (this.enablePatternDetection && this._detectComplexLoop(toolCalls)) {
      return true;
    }

    return false;
  }

  /**
   * Detects complex looping patterns like A -> B -> A -> B.
   * @param {Array} toolCalls
   * @returns {boolean}
   * @private
   */
  _detectComplexLoop(toolCalls) {
    if (toolCalls.length === 0) return false;

    const recentCalls = this.recentToolCalls.slice(0, this.maxRecentCalls * 2);
    if (recentCalls.length >= 4) {
      const pattern = recentCalls.slice(0, 2);
      const nextPattern = recentCalls.slice(2, 4);
      if (
        pattern[0].signature === nextPattern[0].signature &&
        pattern[1].signature === nextPattern[1].signature
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Updates the record of recent tool calls with proper state management.
   * @param {Array} toolCalls - Array of tool calls
   * @param {boolean} success - Whether the calls succeeded
   */
  updateRecentToolCalls(toolCalls, success) {
    const newCalls = toolCalls.map(tc => ({
      signature: this.getCallSignature(tc.function.name, tc.function.arguments),
      success: success,
      timestamp: Date.now()
    }));

    this.recentToolCalls.unshift(...newCalls);

    // Keep only the most recent calls
    if (this.recentToolCalls.length > this.maxRecentCalls * 2) {
      this.recentToolCalls = this.recentToolCalls.slice(0, this.maxRecentCalls * 2);
    }
  }
}

