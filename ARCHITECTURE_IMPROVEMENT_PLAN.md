# Architecture Improvement Plan: "Strict Internal, Corrective Edge"

## Executive Summary

This document outlines a comprehensive plan to address critical architectural issues in the Agent system, focusing on tool call ID mapping, loop detection, circuit breaker robustness, and schema consistency. The plan implements a "Fail Fast" approach for developer errors while maintaining resilience against model hallucinations.

## Issues Identified

### 1. Tool Call ID Mapping Problem (CRITICAL)

**Location:** `src/ResponseProcessor.js` (lines 337-338, 360-361)
**Problem:** Manual fallback mapping `msg.toolCallId || msg.tool_call_id` masks developer errors
**Impact:** Silent failures, inconsistent data flow, debugging nightmares

**Current Code:**
```javascript
// PROBLEMATIC: Masks developer errors
toolCallId: msg.toolCallId || msg.tool_call_id
```

**Root Cause:** System accepts both camelCase and snake_case formats, violating API contract consistency

### 2. Shallow Loop Detection (HIGH)

**Location:** `src/LoopDetector.js` (lines 67-74)
**Problem:** Only detects A→B→A→B patterns, misses N-step loops (A→B→C→A→B→C)
**Impact:** Agent gets stuck in complex dependency loops

**Current Code:**
```javascript
// LIMITED: Only detects 2-step patterns
const pattern = recentCalls.slice(0, 2);
const nextPattern = recentCalls.slice(2, 4);
```

### 3. Serverless Process Hanging (MEDIUM)

**Location:** `src/CircuitBreaker.js` (lines 440-442)
**Problem:** Background cleanup timer prevents graceful process exit
**Impact:** AWS Lambda/Vercel deployments hang, resource leaks

**Current Code:**
```javascript
// PROBLEMATIC: Timer keeps process alive
setInterval(() => {
  // cleanup logic
}, 5 * 60 * 1000);
```

### 4. Schema Fragility (MEDIUM)

**Location:** Multiple files in `src/ResponseProcessor.js`
**Problem:** Manual re-mapping scattered throughout codebase
**Impact:** High maintenance, inconsistent schema handling

### 5. Missing Token-Aware Heat Scaling (LOW)

**Location:** `src/CircuitBreaker.js` (lines 200-202)
**Problem:** All tool failures treated equally regardless of cost
**Impact:** Expensive tool failures don't trip breaker faster than cheap ones

## Implementation Plan

### Phase 1: Core Tool Call ID Validation (Priority: CRITICAL)

#### 1.1 Remove Fallback Mapping
**File:** `src/ResponseProcessor.js`
**Action:** Replace fallback logic with strict validation

```javascript
// BEFORE (problematic)
toolCallId: msg.toolCallId || msg.tool_call_id

// AFTER (strict)
toolCallId: msg.toolCallId // Strict camelCase only
```

#### 1.2 Add Developer Guard (Fail Fast)
**File:** `src/ResponseProcessor.js` (in `executeToolWithCircuitBreaker`)
**Action:** Add validation that crashes on snake_case usage

```javascript
// NEW: Strict Internal Check
if (result && typeof result === 'object' && 'tool_call_id' in result) {
    throw new Error(
        `[CRITICAL ARCHITECTURAL ERROR]: Tool "${toolCall.function.name}" returned 'tool_call_id'. ` +
        `The Swarm requires 'toolCallId' (camelCase). Please update your tool handler definition.`
    );
}
```

#### 1.3 Add Model Guard (Auto-Correction)
**File:** `src/ResponseProcessor.js` (in `validateToolCall`)
**Action:** Normalize model hallucinations before processing

```javascript
// NEW: Model Typos Sanitizer
validateToolCall(toolCall) {
    // Force normalization of the ID key immediately upon receipt from the SDK
    if (!toolCall.id && toolCall.tool_call_id) {
        toolCall.id = toolCall.tool_call_id; // Normalize hallucinated key
    }
    // ... existing validation logic
}
```

#### 1.4 Add Startup Validation (Registry Patch)
**File:** `src/Agent.js` (in constructor)
**Action:** Scan tool definitions at startup and throw custom error if violations found

**Enhancement:** Replace `process.exit(1)` with custom error for graceful host application handling

```javascript
// NEW: Startup Definition Scan (Registry Patch)
_validateToolDefinitions() {
    for (const tool of this.tools) {
        if (JSON.stringify(tool).includes('tool_call_id')) {
            throw new Error(`[ARCHITECTURAL_VIOLATION]: Tool '${tool.function.name}' uses snake_case. Initialisation aborted.`);
        }
    }
}
```

