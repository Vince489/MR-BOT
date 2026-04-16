import { Mistral } from "@mistralai/mistralai";
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
   * @param {boolean} [config.paralleltool_calls=true] - Execute multiple tool calls concurrently using Promise.all()
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
    this.paralleltool_calls = config.paralleltool_calls !== false; // default true

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

    const stream = await this.client.chat.stream({
      model: this.model,
      messages: messages,
      ...(this.tools.length > 0 && { tools: this.toolManager.getApiTools() })
    });

    return this.streamingProcessor.processStreamResponse(stream, messages, onChunk);
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
      const tool_calls = response?.choices?.[0]?.message?.tool_calls || [];

      if (tool_calls.length === 0) return;

      // Collect all progress updates from tool calls
      const progressUpdates = [];

      for (const tool_call of tool_calls) {
        const argumentsStr = tool_call.function?.arguments;
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
          tool_call: 'intent-capture',
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
          tool_calls: tool_calls.length,
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
      tool_call: entry.tool_call,
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
   * Decomposes a broad objective into a structured task graph
   * @param {string} objective - The broad objective to decompose
   * @returns {Promise<TaskGraph>} The created task graph
   */
  async decomposeTask(objective) {
    // Step 1: Analyze the objective and generate initial task structure
    const analysis = await this._analyzeObjective(objective);

    // Step 2: Create and validate the task graph
    this.taskGraph = await this._createTaskGraph(analysis);

    // Step 3: Convert to progress tracking format
    this.currentProgress = this.taskGraph.toMarkdown();
    this.updateProgress(this.currentProgress, 'system', 'plan-created');

    // Emit event with the complete plan
    this.emit('task-plan-created', {
      objective,
      taskGraph: this.taskGraph,
      status: this.taskGraph.getStatus()
    });

    return this.taskGraph;
  }

  /**
   * Analyzes an objective and generates a task decomposition plan
   * @param {string} objective - The objective to analyze
   * @returns {Promise<Object>} Analysis result with task structure
   * @private
   */
  async _analyzeObjective(objective) {
    // Use LLM to analyze the objective and suggest sub-tasks
    const response = await this.client.chat.complete({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are a task decomposition expert. Analyze the following objective and break it down into logical sub-tasks with dependencies.

          **Objective**: ${objective}

          **Instructions**:
          1. Break this down into the smallest logical units of work
          2. Identify dependencies between tasks
          3. Specify any tools required for each task
          4. Estimate task priority (1-5, where 1 is highest priority)
          5. Include any potential risks or considerations

          **Response Format**:
          Respond with JSON in this exact format:
          {
            "subTasks": [
              {
                "id": "unique-identifier",
                "description": "Clear, specific task description",
                "dependencies": ["id1", "id2"], // optional
                "requiredTools": ["tool1", "tool2"], // optional
                "priority": 1-5, // optional, default 3
                "notes": "Any additional context" // optional
              }
            ],
            "potentialRisks": ["risk1", "risk2"],
            "suggestedApproach": "Brief explanation of the overall approach",
            "estimatedComplexity": "low|medium|high"
          }`
        }
      ],
      temperature: 0.3, // More deterministic for planning
      response_format: { type: "json_object" }
    });

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (e) {
      console.error("Failed to parse task analysis response:", e);
      throw new Error("Invalid response format from task analysis");
    }
  }

  /**
   * Creates a task graph from analysis data
   * @param {Object} analysis - Task analysis data
   * @returns {Promise<TaskGraph>} Created task graph
   * @private
   */
  async _createTaskGraph(analysis) {
    const graph = new TaskGraph();

    // Add all tasks to the graph
    for (const task of analysis.subTasks) {
      // Generate ID if not provided
      const taskId = task.id || generateTaskId();

      try {
        graph.addTask(
          taskId,
          task.description,
          task.dependencies || []
        );

        // Set additional properties
        const node = graph.nodes.get(taskId);
        node.requiredTools = task.requiredTools || [];
        node.priority = task.priority || 3;
        if (task.notes) node.metadata.notes = task.notes;
      } catch (e) {
        console.error(`Failed to add task ${task.description}:`, e.message);
        // Try to continue with other tasks
      }
    }

    // Validate the complete graph
    try {
      graph.getExecutionOrder(); // This will throw if there are circular dependencies
    } catch (e) {
      console.error("Invalid task graph structure:", e.message);
      throw new Error("Generated task plan contains circular dependencies");
    }

    // Emit event with the created graph
    this.emit('task-graph-created', {
      graph: graph.toJSON(),
      analysis
    });

    return graph;
  }

  /**
   * Executes tasks according to the current plan
   * @param {Array} history - Conversation history
   * @param {string} userInput - User input message
   * @returns {Promise<{response: string, fullMessages: Array}>} - Agent's response and full conversation
   */
  async executeWithPlan(history, userInput) {
    // If we don't have a plan yet, create one
    if (!this.taskGraph) {
      await this.decomposeTask(userInput);
    }

    // Get next executable tasks
    const executableTasks = this.taskGraph.getExecutableTasks();

    if (executableTasks.length === 0) {
      // All tasks completed or no executable tasks
      const status = this.taskGraph.getStatus();

      if (status.isComplete) {
        // All tasks completed successfully
        const completionMessage = this._generateCompletionMessage();
        return {
          response: completionMessage,
          fullMessages: [...(history || []), { role: "assistant", content: completionMessage }]
        };
      } else {
        // No executable tasks but not all completed - some may have failed
        const blockedMessage = this._generateBlockedMessage();
        return {
          response: blockedMessage,
          fullMessages: [...(history || []), { role: "assistant", content: blockedMessage }]
        };
      }
    }

    // Focus on the highest priority executable task
    const nextTaskId = this._selectNextTask(executableTasks);
    const nextTask = this.taskGraph.getTask(nextTaskId);

    // Update task status
    nextTask.status = 'in-progress';
    nextTask.updatedAt = new Date();
    this.currentProgress = this.taskGraph.toMarkdown();

    // Update progress tracking
    this.updateProgress(this.currentProgress, 'system', 'task-started');

    // Emit event for task started
    this.emit('task-started', {
      taskId: nextTaskId,
      description: nextTask.description,
      dependencies: nextTask.dependencies,
      progress: this.currentProgress
    });

    try {
      // Generate task-specific prompt
      const taskPrompt = await this._generateTaskPrompt(nextTaskId);

      const messages = [
        { role: "system", content: this.systemPrompt },
        ...(history || []),
        { role: "user", content: taskPrompt }
      ];

      // Execute with tool support if needed
      const response = await this.client.chat.complete({
        model: this.model,
        messages: messages,
        ...(nextTask.requiredTools.length > 0 && { tools: this.toolManager.getApiTools() })
      });

      // Process the response
      const result = await this.responseProcessor.processResponse(response, messages);

      // Check if task was completed successfully
      if (response.choices[0].message.tool_calls &&
          response.choices[0].message.tool_calls.length > 0) {
        // Task required tool calls - progress will be updated by tool execution
        return result;
      } else {
        // Task completed without tool calls
        return await this._handleCompletedTask(nextTaskId, result, response);
      }
    } catch (error) {
      console.error(`Error executing task ${nextTaskId}:`, error);
      return await this._handleTaskFailure(nextTaskId, error, history, userInput);
    }
  }

  /**
   * Selects the next task to execute from available tasks
   * @param {Array<string>} taskIds - Array of executable task IDs
   * @returns {string} Selected task ID
   * @private
   */
  _selectNextTask(taskIds) {
    if (taskIds.length === 0) return null;

    // Get all task nodes
    const tasks = taskIds.map(id => this.taskGraph.getTask(id));

    // Sort by priority (lower number = higher priority) then by creation date
    tasks.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.createdAt - b.createdAt;
    });

    return tasks[0].id;
  }

  /**
   * Generates a task-specific prompt
   * @param {string} taskId - Task ID
   * @returns {Promise<string>} Task prompt
   * @private
   */
  async _generateTaskPrompt(taskId) {
    const node = this.taskGraph.getTask(taskId);
    if (!node) throw new Error(`Task ${taskId} not found`);

    // Get only direct dependencies' results for context
    const dependencyContext = [];
    for (const depId of node.dependencies) {
      const depNode = this.taskGraph.getTask(depId);
      if (depNode.result) {
        dependencyContext.push(
          `### ${depNode.description}\n` +
          `**Status**: ${depNode.status}\n` +
          `**Result**: ${JSON.stringify(depNode.result)}\n`
        );
      }
    }

    // Get current progress status
    const status = this.taskGraph.getStatus();

    return `
    **Current Task**: ${node.description}
    **Task ID**: ${taskId}
    **Priority**: ${node.priority}
    **Status**: ${status.completed}/${status.totalTasks} tasks completed

    ${dependencyContext.length > 0 ? `**Dependency Results**:\n${dependencyContext.join('\n')}\n` : ''}

    **Available Tools**: ${node.requiredTools.length > 0 ? node.requiredTools.join(', ') : 'None specified'}

    **Instructions**:
    1. Focus ONLY on completing this specific task: "${node.description}"
    2. Use the provided dependency results if needed
    3. Use the required tools: [${node.requiredTools.join(', ') || 'none'}]
    4. When completed:
       - Store your result in a 'result' field in your response
       - Include the complete updated task list in taskProgress
       - Mark this task as completed with [x]
    5. If you encounter issues:
       - Explain the specific problem clearly
       - Suggest alternative approaches if possible
       - Propose new sub-tasks if the original plan needs adjustment

    **Current Progress**:
    ${this.taskGraph.toMarkdown()}

    **Important**: Only work on this specific task. Do not attempt other tasks.
    `;
  }

  /**
   * Handles a completed task
   * @param {string} taskId - Completed task ID
   * @param {Object} result - Execution result
   * @param {Object} response - Original response object
   * @returns {Promise<{response: string, fullMessages: Array}>} Updated result
   * @private
   */
  async _handleCompletedTask(taskId, result, response) {
    const node = this.taskGraph.getTask(taskId);
    if (!node) throw new Error(`Task ${taskId} not found`);

    // Parse the result to extract task output and progress updates
    const content = response.choices[0].message.content;
    let taskResult = null;
    let progressUpdate = null;

    try {
      // Try to parse as JSON if it looks like structured data
      if (content.trim().startsWith('{')) {
        const parsed = JSON.parse(content);
        taskResult = parsed.result;
        progressUpdate = parsed.taskProgress || content;
      } else {
        // Try to extract progress update from markdown
        const progressMatch = content.match(/```(?:markdown)?\n([\s\S]*?)\n```/i);
        if (progressMatch) {
          progressUpdate = progressMatch[1];
          // Remove progress from content for result
          taskResult = content.replace(progressMatch[0], '').trim();
        } else {
          // Use entire content as result, no progress update
          taskResult = content;
        }
      }
    } catch (e) {
      // If parsing fails, use raw content
      taskResult = content;
    }

    // Update task status and result
    node.status = 'completed';
    node.result = taskResult;
    node.updatedAt = new Date();

    // Update progress if we have an explicit update
    if (progressUpdate) {
      this.updateProgress(progressUpdate, taskId, 'completed');
      // Parse the update to sync with our graph
      const lines = progressUpdate.split('\n');
      for (const line of lines) {
        const match = line.match(/^\-\s*\[([ x!>])\]\s*(.+)/);
        if (match) {
          const statusChar = match[1];
          const description = match[2].trim();

          // Find task by description (simplified - in real implementation would need better matching)
          for (const [id, taskNode] of this.taskGraph.nodes) {
            if (taskNode.description === description) {
              taskNode.status =
                statusChar === 'x' ? 'completed' :
                statusChar === '!' ? 'failed' :
                statusChar === '>' ? 'in-progress' : 'pending';
              break;
            }
          }
        }
      }
    } else {
      // Update with current graph state
      this.currentProgress = this.taskGraph.toMarkdown();
      this.updateProgress(this.currentProgress, taskId, 'completed');
    }

    // Emit task completed event
    this.emit('task-completed', {
      taskId,
      description: node.description,
      result: node.result,
      progress: this.currentProgress,
      status: this.taskGraph.getStatus()
    });

    // Check if all tasks are completed
    const status = this.taskGraph.getStatus();
    if (status.isComplete) {
      return {
        response: this._generateCompletionMessage(),
        fullMessages: result.fullMessages
      };
    }

    return result;
  }

  /**
   * Handles a failed task
   * @param {string} taskId - Failed task ID
   * @param {Error} error - Error object
   * @param {Array} history - Conversation history
   * @param {string} userInput - Original user input
   * @returns {Promise<{response: string, fullMessages: Array}>} Recovery response
   * @private
   */
  async _handleTaskFailure(taskId, error, history, userInput) {
    const node = this.taskGraph.getTask(taskId);
    if (!node) throw new Error(`Task ${taskId} not found`);

    // Mark task as failed
    node.status = 'failed';
    node.failureReason = error.message;
    node.updatedAt = new Date();

    // Update progress
    this.currentProgress = this.taskGraph.toMarkdown();
    this.updateProgress(this.currentProgress, taskId, 'failed');

    // Emit task failed event
    this.emit('task-failed', {
      taskId,
      description: node.description,
      error: error.message,
      progress: this.currentProgress
    });

    try {
      // Generate recovery options
      const recoveryOptions = await this._generateRecoveryOptions(taskId, error);

      if (recoveryOptions.shouldHalt) {
        // Request human intervention
        return {
          response: this._generateHumanInterventionMessage(taskId, error, recoveryOptions),
          fullMessages: [...(history || []), {
            role: "assistant",
            content: this._generateHumanInterventionMessage(taskId, error, recoveryOptions)
          }]
        };
      } else {
        // Apply automatic recovery
        this.taskGraph.handleTaskFailure(taskId, error.message, recoveryOptions.recoveryOptions);

        // Update progress after recovery
        this.currentProgress = this.taskGraph.toMarkdown();
        this.updateProgress(this.currentProgress, 'system', 'recovery-applied');

        // Continue with next task
        return this.executeWithPlan(history, userInput);
      }
    } catch (recoveryError) {
      console.error("Failed to generate recovery options:", recoveryError);
      return {
        response: `Task failed and unable to generate recovery options: ${error.message}`,
        fullMessages: [...(history || []), {
          role: "assistant",
          content: `Task failed and unable to generate recovery options: ${error.message}`
        }]
      };
    }
  }

  /**
   * Generates recovery options for a failed task
   * @param {string} taskId - Failed task ID
   * @param {Error} error - Error object
   * @returns {Promise<Object>} Recovery options
   * @private
   */
  async _generateRecoveryOptions(taskId, error) {
    const node = this.taskGraph.getTask(taskId);

    const response = await this.client.chat.complete({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `The task "${node.description}" failed with error: ${error.message}.

          **Task Details**:
          - ID: ${taskId}
          - Description: ${node.description}
          - Dependencies: ${node.dependencies.join(', ') || 'none'}
          - Required Tools: ${node.requiredTools.join(', ') || 'none'}

          **Current Graph Status**:
          ${JSON.stringify(this.taskGraph.getStatus(), null, 2)}

          **Available Tools**: ${JSON.stringify(this.tools.map(t => t.function.name), null, 2)}

          **Instructions**:
          1. Analyze why the task failed
          2. Propose specific recovery options
          3. Decide if human intervention is needed
          4. If proposing new tasks, include all required details

          **Response Format**:
          {
            "analysis": "Brief analysis of the failure",
            "recoveryOptions": [
              {
                "id": "unique-identifier",
                "description": "Clear recovery task description",
                "dependencies": ["id1", "id2"], // optional
                "requiredTools": ["tool1"], // optional
                "justification": "Why this might work"
              }
            ],
            "shouldHalt": boolean, // true if human help is needed
            "recommendation": "Brief explanation of next steps"
          }`
        }
      ],
      temperature: 0.7, // More creative for recovery options
      response_format: { type: "json_object" }
    });

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (e) {
      console.error("Failed to parse recovery options:", e);
      return {
        analysis: "Failed to parse recovery options",
        recoveryOptions: [],
        shouldHalt: true,
        recommendation: "Human intervention required due to parsing error"
      };
    }
  }

  /**
   * Generates a completion message when all tasks are done
   * @returns {string} Completion message
   * @private
   */
  _generateCompletionMessage() {
    const status = this.taskGraph.getStatus();
    const completedTasks = this.taskGraph.getAllTasks()
      .filter(task => task.status === 'completed');

    let resultsSummary = completedTasks
      .map(task => `• **${task.description}**: ${typeof task.result === 'string' ?
          task.result.substring(0, 100) + (task.result.length > 100 ? '...' : '') :
          JSON.stringify(task.result).substring(0, 100) + '...'}`)
      .join('\n');

    return `
# ✅ All Tasks Completed Successfully!

**Objective Achieved**: ${status.completed}/${status.totalTasks} tasks completed

## Results Summary:
${resultsSummary}

## Task Execution Flow:
\`\`\`mermaid
${this.taskGraph.generateMermaidDiagram()}
\`\`\`

**Next Steps**: The complete objective has been achieved. Would you like to:
1. Review any specific task results in more detail
2. Save this work for future reference
3. Start a new objective?
`;
  }

  /**
   * Generates a message when no tasks can be executed
   * @returns {string} Blocked message
   * @private
   */
  _generateBlockedMessage() {
    const status = this.taskGraph.getStatus();
    const failedTasks = this.taskGraph.getAllTasks()
      .filter(task => task.status === 'failed');

    let failedDetails = failedTasks.length > 0 ?
      failedTasks.map(task => `• **${task.description}**: ${task.failureReason}`).join('\n') :
      'No specific failure details available.';

    return `
# ⚠️ Task Execution Blocked

**Status**: ${status.completed}/${status.totalTasks} tasks completed, ${failedTasks.length} failed

## Failed Tasks:
${failedDetails}

## Current Task Graph:
\`\`\`mermaid
${this.taskGraph.generateMermaidDiagram()}
\`\`\`

**Issue**: No executable tasks available. This typically means:
- Some tasks failed and blocked dependent tasks
- The plan may need to be revised
- Human intervention may be required

**Suggested Actions**:
1. Review the failed tasks above
2. Provide guidance on how to proceed
3. Or ask me to attempt automatic recovery
`;
  }

  /**
   * Generates a message requesting human intervention
   * @param {string} taskId - Failed task ID
   * @param {Error} error - Error object
   * @param {Object} recoveryOptions - Recovery options
   * @returns {string} Intervention message
   * @private
   */
  _generateHumanInterventionMessage(taskId, error, recoveryOptions) {
    const node = this.taskGraph.getTask(taskId);

    let recoveryDetails = '';
    if (recoveryOptions.recoveryOptions && recoveryOptions.recoveryOptions.length > 0) {
      recoveryDetails = recoveryOptions.recoveryOptions
        .map(opt => `• **${opt.description}**: ${opt.justification}`)
        .join('\n');
    }

    return `
# 🛑 Human Intervention Required

**Failed Task**: ${node.description}
**Error**: ${error.message}

## Analysis:
${recoveryOptions.analysis}

## Proposed Recovery Options:
${recoveryDetails || 'No automatic recovery options available.'}

## Current Task Graph:
\`\`\`mermaid
${this.taskGraph.generateMermaidDiagram()}
\`\`\`

**Recommendation**: ${recoveryOptions.recommendation}

**Please provide guidance on how to proceed**:
- Should I try one of the proposed recovery options?
- Would you like to modify the plan?
- Or provide additional information to help resolve this?
`;
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
   * @param {string} [tool_call] - Optional tool call that triggered this update
   * @param {string} [status] - Status of the update (success, failed, etc.)
   * @returns {boolean} - True if update was successful, false otherwise
   */
  updateProgress(progress, tool_call = null, status = 'success') {
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
      tool_call: tool_call,
      status: status
    });

    // Keep only last 15 progress updates
    if (this.progressHistory.length > 15) {
      this.progressHistory = this.progressHistory.slice(-15);
    }

    this.emit('progress-update', {
      progress: progress,
      tool_call: tool_call,
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
      if (message.tool_calls) {
        for (const tool_call of message.tool_calls) {
          if (tool_call.function?.arguments) {
            totalChars += tool_call.function.arguments.length;
          }
        }
      }
    }
    
    // Rough approximation: 4 characters per token
    return Math.ceil(totalChars / 4);
  }



}