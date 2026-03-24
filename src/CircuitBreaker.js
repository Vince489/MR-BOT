import { EventEmitter } from "events";

/**
 * Circuit Breaker Pattern for Agent.js Loop Detection
 * 
 * Transforms loop detection from a simple "stop-gap" into a resilient system-level safety mechanism.
 * Provides three distinct states: CLOSED (Healthy), OPEN (Tripped), and HALF-OPEN (Testing).
 */
export class CircuitBreaker extends EventEmitter {
  /**
   * Creates a new CircuitBreaker instance
   * @param {Object} config - Configuration object
   * @param {number} [config.maxRecentCalls=3] - How many recent calls to track
   * @param {number} [config.loopThreshold=2] - How many failed attempts before detecting a loop
   * @param {boolean} [config.enablePatternDetection=true] - Enable advanced A->B->A->B pattern detection
   * @param {number} [config.cooldownPeriod=30000] - Cooldown period in milliseconds (30 seconds)
   * @param {number} [config.globalTripThreshold=5] - Global circuit trips after this many failures
   * @param {number} [config.heatDecayRate=0.1] - How quickly heat dissipates per second
   * @param {number} [config.maxHeat=10] - Maximum heat before tripping the circuit
   * @param {number} [config.halfOpenAttempts=1] - Number of test attempts in HALF-OPEN state
   * @param {boolean} [config.enabled=true] - Whether the circuit breaker is enabled
   */
  constructor(config = {}) {
    super();

    this.config = {
      maxRecentCalls: 3,
      loopThreshold: 2,
      enablePatternDetection: true,
      cooldownPeriod: 30000,        // 30 seconds default
      globalTripThreshold: 5,       // Global circuit trips after 5 failures
      heatDecayRate: 0.1,           // Heat decays 0.1 per second
      maxHeat: 10,                  // Maximum heat before tripping
      halfOpenAttempts: 1,          // Number of test attempts in HALF-OPEN
      enabled: true,                // Circuit breaker enabled by default
      ...config
    };

    // Per-tool state tracking
    this.states = new Map(); // toolSignature -> CircuitState
    
    // Global circuit state (affects all tools)
    this.globalState = {
      state: 'CLOSED',
      failures: 0,
      lastFailure: 0,
      cooldownEnds: 0
    };

    // Track overall statistics
    this.stats = {
      totalTrips: 0,
      totalRecoveries: 0,
      totalFailures: 0,
      totalSuccesses: 0
    };

    // Start background cleanup task
    this._startCleanupTask();
  }

  /**
   * Determines if a tool call should be allowed based on circuit breaker state
   * @param {string} toolSignature - Unique signature for the tool call
   * @returns {Object} - Decision object with allow/deny status and reason
   */
  shouldAllowCall(toolSignature) {
    // If circuit breaker is disabled, always allow
    if (!this.config.enabled) {
      return { allow: true, reason: 'Circuit breaker disabled' };
    }

    // Check global circuit state first
    const globalState = this._checkGlobalState();
    if (globalState.state === 'OPEN') {
      return { 
        allow: false, 
        reason: 'Global circuit breaker is OPEN',
        cooldownRemaining: Math.max(0, globalState.cooldownEnds - Date.now())
      };
    }

    // Check per-tool circuit state
    const state = this._getState(toolSignature);
    const now = Date.now();

    // Handle state transitions
    this._updateState(state, toolSignature, now);

    switch (state.state) {
      case 'CLOSED':
        return { allow: true, reason: 'Circuit is CLOSED' };

      case 'OPEN':
        if (now >= state.cooldownEnds) {
          // Auto-transition to HALF-OPEN after cooldown
          this._setState(toolSignature, 'HALF-OPEN', now);
          this.emit('circuit-half-open', {
            tool: toolSignature,
            reason: 'Auto-transition to HALF-OPEN after cooldown',
            attemptNumber: 1
          });
          return { allow: true, reason: 'Transitioned to HALF-OPEN for testing' };
        }
        return { 
          allow: false, 
          reason: 'Circuit is OPEN (tripped)',
          cooldownRemaining: state.cooldownEnds - now
        };

      case 'HALF-OPEN':
        if (state.halfOpenAttempts >= this.config.halfOpenAttempts) {
          // Too many attempts in HALF-OPEN, trip again
          this._tripCircuit(toolSignature, 'Too many attempts in HALF-OPEN', now);
          return { 
            allow: false, 
            reason: 'HALF-OPEN attempts exceeded, circuit tripped again',
            cooldownRemaining: state.cooldownEnds - now
          };
        }
        return { allow: true, reason: 'Circuit is HALF-OPEN (testing)' };

      default:
        return { allow: true, reason: 'Unknown state, allowing call' };
    }
  }

