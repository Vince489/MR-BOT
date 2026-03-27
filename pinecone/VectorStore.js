import { upsertToPinecone, queryFromPinecone, deleteFromPinecone, pineconeClient, pineconeIndex } from './vectorStoreService.js';
import { generateEmbedding } from './embeddingService.js';
import { chunkText, needsChunking } from './textChunker.js';
import { rerankDocuments, isRerankAvailable } from './rerankService.js';

/**
 * VectorStore - Handles vector database operations and RAG retrieval
 * Encapsulates Pinecone operations with embedding generation
 */
export class VectorStore {
    constructor(options = {}) {
        this.sessionId = options.sessionId || 'default-session';
        this.defaultTopK = options.defaultTopK || 6;

        // Track Pinecone availability
        this.pineconeAvailable = this.isAvailable();
        this.lastPineconeCheck = Date.now();
        this.pineconeCheckInterval = 5 * 60 * 1000; // 5 minutes

        // Start synchronization timer
        this.syncInterval = 30 * 60 * 1000; // 30 minutes
        this.lastSyncTime = Date.now();
    }

    /**
     * Generate embedding for text with enhanced error handling
     * @param {string} text - Text to embed
     * @returns {Promise<Array<number>>} Embedding vector
     * @throws {Error} If embedding generation fails
     */
    async generateEmbedding(text) {
        try {
            // Validate input
            if (!text || typeof text !== 'string' || text.trim() === "") {
                throw new Error("Cannot generate embedding for empty or invalid text.");
            }

            // Generate embedding with retry logic
            return await generateEmbedding(text);
        } catch (error) {
            console.error('[VectorStore] Error generating embedding:', error);

            // Provide more specific error messages
            if (error.message.includes("fetch failed")) {
                throw new Error("Network error: Failed to connect to embedding service. Check your internet connection and API endpoint availability.");
            } else if (error.message.includes("rate limit")) {
                throw new Error("API rate limit exceeded. Consider reducing request frequency or increasing your quota.");
            } else if (error.message.includes("token limit")) {
                throw new Error("Input text exceeds the maximum length for embedding.");
            } else if (error.message.includes("API key not valid")) {
                throw new Error("Invalid API key. Check your GENAI_API_KEY environment variable.");
            } else {
                throw new Error(`Failed to generate embedding: ${error.message || error}`);
            }
        }
    }

