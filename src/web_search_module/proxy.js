/**
 * Proxy utility for fetching web content when direct access is blocked
 */

// List of public proxy servers that can be used to bypass restrictions
const PROXY_SERVERS = [
    // CORS Anywhere (if you have your own instance)
    'https://your-cors-anywhere.herokuapp.com/',

    // AllOrigins (public instance)
    'https://api.allorigins.win/get?url=', // Note: This has rate limits

    // Custom proxy endpoint if available
    'https://proxy.example.com/fetch?url='
];

// Try to use a local proxy if available, otherwise use a public one
let currentProxyIndex = 0;

// Create a proxy URL for a given target URL
export function createProxyUrl(targetUrl) {
    // First check if we have a local proxy configured
    if (PROXY_SERVERS[0] && PROXY_SERVERS[0].includes('your-cors-anywhere')) {
        console.log('Warning: You need to configure your own CORS Anywhere proxy for best results');
        // Fall back to public proxies
        return PROXY_SERVERS[1] + encodeURIComponent(targetUrl);
    }

    // Use the current proxy server
    const proxyUrl = PROXY_SERVERS[currentProxyIndex] + encodeURIComponent(targetUrl);

    // Rotate to the next proxy for the next request
    currentProxyIndex = (currentProxyIndex + 1) % PROXY_SERVERS.length;

    return proxyUrl;
}

// Function to check if a URL is likely to be blocked
export function isUrlLikelyBlocked(url) {
    const blockedDomains = [
        'tripadvisor.com',
        'sftravel.com',
        'youtube.com',
        'facebook.com',
        'twitter.com',
        'instagram.com',
        'amazon.com',
        'netflix.com'
    ];

    return blockedDomains.some(domain => url.includes(domain));
}