**Rationale:** This allows the host application to handle the failure gracefully (e.g., logging to Sentry before shutdown) while still preventing the Engine from initializing.

### Phase 2: Enhanced Loop Detection (Priority: HIGH)

#### 2.1 Implement N-Gram Pattern Detection (Optimized)
**File:** `src/LoopDetector.js`
**Action:** Replace hardcoded A→B detection with optimized sliding window approach

**Enhancement:** Use array-based slicing instead of string joining to prevent memory bottlenecks

```javascript
// NEW: Optimized N-Gram Loop Detection
_detectComplexLoop() {
    const sigs = this.recentToolCalls.map(tc => tc.signature);
    const n = sigs.length;
    
    if (n < 4) return false;

    // Check for any repeating sequence in the last 6 calls
    // Optimized: Use array comparison instead of string joining
    for (let L = 2; L <= Math.floor(n / 2); L++) {
        const currentPattern = sigs.slice(0, L);
        const previousPattern = sigs.slice(L, L * 2);
        
        // Array comparison for better performance
        if (currentPattern.every((sig, i) => sig === previousPattern[i])) {
            return true;
        }
    }
    return false;
}
```

**Rationale:** This approach prevents memory bottlenecks when signatures are large JSON strings and avoids the overhead of string joining operations.

#### 2.2 Maintain Backward Compatibility
**Action:** Keep existing single-tool loop detection while adding N-Gram support

### Phase 3: Serverless-Safe Circuit Breaker (Priority: MEDIUM)

#### 3.1 Add unref() to Cleanup Timer
**File:** `src/CircuitBreaker.js` (in `_startCleanupTask`)
**Action:** Prevent timer from keeping process alive

```javascript
// NEW: Serverless-Safe Cleanup
_startCleanupTask() {
    const timer = setInterval(() => {
        // ... existing cleanup logic
    }, 5 * 60 * 1000);
    
    if (timer.unref) {
        timer.unref(); // Prevents the interval from keeping the process alive
    }
}
```

#### 3.2 Add Token-Aware Heat Scaling (with DefaultToolWeights)
**File:** `src/CircuitBreaker.js` (in constructor and `recordFailure`)
**Action:** Scale heat increase based on tool cost with predefined weights

**Enhancement:** Add `DefaultToolWeights` manifest to prevent dead code

```javascript
// NEW: Default Tool Cost Weights
const DEFAULT_TOOL_WEIGHTS = {
    webSearch: 1.0,        // Standard cost
    databaseWrite: 2.5,    // High risk/cost
    vectorSearch: 1.5,     // Compute intensive
    fileRead: 0.5,         // Low cost
    fileWrite: 1.0,        // Standard cost
    calculator: 0.1,       // Very low cost
    // Add more as needed
};

// NEW: Token-Aware Heat Scaling with Cost Weights
_calculateHeatIncrease(state, reason, toolName = 'unknown') {
    const toolCostWeight = DEFAULT_TOOL_WEIGHTS[toolName] || 1.0;
    let heatIncrease = 1.0 * toolCostWeight; // Base heat increase scaled by cost
    
    // Existing logic for repeated failures, timing, etc.
    // ... existing code
    
    return heatIncrease;
}
```

**Rationale:** This ensures expensive tool failures (like database writes) trip the circuit breaker faster than cheap utility tools (like calculators), making the system more responsive to actual resource constraints.

### Phase 4: SDK-Agnostic Message Factory (Priority: MEDIUM)

#### 4.1 Create Centralized Message Factory
**File:** `src/MessageFactory.js` (NEW)
**Action:** Create utility for consistent message normalization

```javascript
// NEW: SDK-Agnostic Message Factory
export class MessageFactory {
    static createToolMessage(id, content) {
        return Object.freeze({
            role: "tool",
            content: content,
            toolCallId: id // Only camelCase is permitted here
        });
    }
    
    static normalizeMessage(message) {
        // Handle camelCase/snake_case conversion automatically
        if (message.tool_call_id && !message.toolCallId) {
            message.toolCallId = message.tool_call_id;
        }
        return message;
    }
}
```

#### 4.2 Update ResponseProcessor to Use Factory
**File:** `src/ResponseProcessor.js`
**Action:** Replace manual mapping with factory calls

## Implementation Timeline

