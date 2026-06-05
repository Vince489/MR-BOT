/**
 * Response processing for Agent.
 * Handles tool call validation, circuit breaker-guarded execution,
 * and both regular and streaming API response processing.
 */
import { countMessageTokens } from './Tokenizer.js';

export class ResponseProcessor {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.client - API client
   * @param {string} options.model - Model name
   * @param {Object} options.handlers - Tool handlers
   * @param {Object} options.circuitBreaker - Circuit breaker instance
   * @param {Object} options.loopDetector - Loop detector instance
   * @param {boolean} options.parallelToolCalls - Whether to execute tools in parallel
   * @param {number} [options.contextLimit=128000] - Token context limit
   * @param {number} [options.maxRounds=10] - Maximum processing rounds
   * @param {boolean} [options.debug=false] - Debug mode flag
   * @param {Object} [options.progressState] - Task progress state
   * @param {Array} [options.tools=[]] - Available tools
   * @param {Object} [options.toolManager] - Tool manager instance
   */
   constructor({
     client,
     model,
     handlers,
     circuitBreaker,
     loopDetector,
     parallelToolCalls,
     contextLimit = 128000,
     maxRounds = 10,
     debug = false,
     progressState = new Map(),
     tools = [],
     toolManager = null
   }) {
     this.client = client;
     this.model = model;
     this.handlers = handlers;
     this.circuitBreaker = circuitBreaker;
     this.loopDetector = loopDetector;
     this.parallelToolCalls = parallelToolCalls;
     this.contextLimit = contextLimit;
     this.maxRounds = maxRounds;
     this.debug = debug;
     this.progressState = progressState;
     this.tools = tools;
     this.toolManager = toolManager;

     // Track if thinking has occurred in this conversation
     this.thinkingOccurred = false;
   }

  /**
   * Normalize a message object for API consumption.
   * Filters invalid roles and normalizes assistant/tool payloads.
   * @param {Array} messages
   * @returns {Array}
   */
   _sanitizeMessagesForApi(messages) {
     const validRoles = new Set(['system', 'user', 'assistant', 'tool']);
     return (messages || []).map((msg) => {
       if (!msg || typeof msg !== 'object') return null;
       let role = typeof msg.role === 'string' ? msg.role.trim().toLowerCase() : null;
       if (!role) {
         if (msg.toolCallId) role = 'tool';
         else if (msg.toolCalls) role = 'assistant';
         else if (msg.content !== undefined) role = 'assistant';
       }
       if (!validRoles.has(role)) {
         if (this.debug) console.warn(`⚠️ Skipping invalid message role: ${String(msg.role)}`);
         return null;
       }
       const sanitized = { role, content: msg.content ?? '' };
       if (role === 'assistant' && Array.isArray(msg.toolCalls)) {
         sanitized.toolCalls = msg.toolCalls.map((tc) => ({
           id: tc.id || `call_${Date.now()}`,
           type: tc.type || 'function',
           function: {
             name: tc.function?.name || '',
             arguments: tc.function?.arguments || ''
           }
         }));
       }
       if (role === 'tool') {
         if (msg.toolCallId) sanitized.toolCallId = msg.toolCallId;
       }
       return sanitized;
     }).filter(Boolean);
   }

  // ---------------------------------------------------------------------------
  // Tool validation & execution
  // ---------------------------------------------------------------------------

  /**
   * Validates tool call structure and logs for debugging.
   * @param {Object} toolCall
   * @returns {boolean}
   */
   validateToolCall(toolCall) {
     if (!toolCall) {
       console.warn('⚠️ Invalid tool call: null or undefined');
       return false;
     }
     if (!toolCall.id) {
       console.warn(`⚠️ Tool call missing ID: ${toolCall.function?.name || 'unknown'}`);
       console.warn(`   Tool call structure:`, JSON.stringify(toolCall, null, 2));
       return false;
     }
     if (!toolCall.function) {
       console.warn(`⚠️ Tool call missing function: ID=${toolCall.id}`);
       return false;
     }
     if (!toolCall.function.name) {
       console.warn(`⚠️ Tool call function missing name: ID=${toolCall.id}`);
       return false;
     }
     return true;
   }

  /**
   * Intercepts and removes meta-arguments (like taskProgress) before validation.
   * @param {Object} args - Raw arguments from the LLM
   * @returns {{ cleanArgs: Object, meta: Object }}
   */
   _interceptMetaArguments(args) {
     const meta = {};
     const cleanArgs = { ...args };

     if ('taskProgress' in cleanArgs) {
       meta.taskProgress = cleanArgs.taskProgress;
       delete cleanArgs.taskProgress;
     }

     return { cleanArgs, meta };
   }

