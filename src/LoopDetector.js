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
    this.recenttool_calls = [];
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
      // Sort keys so {"a":1,"b":2} === {"b":2,"a":1"}
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
   * @param {Array} tool_calls - Array of tool calls to check
   * @returns {boolean} - True if a loop is detected
   */
  detecttool_callLoop(tool_calls) {
    // Single-call check: same signature failed loopThreshold times
    if (tool_calls.length === 1) {
      const call = tool_calls[0];
      // Handle both camelCase and snake_case
      const functionName = call.function?.name || call.functionName;
      const functionArgs = call.function?.arguments || call.functionArguments;
      const callSignature = this.getCallSignature(functionName, functionArgs);

      const recentMatches = this.recenttool_calls.filter(
        tc => tc.signature === callSignature && tc.success === false
      );
      if (recentMatches.length >= this.loopThreshold) {
        return true;
      }
    }

    // Advanced A->B->A->B pattern detection
    if (this.enablePatternDetection && this._detectComplexLoop(tool_calls)) {
      return true;
    }

    return false;
  }

  /**
   * Detects complex looping patterns like A -> B -> A -> B.
   * @param {Array} tool_calls
   * @returns {boolean}
   * @private
   */
  _detectComplexLoop(tool_calls) {
    if (tool_calls.length === 0) return false;

    const recentCalls = this.recenttool_calls.slice(0, this.maxRecentCalls * 2);
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
   * @param {Array} tool_calls - Array of tool calls
   * @param {boolean} success - Whether the calls succeeded
   */
  updateRecenttool_calls(tool_calls, success) {
    const newCalls = tool_calls.map(tc => {
      // Handle both camelCase and snake_case
      const functionName = tc.function?.name || tc.functionName;
      const functionArgs = tc.function?.arguments || tc.functionArguments;
      return {
        signature: this.getCallSignature(functionName, functionArgs),
        success: success,
        timestamp: Date.now()
      };
    });

    this.recenttool_calls.unshift(...newCalls);

    // Keep only the most recent calls
    if (this.recenttool_calls.length > this.maxRecentCalls * 2) {
      this.recenttool_calls = this.recenttool_calls.slice(0, this.maxRecentCalls * 2);
    }
  }
}