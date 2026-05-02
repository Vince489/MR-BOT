# Final Consolidated Implementation Plan for MR-BOT

Based on the combined feedback from both reviews, here's the optimized implementation plan that addresses all critical concerns while maintaining focus on high-impact improvements:

## Critical Fixes (Must Implement First)

### 1. Fix Logic Bug in `_hasRoomForNextRound`
```javascript
// In ResponseProcessor.js - CORRECTED VERSION
_hasRoomForNextRound(messages) {
  const limit = this.agent.contextLimit || 128000;
  const estimatedTokens = countMessageTokens(messages);
  const buffer = 3000;

  if ((estimatedTokens + buffer) >= limit) {
    this._truncateContext(messages);
    return true; // Continue after truncation
  }
  return true; // Always return true - truncation is handled separately
}

// NEW METHOD to check if we're actually approaching limits
_willExceedLimit(messages, additionalTokens = 0) {
  const limit = this.agent.contextLimit || 128000;
  const estimatedTokens = countMessageTokens(messages);
  return (estimatedTokens + additionalTokens + 3000) >= limit;
}
```

### 2. Add Tool Timeouts
```javascript
// In ToolManager.js
async executeToolCall(toolCall, actionsTaken, userInput, retryCount = 0) {
  const { name, arguments: rawArgs } = toolCall.function;
  const timeout = this.timeoutMap[name] || 30000; // 30s default, tool-specific overrides

  try {
    // Wrap execution in timeout
    const executionPromise = (async () => {
      const handler = this.handlers[name];
      if (!handler) throw new Error(`Handler for "${name}" not found`);

      const args = JSON.parse(rawArgs || "{}");
      const { cleanArgs, meta } = this._interceptMetaArguments(args);

      let validatedArgs = cleanArgs;
      if (meta.taskProgress !== undefined) {
        validatedArgs.taskProgress = meta.taskProgress;
      }

      if (meta.taskProgress) {
        this._processTaskProgress(meta.taskProgress, name, validatedArgs);
      }

      return await handler(validatedArgs, {
        agent: this.agent,
        userInput,
        signal: abortSignal
      });
    })();

    const result = await Promise.race([
      executionPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Tool ${name} timed out after ${timeout}ms`)),
        timeout)
      )
    ]);

    // Rest of existing success handling...
  } catch (error) {
    // Enhanced error handling with timeout awareness
    if (error.message.includes("timed out")) {
      this.agent.circuitBreaker.recordFailure(
        this.agent.loopDetector.getCallSignature(name, rawArgs),
        `Tool timeout after ${timeout}ms`
      );
    }
    // Rest of existing error handling...
  }
}
```

## Phase 1: Core Improvements (1-2 Weeks)

### 1. Processing Modes with Per-Request Override
```javascript
// In Agent.js
constructor(config) {
  // ...
  this.processingModes = {
    fast: { maxRounds: 3, validationDepth: 1, timeoutFactor: 0.5 },
    balanced: { maxRounds: 8, validationDepth: 2, timeoutFactor: 1 },
    thorough: { maxRounds: 15, validationDepth: 3, timeoutFactor: 2 }
  };
  this.defaultMode = config.processingMode || 'balanced';
  // ...
}

async execute(history, userInput, options = {}) {
  const mode = options.mode || this.defaultMode;
  const config = this.processingModes[mode] || this.processingModes.balanced;

  // Apply timeouts based on mode
  this.toolManager.setTimeoutFactor(config.timeoutFactor);

  // Pass config to response processor
  return this.responseProcessor.processResponse(
    await this._getInitialResponse(history, userInput),
    history,
    config
  );
}
```

### 2. Schema-Based Tool Validation (Using AJV)
```javascript
// In ToolManager.js constructor
this.validator = new Ajv();
this.schemas = {
  web_search: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
      title: { type: "string", minLength: 3, maxLength: 200 },
      snippet: { type: "string", minLength: 10 },
      source: { type: "string" }
    },
    required: ["url", "title", "snippet"],
    additionalProperties: false
  },
  // Other tool schemas...
};

