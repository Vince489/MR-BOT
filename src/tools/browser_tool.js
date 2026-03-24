import open from 'open';

// Define browser tool with optimized structure for Mistral SDK
export const browserTool = {
  function: {
    name: "browser_open",
    description: "Open a URL or local file in the default browser.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "The URL or file path to open in the browser. Must be a valid URL (e.g., 'https://example.com') or a local file path (e.g., 'index.html').",
        },
      },
      required: ["target"],
    },
  },
  handler: async ({ target }) => {
    try {
      await open(target);
      return { success: true, message: `Opened ${target} in the default browser.` };
    } catch (error) {
      return { success: false, message: `Failed to open ${target}: ${error.message}` };
    }
  }
};
