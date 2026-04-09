/**
 * Factory function for creating standardized LLM tools.
 * Encapsulates boilerplate (schema definitions, error handling) and ensures consistency.
 */
export const createTool = ({ name, description, properties, required, handler }) => ({
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties: {
        ...properties,
        // Automatically inject common parameters like taskProgress
        taskProgress: {
          type: "string",
          description: "Markdown checklist to track task progress (e.g., '- [ ] Step 1')."
        }
      },
      required: required || Object.keys(properties),
    },
  },
  handler: async (params) => {
    const { taskProgress, ...args } = params;
    try {
      // Log execution for debugging
      console.log(`[EXECUTION]: Calling ${name}...`);
      return await handler(args);
    } catch (error) {
      return { status: "error", message: error.message };
    }
  }
});