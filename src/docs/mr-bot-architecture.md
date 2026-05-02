# 🏗️ MR-BOT Architecture Overview

This document provides a detailed technical overview of the MR-BOT system.

---

## 📁 Current Project Structure

```
mr-bot/
├── package.json
├── telegram-bot.js
└── src/
    ├── Agent.js                # Core agent logic and execution
    ├── CircuitBreaker.js       # Safety mechanism for tool failures
    ├── Dockerfile              # Container configuration
    ├── LoopDetector.js         # Prevents infinite loops in tool calls
    ├── ResponseProcessor.js    # Handles LLM responses and tool execution
    ├── StreamingResponseProcessor.js  # Processes streaming responses
    ├── Tokenizer.js            # Token counting utilities
    ├── ToolExecutionManager.js # Manages tool execution workflows
    ├── ToolManager.js          # Core tool management system
    ├── config/                 # Configuration files
    ├── docs/                   # Documentation
    ├── models/                 # Data models
    ├── schemas/                # JSON schemas
    ├── scripts/                # Utility scripts
    ├── services/               # Service implementations
    ├── storage/                # Storage backends
    └── tools/                  # Tool implementations
```

---

## 🔧 Core Components

### `Agent.js` – Reasoning Orchestrator

The central component that manages the agent's execution flow:

- **Key Methods**:
  - `execute()`: Main execution method for processing user input
  - `executeStream()`: Handles streaming responses
  - `_injectProgressTrackingProtocol()`: Adds progress tracking to system prompts
  - `updateProgress()`: Updates and validates task progress

- **Features**:
  - EventEmitter-based architecture for observability
  - Progress state management with validation
  - Storage integration for session persistence
  - Token counting and context management

### `CircuitBreaker.js` – Safety Mechanism

Prevents cascading failures when tools become unreliable:

- **Key Methods**:
  - `shouldAllowCall()`: Determines if a tool call is permitted
  - `recordSuccess()`/`recordFailure()`: Track tool execution outcomes
  - `getState()`: Check current state of a tool's circuit
  - `_tripCircuit()`: Open circuit when failure threshold is reached

- **States**:
  - `CLOSED`: Normal operation
  - `OPEN`: Tool calls fail fast
  - `HALF_OPEN`: Limited test calls to assess recovery

### `LoopDetector.js` – Infinite Loop Prevention

Detects and prevents repetitive tool call patterns:

- **Key Methods**:
  - `detectToolCallLoop()`: Identifies loop patterns in tool calls
  - `updateRecentToolCalls()`: Maintains history of recent tool calls
  - `_detectComplexLoop()`: Advanced pattern matching for complex loops

### `ToolManager.js` & `ToolExecutionManager.js` – Tool Execution System

Manages the registration, execution, and monitoring of tools:

- **Key Features**:
  - Parallel and sequential tool execution
  - Automatic retry logic with exponential backoff
  - Progress tracking injection
  - Semantic loop detection
  - Mermaid diagram generation for visualization

- **Execution Flow**:
  1. Tool registration with configuration
  2. Validation of tool calls
  3. Circuit breaker checks
  4. Actual tool execution
  5. Result processing and progress updating

### `ResponseProcessor.js` & `StreamingResponseProcessor.js` – Response Handling

Processes LLM responses and manages tool execution:

- **Key Responsibilities**:
  - Response validation against JSON schemas
  - Tool call execution with safety checks
  - Context management and token counting
  - Progress state updates
  - Streaming response handling

- **Safety Features**:
  - Token limit enforcement
  - Tool failure handling
  - Context truncation when approaching limits

### `Tokenizer.js` – Token Management Utilities

Provides token counting functionality:

- **Key Functions**:
  - `countTokens()`: Counts tokens in text
  - `countMessageTokens()`: Counts tokens in message arrays
  - `getTokenizerEncoding()`: Gets the tokenizer encoding

---

## 🔄 Data Flow: One Execution Cycle

```mermaid
graph TD
    A[User Input] --> B[Agent.execute()]
    B --> C[ResponseProcessor.processResponse()]
    C --> D{Tool Calls?}
    D -->|Yes| E[ToolManager.executeToolCalls()]
    D -->|No| F[Return Final Response]
    E --> G[CircuitBreaker.check()]
    G --> H[LoopDetector.check()]
    H --> I[Actual Tool Execution]
    I --> J[Update Progress State]
    J --> K[Context Management]
    K --> C
```

