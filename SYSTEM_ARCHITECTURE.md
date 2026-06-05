# MR-BOT System Architecture

## Overview

MR-BOT is an advanced AI agent system that combines planning, execution, and robust error handling to manage complex tasks. This document explains how the various components work together to provide a reliable and transparent workflow.

## Core Components

### 1. Agent Class

The `Agent` class is the central component that orchestrates all operations. It handles:

- **Task Analysis**: Determines if a task requires planning
- **Plan Creation & Execution**: Manages structured workflows for complex tasks
- **Tool Management**: Coordinates the use of various tools
- **Progress Tracking**: Maintains state throughout task execution
- **Error Handling**: Implements fallback mechanisms for failed operations

### 2. Planning System

The planning system enables MR-BOT to handle complex, multi-step tasks:

- **Task Complexity Analysis**: Uses heuristics to determine if planning is needed
- **Plan Creation**: Generates structured plans with steps, dependencies, and validation criteria
- **Plan Execution**: Follows the plan step-by-step, validating each step's output
- **Fallback Handling**: Executes predefined recovery actions when steps fail

### 3. Response Processor

The `ResponseProcessor` handles API responses and tool execution:

- **Tool Call Validation**: Ensures tool calls are properly structured
- **Circuit Breaker Integration**: Prevents repeated failures
- **Fallback Handling**: Processes fallback scenarios from the planning tool
- **Progress Tracking**: Updates task progress based on tool results

### 4. Tool Management

The system includes various tools for different purposes:

- **Planning Tool**: Manages plan creation, execution, and validation
- **Thought Tool**: Records reasoning and analysis
- **Domain-Specific Tools**: For tasks like data collection, processing, validation

## Workflow

### Simple Task Execution

For straightforward tasks:

1. User provides input
2. Agent analyzes the task and determines it doesn't need planning
3. Agent executes the task directly using appropriate tools
4. Agent returns the result to the user

### Complex Task Execution with Planning

For complex, multi-step tasks:

1. **Task Analysis**:
   - User provides input
   - Agent analyzes the task using `_analyzeTaskComplexity()`
   - If planning is needed, proceeds to plan creation

2. **Plan Creation**:
   - Agent creates a structured plan with steps, dependencies, and validation criteria
   - Each step defines:
     - Step ID and title
     - Tool to use
     - Dependencies on other steps
     - Required artifact and validation criteria
     - Fallback actions if the step fails

3. **Plan Execution**:
   - Agent executes available steps (those with completed dependencies)
   - For each step:
     - Executes the specified tool
     - Validates the output against the step's criteria
     - If validation fails, executes the fallback action
     - Updates plan status

4. **Completion**:
   - When all steps are completed, returns the final result
   - If the plan gets blocked, falls back to standard execution

## Key Features

### Planning Protocol

The system enforces a planning protocol for complex tasks:

- **Mandatory Planning**: For tasks with 3+ steps or requiring precise execution
- **Structured Plans**: With clear steps, dependencies, and validation criteria
- **Validation**: Steps can't be marked complete until their output passes validation
- **Fallbacks**: Predefined recovery actions for failed steps

### Progress Tracking

The system maintains detailed progress tracking:

- **Task Progress**: Markdown-formatted checklists in all tool calls
- **State Management**: Atomic updates to progress state
- **History**: Maintains a history of progress updates
- **Visualization**: Provides ASCII visualizations of progress

### Error Handling and Recovery

Robust mechanisms for handling errors:

- **Circuit Breakers**: Prevent repeated failures of tools
- **Fallback Actions**: Predefined recovery steps for failed operations
- **State Recovery**: Maintains progress even if tools fail
- **Loop Detection**: Prevents infinite recursion in tool calls

### Debugging and Visualization

Comprehensive debugging tools:

- **Plan Visualization**: Shows current plan state with step statuses
- **Progress Visualization**: Displays task completion status
- **Circuit Breaker Status**: Shows which tools are available or in cooldown
- **Comprehensive Debug View**: Combines all status information

