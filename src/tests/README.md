# Chat History Search Tool Tests

This directory contains comprehensive test suites for the `chatHistorySearchTool.js` functionality.

## Test Files

### 1. `chatHistorySearchTool-test.js` - Unit Tests with Mocks
- **Purpose**: Fast, isolated unit tests using mocked dependencies
- **Dependencies**: None (uses mocks for MongoDB and embedding service)
- **Use Case**: Quick development testing, CI/CD pipelines
- **Run with**: `node chatHistorySearchTool-test.js`

**Features tested:**
- ✅ Semantic search action
- ✅ Session search action  
- ✅ Get message context action
- ✅ Invalid action handling
- ✅ Missing required parameters
- ✅ Task progress validation
- ✅ Error handling

### 2. `chatHistorySearchTool-integration-test.js` - Integration Tests
- **Purpose**: Tests with optional real embeddings, fallback to mocks
- **Dependencies**: Optional MongoDB connection
- **Use Case**: Development testing with real services when available
- **Run with**: 
  - `node chatHistorySearchTool-integration-test.js` (uses mocks)
  - `node chatHistorySearchTool-integration-test.js --real-embeddings` (uses real embeddings if available)

**Features tested:**
- ✅ Semantic search with real embeddings (when available)
- ✅ Semantic search with mocks
- ✅ Session search
- ✅ Get message context
- ✅ Error handling

### 3. `chatHistorySearchTool-full-integration-test.js` - Full Integration Tests
- **Purpose**: Complete end-to-end testing with real MongoDB and services
- **Dependencies**: MongoDB connection, real embedding service
- **Use Case**: Full system validation, production readiness testing
- **Run with**: `node chatHistorySearchTool-full-integration-test.js`

**Features tested:**
- ✅ Semantic search - Function optimization
- ✅ Semantic search - Database optimization
- ✅ Session search
- ✅ Get message context
- ✅ Semantic search with filters (role filtering)
- ✅ Error handling - Invalid actions
- ✅ Error handling - Missing parameters

## Prerequisites

### For Unit Tests (Mock-based)
No prerequisites required.

### For Integration Tests
- Node.js environment
- Optional: MongoDB connection string in environment variables

### For Full Integration Tests
- MongoDB connection (local or remote)
- Environment variables configured:
  ```bash
  MONGODB_URI=mongodb://localhost:27017/mr-bot-test
  MISTRAL_API_KEY=your_mistral_api_key_here
  ```
- All required dependencies installed

## Running Tests

### Quick Unit Tests
```bash
cd src/tests
node chatHistorySearchTool-test.js
```

### Integration Tests with Mocks
```bash
cd src/tests
node chatHistorySearchTool-integration-test.js
```

### Integration Tests with Real Embeddings
```bash
cd src/tests
node chatHistorySearchTool-integration-test.js --real-embeddings
```

### Full Integration Tests
```bash
cd src/tests
node chatHistorySearchTool-full-integration-test.js
```

### Run All Tests
```bash
cd src/tests
# Run unit tests
node chatHistorySearchTool-test.js

# Run integration tests
node chatHistorySearchTool-integration-test.js

# Run full integration tests (requires MongoDB)
node chatHistorySearchTool-full-integration-test.js
```

## Test Environment Setup

### MongoDB Setup
1. Install MongoDB locally or use a cloud service
2. Create a test database (e.g., `mr-bot-test`)
3. Set the `MONGODB_URI` environment variable

### Environment Variables
Create a `.env` file in the project root:
```bash
MONGODB_URI=mongodb://localhost:27017/mr-bot-test
MISTRAL_API_KEY=your_api_key_here
```

### Dependencies
Ensure all required packages are installed:
```bash
npm install
```

## Test Coverage

The test suites cover all functionality of the `chatHistorySearchTool`:

### Actions Tested
- **semanticSearch**: Natural language search across message history
- **sessionSearch**: Search across session summaries
- **getMessageContext**: Retrieve conversation context around a message

### Error Handling
- Invalid action names
- Missing required parameters
- Service failures
- Database connection issues

