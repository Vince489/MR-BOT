import { Mistral } from "@mistralai/mistralai";
import { EventEmitter } from "events";
import { CircuitBreaker } from "./CircuitBreaker.js";
import { LoopDetector } from "./LoopDetector.js";
import { ResponseProcessor } from "./ResponseProcessor.js";
import { ToolManager } from "./ToolManager.js";
import { StorageManager } from "./storage/StorageManager.js";

/**
 * Simplified Agent class - MVP version with Circuit Breaker Pattern
 * Core functionality for interacting with Mistral API with enhanced loop detection
 */
export class Agent extends EventEmitter {
  /**
   * Creates a new Agent instance with Circuit Breaker integration
   * @param {Object} config - Configuration object
   * @param {string} config.apiKey - Mistral API key
   * @param {string} [config.model="mistral-medium-2505"] - Model to use
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
  "tool": "searchWeb",
  "arguments": {
    "query": "latest AI developments",
    "taskProgress": "- [ ] Research AI developments\\n- [ ] Analyze findings\\n- [x] Define research scope"
  }
}
\`\`\`

**Failure to follow this protocol will result in lost progress state and task failure.**
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

    const response = await this.client.chat.complete({
      model: this.model,
      messages: messages,
      ...(this.tools.length > 0 && { tools: this.toolManager.getApiTools() })
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
   * Handles the recursive tool-calling loop to avoid message order errors
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @param {Function} [onChunk] - Optional callback for each text token
   * @returns {Promise<{response: string, fullMessages: Array}>} - Agent's response and full conversation
   */
  async executeStream(history, userInput, onChunk) {
    // 1. Prepare initial message state
    const messages = [
      { role: "system", content: this.systemPrompt },
      ...(history || []),
      { role: "user", content: userInput }
    ];

    let continueStreaming = true;
    let fullResponse = "";

    while (continueStreaming) {
      const stream = await this.client.chat.stream({
        model: this.model,
        messages: messages,
        ...(this.tools.length > 0 && { tools: this.toolManager.getApiTools() })
      });

      let assistantMessage = { role: "assistant", content: "", toolCalls: [] };
      const toolCallAccumulator = new Map();

      // Consume the stream
      for await (const chunk of stream) {
        const delta = chunk.data?.choices?.[0]?.delta || chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          assistantMessage.content += delta.content;
          if (onChunk) onChunk(delta.content);
          fullResponse += delta.content;
        }

        const streamingToolCalls = delta.toolCalls;
        if (streamingToolCalls) {
          for (const tc of streamingToolCalls) {
            const index = tc.index ?? 0;
            if (!toolCallAccumulator.has(index)) {
              toolCallAccumulator.set(index, { id: tc.id || "", function: { name: "", arguments: "" } });
            }
            const current = toolCallAccumulator.get(index);
            if (tc.id) current.id = tc.id;
            if (tc.function?.name) current.function.name += tc.function.name;
            if (tc.function?.arguments) current.function.arguments += tc.function.arguments;
          }
        }
      }

      // Finalize tool calls
      const toolCalls = Array.from(toolCallAccumulator.values()).map((tc, i) => ({
        id: tc.id || `call_${Date.now()}_${i}`,
        type: "function",
        function: {
          name: tc.function?.name || "",
          arguments: tc.function?.arguments || ""
        }
      }));

      if (toolCalls.length > 0) {
        // MANDATORY: Add the assistant's toolCall message to history BEFORE the tool results
        assistantMessage.toolCalls = toolCalls;
        // Keep tool-call assistant messages API-compliant
        assistantMessage.content = assistantMessage.content || "";
        messages.push(assistantMessage);

        // Capture progress intent (from existing logic)
        this._captureProgressIntent({ choices: [{ message: assistantMessage }] });

        // Execute tools using ToolManager
        const toolResults = [];
        for (const tc of toolCalls) {
          const result = await this.toolManager.executeToolCall(tc, [], userInput, 0, null);
          toolResults.push(result);
        }

        // Add the tool results to the history
        messages.push(...toolResults);

        // The loop will now repeat, sending the history (including tool results) back to Mistral
      } else {
        // No tool calls, we are finished
        if (assistantMessage.content) {
          messages.push({ role: "assistant", content: assistantMessage.content });
        }
        continueStreaming = false;
      }
    }

    return {
      response: fullResponse,
      fullMessages: messages
    };
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
   * Parse progress string into Map-based state with resilient parsing
   * @param {string} progress - Markdown checklist format progress update
   * @returns {Map<string, boolean>} - Parsed progress state
   * @private
   */
  _parseProgressToMap(progress) {
    const state = new Map();

    if (!progress || typeof progress !== 'string') {
      return state;
    }

    // Resilient line-by-line parsing that handles whitespace and casing variations
    const lines = progress.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip empty lines
      if (trimmedLine === '') continue;

      // Flexible regex that handles various whitespace and casing
      // Matches: - [x] Task description or - [ ] Task description
      const match = trimmedLine.match(/^\s*-\s*\[\s*([xX ])\s*\]\s*(.+)$/);

      if (match) {
        const isCompleted = match[1].toLowerCase() === 'x';
        const taskDescription = match[2].trim();

        if (taskDescription) {
          // Normalize task description for consistent key matching
          const normalizedKey = taskDescription.toLowerCase().trim();
          state.set(normalizedKey, isCompleted);
        }
      }
    }

    return state;
  }

  /**
   * Merge multiple progress states atomically (solves parallelism race condition)
   * Completed status is sticky - once a task is marked complete, it stays complete
   * @param {Array<Map<string, boolean>>} progressStates - Array of progress states from concurrent tool calls
   * @returns {Map<string, boolean>} - Merged progress state
   * @private
   */
  _mergeProgressStates(progressStates) {
    const mergedState = new Map();

    // Process all states to build the merged result
    for (const state of progressStates) {
      for (const [taskKey, isCompleted] of state.entries()) {
        // Atomic merge: if any state marks a task as completed, it stays completed
        const currentStatus = mergedState.get(taskKey);
        const newStatus = currentStatus || isCompleted; // Sticky completion
        mergedState.set(taskKey, newStatus);
      }
    }

    return mergedState;
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
    await this.storageManager.saveHistory(targetSessionId, messages);
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
}