
import mongoose from 'mongoose';
import { Message } from '../models/Message.js';

/**
 * MongoDB Search Tool with automatic ID resolution and better error handling
 */
class MongoDBSearchTool {
    constructor() {
        this.name = 'mongodb_search';
        this.description = 'Search and explore MongoDB chat message data with session management and time-based filtering.';
        this.initialized = false;
        this.collections = {
            messages: Message
        };
        this.dateTimeTool = null;
    }

    async initialize() {
        this.initialized = true;
        // Import the DateTimeTool class and create an instance
        const { DateTimeTool } = await import('./date_time_tool.js');
        this.dateTimeTool = new DateTimeTool();
        this.dateTimeTool.initialize();
        console.log(`MONGODB SEARCH TOOL] Initialized - Ready for MongoDB operations`);
    }

    /**
     * Automatically resolves sessionId to MongoDB _id
     * Handles both string sessionId and ObjectId formats
     */
    async resolveSessionId(sessionId) {
        try {
            // If it's already an ObjectId, return as is
            if (typeof sessionId === 'object' && sessionId.toString) {
                return sessionId;
            }

            // If it's a valid ObjectId string, use it directly
            if (this.isValidObjectId(sessionId)) {
                return sessionId;
            }

            // For Message model, we use sessionId directly as it's stored in the field
            // Check if messages exist with this sessionId
            const message = await Message.findOne({ sessionId: sessionId });
            if (message) {
                return sessionId; // Use the sessionId directly for Message queries
            }

            // If not found, return null
            return null;
        } catch (error) {
            console.error(`Error resolving sessionId ${sessionId}:`, error.message);
            return null;
        }
    }

    /**
     * Get the current session ID from StorageManager
     */
    async getCurrentSessionId() {
        try {
            // Import StorageManager to get current session
            const { StorageManager } = await import('../storage/StorageManager.js');
            const storageManager = new StorageManager();
            
            // Initialize with current storage type to get session info
            const currentType = process.env.DEFAULT_STORAGE || 'json';
            await storageManager.initialize(currentType);
            
            const status = await storageManager.getStatus();
            return status.sessionId || status.currentType;
        } catch (error) {
            console.error('Error getting current session ID:', error.message);
            return null;
        }
    }

    /**
     * Checks if a string is a valid MongoDB ObjectId using Mongoose validation
     */
    isValidObjectId(id) {
        return mongoose.Types.ObjectId.isValid(id);
    }

    /**
     * Sanitizes additional filters to prevent NoSQL injection
     * Removes potentially dangerous fields from user-provided filters
     */
    sanitizeFilters(filters) {
        if (!filters || typeof filters !== 'object') {
            return {};
        }

        const forbiddenKeys = [
            'password', 'hash', 'salt', 'secret', 'token', 'key', 
            '__v', '_id', 'session', 'user', 'createdAt', 'updatedAt'
        ];

        const sanitizedFilters = { ...filters };
        
        forbiddenKeys.forEach(key => {
            if (key in sanitizedFilters) {
                delete sanitizedFilters[key];
            }
        });

        return sanitizedFilters;
    }

    /**
     * Session explorer - lists all sessions with metadata using aggregation pipeline
     * Works with Message model to find unique sessionIds
     */
    async exploreSessions(params = {}) {
        try {
            const limit = params.limit || 20;
            const skip = params.skip || params.page ? (params.page - 1) * limit : 0;

            // Get unique sessionIds from Message collection
            const sessionDetails = await Message.aggregate([
                { $group: { _id: '$sessionId', messageCount: { $sum: 1 }, lastActivity: { $max: '$timestamp' } } },
                { $sort: { lastActivity: -1 } },
                { $skip: skip },
                { $limit: limit }
            ]);

            // Convert to the expected format
            const formattedSessions = sessionDetails.map(session => ({
                sessionId: session._id,
                messageCount: session.messageCount,
                lastActivity: session.lastActivity,
                _id: session._id // Use sessionId as _id for Message model
            }));

            return {
                type: 'session_explorer',
                totalSessions: formattedSessions.length,
                sessions: formattedSessions,
                pagination: {
                    limit: limit,
                    skip: skip,
                    page: params.page || 1,
                    hasMore: formattedSessions.length === limit
                },
                metadata: {
                    executedAt: new Date().toISOString(),
                    note: "Use sessionId for human-readable IDs, _id for database operations"
                }
            };
        } catch (error) {
            return {
                error: `Failed to explore sessions: ${error.message}`
            };
        }
    }

