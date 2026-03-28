import mongoose from 'mongoose';
import User from '../models/User.js';
import Session from '../models/Session.js';
import Message from '../models/Message.js';
import { dateTimeTool } from './date_time_tool.js';

const description = 'Performs MongoDB search with automatic ID resolution, better error handling, and session exploration capabilities. Use this tool to query the database when needed.';
const collections = {
  users: User,
  sessions: Session,
  messages: Message
};

console.log('🗃️ [MONGODB SEARCH TOOL] Initialized - Ready for MongoDB operations');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function resolveSessionId(sessionId) {
  try {
    if (!sessionId) {
      return null;
    }

    if (typeof sessionId === 'object' && sessionId.toString) {
      return sessionId;
    }

    const session = await Session.findOne({ sessionId }).lean();
    if (session) {
      return session._id;
    }

    if (isValidObjectId(sessionId)) {
      return sessionId;
    }

    return null;
  } catch (error) {
    console.error(`Error resolving sessionId ${sessionId}:`, error.message);
    return null;
  }
}

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

async function exploreSessions(params = {}) {
  try {
    const limit = params.limit || 20;
    const page = params.page || 1;
    const skip = params.skip ?? ((page - 1) * limit);

    const sessionDetails = await Session.aggregate([
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
          messageCount: { $size: '$messages' }
        }
      },
      { $project: { messages: 0 } }
    ]);

    const formattedSessions = sessionDetails.map((session) => ({
      ...session,
      _id: session._id.toString()
    }));

    return {
      type: 'session_explorer',
      totalSessions: formattedSessions.length,
      sessions: formattedSessions,
      pagination: {
        limit,
        skip,
        page,
        hasMore: formattedSessions.length === limit
      },
      metadata: {
        executedAt: new Date().toISOString(),
        note: 'Use sessionId for human-readable IDs, _id for database operations'
      }
    };
  } catch (error) {
    return {
      error: `Failed to explore sessions: ${error.message}`
    };
  }
}

async function getSessionIds() {
  try {
    const sessions = await Session.find({}, { sessionId: 1 }).lean();
    return sessions.map((session) => session.sessionId).join(', ');
  } catch (error) {
    return 'Error retrieving session IDs';
  }
}

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

async function searchMessages(params) {
  try {
    const { sessionId, session, ...searchParams } = params;
    let resolvedSessionId = null;

    if (sessionId) {
      resolvedSessionId = await resolveSessionId(sessionId);
      if (!resolvedSessionId) {
        return {
          error: `Session with sessionId "${sessionId}" not found. Available sessions: ${await getSessionIds()}`
        };
      }
    } else if (session) {
      resolvedSessionId = await resolveSessionId(session);
    }

    const sanitizedFilters = sanitizeFilters(searchParams.additionalFilters);
    const query = {
      ...(resolvedSessionId ? { session: resolvedSessionId } : {}),
      ...sanitizedFilters
    };

    if (searchParams.after || searchParams.before || searchParams.last || searchParams.between) {
      const timeQuery = await buildTimeQuery('createdAt', searchParams);
      Object.assign(query, timeQuery);
    }

    const options = {
      sort: searchParams.sort || { createdAt: -1 },
      limit: searchParams.limit || 100,
      projection: searchParams.fields
    };

    const messages = await Message.find(query, null, options).lean();
    const sessionInfo = resolvedSessionId
      ? await Session.findById(resolvedSessionId).lean()
      : null;

    return {
      type: 'message_search',
      sessionId: sessionId || sessionInfo?.sessionId || null,
      sessionObjectId: resolvedSessionId,
      messageCount: messages.length,
      messages,
      sessionInfo,
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


async function standardSearch(params) {
  try {
    const collectionModel = collections[params.collection.toLowerCase()];
    if (!collectionModel) {
      return {
        error: `Collection '${params.collection}' not found. Available collections: ${Object.keys(collections).join(', ')}`
      };
    }

    const timeQuery = await buildTimeQuery(params.timeField || 'createdAt', params);
    const sanitizedFilters = sanitizeFilters(params.additionalFilters);
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
      results,
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

async function performMongoDBSearch(params) {
  try {
    if (!params.collection) {
      return "Error: 'collection' parameter is required.";
    }

    if (params.operation === 'explore_sessions') {
      return exploreSessions(params);
    }

    if (params.collection.toLowerCase() === 'messages') {
      return searchMessages(params);
    }

    return standardSearch(params);
  } catch (error) {
    console.error('🗃️ [MONGODB SEARCH TOOL] Error during search:', error);
    return {
      error: `An error occurred during MongoDB search: ${error.message}`
    };
  }
}

export const mongoDBSearchTool = {
  function: {
    name: 'mongodb_search',
    description,
    parameters: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description: 'The collection to search (users, sessions, messages).',
          enum: ['users', 'sessions', 'messages']
        },
        operation: {
          type: 'string',
          description: 'Special operation to perform (explore_sessions).',
          enum: ['explore_sessions']
        },
        sessionId: {
          type: 'string',
          description: "Human-readable session ID (e.g., 'pop084025'). Automatically resolves to MongoDB _id."
        },
        session: {
          type: 'string',
          description: 'Session identifier (can be sessionId or MongoDB _id).'
        },
        timeField: {
          type: 'string',
          description: "The timestamp field to filter by (default: 'createdAt').",
          default: 'createdAt'
        },
        after: {
          type: 'string',
          description: "Find documents after this time (ISO date string or natural language like 'yesterday')."
        },
        before: {
          type: 'string',
          description: "Find documents before this time (ISO date string or natural language like 'today')."
        },
        last: {
          type: 'string',
          description: "Find documents from the last X time period (e.g., '24 hours', '7 days', '1 month')."
        },
        additionalFilters: {
          type: 'object',
          description: 'Additional MongoDB query filters to apply.'
        },
        fields: {
          type: 'object',
          description: 'Fields to include/exclude in results (MongoDB projection).'
        },
        sort: {
          type: 'object',
          description: 'Sort order for results (default: newest first by timeField).'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 100).'
        },
        page: {
          type: 'number',
          description: 'Page number for session exploration pagination.',
          default: 1
        },
        skip: {
          type: 'number',
          description: 'Number of sessions to skip for session exploration.'
        }
      },
      required: ['collection']
    }
  },
  handler: async (params) => {
    console.log('🗃️ [MONGODB SEARCH TOOL] Executing mongodb_search with params:', params);
    const { task_progress, ...restParams } = params;
    return performMongoDBSearch(restParams);
  }
};