1. **Input Processing**: User input is received by the Agent
2. **Response Processing**: LLM response is validated and parsed
3. **Tool Execution**: If tools are requested:
   - Circuit breaker checks tool availability
   - Loop detector checks for repetitive patterns
   - Tools are executed (parallel or sequential)
4. **State Update**: Progress state is updated with results
5. **Context Management**: Context is trimmed if approaching token limits
6. **Iteration**: Cycle repeats until final response or termination

---

## 🛡️ Safety Mechanisms

### Circuit Breaker Configuration

```javascript
// Example configuration
const circuitBreakerConfig = {
  failureThreshold: 3,      // Open circuit after 3 failures
  resetTimeoutMs: 60000,    // Wait 60 seconds before retry
  halfOpenMaxCalls: 1,       // Test with 1 call in half-open state
  globalThreshold: 5,       // Global failure threshold
  globalResetTimeoutMs: 300000 // 5 minutes for global reset
};
```

### Loop Detection Configuration

```javascript
// Example configuration
const loopDetectionConfig = {
  enabled: true,
  maxIdenticalSteps: 3,      // Trigger after 3 identical actions
  lookbackWindow: 5,         // Compare last 5 steps
  similarityThreshold: 0.9  // Similarity score for pattern matching
};
```

### Token Management

```javascript
// Token counting example
const tokenCount = countMessageTokens(messages);
if (tokenCount > maxContextTokens) {
  // Truncate context using progressive strategy
  messages = contextManager.truncate({
    strategy: 'progressive',
    preserve: ['systemPrompt', 'lastUserMessage', 'progressState'],
    maxTokens: maxContextTokens
  });
}
```

---

## 🔌 Tool Execution Workflow

1. **Registration**: Tools are registered with configuration
   ```javascript
   toolManager.register('webSearch', {
     handler: searchHandler,
     parallel: true,
     retries: 2,
     injectTaskProgress: true
   });
   ```

2. **Execution**: Tools are executed with safety checks
   ```javascript
   const results = await toolManager.executeToolCalls(
     toolCalls,
     actionsTaken,
     userInput,
     parallelToolCalls,
     abortSignal
   );
   ```

3. **Error Handling**: Failures are managed with retry logic
   ```javascript
   if (error) {
     await this._handleToolError(
       error,
       toolCall,
       actionsTaken,
       userInput,
       retryCount,
       startTime,
       abortSignal
     );
   }
   ```

4. **Progress Tracking**: Results update the task progress
   ```javascript
   this._processTaskProgress(
     toolCall.taskProgress,
     toolCall.name,
     toolCall.args
   );
   ```

---

## 📊 Key Design Patterns

| Pattern | Implementation | Benefit |
|---------|---------------|---------|
| **EventEmitter** | Used throughout for observability events | Loose coupling, real-time monitoring |
| **Strategy** | Swappable storage backends | Deployment flexibility |
| **Circuit Breaker** | `CircuitBreaker` class | Prevents cascading failures |
| **Observer** | Progress listeners | Debugging, analytics, UI updates |
| **Dependency Injection** | Components receive dependencies | Testability, modularity |
| **Template Method** | Execution workflows | Consistent process with customizable steps |

---

## 🔧 Configuration Example

```json
{
  "agent": {
    "maxRounds": 15,
    "contextLimitTokens": 32000,
    "progressTracking": {
      "enabled": true,
      "validation": "strict"
    }
  },
  "safety": {
    "circuitBreaker": {
      "failureThreshold": 3,
      "resetTimeoutMs": 60000,
      "globalThreshold": 5
    },
    "loopDetection": {
      "enabled": true,
      "maxIdenticalSteps": 3,
      "lookbackWindow": 5
    }
  },
  "storage": {
    "type": "memory",
    "options": {
      "maxHistoryLength": 100
    }
  },
  "observability": {
    "logLevel": "info",
    "emitProgressEvents": true,
    "emitToolEvents": true
  }
}
```

---
## 📚 Key Documentation Files

