# MR-BOT: Advanced Task Decomposition and Execution System

## Overview

MR-BOT is an advanced AI agent system that implements a sophisticated task decomposition and execution framework. The system uses a Directed Acyclic Graph (DAG) structure to break down complex objectives into manageable sub-tasks, track dependencies, and execute tasks in the optimal order.

## Core Components

### 1. TaskGraph Class (`src/TaskGraph.js`)

The `TaskGraph` class is the foundation of the system, implementing a DAG structure for task management:

- **Task Nodes**: Each node represents a specific task with properties like ID, description, status, dependencies, required tools, and priority
- **Graph Operations**: Methods for adding tasks, checking dependencies, validating graph structure, and handling task failures
- **Execution Management**: Topological sorting to determine execution order and identify executable tasks
- **Visualization**: Generates Mermaid diagrams for visual representation of task relationships
- **Persistence**: Serialization to/from JSON and integration with storage systems

### 2. Enhanced Agent Class (`src/Agent.js`)

The `Agent` class has been extended with advanced task decomposition capabilities:

- **Task Decomposition**: Breaks down complex objectives into structured task graphs
- **Plan Execution**: Executes tasks according to the plan with proper dependency management
- **Progress Tracking**: Maintains and updates task progress with markdown checklists
- **Error Handling**: Implements robust failure recovery mechanisms
- **Visualization**: Generates Mermaid diagrams to visualize task execution flow

### 3. Storage Integration

The system integrates with a storage manager to persist task graphs and execution state:

- **Save/Load**: Task graphs can be saved to and loaded from storage
- **Session Management**: Maintains task state across sessions
- **Multiple Storage Backends**: Supports different storage types (memory, file system, database)

## Key Features

### Task Decomposition Protocol

When receiving a complex objective, the system:

1. Analyzes the objective to identify logical sub-tasks
2. Determines dependencies between tasks
3. Assigns priorities and required tools to each task
4. Creates a structured task graph for execution

### Task Execution Protocol

During execution:

1. Focuses on one task at a time based on priority and dependencies
2. Provides context from completed dependency tasks
3. Uses only the required tools for each specific task
4. Updates progress tracking after each task completion
5. Handles failures with automatic recovery options

### Error Handling and Recovery

The system implements a comprehensive error handling approach:

- **Failure Detection**: Identifies failed tasks and their impact
- **Recovery Options**: Generates alternative approaches for failed tasks
- **Automatic Recovery**: Implements recovery tasks when possible
- **Human Intervention**: Requests guidance when automatic recovery isn't sufficient

### Visualization Capabilities

The system generates visual representations of task execution:

- **Mermaid Diagrams**: Shows task dependencies and status with color coding
- **Execution Flow**: Visualizes the complete task execution path
- **Status Indicators**: Clearly marks completed, failed, and in-progress tasks

### Progress Tracking

A robust progress tracking system ensures state visibility:

- **Markdown Checklists**: Maintains complete task lists with status indicators
- **State Persistence**: Saves and restores execution state
- **Atomic Updates**: Ensures progress updates are complete and consistent

## Technical Implementation

### Directed Acyclic Graph (DAG) Structure

The system uses a DAG to represent tasks and their dependencies:

- **Nodes**: Represent individual tasks with metadata
- **Edges**: Represent dependencies between tasks
- **Topological Sorting**: Determines optimal execution order
- **Cycle Detection**: Prevents circular dependencies

### Task Status Management

Each task maintains a status that drives execution:

- **Pending**: Task is waiting for dependencies to complete
- **In Progress**: Task is currently being executed
- **Completed**: Task has finished successfully
- **Failed**: Task encountered an error

### Storage Integration

Task graphs can be persisted and restored:

- **Serialization**: Converts graphs to/from JSON format
- **Storage Adapters**: Supports different storage backends
- **Session Management**: Maintains task state across sessions

## Example Workflow

1. **Objective Received**: "Research AI advancements and write a report"
2. **Task Decomposition**: System breaks this down into:
   - Research AI advancements in 2025
   - Identify key trends in AI research
   - Analyze impact on software development
   - Write report on findings
   - Create presentation slides
3. **Dependency Analysis**: Determines execution order based on task dependencies
4. **Task Execution**: Processes tasks one by one, updating progress
5. **Visualization**: Generates Mermaid diagram showing execution flow
6. **Completion**: Presents final results with all task outputs

## Benefits

1. **Complex Task Handling**: Breaks down complex objectives into manageable steps
2. **Dependency Management**: Ensures tasks execute in the correct order
3. **Progress Visibility**: Provides clear visibility into execution status
4. **Error Resilience**: Handles failures gracefully with recovery options
5. **State Persistence**: Maintains execution state across sessions
6. **Visual Feedback**: Offers clear visual representation of task execution

## Use Cases

- Complex research projects
- Multi-step data analysis
- Document generation workflows
- Software development tasks
- Any objective requiring structured decomposition

## Implementation Notes

The system is designed to be:

- **Modular**: Components can be used independently or together
- **Extensible**: Easy to add new task types and execution handlers
- **Robust**: Handles errors and edge cases gracefully
- **Visible**: Provides clear feedback on execution status

## Testing

The `testTaskGraph.js` script demonstrates:

- Creating and managing task graphs
- Handling task execution and failures
- Visualizing task relationships
- Persisting and restoring task graphs

## Future Enhancements

Potential areas for future development:

- Advanced task prioritization algorithms
- Machine learning for better task decomposition
- Collaborative task execution
- Enhanced visualization options
- Integration with additional storage backends