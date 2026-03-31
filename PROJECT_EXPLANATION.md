# MR-BOT: AI Agent Framework

## Overview
MR-BOT is an AI agent framework built on top of the Mistral AI API. It provides a robust system for creating AI agents that can interact with users, execute tools, and manage complex workflows with features like progress tracking, circuit breakers, and loop detection.

## Core Components

### 1. Agent Class
The `Agent` class is the central component of the framework. It extends `EventEmitter` and provides two main execution modes:

- **Non-streaming mode**: `execute(history, userInput)` - Processes user input and returns a complete response
- **Streaming mode**: `executeStream(history, userInput, onChunk)` - Processes user input and streams the response

Key features of the Agent class:
- **Progress Tracking Protocol**: Automatically injects progress tracking instructions into the system prompt
- **Tool Management**: Handles tool execution with parallel processing support
- **Circuit Breaker Integration**: Prevents tool call loops and manages failures
- **Session Management**: Handles chat history and session persistence
- **Event System**: Emits events for tool execution, progress updates, and circuit breaker state changes

### 2. Supporting Classes

#### CircuitBreaker
- Prevents tool call loops and manages failure states
- Tracks tool call success/failure rates
- Implements cooldown periods for failed tools
- Supports global circuit breaker for system-wide protection

#### LoopDetector
- Detects potential infinite loops in tool calls
- Maintains history of recent tool calls
- Identifies patterns that could lead to loops

#### ToolManager
- Manages tool definitions and handlers
- Executes tool calls with retry logic
- Detects and prevents tool call loops
- Emits events for tool execution lifecycle

#### ResponseProcessor
- Processes API responses from Mistral
- Handles tool call execution and validation
- Manages response processing with token counting
- Validates tool call formats and arguments

#### StreamingResponseProcessor
- Handles streaming responses from Mistral
- Processes tool calls in streaming mode
- Manages progress tracking during streaming
- Supports batch processing modes

#### ToolExecutionManager
- Manages the execution of tool calls
- Implements semantic loop detection
- Handles tool execution errors and retries
- Records execution metrics and insights

## Technical Architecture

### Dependencies
The project uses several key dependencies:
- `@mistralai/mistralai`: Official Mistral AI client library
- `js-tiktoken`: Token counting utility
- `mongoose`: For data storage (though not fully implemented in the current codebase)
- `playwright`: For web automation capabilities
- `telegraf`: For Telegram bot integration
- `luxon` and `chrono-node`: For date/time handling
- `mathjs`: For mathematical operations

### Key Features

1. **Progress Tracking System**
   - Uses markdown checklist format for tracking task progress
   - Maintains progress history with timestamps
   - Validates progress format before updates
   - Emits events for progress changes

2. **Circuit Breaker Pattern**
   - Prevents cascading failures in tool execution
   - Tracks success/failure rates for individual tools
   - Implements cooldown periods for failed tools
   - Supports global circuit breaker for system protection

3. **Loop Detection**
   - Detects potential infinite loops in tool calls
   - Maintains history of recent tool calls
   - Implements semantic analysis of tool call patterns

4. **Tool Execution Management**
   - Supports parallel tool execution
   - Handles tool execution errors with retry logic
   - Validates tool call formats and arguments
   - Emits events for tool execution lifecycle

5. **Session Management**
   - Generates unique session IDs
   - Supports loading/saving chat history
   - Provides storage statistics and status

## Use Cases

MR-BOT is designed for building AI agents that can:
- Interact with users through chat interfaces
- Execute complex workflows using tools
- Maintain state and progress across interactions
- Handle errors and failures gracefully
- Prevent infinite loops and runaway processes
- Track and report progress on tasks

## Example Workflow

1. Initialize an Agent with configuration (API key, system prompt, tools)
2. Call `execute()` or `executeStream()` with user input
3. The agent processes the input using Mistral AI
4. If tools are required, the agent executes them with progress tracking
5. The circuit breaker monitors for failures or loops
6. Progress is updated and events are emitted throughout the process
7. The final response is returned to the user

## Potential Applications

- Chatbots and virtual assistants
- Automation systems
- Workflow management tools
- AI-powered research assistants
- Complex task automation

## Conclusion

MR-BOT provides a comprehensive framework for building robust AI agents with Mistral AI. Its focus on progress tracking, error handling, and loop prevention makes it suitable for complex, long-running tasks that require reliability and state management.