async _validateToolOutput(toolName, result) {
  if (!this.schemas[toolName]) return true;

  const validate = this.validator.compile(this.schemas[toolName]);
  const valid = validate(result);

  if (!valid) {
    throw new Error(`Validation failed for ${toolName}: ${this.validator.errorsText(validate.errors)}`);
  }
  return true;
}
```

### 3. Token-Aware Context Truncation with Summarization
```javascript
// In ResponseProcessor.js
_truncateContext(messages) {
  const strategy = this.agent.contextTruncationStrategy || 'summarize+keep-last-3';

  switch (strategy) {
    case 'summarize+keep-last-3':
      const [systemMsg, recentTurns] = this._extractSystemAndRecent(messages, 3);
      const oldMessages = messages.filter(msg =>
        msg !== systemMsg && !recentTurns.includes(msg)
      );

      if (oldMessages.length > 0) {
        const summary = this._summarizeOldMessages(oldMessages);
        if (summary) {
          messages.length = 0;
          if (systemMsg) messages.push(systemMsg);
          messages.push({
            role: "assistant",
            content: `[Previous conversation summary: ${summary}]`
          });
          messages.push(...recentTurns);
        }
      }
      break;
    // Other strategies...
  }
}

async _summarizeOldMessages(messages) {
  if (messages.length === 0) return null;

  const summaryModel = this.agent.model.replace('-medium', '-small') || "mistral-small-2505";
  const messageTexts = messages.map(msg =>
    `${msg.role}: ${typeof msg.content === 'string' ?
      msg.content.substring(0, 200) :
      JSON.stringify(msg).substring(0, 200)}`
  ).join('\n\n');

  const prompt = `
  Summarize these previous conversation turns in 2-3 sentences, focusing on:
  1. Key decisions made
  2. Important information discovered
  3. Pending tasks or questions

  Previous turns:
  ${messageTexts}
  `;

  try {
    const response = await this.agent.client.chat.complete({
      model: summaryModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.warn("Summary failed, using fallback:", error.message);
    return `Previous discussion covered ${messages.length} turns about ${messages[0].content.substring(0, 50)}...`;
  }
}
```

## Phase 2: State Management and Safety (2-3 Weeks)

### 1. State Reflection with Injection and Frequency Control
```javascript
// In Agent.js
constructor(config) {
  // ...
  this.reflectionFrequency = config.reflectionFrequency || 3; // Every 3 rounds
  this.lastReflectionRound = 0;
  // ...
}

async _generateAndInjectStateReflection(round) {
  if (round - this.lastReflectionRound < this.reflectionFrequency) {
    return "";
  }

  this.lastReflectionRound = round;
  const reflection = await this._generateStateReflection();

  // Inject into system prompt for next round
  const updatedSystemPrompt = `${this.systemPrompt}

## Current State Reflection (Generated at round ${round})
${reflection}

## Instructions
Use the above reflection to maintain context about what has been accomplished and what remains to be done.
`;

  return updatedSystemPrompt;
}
```

### 2. Hallucination Detection with Grounding Checks
```javascript
// In Agent.js
_validateProgressUpdates(progressUpdates) {
  const validated = [];
  const currentState = new Map(this.progressState);
  const toolHistory = this.progressHistory
    .filter(e => e.toolCall && e.toolCall !== 'intent-capture')
    .slice(-10); // Last 10 tool executions

  for (const progress of progressUpdates) {
    const lines = progress.split('\n');
    const validatedLines = [];
    const newState = new Map(currentState);

    for (const line of lines) {
      const match = line.match(/^\s*-\s*\[\s*(x| )\s*\]\s*(.+)$/);
      if (match) {
        const [_, status, task] = match;
        const isCompleted = status.toLowerCase() === 'x';
        const normalizedTask = task.trim();

        // Check for grounding evidence
        const hasEvidence = isCompleted ?
          this._hasGroundingEvidence(normalizedTask, toolHistory) :
          true; // Incomplete tasks don't need evidence

        if (hasEvidence) {
          validatedLines.push(line);
          newState.set(normalizedTask, isCompleted);
        } else if (isCompleted) {
          // Downgrade to incomplete if no evidence
          validatedLines.push(`- [ ] ${normalizedTask} (needs verification)`);
          newState.set(normalizedTask, false);
          console.warn(`Unverified completion claim for: ${normalizedTask}`);
        } else {
          // Keep incomplete tasks
          validatedLines.push(line);
          newState.set(normalizedTask, false);
        }
      }
    }

    if (validatedLines.length > 0) {
      validated.push(validatedLines.join('\n'));
    }

    // Update current state for next iteration
    currentState.clear();
    for (const [task, completed] of newState) {
      currentState.set(task, completed);
    }
  }

  return validated;
}

_hasGroundingEvidence(task, toolHistory) {
  const lowerTask = task.toLowerCase();

  // Check tool executions
  for (const entry of toolHistory) {
    if (entry.progress && entry.progress.toLowerCase().includes(lowerTask)) {
      return true;
    }
    if (entry.toolCall && entry.toolCall.toLowerCase().includes(lowerTask)) {
      return true;
    }
  }

  // Check recent conversation
  const recentHistory = this.conversationHistory.slice(-5);
  return recentHistory.some(msg =>
    (msg.role === 'assistant' && msg.content &&
     (msg.content.toLowerCase().includes(`completed ${lowerTask}`) ||
      msg.content.toLowerCase().includes(`finished ${lowerTask}`))) ||
    (msg.role === 'tool' && msg.content &&
     msg.content.toLowerCase().includes(lowerTask))
  );
}
```

### 3. Fallback Chains with Circuit Breaker Integration
```javascript
// In ToolManager.js
async executeToolCall(toolCall, actionsTaken, userInput, retryCount = 0) {
  const { name: primaryTool, arguments: rawArgs } = toolCall.function;
  const signature = this.agent.loopDetector.getCallSignature(primaryTool, rawArgs);

  // Check circuit breaker before attempting
  const cbStatus = this.agent.circuitBreaker.shouldAllowCall(signature);
  if (!cbStatus.allow) {
    return this._handleCircuitBrokenTool(toolCall, cbStatus);
  }

  try {
    // Try primary tool with timeout
    const result = await this._executeWithTimeout(toolCall, actionsTaken, userInput);
    this.agent.circuitBreaker.recordSuccess(signature);
    return result;
  } catch (primaryError) {
    this.agent.circuitBreaker.recordFailure(signature, primaryError.message);

    // Try fallbacks if available
    const fallbacks = this.fallbackChains[primaryTool] || [];
    if (fallbacks.length > 0) {
      return this._executeFallbacks(toolCall, fallbacks, actionsTaken, userInput, primaryError);
    }

    throw primaryError; // Re-throw if no fallbacks
  }
}

async _executeFallbacks(primaryCall, fallbacks, actionsTaken, userInput, primaryError) {
  const { function: { arguments: rawArgs } } = primaryCall;
  const results = {
    primary: {
      status: "error",
      message: primaryError.message,
      tool: primaryCall.function.name
    },
    fallbacks: []
  };

  for (const fallbackTool of fallbacks) {
    try {
      if (!this.handlers[fallbackTool]) continue;

      // Map arguments if needed
      const mappedArgs = this._mapArgumentsForFallback(
        primaryCall.function.name,
        fallbackTool,
        JSON.parse(rawArgs)
      );

      const fallbackCall = {
        id: `fallback_${Date.now()}`,
        function: {
          name: fallbackTool,
          arguments: JSON.stringify(mappedArgs)
        }
      };

      // Check circuit breaker for fallback
      const fbSignature = this.agent.loopDetector.getCallSignature(fallbackTool, JSON.stringify(mappedArgs));
      if (!this.agent.circuitBreaker.shouldAllowCall(fbSignature).allow) {
        results.fallbacks.push({
          tool: fallbackTool,
          status: "blocked",
          message: "Circuit breaker tripped"
        });
        continue;
      }

      const fallbackResult = await this._executeWithTimeout(
        fallbackCall,
        actionsTaken,
        userInput
      );

      results.fallbacks.push({
        tool: fallbackTool,
        status: "success",
        result: JSON.parse(fallbackResult.content)
      });

      // Return combined results to let LLM decide
      return {
        role: "tool",
        content: JSON.stringify(results),
        toolCallId: primaryCall.id
      };

    } catch (fallbackError) {
      results.fallbacks.push({
        tool: fallbackTool,
        status: "error",
        message: fallbackError.message
      });
    }
  }

  // All fallbacks failed
  throw new Error(`All tools failed. Primary: ${primaryError.message}. Fallbacks: ${JSON.stringify(results.fallbacks)}`);
}

_mapArgumentsForFallback(primaryTool, fallbackTool, primaryArgs) {
  // Define argument mappings between tools
  const mappings = {
    'web_search': {
      'knowledge_graph': (args) => ({
        query: args.query,
        max_results: args.max_results || 3
      }),
      'web_search_fallback': (args) => ({...args}) // 1:1 mapping
    },
    // Other tool mappings...
  };

  if (mappings[primaryTool]?.[fallbackTool]) {
    return mappings[primaryTool][fallbackTool](primaryArgs);
  }

  // Default: pass through all arguments that match
  const fallbackArgs = {};
  for (const [key, value] of Object.entries(primaryArgs)) {
    fallbackArgs[key] = value;
  }
  return fallbackArgs;
}
```

## Phase 3: Observability and Optimization (1-2 Weeks)

### 1. Structured JSON Logging with Circuit Breaker Integration
```javascript
// In Agent.js
constructor(config) {
  // ...
  this.logger = config.logger || new JsonLogger();
  // ...
}

async execute(history, userInput, options = {}) {
  const sessionId = this.sessionId;
  const executionId = `exec_${Date.now()}`;
  const startTime = Date.now();

  this.logger.log({
    level: 'info',
    event: 'execution_start',
    sessionId,
    executionId,
    inputLength: userInput.length,
    tokenCount: this.countMessageTokens([...history, { role: "user", content: userInput }]),
    processingMode: this.processingMode,
    circuitBreakerStatus: this.circuitBreaker.getStatus()
  });

  try {
    const result = await super.execute(history, userInput, options);

    this.logger.log({
      level: 'info',
      event: 'execution_end',
      sessionId,
      executionId,
      durationMs: Date.now() - startTime,
      rounds: result.rounds,
      status: result.status,
      finalTokenCount: this.countMessageTokens(result.fullMessages),
      circuitBreakerStatus: this.circuitBreaker.getStatus()
    });

    return result;
  } catch (error) {
    this.logger.log({
      level: 'error',
      event: 'execution_error',
      sessionId,
      executionId,
      error: error.message,
      stack: error.stack?.substring(0, 500),
      durationMs: Date.now() - startTime,
      circuitBreakerStatus: this.circuitBreaker.getStatus()
    });
    throw error;
  }
}

// Simple JSON Logger implementation
class JsonLogger {
  log(data) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      ...data
    }));
  }
}
```

### 2. Optimized State Reflection Frequency
```javascript
// In ResponseProcessor.js
async processResponse(response, messages, config = {}) {
  let currentResponse = response;
  let currentMessages = [...messages];
  let round = 1;
  const maxRounds = config.maxRounds || 10;
  const reflectionFrequency = config.reflectionFrequency || 3;

  while (round <= maxRounds) {
    // ... existing round processing ...

    // Generate and inject reflection at configured frequency
    if (round % reflectionFrequency === 0) {
      const updatedSystemPrompt = await this.agent._generateAndInjectStateReflection(round);
      currentMessages = this._updateSystemPrompt(currentMessages, updatedSystemPrompt);
    }

    // ... rest of round processing ...
    round++;
  }
}

