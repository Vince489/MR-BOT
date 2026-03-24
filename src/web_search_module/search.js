// search_tool/search.js

//  Main search logic: orchestrates search, fetching, parsing
import { searchEngines, excludedDomains, cacheExpiration, maxContentLength } from './config.js';
import { fetchContent, closeBrowser } from './fetcher.js';
import { extractSearchResults, extractMainContent } from './parser.js';
import { retry, createCache, cleanWhitespace, stripHtml, isValidUrl } from './utils.js';
import { logger } from './logger.js';

const searchResultsCache = createCache(cacheExpiration);
const contentCache = createCache(cacheExpiration);

// Process structured data from Playwright
function processStructuredData(structuredData) {
    if (!structuredData) return null;

    // Extract relevant information from the structured data
    const result = {
        title: structuredData.title || '',
        headings: structuredData.headings || [],
        paragraphs: structuredData.paragraphs || [],
        prices: structuredData.prices || [],
        ratings: structuredData.ratings || [],
        links: structuredData.links || [],
        content: ''
    };

    // Combine all text content
    if (structuredData.fullText) {
        result.content = structuredData.fullText;
    } else {
        result.content = [
            result.title,
            ...result.headings,
            ...result.paragraphs,
            ...result.prices,
            ...result.ratings
        ].join('\n\n');
    }

    // Extract pricing information
    const priceRegex = /\$?\d+(\.\d{2})?/g;
    const foundPrices = [];
    for (const text of result.prices) {
        const matches = text.match(priceRegex);
        if (matches) {
            foundPrices.push(...matches);
        }
    }
    result.prices = foundPrices;

    // Extract rating information
    const ratingRegex = /(\d\.\d|\d)(\/5|\/10| stars?| star)/i;
    const foundRatings = [];
    for (const text of result.ratings) {
        const matches = text.match(ratingRegex);
        if (matches) {
            foundRatings.push(...matches);
        }
    }
    result.ratings = foundRatings;

    return result;
}

// Extract search results from JSON responses based on engine type
export function extractJsonSearchResults(jsonData, engine) {
    if (!jsonData) {
        logger.log(`🔎 [SEARCH ENGINE] No JSON data received from ${engine.name}`);
        return [];
    }

    let results = [];

    try {
        switch (engine.apiType) {
            case 'searxng':
                // SearXNG JSON format
                if (jsonData.results && Array.isArray(jsonData.results)) {
                    results = jsonData.results.map(r => ({
                        url: r.url,
                        title: cleanWhitespace(r.title || ''),
                        snippet: cleanWhitespace(r.content || ''),
                        source: engine.name,
                    })).filter(r => isValidUrl(r.url));
                }
                break;

            case 'duckduckgo':
                // DuckDuckGo Instant Answer API format
                if (jsonData.RelatedTopics && Array.isArray(jsonData.RelatedTopics)) {
                    results = jsonData.RelatedTopics.map(r => ({
                        url: r.FirstURL || '',
                        title: cleanWhitespace(r.Text || ''),
                        snippet: cleanWhitespace(r.Text || ''),
                        source: engine.name,
                    })).filter(r => isValidUrl(r.url));
                }
                // Also check for Answer and Abstract
                if (jsonData.Answer && jsonData.Answer.length > 0) {
                    results.unshift({
                        url: jsonData.AbstractURL || '',
                        title: cleanWhitespace(jsonData.Heading || 'Answer'),
                        snippet: cleanWhitespace(jsonData.Answer || ''),
                        source: engine.name,
                    });
                }
                if (jsonData.Abstract && jsonData.Abstract.length > 0) {
                    results.unshift({
                        url: jsonData.AbstractURL || '',
                        title: cleanWhitespace(jsonData.Heading || 'Abstract'),
                        snippet: cleanWhitespace(jsonData.Abstract || ''),
                        source: engine.name,
                    });
                }
                break;

            case 'wikipedia':
                // Wikipedia MediaWiki API format
                if (jsonData.query && jsonData.query.search && Array.isArray(jsonData.query.search)) {
                    results = jsonData.query.search.map(r => ({
                        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
                        title: cleanWhitespace(r.title || ''),
                        snippet: stripHtml(r.snippet || ''),
                        source: engine.name,
                    })).filter(r => isValidUrl(r.url));
                }
                break;

            default:
                logger.log(`🔎 [SEARCH ENGINE] Unknown API type: ${engine.apiType}`);
                return [];
        }

        // Filter out invalid URLs and apply domain exclusions
        results = results.filter(res =>
            res.url &&
            isValidUrl(res.url) &&
            !excludedDomains.some(d => res.url.includes(d)) &&
            !res.url.includes('javascript:') &&
            !res.url.includes('mailto:')
        );

        logger.log(`🔎 [SEARCH ENGINE] Extracted ${results.length} results from ${engine.name} JSON API`);
        return results;

    } catch (error) {
        logger.error(`🔎 [SEARCH ENGINE] Error parsing JSON from ${engine.name}: ${error.message}`);
        return [];
    }
}