  /**
   * Determines if an error is retryable (transient) or not.
   * @param {Error} error - The error to check
   * @returns {boolean} - True if the error is retryable
   */
   _isRetryableError(error) {
     // Network-related errors
     if (error.message.includes('network') ||
         error.message.includes('timeout') ||
         error.message.includes('ECONN') ||
         error.message.includes('ETIMEDOUT') ||
         error.message.includes('ENOTFOUND') ||
         error.message.includes('fetch failed')) {
       return true;
     }

     // Rate limiting errors
     if (error.message.includes('rate limit') ||
         error.message.includes('too many requests') ||
         error.message.includes('429')) {
       return true;
     }

     // Service unavailable errors
     if (error.message.includes('503') ||
         error.message.includes('service unavailable') ||
         error.message.includes('maintenance')) {
       return true;
     }

     // Temporary server errors
     if (error.message.includes('500') ||
         error.message.includes('internal server error')) {
       return true;
     }

     // Non-retryable errors
     return false;
   }

  /**
   * Executes a single tool call with Circuit Breaker protection and retry mechanism.
   * @param {Object} toolCall
   * @returns {Promise<Object>} - Tool result message
   */
   async executeToolWithCircuitBreaker(toolCall) {
     const { circuitBreaker, handlers, loopDetector } = this;
     const maxRetries = 3; // Maximum number of retry attempts
     let retryCount = 0;

     if (!this.validateToolCall(toolCall)) {
       return {
         role: "tool",
         content: JSON.stringify({ status: "error", message: "Invalid tool call structure" }),
         toolCallId: toolCall.id
       };
     }

     const signature = loopDetector.getCallSignature(
       toolCall.function.name, toolCall.function.arguments
     );
     const allowResult = circuitBreaker.shouldAllowCall(signature);

     if (!allowResult.allow) {
       const cooldownRemaining = allowResult.cooldownRemaining || 0;
       const errorMessage =
         `Circuit breaker is OPEN for tool "${toolCall.function.name}". ` +
         `Please refine your prompt or wait ${Math.ceil(cooldownRemaining / 1000)} seconds.`;
       console.warn(`⚠️ Circuit breaker blocked tool call: ${toolCall.function.name}`);
       console.warn(`   Reason: ${allowResult.reason}`);
       console.warn(`   Cooldown remaining: ${cooldownRemaining}ms`);
       return {
         role: "tool",
         content: JSON.stringify({ status: "error", message: errorMessage }),
         toolCallId: toolCall.id
       };
     }

     while (retryCount < maxRetries) {
       try {
         const handler = handlers[toolCall.function.name];
         if (!handler) throw new Error(`No handler for tool: ${toolCall.function.name}`);

         const args = JSON.parse(toolCall.function.arguments || "{}");

         // Extract meta-arguments using the helper method
         const { cleanArgs, meta } = this._interceptMetaArguments(args);

         let validatedArgs = cleanArgs;

         // Reattach meta-arguments to validated args if they were provided
         if (meta.taskProgress !== undefined) {
           validatedArgs.taskProgress = meta.taskProgress;
         }

         const result = await handler(validatedArgs, {
           agent: this.agent,
           userInput: this.agent.userInput,
           signal: null
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
         return this._handleToolError(error, toolCall, actionsTaken, this.agent.userInput, retryCount, startTime, null);
       }
     }

     // This line should theoretically never be reached due to the return statements in the catch block
     return {
       role: "tool",
       content: JSON.stringify({
         status: "error",
         message: `Tool call failed after ${maxRetries} attempts`
       }),
       toolCallId: toolCall.id
     };
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

     return {
       role: "tool",
       name: toolCall.function.name,
       content: JSON.stringify({ status: "error", message: error.message }),
       toolCallId: toolCall.id,
     };
   }

  /**
   * Executes tool calls and handles the results.
   *
   * @param {Array} toolCalls - Array of tool calls to execute
   * @param {Array} currentMessages - Current conversation messages
   * @param {number} round - Current round number
   * @param {Object} loopDetector - Loop detector instance
   * @returns {Promise<Object|null>} - Result object if processing is complete, null otherwise
   */
   async _executeToolsAndUpdateState(toolCalls, currentMessages, round, loopDetector) {
     // Check if thought tool was used
     for (const toolCall of toolCalls) {
       if (toolCall.function.name === "recordThought") {
         this.thinkingOccurred = true;
         break;
       }
     }

     // Execute tools with circuit breaker
     const runResult = await this._runToolCalls(toolCalls, 'recursive');
     if (!runResult) {
       if (this.debug) console.warn(`⚠️ [REACT LOOP] Round ${round} - Circuit breaker protection activated`);
       return {
         response: "Circuit breaker protection activated: Some tools are temporarily unavailable due to repeated failures. Please refine your prompt.",
         fullMessages: currentMessages,
         rounds: round,
         status: "blocked"
       };
     }

     const { toolResults, allCallsSuccessful } = runResult;
     currentMessages.push(...toolResults);
     loopDetector.updateRecentToolCalls(toolCalls, allCallsSuccessful);

     // Post-execution loop check
     if (loopDetector.detectToolCallLoop(toolCalls)) {
       if (this.debug) console.warn(`⚠️ [REACT LOOP] Round ${round} - Detected potential tool call loop after tool execution. Forcing termination.`);
       return {
         response: "Loop detected: Agent stopped to prevent infinite recursion.",
         fullMessages: currentMessages,
         rounds: round,
         status: "loopDetected"
       };
     }

     // Update progress tracking after tool execution
     this.updateTaskProgress();

     return null;
   }

  /**
   * Checks termination conditions for the current round.
   * Returns a result object if any termination condition is met, otherwise returns null.
   *
   * @param {Object} assistantMsg - The assistant's message object
   * @param {Array} currentMessages - Current conversation messages
   * @param {number} round - Current round number
   * @param {number} maxRounds - Maximum allowed rounds
   * @returns {Object|null} - Result object if termination condition is met, null otherwise
   */
   _checkTerminationConditions(assistantMsg, currentMessages, round, maxRounds) {
     const toolCalls = assistantMsg.toolCalls;

     // Termination condition 1: No tool calls - task completed
     // But only if we have no tools available OR thinking has occurred
     if (!toolCalls || toolCalls.length === 0) {
       // If tools are available and no thinking has occurred yet, enforce tool usage
       if (this.tools && this.tools.length > 0 && !this.thinkingOccurred) {
         if (this.debug) console.warn(`⚠️ [REACT LOOP] Round ${round} - Direct response attempted without thinking. Enforcing thought tool usage.`);

         // Add a system message to guide the AI to use the thought tool
         currentMessages.push({
           role: "system",
           content: "You must use the thought tool to record your thinking before providing any direct response. This ensures proper reasoning and transparency."
         });

         return null; // Continue processing to force tool usage
       }
       if (this.debug) console.log(`✅ [REACT LOOP] Round ${round} completed - No tool calls, task finished`);
       return {
         response: assistantMsg.content,
         fullMessages: currentMessages,
         rounds: round,
         status: "success"
       };
     }

     // Termination: Hard Stop on Context
     if (!this._hasRoomForNextRound(currentMessages)) {
       return {
         response: "I have reached my context limit and stopped to prevent memory loss. Please start a new thread.",
         fullMessages: currentMessages,
         rounds: round,
         status: "contextOverflow"
       };
     }

     // Termination condition 2: Max rounds reached
     if (round >= maxRounds) {
       if (this.debug) console.warn(`⚠️ [REACT LOOP] Round ${round} - Maximum rounds reached. Task may require manual intervention.`);
       return {
         response: `Maximum rounds (${maxRounds}) reached. Task may require manual intervention.`,
         fullMessages: currentMessages,
         rounds: round,
         status: "maxRounds"
       };
     }

     // No termination condition met, continue processing
     return null;
   }

  /**
   * Prepares for the next round of processing.
   *
   * @param {Array} currentMessages - Current conversation messages
   * @param {Object} currentResponse - Current API response (will be updated)
   * @param {number} round - Current round number
   * @param {Object} client - API client
   * @param {string} model - Model name
   * @returns {Promise<void>}
   */
   async _prepareForNextRound(currentMessages, currentResponse, round, client, model) {
     // Prepare for next round
     const apiMessages = this._sanitizeMessagesForApi(currentMessages);
     const nextResponse = await client.chat.complete({
       model,
       messages: apiMessages,
       tools: this.toolManager?.getApiTools()
     });

     if (this.debug) console.log(`🔄 [REACT LOOP] Round ${round} completed - Proceeding to round ${round + 1}`);

     // Update the currentResponse reference
     Object.assign(currentResponse, nextResponse);
   }

  // ---------------------------------------------------------------------------
  // processResponse (non-streaming)
  // ---------------------------------------------------------------------------

  /**
   * Process API response and handle tool calls with Circuit Breaker integration.
   * @param {Object} response - API response
   * @param {Array} messages - Conversation messages
   * @returns {Promise<{response: string, fullMessages: Array, rounds: number, status: string}>}
   */
   async processResponse(response, messages) {
     // Reset thinking tracking for new conversation
     this.thinkingOccurred = false;

     let currentResponse = response;
     let currentMessages = [...messages];
     let round = 1;
     const { client, model, loopDetector, maxRounds = 10 } = this;

     while (round <= maxRounds) {
       if (this.debug) console.log(`🔄 [REACT LOOP] Round ${round} started`);

       const assistantMsg = currentResponse.choices[0].message;
       currentMessages.push(assistantMsg);

       // Check if thought tool was used
       if (assistantMsg.toolCalls) {
         for (const toolCall of assistantMsg.toolCalls) {
           if (toolCall.function.name === "recordThought") {
             this.thinkingOccurred = true;
             break;
           }
         }
       }

       // Handle structured or unstructured response
       const structuredResponseResult = await this._handleStructuredResponse(
         assistantMsg, currentMessages, round, currentResponse, messages
       );

       if (structuredResponseResult) {
         // If we got a result from structured response handling, return it
         return structuredResponseResult;
       }

       // Check termination conditions
       const terminationResult = this._checkTerminationConditions(
         assistantMsg, currentMessages, round, maxRounds
       );

       if (terminationResult) {
         return terminationResult;
       }

       const toolCalls = assistantMsg.toolCalls;

       // Execute tools and update state
       const toolExecutionResult = await this._executeToolsAndUpdateState(
         toolCalls, currentMessages, round, loopDetector
       );

       if (toolExecutionResult) {
         return toolExecutionResult;
       }

       // Prepare for next round
       await this._prepareForNextRound(
         currentMessages, currentResponse, round, client, model
       );

       round++;
     }

     return {
       response: `Maximum rounds (${maxRounds}) reached. Task may require manual intervention.`,
       fullMessages: currentMessages,
       rounds: maxRounds,
       status: "maxRounds"
     };
   }

  /**
   * Handles structured JSON responses from the API.
   * Extracts final reply and requested tools, executes tools if needed,
   * and prepares for the next round or returns the final result.
   *
   * @param {Object} assistantMsg - The assistant's message object
   * @param {Array} currentMessages - Current conversation messages
   * @param {number} round - Current round number
   * @param {Object} currentResponse - Current API response
   * @param {Array} originalMessages - Original messages array
   * @returns {Promise<Object|null>} - Result object if processing is complete, null otherwise
   */
   async _handleStructuredResponse(assistantMsg, currentMessages, round, currentResponse, originalMessages) {
     // Check if the response is a structured JSON
     let parsedContent;
     try {
       parsedContent = JSON.parse(assistantMsg.content);
     } catch (e) {
       // Not a JSON response, proceed with regular flow
       return null;
     }

     if (this.debug) console.log(`📊 [REACT LOOP] Round ${round} - Structured response detected`);

     // Extract the final reply and requested tools
     const finalReply = parsedContent.final_reply;
     const requestedTools = parsedContent.requested_tools || [];

     // If there are no requested tools, return the final reply
     if (requestedTools.length === 0) {
       if (this.debug) console.log(`✅ [REACT LOOP] Round ${round} completed - No requested tools, task finished`);
       return {
         response: finalReply,
         fullMessages: currentMessages,
         rounds: round,
         status: "success"
       };
     }

     // Convert requested tools to tool calls format
     const toolCalls = requestedTools.map((tool, index) => ({
       id: `call_${Date.now()}_${index}`,
       type: "function",
       function: {
         name: tool.tool,
         arguments: JSON.stringify(tool.arguments)
       }
     }));

     // Execute Tools with unified ToolExecutionManager
     const toolExecutionManager = this;
     const runResult = await this._runToolCalls(toolCalls, 'recursive');

     if (!runResult) {
       if (this.debug) console.warn(`⚠️ [REACT LOOP] Round ${round} - Circuit breaker protection activated`);
       return {
         response: "Circuit breaker protection activated: Some tools are temporarily unavailable due to repeated failures. Please refine your prompt.",
         fullMessages: currentMessages,
         rounds: round,
         status: "blocked"
       };
     }

     const { toolResults, allCallsSuccessful } = runResult;
     currentMessages.push(...toolResults);
     this.loopDetector.updateRecentToolCalls(toolCalls, allCallsSuccessful);

     // Post-execution loop check
     if (this.loopDetector.detectToolCallLoop(toolCalls)) {
       if (this.debug) console.warn(`⚠️ [REACT LOOP] Round ${round} - Detected potential tool call loop after tool execution. Forcing termination.`);
       return {
         response: "Loop detected: Agent stopped to prevent infinite recursion.",
         fullMessages: currentMessages,
         rounds: round,
         status: "loopDetected"
       };
     }

     // Update progress tracking after tool execution
     this.updateTaskProgress();

     // Prepare for next round
     const apiMessages = this._sanitizeMessagesForApi(currentMessages);
     const nextResponse = await this.client.chat.complete({
       model: this.model,
       messages: apiMessages,
       tools: this.toolManager?.getApiTools()
     });

     if (this.debug) console.log(`🔄 [REACT LOOP] Round ${round} completed - Proceeding to round ${round + 1}`);

     // Update the currentResponse reference in the caller
     Object.assign(currentResponse, nextResponse);

     // Return null to indicate we should continue with the next iteration
     return null;
   }

  /**
   * Monitors token usage. Returns true if there is enough room for another round.
   * @param {Array} messages
   * @returns {boolean}
   */
   _hasRoomForNextRound(messages) {
     const limit = this.contextLimit || 128000;
     // Use js-tiktoken for accurate token counting (cl100k_base approximation for Mistral)
     const estimatedTokens = countMessageTokens(messages);
     const buffer = 3000; // Buffer for the model's next response

     const hasRoom = (estimatedTokens + buffer) < limit;
     if (!hasRoom) {
       console.warn(`🛑 Context Hard-Stop: ${Math.round(estimatedTokens)} tokens used.`);
     }
     return hasRoom;
   }

  // ---------------------------------------------------------------------------
  // Shared helper: run tool calls (parallel or sequential) and check CB
  // ---------------------------------------------------------------------------

  /**
   * Checks circuit breaker for all tool calls, then executes them.
   * Returns null if blocked (caller should return early), otherwise the results array.
   *
   * Note: By default, tool calls are assumed to be independent and can be executed in parallel.
   * If tools have dependencies (e.g., ToolB requires the output of ToolA), set `parallelToolCalls: false`
   * in the agent configuration to ensure sequential execution.
   *
   * @param {Array} toolCalls
   * @param {string} context - 'non-streaming' | 'streaming' for log messages
   * @returns {Promise<{toolResults: Array, allCallsSuccessful: boolean}|null>}
   */
   async _runToolCalls(toolCalls, context = '') {
     const { circuitBreaker, loopDetector, parallelToolCalls } = this;
     const suffix = context ? ` in ${context} response` : '';

     const toolCallSignatures = toolCalls.map(tc =>
       loopDetector.getCallSignature(tc.function.name, tc.function.arguments)
     );
     const blockedCalls = toolCallSignatures.filter(sig => !circuitBreaker.shouldAllowCall(sig).allow);

     if (blockedCalls.length > 0) {
       console.warn(`⚠️ Circuit breaker blocked ${blockedCalls.length} tool call(s)${suffix}.`);
       return null; // Signal caller to return early
     }

     // Execute tool calls (parallel or sequential)
     const toolResults = await this._executeToolCalls(toolCalls, parallelToolCalls);

     // Check if all calls were successful
     const allCallsSuccessful = toolResults.every(result =>
       !this._isToolFailure(JSON.parse(result.content))
     );

     return { toolResults, allCallsSuccessful };
   }

  /**
   * Executes tool calls either in parallel or sequentially.
   * @param {Array} toolCalls - Array of tool calls to execute
   * @param {boolean} parallel - Whether to execute in parallel
   * @returns {Promise<Array>} - Array of tool result messages
   */
   async _executeToolCalls(toolCalls, parallel) {
     if (parallel) {
       // Parallel execution for independent tools
       return Promise.all(toolCalls.map(tc => this.executeToolWithCircuitBreaker(tc)));
     } else {
       // Sequential execution for potentially dependent tools
       const results = [];
       for (const toolCall of toolCalls) {
         results.push(await this.executeToolWithCircuitBreaker(toolCall));
       }
       return results;
     }
   }

  /**
   * Update task progress based on progress state and check for completion.
   * @returns {Object} - Progress update status
   */
   updateTaskProgress() {
     // Check if all tasks in the Map are completed
     const state = this.progressState;
     const allTasksCompleted = state.size > 0 && Array.from(state.values()).every(v => v === true);

     return {
       progress: Array.from(state.entries()),
       allTasksCompleted
     };
   }
}