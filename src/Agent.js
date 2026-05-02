import { Mistral } from "@mistralai/mistralai";
import Thought from './models/Thought.js';
import Session from './models/Session.js';
import { EventEmitter } from "events";
import { CircuitBreaker } from "./CircuitBreaker.js";
import { LoopDetector } from "./LoopDetector.js";
import { ResponseProcessor } from "./ResponseProcessor.js";
import { ToolManager } from "./ToolManager.js";
import { StreamingResponseProcessor } from "./StreamingResponseProcessor.js";
import { ToolExecutionManager } from "./ToolExecutionManager.js";
import { StorageManager } from "./storage/StorageManager.js";

/**
 * Simplified Agent class - Core functionality for interacting with Mistral API
 * Supports two execution modes: Streaming and Non-Streaming
 */
export class Agent extends EventEmitter {
  /**
   * Creates a new Agent instance with Circuit Breaker integration
   * @param {Object} config - Configuration object
   * @param {string} config.apiKey - Mistral API key
   * @param {string} [config.model="mistral-medium-2505"] - Model to use
   * @param {number} [config.temperature=0.5] - Temperature for response generation
   * @param {string} config.systemPrompt - System instructions for the agent
   * @param {Array} [config.tools=[]] - Array of tool definitions
   * @param {boolean} [config.parallelToolCalls=true] - Execute multiple tool calls concurrently using Promise.all()
   * @param {Object} [config.loopDetection] - Loop detection configuration with Circuit Breaker settings
   * @param {string} [config.sessionId] - Optional session ID for chat history management
   */
  constructor(config) {
    super(); // Initialize EventEmitter

    // Basic validation
    if (!config.apiKey) throw new Error("apiKey is required");
    if (!config.systemPrompt) throw new Error("systemPrompt is required");
    
    // Store session ID for chat history management
    this.sessionId = config.sessionId || this._generateSessionId();

    this.client = new Mistral({
      apiKey: config.apiKey,
      retryConfig: {
        strategy: "backoff",
        backoff: {
          initialInterval: 1000,
          maxInterval: 16000,
          exponent: 2,
          maxElapsedTime: 60000,
        },
        retryConnectionErrors: true,
      },
    });

this.model = config.model || "mistral-medium-2505";
    this.temperature = config.temperature !== undefined ? config.temperature : 0.5;
this.tools = config.tools || [];
this.systemPrompt = (config.tools && config.tools.length > 0)
  ? this._injectProgressTrackingProtocol(config.systemPrompt)
  : config.systemPrompt;
    this.parallelToolCalls = config.parallelToolCalls !== false; // default true

    // Simple tool handlers - more robust mapping that handles missing properties
    this.handlers = Object.fromEntries(
      this.tools
        .filter(t => t.function && t.handler)
        .map(t => [t.function.name, t.handler])
    );

    // Clone and modify tool definitions to include taskProgress parameter
    this.apiTools = this._enhanceToolsWithProgress(this.tools);

    // Initialize Circuit Breaker with loop detection configuration
    const loopConfig = config.loopDetection || {};
    this.circuitBreaker = new CircuitBreaker({
      maxRecentCalls: loopConfig.maxRecentCalls || 3,
      loopThreshold: loopConfig.loopThreshold || 2,
      enablePatternDetection: loopConfig.enablePatternDetection !== false,
      cooldownPeriod: loopConfig.cooldownPeriod || 30000,        // 30 seconds default
      globalTripThreshold: loopConfig.globalTripThreshold || 5,  // Global circuit trips after 5 failures
      heatDecayRate: loopConfig.heatDecayRate || 0.1,             // Heat decays 0.1 per second
      maxHeat: loopConfig.maxHeat || 10,                          // Maximum heat before tripping
      halfOpenAttempts: loopConfig.halfOpenAttempts || 1,         // Number of test attempts in HALF-OPEN
      enabled: loopConfig.circuitBreaker?.enabled !== false       // Circuit breaker enabled by default
    });

    // Initialize ToolManager with enhanced capabilities
    this.toolManager = new ToolManager();
    this.toolManager.initializeTools(this.tools);
    this.toolManager.setAgent(this);
    this.toolManager.setDebug(config.debug || false);
    this.toolManager.setEnableEvents(config.enableEvents || false);
    this.debug = config.debug || false;

    // Composed modules
    this.loopDetector = new LoopDetector({
      maxRecentCalls: loopConfig.maxRecentCalls || 3,
      loopThreshold: loopConfig.loopThreshold || 2,
      enablePatternDetection: loopConfig.enablePatternDetection !== false
    });
    this.responseProcessor = new ResponseProcessor(this);

    // Strict JSON schema reused by execute(), executeStream(), and every continuation round
    this.responseFormat = {
      type: "json_schema",
      jsonSchema: {
        name: "agent_response",
        strict: true,
        schemaDefinition: {
          type: "object",
          properties: {
            final_reply: { type: "string" },
            requested_tools: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  tool: { type: "string" },
                  arguments: { type: "object" }
                },
                required: ["tool", "arguments"],
                additionalProperties: false
              }
            }
          },
          required: ["final_reply", "requested_tools"],
          additionalProperties: false
        }
      }
    };

    // Set up event listeners for circuit breaker events
    this._setupCircuitBreakerEvents();

    // Set up ToolManager event forwarding
    this._setupToolManagerEvents();

    // Progress tracking state - Map-based for atomic merging
    this.progressState = new Map(); // task description -> boolean (completed)
    this.progressHistory = [];

    // Initialize storage manager if storage type is specified
    this.storageManager = null;
    this.storageType = config.storageType;
    if (this.storageType) {
      this.storageManager = new StorageManager();
      // Note: We don't await initialization here to keep constructor synchronous
      // Storage will be initialized lazily on first use
    }
  }

   /**
    * Automatically inject Progress Tracking Protocol instructions into system prompt
    * @param {string} systemPrompt - Original system prompt
    * @returns {string} - System prompt with progress tracking instructions
    * @private
    */
   _injectProgressTrackingProtocol(systemPrompt) {
     const progressProtocol = `

## Thought Recording Protocol

**CRITICAL INSTRUCTION:** Internal reasoning fields have been removed from your output schema.
To process any request, you MUST first use the \`recordThought\` tool to commit your reasoning to the system logs.
You cannot provide a response until your thoughts have been recorded via the tool.

  **Instructions:**
1. **Mandatory Thought Recording**: Before generating any response, you MUST use the \`recordThought\` tool to externalize your reasoning process.
2. **Structured Reasoning**: The \`recordThought\` tool requires structured input including:
   - Current reasoning step
   - Hypothesis about the user's goal
   - Plan of action with tools to be used
   - Any uncertainties or alternatives considered
   - **Conversation Context (Optional)**: Include relevant context from the conversation history in the 'context' field when available and relevant
3. **Progress Tracking**: Use the \`taskProgress\` parameter in ALL tool calls to track your progress.

## Progress Tracking Protocol

You MUST use the \`taskProgress\` parameter in ALL tool calls to track your progress. This is critical for maintaining state visibility.

**Instructions:**
1. **Always Update Progress**: Every tool call MUST include a \`taskProgress\` parameter with the current state of your task checklist
2. **Complete State**: The \`taskProgress\` parameter should contain the COMPLETE current progress state, not just what changed
3. **Markdown Format**: Use strict markdown checklist format:
   - Incomplete tasks: \`- [ ] Task description\`
   - Completed tasks: \`- [x] Task description\`
4. **Task Management**:
   - Add new tasks as you discover them
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Completed status is STICKY - once marked complete, it stays complete
5. **Parallel Execution**: If multiple tools run concurrently, ensure all progress updates are merged atomically
6. **Intent Capture**: Record your progress intent as soon as you decide to use a tool, even before execution

**Example:**
\`\`\`
{
  "tool": "recordThought",
  "arguments": {
    "step": "Pre-tool reasoning",
    "hypothesis": "User wants to research AI developments",
    "plan": ["Search for latest AI developments", "Analyze findings"],
    "uncertainties": ["What timeframe is relevant?"]
  }
}
\`\`\`

**Failure to follow these protocols will result in lost progress state and task failure.**
`;

     return systemPrompt + progressProtocol;
   }

  /**
   * Set up event listeners for circuit breaker events
   * @private
   */
  _setupCircuitBreakerEvents() {
    // Listen for circuit breaker events and forward them with agent context
    this.circuitBreaker.on('circuit-break', (data) => {
      console.warn(`⚠️ Circuit breaker tripped for tool: ${data.tool}`);
      console.warn(`   Reason: ${data.reason}`);
      console.warn(`   Cooldown remaining: ${data.cooldownRemaining}ms`);
      this.emit('circuit-break', data);
    });

    this.circuitBreaker.on('circuit-recover', (data) => {
      console.log(`✅ Circuit breaker recovered for tool: ${data.tool}`);
      console.log(`   State: ${data.state}`);
      this.emit('circuit-recover', data);
    });

    this.circuitBreaker.on('circuit-half-open', (data) => {
      console.log(`🔄 Circuit breaker testing tool: ${data.tool}`);
      console.log(`   Attempt #${data.attemptNumber}`);
      this.emit('circuit-half-open', data);
    });

    this.circuitBreaker.on('circuit-failure', (data) => {
      console.log(`❌ Circuit failure for tool: ${data.tool}`);
      console.log(`   Reason: ${data.reason}`);
      console.log(`   Heat: ${data.heat}, Failures: ${data.failures}`);
      this.emit('circuit-failure', data);
    });

    this.circuitBreaker.on('global-circuit-break', (data) => {
      console.warn(`🌐 Global circuit breaker tripped!`);
      console.warn(`   Reason: ${data.reason}`);
      console.warn(`   Failures: ${data.failures}`);
      this.emit('global-circuit-break', data);
    });

    this.circuitBreaker.on('global-circuit-recover', (data) => {
      console.log(`🌐 Global circuit breaker recovered!`);
      console.log(`   Reason: ${data.reason}`);
      this.emit('global-circuit-recover', data);
    });

    // Listen for progress-related circuit breaker events
    this.circuitBreaker.on('circuit-break', (data) => {
      if (data.tool === 'progress-update') {
        console.warn(`⚠️ Progress update circuit breaker tripped!`);
        console.warn(`   Reason: ${data.reason}`);
        console.warn(`   Cooldown remaining: ${data.cooldownRemaining}ms`);
        this.emit('progress-circuit-break', data);
      }
    });
  }

  /**
   * Set up ToolManager event forwarding
   * @private
   */
  _setupToolManagerEvents() {
    // Forward ToolManager events to Agent listeners
    const eventForwarders = {
      'tool-start': (data) => this.emit('tool-start', data),
      'tool-end': (data) => this.emit('tool-end', data),
      'tool-metrics': (data) => this.emit('tool-metrics', data),
      'task-progress': (data) => this.emit('task-progress', data),
      'loop-detected': (data) => this.emit('loop-detected', data),
    };

    // Only forward events if enableEvents is true
    if (this.toolManager.enableEvents) {
      this.toolManager.on('tool-start', eventForwarders['tool-start']);
      this.toolManager.on('tool-end', eventForwarders['tool-end']);
      this.toolManager.on('tool-metrics', eventForwarders['tool-metrics']);
      this.toolManager.on('task-progress', eventForwarders['task-progress']);
      this.toolManager.on('loop-detected', eventForwarders['loop-detected']);
    }
  }

  /**
   * Execute a non-streaming request with tool management and intent capture
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @returns {Promise<{response: string, fullMessages: Array}>} - Agent's response and full conversation
   */
   async execute(history, userInput) {
     const messages = [
       { role: "system", content: this.systemPrompt },
       ...(history || []),
       { role: "user", content: userInput }
     ];

     // Round 1: force recordThought via toolChoice; defer responseFormat until round 2+
     const forceRecordThought = !!this.handlers?.recordThought;
     const response = await this.client.chat.complete({
       model: this.model,
       messages: messages,
       ...(this.tools.length > 0 && { tools: this.toolManager.getApiTools() }),
       ...(forceRecordThought
         ? { toolChoice: { type: "function", function: { name: "recordThought" } } }
         : { responseFormat: this.responseFormat })
     });

     // 🚀 DEVELOPMENT LOGGING: Show current progress state before processing response
     if (this.debug && this.progressState.size > 0) {
       const currentProgress = this._mapToProgressString(this.progressState);
       console.log('📊 [PROGRESS] Current state before response processing:', currentProgress);
     }

     return this.responseProcessor.processResponse(response, messages);
   }

  /**
   * Execute a streaming request with tool management
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @param {Function} [onChunk] - Optional callback for each text token
   * @returns {Promise<{response: string, fullMessages: Array}>} - Agent's response and full conversation
   */
   async executeStream(history, userInput, onChunk) {
    // Initialize enhanced components if not already done
    if (!this.streamingProcessor) {
      this.streamingProcessor = new StreamingResponseProcessor(this);
    }

    if (!this.toolExecutionManager) {
      this.toolExecutionManager = new ToolExecutionManager();
      this.toolExecutionManager.initialize(this);
    }

    const messages = [
      { role: "system", content: this.systemPrompt },
      ...(history || []),
      { role: "user", content: userInput }
    ];

    // Round 1: force recordThought via toolChoice; defer responseFormat until round 2+
    const forceRecordThought = !!this.handlers?.recordThought;
    const stream = await this.client.chat.stream({
      model: this.model,
      messages: messages,
      ...(this.tools.length > 0 && { tools: this.toolManager.getApiTools() }),
      ...(forceRecordThought
        ? { toolChoice: { type: "function", function: { name: "recordThought" } } }
        : { responseFormat: this.responseFormat })
    });

    // Process the stream and handle the structured response
    let result;
    try {
      result = await this.streamingProcessor.processStreamResponse(stream, messages, onChunk);
    } catch (error) {
      console.error("Failed to process stream response:", error);
      return { response: "An error occurred while processing the response." };
    }

    // Ensure result is valid and has a response property
    if (!result || !result.response) {
      console.error("Invalid result from processStreamResponse:", result);
      return { response: "An error occurred while processing the response." };
    }

    return result;
  }


  /**
   * Enhance tool definitions to include taskProgress parameter and generate proper Mistral format
   * @param {Array} tools - Original tool definitions
   * @returns {Array} - Enhanced tool definitions with taskProgress parameter in Mistral format
   * @private
   */
  _enhanceToolsWithProgress(tools) {
    return tools.map(({ handler, function: toolFunction, ...tool }) => {
      // Clone the tool function to avoid modifying the original
      const modifiedToolFunction = { ...toolFunction };

      // If parameters are defined, add taskProgress as an optional parameter
      if (modifiedToolFunction.parameters) {
        // Clone the parameters to avoid modifying the original tool definition
        const modifiedParameters = { ...modifiedToolFunction.parameters };

        // Add taskProgress as an optional property if not already present
        if (!modifiedParameters.properties) {
          modifiedParameters.properties = {};
        }
        if (!modifiedParameters.properties.taskProgress) {
          // Build current state hint for tool parameter description
          const currentStateHint = this._getCurrentStateHint();

          modifiedParameters.properties.taskProgress = {
            type: "string",
            description: "Markdown-formatted checklist to track task progress. " +
                         "Each line should be a checklist item (e.g., '- [ ] Step 1'). " +
                         "This parameter is optional and can be included in any tool call. " +
                         "Updates should include the complete current progress state. " +
                         "Use '- [ ]' for incomplete items and '- [x]' for completed items. " +
                         currentStateHint,
            pattern: "^(\\s*(- \\[(x| )\\] .*)\\n?)*"
          };
        }

        // Ensure taskProgress is not in the required array
        if (modifiedParameters.required) {
          modifiedParameters.required = modifiedParameters.required.filter(
            (param) => param !== "taskProgress"
          );
        }

        modifiedToolFunction.parameters = modifiedParameters;
      }

      // Return in proper Mistral format: { type: "function", function: { ... } }
      return {
        type: "function",
        function: modifiedToolFunction
      };
    });
  }

  /**
   * Get current state hint for tool parameter description
   * @returns {string} - Current state hint for tool parameter description
   * @private
   */
  _getCurrentStateHint() {
    // Ensure progressState is initialized
    if (!this.progressState || this.progressState.size === 0) {
      return "Current state: No tasks tracked yet.";
    }

    const completedTasks = Array.from(this.progressState.entries())
      .filter(([_, isCompleted]) => isCompleted)
      .map(([taskKey]) => taskKey);

    const incompleteTasks = Array.from(this.progressState.entries())
      .filter(([_, isCompleted]) => !isCompleted)
      .map(([taskKey]) => taskKey);

    let hint = "Current state: ";

    if (completedTasks.length > 0) {
      hint += `Completed: ${completedTasks.length} task(s). `;
    }

    if (incompleteTasks.length > 0) {
      hint += `Incomplete: ${incompleteTasks.length} task(s). `;
    }

    hint += "Maintain consistency with this state in your progress updates.";

    return hint;
  }

  /**
   * Capture progress intent from tool calls before execution (state recovery)
   * @param {Object} response - LLM response containing tool calls
   * @private
   */
  _captureProgressIntent(response) {
    try {
      // Extract tool calls from response
      const toolCalls = response?.choices?.[0]?.message?.toolCalls || [];

      if (toolCalls.length === 0) return;

      // Collect all progress updates from tool calls
      const progressUpdates = [];

      for (const toolCall of toolCalls) {
        const argumentsStr = toolCall.function?.arguments;
        if (!argumentsStr) continue;

        try {
          const args = JSON.parse(argumentsStr);
          if (args.taskProgress) {
            progressUpdates.push(args.taskProgress);
          }
        } catch (parseError) {
          console.warn('Failed to parse tool call arguments:', parseError);
        }
      }

      // If we have progress updates, merge them atomically
      if (progressUpdates.length > 0) {
        const progressStates = progressUpdates.map(progress => this._parseProgressToMap(progress));
        const mergedState = this._mergeProgressStates(progressStates);

        // Update state even if tools fail (state recovery)
        this.progressState = mergedState;

        // Convert back to markdown and record
        const mergedProgressString = this._mapToProgressString(this.progressState);

        this.progressHistory.push({
          progress: mergedProgressString,
          timestamp: Date.now(),
          toolCall: 'intent-capture',
          status: 'captured',
          state: new Map(this.progressState)
        });

        // Keep only last 15 progress updates
        if (this.progressHistory.length > 15) {
          this.progressHistory = this.progressHistory.slice(-15);
        }

        // 🚀 DEVELOPMENT LOGGING: Show progress intent capture
        if (this.debug) console.log('📊 [PROGRESS] Intent captured:', mergedProgressString);

        this.emit('progress-intent-captured', {
          progress: mergedProgressString,
          toolCalls: toolCalls.length,
          timestamp: Date.now(),
          state: new Map(this.progressState)
        });
      }
    } catch (error) {
      console.warn('Failed to capture progress intent:', error);
      // Still try to record the error for debugging
      this.emit('progress-intent-capture-failed', {
        error: error.message,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Convert Map-based progress state back to markdown format
   * @param {Map<string, boolean>} progressState - Progress state map
   * @returns {string} - Markdown formatted progress string
   * @private
   */
  _mapToProgressString(progressState) {
    const lines = [];

    // Sort by task description for consistent output
    const sortedEntries = Array.from(progressState.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (const [taskKey, isCompleted] of sortedEntries) {
      const status = isCompleted ? '[x]' : '[ ]';
      // Note: We store normalized keys, but we need to reconstruct the original task description
      // For now, we'll use the normalized key as the display text
      lines.push(`- ${status} ${taskKey}`);
    }

    return lines.join('\n');
  }

  /**
   * Get current progress
   * @returns {string} - Current progress in markdown format
   */
  getProgress() {
    return this.currentProgress;
  }

  /**
   * Get progress history
   * @returns {Array} - Array of progress updates with timestamps
   */
  getProgressHistory() {
    // Create a deep copy of the progress history to avoid reference issues
    return this.progressHistory.map(entry => ({
      progress: entry.progress,
      timestamp: entry.timestamp,
      toolCall: entry.toolCall,
      status: entry.status,
      // Create a new Map with the same entries to avoid reference issues
      state: entry.state ? new Map(entry.state) : new Map()
    }));
  }

  /**
   * Clear progress tracking
   */
  clearProgress() {
    this.currentProgress = "";
    this.progressHistory = [];
    this.progressState = new Map(); // Reset the progress state map
    this.emit('progress-cleared');
  }

  /**
   * Validate progress format with enhanced checking
   * @param {string} progress - Progress string to validate
   * @returns {boolean} - True if valid, false otherwise
   */
  validateProgressFormat(progress) {
    if (!progress || typeof progress !== 'string') {
      return false;
    }

    // Enhanced validation that handles multi-line progress updates
    // Each line should be a valid checklist item
    const lines = progress.split('\n');
    const checklistPattern = /^\s*-\s*\[\s*(x| )\s*\]\s*.+$/;

    return lines.every(line => {
      // Skip empty lines
      if (line.trim() === '') return true;
      return checklistPattern.test(line);
    });
  }

  /**
   * Update progress with enhanced validation and integration
   * @param {string} progress - Markdown checklist format progress update
   * @param {string} [toolCall] - Optional tool call that triggered this update
   * @param {string} [status] - Status of the update (success, failed, etc.)
   * @returns {boolean} - True if update was successful, false otherwise
   */
  updateProgress(progress, toolCall = null, status = 'success') {
    if (!this.validateProgressFormat(progress)) {
      console.warn('Invalid progress format. Expected markdown checklist format.');
      // Record progress update failure for circuit breaker
      if (this.circuitBreaker) {
        this.circuitBreaker.recordFailure('progress-update', 'Invalid progress format');
      }
      this.emit('progress-update-failed', {
        progress: progress,
        reason: 'Invalid progress format',
        timestamp: Date.now()
      });
      return false;
    }

    this.currentProgress = progress;
    this.progressHistory.push({
      progress: progress,
      timestamp: Date.now(),
      toolCall: toolCall,
      status: status
    });

    // Keep only last 15 progress updates
    if (this.progressHistory.length > 15) {
      this.progressHistory = this.progressHistory.slice(-15);
    }

    this.emit('progress-update', {
      progress: progress,
      toolCall: toolCall,
      status: status,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Initialize storage manager lazily on first use
   * @private
   */
  async _ensureStorageInitialized() {
    if (!this.storageManager) {
      throw new Error('Storage not configured. Pass storageType in Agent constructor.');
    }

    if (!this.storageManager.initialized) {
      await this.storageManager.initialize(this.storageType || 'no-memory', this.debug);

      // Set the session ID on the MongoDB storage if it's being used
      if (this.storageType === 'mongodb' || this.storageType === 'mongo') {
        this.storageManager.mongoStorage.setSessionId(this.sessionId);
      }
    }
  }

  /**
   * Generate a unique session ID
   * @returns {string} - Generated session ID
   * @private
   */
  _generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Load chat history from storage (lazy initialization)
   * @param {string} [sessionId] - Optional session ID, uses agent's sessionId if not provided
   * @returns {Promise<Array>} - Chat history messages
   */
  async loadHistory(sessionId) {
    const targetSessionId = sessionId || this.sessionId;
    if (!this.storageManager) {
      return [];
    }
    await this._ensureStorageInitialized();
    return await this.storageManager.loadHistory(targetSessionId);
  }

  /**
   * Save chat history to storage (lazy initialization)
   * @param {Array} messages - Messages to save
   * @param {string} [sessionId] - Optional session ID, uses agent's sessionId if not provided
   * @returns {Promise<void>}
   */
  async saveHistory(messages, sessionId) {
    const targetSessionId = sessionId || this.sessionId;
    if (!this.storageManager) {
      return;
    }
    await this._ensureStorageInitialized();
    const validMessages = (messages || []).filter(msg => msg && typeof msg.role === 'string');
    if (validMessages.length !== (messages || []).length) {
      console.warn('Filtered invalid messages before saving history.');
    }
    await this.storageManager.saveHistory(targetSessionId, validMessages);
  }

  /**
   * Clear chat history from storage (lazy initialization)
   * @param {string} [sessionId] - Optional session ID, uses agent's sessionId if not provided
   * @returns {Promise<void>}
   */
  async clearHistory(sessionId) {
    const targetSessionId = sessionId || this.sessionId;
    if (!this.storageManager) {
      return;
    }
    await this._ensureStorageInitialized();
    await this.storageManager.clearHistory(targetSessionId);
  }

  /**
   * Get storage statistics (lazy initialization)
   * @param {string} [sessionId] - Optional session ID, uses agent's sessionId if not provided
   * @returns {Promise<Object>} - Storage statistics
   */
  async getStorageStats(sessionId) {
    const targetSessionId = sessionId || this.sessionId;
    if (!this.storageManager) {
      return { type: 'none', initialized: false };
    }
    await this._ensureStorageInitialized();
    return await this.storageManager.getStats(targetSessionId);
  }

  /**
   * Get current storage status (lazy initialization)
   * @param {string} [sessionId] - Optional session ID, uses agent's sessionId if not provided
   * @returns {Promise<Object>} - Storage status
   */
  async getStorageStatus(sessionId) {
    const targetSessionId = sessionId || this.sessionId;
    if (!this.storageManager) {
      return { type: 'none', initialized: false };
    }
    await this._ensureStorageInitialized();
    return await this.storageManager.getStatus(targetSessionId);
  }

  /**
   * Count tokens in messages using a simple approximation
   * @param {Array} messages - Array of message objects
   * @returns {number} - Estimated token count
   */
  countMessageTokens(messages) {
    // Simple token approximation: ~4 characters per token for English text
    // This is a rough estimate - in production, you'd use js-tiktoken for accuracy
    let totalChars = 0;
    
    for (const message of messages) {
      if (message.content) {
        totalChars += message.content.length;
      }
      if (message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          if (toolCall.function?.arguments) {
            totalChars += toolCall.function.arguments.length;
          }
        }
      }
    }
    
    // Rough approximation: 4 characters per token
    return Math.ceil(totalChars / 4);
  }
}