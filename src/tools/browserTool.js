import open from 'open';
import { createTool } from './toolFactory.js';

export const browserTool = createTool({
  name: "browserTool",
  description: "Open a URL or local file in the default browser.",
  properties: {
    target: {
      type: "string",
      description: "The URL or file path to open in the default browser. Must be a valid URL (e.g., 'https://example.com') or a local file path (e.g., 'index.html').",
    },
  },
  required: ["target"],
  handler: async ({ target }) => {
    try {
      await open(target);
      return { success: true, message: `Opened ${target} in the default browser.` };
    } catch (error) {
      throw new Error(`Failed to open ${target}: ${error.message}`);
    }
  }
});
