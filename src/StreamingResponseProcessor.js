/**
 * Streaming Response Processor
 * Handles unified streaming message accumulation, tool call parsing, and memory integration
 * for both Victor (structured monologue) and Sentinel (batch processing) modes
 */
import { EventEmitter } from "events";

export class StreamingResponseProcessor extends EventEmitter {
  /**
   * Creates a new StreamingResponseProcessor instance
   * @param {Object} agent - The Agent instance providing context and tools
   */
  constructor(agent) {
    super();
    this.agent = agent;
    this.debug = agent.debug || false;
    
    // Progress tracking state - Map-based for atomic merging
    this.progressState = new Map();
    this.progressHistory = [];
    
    // Lightweight progress mode for Victor
    this.lightweightMode = false;
    
    // Batch processing state for Sentinel
    this.batchMode = false;
    this.batchType = null;
    
    // Memory integration state
    this.memoryMode = false;
    this.victorMode = false;
    this.sentinelMode = false;

    // API message sanitization helper to prevent invalid role payloads
    this.validRoles = new Set(['system', 'user', 'assistant', 'tool']);
  }

  _normalizeToolCall(tc) {
    return {
      id: tc.id || `call_${Date.now()}`,
      type: tc.type || 'function',
      function: {
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || ''
      }
    };
  }

  // Streaming extractor for the value of "final_reply" inside structured JSON
  // content. Emits unescaped characters to `emit` as they arrive across chunk
  // boundaries; stops at the closing quote. Silently ignores everything outside
  // the final_reply string (envelope braces, requested_tools, etc.).
  _makeFinalReplyStreamer(emit) {
    const KEY_PATTERN = /"final_reply"\s*:\s*"/;
    let state = 'SEEKING';
    let seekBuf = '';
    let escape = false;
    let collectingUnicode = false;
    let unicodeBuf = '';

    return function feed(chunk) {
      if (state === 'DONE' || !chunk) return;
      let i = 0;

      if (state === 'SEEKING') {
        seekBuf += chunk;
        const match = KEY_PATTERN.exec(seekBuf);
        if (!match) {
          if (seekBuf.length > 64) seekBuf = seekBuf.slice(-64);
          return;
        }
        state = 'IN_VALUE';
        const consumed = match.index + match[0].length;
        const beforeChunkLen = seekBuf.length - chunk.length;
        i = Math.max(0, consumed - beforeChunkLen);
        seekBuf = '';
      }

      let out = '';
      while (i < chunk.length) {
        const ch = chunk[i++];
        if (collectingUnicode) {
          unicodeBuf += ch;
          if (unicodeBuf.length === 4) {
            out += String.fromCharCode(parseInt(unicodeBuf, 16));
            unicodeBuf = '';
            collectingUnicode = false;
          }
          continue;
        }
        if (escape) {
          escape = false;
          switch (ch) {
            case '"':  out += '"';  break;
            case '\\': out += '\\'; break;
            case '/':  out += '/';  break;
            case 'n':  out += '\n'; break;
            case 'r':  out += '\r'; break;
            case 't':  out += '\t'; break;
            case 'b':  out += '\b'; break;
            case 'f':  out += '\f'; break;
            case 'u':  collectingUnicode = true; unicodeBuf = ''; break;
            default:   out += ch;
          }
          continue;
        }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"')  { state = 'DONE'; break; }
        out += ch;
      }

      if (out) emit(out);
    };
  }

  _sanitizeMessagesForApi(messages) {
    return (messages || []).map((msg) => {
      if (!msg || typeof msg !== 'object') return null;
      let role = typeof msg.role === 'string' ? msg.role.trim().toLowerCase() : null;
      if (!role) {
        if (msg.toolCallId) role = 'tool';
        else if (msg.toolCalls) role = 'assistant';
        else if (msg.content !== undefined) role = 'assistant';
      }
      if (!this.validRoles.has(role)) {
        if (this.debug) console.warn(`⚠️ Skipping invalid message role in stream payload: ${String(msg.role)}`);
        return null;
      }
      const normalized = { role, content: msg.content ?? '' };
      if (role === 'assistant' && Array.isArray(msg.toolCalls)) {
        normalized.toolCalls = msg.toolCalls.map(this._normalizeToolCall);
      }
      if (role === 'tool') {
        if (msg.toolCallId) normalized.toolCallId = msg.toolCallId;
      }
      return normalized;
    }).filter(Boolean);
  }