    /**
     * Message search with automatic session resolution
     */
    async searchMessages(params) {
        try {
            const { sessionId, session, content, role, ...searchParams } = params;

            // Resolve session identifier to MongoDB _id
            let resolvedSessionId = null;

            if (sessionId) {
                resolvedSessionId = await this.resolveSessionId(sessionId);
                if (!resolvedSessionId) {
                    return {
                        error: `Session with sessionId "${sessionId}" not found. Available sessions: ${await this.getSessionIds()}`
                    };
                }
            } else if (session) {
                // If session is already an ObjectId or string, validate it
                if (this.isValidObjectId(session)) {
                    resolvedSessionId = session;
                } else {
                    resolvedSessionId = await this.resolveSessionId(session);
                }
            }

            // Build the query with sanitized filters
            const sanitizedFilters = this.sanitizeFilters(searchParams.additionalFilters);
            const query = {
                ...(resolvedSessionId && { sessionId: resolvedSessionId }),
                ...sanitizedFilters
            };

            // Add content search (case-insensitive)
            if (content) {
                query.content = { $regex: content, $options: 'i' };
            }

            // Add role filter
            if (role) {
                query.role = role;
            }

            // Add time-based filters if provided
            if (searchParams.after || searchParams.before || searchParams.last || searchParams.between) {
                const timeQuery = this.buildTimeQuery('timestamp', searchParams);
                Object.assign(query, timeQuery);
            }

            // Execute search
            const options = {
                sort: searchParams.sort || { timestamp: -1 },
                limit: searchParams.limit || 100,
                projection: searchParams.fields
            };

            const messages = await Message.find(query, null, options).lean();

            // Add session info to results (for Message, sessionId is the identifier)
            let sessionInfo = null;
            if (resolvedSessionId) {
                sessionInfo = {
                    sessionId: resolvedSessionId,
                    lastActivity: await this.getSessionLastActivity(resolvedSessionId)
                };
            }

            return {
                type: 'message_search',
                sessionId: sessionId || (sessionInfo ? sessionInfo.sessionId : null),
                sessionObjectId: resolvedSessionId,
                messageCount: messages.length,
                messages: messages,
                sessionInfo: sessionInfo,
                query: JSON.stringify(query),
                metadata: {
                    executedAt: new Date().toISOString(),
                    resolvedSessionId: resolvedSessionId ? resolvedSessionId.toString() : null
                }
            };
        } catch (error) {
            return {
                error: `Failed to search messages: ${error.message}`
            };
        }
    }

    /**
     * Get the last activity time for a session
     */
    async getSessionLastActivity(sessionId) {
        try {
            const lastMessage = await Message.findOne({ sessionId: sessionId })
                .sort({ timestamp: -1 })
                .lean();
            return lastMessage ? lastMessage.timestamp : null;
        } catch (error) {
            console.error(`Error getting last activity for session ${sessionId}:`, error.message);
            return null;
        }
    }

    /**
     * Get list of all session IDs for reference
     */
    async getSessionIds() {
        try {
            const sessions = await Message.distinct('sessionId');
            return sessions.join(', ');
        } catch (error) {
            return 'Error retrieving session IDs';
        }
    }