// Enhanced performSearch with parallel search engine queries
const performSearch = async (query) => {
    if (!query || typeof query !== 'string') {
        throw new Error('Invalid search query.');
    }

    logger.log(`🔎 [SEARCH ENGINE] Performing search for: "${query}"`);

    const cachedResults = searchResultsCache.get(query);
    if (cachedResults) {
        logger.log(`🔎 [SEARCH ENGINE] Using cached results for: "${query}"`);
        return cachedResults;
    }

    // Query all search engines in parallel
    const enginePromises = searchEngines.map(async (engine) => {
        try {
            const searchUrl = engine.url + encodeURIComponent(query);
            logger.log(`🔎 [SEARCH ENGINE] Querying ${engine.name} at: ${searchUrl}`);

            // Use a shorter timeout for search engine queries
            const response = await retry(() => fetchContent(searchUrl), 2, 500);
            if (!response) {
                logger.log(`🔎 [SEARCH ENGINE] No response from ${engine.name}`);
                return [];
            }

            let results = [];
            if (engine.isHtml) {
                results = extractSearchResults(response.text, engine.name);
                logger.log(`🔎 [SEARCH ENGINE] Extracted ${results.length} results from ${engine.name} HTML`);
            } else {
                // Handle JSON responses from different search engines
                results = extractJsonSearchResults(response.json, engine);
                
                // If JSON parsing failed or returned no results, try HTML fallback
                if (results.length === 0 && response.text) {
                    logger.log(`🔎 [SEARCH ENGINE] JSON parsing failed for ${engine.name}, trying HTML fallback`);
                    try {
                        results = extractSearchResults(response.text, engine.name);
                        logger.log(`🔎 [SEARCH ENGINE] Extracted ${results.length} results from ${engine.name} HTML fallback`);
                    } catch (fallbackError) {
                        logger.error(`🔎 [SEARCH ENGINE] HTML fallback also failed for ${engine.name}: ${fallbackError.message}`);
                    }
                }
                
                logger.log(`🔎 [SEARCH ENGINE] Extracted ${results.length} results from ${engine.name} JSON`);
            }

            // Filter out excluded domains and invalid URLs
            const filteredResults = results.filter(res =>
                res.url &&
                isValidUrl(res.url) &&
                !excludedDomains.some(d => res.url.includes(d)) &&
                !res.url.includes('javascript:') &&
                !res.url.includes('mailto:')
            );

            logger.log(`🔎 [SEARCH ENGINE] Added ${filteredResults.length} results from ${engine.name} after filtering`);
            return filteredResults;
        } catch (error) {
            logger.error(`🔎 [SEARCH ENGINE] Search with ${engine.name} failed: ${error.message}`);
            return [];
        }
    });

    // Wait for all search engine queries to complete
    const resultsArray = await Promise.all(enginePromises);
    const allResults = resultsArray.flat();

    // If no engines succeeded, return a helpful error message
    if (allResults.length === 0) {
        logger.error(`🔎 [SEARCH ENGINE] All search engines failed for query: "${query}"`);
        return [{
            title: 'Search Failed',
            snippet: `All search engines failed to return results for "${query}". This could be due to network issues or the sites blocking automated requests.`,
            url: '#',
            source: 'system'
        }];
    }

    // Get unique results by URL
    const uniqueResults = Array.from(new Map(allResults.map(r => [r.url, r])).values()).slice(0, 5);

    logger.log(`🔎 [SEARCH ENGINE] Returning ${uniqueResults.length} unique results for: "${query}"`);
    if (uniqueResults.length > 0) {
        logger.log(`🔎 [SEARCH ENGINE] First result: "${uniqueResults[0].title}"`);
    } else {
        logger.log(`🔎 [SEARCH ENGINE] No results found for: "${query}"`);
    }

    searchResultsCache.set(query, uniqueResults);
    return uniqueResults;
};