    /**
     * Store a message in the vector database
     * Automatically chunks long texts to prevent API limits
     * @param {string} sessionId - Session ID
     * @param {string} messageId - Unique message ID
     * @param {string} text - Message text
     * @param {Object} metadata - Additional metadata
     * @param {string} userId - User ID for multi-user isolation
     * @returns {Promise<void>}
     */
    async storeMessage(sessionId, messageId, text, metadata = {}, userId = null) {
        try {
            // Check if text needs chunking
            if (needsChunking(text)) {
                // Split text into chunks
                const chunks = chunkText(text);
                console.log(`[VectorStore] Text for message ${messageId} exceeds token limit. Splitting into ${chunks.length} chunks.`);

                // Store each chunk separately
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const chunkId = `${messageId}_chunk_${i}`;

                    // Generate embedding for this chunk
                    let vector;
                    try {
                        vector = await this.generateEmbedding(chunk);
                    } catch (embeddingError) {
                        console.error(`[VectorStore] Failed to generate embedding for chunk ${i} of message ${messageId}:`, embeddingError);
                        continue; // Skip this chunk but continue with others
                    }

                    // Prepare metadata for chunk
                    const chunkMetadata = {
                        ...metadata,
                        sessionId,
                        text: chunk,
                        originalText: text,
                        timestamp: new Date().toISOString(),
                        chunkIndex: i,
                        totalChunks: chunks.length,
                        originalMessageId: messageId,
                        isChunk: true,
                        ...(userId && { userId })
                    };

                    await upsertToPinecone(sessionId, chunkId, vector, chunkMetadata);
                    console.log(`[VectorStore] Successfully stored chunk ${i + 1}/${chunks.length} for message ${messageId}`);
                }
            } else {
                // Text is small enough, store as single vector
                let vector;
                try {
                    vector = await this.generateEmbedding(text);
                } catch (embeddingError) {
                    console.error(`[VectorStore] Failed to generate embedding for message ${messageId}:`, embeddingError);
                    return; // Exit gracefully without throwing
                }

                // Prepare metadata for single message
                const fullMetadata = {
                    ...metadata,
                    sessionId,
                    text,
                    originalText: text,
                    timestamp: new Date().toISOString(),
                    ...(userId && { userId })
                };

                await upsertToPinecone(sessionId, messageId, vector, fullMetadata);
                console.log(`[VectorStore] Successfully stored message ${messageId} for session ${sessionId}`);
            }
        } catch (error) {
            console.error(`[VectorStore] Error storing message ${messageId}:`, error);
            // Don't throw - allow graceful degradation
        }
    }

    /**
     * Calculate recency score (0-1, newer = higher)
     * @param {string} timestamp - ISO timestamp string
     * @returns {number} Recency score
     */
    calculateRecencyScore(timestamp) {
        if (!timestamp) return 0.5; // Default if no timestamp

        const messageDate = new Date(timestamp);
        const now = new Date();
        const hoursOld = (now - messageDate) / (1000 * 60 * 60);

        // Decay function: newer messages get higher scores
        return Math.max(0, 1 - (hoursOld / 24)); // Full score for <24h, decays after
    }

    /**
     * Get role weight multiplier
     * @param {string} role - Message role
     * @returns {number} Role weight
     */
    getRoleScore(role) {
        const roleWeights = {
            'system': 1.5,    // System messages are very important
            'user': 1.2,      // User messages are important
            'tool': 1.3,      // Tool messages are important
            'assistant': 1.0, // Assistant messages are baseline
            'unknown': 0.8    // Unknown roles are less important
        };
        return roleWeights[role] || 1.0;
    }

    /**
     * Calculate importance score based on message content
     * @param {string} text - Message text
     * @returns {number} Importance score
     */
    calculateImportanceScore(text) {
        if (!text) return 0.5;

        // Longer messages tend to be more important
        const lengthScore = Math.min(text.length / 100, 1.5); // Cap at 1.5x

        // Messages with questions or commands may be more important
        const hasQuestion = text.includes('?') || text.toLowerCase().includes('how ') ||
            text.toLowerCase().includes('what ') || text.toLowerCase().includes('why ');
        const questionScore = hasQuestion ? 1.2 : 1.0;

        return lengthScore * questionScore;
    }

    /**
     * Calculate final relevance score combining multiple factors
     * @param {Object} match - Pinecone match result
     * @param {Array<number>} queryEmbedding - Query embedding vector
     * @returns {number} Final relevance score
     */
    async calculateRelevanceScore(match, queryEmbedding) {
        // Base similarity score from Pinecone
        let finalScore = match.score || 0;

        // Calculate additional scores
        const recencyScore = this.calculateRecencyScore(match.metadata?.timestamp);
        const roleScore = this.getRoleScore(match.metadata?.role);
        const importanceScore = this.calculateImportanceScore(match.metadata?.originalText || match.metadata?.text);

        // Combine scores multiplicatively
        finalScore *= (1 + recencyScore * 0.3);  // 30% weight to recency
        finalScore *= roleScore;                 // Full weight to role
        finalScore *= importanceScore;           // Full weight to importance

        return finalScore;
    }

    /**
     * Perform raw vector search without re-ranking
     * This serves as the "Dense" leg of the Hybrid Search
     *
     * @param {string} query - Search query
     * @param {string} sessionId - Session ID
     * @param {number} limit - Max results
     * @param {string} userId - Optional user ID for filtering
     * @returns {Promise<Array>} Array of Pinecone matches
     */
    async searchVectors(query, sessionId, limit = 50, userId = null) {
        const targetSessionId = sessionId || this.sessionId;

        if (!query || query.trim() === '') {
            return [];
        }

        try {
            // Generate query embedding
            let queryEmbedding;
            try {
                queryEmbedding = await this.generateEmbedding(query);
            } catch (embeddingError) {
                console.error(`[VectorStore] Failed to generate query embedding:`, embeddingError);
                return [];
            }

            // Query Pinecone
            const pineconeResults = await queryFromPinecone(targetSessionId, queryEmbedding, limit, userId);

            // Attach the query embedding to the results for later use (e.g. in re-ranking)
            pineconeResults.forEach(r => r.queryEmbedding = queryEmbedding);

            return pineconeResults;
        } catch (error) {
            console.error(`[VectorStore] Error searching vectors:`, error);
            return [];
        }
    }

    /**
     * Query for relevant context using advanced RAG with optional reranking and hybrid search
     * @param {string} query - The user query
     * @param {number} topK - Number of results to retrieve
     * @param {string} sessionId - Optional session ID (defaults to instance sessionId)
     * @param {string} userId - Optional user ID for filtering
     * @param {Object} options - Advanced options
     * @param {boolean} options.enableRerank - Enable Mistral reranking for better accuracy
     * @param {boolean} options.enableHybrid - Enable hybrid search (semantic + keyword)
     * @param {number} options.alpha - Hybrid search balance (0.0=sparse only, 1.0=dense only)
     * @returns {Promise<Array>} Array of relevant context snippets
     */
    async getRelevantContext(query, topK = null, sessionId = null, userId = null, options = {}) {
        const k = topK || this.defaultTopK;
        const targetSessionId = sessionId || this.sessionId;

        if (!query || query.trim() === '') {
            return [];
        }

        try {
            // Generate query embedding
            let queryEmbedding;
            try {
                queryEmbedding = await this.generateEmbedding(query);
            } catch (embeddingError) {
                console.error(`[VectorStore] Failed to generate query embedding:`, embeddingError);
                return [];
            }

            // Query Pinecone with optional hybrid search
            const queryOptions = {
                enableHybrid: options.enableHybrid || false,
                queryText: options.enableHybrid ? query : null,
                alpha: options.alpha || 0.5
            };

            const pineconeResults = await queryFromPinecone(targetSessionId, queryEmbedding, k * 3, userId, queryOptions);

            if (pineconeResults.length === 0) return [];

            // Attach query embedding for scoring
            pineconeResults.forEach(r => r.queryEmbedding = queryEmbedding);

            // Optional reranking with Mistral
            let candidates = pineconeResults;
            if (options.enableRerank && isRerankAvailable()) {
                console.log(`[VectorStore] Reranking ${pineconeResults.length} candidates with Mistral`);

                // Extract texts for reranking
                const textsForRerank = pineconeResults.map(match =>
                    match.metadata?.originalText || match.metadata?.text || ''
                );

                try {
                    const rerankedResults = await rerankDocuments(query, textsForRerank, k * 2);

                    // Map reranked results back to original matches
                    candidates = rerankedResults.map(reranked => {
                        const originalMatch = pineconeResults[reranked.originalIndex];
                        return {
                            ...originalMatch,
                            rerankScore: reranked.rerankScore,
                            rank: reranked.rank
                        };
                    });

                    console.log(`[VectorStore] Reranking complete. Top result score: ${candidates[0]?.rerankScore || 'N/A'}`);
                } catch (rerankError) {
                    console.warn(`[VectorStore] Reranking failed, falling back to vector search:`, rerankError.message);
                    // Continue with original results
                }
            }

            // Apply custom scoring logic
            const scoredResults = await Promise.all(
                candidates.map(async match => {
                    try {
                        // Calculate final score for each match
                        const finalScore = await this.calculateRelevanceScore(match, match.queryEmbedding);

                        // Apply multi-stage scoring for better relevance
                        const recencyScore = this.calculateRecencyScore(match.metadata?.timestamp);
                        const roleScore = this.getRoleScore(match.metadata?.role);
                        const importanceScore = this.calculateImportanceScore(match.metadata?.originalText || match.metadata?.text);

                        // Combine all scores
                        const enhancedScore = finalScore * (1 + recencyScore * 0.3) * roleScore * importanceScore;

                        // Use rerank score if available, otherwise enhanced score
                        const primaryScore = match.rerankScore !== undefined ? match.rerankScore : enhancedScore;

                        return {
                            ...match,
                            finalScore,
                            enhancedScore,
                            primaryScore,
                            recencyScore,
                            roleScore,
                            importanceScore
                        };
                    } catch (scoreError) {
                        console.error(`[VectorStore] Error calculating relevance score:`, scoreError);
                        return match;
                    }
                })
            );

            // Sort by primary score (rerank or enhanced) and take top K
            const sortedResults = scoredResults
                .sort((a, b) => (b.primaryScore || 0) - (a.primaryScore || 0))
                .slice(0, k);

            // Format results
            return sortedResults.map(match => ({
                text: match.metadata?.originalText || match.metadata?.text || '',
                role: match.metadata?.role || 'unknown',
                score: match.score || 0,
                enhancedScore: match.enhancedScore || 0,
                rerankScore: match.rerankScore,
                timestamp: match.metadata?.timestamp || null,
                sessionId: match.metadata?.sessionId || targetSessionId,
                metadata: match.metadata
            }));

        } catch (error) {
            console.error(`[VectorStore] Error in getRelevantContext:`, error);
            return [];
        }
    }

    /**
     * Delete all vectors for a session
     * @param {string} sessionId - Session ID to clear
     * @returns {Promise<void>}
     */
    async clearSession(sessionId = null) {
        const targetSessionId = sessionId || this.sessionId;

        try {
            await deleteFromPinecone(targetSessionId);
            console.log(`[VectorStore] Cleared all vectors for session ${targetSessionId}`);
        } catch (error) {
            console.error(`[VectorStore] Error clearing vectors for session ${targetSessionId}:`, error);
            // Don't throw - graceful degradation
        }
    }

    /**
     * Batch store multiple messages
     * @param {string} sessionId - Session ID
     * @param {Array} messages - Array of {id, text, metadata} objects
     * @returns {Promise<Object>} Results with success/failure counts
     */
    async storeBatch(sessionId, messages) {
        const results = { success: 0, failed: 0 };

        for (const msg of messages) {
            try {
                await this.storeMessage(sessionId, msg.id, msg.text, msg.metadata);
                results.success++;
            } catch (error) {
                console.error(`[VectorStore] Failed to store message ${msg.id}:`, error.message);
                results.failed++;
            }
        }

        console.log(`[VectorStore] Batch store complete. Success: ${results.success}, Failed: ${results.failed}`);
        return results;
    }

    /**
     * Check if Pinecone is currently available
     * @returns {Promise<boolean>} True if Pinecone is available
     */
    async checkPineconeAvailability() {
        // If we recently checked, use cached value
        if (Date.now() - this.lastPineconeCheck < this.pineconeCheckInterval) {
            console.log(`[VectorStore] Using cached Pinecone availability: ${this.pineconeAvailable}`);
            return this.pineconeAvailable;
        }

        this.lastPineconeCheck = Date.now();
        console.log('[VectorStore] Checking Pinecone availability...');

        try {
            // First check if Pinecone client and index are initialized
            if (!pineconeClient || !pineconeIndex) {
                console.log('[VectorStore] Pinecone client or index not initialized');
                this.pineconeAvailable = false;
                return false;
            }

            console.log('[VectorStore] Pinecone client and index are initialized, testing connection...');

            // Try a simple describeIndexStats call first - this is the most reliable way to check availability
            try {
                console.log('[VectorStore] Attempting describeIndexStats...');
                const stats = await pineconeIndex.describeIndexStats();
                console.log('[VectorStore] describeIndexStats successful. Pinecone is available.');
                this.pineconeAvailable = true;
                return true;
            } catch (error) {
                console.error('[VectorStore] describeIndexStats failed:', error);
                console.log('[VectorStore] Trying alternative check: listNamespaces...');
            }

            // Fallback: Try a simple namespace list operation
            try {
                const namespaces = await pineconeIndex.listNamespaces();
                console.log('[VectorStore] listNamespaces successful. Namespaces:', namespaces?.namespaces);
                this.pineconeAvailable = true;
                return true;
            } catch (error) {
                console.error('[VectorStore] listNamespaces failed:', error);
            }

            // If all checks fail, mark as unavailable
            this.pineconeAvailable = false;
            console.error('[VectorStore] All Pinecone availability checks failed. Marking as unavailable.');
            return false;
        } catch (error) {
            this.pineconeAvailable = false;
            console.error('[VectorStore] Unexpected error checking Pinecone availability:', error);
            return false;
        }
    }

    /**
     * Check if vector store is available
     * @returns {boolean} True if available
     */
    isAvailable() {
        // Check if Pinecone is configured
        return !!(process.env.PINECONE_API_KEY && process.env.PINECONE_HOST_URL);
    }

    /**
     * Get vector store statistics
     * @returns {Object} Statistics about the vector store
     */
    getStats() {
        return {
            available: this.pineconeAvailable,  // This is what MemoryCore checks for
            pineconeAvailable: this.pineconeAvailable,  // Keep for backward compatibility
            sessionId: this.sessionId,
            defaultTopK: this.defaultTopK,
            configured: {
                apiKey: !!process.env.PINECONE_API_KEY,
                hostUrl: !!process.env.PINECONE_HOST_URL,
                indexName: !!process.env.PINECONE_INDEX_NAME
            }
        };
    }
}
