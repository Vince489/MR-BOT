import mongoose from 'mongoose';
import Session from '../models/Session.js';
import Message from '../models/Message.js';
import { dateTimeTool } from './dateTimeTool.js';
import { createTool } from './toolFactory.js';

/**
 * Persistent DB Search Tool for AI to search chat history across sessions
 * Provides comprehensive search capabilities for the chat history database
 */
console.log('🔍 [DBSEARCH TOOL] Initialized - Ready for persistent chat history search');

/**
 * Validates if a string is a valid MongoDB ObjectId
 */
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Resolves a session identifier to a MongoDB ObjectId
 */
async function resolveSessionId(sessionId) {
  try {
    if (!sessionId) {
      return null;
    }

    if (typeof sessionId === 'object' && sessionId.toString) {
      return sessionId;
    }

    // First resolve by business/sessionId field.
    const session = await Session.findOne({ sessionId }).lean();
    if (session) {
      return session._id;
    }

    // If no sessionId match exists, fall back to treating the value as a MongoDB ObjectId.
    if (isValidObjectId(sessionId)) {
      return sessionId;
    }

    return null;
  } catch (error) {
    console.error(`Error resolving sessionId ${sessionId}:`, error.message);
    return null;
  }
}

/**
 * Sanitizes search filters to prevent access to sensitive fields
 */
function sanitizeFilters(filters) {
  if (!filters || typeof filters !== 'object') {
    return {};
  }

  const forbiddenKeys = [
    'password', 'hash', 'salt', 'secret', 'token', 'key',
    '__v', '_id', 'session', 'user', 'createdAt', 'updatedAt'
  ];

  const sanitizedFilters = { ...filters };
  forbiddenKeys.forEach((key) => {
    if (key in sanitizedFilters) {
      delete sanitizedFilters[key];
    }
  });

  return sanitizedFilters;
}

/**
 * Parses natural language time expressions into Date objects
 */
async function parseTimeExpression(expression) {
  try {
    if (!expression) {
      return null;
    }

    const result = await dateTimeTool.handler({
      action: 'parseNaturalLanguage',
      expression
    });

    if (typeof result === 'string' && result.startsWith('Error:')) {
      console.warn(`Time expression parsing failed: ${result}`);
      return null;
    }

    const parsedDate = new Date(result);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  } catch (error) {
    console.error(`Error parsing time expression: ${error.message}`);
    return null;
  }
}

/**
 * Builds MongoDB query for time-based filtering
 */
async function buildTimeQuery(field, params) {
  const query = {};

  if (params.after) {
    const afterDate = await parseTimeExpression(params.after);
    if (afterDate) {
      query[field] = { ...query[field], $gte: afterDate };
    }
  }

  if (params.before) {
    const beforeDate = await parseTimeExpression(params.before);
    if (beforeDate) {
      query[field] = { ...query[field], $lte: beforeDate };
    }
  }

  if (params.last) {
    const duration = params.last;
    let amount;
    let unit;

    const match = duration.match(/^(\d+)\s*(hour|day|week|month|year)s?$/i);
    if (match) {
      amount = Number.parseInt(match[1], 10);
      unit = match[2].toLowerCase();
    } else {
      amount = Number.parseInt(duration, 10);
      unit = 'hours';
    }

    const now = new Date();
    const pastDate = new Date();
    switch (unit) {
      case 'year':
        pastDate.setFullYear(now.getFullYear() - amount);
        break;
      case 'month':
        pastDate.setMonth(now.getMonth() - amount);
        break;
      case 'week':
        pastDate.setDate(now.getDate() - (amount * 7));
        break;
      case 'day':
        pastDate.setDate(now.getDate() - amount);
        break;
      case 'hour':
      default:
        pastDate.setHours(now.getHours() - amount);
        break;
    }

    query[field] = { ...query[field], $gte: pastDate };
  }

  return query;
}

/**
 * Searches messages with comprehensive filtering
 */
