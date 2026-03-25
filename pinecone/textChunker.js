/**
 * Text Chunker Utility
 * Provides text splitting functionality for RAG systems
 */

/**
 * Recursive Character Text Splitter
 * Splits text into chunks with configurable size and overlap
 */
export class RecursiveCharacterTextSplitter {
    constructor(options = {}) {
        this.chunkSize = options.chunkSize || 2000; // ~500 tokens (4 chars/token)
        this.chunkOverlap = options.chunkOverlap || 200; // 10% overlap
        this.separators = options.separators || ['\n\n', '\n', ' ', ''];
    }

    /**
     * Split text into chunks
     * @param {string} text - Text to split
     * @returns {Array<string>} Array of text chunks
     */
    splitText(text) {
        if (!text || text.length <= this.chunkSize) {
            return [text];
        }

        const chunks = [];
        let remainingText = text;

        while (remainingText.length > 0) {
            let chunk = this._getChunk(remainingText);
            chunks.push(chunk);

            // Calculate overlap start position
            const overlapStart = Math.max(0, chunk.length - this.chunkOverlap);
            remainingText = remainingText.substring(overlapStart);

            // Prevent infinite loop
            if (remainingText === chunk) {
                break;
            }
        }

        return chunks.filter(chunk => chunk.trim().length > 0);
    }

    /**
     * Get a single chunk from the beginning of text
     * @param {string} text - Text to chunk
     * @returns {string} Chunk of text
     * @private
     */
    _getChunk(text) {
        if (text.length <= this.chunkSize) {
            return text;
        }

        // Try to split on separators
        for (const separator of this.separators) {
            if (separator === '') {
                // Last resort: hard cut
                return text.substring(0, this.chunkSize);
            }

            const parts = text.split(separator);
            let currentChunk = '';

            for (const part of parts) {
                if (currentChunk.length + part.length + separator.length > this.chunkSize) {
                    if (currentChunk.length === 0) {
                        // Single part is too big, take what we can
                        return part.substring(0, this.chunkSize);
                    }
                    break;
                }
                currentChunk += (currentChunk ? separator : '') + part;
            }

            if (currentChunk.length > 0) {
                return currentChunk;
            }
        }

        // Fallback: hard cut
        return text.substring(0, this.chunkSize);
    }
}

/**
 * Simple text chunking function for basic use cases
 * @param {string} text - Text to chunk
 * @param {number} chunkSize - Maximum chunk size in characters
 * @param {number} overlap - Overlap between chunks in characters
 * @returns {Array<string>} Array of text chunks
 */
export function chunkText(text, chunkSize = 2000, overlap = 200) {
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap: overlap });
    return splitter.splitText(text);
}

/**
 * Check if text needs chunking based on token estimation
 * @param {string} text - Text to check
 * @param {number} maxTokens - Maximum tokens allowed (default: 500)
 * @returns {boolean} True if text should be chunked
 */
export function needsChunking(text, maxTokens = 500) {
    if (!text) return false;
    // Rough estimation: ~4 characters per token
    const estimatedTokens = text.length / 4;
    return estimatedTokens > maxTokens;
}
