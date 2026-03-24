import { EventEmitter } from "events";

/**
 * Tool Manager
 * Handles tool registration, execution, validation, and management
 */
export class ToolManager extends EventEmitter {
  constructor() {
    super();
    this.handlers = {};
    this.apiTools = [];
    this.recentToolCalls = [];
    this.MAX_RECENT_CALLS = 3;
  }

  /**
   * Initialize tools from tool definitions
   * @param {Array} tools - Array of tool definitions
   */
  initializeTools(tools) {
    if (!tools || tools.length === 0) return;

    this.handlers = Object.fromEntries(tools.map((t) => [t.function.name, t.handler]));
    
    // Clone and modify the tool definitions to include task_progress as an optional parameter
    this.apiTools = tools.map(({ handler, function: toolFunction, ...tool }) => {
      // Clone the tool function to avoid modifying the original
      const modifiedToolFunction = { ...toolFunction };

      // If parameters are defined, add task_progress as an optional parameter
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

        // Ensure task_progress is not in the required array
        if (modifiedParameters.required) {
          modifiedParameters.required = modifiedParameters.required.filter(
            (param) => param !== "task_progress"
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
   * Execute a single tool call
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

      const result = await handler(validatedArgs, { agent: this.agent, userInput, signal: abortSignal });
      const duration = Date.now() - startTime;

      actionsTaken.push({ id: toolCall.id, tool: name, args: validatedArgs, result, duration, ts: new Date() });

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
        name,
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
   * Handle tool execution errors with retry logic
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
    const MAX_RETRIES = 2;

    if (isRetriable && retryCount < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, Math.pow(2, retryCount) * 1000));
      return this.executeToolCall(toolCall, actionsTaken, userInput, retryCount + 1, abortSignal);
    }

    console.error(`Tool Error [${toolCall.function.name}]:`, error.message);

    return {
      role: "tool",
      name: toolCall.function.name,
      content: JSON.stringify({ status: "error", message: error.message }),
      toolCallId: toolCall.id,
    };
  }

  /**
   * Execute multiple tool calls in parallel or sequentially
   * @param {Array} toolCalls - Array of tool call objects
   * @param {Array} actionsTaken - Array to track actions
   * @param {string} userInput - User input for context
   * @param {boolean} parallelToolCalls - Whether to execute in parallel
   * @param {AbortSignal} abortSignal - Abort signal for cancellation
   * @returns {Promise<Array>} Array of tool results
   */
  async executeToolCalls(toolCalls, actionsTaken, userInput, parallelToolCalls, abortSignal) {
    if (parallelToolCalls) {
      return await Promise.all(
        toolCalls.map((toolCall) =>
          this.executeToolCall(toolCall, actionsTaken, userInput, 0, abortSignal)
        )
      );
    } else {
      const results = [];
      for (const toolCall of toolCalls) {
        const result = await this.executeToolCall(toolCall, actionsTaken, userInput, 0, abortSignal);
        results.push(result);
      }
      return results;
    }
  }

  /**
   * Check for recursive tool call loops
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
    if (this.recentToolCalls.length > this.MAX_RECENT_CALLS * 2) {
      this.recentToolCalls = this.recentToolCalls.slice(0, this.MAX_RECENT_CALLS * 2);
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
   * Set agent reference for tool execution context
   * @param {Agent} agent - Agent instance
   */
  setAgent(agent) {
    this.agent = agent;
  }

  /**
   * Set debug mode
   * @param {boolean} debug - Debug mode flag
   */
  setDebug(debug) {
    this.debug = debug;
  }

  /**
   * Set enable events flag
   * @param {boolean} enableEvents - Enable events flag
   */
  setEnableEvents(enableEvents) {
    this.enableEvents = enableEvents;
  }

  /**
   * Process task_progress parameter to extract and validate progress information
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
      // Don't throw error for task_progress parsing issues, just log them
      if (this.debug) {
        console.log(`[DEBUG] Failed to parse task_progress for ${toolName}:`, error.message);
      }
    }
  }
}