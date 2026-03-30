/**
 * Tool Execution Manager
 * Centralizes all tool execution with semantic loop detection, memory integration,
 * and importance scoring for Victor/Sentinel modes
 */
import { EventEmitter } from "events";

export class ToolExecutionManager extends EventEmitter {
  constructor() {
    super();
    this.handlers = {};
    this.apiTools = [];
    this.recentToolCalls = [];
    this.maxRecentCalls = 3;
    
    // Semantic loop detection via Pinecone
    this.pineconeClient = null;
    this.semanticLoopThreshold = 0.85; // Similarity threshold for semantic loops
    
    // Memory integration
    this.memoryMode = false;
    this.victorMode = false;
    this.sentinelMode = false;
    
    // Progress tracking
    this.lightweightMode = false;
    
    // Importance scoring
    this.importanceThreshold = 7; // Minimum importance score for memory commit
  }

  /**
   * Initialize the ToolExecutionManager with agent context
   * @param {Object} agent - The Agent instance
   */
  initialize(agent) {
    this.agent = agent;
    this.debug = agent.debug || false;
    this.enableEvents = agent.enableEvents || false;
    
    // Initialize tools from agent
    this.initializeTools(agent.tools || []);
    
    // Set up Pinecone for semantic loop detection if available
    if (agent.pineconeClient) {
      this.pineconeClient = agent.pineconeClient;
      if (this.debug) {
        console.log('🧠 [SEMANTIC LOOP] Pinecone client initialized for semantic loop detection');
      }
    }
  }

