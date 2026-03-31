import { v4 as uuidv4 } from 'uuid';

/**
 * Represents a single node in the task graph
 */
class TaskNode {
  /**
   * Creates a new task node
   * @param {string} id - Unique task identifier
   * @param {string} description - Human-readable task description
   * @param {Array<string>} dependencies - Array of task IDs this depends on
   */
  constructor(id, description, dependencies = []) {
    this.id = id;
    this.description = description;
    this.dependencies = dependencies;
    this.status = 'pending'; // pending, in-progress, completed, failed
    this.result = null; // Stores task output when completed
    this.failureReason = null; // Stores failure details if status is failed
    this.requiredTools = []; // Tools needed for this task
    this.priority = 1; // 1-5 scale (1 = highest priority)
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.metadata = {}; // Additional task-specific data
  }
}

/**
 * Directed Acyclic Graph (DAG) for task decomposition and execution
 */
export class TaskGraph {
  /**
   * Creates a new task graph
   */
  constructor() {
    this.nodes = new Map(); // id -> TaskNode
    this.roots = []; // Tasks with no dependencies
    this.leaves = []; // Tasks with no dependents
    this.version = '1.0';
  }

  /**
   * Adds a new task to the graph
   * @param {string} id - Unique task identifier
   * @param {string} description - Task description
   * @param {Array<string>} dependencies - Array of task IDs this depends on
   * @returns {TaskNode} The created task node
   */
  addTask(id, description, dependencies = []) {
    // Validate dependencies exist
    for (const depId of dependencies) {
      if (!this.nodes.has(depId)) {
        throw new Error(`Dependency ${depId} not found in graph`);
      }
    }

    // Check for circular dependencies
    this._checkForCircularDependencies(id, dependencies);

    const node = new TaskNode(id, description, dependencies);
    this.nodes.set(id, node);

    // Update graph properties
    this._recalculateGraphProperties();

    return node;
  }

  /**
   * Checks for circular dependencies when adding a task
   * @param {string} newTaskId - ID of task being added
   * @param {Array<string>} dependencies - Dependencies of new task
   * @private
   */
  _checkForCircularDependencies(newTaskId, dependencies) {
    // If the new task is in its own dependencies (directly or indirectly), it's a circle
    const dependenciesSet = new Set(dependencies);
    if (dependenciesSet.has(newTaskId)) {
      throw new Error(`Circular dependency detected: ${newTaskId} depends on itself`);
    }

    // Check if any dependency would create a circle through its dependencies
    for (const depId of dependencies) {
      const dependencyChain = this._getDependencyChain(depId);
      if (dependencyChain.includes(newTaskId)) {
        throw new Error(`Circular dependency detected: ${newTaskId} would create a circle through ${depId}`);
      }
    }
  }

  /**
   * Gets the complete dependency chain for a task
   * @param {string} taskId - Task ID to check
   * @returns {Array<string>} Array of all dependency IDs (direct and indirect)
   * @private
   */
  _getDependencyChain(taskId) {
    const chain = [];
    const visited = new Set();

    const traverse = (currentId) => {
      if (visited.has(currentId)) return;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) return;

      for (const depId of node.dependencies) {
        traverse(depId);
      }

      chain.push(currentId);
    };