### Features Tested
- Query filtering (session, role, date range)
- Result scoring and ranking
- Context retrieval
- Performance metrics
- Task progress validation

## Expected Output

### Success Example
```
🧪 [CHAT HISTORY SEARCH TOOL TEST SUITE] Starting comprehensive tests...

🧪 [TEST] Semantic Search Action
✅ Semantic Search Action: PASSED

🧪 [TEST] Session Search Action
✅ Session Search Action: PASSED

🧪 [TEST] Get Message Context Action
✅ Get Message Context Action: PASSED

🧪 [TEST] Invalid Action Handling
✅ Invalid Action Handling: PASSED

🧪 [TEST] Missing Required Parameters
✅ Missing Required Parameters: PASSED

🧪 [TEST] Task Progress Validation
✅ Task Progress Validation: PASSED

🧪 [TEST] Error Handling
✅ Error Handling: PASSED

📊 [CHAT HISTORY SEARCH TOOL TEST SUMMARY]

Overall Results: 7/7 tests passed (100.0%)
Total Duration: 156ms

Detailed Results:
✅ Semantic Search Action: 45ms
✅ Session Search Action: 32ms
✅ Get Message Context Action: 28ms
✅ Invalid Action Handling: 15ms
✅ Missing Required Parameters: 12ms
✅ Task Progress Validation: 8ms
✅ Error Handling: 16ms
```

### Failure Example
```
❌ Semantic Search Action: FAILED - Database connection failed

❌ Session Search Action: FAILED - Embedding service unavailable

📊 [CHAT HISTORY SEARCH TOOL TEST SUMMARY]

Overall Results: 5/7 tests passed (71.4%)
Total Duration: 2450ms

Detailed Results:
❌ Semantic Search Action: 1200ms
   Error: Database connection failed
❌ Session Search Action: 800ms
   Error: Embedding service unavailable
✅ Get Message Context Action: 28ms
   Details: { targetMessageContent: 'Target message content...', ... }
...
```

## Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Check MongoDB is running
   - Verify `MONGODB_URI` is correct
   - Ensure database exists and is accessible

2. **Embedding Service Unavailable**
   - Check `MISTRAL_API_KEY` is set
   - Verify API key has proper permissions
   - Check network connectivity

3. **Module Import Errors**
   - Ensure all dependencies are installed
   - Check Node.js version compatibility
   - Verify file paths are correct

4. **Test Timeouts**
   - Increase timeout values for slow connections
   - Check network latency
   - Verify services are responsive

### Debug Mode
Add debug logging by modifying test files:
```javascript
// Add to test files for verbose output
console.log('Debug:', { variable: value });
```

## Continuous Integration

For CI/CD pipelines, use the unit tests:
```yaml
# Example GitHub Actions workflow
- name: Run Unit Tests
  run: cd src/tests && node chatHistorySearchTool-test.js
```

For full integration testing in staging environments:
```yaml
# Example staging workflow
- name: Run Full Integration Tests
  run: cd src/tests && node chatHistorySearchTool-full-integration-test.js
  env:
    MONGODB_URI: ${{ secrets.MONGODB_URI }}
    MISTRAL_API_KEY: ${{ secrets.MISTRAL_API_KEY }}
```

## Test Data

### Unit Tests
Uses mock data with predefined responses:
- 2 semantic search results
- 1 session search result
- Context messages for message context tests

### Integration Tests
Creates temporary test data in MongoDB:
- Test session with topic "Integration Test Session"
- 7 test messages with various content
- Mixed user/assistant roles
- Different timestamps

### Data Cleanup
All integration tests automatically clean up test data after completion to prevent data pollution.

## Performance Metrics

Tests include performance monitoring:
- Search duration tracking
- Success/failure rates
- Resource usage metrics
- Cost estimation for embedding calls

## Contributing

When adding new tests:
1. Follow the existing test structure
2. Include both success and failure cases
3. Add appropriate error handling
4. Update this README with new test descriptions
5. Ensure tests are independent and can run in any order

## Support

For issues with the tests:
1. Check the troubleshooting section
2. Review test output for specific error messages
3. Verify environment setup
4. Check dependencies and versions
5. Create an issue with detailed error information