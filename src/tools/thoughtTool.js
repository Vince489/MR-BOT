// thought_tool.js

/**
 * Thought Tool
 * 
 * Records the agent's reasoning process before taking any action.
 * This tool forces the model to externalize its logic, making it easier to audit,
 * debug, and improve the agent's decision-making process.
 * 
 * Integrated with MongoDB storage system for persistent thought tracking.
 */

console.log('🧠 [THOUGHT TOOL] Initialized');

// Import required modules for storage integration
import Thought from '../models/Thought.js';
import { mongoDBConnection } from '../storage/MongoDBConnection.js';

export const thoughtTool = {
  type: "function",
  function: {
    name: "recordThought",
    description: "Use this tool to externalize your reasoning process. It serves as your mental scratchpad to align your hypothesis, plan, and uncertainties before proceeding. This is your 'Plan Twice, Act Once' mechanism. All thoughts are automatically saved to the storage system for audit trails and learning.",
    parameters: {
      type: "object",
      properties: {
        step: {
          type: "string",
          description: "The current reasoning step.",
          enum: [
            "Pre-tool reasoning",
            "Post-tool analysis", 
            "Final decision",
            "Error handling",
            "Plan adjustment",
            "Context evaluation"
          ]
        },
        hypothesis: {
          type: "string",
          description: "Agent's hypothesis about the user's goal or the problem being solved."
        },
        plan: {
          type: "array",
          items: { type: "string" },
          description: "Next steps in the plan, including which tools will be used and why."
        },
        uncertainties: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of uncertainties or ambiguities to consider."
        },
        context: {
          type: "string",
          description: "Relevant context from conversation history informing this reasoning."
        },
        alternatives_considered: {
          type: "array",
          items: { type: "string" },
          description: "Alternative approaches that were considered but rejected."
        },
        userInput: {
          type: "string",
          description: "The user input that triggered this thought process."
        },
        agentId: {
          type: "string",
          description: "Identifier for the agent instance."
        },
        metadata: {
          type: "object",
          properties: {
            importance: {
              type: "number",
              description: "Importance level of this thought."
            },
            category: {
              type: "string",
              description: "Category for this thought."
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags for categorizing this thought."
            }
          },
          description: "Additional metadata for this thought."
        }
      },
      required: ["step", "hypothesis", "plan"],
      additionalProperties: false
    }
  },
  handler: async (params) => {
    const { 
      step, 
      hypothesis, 
      plan, 
      uncertainties = [], 
      context = "", 
      alternatives_considered = [],
      userInput = "",
      agentId = "mistral-medium-2508",
      metadata = {}
    } = params;


    try {
      // 1. Validation
      if (hypothesis.length < 5) {
        return { success: false, message: "Hypothesis is too short. Please provide a more detailed reasoning." };
      }
      if (plan.length === 0) {
        return { success: false, message: "Plan cannot be empty." };
      }

      // 2. Get session information from environment
      const sessionId = process.env.SESSION_ID;
      if (!sessionId) {
        console.warn('⚠️  [THOUGHT TOOL] SESSION_ID not set, thoughts will not be saved to storage');
      }

      // 3. Create thought record for storage
      const thoughtData = {
        session: sessionId,
        step,
        hypothesis,
        plan,
        uncertainties,
        context,
        alternatives_considered,
        userInput,
        agentId,
        metadata: {
          importance: metadata.importance || 5,
          category: metadata.category || 'general',
          tags: metadata.tags || []
        }
      };

      // 4. Save to MongoDB if session is available
      let storageResult = { saved: false, error: null };
      if (sessionId) {
        try {
          // Ensure MongoDB connection
          await mongoDBConnection.connect();
          
          // Create and save thought document
          const thought = new Thought(thoughtData);
          await thought.save();
          
          storageResult.saved = true;
          console.log(`💾 [THOUGHT TOOL] Thought saved to MongoDB (ID: ${thought._id})`);
        } catch (storageError) {
          storageResult.error = storageError.message;
          console.error(`💾 [THOUGHT TOOL] Failed to save thought to MongoDB:`, storageError.message);
        }
      }

      // 5. Return result to the LLM
      return {
        status: "success",
        message: "Thought recorded successfully",
        recorded_at: new Date().toISOString(),
        summary: {
          step: step,
          plan_steps: plan.length,
          has_uncertainties: uncertainties.length > 0,
          storage: {
            saved: storageResult.saved,
            session: sessionId || 'none',
            error: storageResult.error
          }
        },
        thought_id: storageResult.saved ? 'saved_to_mongodb' : 'not_saved'
      };

    } catch (error) {
      console.error(`🧠 [THOUGHT TOOL] Error recording thought:`, error);
      return { 
        status: "error", 
        message: `Failed to record thought: ${error.message}` 
      };
    }
  }
};