## Example Workflow

### Creating and Executing a Plan

1. User requests: "Migrate our user data to the new system, validate it, and generate a report"

2. Agent analyzes the task and determines it needs planning

3. Agent creates a plan with steps:
   - Step 1: Extract user data (using dbsearch tool)
   - Step 2: Transform data (using calculatorTool)
   - Step 3: Validate transformed data (using jsonValidator)
   - Step 4: Generate migration report (using reportGenerator)

4. Agent executes the plan:
   - Completes Step 1 successfully
   - Step 2 fails validation
   - Executes fallback for Step 2 (notify user, retry with different parameters)
   - Completes remaining steps

5. Agent returns: "Migration completed with 98% success rate. 2 records failed validation. Report generated at [link]"

### Debugging Visualization Example

```
🔍 COMPREHENSIVE DEBUG VIEW

📋 PLAN: Migrate User Data to New System
📝 Plan for executing: Migrate our user data to the new system, validate it, and generate a report

  ✅ step_1: Extract user data from legacy system (Depends on: )
  ✅ step_2: Transform data to new schema (Depends on: step_1)
  ✅ step_3: Validate transformed data (Depends on: step_2)
  🔄 step_4: Generate migration report (Depends on: step_3)

📊 Progress: 3/4 steps (75%)

📊 PROGRESS TRACKING
  ✅ Extract user data (COMPLETED)
  ✅ Transform data to new schema (COMPLETED)
  ✅ Validate transformed data (COMPLETED)
  ⏳ Generate migration report (PENDING)

📈 Summary: 3/4 tasks (75%)

🔌 CIRCUIT BREAKER STATUS
  🌐 Global: CLOSED
  dbsearch: CLOSED
  calculatorTool: CLOSED
  jsonValidator: CLOSED
  reportGenerator: CLOSED

🔄 LOOP DETECTION
  Recent calls: 4
  Loop count: 0
  Last detected: None
```

## Technical Implementation

### Agent Initialization

```javascript
const agent = new Agent({
  apiKey: 'your-api-key',
  systemPrompt: 'You are a helpful AI assistant',
  tools: [/* array of tool definitions */],
  loopDetection: {
    maxRecentCalls: 5,
    loopThreshold: 3
  },
  debug: true
});
```

### Execution Methods

```javascript
// For simple tasks
const result = await agent.execute(history, userInput);

// For tasks that might need planning
const result = await agent.executeWithPlanning(history, userInput);

// For streaming responses
const result = await agent.executeStream(history, userInput, onChunkCallback);
```

### Debugging Methods

```javascript
// Get visualizations
console.log(agent.generateDebugVisualization());
console.log(agent.generatePlanVisualization());
console.log(agent.generateProgressVisualization());
```

## Best Practices

1. **Use Planning for Complex Tasks**: Always create plans for multi-step operations
2. **Define Clear Validation Criteria**: Ensure each step has specific validation requirements
3. **Implement Meaningful Fallbacks**: Provide recovery paths for potential failures
4. **Monitor Progress**: Use the visualization tools to track execution
5. **Handle Circuit Breaker Events**: Respond appropriately when tools become unavailable

## Error Handling Patterns

1. **Step Validation Failures**:
   - Define clear validation criteria for each step
   - Implement fallback actions that can recover from failures
   - Use the validation system to ensure quality outputs

2. **Tool Failures**:
   - Circuit breakers prevent repeated failures
   - Fallback to alternative tools when possible
   - Notify users when manual intervention is needed

3. **Progress Tracking Issues**:
   - Validate progress updates before applying them
   - Maintain history for recovery purposes
   - Use atomic updates to prevent state corruption

## Conclusion

MR-BOT's architecture provides a robust framework for handling both simple and complex tasks. The planning system ensures structured execution of multi-step workflows, while the progress tracking and debugging visualizations provide transparency into the agent's operations. The comprehensive error handling mechanisms make the system resilient to failures, ensuring reliable operation even in challenging scenarios.