  /**
   * Initialize tools from tool definitions
   * @param {Array} tools - Array of tool definitions
   */
  initializeTools(tools) {
    if (!tools || tools.length === 0) return;

    this.handlers = Object.fromEntries(tools.map((t) => [t.function.name, t.handler]));
    
    // Clone and modify the tool definitions to include taskProgress as an optional parameter
    this.apiTools = tools.map(({ handler, function: toolFunction, ...tool }) => {
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
          modifiedParameters.properties.taskProgress = {
            type: "string",
            description: "Markdown-formatted checklist to track task progress. " +
                         "Each line should be a checklist item (e.g., '- [ ] Step 1'). " +
                         "This parameter is optional and can be included in any tool call.",
            pattern: "^(\\s*(- \\[(x| )\\] .*)\\n?)*$", // Regex to validate markdown checklist format
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

      return {
        ...tool,
        function: modifiedToolFunction,
        handler,
      };
    });
  }

  /**
   * Set agent mode and configure manager accordingly
   * @param {string} mode - 'victor', 'sentinel', or 'standard'
   */
  setMode(mode) {
    this.victorMode = mode === 'victor';
    this.sentinelMode = mode === 'sentinel';
    this.memoryMode = this.victorMode || this.sentinelMode;
    this.lightweightMode = this.victorMode;
    
    if (this.debug) {
      console.log(`🔧 [TOOL MANAGER] Mode set to: ${mode}`);
    }
  }

  /**
   * Execute a single tool call with enhanced error handling and memory integration
   * @param {Object} toolCall - Tool call object
   * @param {Array} actionsTaken - Array to track actions
   * @param {string} userInput - User input for context
   * @param {number} retryCount - Current retry count
   * @param {AbortSignal} abortSignal - Abort signal for cancellation
   * @returns {Promise<Object>} Tool result
   */
  async executeToolCall(toolCall, actionsTaken, userInput, retryCount = 0, abortSignal) {
    const { name, arguments: rawArgs } = toolCall.function;
    const startTime = Date.now();

    if (this.enableEvents) this.emit("tool-start", { tool: name, id: toolCall.id });

    try {
      const args = JSON.parse(rawArgs || "{}");

      // Extract taskProgress if present (before validation)
      const taskProgress = args.taskProgress;
      delete args.taskProgress; // Remove from args to avoid validation issues

      let validatedArgs = args;

      // Reattach taskProgress to validated args if it was provided
      if (taskProgress !== undefined) {
        validatedArgs.taskProgress = taskProgress;
      }

      // Parse and process taskProgress if present
      if (taskProgress) {
        this._processTaskProgress(taskProgress, name, validatedArgs);
      }

      const handler = this.handlers[name];
      if (!handler) throw new Error(`Handler for "${name}" not found`);

      // Memory integration: Record structured thought before execution
      if (this.memoryMode) {
        await this._recordExecutionThought(name, validatedArgs, 'beforeExecution');
      }

      const result = await handler(validatedArgs, { 
        agent: this.agent, 
        userInput, 
        signal: abortSignal 
      });
      const duration = Date.now() - startTime;

      actionsTaken.push({ 
        id: toolCall.id, 
        tool: name, 
        args: validatedArgs, 
        result, 
        duration, 
        ts: new Date() 
      });

      // Memory integration: Record structured thought after execution
      if (this.memoryMode) {
        await this._recordExecutionThought(name, validatedArgs, 'afterExecution', result, duration);
      }

      if (this.enableEvents) {
        this.emit("tool-metrics", { tool: name, duration, success: true });
        this.emit("tool-end", { tool: name, id: toolCall.id, result });
      }

      // Debug logging
      if (this.debug) {
        console.log(`[DEBUG] Tool Execution Details:`);
        console.log(`[DEBUG] Tool Name: ${name}`);
        console.log(`[DEBUG] Tool Arguments:`, validatedArgs);
        console.log(`[DEBUG] Tool Result:`, result);
        console.log(`[DEBUG] Execution Time: ${duration}ms`);
      }

      // Update recent tool calls with success status
      this._updateRecentToolCalls([toolCall], true);

      return {
        role: "tool",
        content: typeof result === "object" ? JSON.stringify(result) : String(result),
        toolCallId: toolCall.id,
      };
    } catch (error) {
      // Update recent tool calls with failure status before handling error
      this._updateRecentToolCalls([toolCall], false);
      return this._handleToolError(error, toolCall, actionsTaken, userInput, retryCount, startTime, abortSignal);
    }
  }

  /**
   * Handle tool execution errors with retry logic and memory integration
   * @param {Error} error - Error object
   * @param {Object} toolCall - Tool call object
   * @param {Array} actionsTaken - Array to track actions
   * @param {string} userInput - User input for context
   * @param {number} retryCount - Current retry count
   * @param {number} startTime - Start time for duration calculation
   * @param {AbortSignal} abortSignal - Abort signal for cancellation
   * @returns {Promise<Object>} Tool result
   */
  async _handleToolError(error, toolCall, actionsTaken, userInput, retryCount, startTime, abortSignal) {
    const isRetriable = error.message?.includes("rate limit") || error.code === "ETIMEDOUT";
    const maxRetries = 2;

    if (isRetriable && retryCount < maxRetries) {
      if (this.debug) {
        console.log(`🔄 [TOOL RETRY] Retrying tool ${toolCall.function.name} (attempt ${retryCount + 1}/${maxRetries})`);
      }
      
      await new Promise((r) => setTimeout(r, Math.pow(2, retryCount) * 1000));
      return this.executeToolCall(toolCall, actionsTaken, userInput, retryCount + 1, abortSignal);
    }

    console.error(`Tool Error [${toolCall.function.name}]:`, error.message);

    // Memory integration: Record error insight
    if (this.memoryMode) {
      await this._recordErrorInsight(toolCall.function.name, error, retryCount);
    }

    return {
      role: "tool",
      name: toolCall.function.name,
      content: JSON.stringify({ status: "error", message: error.message }),
      toolCallId: toolCall.id,
    };
  }

  /**
   * Execute multiple tool calls with unified error handling and semantic loop detection
   * @param {Array} toolCalls - Array of tool call objects
   * @param {Array} actionsTaken - Array to track actions
   * @param {string} userInput - User input for context
   * @param {boolean} parallelToolCalls - Whether to execute in parallel
   * @param {AbortSignal} abortSignal - Abort signal for cancellation
   * @returns {Promise<{toolResults: Array, allCallsSuccessful: boolean}>}
   */
  async executeToolCalls(toolCalls, actionsTaken, userInput, parallelToolCalls, abortSignal) {
    // Semantic loop detection
    const semanticLoopResult = await this._checkSemanticLoops(toolCalls);
    if (semanticLoopResult.loopDetected) {
      if (this.debug) {
        console.warn(`⚠️ [SEMANTIC LOOP] Semantic loop detected for tools: ${semanticLoopResult.tools.join(', ')}`);
      }
      
      // Memory integration: Record semantic loop insight
      if (this.memoryMode) {
        await this._recordSemanticLoopInsight(semanticLoopResult);
      }
      
      return { toolResults: [], allCallsSuccessful: false };
    }

    if (parallelToolCalls) {
      const results = await Promise.all(
        toolCalls.map((toolCall) =>
          this.executeToolCall(toolCall, actionsTaken, userInput, 0, abortSignal)
        )
      );
      return { toolResults: results, allCallsSuccessful: results.every(r => !this._isToolFailure(r)) };
    } else {
      const results = [];
      let allSuccessful = true;
      
      for (const toolCall of toolCalls) {
        const result = await this.executeToolCall(toolCall, actionsTaken, userInput, 0, abortSignal);
        results.push(result);
        if (this._isToolFailure(result)) {
          allSuccessful = false;
        }
      }
      
      return { toolResults: results, allCallsSuccessful };
    }
  }

  /**
   * Check for semantic loops using Pinecone vector similarity
   * @param {Array} toolCalls - Array of tool calls to check
   * @returns {Promise<{loopDetected: boolean, tools: Array}>}
   */
  async _checkSemanticLoops(toolCalls) {
    if (!this.pineconeClient || toolCalls.length === 0) {
      return { loopDetected: false, tools: [] };
    }

    const loops = [];

    for (const toolCall of toolCalls) {
      try {
        const signature = `${toolCall.function.name}:${toolCall.function.arguments}`;
        const vector = await this._createVectorFromSignature(signature);
        
        // Query Pinecone for similar tool calls
        const queryResult = await this.pineconeClient.query({
          vector: vector,
          topK: 5,
          includeMetadata: true
        });

        // Check if any results exceed similarity threshold
        const similarCalls = queryResult.matches.filter(match => 
          match.score > this.semanticLoopThreshold
        );

        if (similarCalls.length > 0) {
          loops.push(toolCall.function.name);
          
          if (this.debug) {
            console.log(`🔍 [SEMANTIC LOOP] Found ${similarCalls.length} similar calls for ${toolCall.function.name} with score ${similarCalls[0].score}`);
          }
        }

        // Store current call in Pinecone for future comparisons
        await this.pineconeClient.upsert([{
          id: `toolCall_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          vector: vector,
          metadata: {
            toolName: toolCall.function.name,
            signature: signature,
            timestamp: Date.now()
          }
        }]);

      } catch (error) {
        console.warn(`Failed to check semantic loop for ${toolCall.function.name}:`, error);
      }
    }

    return { loopDetected: loops.length > 0, tools: loops };
  }

  /**
   * Create a vector representation from tool call signature
   * @param {string} signature - Tool call signature
   * @returns {Promise<Array>} - Vector representation
   */
  async _createVectorFromSignature(signature) {
    // Simple text embedding - could be enhanced with actual embedding model
    const text = signature.toLowerCase();
    const chars = text.split('');
    const vector = new Array(1536).fill(0); // Standard embedding dimension
    
    for (let i = 0; i < chars.length; i++) {
      const charCode = chars[i].charCodeAt(0);
      const index = i % vector.length;
      vector[index] += charCode / 255; // Normalize
    }
    
    return vector;
  }

  /**
   * Check for recursive tool call loops (syntactic)
   * @param {Array} toolCalls - Array of tool calls to check
   * @returns {boolean} - True if a loop is detected
   */
  detectToolCallLoop(toolCalls) {
    // If we have only one tool call, check if it matches the last failed call
    if (toolCalls.length === 1) {
      const call = toolCalls[0];
      const callSignature = `${call.function.name}:${call.function.arguments}`;

      // Check if this exact call was made in the last 2 steps and failed
      const recentMatches = this.recentToolCalls.filter(
        tc => tc.signature === callSignature && tc.success === false
      );

      if (recentMatches.length >= 2) {
        return true;
      }
    }

    return false;
  }

  /**
   * Update the record of recent tool calls
   * @param {Array} toolCalls - Array of tool calls
   * @param {boolean} success - Whether the calls succeeded
   */
  _updateRecentToolCalls(toolCalls, success) {
    // Add current tool calls to the beginning of the array
    const newCalls = toolCalls.map(tc => ({
      signature: `${tc.function.name}:${tc.function.arguments}`,
      success: success,
      timestamp: Date.now()
    }));

    this.recentToolCalls.unshift(...newCalls);

    // Keep only the most recent calls
    if (this.recentToolCalls.length > this.maxRecentCalls * 2) {
      this.recentToolCalls = this.recentToolCalls.slice(0, this.maxRecentCalls * 2);
    }
  }

  /**
   * Generate a Mermaid.js diagram for tool call flows
   * @param {Array} toolCalls - Array of tool calls
   * @returns {string} - Mermaid.js diagram string
   */
  generateMermaidDiagram(toolCalls) {
    let diagram = "```mermaid\ngraph TD\n";

    // Add user query node
    diagram += "  A[User Query] --> B{Tool Needed?}\n";

    // Add tool call nodes
    toolCalls.forEach((toolCall, index) => {
      const toolName = toolCall.function.name;
      const nodeId = `C${index}`;
      diagram += `  B -->|Yes| ${nodeId}[${toolName}]\n`;

      // If there are arguments, add them as a note
      if (toolCall.function.arguments) {
        const argsNodeId = `D${index}`;
        diagram += `  ${nodeId} --> ${argsNodeId}[${JSON.stringify(JSON.parse(toolCall.function.arguments))}]\n`;
      }
    });

    // Add final response node
    diagram += "  B -->|No| E[Generate Response]\n";

    // Connect tool results to final response
    toolCalls.forEach((_, index) => {
      const nodeId = `C${index}`;
      diagram += `  ${nodeId} --> E\n`;
    });

    diagram += "```";
    return diagram;
  }

  /**
   * Get the API tools array
   * @returns {Array} Array of API tool definitions
   */
  getApiTools() {
    return this.apiTools;
  }

  /**
   * Get the tool handlers map
   * @returns {Object} Map of tool names to handlers
   */
  getHandlers() {
    return this.handlers;
  }

  /**
   * Process taskProgress parameter to extract and validate progress information
   * @param {string} taskProgress - Markdown-formatted checklist string
   * @param {string} toolName - Name of the tool being executed
   * @param {Object} args - Tool arguments for context
   * @private
   */
  _processTaskProgress(taskProgress, toolName, args) {
    try {
      // Parse the markdown checklist
      const lines = taskProgress.split('\n').filter(line => line.trim());
      const progressItems = [];
      let completedCount = 0;
      let totalCount = 0;

      lines.forEach(line => {
        const trimmed = line.trim();
        // Match markdown checklist format: "- [ ] Item" or "- [x] Item" or "- [X] Item"
        const match = trimmed.match(/^\-\s*\[\s*([xX ])\s*\]\s*(.+)$/);
        if (match) {
          totalCount++;
          const status = match[1].toLowerCase() === 'x' ? 'completed' : 'pending';
          const description = match[2].trim();
          progressItems.push({
            description,
            status,
            tool: toolName
          });
          if (status === 'completed') completedCount++;
        }
      });

      // Emit progress event for observability
      if (this.enableEvents && progressItems.length > 0) {
        this.emit("task-progress", {
          tool: toolName,
          progress: progressItems,
          completed: completedCount,
          total: totalCount,
          percentage: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
        });
      }

      // Debug logging
      if (this.debug) {
        console.log(`[DEBUG] Task Progress for ${toolName}:`);
        console.log(`[DEBUG] Total items: ${totalCount}, Completed: ${completedCount}`);
        progressItems.forEach(item => {
          console.log(`[DEBUG] - [${item.status === 'completed' ? 'x' : ' '}] ${item.description}`);
        });
      }

    } catch (error) {
      // Don't throw error for taskProgress parsing issues, just log them
      if (this.debug) {
        console.log(`[DEBUG] Failed to parse taskProgress for ${toolName}:`, error.message);
      }
    }
  }

  /**
   * Record structured thought before/after tool execution
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Tool arguments
   * @param {string} phase - Execution phase ('beforeExecution' or 'afterExecution')
   * @param {Object} [result] - Tool result (for afterExecution)
   * @param {number} [duration] - Execution duration (for afterExecution)
   * @private
   */
  async _recordExecutionThought(toolName, args, phase, result, duration) {
    try {
      const thought = {
        content: this._generateThoughtContent(toolName, args, phase, result, duration),
        type: 'executionThought',
        mode: this.victorMode ? 'victor' : 'sentinel',
        metadata: {
          toolName,
          phase,
          duration,
          success: !this._isToolFailure({ content: JSON.stringify(result) }),
          timestamp: Date.now()
        }
      };

      if (this.debug) {
        console.log(`💭 [THOUGHT] Recording execution thought:`, thought);
      }

      // Use recordThought tool to record the thought
      if (this.agent.handlers?.recordThought) {
        await this.agent.handlers.recordThought(thought);
      }

      this.emit('execution-thought-recorded', thought);
    } catch (error) {
      console.warn('Failed to record execution thought:', error);
    }
  }

  /**
   * Generate thought content for tool execution
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Tool arguments
   * @param {string} phase - Execution phase
   * @param {Object} [result] - Tool result
   * @param {number} [duration] - Execution duration
   * @returns {string} - Generated thought content
   * @private
   */
  _generateThoughtContent(toolName, args, phase, result, duration) {
    if (phase === 'before_execution') {
      return `Preparing to execute tool "${toolName}" with arguments: ${JSON.stringify(args)}`;
    } else {
      const success = !this._isToolFailure({ content: JSON.stringify(result) });
      return `Completed tool "${toolName}" execution. Success: ${success}. Duration: ${duration}ms. Result: ${JSON.stringify(result)}`;
    }
  }

  /**
   * Record error insight for failed tool execution
   * @param {string} toolName - Name of the failed tool
   * @param {Error} error - Error object
   * @param {number} retryCount - Number of retries attempted
   * @private
   */
  async _recordErrorInsight(toolName, error, retryCount) {
    try {
      const insight = {
        content: `Tool "${toolName}" failed after ${retryCount + 1} attempts. Error: ${error.message}`,
        type: 'errorInsight',
        importance: this._calculateErrorImportance(error, retryCount),
        metadata: {
          toolName,
          errorType: error.constructor.name,
          retryCount,
          timestamp: Date.now()
        }
      };

      if (this.debug) {
        console.log(`🧠 [MEMORY] Recording error insight:`, insight);
      }

      // Use recordThought tool to record the insight
      if (this.agent.handlers?.recordThought) {
        await this.agent.handlers.recordThought(insight);
      }

      this.emit('error-insight-recorded', insight);
    } catch (error) {
      console.warn('Failed to record error insight:', error);
    }
  }

  /**
   * Record semantic loop detection insight
   * @param {Object} loopResult - Semantic loop detection result
   * @private
   */
  async _recordSemanticLoopInsight(loopResult) {
    try {
      const insight = {
        content: `Semantic loop detected for tools: ${loopResult.tools.join(', ')}. Preventing infinite recursion.`,
        type: 'semanticLoopInsight',
        importance: 9, // High importance
        metadata: {
          tools: loopResult.tools,
          timestamp: Date.now()
        }
      };

      if (this.debug) {
        console.log(`🧠 [MEMORY] Recording semantic loop insight:`, insight);
      }

      // Use recordThought tool to record the insight
      if (this.agent.handlers?.recordThought) {
        await this.agent.handlers.recordThought(insight);
      }

      this.emit('semantic-loop-insight-recorded', insight);
    } catch (error) {
      console.warn('Failed to record semantic loop insight:', error);
    }
  }

  /**
   * Calculate importance score for errors
   * @param {Error} error - Error object
   * @param {number} retryCount - Number of retries attempted
   * @returns {number} - Importance score (1-10)
   * @private
   */
  _calculateErrorImportance(error, retryCount) {
    let score = 3; // Base score

    // Increase score for retriable errors
    if (error.message?.includes("rate limit")) score += 2;
    if (error.code === "ETIMEDOUT") score += 2;

    // Increase score for multiple retries
    if (retryCount > 0) score += retryCount;

    // Cap at 10
    return Math.min(score, 10);
  }

  /**
   * Check if a tool result represents a failure
   * @param {*} result - The result from a tool handler
   * @returns {boolean} - True if the result indicates a failure
   */
  _isToolFailure(result) {
    if (!result) return true;
    // Structured error check
    if (result.status === 'error' || result.success === false) return true;
    // Fallback for string errors (refined to avoid false positives)
    if (typeof result === 'string' && result.startsWith("Error:")) return true;
    return false;
  }
}