### Week 1: Core Validation (CRITICAL)
- [ ] Implement Phase 1.1: Remove fallback mapping
- [ ] Implement Phase 1.2: Add developer guard
- [ ] Implement Phase 1.3: Add model guard
- [ ] Implement Phase 1.4: Add startup validation
- [ ] **Testing:** Verify fail-fast behavior catches developer errors
- [ ] **Testing:** Verify model hallucinations are auto-corrected

### Week 2: Loop Detection (HIGH)
- [ ] Implement Phase 2.1: N-Gram pattern detection
- [ ] Implement Phase 2.2: Maintain backward compatibility
- [ ] **Testing:** Verify 3-step and 4-step loops are detected
- [ ] **Testing:** Verify existing 2-step detection still works

### Week 3: Circuit Breaker Robustness (MEDIUM)
- [ ] Implement Phase 3.1: Serverless-safe cleanup
- [ ] Implement Phase 3.2: Token-aware heat scaling
- [ ] **Testing:** Verify process exits gracefully in serverless environments
- [ ] **Testing:** Verify expensive tools trip breaker faster

### Week 4: Schema Centralization (MEDIUM)
- [ ] Implement Phase 4.1: Create MessageFactory
- [ ] Implement Phase 4.2: Update ResponseProcessor
- [ ] **Testing:** Verify consistent schema handling across all message types

## Risk Mitigation

### Risk 1: Breaking Existing Tools
**Mitigation:** Comprehensive testing with existing tool definitions before deployment

### Risk 2: False Positives in Loop Detection
**Mitigation:** Maintain existing detection logic as fallback, gradual rollout

### Risk 3: Performance Impact
**Mitigation:** Benchmark N-Gram detection, optimize with early returns

### Risk 4: Serverless Compatibility Issues
**Mitigation:** Test on multiple serverless platforms (AWS Lambda, Vercel, Cloudflare Workers)

## Success Criteria

### Functional Requirements
- [ ] Developer errors using `tool_call_id` cause immediate failure with clear error message
- [ ] Model hallucinations using `tool_call_id` are auto-corrected without breaking the loop
- [ ] N-step loops (3+ steps) are detected and prevented
- [ ] Process exits gracefully in serverless environments
- [ ] Expensive tool failures trip circuit breaker faster than cheap ones

### Non-Functional Requirements
- [ ] Zero breaking changes to existing API contracts
- [ ] Performance impact < 5% on tool call processing
- [ ] Memory usage remains stable with new cleanup mechanisms
- [ ] Error messages are actionable and developer-friendly
 
## Rollout Strategy

### Phase 1: Internal Testing
- Deploy to development environment
- Test with comprehensive tool suite
- Validate all error scenarios

### Phase 2: Canary Deployment
- Deploy to 5% of production traffic
- Monitor for unexpected failures
- Collect performance metrics

### Phase 3: Full Rollout
- Deploy to 100% of production traffic
- Monitor system health and performance
- Gather developer feedback

## Monitoring & Observability

### Key Metrics to Track
- Tool call failure rate (should decrease with better validation)
- Loop detection rate (should increase with N-Gram detection)
- Circuit breaker trips (should be more accurate with token-aware scaling)
- Process exit time in serverless environments (should be immediate)

### Alerts to Configure
- Spike in tool call failures (indicates validation issues)
- Increase in loop detection (indicates improved detection)
- Process hanging in serverless environments (indicates unref issues)

## Implementation Order Strategy

To incorporate this plan effectively, I suggest the following **Integration Order**:

1.  **The Registry Patch:** Implement the startup validation immediately. This is our "Line in the Sand." No tool enters the Swarm unless it is camelCase.
2.  **The Message Factory Injection:** Introduce `MessageFactory` as a utility first, then refactor `ResponseProcessor` to use it. This prevents a "Big Bang" refactor that might break the loop.
3.  **The Circuit Breaker Update:** The `unref()` fix is a "Quick Win" and should be merged alongside Phase 1.

## Victor's Final Review
*   **Reliability:** 9.5/10 (The Corrective Edge ensures we don't crash on LLM typos).
*   **Scalability:** 8.5/10 (N-Gram is better, but we must keep `maxRecentCalls` reasonably low, ~10-15).
*   **Maintainability:** 10/10 (The Message Factory centralizes the most volatile part of the SDK).

## Conclusion

This plan addresses all identified architectural issues while maintaining backward compatibility and improving system robustness. The "Strict Internal, Corrective Edge" approach ensures developer errors are caught immediately while maintaining resilience against model hallucinations.

The implementation is designed to be incremental, allowing for thorough testing at each phase and minimizing risk to production systems. The refinements suggested by Victor make this plan production-ready by addressing potential failure points and ensuring graceful degradation where appropriate.