// Enhanced content fetching with parallel content fetching
const fetchAndProcessContent = async (results) => {
    logger.log(`🔎 [SEARCH ENGINE] Fetching and processing content for ${results.length} results`);

    // Process results in parallel
    const resultPromises = results.map(async (result) => {
        logger.log(`🔎 [SEARCH ENGINE] Processing result: "${result.title}" (${result.url})`);

        // Skip if we already have content
        if (result.content) {
            return result;
        }

        let content = contentCache.get(result.url);
        if (content) {
            logger.log(`🔎 [SEARCH ENGINE] Using cached content for: ${result.url}`);
            return { ...result, content };
        }

        logger.log(`🔎 [SEARCH ENGINE] Fetching content from: ${result.url}`);
        try {
            const fetched = await fetchContent(result.url);

            if (fetched?.isHtml) {
                // Process structured data if available
                if (fetched.structuredData) {
                    const processedData = processStructuredData(fetched.structuredData);
                    content = {
                        fullText: processedData.content,
                        prices: processedData.prices,
                        ratings: processedData.ratings,
                        headings: processedData.headings,
                        paragraphs: processedData.paragraphs
                    };
                } else {
                    content = extractMainContent(fetched.text);
                }

                // Truncate content if it's too long
                if (typeof content === 'string') {
                    if (content.length > maxContentLength) {
                        content = content.substring(0, maxContentLength) + '... [content truncated]';
                    }
                    logger.log(`🔎 [SEARCH ENGINE] Extracted ${content.length} characters of content from HTML`);
                } else if (typeof content === 'object' && content !== null) {
                    if (content.fullText && content.fullText.length > maxContentLength) {
                        content.fullText = content.fullText.substring(0, maxContentLength) + '... [content truncated]';
                    }
                    logger.log(`🔎 [SEARCH ENGINE] Extracted ${content.fullText?.length ?? 0} characters of content from HTML`);
                }
                contentCache.set(result.url, content);
            } else if (fetched?.json) {
                content = JSON.stringify(fetched.json);
                logger.log(`🔎 [SEARCH ENGINE] Extracted JSON content`);
            } else {
                content = 'Content could not be fetched or is not HTML/JSON';
                logger.log(`🔎 [SEARCH ENGINE] Failed to extract content or non-HTML content`);
            }

            return { ...result, content };
        } catch (error) {
            logger.error(`🔎 [SEARCH ENGINE] Failed to fetch content from ${result.url}: ${error.message}`);
            return {
                ...result,
                content: `Error fetching content: ${error.message}`
            };
        }
    });

    // Wait for all content fetching to complete
    const enrichedResults = await Promise.all(resultPromises);

    logger.log(`🔎 [SEARCH ENGINE] Returning ${enrichedResults.length} enriched results`);
    return enrichedResults;
};

// Main search function with improved error handling and turn sequence preservation
const search = async (query) => {
    logger.log(`🔎 [SEARCH ENGINE] Starting search process for: "${query}"`);

    try {
        const results = await performSearch(query);

        // If we got an error result, return it directly
        if (results.length === 1 && results[0].title === 'Search Failed') {
            return results;
        }

        // Use a longer timeout to allow for more complex searches
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Search operation timed out to maintain turn sequence'));
            }, 120000); // Increased timeout to 120 seconds
        });

        // Execute search with timeout
        let enrichedResults;
        try {
            enrichedResults = await Promise.race([
                fetchAndProcessContent(results),
                timeoutPromise
            ]);
        } catch (timeoutError) {
            logger.warn(`🔎 [SEARCH ENGINE] Search timed out for: "${query}" ${timeoutError.message}`);

            // If we timed out, try a simpler approach with just the first result
            if (results.length > 0) {
                logger.log(`🔎 [SEARCH ENGINE] Using fallback approach with first result`);
                const firstResult = results[0];

                // Create a simplified result with just the URL and title
                enrichedResults = [{
                    title: firstResult.title,
                    snippet: firstResult.snippet || 'No snippet available',
                    url: firstResult.url,
                    content: 'Content fetching timed out, but URL is available for reference'
                }];
            } else {
                throw timeoutError; // Re-throw if no results at all
            }
        }

        // If we have no results with content, try to provide a helpful message
        if (!enrichedResults || enrichedResults.length === 0) {
            return [{
                title: 'No Results Found',
                snippet: `No results could be found for "${query}". Try a different search term or check your network connection.`,
                url: '#',
                content: 'No search results available'
            }];
        }

        logger.log(`🔎 [SEARCH ENGINE] Search completed successfully for: "${query}"`);
        return enrichedResults;
    } catch (error) {
        logger.error(`🔎 [SEARCH ENGINE] Search failed for: "${query}" ${error}`);

        // Ensure browser is closed in case of error
        try {
            await closeBrowser();
        } catch (closeError) {
            logger.error(`Error closing browser during search error: ${closeError}`);
        }

        return [{
            title: 'Search Error',
            snippet: `An error occurred while searching for "${query}": ${error.message}`,
            url: '#',
            content: 'Search engine error'
        }];
    } finally {
        // Close the browser after search is complete
        try {
            await closeBrowser();
        } catch (finalError) {
            logger.error(`Final error closing browser: ${finalError}`);
        }
    }
};

export default search;
