/**
 * Response processing for Agent.
 * Handles tool call validation, circuit breaker-guarded execution,
 * and both regular and streaming API response processing.
 */
import { countMessageTokens } from './Tokenizer.js';

export class ResponseProcessor {
  /**
   * @param {Object} agent - The Agent instance (provides client, model,
   *   parallelToolCalls, handlers, circuitBreaker, loopDetector)
   */
  constructor(agent) {
    this.agent = agent;
    this.debug = agent.debug || false;
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
   * Executes a single tool call with Circuit Breaker protection.
   * @param {Object} toolCall
   * @returns {Promise<Object>} - Tool result message
   */
  async executeToolWithCircuitBreaker(toolCall) {
    const { circuitBreaker, handlers, loopDetector } = this.agent;

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

      // Process meta-arguments if present
      if (meta.taskProgress) {
        this.agent._captureProgressIntent({
          choices: [{
            message: {
              toolCalls: [{
                function: {
                  name: toolCall.function.name,
                  arguments: JSON.stringify({ taskProgress: meta.taskProgress })
                }
              }]
            }
          }]
        });
      }

      const result = await handler(validatedArgs);

      // Structured error detection
      if (this._isToolFailure(result)) {
        circuitBreaker.recordFailure(signature, 'Tool reported failure');
      } else {
        circuitBreaker.recordSuccess(signature);
      }

      return {
        role: "tool",
        content: typeof result === "object" ? JSON.stringify(result) : String(result),
        toolCallId: toolCall.id
      };
    } catch (error) {
      circuitBreaker.recordFailure(signature, `Tool execution error: ${error.message}`);
      console.error(`Error processing tool call ${toolCall.function.name}:`, error);
      return {
        role: "tool",
        content: JSON.stringify({ status: "error", message: error.message }),
        toolCallId: toolCall.id
      };
    }
  }

  /**
   * Check if a tool result represents a failure.
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

  /**
   * Monitors token usage. Returns true if there is enough room for another round.
   * @param {Array} messages
   * @returns {boolean}
   */
  _hasRoomForNextRound(messages) {
    const limit = this.agent.contextLimit || 128000;
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
    const { circuitBreaker, loopDetector, parallelToolCalls } = this.agent;
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
     let currentResponse = response;
     let currentMessages = [...messages];
     let round = 1;
     const { client, model, loopDetector, maxRounds = 10 } = this.agent;

     while (round <= maxRounds) {
       if (this.debug) console.log(`🔄 [REACT LOOP] Round ${round} started`);

       const assistantMsg = currentResponse.choices[0].message;
       currentMessages.push(assistantMsg);

       // Check if the response is a structured JSON
       let parsedContent;
       try {
         parsedContent = JSON.parse(assistantMsg.content);
       } catch (e) {
         // Not a JSON response, proceed as usual
       }

       // If it's a structured response, handle it
       if (parsedContent) {
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
         if (loopDetector.detectToolCallLoop(toolCalls).detected) {
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
        currentResponse = await client.chat.complete({
          model,
          messages: apiMessages,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "minimal_agent_response_schema",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    data: { type: "object" }
                  },
                  required: ["action"],
                  additionalProperties: false
                }
              }
            }
        });

