# Streaming Architecture Refactor Plan

## Overview

This document outlines the architectural refactoring plan to address the identified issues with streaming logic duplication, progress tracking inconsistencies, and divergent tool execution paths in the MR-BOT codebase.

## Current Issues

### 1. Streaming Logic Duplication
- **Agent.js** (lines 187-250): `executeStream()` with manual streaming implementation
- **ResponseProcessor.js** (lines 389-476): `processStreamResponse()` with separate streaming logic
- Both handle tool calls, message accumulation, and response processing independently

### 2. Progress Parsing/Merging Scattered
- **Agent.js**: `_parseProgressToMap()`, `_mergeProgressStates()`, `_captureProgressIntent()`
- **ToolManager.js**: `_processTaskProgress()` with duplicate parsing logic
- Multiple implementations create inconsistency risk

### 3. Tool Execution Path Divergence
- **ResponseProcessor.js**: Uses `_runToolCalls()` → `executeToolWithCircuitBreaker()` with circuit breaker protection
- **Agent.js**: Uses manual loop calling `toolManager.executeToolCall()` directly
- **ToolManager.js**: Has different validation and execution patterns

### 4. Inconsistent Tool Call Handling
- Agent.js uses `toolCallAccumulator` pattern for streaming tool calls
- ResponseProcessor.js uses similar but separate logic
- Different validation and execution patterns across paths

## Proposed Solution Architecture

### 1. Create Unified StreamingResponseProcessor

**Location**: `src/StreamingResponseProcessor.js`

**Responsibilities**:
- Handle all streaming message accumulation
- Manage tool call parsing consistently
- Ensure proper message ordering
- Use unified tool execution path with circuit breaker protection
- Centralize progress tracking logic
- **NEW: Integrate Victor's structured monologue and memory operations**
- **NEW: Support high-volume batch processing for Sentinel**

**Key Methods**:
```javascript
class StreamingResponseProcessor {
  constructor(agent) { /* Initialize with agent reference */ }
  
  async processStreamResponse(stream, messages, onChunk) { /* Unified streaming logic */ }
  async processBatch(stream, messages, batchType = 'triage', onChunk) { /* Batch-optimized processing */ }
  async _handleToolCalls(toolCalls, messages) { /* Unified tool execution */ }
  _parseProgressFromToolCalls(toolCalls) { /* Centralized progress parsing */ }
  _mergeProgressStates(states) { /* Centralized progress merging */ }
  
  // NEW: Memory and thought integration hooks
  async beforePlanning(messages) { /* Recall relevant memories */ }
  async afterDecision(result, context) { /* Commit insights to memory */ }
  async recordStructuredThought(content, type = 'reasoning') { /* Victor monologue */ }
}
```

### 2. Refactor Agent.js

**Changes**:
- Remove `executeStream()` method
- Delegate streaming to `StreamingResponseProcessor`
- Maintain backward compatibility with simplified interface
- **NEW: Add Victor/Sentinel mode detection and memory integration**

**New Agent.js streaming method**:
```javascript
async executeStream(history, userInput, onChunk) {
  const messages = this._prepareMessages(history, userInput);
  const stream = await this.client.chat.stream({
    model: this.model,
    messages: messages,
    ...(this.tools.length > 0 && { tools: this.toolManager.getApiTools() })
  });
  
  return this.streamingProcessor.processStreamResponse(stream, messages, onChunk);
}

// NEW: Batch processing method for Sentinel
async executeBatch(history, userInput, batchType = 'triage', onChunk) {
  const messages = this._prepareMessages(history, userInput);
  const stream = await this.client.chat.stream({
    model: this.model,
    messages: messages,
    ...(this.tools.length > 0 && { tools: this.toolManager.getApiTools() })
  });
  
  return this.streamingProcessor.processBatch(stream, messages, batchType, onChunk);
}
```

### 3. Consolidate Progress Tracking

