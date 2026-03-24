/**
 * Logger utility for the search tool
 */

export function logInfo(message) {
    console.log(`[INFO] ${message}`);
}

export function logError(message) {
    console.error(`[ERROR] ${message}`);
}

export function logDebug(message) {
    console.debug(`[DEBUG] ${message}`);
}

// Logger object for compatibility with search.js
export const logger = {
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    info: (...args) => console.info(...args),
    debug: (...args) => console.debug(...args),
};