_updateSystemPrompt(messages, newSystemPrompt) {
  const systemIndex = messages.findIndex(m => m.role === 'system');
  if (systemIndex >= 0) {
    messages[systemIndex] = { role: 'system', content: newSystemPrompt };
  } else {
    messages.unshift({ role: 'system', content: newSystemPrompt });
  }
  return messages;
}
```

## Implementation Roadmap with Dependencies

| Phase | Task | Depends On | Estimated Time |
|-------|------|------------|-----------------|
| 1 | Fix logic bugs in context management | - | 1 day |
| 1 | Implement processing modes | - | 2 days |
| 1 | Add tool timeouts | - | 1 day |
| 1 | Schema-based validation | - | 2 days |
| 1 | Token-aware truncation | - | 3 days |
| 2 | State reflection with injection | Processing modes | 3 days |
| 2 | Hallucination detection | Schema validation | 2 days |
| 2 | Fallback chains | Timeouts, Circuit Breaker | 3 days |
| 3 | Structured logging | All previous | 2 days |
| 3 | Reflection frequency control | State reflection | 1 day |

## Key Design Principles Applied

1. **Defensive Programming**: All new features include proper error handling and fallbacks
2. **Separation of Concerns**: Validation, logging, and execution are cleanly separated
3. **Configurability**: All new behaviors can be enabled/disabled via configuration
4. **Observability**: Critical operations generate structured logs
5. **Performance Awareness**: Expensive operations (like reflection) are optimized
6. **Backward Compatibility**: Existing code continues to work without modification
7. **Progressive Enhancement**: Features can be added incrementally

## Evaluation Metrics

1. **Reliability**:
   - Task completion rate (especially with fallbacks)
   - Reduction in hallucinated progress updates
   - Circuit breaker trip rate

2. **Performance**:
   - Response time distribution across processing modes
   - Token usage efficiency
   - Cache hit rate for tool results

3. **State Integrity**:
   - Accuracy of progress tracking
   - Recovery from interruptions
   - Consistency across session restarts

4. **Observability**:
   - Log completeness and usefulness
   - Debugging time for failed executions
   - Visibility into tool performance

This consolidated plan incorporates all critical feedback while maintaining focus on the most impactful improvements. The implementation is designed to be incremental, with each phase delivering tangible benefits.