**Centralize in StreamingResponseProcessor**:
- Move `_parseProgressToMap()` from Agent.js
- Move `_mergeProgressStates()` from Agent.js  
- Move `_captureProgressIntent()` logic from Agent.js
- Remove duplicate `_processTaskProgress()` from ToolManager.js
- **NEW: Add lightweight progress mode for Victor (reduces token overhead)**

**Progress Tracking Flow**:
1. Parse progress from tool call arguments
2. Merge concurrent progress updates atomically
3. Update agent state consistently
4. Emit progress events uniformly
5. **NEW: Support optional "thought-only" progress for quick memory operations**

**NEW: Lightweight Progress Mode**
- For Victor: Structured thoughts replace heavy checklist format
- For Sentinel: Batch-level progress instead of per-email tracking
- Reduces token usage by 40-60% for high-volume operations

### 4. Unify Tool Execution Paths

**Create ToolExecutionManager**:
- Single point for all tool execution
- Consistent circuit breaker protection
- Unified error handling and retry logic
- Standardized progress tracking integration
- **NEW: Semantic loop checking via Pinecone integration**
- **NEW: Automatic memory/thought hooks for Victor mode**

**Execution Flow**:
1. Validate tool calls
2. Check circuit breaker (syntactic + semantic via Pinecone)
3. Execute tools with consistent error handling
4. Process progress updates (lightweight mode for Victor)
5. Record structured thoughts (Victor mode)
6. Commit insights to memory (Victor/Sentinel mode)
7. Return standardized results

**NEW: Enhanced ToolExecutionManager Features**
- **Semantic Loop Detection**: Use Pinecone to detect similar-but-rephrased tool calls
- **Memory Integration**: Automatic recall/commit hooks based on agent mode
- **Progress Mode Selection**: Choose between checklist, thought-only, or batch progress
- **Importance Scoring**: Auto-score insights for memory prioritization

## Implementation Roadmap

### Phase 1: Create Core Infrastructure (Week 1)

1. **Create StreamingResponseProcessor class**
   - Implement unified streaming message accumulation
   - Add tool call parsing and handling
   - Integrate with existing circuit breaker
   - Add progress tracking consolidation
   - **NEW: Add memory/thought integration hooks**
   - **NEW: Implement lightweight progress mode**
   - **NEW: Add batch processing support**

2. **Create ToolExecutionManager class**
   - Centralize all tool execution logic
   - Implement consistent error handling
   - Add progress tracking integration
   - Ensure circuit breaker protection
   - **NEW: Add semantic loop detection via Pinecone**
   - **NEW: Implement automatic memory operations**
   - **NEW: Add importance scoring for insights**

### Phase 2: Refactor Agent.js (Week 2)

1. **Remove executeStream duplication**
   - Extract streaming logic to StreamingResponseProcessor
   - Simplify Agent.js interface
   - Maintain backward compatibility
   - **NEW: Add Victor/Sentinel mode detection**

2. **Update progress tracking**
   - Remove duplicate parsing methods
   - Delegate to centralized processor
   - Ensure consistent state updates
   - **NEW: Implement mode-specific progress handling**

### Phase 3: Consolidate ResponseProcessor (Week 3)

1. **Refactor processStreamResponse**
   - Delegate to StreamingResponseProcessor
   - Remove duplicate streaming logic
   - Maintain non-streaming functionality
   - **NEW: Add memory integration for Victor mode**

2. **Update tool execution paths**
   - Use unified ToolExecutionManager
   - Ensure consistent circuit breaker usage
   - Standardize error handling
   - **NEW: Add semantic loop detection integration**

### Phase 4: Clean Up and Testing (Week 4)

1. **Remove duplicate code**
   - Eliminate `_parseProgressToMap()` from Agent.js
   - Remove `_mergeProgressStates()` from Agent.js
   - Remove `_captureProgressIntent()` from Agent.js
   - Remove `_processTaskProgress()` from ToolManager.js
   - **NEW: Remove duplicate memory/thought handling**

