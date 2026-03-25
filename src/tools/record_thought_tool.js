import { mongoDBConnection } from '../storage/MongoDBConnection.js';
import { MongoDBStorage } from '../storage/MongoDBStorage.js';
import Thought from '../models/Thought.js';
import Session from '../models/Session.js';

/**
 * record_thought Tool
 * 
 * Records the agent's reasoning before taking any action.
 * This tool forces the model to externalize its logic, making it easier to audit failures,
 * debug issues, and improve the agent's decision-making process.
 */

// Pure function tool structure
export const recordThoughtTool = {
  type: "function",
  function: {
    name: 'recordThought',
    description: 'Records the agent\'s reasoning process before taking action. This serves as a mental scratchpad to align hypothesis, plan, and uncertainties. Use this as your "Plan Twice, Act Once" mechanism.',
    parameters: {
      type: "object",
      properties: {
        step: {
          type: "string",
          description: "The current reasoning step (e.g., 'Pre-tool reasoning', 'Post-tool analysis', 'Final decision')",
          enum: [
            'Pre-tool reasoning',
            'Post-tool analysis',
            'Final decision',
            'Error handling',
            'Plan adjustment',
            'Context evaluation'
          ]
        },
        hypothesis: {
          type: "string",
          description: "Agent's hypothesis about the user's goal or the problem being solved",
          minLength: 5,
          maxLength: 500
        },
        uncertainties: {
          type: "array",
          items: { type: "string" },
          description: "List of uncertainties or ambiguities that need to be considered",
          maxItems: 10
        },
        plan: {
          type: "array",
          items: { type: "string" },
          description: "Next steps in the plan, including which tools will be used and why",
          minItems: 1,
          maxItems: 20
        },
        context: {
          type: "string",
          description: "Relevant context from the conversation history that informs this reasoning",
          maxLength: 5000
        },
        alternatives_considered: {
          type: "array",
          items: { type: "string" },
          description: "Alternative approaches that were considered but rejected, with brief explanations",
          maxItems: 10
        }
      },
      required: ['step', 'hypothesis', 'plan']
    }
  },
  handler: async (params) => {
    try {
      // Extract parameters
      const { step, hypothesis, uncertainties = [], plan, context, alternatives_considered = [] } = params;
      
      // Validate required parameters
      if (!step || !hypothesis || !plan || plan.length === 0) {
        throw new Error('Missing required parameters: step, hypothesis, and plan are required');
      }

      // Validate step enum
      const validSteps = [
        'Pre-tool reasoning',
        'Post-tool analysis',
        'Final decision',
        'Error handling',
        'Plan adjustment',
        'Context evaluation'
      ];
      if (!validSteps.includes(step)) {
        throw new Error(`Invalid step: ${step}. Must be one of: ${validSteps.join(', ')}`);
      }

      // Validate plan length
      if (plan.length === 0) {
        throw new Error('Plan must contain at least one step');
      }

      // Ensure MongoDB connection
      if (!mongoDBConnection.isReady()) {
        await mongoDBConnection.connect();
      }

      // Get session ID from environment
      const sessionId = process.env.SESSION_ID;
      if (!sessionId) {
        throw new Error('SESSION_ID environment variable is required');
      }

      // Ensure User and Session exist
      const storage = new MongoDBStorage();
      storage.setSessionId(sessionId);
      const userSessionCreated = await storage.ensureUserAndSessionExists();
      
      if (!userSessionCreated) {
        throw new Error('Failed to ensure User and Session exist in database');
      }

      // Find the session to get its ID
      const session = await Session.findOne({ sessionId });
      if (!session) {
        throw new Error('Session not found in database');
      }

      // Create thought record
      const thoughtRecord = {
        session: session._id,
        timestamp: new Date(),
        step,
        hypothesis,
        plan,
        uncertainties,
        context,
        alternatives_considered,
        userInput: '', // Will be populated by agent if available
        agentId: 'record_thought_tool'
      };

      // Save to database
      const thought = new Thought(thoughtRecord);
      await thought.save();

      return {
        status: 'success',
        message: 'Thought recorded successfully',
        thoughtId: thought._id.toString(),
        details: {
          step,
          hypothesis,
          planLength: plan.length,
          uncertaintiesCount: uncertainties.length,
          alternativesCount: alternatives_considered.length,
          timestamp: thought.timestamp.toISOString()
        }
      };

    } catch (error) {
      // Fail fast - throw error immediately
      throw new Error(`record_thought_tool failed: ${error.message}`);
    }
  }
};