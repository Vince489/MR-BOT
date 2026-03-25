/**
 * Sparse Encoder - Generates sparse vectors for hybrid search
 * Uses a simple BM25-inspired approach for keyword matching
 */

/**
 * Simple sparse vector encoder using TF-IDF style weighting
 */
export class SparseEncoder {
    constructor() {
        this.vocabulary = new Map(); // word -> index mapping
        this.nextIndex = 0;
        this.documentFrequency = new Map(); // word -> number of documents containing it
        this.totalDocuments = 0;
    }

    /**
     * Encode text into sparse vector format
     * @param {string} text - Text to encode
     * @returns {Object} Sparse vector {indices: Array<number>, values: Array<number>}
     */
    encode(text) {
        if (!text || typeof text !== 'string') {
            return { indices: [], values: [] };
        }

        // Tokenize and normalize
        const tokens = this._tokenize(text);
        if (tokens.length === 0) {
            return { indices: [], values: [] };
        }

        // Count term frequencies
        const termFreq = new Map();
        for (const token of tokens) {
            termFreq.set(token, (termFreq.get(token) || 0) + 1);
        }

        // Build sparse vector
        const indices = [];
        const values = [];

        for (const [token, freq] of termFreq) {
            // Get or create index for this token
            let index = this.vocabulary.get(token);
            if (index === undefined) {
                index = this.nextIndex++;
                this.vocabulary.set(token, index);
            }

            // Calculate TF-IDF style score
            const tf = freq / tokens.length; // Term frequency
            const df = this.documentFrequency.get(token) || 1; // Document frequency (default to 1)
            const idf = Math.log((this.totalDocuments || 1) + 1) / (df + 1); // Smoothed IDF
            const score = tf * idf;

            indices.push(index);
            values.push(score);
        }

        return { indices, values };
    }

    /**
     * Update document frequency counts (for better IDF calculation)
     * @param {Array<string>} documents - Array of documents to analyze
     */
    updateDocumentFrequency(documents) {
        this.documentFrequency.clear();
        this.totalDocuments = documents.length;

        for (const doc of documents) {
            const tokens = new Set(this._tokenize(doc)); // Use Set to count unique tokens per document
            for (const token of tokens) {
                this.documentFrequency.set(token, (this.documentFrequency.get(token) || 0) + 1);
            }
        }
    }

    /**
     * Get vocabulary size
     * @returns {number} Number of unique tokens
     */
    getVocabularySize() {
        return this.vocabulary.size;
    }

    /**
     * Tokenize text into words
     * @param {string} text - Text to tokenize
     * @returns {Array<string>} Array of tokens
     * @private
     */
    _tokenize(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Remove punctuation
            .split(/\s+/)
            .filter(token => token.length > 1 && !this._isStopWord(token)) // Filter short tokens and stop words
            .slice(0, 1000); // Limit tokens to prevent excessive processing
    }

    /**
     * Check if token is a common stop word
     * @param {string} token - Token to check
     * @returns {boolean} True if stop word
     * @private
     */
    _isStopWord(token) {
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
            'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
            'these', 'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your', 'yours',
            'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'theirs',
            'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'all', 'any',
            'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
            'only', 'own', 'same', 'so', 'than', 'too', 'very'
        ]);
        return stopWords.has(token);
    }
}

// Export singleton instance
export const sparseEncoder = new SparseEncoder();