2. **Comprehensive testing**
   - Test streaming functionality
   - Verify progress tracking consistency
   - Ensure tool execution reliability
   - Validate circuit breaker protection
   - **NEW: Test Victor monologue integration**
   - **NEW: Test Sentinel batch processing efficiency**
   - **NEW: Test memory operations and semantic loop detection**

## Benefits

### 1. **Eliminated Duplication**
- Single streaming implementation
- Unified progress tracking
- Consistent tool execution

### 2. **Improved Maintainability**
- Clear separation of concerns
- Single responsibility principle
- Easier debugging and testing

### 3. **Enhanced Reliability**
- Consistent circuit breaker protection
- Unified error handling
- Atomic progress state management

### 4. **Better Performance**
- Reduced code duplication
- Optimized message handling
- Streamlined execution paths

### 5. **Victor/Sentinel Integration**
- **NEW: Automatic structured monologue recording**
- **NEW: Memory-augmented decision making**
- **NEW: High-volume batch processing optimization**
- **NEW: Semantic loop detection for better reliability**

## Risk Mitigation

### 1. **Backward Compatibility**
- Maintain existing Agent.js interface
- Preserve all public methods
- Ensure no breaking changes for consumers

### 2. **Testing Strategy**
- Unit tests for each new component
- Integration tests for streaming workflows
- Regression tests for existing functionality

### 3. **Gradual Migration**
- Implement new classes alongside existing code
- Migrate functionality incrementally
- Maintain fallback options during transition

### 4. **Victor/Sentinel Specific Risks**
- **NEW: Ensure memory operations don't increase token usage for simple tools**
- **NEW: Test high-volume batch processing with 100-500 email simulations**
- **NEW: Validate semantic loop detection accuracy vs. false positives**
- **NEW: Monitor performance impact of automatic thought recording**

## Success Criteria

1. **Code Duplication Eliminated**: No duplicate streaming or progress tracking logic
2. **Consistent Behavior**: All tool execution paths use same error handling and circuit breaker
3. **Maintainable Architecture**: Clear separation of concerns with single responsibility
4. **Performance Maintained**: No degradation in streaming or tool execution performance
5. **Test Coverage**: Comprehensive test suite covering all new and refactored functionality
6. **Victor Integration**: Structured monologue recording works without code changes in multiple files
7. **Sentinel Efficiency**: Batch triage achieves consistent 60%+ noise reduction with <X> tokens per email
8. **Memory Operations**: Automatic recall/commit operations maintain <5% token overhead increase
9. **Semantic Loop Detection**: False positive rate <2% while catching 95% of actual loops

## Next Steps

1. **Review and approve this refactoring plan**
2. **Begin Phase 1 implementation with StreamingResponseProcessor**
3. **Set up testing infrastructure for new components**
4. **Establish code review process for refactoring changes**
5. **Plan migration timeline and rollback procedures**
6. **Create skeleton code for StreamingResponseProcessor with memory/thought hooks**
7. **Implement ToolExecutionManager with semantic loop detection**
8. **Add Victor/Sentinel mode detection to Agent.js**

This refactoring will significantly improve the codebase architecture while maintaining all existing functionality and improving long-term maintainability. The enhanced plan now serves as both a structural cleanup AND a strategic conversion enabler for Victor's structured monologue and Sentinel's high-volume batch processing needs.

## Implementation Priority

**Immediate (Week 1)**: 
- Create StreamingResponseProcessor with memory integration hooks
- Implement ToolExecutionManager with semantic loop detection
- Add lightweight progress mode support

**Short-term (Weeks 2-3)**:
- Refactor Agent.js to support Victor/Sentinel modes
- Consolidate ResponseProcessor functionality
- Implement batch processing optimizations

**Long-term (Week 4+)**:
- Comprehensive testing and validation
- Performance optimization for high-volume scenarios
- Documentation and migration guides
