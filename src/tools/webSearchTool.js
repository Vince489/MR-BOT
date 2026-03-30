/**
 * Web Search Tool using SearXNG
 * Provides web search capabilities with rate limiting and caching
 * Returns results in LLM-optimized format
 */

// Rate limiting implementation
const rateLimit = {
  maxRequests: 5,
  windowMs: 1000,
  queue: [],
  lastReset: Date.now()
};

// Cache implementation
const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Normalizes query for caching
 */
function normalizeQuery(query) {
  return query.trim().toLowerCase();
}

/**
 * Checks rate limit and manages queue
 */
function checkRateLimit() {
  const now = Date.now();
  if (now - rateLimit.lastReset > rateLimit.windowMs) {
    rateLimit.queue = [];
    rateLimit.lastReset = now;
  }

  if (rateLimit.queue.length >= rateLimit.maxRequests) {
    throw new Error(`Rate limit exceeded. Max ${rateLimit.maxRequests} requests per ${rateLimit.windowMs}ms`);
  }

  rateLimit.queue.push(now);
}

/**
 * Core search function using fetch
 */
async function performSearch(query, options = {}) {
  checkRateLimit();

  const cacheKey = normalizeQuery(query);
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

    try {
    // Build SearXNG API URL with parameters
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      ...options
    });

    // Default to localhost if no base URL is provided
    const baseUrl = process.env.SEARXNG_URL || 'http://localhost:8080';

    // Add browser-like headers to bypass bot detection
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': `${baseUrl}/`,
      'Origin': baseUrl,
      'Connection': 'keep-alive',
      'X-Requested-With': 'XMLHttpRequest',
      'DNT': '1',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache'
    };

    const response = await fetch(`${baseUrl}/search?${params}`, {
      method: 'GET',
      headers: headers
    });

    if (!response.ok) {
      throw new Error(`SearXNG API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const results = processResults(data, query);

    // Cache the results
    searchCache.set(cacheKey, {
      data: results,
      timestamp: Date.now()
    });

    return results;
  } catch (error) {
    console.error('Web search error:', error);
    throw error;
  }
}

/**
 * Processes raw SearXNG results into LLM-optimized format
 */
function processResults(data, originalQuery) {
  // Handle different SearXNG response formats
  const results = data.results || data.answers || [];

  return {
    query: originalQuery,
    results: results.map(result => ({
      title: result.title || result.url || 'Untitled',
      url: result.url || result.link,
      content: result.content || result.snippet || result.answer || '',
      engine: result.engine || 'unknown',
      score: result.score || 0.9,
      // Add parsed date if available
      ...(result.publishedDate && { publishedDate: new Date(result.publishedDate).toISOString() })
    })),
    metadata: {
      total_results: results.length,
      sources: results.length > 0 ? [...new Set(results.map(r => r.engine))] : [],
      timestamp: new Date().toISOString(),
      // Include raw response size for debugging
      rawResponseSize: JSON.stringify(data).length
    }
  };
}

/**
 * Main handler function
 */
async function handleWebSearch(params) {
  try {
    const { query, options = {} } = params;

    if (!query) {
      return {
        error: 'Query parameter is required for web search'
      };
    }

    console.log(`🔍 [WEB SEARCH] Executing search for: "${query}"`);

    const results = await performSearch(query, options);

    return {
      type: 'webSearch',
      query: results.query,
      results: results.results,
      metadata: results.metadata,
      executedAt: new Date().toISOString(),
      status: 'success'
    };
  } catch (error) {
    console.error('🔍 [WEB SEARCH] Error:', error.message);
    return {
      error: `Web search failed: ${error.message}`,
      query: params.query,
      executedAt: new Date().toISOString(),
      status: 'error'
    };
  }
}

/**
 * Web Search Tool Definition
 */
export const webSearchTool = {
  type: "function",
  function: {
    name: 'webSearch',
    description: 'Performs web searches using SearXNG with rate limiting and caching. Returns results in LLM-optimized format with title, URL, content snippets, and metadata. Use this for real-time web information retrieval.',
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string (required)",
          minLength: 1
        },
        options: {
          type: "object",
          description: "Additional search options",
          properties: {
            engines: {
              type: "array",
              items: { type: "string" },
              description: "Specific search engines to use (e.g., ['google', 'bing'])"
            },
            language: {
              type: "string",
              description: "Language preference for results (e.g., 'en', 'fr')"
            },
            safesearch: {
              type: "integer",
              description: "Safe search level (0=off, 1=moderate, 2=strict)",
              enum: [0, 1, 2]
            },
            time_range: {
              type: "string",
              description: "Time range for results (e.g., 'day', 'week', 'month', 'year')"
            },
            categories: {
              type: "array",
              items: { type: "string" },
              description: "Content categories to include (e.g., ['news', 'science'])"
            }
          }
        }
      },
      required: ['query']
    }
  },
  handler: handleWebSearch
};

console.log('🔍 [WEB SEARCH TOOL] Initialized - Ready for web searches via SearXNG');