    /**
     * Sync status checker
     */
    async checkSyncStatus(params) {
        try {
            const { sessionId, session } = params;

            // Resolve session to get _id
            const resolvedSessionId = await this.resolveSessionId(sessionId || session);
            if (!resolvedSessionId) {
                return {
                    error: `Session not found: ${sessionId || session}`
                };
            }

            // Get session info (for Message, sessionId is the identifier)
            const sessionInfo = {
                sessionId: resolvedSessionId,
                lastActivity: await this.getSessionLastActivity(resolvedSessionId)
            };

            // Count messages in database
            const dbMessageCount = await Message.countDocuments({ sessionId: resolvedSessionId });

            // Get recent messages to check timing
            const recentMessages = await Message.find(
                { sessionId: resolvedSessionId },
                { timestamp: 1, content: 1 }
            ).sort({ timestamp: -1 }).limit(5).lean();

            // Calculate sync delay
            const now = new Date();
            const lastMessageTime = recentMessages.length > 0 ? recentMessages[0].timestamp : null;
            const delayMinutes = lastMessageTime ? (now - lastMessageTime) / (1000 * 60) : 0;

            return {
                type: 'sync_status',
                sessionId: sessionInfo?.sessionId,
                sessionObjectId: resolvedSessionId.toString(),
                lastActivity: sessionInfo?.lastActivity,
                databaseMessageCount: dbMessageCount,
                recentMessages: recentMessages.map(m => ({
                    content: m.content.substring(0, 50) + '...',
                    createdAt: m.timestamp,
                    delayMinutes: (now - m.timestamp) / (1000 * 60)
                })),
                syncStatus: delayMinutes > 5 ? 'WARNING: Possible sync delay detected' : 'OK',
                metadata: {
                    checkedAt: now.toISOString(),
                    delayMinutes: delayMinutes
                }
            };
        } catch (error) {
            return {
                error: `Failed to check sync status: ${error.message}`
            };
        }
    }

    /**
     * Parse time expressions using the centralized DateTimeTool
     */
    parseTimeExpression(expression) {
        try {
            if (!expression) return null;

            // Use the centralized DateTimeTool for parsing
            const result = this.dateTimeTool.parseNaturalLanguage({ expression });
            
            // If the result is an error message, return null
            if (typeof result === 'string' && result.startsWith('Error:')) {
                console.warn(`Time expression parsing failed: ${result}`);
                return null;
            }

            // Convert ISO string to Date object
            return new Date(result);
        } catch (error) {
            console.error(`Error parsing time expression: ${error.message}`);
            return null;
        }
    }

    /**
     * Build time query for search
     */
    buildTimeQuery(field, params) {
        const query = {};

        if (params.after) {
            const afterDate = this.parseTimeExpression(params.after);
            if (afterDate) query[field] = { ...query[field], $gte: afterDate };
        }

        if (params.before) {
            const beforeDate = this.parseTimeExpression(params.before);
            if (beforeDate) query[field] = { ...query[field], $lte: beforeDate };
        }

        if (params.last) {
            const duration = params.last;
            let amount, unit;

            const match = duration.match(/^(\d+)\s*(hour|day|week|month|year)s?$/i);
            if (match) {
                amount = parseInt(match[1]);
                unit = match[2].toLowerCase();
            } else {
                amount = parseInt(duration);
                unit = 'hours';
            }

            const now = new Date();
            const pastDate = new Date();

            switch(unit) {
                case 'year': pastDate.setFullYear(now.getFullYear() - amount); break;
                case 'month': pastDate.setMonth(now.getMonth() - amount); break;
                case 'week': pastDate.setDate(now.getDate() - (amount * 7)); break;
                case 'day': pastDate.setDate(now.getDate() - amount); break;
                case 'hour':
                default: pastDate.setHours(now.getHours() - amount); break;
            }

            query[field] = { ...query[field], $gte: pastDate };
        }

        return query;
    }