  /**
   * Set agent mode and configure processor accordingly
   * @param {string} mode - 'victor', 'sentinel', or 'standard'
   * @param {string} [batchType] - For Sentinel mode, specify batch type (e.g., 'triage')
   */
  setMode(mode, batchType = null) {
    this.victorMode = mode === 'victor';
    this.sentinelMode = mode === 'sentinel';
    this.batchType = batchType;
    
    // Configure modes
    this.lightweightMode = this.victorMode;
    this.batchMode = this.sentinelMode;
    this.memoryMode = this.victorMode || this.sentinelMode;
    
    if (this.debug) {
      console.log(`🔄 [PROCESSOR] Mode set to: ${mode}${batchType ? ` (${batchType})` : ''}`);
    }
  }

  /**
   * Process streaming API response with unified logic
   * @param {Object} stream - Streaming response from Mistral client
   * @param {Array} messages - Conversation messages
   * @param {Function} [onChunk] - Optional callback for each text token
   * @returns {Promise<{response: string, fullMessages: Array, rounds: number, status: string}>}
   */
  async processStreamResponse(stream, messages, onChunk) {
    if (this.debug) {
      console.log(`🔄 [PROCESSOR] Starting stream processing in ${this.victorMode ? 'Victor' : this.sentinelMode ? 'Sentinel' : 'Standard'} mode`);
    }

    // Memory integration: Recall relevant memories before planning
    if (this.memoryMode) {
      await this.beforePlanning(messages);
    }

    let currentStream = stream;
    let currentMessages = [...messages];
    let round = 1;
    const { model, loopDetector, maxRounds = 10 } = this.agent;

    while (round <= maxRounds) {
      if (this.debug) console.log(`🔄 [STREAM LOOP] Round ${round} started`);

      // Reset progress state for each new turn to ensure independent progress tracking
      this.agent.clearProgress();

      // Use camelCase: SDK outbound schema expects toolCalls
      let assistantMessage = { role: "assistant", content: "", toolCalls: [] };
      const toolCallAccumulator = new Map();

      // When responseFormat is active the model's content is structured JSON,
      // so route chunks through an extractor that surfaces only the unescaped
      // value of "final_reply" to the caller. Providers other than Mistral
      // don't receive responseFormat (see Agent._toOpenRouterChatRequest),
      // so they emit plain text and must bypass the extractor.
      const useExtractor = this.agent.provider !== 'openrouter' && !!this.agent.responseFormat;
      const feedFinalReply = (useExtractor && onChunk)
        ? this._makeFinalReplyStreamer(onChunk)
        : null;

      // Consume the stream
      for await (const chunk of currentStream) {
        const delta = chunk.data?.choices?.[0]?.delta || chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          assistantMessage.content += delta.content;
          if (feedFinalReply) feedFinalReply(delta.content);
          else if (onChunk) onChunk(delta.content);
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

    // Check if the response is a structured JSON
    let parsedContent;
    let isStructuredResponse = false;
    try {
      // Only attempt to parse as JSON if the content looks like JSON
      if (assistantMessage.content.trim().startsWith('{') && assistantMessage.content.trim().endsWith('}')) {
        parsedContent = JSON.parse(assistantMessage.content);
        isStructuredResponse = true;
      }
    } catch (e) {
      // Not a JSON response, proceed as usual
    }

    // If it's a structured response, handle it
    if (isStructuredResponse && parsedContent) {
        if (this.debug) console.log(`📊 [STREAM LOOP] Round ${round} - Structured response detected`);

        // Extract the final reply and requested tools
        const finalReply = parsedContent.final_reply;
        const requestedTools = parsedContent.requested_tools || [];

        // If there are no requested tools, return the final reply
        if (requestedTools.length === 0) {
          if (this.debug) console.log(`✅ [STREAM LOOP] Round ${round} completed - No requested tools, task finished`);

          // Memory integration: Commit final insights
          if (this.memoryMode) {
            await this.afterDecision({ content: finalReply }, { round, type: 'completion' });
          }

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
        const toolExecutionManager = this.agent.toolExecutionManager;
        if (!toolExecutionManager) {
          throw new Error("ToolExecutionManager not initialized");
        }

        const toolActions = [];
        const runResult = await toolExecutionManager.executeToolCalls(
          toolCalls,
          toolActions,
          this.agent.userInput || "",
          true, // parallel execution
          null // no abort signal
        );

        if (!runResult) {
          if (this.debug) console.warn(`⚠️ [STREAM LOOP] Round ${round} - Circuit breaker protection activated`);

          // Memory integration: Commit circuit breaker insight
          if (this.memoryMode) {
            await this.afterDecision({ content: "Circuit breaker protection activated" }, { round, type: 'circuitBreaker' });
          }

          return {
            response: "Circuit breaker protection activated: Some tools are temporarily unavailable due to repeated failures. Please refine your prompt.",
            fullMessages: currentMessages,
            rounds: round,
            status: "blocked"
          };
        }

        const { toolResults, allCallsSuccessful } = runResult;
        currentMessages.push(...toolResults);
        this.agent.loopDetector.updateRecentToolCalls(toolCalls, allCallsSuccessful);

        // Post-execution loop check
        if (this.agent.loopDetector.detectToolCallLoop(toolCalls).detected) {
          if (this.debug) console.warn(`⚠️ [STREAM LOOP] Round ${round} - Detected potential tool call loop after tool execution`);

          // Memory integration: Commit loop detection insight
          if (this.memoryMode) {
            await this.afterDecision({ content: "Loop detected: Agent stopped to prevent infinite recursion" }, { round, type: 'loopDetected' });
          }

          return {
            response: "Loop detected: Agent stopped to prevent infinite recursion.",
            fullMessages: currentMessages,
            rounds: round,
            status: "loopDetected"
          };
        }

        // Update progress tracking after tool execution
        this.updateTaskProgress();

        // Prepare for next round - sanitize messages for API compliance
        const apiMessages = this._sanitizeMessagesForApi(currentMessages);
        currentStream = await this.agent._makeStream({
          model: this.agent.model,
          messages: apiMessages,
          ...(this.agent.tools.length > 0 && { tools: this.agent.toolManager.getApiTools() }),
          ...(this.agent.responseFormat && { responseFormat: this.agent.responseFormat })
        });

        if (this.debug) console.log(`🔄 [STREAM LOOP] Round ${round} completed - Proceeding to round ${round + 1}`);
        round++;
        continue;
      }

      // Termination 1: Success - No tool calls
      if (!assistantMessage.toolCalls || assistantMessage.toolCalls.length === 0) {
        if (this.debug) console.log(`✅ [STREAM LOOP] Round ${round} completed - No tool calls, task finished`);

        // Memory integration: Commit final insights
        if (this.memoryMode) {
          await this.afterDecision({ content: assistantMessage.content }, { round, type: 'completion' });
        }

        return {
          response: assistantMessage.content,
          fullMessages: currentMessages,
          rounds: round,
          status: "success"
        };
      }

      // Termination 2: Hard Stop - Context limit
      if (!this._hasRoomForNextRound(currentMessages)) {
        if (this.debug) console.warn(`🛑 [STREAM LOOP] Round ${round} - Context limit reached`);
        
        // Memory integration: Commit context overflow insight
        if (this.memoryMode) {
          await this.afterDecision({ content: "Context limit reached" }, { round, type: 'contextOverflow' });
        }
        
        return { 
          response: "I have reached my context limit and stopped to prevent memory loss. Please start a new thread.", 
          fullMessages: currentMessages, 
          rounds: round, 
          status: "contextOverflow" 
        };
      }

      // Termination 3: Max rounds reached
      if (round >= maxRounds) {
        if (this.debug) console.warn(`⚠️ [STREAM LOOP] Round ${round} - Maximum rounds reached`);
        
        // Memory integration: Commit max rounds insight
        if (this.memoryMode) {
          await this.afterDecision({ content: `Maximum rounds (${maxRounds}) reached` }, { round, type: 'maxRounds' });
        }
        
        return { 
          response: `Maximum rounds (${maxRounds}) reached. Task may require manual intervention.`, 
          fullMessages: currentMessages, 
          rounds: round, 
          status: "maxRounds" 
        };
      }

      // Execute Tools with unified ToolExecutionManager
      const toolExecutionManager = this.agent.toolExecutionManager;
      if (!toolExecutionManager) {
        throw new Error("ToolExecutionManager not initialized");
      }

      const toolActions = [];
      const runResult = await toolExecutionManager.executeToolCalls(
        assistantMessage.toolCalls,
        toolActions,
        this.agent.userInput || "",
        true, // parallel execution
        null // no abort signal
      );

      if (!runResult) {
        if (this.debug) console.warn(`⚠️ [STREAM LOOP] Round ${round} - Circuit breaker protection activated`);
        
        // Memory integration: Commit circuit breaker insight
        if (this.memoryMode) {
          await this.afterDecision({ content: "Circuit breaker protection activated" }, { round, type: 'circuitBreaker' });
        }
        
        return { 
          response: "Circuit breaker protection activated: Some tools are temporarily unavailable due to repeated failures. Please refine your prompt.", 
          fullMessages: currentMessages, 
          rounds: round, 
          status: "blocked" 
        };
      }

      const { toolResults, allCallsSuccessful } = runResult;
      currentMessages.push(...toolResults);
      loopDetector.updateRecentToolCalls(assistantMessage.toolCalls, allCallsSuccessful);

      // Post-execution loop check
      if (loopDetector.detectToolCallLoop(assistantMessage.toolCalls).detected) {
        if (this.debug) console.warn(`⚠️ [STREAM LOOP] Round ${round} - Detected potential tool call loop after tool execution`);
        
        // Memory integration: Commit loop detection insight
        if (this.memoryMode) {
          await this.afterDecision({ content: "Loop detected: Agent stopped to prevent infinite recursion" }, { round, type: 'loopDetected' });
        }
        
        return { 
          response: "Loop detected: Agent stopped to prevent infinite recursion.", 
          fullMessages: currentMessages, 
          rounds: round, 
          status: "loopDetected" 
        };
      }

      // Update progress tracking after tool execution
      this.updateTaskProgress();

      // Prepare for next round - sanitize messages for API compliance
      const apiMessages = this._sanitizeMessagesForApi(currentMessages);
      currentStream = await this.agent._makeStream({
        model,
        messages: apiMessages,
        ...(this.agent.tools.length > 0 && { tools: this.agent.toolManager.getApiTools() }),
        ...(this.agent.responseFormat && { responseFormat: this.agent.responseFormat })
      });

      if (this.debug) console.log(`🔄 [STREAM LOOP] Round ${round} completed - Proceeding to round ${round + 1}`);
      round++;
    }

    // Final fallback
    if (this.memoryMode) {
      await this.afterDecision({ content: `Max rounds reached in stream processing` }, { round: maxRounds, type: 'fallback' });
    }
    
    return { 
      response: `Maximum rounds (${maxRounds}) reached. Task may require manual intervention.`, 
      fullMessages: currentMessages, 
      rounds: maxRounds, 
      status: "maxRounds" 
    };
  }

  /**
   * Process batch streaming for high-volume operations (Sentinel mode)
   * @param {Object} stream - Streaming response from Mistral client
   * @param {Array} messages - Conversation messages
   * @param {string} [batchType] - Type of batch processing (e.g., 'triage')
   * @param {Function} [onChunk] - Optional callback for each text token
   * @returns {Promise<{response: string, fullMessages: Array, rounds: number, status: string}>}
   */
  async processBatch(stream, messages, batchType = 'triage', onChunk) {
    if (!this.sentinelMode) {
      this.setMode('sentinel', batchType);
    }

    if (this.debug) {
      console.log(`🔄 [BATCH PROCESSOR] Starting batch processing for ${batchType}`);
    }

    // Record structured thought for batch start
    await this.recordStructuredThought(
      `Starting batch processing for ${batchType}. Optimizing for high-volume operations with parallel tool execution.`,
      'batchStart'
    );

    // Memory integration: Recall relevant batch processing memories
    await this.beforePlanning(messages);

    const result = await this.processStreamResponse(stream, messages, onChunk);

    // Record structured thought for batch completion
    await this.recordStructuredThought(
      `Completed batch processing for ${batchType}. Result status: ${result.status}. Rounds: ${result.rounds}.`,
      'batchCompletion'
    );

    // Memory integration: Commit batch processing insights
    await this.afterDecision(result, { batchType, rounds: result.rounds, status: result.status });

    return result;
  }

  /**
   * Memory integration: Recall relevant memories before planning
   * @param {Array} messages - Current conversation messages
   */
  async beforePlanning(messages) {
    try {
      if (!this.agent.storageManager) return;

      // Extract key topics from recent messages for memory recall
      const recentContent = messages.slice(-3).map(m => m.content || '').join(' ');
      const topics = this._extractTopics(recentContent);

      if (this.debug) {
        console.log(`🧠 [MEMORY] Recalling memories for topics: ${topics.join(', ')}`);
      }

      // Use recordThought tool to recall relevant memories
      if (this.agent.handlers?.recordThought) {
        const recallResult = await this.agent.handlers.recordThought({
        content: `Recall relevant memories for: ${topics.join(', ')}`,
        type: 'memoryRecall',
          topics: topics
        });

        if (this.debug) {
          console.log(`🧠 [MEMORY] Recall result:`, recallResult);
        }
      }
    } catch (error) {
      console.warn('Failed to recall memories:', error);
    }
  }

  /**
   * Memory integration: Commit insights to memory after decision
   * @param {Object} result - The result from tool execution or completion
   * @param {Object} context - Additional context about the decision
   */
  async afterDecision(result, context) {
    try {
      if (!this.agent.storageManager) return;

      const insight = {
        content: result.content || result.response || JSON.stringify(result),
        type: 'insight',
        importance: this._calculateImportance(result, context),
        context: {
          mode: this.victorMode ? 'victor' : this.sentinelMode ? 'sentinel' : 'standard',
          batchType: this.batchType,
          ...context
        },
        timestamp: Date.now()
      };

      if (this.debug) {
        console.log(`🧠 [MEMORY] Committing insight:`, insight);
      }

      // Use recordThought tool to commit insight to memory
      if (this.agent.handlers?.recordThought) {
        const commitResult = await this.agent.handlers.recordThought(insight);
        
        if (this.debug) {
          console.log(`🧠 [MEMORY] Commit result:`, commitResult);
        }
      }
    } catch (error) {
      console.warn('Failed to commit insight to memory:', error);
    }
  }

  /**
   * Record structured thoughts for Victor mode
   * @param {string} content - The thought content
   * @param {string} type - Type of thought (e.g., 'reasoning', 'observation', 'insight')
   */
  async recordStructuredThought(content, type = 'reasoning') {
    if (!this.victorMode && !this.sentinelMode) return;

    try {
      if (this.agent.handlers?.recordThought) {
        const thought = {
          content: content,
          type: type,
          mode: this.victorMode ? 'victor' : 'sentinel',
          timestamp: Date.now()
        };

        if (this.debug) {
          console.log(`💭 [THOUGHT] Recording structured thought:`, thought);
        }

        const result = await this.agent.handlers.recordThought(thought);
        
        if (this.debug) {
          console.log(`💭 [THOUGHT] Thought recorded successfully:`, result);
        }

        this.emit('structured-thought-recorded', thought);
      }
    } catch (error) {
      console.warn('Failed to record structured thought:', error);
    }
  }

  /**
   * Extract topics from text for memory operations
   * @param {string} text - Text to analyze
   * @returns {Array} - Array of extracted topics
   * @private
   */
  _extractTopics(text) {
    // Simple topic extraction - could be enhanced with NLP
    const topics = [];
    const lowerText = text.toLowerCase();
    
    // Common topic patterns
    const patterns = [
      /\b(email|inbox|message)\b/g,
      /\b(task|todo|project)\b/g,
      /\b(priority|urgent|important)\b/g,
      /\b(customer|client|user)\b/g,
      /\b(triage|classify|categorize)\b/g
    ];

    patterns.forEach(pattern => {
      const matches = lowerText.match(pattern);
      if (matches) {
        topics.push(...matches);
      }
    });

    return [...new Set(topics)]; // Remove duplicates
  }

  /**
   * Calculate importance score for insights
   * @param {Object} result - The result to score
   * @param {Object} context - Additional context
   * @returns {number} - Importance score (1-10)
   * @private
   */
  _calculateImportance(result, context) {
    let score = 5; // Base score

    // Increase score for completion events
    if (context.type === 'completion') score += 2;
    if (context.type === 'contextOverflow') score += 3;
    if (context.type === 'loopDetected') score += 4;

    // Increase score for batch processing
    if (context.batchType) score += 2;

    // Increase score for high round counts
    if (context.rounds && context.rounds > 5) score += 2;

    // Cap at 10
    return Math.min(score, 10);
  }

  /**
   * Parse progress from tool calls with lightweight mode support
   * @param {Array} toolCalls - Array of tool calls
   * @returns {Map<string, boolean>} - Parsed progress state
   * @private
   */
  _parseProgressFromToolCalls(toolCalls) {
    const states = [];

    for (const toolCall of toolCalls) {
      const argumentsStr = toolCall.function?.arguments;
      if (!argumentsStr) continue;

      try {
        const args = JSON.parse(argumentsStr);
        if (args.taskProgress) {
          states.push(this._parseProgressToMap(args.taskProgress));
        }
      } catch (parseError) {
        console.warn('Failed to parse tool call arguments:', parseError);
      }
    }

    // Merge states atomically
    return this._mergeProgressStates(states);
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
   * Update task progress with mode-specific handling
   * @private
   */
  updateTaskProgress() {
    // The Agent already updated this.agent.progressState via _captureProgressIntent
    // Check if all tasks in the Map are completed
    const state = this.agent.progressState;
    const allTasksCompleted = state.size > 0 && Array.from(state.values()).every(v => v === true);

    const progressUpdate = {
      progress: Array.from(state.entries()),
      allTasksCompleted,
      mode: this.victorMode ? 'victor' : this.sentinelMode ? 'sentinel' : 'standard'
    };

    this.emit('task-progress', progressUpdate);

    return progressUpdate;
  }

  /**
   * Check if there is room for another round of processing
   * @param {Array} messages - Current messages
   * @returns {boolean} - True if there is room
   * @private
   */
  _hasRoomForNextRound(messages) {
    const limit = this.agent.contextLimit || 128000;
    // Use js-tiktoken for accurate token counting (cl100k_base approximation for Mistral)
    const estimatedTokens = this.agent.countMessageTokens(messages);
    const buffer = 3000; // Buffer for the model's next response

    const hasRoom = (estimatedTokens + buffer) < limit;
    if (!hasRoom) {
      console.warn(`🛑 Context Hard-Stop: ${Math.round(estimatedTokens)} tokens used.`);
    }
    return hasRoom;
  }
}