# DB Search Tool Guide

The `dbsearch` tool provides persistent access to chat history search functionality across all sessions. It allows the AI to search through past conversations, explore sessions, and retrieve specific messages.

## Available Actions

### 1. `listSessions`
Lists available chat sessions with metadata.

**Parameters:**
- `limit` (number, optional): Maximum number of sessions to return (default: 20)
- `skip` (number, optional): Number of sessions to skip for pagination (default: 0)

**Example:**
```json
{
  "action": "listSessions",
  "limit": 10
}
```

### 2. `searchMessages`
Searches for specific messages across sessions with comprehensive filtering.

**Parameters:**
- `sessionId` (string, optional): Filter by specific session
- `query` (string, optional): Text search query
- `filters` (object, optional): Additional MongoDB query filters
- `after` (string, optional): Find messages after this time (natural language or ISO date)
- `before` (string, optional): Find messages before this time (natural language or ISO date)
- `last` (string, optional): Find messages from the last time period (e.g., "24 hours", "7 days")
- `sort` (object, optional): Sort order (default: newest first)
- `limit` (number, optional): Maximum results (default: 50)
- `skip` (number, optional): Number to skip for pagination

**Example:**
```json
{
  "action": "searchMessages",
  "sessionId": "session_abc123",
  "query": "database connection",
  "last": "7 days",
  "limit": 20
}
```

### 3. `getSessionInfo`
Gets detailed information about a specific session.

**Parameters:**
- `sessionId` (string, required): The session ID to get information for

**Example:**
```json
{
  "action": "getSessionInfo",
  "sessionId": "session_abc123"
}
```

### 4. `searchByTime`
Searches messages by time period using natural language expressions.

**Parameters:**
- `timePeriod` (string, required): Time period (e.g., "24 hours", "7 days", "1 month")
- `sessionId` (string, optional): Filter by specific session

**Example:**
```json
{
  "action": "searchByTime",
  "timePeriod": "24 hours"
}
```

## Usage Examples

### Find recent conversations about a topic:
```json
{
  "action": "searchMessages",
  "query": "MongoDB connection",
  "last": "7 days"
}
```

### List all sessions to choose from:
```json
{
  "action": "listSessions",
  "limit": 10
}
```

### Get details about a specific session:
```json
{
  "action": "getSessionInfo",
  "sessionId": "session_1774734573601_idy62lhhe"
}
```

### Search for messages from yesterday:
```json
{
  "action": "searchByTime",
  "timePeriod": "24 hours"
}
```

## Natural Language Time Expressions

The tool supports natural language time expressions:
- `"24 hours"` - Last 24 hours
- `"7 days"` - Last 7 days
- `"1 month"` - Last month
- `"3 months"` - Last 3 months
- `"1 year"` - Last year
- `"yesterday"` - Previous day
- `"last week"` - Previous week
- `"last month"` - Previous month

## Error Handling

The tool provides helpful error messages and suggestions:
- Invalid session IDs return suggestions to use `listSessions`
- Invalid time expressions provide format examples
- Missing required parameters are clearly indicated
- MongoDB connection issues are handled gracefully

## Integration

The tool is automatically integrated into the Agent system and available in all chat sessions when using the `chat-4.js` script with MongoDB storage enabled.

## Notes

- The tool requires a MongoDB connection to function
- Text search (`$text` queries) requires a text index on the messages collection
- All searches respect session boundaries and user privacy
- Results include metadata for debugging and monitoring