    /**
     * Main search function 
     */
    async search(params) {
        try {
            // Validate required parameters
            if (!params.collection) {
                return "Error: 'collection' parameter is required.";
            }

            // Handle special operations
            if (params.operation === 'explore_sessions') {
                return await this.exploreSessions(params);
            }

            if (params.operation === 'check_sync_status') {
                return await this.checkSyncStatus(params);
            }

            if (params.collection.toLowerCase() === 'messages') {
                return await this.searchMessages(params);
            }

            // Handle other collections with standard search
            return await this.standardSearch(params);
        } catch (error) {
            console.error(`MONGODB SEARCH TOOL] Error during search:`, error);
            return {
                error: `An error occurred during MongoDB search: ${error.message}`
            };
        }
    }

    /**
     * Standard search for non-message collections
     */
    async standardSearch(params) {
        try {
            const collectionModel = this.collections[params.collection.toLowerCase()];
            if (!collectionModel) {
                return {
                    error: `Collection '${params.collection}' not found. Available collections: ${Object.keys(this.collections).join(', ')}`
                };
            }

            // Build query with time filters and sanitized additional filters
            const timeQuery = this.buildTimeQuery(params.timeField || 'createdAt', params);
            const sanitizedFilters = this.sanitizeFilters(params.additionalFilters);
            const query = {
                ...timeQuery,
                ...sanitizedFilters
            };

            const options = {
                sort: params.sort || { [params.timeField || 'createdAt']: -1 },
                limit: params.limit || 100,
                projection: params.fields
            };

            const results = await collectionModel.find(query, null, options).lean();

            return {
                type: 'standard_search',
                collection: params.collection,
                count: results.length,
                results: results,
                query: JSON.stringify(query),
                metadata: {
                    executedAt: new Date().toISOString()
                }
            };
        } catch (error) {
            return {
                error: `Failed standard search: ${error.message}`
            };
        }
    }
}

// Create tool instance
const MongoDBSearchToolInstance = new MongoDBSearchTool();

// Optimized tool definition for Mistral SDK
export const mongodbSearchTool = {
  function: {
    name: 'mongodb_search',
    description: 'Search and explore MongoDB chat message data with session management and time-based filtering.',
    parameters: {
      type: "object",
      properties: {
        collection: {
          type: "string",
          description: "The collection to search (messages).",
          enum: ["messages"]
        },
        operation: {
          type: "string",
          description: "Special operation to perform (explore_sessions, check_sync_status).",
          enum: ["explore_sessions", "check_sync_status"]
        },
        sessionId: {
          type: "string",
          description: "Human-readable session ID (auto generated if not provided)"
        },
        session: {
          type: "string",
          description: "Session identifier (can be sessionId or MongoDB _id)."
        },
        after: {
          type: "string",
          description: "Find messages after this time (ISO date string or natural language like 'yesterday')."
        },
        before: {
          type: "string",
          description: "Find messages before this time (ISO date string or natural language like 'today')."
        },
        last: {
          type: "string",
          description: "Find messages from the last X time period (e.g., '24 hours', '7 days', '1 month')."
        },
        content: {
          type: "string",
          description: "Search for messages containing this text content."
        },
        role: {
          type: "string",
          description: "Filter messages by role (user, assistant, system, tool).",
          enum: ["user", "assistant", "system", "tool"]
        },
        additionalFilters: {
          type: "object",
          description: "Additional MongoDB query filters to apply."
        },
        sort: {
          type: "object",
          description: "Sort order for results (default: newest first by timestamp)."
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 100)."
        }
      },
      required: ["collection"]
    }
  },
  handler: async (params) => {
    console.log(`MONGODB SEARCH TOOL] Executing mongodb_search with params:`, params);

    // Extract task_progress if present
    const { task_progress, ...restParams } = params;

    try {
      return await MongoDBSearchToolInstance.search(restParams);
    } catch (error) {
      console.error(`🗃️ [ MONGODB SEARCH TOOL] Unexpected error during execution:`, error);
      return {
        error: `An unexpected error occurred in the MongoDB search tool: ${error.message}`
      };
    }
  }
};

// Export the tool function for backward compatibility
export const MongoDBSearch = mongodbSearchTool.handler;

// Initialize the tool
export async function initializeMongoDBSearchTool() {
    await MongoDBSearchToolInstance.initialize();
}