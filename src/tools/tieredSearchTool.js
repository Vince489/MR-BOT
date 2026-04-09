import { createTool } from './toolFactory.js';
import { tieredSearch } from '../services/tieredSearchService.js';

/**
 * Tool for performing tiered search with support for natural language date expressions.
 */
export const tieredSearchTool = createTool({
  name: 'tieredSearch',
  description: 'Perform a tiered search across messages and sessions, with support for natural language date expressions (e.g., "yesterday", "last week").',
  properties: {
    query: {
      type: 'string',
      description: 'The search query.'
    },
    limit: {
      type: 'number',
      description: 'The maximum number of results to return.'
    },
    sessionId: {
      type: 'string',
      description: 'Optional session ID to filter results.'
    },
    after: {
      type: 'string',
      description: 'Optional natural language date expression to filter results after a specific date (e.g., "yesterday", "last week").'
    },
    before: {
      type: 'string',
      description: 'Optional natural language date expression to filter results before a specific date (e.g., "today", "last month").'
    },
    roleFilter: {
      type: 'string',
      description: 'Optional role to filter results (e.g., "user", "assistant").'
    },
    searchMode: {
      type: 'string',
      description: 'Optional search mode (e.g., "victor-code", "general-search").'
    },
    minConfidence: {
      type: 'number',
      description: 'Optional minimum confidence threshold for results.'
    }
  },
  required: ['query'],
  handler: async (params) => {
    const { query, limit = 5, sessionId, after, before, roleFilter, searchMode, minConfidence } = params;

    // Build options for the search
    const options = {
      limit,
      sessionId,
      after,
      before,
      roleFilter,
      searchMode,
      minConfidence
    };

    // Perform the search
    const result = await tieredSearch.search(query, options);

    // Return the results
    return {
      success: result.success,
      results: result.results,
      searchTier: result.searchTier,
      duration: result.duration,
      searchMode: result.searchMode,
      threshold: result.threshold,
      quality: result.quality,
      confidence: result.confidence
    };
  }
});