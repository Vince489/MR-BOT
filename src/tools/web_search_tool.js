// search_tool.js
import search from '../search_tool/search.js';
import { closeBrowser } from '../search_tool/fetcher.js';

const description = 'Performs a web search for a given query and returns relevant results, including snippets and content from the pages.';

console.log('🌐 [WEB SEARCH TOOL] Initialized');

function formatSearchResults(query, results) {
  if (!results || results.length === 0) {
    return `No web search results found for "${query}".`;
  }

  const hasRealResults = results.some((result) => result.url && result.url !== '#');
  if (!hasRealResults) {
    return `I found information about "${query}":\n\n${results[0].snippet}`;
  }

  let formattedResults = `Web Search Results for "${query}":\n\n`;

  results.forEach((result, index) => {
    formattedResults += `Result ${index + 1}:\n`;
    formattedResults += `  Title: ${result.title}\n`;
    formattedResults += `  URL: ${result.url}\n`;
    formattedResults += `  Snippet: ${result.snippet}\n`;

    if (result.content) {
      if (typeof result.content === 'object') {
        if (result.content.prices?.length > 0) {
          formattedResults += `  Prices: ${result.content.prices.join(', ')}\n`;
        }
        if (result.content.ratings?.length > 0) {
          formattedResults += `  Ratings: ${result.content.ratings.join(', ')}\n`;
        }
        if (result.content.fullText) {
          formattedResults += `  Content (excerpt): ${result.content.fullText.substring(0, 300)}...\n`;
        }
      } else {
        formattedResults += `  Content (excerpt): ${result.content.substring(0, 300)}...\n`;
      }
    }

    formattedResults += '\n';
  });

  return formattedResults;
}

function completeInternetSearchTasks() {
  if (!global.taskManagerInstance) {
    return;
  }

  try {
    const tasksResponse = global.taskManagerInstance.listTasks();
    if (!tasksResponse || !tasksResponse.includes('Search the internet')) {
      return;
    }

    const taskMatches = tasksResponse.match(/#(\d+)/g);
    if (!taskMatches) {
      return;
    }

    for (const match of taskMatches) {
      const taskId = Number.parseInt(match.substring(1), 10);
      const taskDescription = tasksResponse.split('\n').find((line) => line.includes(match));
      if (taskDescription && taskDescription.includes('Search the internet')) {
        global.taskManagerInstance.completeTask(taskId);
        console.log(`✅ [WEB SEARCH TOOL] Completed task #${taskId}`);
      }
    }
  } catch (error) {
    console.error('Error completing search task:', error);
  }
}

async function performSearch({ query }) {
  console.log(`🌐 [WEB SEARCH TOOL] Executing webSearch with query: "${query}"`);

  try {
    await closeBrowser();
    const results = await search(query);

    if (results && results.length > 0) {
      completeInternetSearchTasks();
    }

    return formatSearchResults(query, results);
  } catch (error) {
    console.error('🌐 [WEB SEARCH TOOL] Error during web search:', error);
    return `An error occurred during web search: ${error.message}`;
  } finally {
    await closeBrowser();
  }
}

export const webSearchTool = {
  function: {
    name: 'webSearch',
    description,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query (e.g., "latest news on AI", "how to bake a cake", "weather in London").'
        },
        taskProgress: {
          type: 'string',
          description: 'Markdown-formatted checklist to track task progress. Each line should be a checklist item (e.g., "- [ ] Step 1"). This parameter is optional and can be included in any tool call.'
        }
      },
      required: ['query']
    }
  },
  handler: async (params) => {
    const { taskProgress, ...restParams } = params;
    return performSearch(restParams);
  }
};