async function searchMessages(params) {
  try {
    const { sessionId, session, ...searchParams } = params;
    let resolvedSessionId = null;

    // Resolve session identifier
    if (sessionId) {
      resolvedSessionId = await resolveSessionId(sessionId);
      if (!resolvedSessionId) {
        return {
          error: `Session with sessionId "${sessionId}" not found. Use listSessions to see available sessions.`
        };
      }
    } else if (session) {
      resolvedSessionId = await resolveSessionId(session);
    }

    // Build search query
    const sanitizedFilters = sanitizeFilters(searchParams.filters || {});
    const query = {
      ...(resolvedSessionId ? { session: resolvedSessionId } : {}),
      ...sanitizedFilters
    };

    // Add time filtering
    if (searchParams.after || searchParams.before || searchParams.last) {
      const timeQuery = await buildTimeQuery('createdAt', searchParams);
      Object.assign(query, timeQuery);
    }

    // Add text search if provided (with fallback if no text index)
    if (searchParams.query) {
      try {
        query.$text = { $search: searchParams.query };
      } catch (error) {
        // If text search fails, fall back to regex search
        query.content = { $regex: searchParams.query, $options: 'i' };
      }
    }

    // Set up options
    const options = {
      sort: searchParams.sort || { createdAt: -1 },
      limit: searchParams.limit || 50,
      skip: searchParams.skip || 0
    };

    // Execute search
    const messages = await Message.find(query, null, options).lean();
    const sessionInfo = resolvedSessionId
      ? await Session.findById(resolvedSessionId).lean()
      : null;

    // Get total count for pagination
    const totalCount = await Message.countDocuments(query);

    return {
      type: 'messageSearch',
      sessionId: sessionId || sessionInfo?.sessionId || null,
      sessionObjectId: resolvedSessionId,
      messageCount: messages.length,
      totalCount,
      messages: messages.map(msg => ({
        id: msg._id.toString(),
        role: msg.role,
        content: msg.content || '',
        createdAt: msg.createdAt,
        sessionId: sessionInfo?.sessionId || null,
        hastool_calls: msg.tool_calls && msg.tool_calls.length > 0
      })),
      sessionInfo: sessionInfo ? {
        sessionId: sessionInfo.sessionId,
        lastActivity: sessionInfo.lastActivity,
        model: sessionInfo.modelConfig?.model || 'unknown'
      } : null,
      query: JSON.stringify(query),
      pagination: {
        limit: options.limit,
        skip: options.skip,
        hasMore: messages.length < totalCount,
        total: totalCount
      },
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
 * Lists available sessions with metadata
 */
async function listSessions(params = {}) {
  try {
    const limit = params.limit || 20;
    const skip = params.skip || 0;

    const sessions = await Session.aggregate([
      { $sort: { lastActivity: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'messages',
          localField: '_id',
          foreignField: 'session',
          as: 'messages'
        }
      },
      {
        $addFields: {
          messageCount: { $size: '$messages' },
          lastMessage: { $arrayElemAt: ['$messages.createdAt', -1] }
        }
      },
      { $project: { messages: 0 } }
    ]);

    const formattedSessions = sessions.map((session) => ({
      sessionId: session.sessionId,
      lastActivity: session.lastActivity,
      messageCount: session.messageCount,
      lastMessage: session.lastMessage,
      model: session.modelConfig?.model || 'unknown',
      createdAt: session.createdAt
    }));

    return {
      type: 'sessionList',
      totalSessions: formattedSessions.length,
      sessions: formattedSessions,
      pagination: {
        limit,
        skip,
        hasMore: formattedSessions.length === limit
      },
      metadata: {
        executedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      error: `Failed to list sessions: ${error.message}`
    };
  }
}

/**
 * Gets detailed session information
 */
async function getSessionInfo(params, context = {}) {
  try {
    const { sessionId } = params;
    
    // If no sessionId provided, try to use current session from context
    let targetSessionId = sessionId;
    if (!targetSessionId && context.agent && context.agent.sessionId) {
      targetSessionId = context.agent.sessionId;
      console.log(`🔍 [DBSEARCH TOOL] Using current session ID from agent context: ${targetSessionId}`);
    }
    
    if (!targetSessionId) {
      return {
        error: 'sessionId parameter is required for getSessionInfo. No current session available.'
      };
    }

    const resolvedSessionId = await resolveSessionId(targetSessionId);
    if (!resolvedSessionId) {
      return {
        error: `Session with sessionId "${targetSessionId}" not found. Use listSessions to see available sessions.`
      };
    }

    const session = await Session.findById(resolvedSessionId).lean();
    if (!session) {
      return {
        error: `Session not found for sessionId: ${sessionId}`
      };
    }

    const messageStats = await Message.getSessionStats(session.sessionId);
    const recentMessages = await Message.find({ session: resolvedSessionId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    return {
      type: 'sessionInfo',
      sessionId: session.sessionId,
      lastActivity: session.lastActivity,
      model: session.modelConfig?.model || 'unknown',
      contextLimit: session.modelConfig?.contextLimit || 131072,
      messageStats,
      recentMessages: recentMessages.map(msg => ({
        id: msg._id.toString(),
        role: msg.role,
        content: msg.content || '',
        createdAt: msg.createdAt,
        hastool_calls: msg.tool_calls && msg.tool_calls.length > 0
      })),
      metadata: {
        executedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      error: `Failed to get session info: ${error.message}`
    };
  }
}

/**
 * Searches messages by time period with natural language support
 */
async function searchByTime(params) {
  try {
    const { timePeriod, sessionId } = params;
    
    if (!timePeriod) {
      return {
        error: 'timePeriod parameter is required for searchByTime'
      };
    }

    // Parse time period
    const timeQuery = await buildTimeQuery('createdAt', { last: timePeriod });
    if (Object.keys(timeQuery).length === 0) {
      return {
        error: `Invalid time period: ${timePeriod}. Try expressions like "24 hours", "7 days", "1 month", etc.`
      };
    }

    // Resolve session if provided
    let resolvedSessionId = null;
    if (sessionId) {
      resolvedSessionId = await resolveSessionId(sessionId);
      if (!resolvedSessionId) {
        return {
          error: `Session with sessionId "${sessionId}" not found. Use listSessions to see available sessions.`
        };
      }
    }

    // Build query
    const query = {
      ...timeQuery,
      ...(resolvedSessionId ? { session: resolvedSessionId } : {})
    };

    // Execute search
    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const sessionInfo = resolvedSessionId
      ? await Session.findById(resolvedSessionId).lean()
      : null;

    return {
      type: 'timeSearch',
      timePeriod,
      sessionId: sessionId || sessionInfo?.sessionId || null,
      messageCount: messages.length,
      messages: messages.map(msg => ({
        id: msg._id.toString(),
        role: msg.role,
        content: msg.content || '',
        createdAt: msg.createdAt,
        sessionId: sessionInfo?.sessionId || null,
        sessionObjectId: msg.session?.toString() || null
      })),
      sessionInfo: sessionInfo ? {
        sessionId: sessionInfo.sessionId,
        lastActivity: sessionInfo.lastActivity
      } : null,
      metadata: {
        executedAt: new Date().toISOString(),
        timeQuery: JSON.stringify(timeQuery)
      }
    };
  } catch (error) {
    return {
      error: `Failed to search by time: ${error.message}`
    };
  }
}

/**
 * Main handler function for the dbsearch tool
 */
async function handleDbSearch(params, context = {}) {
  try {
    const { action, taskProgress, ...restParams } = params;

    if (!action) {
      return {
        error: 'action parameter is required. Available actions: searchMessages, listSessions, getSessionInfo, searchByTime'
      };
    }

    console.log(`🔍 [DBSEARCH TOOL] Executing action: ${action}`);

    // Use the SESSION_ID from .env if no sessionId is provided
    if (!restParams.sessionId) {
      const envSessionId = process.env.SESSION_ID;
      if (envSessionId) {
        restParams.sessionId = envSessionId;
      }
    }

    switch (action) {
      case 'searchMessages':
        return searchMessages(restParams);

      case 'listSessions':
        return listSessions(restParams);

      case 'getSessionInfo':
        return getSessionInfo(restParams, context);

      case 'searchByTime':
        return searchByTime(restParams);

      default:
        return {
          error: `Unknown action: ${action}. Available actions: searchMessages, listSessions, getSessionInfo, searchByTime`
        };
    }
  } catch (error) {
    console.error('🔍 [DBSEARCH TOOL] Error during execution:', error);
    return {
      error: `An error occurred during database search: ${error.message}`
    };
  }
}

/**
 * DB Search Tool Definition
 * Provides persistent access to chat history search functionality
 */
export const dbsearchTool = createTool({
  name: 'dbsearch',
  description: 'Searches chat history across sessions with comprehensive filtering and time-based queries. Use this tool to find past conversations, explore sessions, and retrieve specific messages.',
  properties: {
    action: {
      type: "string",
      description: 'The search action to perform.',
      enum: ['searchMessages', 'listSessions', 'getSessionInfo', 'searchByTime']
    },
    sessionId: {
      type: "string",
      description: "Session identifier to filter results. Can be sessionId or MongoDB ObjectId."
    },
    query: {
      type: "string",
      description: "Text search query for finding specific messages or topics."
    },
    filters: {
      type: "object",
      description: "Additional MongoDB query filters to apply (e.g., { role: 'user' })."
    },
    after: {
      type: "string",
      description: "Find messages after this time (natural language like 'yesterday' or ISO date)."
    },
    before: {
      type: "string",
      description: "Find messages before this time (natural language like 'today' or ISO date)."
    },
    last: {
      type: "string",
      description: "Find messages from the last time period (e.g., '24 hours', '7 days', '1 month')."
    },
    sort: {
      type: "object",
      description: "Sort order for results (default: newest first by createdAt)."
    },
    limit: {
      type: "number",
      description: "Maximum number of results to return (default: 50)."
    },
    skip: {
      type: "number",
      description: "Number of results to skip for pagination."
    },
    timePeriod: {
      type: "string",
      description: "Time period for searchByTime action (e.g., '24 hours', '7 days')."
    }
  },
  required: ['action'],
  handler: handleDbSearch
});
