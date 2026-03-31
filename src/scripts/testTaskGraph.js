import { Agent } from '../Agent.js';
import { TaskGraph } from '../TaskGraph.js';

// Create a test agent
const testAgent = new Agent({
  apiKey: 'test-api-key', // This will be mocked
  systemPrompt: 'You are a helpful AI assistant.',
  storageType: 'json'
});

// Create a sample task graph
async function createSampleTaskGraph() {
  const graph = new TaskGraph();

  // Add tasks with dependencies
  const task1 = graph.addTask('task1', 'Research AI advancements in 2025');
  const task2 = graph.addTask('task2', 'Identify key trends in AI research');
  const task3 = graph.addTask('task3', 'Analyze impact on software development', ['task1', 'task2']);
  const task4 = graph.addTask('task4', 'Write report on findings', ['task3']);
  const task5 = graph.addTask('task5', 'Create presentation slides', ['task4']);

  // Set some task properties
  task1.priority = 2;
  task2.priority = 3;
  task3.requiredTools = ['searchWeb', 'analyzeData'];
  task4.requiredTools = ['writeDocument'];

  return graph;
}

// Test the task graph functionality
async function testTaskGraph() {
  console.log('=== Testing Task Graph Functionality ===');

  // Create sample graph
  const graph = await createSampleTaskGraph();

  // Display execution order
  console.log('\nExecution Order:');
  console.log(graph.getExecutionOrder());

  // Display markdown representation
  console.log('\nMarkdown Representation:');
  console.log(graph.toMarkdown());

  // Display Mermaid diagram
  console.log('\nMermaid Diagram:');
  console.log(graph.generateMermaidDiagram());

  // Test status
  console.log('\nGraph Status:');
  console.log(graph.getStatus());

  // Test updating task status
  const task1 = graph.getTask('task1');
  task1.status = 'completed';
  task1.result = { findings: 'Significant advancements in LLMs and multimodal models' };

  console.log('\nAfter completing task1:');
  console.log(graph.toMarkdown());

  // Test failure handling
  const task3 = graph.getTask('task3');
  graph.handleTaskFailure('task3', 'Insufficient data for analysis', [
    {
      id: 'task3_recovery',
      description: 'Gather additional data for analysis',
      dependencies: ['task1', 'task2'],
      requiredTools: ['searchWeb', 'dataCollection']
    }
  ]);

  console.log('\nAfter handling task3 failure:');
  console.log(graph.toMarkdown());
  console.log('Updated Mermaid Diagram:');
  console.log(graph.generateMermaidDiagram());

  // Test storage integration
  if (testAgent.storageManager) {
    try {
      // Initialize storage manager
      await testAgent.storageManager.initialize('json', true);

      // Add saveData and loadData methods if they don't exist
      if (!testAgent.storageManager.saveData) {
        testAgent.storageManager.saveData = async function(key, data) {
          this.memoryStore = this.memoryStore || {};
          this.memoryStore[key] = data;
          console.log(`Mock save: stored data for key ${key}`);
        };
      }

      if (!testAgent.storageManager.loadData) {
        testAgent.storageManager.loadData = async function(key) {
          if (!this.memoryStore || !this.memoryStore[key]) {
            throw new Error(`No data found for key ${key}`);
          }
          console.log(`Mock load: retrieved data for key ${key}`);
          return this.memoryStore[key];
        };
      }

      const storageKey = 'test_task_graph';
      await graph.saveToStorage(testAgent.storageManager, storageKey);
      console.log(`\nSaved task graph to storage with key: ${storageKey}`);

      const loadedGraph = await TaskGraph.loadFromStorage(testAgent.storageManager, storageKey);
      console.log('\nLoaded task graph from storage:');
      console.log(loadedGraph.toMarkdown());
    } catch (error) {
      console.error('Storage test failed:', error.message);
    }
  }
}

// Run the tests
testTaskGraph().catch(console.error);