| File | Purpose |
|------|---------|
| [`docs/mr-bot-architecture.md`](mr-bot-architecture.md) | **This document** - System components, data flow, design patterns |
| [`src/Agent.js`](../Agent.js) | Core agent implementation |
| [`src/ToolManager.js`](../ToolManager.js) | Tool management system |
| [`src/CircuitBreaker.js`](../CircuitBreaker.js) | Circuit breaker implementation |
| [`src/LoopDetector.js`](../LoopDetector.js) | Loop detection logic |

---
## � Troubleshooting Common Issues

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| Tool calls never execute | Circuit breaker is OPEN | Check `CircuitBreaker.getState(toolName)`; wait for reset or reduce `failureThreshold` |
| Agent stops after N rounds | `maxRounds` limit reached | Increase `agent.maxRounds` or optimize task decomposition |
| "Context limit exceeded" error | Token count miscalculation | Verify `Tokenizer.countMessageTokens()` is called before each LLM call |
| Loop detected prematurely | `lookbackWindow` too small | Increase `loopDetection.lookbackWindow` to 7-10 for complex tasks |
| Progress not persisting | Using `MemoryStorage` in production | Switch to `MongoDBStorage` or `JSONStorage` for persistence |

---
## 🚀 Getting Started with Development

### Prerequisites
- Node.js ≥ 18
- Basic understanding of LLM agent architectures

### Key Commands
```bash
# Install dependencies
npm install

# Run tests
npm test

# Start the agent
node telegram-bot.js
```

---
## � Monitoring in Production

Monitor MR-BOT in production environments using these event subscriptions:

```javascript
// Production monitoring example
agent.on('circuitBreaker:open', ({ tool, failureCount }) => {
  metrics.increment('circuit_breaker.opened', { tool });
  alerts.send(`Circuit opened for ${tool} after ${failureCount} failures`);
});

agent.on('loop:detected', ({ pattern, steps }) => {
  logger.warn(`Loop detected: ${pattern} repeated ${steps} times`);
  // Optional: trigger auto-remediation
});

agent.on('context:truncated', ({ strategy, tokensRemoved }) => {
  metrics.histogram('context.truncation.tokens', tokensRemoved, { strategy });
});
```

### Development Tips
1. **Observability**: Subscribe to agent events for debugging:
   ```javascript
   agent.on('tool:start', (toolCall) => console.log('Tool started:', toolCall.name));
   agent.on('progress:updated', (progress) => console.log('Progress:', progress));
   ```

2. **Testing**: Focus on:
   - Circuit breaker state transitions
   - Loop detection scenarios
   - Token management edge cases

3. **Extending**: To add new tools:
   ```javascript
   // Register a new tool
   toolManager.register('newTool', {
     handler: async (args) => { /* implementation */ },
     description: 'Tool description for LLM',
     schema: { /* JSON schema for arguments */ }
   });
   ```

---
## ⚠️ Current Limitations

1. **Storage**: Currently uses in-memory storage by default (see `storage/` directory for backend implementations)
2. **Configuration**: Configuration is primarily code-based (consider adding a config file loader)
3. **Telegram Integration**: Main entry point is `telegram-bot.js` (may need adaptation for other platforms)
4. **Error Handling**: Some error cases could benefit from more specific error types

---
## � Future Enhancements

1. **Configuration System**: External config file support (JSON/YAML)
2. **Additional Storage Backends**: Implement MongoDB, PostgreSQL, etc.
3. **Enhanced Observability**: More detailed metrics and tracing
4. **Plugin System**: Dynamic tool loading
5. **Multi-agent Coordination**: Support for agent teams

---
## 📝 Changelog (Current Version)

### Recent Improvements
- Enhanced circuit breaker with global state tracking
- Added semantic loop detection in ToolExecutionManager
- Improved token counting accuracy
- Added streaming response support
- Better progress state validation

### Known Issues
- Loop detection could be enhanced with more sophisticated pattern matching
- Circuit breaker metrics could be more detailed
- Storage layer could benefit from more comprehensive test coverage

---
## 🤝 Contributing

To contribute to MR-BOT:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Implement your changes with appropriate tests
4. Update documentation as needed
5. Submit a pull request with a clear description

Focus areas for contributions:
- Additional storage backends
- Enhanced safety mechanisms
- New tool integrations
- Improved observability
- Configuration system