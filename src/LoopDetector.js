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
   * @returns {Object} - Object with detected (boolean) and pattern (string) if a loop is detected
   */
  detectToolCallLoop(toolCalls) {
    // Single-call check: same signature called loopThreshold times
    if (toolCalls.length === 1) {
      const call = toolCalls[0];
      const callSignature = this.getCallSignature(call.function.name, call.function.arguments);
      const recentMatches = this.recentToolCalls.filter(
        tc => tc.signature === callSignature
      );
      if (recentMatches.length >= this.loopThreshold) {
        return { detected: true, pattern: callSignature };
      }
    }

    // Advanced A->B->A->B pattern detection
    if (this.enablePatternDetection) {
      const complexLoop = this._detectComplexLoop(toolCalls);
      if (complexLoop && complexLoop.detected) {
        return { detected: true, pattern: complexLoop.pattern || toolCalls[0].function.name };
      }
    }

    return { detected: false };
  }

  /**
   * Detects complex looping patterns like A->B->A->B or A->B->C->A->B->C.
   * @param {Array} toolCalls - Array of tool calls to check
   * @returns {Object} - Object with detected (boolean) and pattern (string) if a loop is detected
   * @private
   */
  _detectComplexLoop(toolCalls) {
    if (this.recentToolCalls.length < 4) return { detected: false };

    // Try pattern lengths from 2 to 3
    for (let patternLength = 2; patternLength <= 3; patternLength++) {
      const requiredRepeats = this.loopThreshold;
      const requiredLength = patternLength * requiredRepeats;

      if (this.recentToolCalls.length >= requiredLength) {
        const pattern = this.recentToolCalls.slice(0, patternLength);
        let repeats = 1;

        for (let i = patternLength; i <= this.recentToolCalls.length - patternLength; i += patternLength) {
          const nextSegment = this.recentToolCalls.slice(i, i + patternLength);
          if (this._patternsMatch(pattern, nextSegment)) {
            repeats++;
            if (repeats >= requiredRepeats) {
              const patternString = pattern.map(tc => tc.signature.split(':')[0]).join('→');
              return { detected: true, pattern: patternString };
            }
          } else {
            break;
          }
        }
      }
    }
    return { detected: false };
  }

  /**
   * Checks if two patterns match exactly.
   * @param {Array} patternA - First pattern to compare
   * @param {Array} patternB - Second pattern to compare
   * @returns {boolean} - True if patterns match
   * @private
   */
  _patternsMatch(patternA, patternB) {
    if (patternA.length !== patternB.length) return false;
    for (let i = 0; i < patternA.length; i++) {
      if (patternA[i].signature !== patternB[i].signature) return false;
    }
    return true;
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