    traverse(taskId);
    return chain;
  }

  /**
   * Recalculates graph properties (roots and leaves)
   * @private
   */
  _recalculateGraphProperties() {
    // Find roots (tasks with no dependencies)
    this.roots = Array.from(this.nodes.entries())
      .filter(([_, node]) => node.dependencies.length === 0)
      .map(([id]) => id);

    // Find leaves (tasks that nothing depends on)
    const allDependencies = new Set();
    for (const [_, node] of this.nodes) {
      node.dependencies.forEach(dep => allDependencies.add(dep));
    }

    this.leaves = Array.from(this.nodes.keys())
      .filter(id => !allDependencies.has(id));
  }

  /**
   * Gets tasks in execution order (topological sort)
   * @returns {Array<string>} Array of task IDs in execution order
   */
  getExecutionOrder() {
    const visited = new Set();
    const result = [];

    const visit = (nodeId) => {
      if (visited.has(nodeId)) return;
      const node = this.nodes.get(nodeId);

      // Visit all dependencies first
      for (const depId of node.dependencies) {
        visit(depId);
      }

      visited.add(nodeId);
      result.push(nodeId);
    };

    // Start from all roots
    for (const rootId of this.roots) {
      visit(rootId);
    }

    return result;
  }

  /**
   * Gets all tasks that are ready to execute (all dependencies completed)
   * @returns {Array<string>} Array of executable task IDs
   */
  getExecutableTasks() {
    return this.getExecutionOrder().filter(id => {
      const node = this.nodes.get(id);
      return node.status === 'pending' &&
             node.dependencies.every(depId => {
               const depNode = this.nodes.get(depId);
               return depNode.status === 'completed';
             });
    });
  }

  /**
   * Dynamically updates the graph with new/modified tasks
   * @param {Array} newTasks - Array of task objects
   * @param {Object} context - Execution context
   */
  updateGraph(newTasks, context = {}) {
    // Validate new tasks don't create cycles
    const testGraph = new TaskGraph();

    // Clone current state to test graph
    for (const [id, node] of this.nodes) {
      testGraph.addTask(id, node.description, node.dependencies);
      // Copy status and other properties
      const testNode = testGraph.nodes.get(id);
      Object.assign(testNode, node);
    }

    // Try adding new tasks to test graph
    for (const task of newTasks) {
      try {
        if (testGraph.nodes.has(task.id)) {
          // Update existing task
          const existingNode = testGraph.nodes.get(task.id);
          existingNode.description = task.description || existingNode.description;
          existingNode.dependencies = task.dependencies || existingNode.dependencies;
          if (task.status) existingNode.status = task.status;
          if (task.result) existingNode.result = task.result;
          if (task.failureReason) existingNode.failureReason = task.failureReason;
          if (task.requiredTools) existingNode.requiredTools = task.requiredTools;
          if (task.priority) existingNode.priority = task.priority;
        } else {
          // Add new task
          testGraph.addTask(task.id, task.description, task.dependencies || []);
          const newNode = testGraph.nodes.get(task.id);
          if (task.status) newNode.status = task.status;
          if (task.result) newNode.result = task.result;
          if (task.failureReason) newNode.failureReason = task.failureReason;
          if (task.requiredTools) newNode.requiredTools = task.requiredTools;
          if (task.priority) newNode.priority = task.priority;
        }
      } catch (e) {
        throw new Error(`Cannot update task ${task.id}: ${e.message}`);
      }
    }

    // If validation passes, apply to real graph
    for (const task of newTasks) {
      if (this.nodes.has(task.id)) {
        // Update existing task
        const node = this.nodes.get(task.id);
        node.description = task.description || node.description;
        node.dependencies = task.dependencies || node.dependencies;
        if (task.status) node.status = task.status;
        if (task.result) node.result = task.result;
        if (task.failureReason) node.failureReason = task.failureReason;
        if (task.requiredTools) node.requiredTools = task.requiredTools;
        if (task.priority) node.priority = task.priority;
        node.updatedAt = new Date();
      } else {
        // Add new task
        this.addTask(task.id, task.description, task.dependencies || []);
        const newNode = this.nodes.get(task.id);
        if (task.status) newNode.status = task.status;
        if (task.result) newNode.result = task.result;
        if (task.failureReason) newNode.failureReason = task.failureReason;
        if (task.requiredTools) newNode.requiredTools = task.requiredTools;
        if (task.priority) newNode.priority = task.priority;
      }
    }

    // Recalculate graph properties
    this._recalculateGraphProperties();
  }

  /**
   * Handles task failure with recovery options
   * @param {string} taskId - Failed task ID
   * @param {string} reason - Failure reason
   * @param {Array} recoveryOptions - Alternative approaches
   */
  handleTaskFailure(taskId, reason, recoveryOptions = []) {
    const node = this.nodes.get(taskId);
    if (!node) throw new Error(`Task ${taskId} not found`);

    node.status = 'failed';
    node.failureReason = reason;
    node.updatedAt = new Date();

    // Add recovery tasks if provided
    if (recoveryOptions.length > 0) {
      for (let i = 0; i < recoveryOptions.length; i++) {
        const recoveryTask = recoveryOptions[i];
        const recoveryTaskId = recoveryTask.id || `${taskId}_recovery_${i}`;

        this.addTask(
          recoveryTaskId,
          recoveryTask.description,
          recoveryTask.dependencies || []
        );

        const recoveryNode = this.nodes.get(recoveryTaskId);
        recoveryNode.requiredTools = recoveryTask.requiredTools || [];
        recoveryNode.priority = recoveryTask.priority || node.priority;
        recoveryNode.metadata.recoveryFor = taskId;
        recoveryNode.metadata.originalTask = node.description;

        // Replace original task dependency with recovery task
        for (const [id, dependentNode] of this.nodes) {
          if (dependentNode.dependencies.includes(taskId)) {
            dependentNode.dependencies = dependentNode.dependencies
              .filter(dep => dep !== taskId)
              .concat(recoveryTaskId);
          }
        }
      }
    }

    this._recalculateGraphProperties();
  }

  /**
   * Converts the graph to markdown checklist format
   * @returns {string} Markdown formatted task list
   */
  toMarkdown() {
    const executionOrder = this.getExecutionOrder();
    return executionOrder.map(id => {
      const node = this.nodes.get(id);
      const status = node.status === 'completed' ? 'x' :
                    node.status === 'failed' ? '!' :
                    node.status === 'in-progress' ? '>' : ' ';
      return `- [${status}] ${node.description}`;
    }).join('\n');
  }

  /**
   * Generates a Mermaid diagram representation of the graph
   * @returns {string} Mermaid diagram syntax
   */
  generateMermaidDiagram() {
    let diagram = 'graph TD;\n';

    // Add all nodes with appropriate styling
    for (const [id, node] of this.nodes) {
      let shape = 'rectangle';
      let style = '';

      if (node.status === 'completed') {
        style = 'fill:#9f9,stroke:#393';
      } else if (node.status === 'failed') {
        style = 'fill:#f99,stroke:#933';
      } else if (node.status === 'in-progress') {
        style = 'fill:#99f,stroke:#339';
      }

      // Escape special characters for Mermaid
      const safeDescription = node.description
        .replace(/"/g, '\\"')
        .replace(/\\n/g, '\\n');

      // Shorten long descriptions for better visualization
      let displayDescription = safeDescription;
      if (displayDescription.length > 40) {
        displayDescription = displayDescription.substring(0, 37) + '...';
      }

      diagram += `  ${id}["${displayDescription}"];${style ? `:::${style}` : ''}\n`;
    }

    // Add all edges
    for (const [id, node] of this.nodes) {
      for (const depId of node.dependencies) {
        diagram += `  ${depId} --> ${id};\n`;
      }
    }

    // Add legend and styling
    diagram += '\n  classDef default fill:#f9f9f9,stroke:#333;\n';
    diagram += '  classDef completed fill:#9f9,stroke:#333;\n';
    diagram += '  classDef failed fill:#f99,stroke:#333;\n';
    diagram += '  classDef inprogress fill:#99f,stroke:#333;\n';

    // Add legend
    diagram += '\n  subgraph Legend\n';
    diagram += '    direction TB\n';
    diagram += '    legend_completed[Completed]:::completed\n';
    diagram += '    legend_inprogress[In Progress]:::inprogress\n';
    diagram += '    legend_failed[Failed]:::failed\n';
    diagram += '    legend_pending[Pending]:::default\n';
    diagram += '  end';

    return diagram;
  }

  /**
   * Converts the graph to JSON for persistence
   * @returns {Object} Serializable graph representation
   */
  toJSON() {
    return {
      version: this.version,
      nodes: Array.from(this.nodes.entries()).map(([id, node]) => ({
        id,
        description: node.description,
        dependencies: node.dependencies,
        status: node.status,
        result: node.result,
        failureReason: node.failureReason,
        requiredTools: node.requiredTools,
        priority: node.priority,
        createdAt: node.createdAt.toISOString(),
        updatedAt: node.updatedAt.toISOString(),
        metadata: node.metadata
      })),
      roots: this.roots,
      leaves: this.leaves
    };
  }

  /**
   * Creates a TaskGraph from JSON
   * @param {Object} json - Serialized graph data
   * @returns {TaskGraph} Rehydrated task graph
   */
  static fromJSON(json) {
    const graph = new TaskGraph();
    if (json.version !== '1.0') {
      throw new Error(`Unsupported graph version: ${json.version}`);
    }

    // First pass: create all nodes
    for (const nodeData of json.nodes) {
      const node = new TaskNode(
        nodeData.id,
        nodeData.description,
        nodeData.dependencies
      );
      node.status = nodeData.status;
      node.result = nodeData.result;
      node.failureReason = nodeData.failureReason;
      node.requiredTools = nodeData.requiredTools;
      node.priority = nodeData.priority;
      node.createdAt = new Date(nodeData.createdAt);
      node.updatedAt = new Date(nodeData.updatedAt);
      node.metadata = nodeData.metadata || {};
      graph.nodes.set(nodeData.id, node);
    }

    // Set roots and leaves
    graph.roots = json.roots;
    graph.leaves = json.leaves;

    return graph;
  }

  /**
   * Gets a task by ID
   * @param {string} id - Task ID
   * @returns {TaskNode} The task node
   */
  getTask(id) {
    return this.nodes.get(id);
  }

  /**
   * Gets all tasks
   * @returns {Array<TaskNode>} Array of all task nodes
   */
  getAllTasks() {
    return Array.from(this.nodes.values());
  }

  /**
   * Gets the status of the entire graph
   * @returns {Object} Graph status summary
   */
  getStatus() {
    let pending = 0;
    let inProgress = 0;
    let completed = 0;
    let failed = 0;

    for (const node of this.nodes.values()) {
      switch (node.status) {
        case 'pending': pending++; break;
        case 'in-progress': inProgress++; break;
        case 'completed': completed++; break;
        case 'failed': failed++; break;
      }
    }

    return {
      totalTasks: this.nodes.size,
      pending,
      inProgress,
      completed,
      failed,
      isComplete: failed === 0 && pending === 0 && inProgress === 0,
      executableTasks: this.getExecutableTasks()
    };
  }

  /**
   * Saves the task graph to storage
   * @param {StorageManager} storageManager - Storage manager instance
   * @param {string} key - Storage key
   * @returns {Promise<void>}
   */
  async saveToStorage(storageManager, key) {
    if (!storageManager) {
      throw new Error('Storage manager is required');
    }

    const jsonData = this.toJSON();
    await storageManager.saveData(key, jsonData);
  }

  /**
   * Loads a task graph from storage
   * @param {StorageManager} storageManager - Storage manager instance
   * @param {string} key - Storage key
   * @returns {Promise<TaskGraph>} Rehydrated task graph
   */
  static async loadFromStorage(storageManager, key) {
    if (!storageManager) {
      throw new Error('Storage manager is required');
    }

    const jsonData = await storageManager.loadData(key);
    return TaskGraph.fromJSON(jsonData);
  }
}

/**
 * Generates a unique task ID
 * @returns {string} Unique task ID
 */
export function generateTaskId() {
  return `task_${uuidv4().replace(/-/g, '')}`;
}