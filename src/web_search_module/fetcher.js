//  Handles fetching URLs with error handling, timeouts, etc.
import { chromium } from 'playwright';
import { logInfo, logError } from './logger.js';

// No global browser state — each fetch call manages its own browser instance
// to prevent parallel fetches from closing each other's pages.

// No-op kept for backward compatibility with callers in search_tool.js / search.js
export async function closeBrowser() {
    // Browser lifecycle is now managed per-request inside fetchWithPlaywright
}

// Extract structured data from the page
async function extractPageData(page, url) {
    try {
        // Extract all text content
        const fullText = await page.content();

        // Extract specific elements that might contain useful information
        const title = await page.title();
        const headings = await page.$$eval('h1, h2, h3, h4, h5, h6', elements =>
            elements.map(el => el.textContent.trim())
        );

        // Extract links
        const links = await page.$$eval('a', elements =>
            elements.map(el => ({
                text: el.textContent.trim(),
                href: el.href
            }))
        );

        // Extract paragraphs and other text elements
        const paragraphs = await page.$$eval('p, article, section, div[role="main"]', elements =>
            elements.map(el => el.textContent.trim()).filter(text => text.length > 20)
        );

        // Extract lists
        const lists = await page.$$eval('ul, ol', elements =>
            elements.map(el => ({
                type: el.tagName,
                items: Array.from(el.querySelectorAll('li')).map(li => li.textContent.trim())
            }))
        );

        // Extract tables
        const tables = await page.$$eval('table', elements =>
            elements.map(table => {
                const rows = Array.from(table.querySelectorAll('tr'));
                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td, th'));
                    return cells.map(cell => cell.textContent.trim());
                });
            })
        );

        // Extract pricing information if available
        const prices = await page.$$eval('[class*="price"], [class*="cost"], [class*="rate"]', elements =>
            elements.map(el => el.textContent.trim())
        );

        // Extract rating information if available
        const ratings = await page.$$eval('[class*="rating"], [class*="score"], [class*="review"]', elements =>
            elements.map(el => el.textContent.trim())
        );

        return {
            url,
            title,
            headings,
            links,
            paragraphs,
            lists,
            tables,
            prices,
            ratings,
            fullText
        };
    } catch (error) {
        logError(`Error extracting page data: ${error}`);
        return {
            url,
            error: error.message,
            fullText: await page.content()
        };
    }
}

// Use Playwright to fetch content from a URL.
// A fresh browser is created for every call so parallel fetches never share state.
async function fetchWithPlaywright(url, retryCount = 3) {
    let localBrowser = null;
    try {
        localBrowser = await chromium.launch({
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--window-size=1280,800',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        const localContext = await localBrowser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true,
            bypassCSP: true,
            javaScriptEnabled: true
        });

        const page = await localContext.newPage();
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/'
        });

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await page.waitForTimeout(3000);

        const pageData = await extractPageData(page, url);

        return {
            url,
            text: pageData.fullText,
            isHtml: true,
            structuredData: pageData
        };
    } catch (error) {
        logError(`Playwright fetch failed for ${url}: ${error.message}`);

        if (retryCount > 0) {
            const delay = (4 - retryCount) * 2000; // 2s, 4s, 6s
            logInfo(`Retrying fetch for ${url} in ${delay}ms... (${retryCount} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithPlaywright(url, retryCount - 1);
        }

        return {
            url,
            text: `Content fetching failed for ${url}`,
            isHtml: false,
            error: error.message
        };
    } finally {
        if (localBrowser) {
            try {
                await localBrowser.close();
                logInfo('Browser closed successfully');
            } catch (e) {
                logError(`Error closing browser: ${e}`);
            }
            localBrowser = null;
        }
    }
}

// Enhanced fetchContent using Playwright
export const fetchContent = async (url) => {
    try {
        // Check if this is likely a JSON API endpoint
        const isJsonApi = url.includes('.json') ||
                         url.includes('api.') ||
                         url.includes('/api/') ||
                         url.includes('duckduckgo.com') ||
                         url.includes('search.brave.com') ||
                         url.includes('wikipedia.org/w/api.php') ||
                         url.includes('localhost:8080');
        
        if (isJsonApi) {
            // For JSON APIs, use direct fetch instead of Playwright
            try {
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': 'https://www.google.com/'
                    },
                    redirect: 'follow'
                });

                if (!response.ok) {
                    throw new Error(`HTTP error ${response.status} for ${url}`);
                }

                // For known JSON APIs, always try to parse as JSON first
                if (url.includes('duckduckgo.com') || url.includes('search.brave.com') || url.includes('wikipedia.org/w/api.php') || url.includes('localhost:8080')) {
                    try {
                        const textData = await response.text();
                        
                        // Check if response is actually HTML (rate limiting or blocking)
                        if (textData.startsWith('<!DOCTYPE') || textData.includes('<html') || textData.includes('<!')) {
                            logInfo(`JSON API returned HTML instead of JSON for ${url}, treating as HTML`);
                            return {
                                url,
                                text: textData,
                                isHtml: true,
                            };
                        }
                        
                        // Try to parse as JSON
                        const jsonData = JSON.parse(textData);
                        return {
                            url,
                            json: jsonData,
                            isHtml: false,
                        };
                    } catch (jsonError) {
                        logError(`Failed to parse JSON from ${url}: ${jsonError.message}`);
                        // Fall back to text if JSON parsing fails
                    }
                }

                const contentType = response.headers.get('Content-Type');

                if (contentType && contentType.includes('application/json')) {
                    return {
                        url,
                        json: await response.json(),
                        isHtml: false,
                    };
                } else {
                    // If it's not JSON, fall back to text
                    return {
                        url,
                        text: await response.text(),
                        isHtml: true,
                    };
                }
            } catch (error) {
                logError(`JSON API fetch failed for ${url}: ${error.message}`);
                // Fall through to Playwright attempt
            }
        }

        // For HTML pages or if JSON fetch failed, use Playwright
        const result = await fetchWithPlaywright(url);
        if (result) {
            return result;
        }

        // If Playwright fails, try with regular fetch as final fallback
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://www.google.com/'
                },
                redirect: 'follow'
            });

            if (!response.ok) {
                throw new Error(`HTTP error ${response.status} for ${url}`);
            }

            const contentType = response.headers.get('Content-Type');

            if (contentType && contentType.includes('text/html')) {
                return {
                    url,
                    text: await response.text(),
                    isHtml: true,
                };
            } else if (contentType && contentType.includes('application/json')) {
                return {
                    url,
                    json: await response.json(),
                    isHtml: false,
                };
            } else {
                logInfo(`Unsupported Content-Type: ${contentType} for ${url}, skipping`);
                return null;
            }
        } catch (error) {
            logError(`Fetch failed for ${url}: ${error.message}`);
            return null;
        }
    } catch (error) {
        logError(`Error in fetchContent for ${url}: ${error.message}`);
        return null;
    }
};