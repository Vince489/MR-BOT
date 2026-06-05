/**
 * SessionManager class handles session-related functionality
 */
export class SessionManager {
    /**
     * Creates a new SessionManager instance
     */
    constructor() {
        this.sessionId = this._generateSessionId();
    }

    /**
     * Generate a unique session ID
     * @returns {string} - Generated session ID
     */
    _generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get the current session ID
     * @returns {string} - Current session ID
     */
    getSessionId() {
        return this.sessionId;
    }

    /**
     * Set a custom session ID
     * @param {string} sessionId - Custom session ID
     */
    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }
}