import { Mistral } from "@mistralai/mistralai";
import { EventEmitter } from "events";
import { CircuitBreaker } from "./CircuitBreaker.js";
import { LoopDetector } from "./LoopDetector.js";
import { ResponseProcessor } from "./ResponseProcessor.js";
import { ToolManager } from "./ToolManager.js";
import { StreamingResponseProcessor } from "./StreamingResponseProcessor.js";
import { ToolExecutionManager } from "./ToolExecutionManager.js";
import { StorageManager } from "./storage/StorageManager.js";
import { planningTool } from "./tools/PlanningTool.js";
import Plan from "./models/Plan.js";

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
    // Add planning tool to the tools array
    const baseTools = config.tools || [];
    this.tools = [...baseTools, planningTool];
    this.systemPrompt = (this.tools.length > 0)
      ? this._injectPlanningProtocol(config.systemPrompt)
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
   * Automatically inject Planning Protocol instructions into system prompt
   * @param {string} systemPrompt - Original system prompt
   * @returns {string} - System prompt with planning instructions
   * @private
   */
  _injectPlanningProtocol(systemPrompt) {
    const planningProtocol = `

## Planning Protocol

**CRITICAL INSTRUCTION:** For any task with 3 or more steps or requiring precise execution, you MUST use the planningTool to create and manage a structured plan.

### When to Use Planning:
1. **Complex Tasks**: Any task with 3 or more steps
2. **Critical Operations**: Tasks where validation and sequencing are important
3. **Recovery Scenarios**: When you need structured fallbacks for error handling

### Planning Process:
1. **Initial Thought**: Use thoughtTool to brainstorm and determine if planning is needed
2. **Plan Creation**: Use planningTool with action="createPlan" to define steps, dependencies, and validation criteria
3. **Plan Execution**: Follow the plan strictly, validating each step before marking complete
4. **Fallback Handling**: If a step fails, execute its predefined fallback actions

### Progress Tracking:
- The planningTool automatically tracks progress based on validated artifacts
- You cannot mark a step complete until its artifact passes validation
- Use getPlanStatus to check which steps are available to execute next

### Example Plan Structure:
\`\`\`json
{
  "action": "createPlan",
  "plan": {
    "title": "Task Title",
    "steps": [
      {
        "stepId": "step_1",
        "title": "Step 1 Title",
        "tool": "toolName",
        "dependencies": [],
        "requiredArtifact": {
          "artifactType": "JSON_SCHEMA",
          "validationCriteria": "Must include field1, field2"
        },
        "fallback": {
          "action": "alternativeAction",
          "message": "Fallback message",
          "recoverySteps": ["step_2"]
        }
      }
    ]
  }
}
\`\`\`

**Failure to follow planning protocols for complex tasks will result in execution errors.**
`;

    return systemPrompt + planningProtocol;
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
   * Set up planning tool handlers
   * @private
   */
  _setupPlanningToolHandlers() {
    // Register planning tool handler
    this.handlers['managePlan'] = this._handlePlanAction.bind(this);
  }

  /**
   * Set up planning event forwarding
   * @private
   */
  _setupPlanningEvents() {
    // Forward planning events
    this.on('plan-created', (data) => {
      console.log(`📋 [PLAN] Created: ${data.planId} - ${data.title}`);
    });

    this.on('plan-updated', (data) => {
      console.log(`📝 [PLAN] Updated: ${data.planId}`);
    });

    this.on('step-completed', (data) => {
      console.log(`✅ [PLAN] Step completed: ${data.stepId} - ${data.title}`);
    });

    this.on('step-failed', (data) => {
      console.log(`❌ [PLAN] Step failed: ${data.stepId} - ${data.title}`);
    });

    this.on('fallback-executed', (data) => {
      console.log(`🔄 [PLAN] Fallback executed for: ${data.stepId} - ${data.action}`);
    });
  }

  /**
   * Execute with planning - determines if planning is needed and executes accordingly
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @returns {Promise<{response: string, fullMessages: Array}>} - Agent's response and full conversation
   */
  async executeWithPlanning(history, userInput) {
    // First use thought tool to analyze the task
    const thoughtResult = await this._analyzeTaskComplexity(history, userInput);

    // If planning is needed, create and execute a plan
    if (thoughtResult.needsPlanning) {
      return this._executePlanBasedTask(history, userInput, thoughtResult.planSteps);
    } else {
      // For simple tasks, use standard execution
      return this.execute(history, userInput);
    }
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

    // Define the JSON schema to enforce structured response
    const responseFormat = {
      type: "json_schema",
      json_schema: {
        name: "tool_response",
        strict: true,
        schema: {
          type: "object",
          properties: {
            action: { type: "string" },
            data: { type: "object" },
            requested_tools: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  tool: { type: "string" },
                  arguments: { type: "object" }
                },
                required: ["tool", "arguments"]
              }
            }
          },
          required: ["requested_tools"],
          additionalProperties: false,
          title: "ToolResponse"
        }
      }
    };

     const response = await this.client.chat.complete({
       model: this.model,
       messages: messages,
       ...(this.tools.length > 0 && { tools: this.toolManager.getApiTools() }),
     response_format: responseFormat
     });

     // 🚀 DEVELOPMENT LOGGING: Show current progress state before processing response
     if (this.debug && this.progressState.size > 0) {
       const currentProgress = this._mapToProgressString(this.progressState);
       console.log('📊 [PROGRESS] Current state before response processing:', currentProgress);
     }

     // Parse the structured response
     const rawContent = response.choices[0].message.content;
     const parsed = JSON.parse(rawContent);

    // Process the response and handle any fallbacks
    const result = await this.responseProcessor.processResponse(response, messages);

    // If we have fallback results, handle them
    if (result.fallbackResults && result.fallbackResults.length > 0) {
      for (const fallbackResult of result.fallbackResults) {
        await this._handlePlanFallback(fallbackResult.stepId, fallbackResult.fallback);
      }
    }

    // Check for nextAction in tool results
    if (result.toolResults && result.toolResults.length > 0) {
      for (const toolResult of result.toolResults) {
        if (toolResult.result && toolResult.result.nextAction) {
          const nextAction = toolResult.result.nextAction;
          // Execute the next action tool
          const nextToolResult = await this.executeTool(nextAction.tool, {
            // Pass any required parameters for the tool
            // This is a placeholder; adjust based on the tool's expected parameters
            taskProgress: result.taskProgress || ""
          });

          // Validate the step after executing the tool
          if (nextAction.requiredArtifact) {
            await this._validatePlanStep(toolResult.stepId, nextToolResult);
          }
        }
      }
    }

    return result;
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

    // Define the JSON schema to enforce structured response
    const responseFormat = {
      type: "json_schema",
      json_schema: {
        name: "tool_response",
        strict: true,
        schema: {
          type: "object",
          properties: {
            action: { type: "string" },
            data: { type: "object" },
            requested_tools: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  tool: { type: "string" },
                  arguments: { type: "object" }
                },
                required: ["tool", "arguments"]
              }
            }
          },
          required: ["requested_tools"],
          additionalProperties: false,
          title: "ToolResponse"
        }
      }
    };

    const stream = await this.client.chat.stream({
      model: this.model,
      messages: messages,
      ...(this.tools.length > 0 && { tools: this.toolManager.getApiTools() }),
      response_format: responseFormat
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
       if (this.storageType === 'mongodb') {
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
   * Analyze task complexity to determine if planning is needed
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @returns {Promise<Object>} - Analysis result with needsPlanning flag and planSteps
   * @private
   */
  async _analyzeTaskComplexity(history, userInput) {
    // This is a simplified version - in a real implementation, you would:
    // 1. Use thoughtTool to analyze the task
    // 2. Determine if it's complex enough to need planning
    // 3. If planning is needed, extract the plan steps

    // For now, we'll use a simple heuristic
    const messages = [
      { role: "system", content: this.systemPrompt },
      ...(history || []),
      { role: "user", content: userInput }
    ];

    // Check if the input suggests a complex task
    const complexIndicators = [
      /migrate/i,
      /multi-step/i,
      /sequence/i,
      /plan/i,
      /process/i,
      /workflow/i,
      /and then/i,
      /first.*then/i,
      /multiple/i
    ];

    const needsPlanning = complexIndicators.some(indicator =>
      userInput.match(indicator) ||
      (history && history.some(msg => msg.content && msg.content.match(indicator)))
    );

    // If we detect a complex task, we'll need to create a plan
    // In a real implementation, we would use thoughtTool to get the plan steps
    return {
      needsPlanning,
      planSteps: needsPlanning ? 3 : 1 // Default to 3 steps for complex tasks
    };
  }

  /**
   * Execute a task using plan-based workflow
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @param {number} planSteps - Estimated number of steps in the plan
   * @returns {Promise<Object>} - Execution result
   * @private
   */
  async _executePlanBasedTask(history, userInput, planSteps) {
    // Create a plan using the planning tool
    const planResult = await this._createInitialPlan(history, userInput, planSteps);

    if (planResult.status !== 'success') {
      console.error('Failed to create plan:', planResult.message);
      // Fall back to standard execution
      return this.execute(history, userInput);
    }

    // Execute the plan
    return this._executePlan(history, userInput, planResult.planId);
  }

  /**
   * Create an initial plan for a task
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @param {number} planSteps - Estimated number of steps
   * @returns {Promise<Object>} - Plan creation result
   * @private
   */
  async _createInitialPlan(history, userInput, planSteps) {
    // In a real implementation, we would:
    // 1. Use thoughtTool to brainstorm the steps
    // 2. Create a detailed plan with dependencies and validation criteria
    // 3. Use planningTool to create the plan

    // For now, we'll create a simple template plan
    const plan = {
      title: `Task: ${userInput.substring(0, 50)}...`,
      description: `Plan for executing: ${userInput}`,
      steps: []
    };

    // Create steps based on the estimated number
    for (let i = 1; i <= planSteps; i++) {
      plan.steps.push({
        stepId: `step_${i}`,
        title: `Step ${i}: ${this._getGenericStepTitle(i)}`,
        tool: this._getGenericStepTool(i),
        dependencies: i > 1 ? [`step_${i-1}`] : [],
        requiredArtifact: {
          artifactType: this._getGenericArtifactType(i),
          validationCriteria: `Step ${i} must produce valid output`
        },
        fallback: {
          action: "notify_user",
          message: `Failed to complete step ${i}`,
          recoverySteps: i > 1 ? [`step_${i-1}`] : []
        }
      });
    }

    // Use the planning tool to create the plan
    const result = await this._handlePlanAction({
      action: "createPlan",
      plan: plan
    });

    if (result.status === 'success') {
      this.currentPlan = result.plan;
      this.planHistory.push({
        planId: result.planId,
        createdAt: new Date(),
        status: 'created'
      });

      this.emit('plan-created', {
        planId: result.planId,
        title: plan.title,
        steps: plan.steps.length
      });
    }

    return result;
  }

  /**
   * Execute a plan step by step
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @param {string} planId - ID of the plan to execute
   * @returns {Promise<Object>} - Execution result
   * @private
   */
  async _executePlan(history, userInput, planId) {
    // Get the current plan status
    const statusResult = await this._handlePlanAction({
      action: "getPlanStatus",
      planId: planId
    });

    if (statusResult.status !== 'success') {
      console.error('Failed to get plan status:', statusResult.message);
      return this.execute(history, userInput);
    }

    // Get available steps to execute
    const availableSteps = statusResult.availableSteps;

    if (!availableSteps || availableSteps.length === 0) {
      // Plan is complete or blocked
      if (statusResult.planStatus === 'completed') {
        return {
          response: `Plan ${planId} has been successfully completed. All steps are done.`,
          fullMessages: [...history, { role: "assistant", content: `Plan ${planId} has been successfully completed. All steps are done.` }]
        };
      } else {
        console.warn('No available steps to execute. Plan may be blocked.');
        return this.execute(history, userInput);
      }
    }

    // Execute each available step
    for (const step of availableSteps) {
      // Execute the step using the specified tool
      const stepResult = await this._executePlanStep(history, userInput, step);

      // Validate the step result
      const validationResult = await this._validatePlanStep(step.stepId, stepResult);

      // If validation failed and we have a fallback, execute it
      if (validationResult.status === 'fallback_required') {
        await this._handlePlanFallback(step.stepId, validationResult.fallback);
      }

      // Check if plan is complete
      const updatedStatus = await this._handlePlanAction({
        action: "getPlanStatus",
        planId: planId
      });

      if (updatedStatus.planStatus === 'completed') {
        break;
      }
    }

    // Get final plan status
    const finalStatus = await this._handlePlanAction({
      action: "getPlanStatus",
      planId: planId
    });

    return {
      response: `Plan execution ${finalStatus.planStatus}. ${finalStatus.steps.filter(s => s.status === 'completed').length} of ${finalStatus.steps.length} steps completed.`,
      fullMessages: [...history, {
        role: "assistant",
        content: `Plan execution ${finalStatus.planStatus}. ${finalStatus.steps.filter(s => s.status === 'completed').length} of ${finalStatus.steps.length} steps completed.`
      }]
    };
  }

  /**
   * Execute a single plan step
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @param {Object} step - Step definition
   * @returns {Promise<Object>} - Step execution result
   * @private
   */
  async _executePlanStep(history, userInput, step) {
    console.log(`🚀 [PLAN] Executing step: ${step.stepId} - ${step.title} using ${step.tool}`);

    // Create a modified version of the user input that focuses on this step
    const stepPrompt = `
    Current Step: ${step.title} (${step.stepId})
    Description: ${step.description || 'No description provided'}

    User Request: ${userInput}

    Please execute this step using the ${step.tool} tool.
    Remember that you must produce the required artifact: ${step.requiredArtifact.artifactType}
    Validation criteria: ${step.requiredArtifact.validationCriteria}
    `;

    // Create messages for this step
    const stepMessages = [
      { role: "system", content: this.systemPrompt },
      ...history,
      { role: "user", content: stepPrompt }
    ];

    // Execute the step using the standard execute method
    const result = await this.execute(stepMessages, stepPrompt);

    // Extract the tool result
    const toolResult = result.toolResults && result.toolResults[0] ?
      result.toolResults[0].result :
      result.response;

    this.emit('step-executed', {
      stepId: step.stepId,
      title: step.title,
      result: toolResult
    });

    return toolResult;
  }

  /**
   * Validate a plan step's artifact
   * @param {string} stepId - ID of the step to validate
   * @param {Object} artifact - Artifact to validate
   * @returns {Promise<Object>} - Validation result
   * @private
   */
  async _validatePlanStep(stepId, artifact) {
    if (!this.currentPlan) {
      return {
        status: 'error',
        message: 'No active plan'
      };
    }

    console.log(`🔍 [PLAN] Validating step: ${stepId}`);

    const result = await this._handlePlanAction({
      action: "validateStep",
      stepId: stepId,
      artifact: artifact
    });

    if (result.status === 'success') {
      this.emit('step-completed', {
        stepId: stepId,
        title: result.message,
        artifact: artifact
      });
    } else if (result.status === 'fallback_required') {
      this.emit('step-failed', {
        stepId: stepId,
        title: result.message,
        fallback: result.fallback
      });
    }

    return result;
  }

  /**
   * Handle a plan step fallback
   * @param {string} stepId - ID of the failed step
   * @param {Object} fallback - Fallback definition
   * @returns {Promise<Object>} - Fallback execution result
   * @private
   */
  async _handlePlanFallback(stepId, fallback) {
    console.log(`🔄 [PLAN] Handling fallback for step: ${stepId}`);

    const result = await this._handlePlanAction({
      action: "handleFailure",
      stepId: stepId
    });

    this.emit('fallback-executed', {
      stepId: stepId,
      action: fallback.action,
      message: fallback.message
    });

    return result;
  }

  /**
   * Get available steps from the current plan
   * @returns {Array} - Available steps to execute
   * @private
   */
  _getAvailablePlanSteps() {
    if (!this.currentPlan) {
      return [];
    }

    return this.currentPlan.steps.filter(step => {
      return step.status === "not_started" &&
             step.dependencies.every(depId => {
               const depStep = this.currentPlan.steps.find(s => s.stepId === depId);
               return depStep && depStep.status === "completed";
             });
    });
  }

  /**
   * Handle planning tool actions
   * @param {Object} params - Action parameters
   * @returns {Promise<Object>} - Action result
   * @private
   */
  async _handlePlanAction(params) {
    // Ensure we have a session ID for MongoDB operations
    if (!process.env.SESSION_ID && this.sessionId) {
      process.env.SESSION_ID = this.sessionId;
    }

    // Extract sessionId and stepId for executeStep action
    if (params.action === "executeStep") {
      const { plan, sessionId, stepId, ...rest } = params;
      const adjustedParams = { ...rest, sessionId: sessionId || process.env.SESSION_ID, stepId: stepId || (plan && plan.stepId) };
      return planningTool.handler(adjustedParams);
    }

    // Call the planning tool handler
    return planningTool.handler(params);
  }

  /**
   * Validate plan execution result
   * @param {Object} result - Execution result
   * @returns {Promise<Object>} - Validated result
   * @private
   */
  async _validatePlanExecution(result) {
    // If there are tool results, validate them against the plan
    if (result.toolResults && result.toolResults.length > 0 && this.currentPlan) {
      for (const toolResult of result.toolResults) {
        // Find which step this tool result corresponds to
        const step = this.currentPlan.steps.find(s =>
          s.tool === toolResult.toolName &&
          s.status === "in_progress"
        );

        if (step) {
          // Validate the result against the step requirements
          const validation = await this._validatePlanStep(step.stepId, toolResult.result);

          if (validation.status === 'fallback_required') {
            // Handle the fallback
            await this._handlePlanFallback(step.stepId, validation.fallback);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get generic step title for template plans
   * @param {number} stepNumber - Step number
   * @returns {string} - Generic step title
   * @private
   */
  _getGenericStepTitle(stepNumber) {
    const titles = [
      "Initial Analysis and Requirements Gathering",
      "Data Collection and Preparation",
      "Processing and Transformation",
      "Validation and Quality Check",
      "Final Output Generation",
      "Review and Verification",
      "Cleanup and Completion"
    ];

    return titles[stepNumber - 1] || `Execution Step ${stepNumber}`;
  }

  /**
   * Get generic tool for template plans
   * @param {number} stepNumber - Step number
   * @returns {string} - Generic tool name
   * @private
   */
  _getGenericStepTool(stepNumber) {
    const tools = [
      "thoughtTool", // For analysis
      "dbsearch",    // For data collection
      "calculatorTool", // For processing
      "jsonValidator", // For validation
      "reportGenerator", // For output
      "reviewTool", // For review
      "cleanupTool"  // For cleanup
    ];

    // Find a tool that exists in our tools array
    for (const tool of tools) {
      if (this.tools.some(t => t.function.name === tool)) {
        return tool;
      }
    }

    // Fallback to the first available tool
    return this.tools.length > 0 ? this.tools[0].function.name : "thoughtTool";
  }

  /**
   * Get generic artifact type for template plans
   * @param {number} stepNumber - Step number
   * @returns {string} - Generic artifact type
   * @private
   */
  _getGenericArtifactType(stepNumber) {
    const types = [
      "ANALYSIS_REPORT",
      "DATA_COLLECTION",
      "PROCESSED_DATA",
      "VALIDATION_RESULT",
      "FINAL_OUTPUT",
      "REVIEW_NOTES",
      "COMPLETION_CONFIRMATION"
    ];

    return types[stepNumber - 1] || "EXECUTION_RESULT";
  }

  /**
   * Generate a visual representation of the current plan
   * @returns {string} - ASCII visualization of the plan
   */
  generatePlanVisualization() {
    if (!this.currentPlan) {
      return "No active plan";
    }

    let visualization = `📋 PLAN: ${this.currentPlan.title}\n`;
    visualization += `📝 ${this.currentPlan.description}\n\n`;

    // Create a step visualization
    for (const step of this.currentPlan.steps) {
      const statusEmoji = step.status === 'completed' ? '✅' :
                          step.status === 'in_progress' ? '🔄' :
                          step.status === 'failed' ? '❌' : '⏳';

      const dependencies = step.dependencies.length > 0 ?
                          ` (Depends on: ${step.dependencies.join(', ')})` : '';

      visualization += `  ${statusEmoji} ${step.stepId}: ${step.title}${dependencies}\n`;

      if (step.status === 'failed' && step.fallback) {
        visualization += `    ⚠️ Fallback: ${step.fallback.action} - ${step.fallback.message}\n`;
      }
    }

    // Add progress summary
    const completedSteps = this.currentPlan.steps.filter(s => s.status === 'completed').length;
    const totalSteps = this.currentPlan.steps.length;
    const progressPercent = Math.round((completedSteps / totalSteps) * 100);

    visualization += `\n📊 Progress: ${completedSteps}/${totalSteps} steps (${progressPercent}%)`;

    return visualization;
  }

  /**
   * Generate a visual representation of the progress state
   * @returns {string} - ASCII visualization of progress
   */
  generateProgressVisualization() {
    if (!this.progressState || this.progressState.size === 0) {
      return "No progress tracked yet";
    }

    let visualization = "📊 PROGRESS TRACKING\n";

    // Sort by task description for consistent output
    const sortedEntries = Array.from(this.progressState.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (const [taskKey, isCompleted] of sortedEntries) {
      const statusEmoji = isCompleted ? '✅' : '⏳';
      const statusText = isCompleted ? 'COMPLETED' : 'PENDING';
      visualization += `  ${statusEmoji} ${taskKey} (${statusText})\n`;
    }

    // Add summary
    const completedTasks = Array.from(this.progressState.entries()).filter(([_, isCompleted]) => isCompleted).length;
    const totalTasks = this.progressState.size;
    const progressPercent = Math.round((completedTasks / totalTasks) * 100);

    visualization += `\n📈 Summary: ${completedTasks}/${totalTasks} tasks (${progressPercent}%)`;

    return visualization;
  }

  /**
   * Generate a visual representation of the circuit breaker state
   * @returns {string} - ASCII visualization of circuit breaker status
   */
  generateCircuitBreakerVisualization() {
    if (!this.circuitBreaker) {
      return "Circuit breaker not initialized";
    }

    let visualization = "🔌 CIRCUIT BREAKER STATUS\n";

    // Get circuit breaker state
    const state = this.circuitBreaker.getState();
    const globalState = this.circuitBreaker.getGlobalState();

    // Add global state
    visualization += `  🌐 Global: ${globalState.state} `;
    if (globalState.state === 'OPEN') {
      visualization += `(Cooldown: ${Math.round(globalState.cooldownRemaining / 1000)}s)`;
    }
    visualization += `\n`;

    // Add per-tool states
    for (const [tool, toolState] of Object.entries(state)) {
      visualization += `  ${tool}: ${toolState.state} `;
      if (toolState.state === 'OPEN') {
        visualization += `(Cooldown: ${Math.round(toolState.cooldownRemaining / 1000)}s)`;
      }
      visualization += `\n`;
    }

    return visualization;
  }

  /**
   * Generate a comprehensive debug visualization
   * @returns {string} - ASCII visualization of all debug information
   */
  generateDebugVisualization() {
    let visualization = "🔍 COMPREHENSIVE DEBUG VIEW\n\n";

    // Add plan visualization if available
    if (this.currentPlan) {
      visualization += this.generatePlanVisualization() + "\n\n";
    }

    // Add progress visualization
    visualization += this.generateProgressVisualization() + "\n\n";

    // Add circuit breaker visualization
    visualization += this.generateCircuitBreakerVisualization() + "\n\n";

    // Add loop detector status
    if (this.loopDetector) {
      const loopStats = this.loopDetector.getStats();
      visualization += `🔄 LOOP DETECTION\n`;
      visualization += `  Recent calls: ${loopStats.recentCalls.length}\n`;
      visualization += `  Loop count: ${loopStats.loopCount}\n`;
      visualization += `  Last detected: ${loopStats.lastDetected || 'None'}\n\n`;
    }

    return visualization;
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