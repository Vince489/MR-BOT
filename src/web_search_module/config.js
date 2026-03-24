//  Configuration for search engines, timeouts, etc.
export const searchEngines = [
    {
        name: 'SearXNG',
        url: 'http://localhost:8080/search?format=json&q=',
        isHtml: false,
        apiType: 'searxng'
    },
    {
        name: 'DuckDuckGo',
        url: 'https://api.duckduckgo.com/?format=json&q=',
        isHtml: false,
        apiType: 'duckduckgo'
    },
    {
        name: 'Wikipedia Search',
        url: 'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srsearch=',
        isHtml: false,
        apiType: 'wikipedia'
    }
];

export const fetchTimeout = 15000; // milliseconds - increased timeout
export const maxContentLength = 5000; // increased content length
export const maxSearchRetries = 5; // increased retries
export const cacheExpiration = 30 * 60 * 1000; // milliseconds
export const myUserAgent = 'MyAwesomeSearchBot/1.0';
export const excludedDomains = [
    'facebook.com',
    'twitter.com',
    'instagram.com',
    'youtube.com',
    'tiktok.com',
    'reddit.com',
    'pinterest.com',
    'linkedin.com',
    'snapchat.com',
    'tumblr.com',
    'flickr.com',
    'vimeo.com',
    'twitch.tv',
    'discord.com',
    'whatsapp.com',
    'telegram.org',
    'signal.org'
];
