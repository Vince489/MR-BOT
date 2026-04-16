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
    this.recenttool_calls = [];
    this.maxRecentCalls = 3;
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
   * Execute a single tool call
   * @param {Object} tool_call - Tool call object
   * @param {Array} actionsTaken - Array to track actions
   * @param {string} userInput - User input for context
   * @param {number} retryCount - Current retry count
   * @param {AbortSignal} abortSignal - Abort signal for cancellation
   * @returns {Promise<Object>} Tool result
   */
  async executetool_call(tool_call, actionsTaken, userInput, retryCount = 0, abortSignal) {
    // Handle both camelCase and snake_case
    const functionName = tool_call.function?.name || tool_call.functionName;
    const rawArgs = tool_call.function?.arguments || tool_call.functionArguments;
    const startTime = Date.now();

    if (this.enableEvents) this.emit("tool-start", { tool: functionName, id: tool_call.id });

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
        this._processTaskProgress(taskProgress, functionName, validatedArgs);
      }

      const handler = this.handlers[functionName];
      if (!handler) throw new Error(`Handler for "${functionName}" not found`);

      const result = await handler(validatedArgs, { agent: this.agent, userInput, signal: abortSignal });
      const duration = Date.now() - startTime;

      actionsTaken.push({ id: tool_call.id, tool: functionName, args: validatedArgs, result, duration, ts: new Date() });

      if (this.enableEvents) {
        this.emit("tool-metrics", { tool: functionName, duration, success: true });
        this.emit("tool-end", { tool: functionName, id: tool_call.id, result });
      }

      // Debug logging
      if (this.debug) {
        console.log(`[DEBUG] Tool Execution Details:`);
        console.log(`[DEBUG] Tool Name: ${functionName}`);
        console.log(`[DEBUG] Tool Arguments:`, validatedArgs);
        console.log(`[DEBUG] Tool Result:`, result);
        console.log(`[DEBUG] Execution Time: ${duration}ms`);
      }

      // Update recent tool calls with success status
      this._updateRecenttool_calls([tool_call], true);

      return {
        role: "tool",
        name: functionName,
        content: typeof result === "object" ? JSON.stringify(result) : String(result),
        tool_call_id: tool_call.id,
      };
    } catch (error) {
      // Update recent tool calls with failure status before handling error
      this._updateRecenttool_calls([tool_call], false);
      return this._handleToolError(error, tool_call, actionsTaken, userInput, retryCount, startTime, abortSignal);
    }
  }

  /**
   * Handle tool execution errors with retry logic
   * @param {Error} error - Error object
   * @param {Object} tool_call - Tool call object
   * @param {Array} actionsTaken - Array to track actions
   * @param {string} userInput - User input for context
   * @param {number} retryCount - Current retry count
   * @param {number} startTime - Start time for duration calculation
   * @param {AbortSignal} abortSignal - Abort signal for cancellation
   * @returns {Promise<Object>} Tool result
   */
  async _handleToolError(error, tool_call, actionsTaken, userInput, retryCount, startTime, abortSignal) {
    // Handle both camelCase and snake_case
    const functionName = tool_call.function?.name || tool_call.functionName;

    const isRetriable = error.message?.includes("rate limit") || error.code === "ETIMEDOUT";
    const maxRetries = 2;

    if (isRetriable && retryCount < maxRetries) {
      await new Promise((r) => setTimeout(r, Math.pow(2, retryCount) * 1000));
      return this.executetool_call(tool_call, actionsTaken, userInput, retryCount + 1, abortSignal);
    }

    console.error(`Tool Error [${functionName}]:`, error.message);

    return {
      role: "tool",
      name: functionName,
      content: JSON.stringify({ status: "error", message: error.message }),
      tool_call_id: tool_call.id,
    };
  }

  /**
   * Execute multiple tool calls in parallel or sequentially
   * @param {Array} tool_calls - Array of tool call objects
   * @param {Array} actionsTaken - Array to track actions
   * @param {string} userInput - User input for context
   * @param {boolean} paralleltool_calls - Whether to execute in parallel
   * @param {AbortSignal} abortSignal - Abort signal for cancellation
   * @returns {Promise<Array>} Array of tool results
   */
  async executetool_calls(tool_calls, actionsTaken, userInput, paralleltool_calls, abortSignal) {
    if (paralleltool_calls) {
      return await Promise.all(
        tool_calls.map((tool_call) =>
          this.executetool_call(tool_call, actionsTaken, userInput, 0, abortSignal)
        )
      );
    } else {
      const results = [];
      for (const tool_call of tool_calls) {
        const result = await this.executetool_call(tool_call, actionsTaken, userInput, 0, abortSignal);
        results.push(result);
      }
      return results;
    }
  }

  /**
   * Check for recursive tool call loops
   * @param {Array} tool_calls - Array of tool calls to check
   * @returns {boolean} - True if a loop is detected
   */
  detecttool_callLoop(tool_calls) {
    // If we have only one tool call, check if it matches the last failed call
    if (tool_calls.length === 1) {
      const call = tool_calls[0];
      // Handle both camelCase and snake_case
      const functionName = call.function?.name || call.functionName;
      const functionArgs = call.function?.arguments || call.functionArguments;
      const callSignature = `${functionName}:${functionArgs}`;

      // Check if this exact call was made in the last 2 steps and failed
      const recentMatches = this.recenttool_calls.filter(
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
   * @param {Array} tool_calls - Array of tool calls
   * @param {boolean} success - Whether the calls succeeded
   */
  _updateRecenttool_calls(tool_calls, success) {
    // Add current tool calls to the beginning of the array
    const newCalls = tool_calls.map(tc => {
      // Handle both camelCase and snake_case
      const functionName = tc.function?.name || tc.functionName;
      const functionArgs = tc.function?.arguments || tc.functionArguments;
      return {
        signature: `${functionName}:${functionArgs}`,
        success: success,
        timestamp: Date.now()
      };
    });

    this.recenttool_calls.unshift(...newCalls);

    // Keep only the most recent calls
    if (this.recenttool_calls.length > this.maxRecentCalls * 2) {
      this.recenttool_calls = this.recenttool_calls.slice(0, this.maxRecentCalls * 2);
    }
  }

  /**
   * Generate a Mermaid.js diagram for tool call flows
   * @param {Array} tool_calls - Array of tool calls
   * @returns {string} - Mermaid.js diagram string
   */
  generateMermaidDiagram(tool_calls) {
    let diagram = "```mermaid\ngraph TD\n";

    // Add user query node
    diagram += "  A[User Query] --> B{Tool Needed?}\n";

    // Add tool call nodes
    tool_calls.forEach((tool_call, index) => {
      // Handle both camelCase and snake_case
      const functionName = tool_call.function?.name || tool_call.functionName;
      const nodeId = `C${index}`;
      diagram += `  B -->|Yes| ${nodeId}[${functionName}]\n`;

      // If there are arguments, add them as a note
      const functionArgs = tool_call.function?.arguments || tool_call.functionArguments;
      if (functionArgs) {
        const argsNodeId = `D${index}`;
        try {
          diagram += `  ${nodeId} --> ${argsNodeId}[${JSON.stringify(JSON.parse(functionArgs))}]\n`;
        } catch (e) {
          diagram += `  ${nodeId} --> ${argsNodeId}[${functionArgs}]\n`;
        }
      }
    });

    // Add final response node
    diagram += "  B -->|No| E[Generate Response]\n";

    // Connect tool results to final response
    tool_calls.forEach((_, index) => {
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
}