  /**
   * Records a successful tool call and updates circuit breaker state
   * @param {string} toolSignature - Unique signature for the tool call
   */
  recordSuccess(toolSignature) {
    const state = this._getState(toolSignature);
    const now = Date.now();

    // Update statistics
    this.stats.totalSuccesses++;
    state.totalSuccesses++;

    // If in HALF-OPEN and successful, return to CLOSED
    if (state.state === 'HALF-OPEN') {
      this._setState(toolSignature, 'CLOSED', now);
      this.emit('circuit-recover', {
        tool: toolSignature,
        reason: 'Success in HALF-OPEN state',
        state: 'CLOSED'
      });
      this.stats.totalRecoveries++;
      return;
    }

    // If in CLOSED, reduce heat (success cools down the circuit)
    if (state.state === 'CLOSED') {
      state.heat = Math.max(0, state.heat - (this.config.heatDecayRate * 5)); // Cool down faster on success
      state.failures = 0; // Reset failure count on success
    }

    // Update global state on success
    if (this.globalState.state === 'OPEN' && now >= this.globalState.cooldownEnds) {
      this.globalState.state = 'CLOSED';
      this.globalState.failures = 0;
      this.emit('global-circuit-recover', {
        reason: 'Global circuit recovered after cooldown'
      });
    }
  }

  /**
   * Records a failed tool call and updates circuit breaker state
   * @param {string} toolSignature - Unique signature for the tool call
   * @param {string} [reason] - Optional reason for the failure
   */
  recordFailure(toolSignature, reason = 'Tool call failed') {
    const state = this._getState(toolSignature);
    const now = Date.now();

    // Update statistics
    this.stats.totalFailures++;
    state.totalFailures++;
    this.globalState.failures++;

    // Increase heat based on failure severity
    const heatIncrease = this._calculateHeatIncrease(state, reason);
    state.heat += heatIncrease;
    state.failures++;
    state.lastFailure = now;

    // Check if we should trip the circuit
    if (state.heat >= this.config.maxHeat) {
      this._tripCircuit(toolSignature, reason, now);
    }

    // Check global circuit breaker
    if (this.globalState.failures >= this.config.globalTripThreshold) {
      this._tripGlobalCircuit(reason, now);
    }

    // Emit failure event
    this.emit('circuit-failure', {
      tool: toolSignature,
      reason: reason,
      heat: state.heat,
      failures: state.failures,
      state: state.state
    });
  }

  /**
   * Gets the current state of a specific tool's circuit
   * @param {string} toolSignature - Unique signature for the tool call
   * @returns {Object} - Current circuit state
   */
  getState(toolSignature) {
    return this._getState(toolSignature);
  }

  /**
   * Gets the current global circuit state
   * @returns {Object} - Global circuit state
   */
  getGlobalState() {
    return { ...this.globalState };
  }

  /**
   * Resets the circuit for a specific tool (manual override)
   * @param {string} toolSignature - Unique signature for the tool call
   * @param {boolean} [forceClosed=false] - Whether to force the circuit to CLOSED state
   */
  resetCircuit(toolSignature, forceClosed = false) {
    const state = this._getState(toolSignature);
    const now = Date.now();

    if (forceClosed || state.state === 'OPEN' || state.state === 'HALF-OPEN') {
      const previousState = state.state;
      this._setState(toolSignature, 'CLOSED', now);
      
      this.emit('circuit-reset', {
        tool: toolSignature,
        previousState: previousState,
        newState: 'CLOSED',
        reason: forceClosed ? 'Manual reset with force' : 'Manual reset'
      });
    }
  }

  /**
   * Resets the global circuit breaker (manual override)
   * @param {boolean} [forceClosed=false] - Whether to force the global circuit to CLOSED state
   */
  resetGlobalCircuit(forceClosed = false) {
    const now = Date.now();

    if (forceClosed || this.globalState.state === 'OPEN') {
      const previousState = this.globalState.state;
      this.globalState.state = 'CLOSED';
      this.globalState.failures = 0;
      this.globalState.lastFailure = 0;
      this.globalState.cooldownEnds = 0;
      
      this.emit('global-circuit-reset', {
        previousState: previousState,
        newState: 'CLOSED',
        reason: forceClosed ? 'Manual reset with force' : 'Manual reset'
      });
    }
  }

  /**
   * Gets remaining cooldown time for a specific tool
   * @param {string} toolSignature - Unique signature for the tool call
   * @returns {number} - Remaining cooldown time in milliseconds (0 if not in cooldown)
   */
  getCooldownRemaining(toolSignature) {
    const state = this._getState(toolSignature);
    const now = Date.now();
    
    if (state.state === 'OPEN' && now < state.cooldownEnds) {
      return state.cooldownEnds - now;
    }
    return 0;
  }

  /**
   * Gets the current statistics for monitoring and debugging
   * @returns {Object} - Circuit breaker statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeCircuits: this._getActiveCircuitsCount(),
      globalState: this.globalState.state,
      config: this.config
    };
  }

  /**
   * INTERNAL: Gets or creates state for a tool signature
   * @private
   */
  _getState(toolSignature) {
    if (!this.states.has(toolSignature)) {
      this.states.set(toolSignature, {
        state: 'CLOSED',
        heat: 0,
        failures: 0,
        lastFailure: 0,
        cooldownEnds: 0,
        halfOpenAttempts: 0,
        totalFailures: 0,
        totalSuccesses: 0
      });
    }
    return this.states.get(toolSignature);
  }