         if (this.debug) console.log(`🔄 [REACT LOOP] Round ${round} completed - Proceeding to round ${round + 1}`);
         round++;
         continue;
       }

       // Termination condition 1: No tool calls - task completed
       const toolCalls = assistantMsg.toolCalls;
       if (!toolCalls || toolCalls.length === 0) {
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
       currentMessages.push(...toolResults); // Critical Fix: Update history with tool results
       loopDetector.updateRecentToolCalls(toolCalls, allCallsSuccessful);

       // Post-execution loop check
       if (loopDetector.detectToolCallLoop(toolCalls).detected) {
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
       currentResponse = await client.chat.complete({ model, messages: apiMessages });

       if (this.debug) console.log(`🔄 [REACT LOOP] Round ${round} completed - Proceeding to round ${round + 1}`);
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
   * Update task progress based on Agent's state and check for completion.
   * @returns {Object} - Progress update status
   */
  updateTaskProgress() {
    // The Agent already updated this.agent.progressState via _captureProgressIntent
    // Check if all tasks in the Map are completed
    const state = this.agent.progressState;
    const allTasksCompleted = state.size > 0 && Array.from(state.values()).every(v => v === true);

    return {
      progress: Array.from(state.entries()),
      allTasksCompleted
    };
  }

  // ---------------------------------------------------------------------------
  // processStreamResponse (streaming)
  // ---------------------------------------------------------------------------

  /**
   * Process streaming API response and handle tool calls iteratively.
   * @param {Object} stream - Streaming response
   * @param {Array} messages - Conversation messages
   * @param {Function} [onChunk] - Optional callback for each text token
   * @returns {Promise<{response: string, fullMessages: Array, rounds: number, status: string}>}
   */
  async processStreamResponse(stream, messages, onChunk) {
    let currentStream = stream;
    let currentMessages = [...messages];
    let round = 1;
    const { client, model, loopDetector, maxRounds = 10 } = this.agent;

    while (round <= maxRounds) {
      if (this.debug) console.log(`🔄 [STREAM REACT LOOP] Round ${round} started`);
      // Use camelCase: SDK outbound schema expects toolCalls
      let assistantMessage = { role: "assistant", content: "", toolCalls: [] };
      const toolCallAccumulator = new Map();

      // Consume the stream
      for await (const chunk of currentStream) {
        const delta = chunk.data?.choices?.[0]?.delta || chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          assistantMessage.content += delta.content;
          if (onChunk) onChunk(delta.content);
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

      // Finalize tool calls - preserve original IDs to avoid mismatch
      const accumulated = Array.from(toolCallAccumulator.values()).map((tc, i) => ({
        id: tc.id || `call_${Date.now()}_${i}`,
        type: "function",
        function: {
          name: tc.function?.name || "",
          arguments: tc.function?.arguments || ""
        }
      }));
      if (accumulated.length > 0) {
        assistantMessage.toolCalls = accumulated;
        // Keep tool-call assistant messages API-compliant
        assistantMessage.content = assistantMessage.content || "";
      } else {
        delete assistantMessage.toolCalls;
      }

      currentMessages.push(assistantMessage);

      // Termination 1: Success
      if (!assistantMessage.toolCalls || assistantMessage.toolCalls.length === 0) {
        return { response: assistantMessage.content, fullMessages: currentMessages, rounds: round, status: "success" };
      }

      // Termination 2: Hard Stop
      if (!this._hasRoomForNextRound(currentMessages)) {
        return { response: "Context limit reached.", fullMessages: currentMessages, rounds: round, status: "contextOverflow" };
      }

      // Termination 3: Loop Detection
      if (loopDetector.detectToolCallLoop(assistantMessage.toolCalls).detected) {
        return { response: "Loop detected.", fullMessages: currentMessages, rounds: round, status: "loopDetected" };
      }

      // Execute Tools
      const runResult = await this._runToolCalls(assistantMessage.toolCalls, 'streaming');
      if (!runResult) return { response: "Blocked by CB.", fullMessages: currentMessages, rounds: round, status: "blocked" };

      const normalizedToolResults = runResult.toolResults.map((msg) => ({
        role: "tool",
        content: msg.content || JSON.stringify({ status: "success", message: "Tool executed successfully" }),
        toolCallId: msg.toolCallId || msg.id
      }));

      currentMessages.push(...normalizedToolResults);
      loopDetector.updateRecentToolCalls(assistantMessage.toolCalls, runResult.allCallsSuccessful);

      const apiMessages = currentMessages.map((msg) => {
        const tcs = msg.toolCalls;
        if (msg.role === "assistant" && tcs) {
          return {
            role: "assistant",
            content: msg.content ?? "",
            toolCalls: tcs.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || ""
              }
            }))
          };
        }
        if (msg.role === "tool") {
          return {
            role: "tool",
            content: msg.content ?? "",
            toolCallId: msg.toolCallId
          };
        }
        return msg;
      });


      const nextStream = await client.chat.stream({
        model,
        messages: apiMessages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "minimal_agent_response_schema",
            strict: true,
            schema: {
              type: "object",
              properties: {
                action: { type: "string" },
                data: { type: "object" }
              },
              required: ["action"],
              additionalProperties: false
            }
          }
        },
        ...(this.agent.tools.length > 0 && { tools: this.agent.toolManager.getApiTools() })
      });
      
      // Continue with streaming processing
      const continuation = await this.processStreamResponse(nextStream, apiMessages, onChunk);
      
      return {
        response: continuation.response,
        fullMessages: continuation.fullMessages,
        rounds: round + continuation.rounds,
        status: continuation.status
      };
    }

    return { response: "Max rounds reached.", fullMessages: currentMessages, rounds: maxRounds, status: "maxRounds" };
  }
}