  /**
   * INTERNAL: Sets the state for a tool signature
   * @private
   */
  _setState(toolSignature, state, now) {
    const circuitState = this._getState(toolSignature);
    circuitState.state = state;
    circuitState.lastFailure = now;
    
    if (state === 'OPEN') {
      circuitState.cooldownEnds = now + this.config.cooldownPeriod;
      circuitState.halfOpenAttempts = 0;
    } else if (state === 'HALF-OPEN') {
      circuitState.halfOpenAttempts = 0;
    }
  }

  /**
   * INTERNAL: Updates state based on time elapsed (heat decay, cooldown expiration)
   * @private
   */
  _updateState(state, toolSignature, now) {
    // Heat naturally decays over time
    if (state.heat > 0) {
      const timeElapsed = (now - state.lastFailure) / 1000; // Convert to seconds
      const heatDecay = this.config.heatDecayRate * timeElapsed;
      state.heat = Math.max(0, state.heat - heatDecay);
    }

    // Auto-recovery from OPEN to HALF-OPEN after cooldown
    if (state.state === 'OPEN' && now >= state.cooldownEnds) {
      this._setState(toolSignature, 'HALF-OPEN', now);
      this.emit('circuit-half-open', {
        tool: toolSignature,
        reason: 'Auto-recovery from OPEN to HALF-OPEN',
        attemptNumber: 1
      });
    }
  }

  /**
   * INTERNAL: Trip the circuit for a specific tool
   * @private
   */
  _tripCircuit(toolSignature, reason, now) {
    this._setState(toolSignature, 'OPEN', now);
    this.stats.totalTrips++;

    this.emit('circuit-break', {
      tool: toolSignature,
      reason: reason,
      heat: this._getState(toolSignature).heat,
      cooldownPeriod: this.config.cooldownPeriod,
      cooldownEnds: now + this.config.cooldownPeriod
    });
  }

  /**
   * INTERNAL: Trip the global circuit breaker
   * @private
   */
  _tripGlobalCircuit(reason, now) {
    this.globalState.state = 'OPEN';
    this.globalState.lastFailure = now;
    this.globalState.cooldownEnds = now + this.config.cooldownPeriod;

    this.emit('global-circuit-break', {
      reason: reason,
      failures: this.globalState.failures,
      cooldownPeriod: this.config.cooldownPeriod,
      cooldownEnds: now + this.config.cooldownPeriod
    });
  }

  /**
   * INTERNAL: Check and update global circuit state
   * @private
   */
  _checkGlobalState() {
    const now = Date.now();

    if (this.globalState.state === 'OPEN' && now >= this.globalState.cooldownEnds) {
      this.globalState.state = 'CLOSED';
      this.globalState.failures = 0;
      this.emit('global-circuit-recover', {
        reason: 'Global circuit auto-recovered after cooldown'
      });
    }

    return this.globalState;
  }

  /**
   * INTERNAL: Calculate heat increase based on failure characteristics
   * @private
   */
  _calculateHeatIncrease(state, reason) {
    let heatIncrease = 1.0; // Base heat increase

    // Increase heat more for repeated failures of the same tool
    if (state.failures > 0) {
      heatIncrease += (state.failures * 0.5);
    }

    // Increase heat more for recent failures
    const timeSinceLastFailure = Date.now() - state.lastFailure;
    if (timeSinceLastFailure < 5000) { // Within 5 seconds
      heatIncrease += 1.0;
    }

    // Increase heat for specific failure reasons
    if (reason.includes('timeout') || reason.includes('network')) {
      heatIncrease += 0.5;
    }

    return heatIncrease;
  }

  /**
   * INTERNAL: Get count of active (OPEN) circuits
   * @private
   */
  _getActiveCircuitsCount() {
    let count = 0;
    for (const [toolSignature, state] of this.states) {
      if (state.state === 'OPEN' || state.state === 'HALF-OPEN') {
        count++;
      }
    }
    return count;
  }

  /**
   * INTERNAL: Start background cleanup task to remove stale circuit states
   * @private
   */
  _startCleanupTask() {
    // Clean up stale circuit states every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const maxAge = 30 * 60 * 1000; // 30 minutes

      for (const [toolSignature, state] of this.states) {
        // Only clean up if circuit has been CLOSED for a long time
        if (state.state === 'CLOSED' && (now - state.lastFailure) > maxAge) {
          this.states.delete(toolSignature);
        }
      }
    }, 5 * 60 * 1000); // Run every 5 minutes
  }

  /**
   * Enable or disable the circuit breaker
   * @param {boolean} enabled - Whether to enable the circuit breaker
   */
  setEnabled(enabled) {
    const wasEnabled = this.config.enabled;
    this.config.enabled = enabled;

    this.emit('circuit-breaker-toggle', {
      enabled: enabled,
      previousState: wasEnabled
    });
  }

  /**
   * Update circuit breaker configuration
   * @param {Object} newConfig - New configuration object (partial updates allowed)
   */
  updateConfig(newConfig) {
    const previousConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    this.emit('circuit-breaker-config-update', {
      previousConfig: previousConfig,
      newConfig: this.config
    });
  }
}