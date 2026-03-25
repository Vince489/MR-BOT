import { Pinecone } from '@pinecone-database/pinecone';
import { retry } from './retry.js'; // Import the retry utility
import { sparseEncoder } from './sparseEncoder.js'; // Import sparse encoder
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { errors, errorMetrics } from './errors.js';
import { metricsCollector } from './metrics.js';

// Enhanced logging utility
function log(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...context
  };

  switch (level) {
    case 'error':
      console.error(JSON.stringify(logEntry, null, 2));
      break;
    case 'warn':
      console.warn(JSON.stringify(logEntry, null, 2));
      break;
    case 'info':
    default:
      console.log(JSON.stringify(logEntry, null, 2));
  }

  return logEntry;
}

// Load environment variables BEFORE reading them (suppress logs)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_ENVIRONMENT = process.env.PINECONE_ENVIRONMENT
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE

// Initialize Pinecone client and index
let pineconeClient;
let pineconeIndex;

// Export the client and index for use in other modules
export { pineconeClient, pineconeIndex };

try {
  if (PINECONE_API_KEY && PINECONE_INDEX_NAME) {
    console.log(`[Pinecone] Initializing client with API key: ${PINECONE_API_KEY ? '*****' : 'MISSING'}, environment: ${PINECONE_ENVIRONMENT}, index: ${PINECONE_INDEX_NAME}`);

    try {
    pineconeClient = new Pinecone({
        apiKey: PINECONE_API_KEY
      });

      // Test the client connection immediately
      console.log('[Pinecone] Client created successfully, testing connection...');

      // Try to get the index to verify connection
      pineconeIndex = pineconeClient.Index(PINECONE_INDEX_NAME);

      // Test a simple operation to verify the connection
      try {
        const indexStats = await pineconeIndex.describeIndexStats();
        console.log(`[Pinecone] Connection successful. Index stats:`, indexStats);
        console.log(`[Pinecone] Vector store service initialized for index: ${PINECONE_INDEX_NAME} in environment: ${PINECONE_ENVIRONMENT}`);
      } catch (testError) {
        console.error(`[Pinecone] Connection test failed:`, testError);
        console.error(`[Pinecone] Initialization successful but connection test failed. Index may not be accessible.`);
        // Still keep the client and index objects for later retries
      }
    } catch (initError) {
      console.error(`[Pinecone] Client initialization failed:`, initError);
      // pineconeClient and pineconeIndex will remain undefined
    }
  } else {
    let missingVars = [];
    if (!PINECONE_API_KEY) missingVars.push("PINECONE_API_KEY");
    // PINECONE_HOST_URL is no longer used
    if (!PINECONE_INDEX_NAME && !process.env.PINECONE_INDEX_NAME) missingVars.push("PINECONE_INDEX_NAME (or it defaulted to 'varjis' but other vars are missing)");

    console.warn(`[Pinecone] CRITICAL: Configuration incomplete. Missing: ${missingVars.join(', ')}. Vector store service will not work.`);
  }
} catch (error) {
  console.error("[Pinecone] Unexpected error during initialization:", error);
  // pineconeClient and pineconeIndex will remain undefined
}

export async function upsertToPinecone(sessionId, messageId, vector, metadata) {
  const operationId = metricsCollector.startOperation('upsertToPinecone', {
    sessionId,
    messageId
  });
  if (!pineconeIndex) {
    const error = new errors.ConfigurationError("Pinecone index is not initialized. Cannot upsert vector.");
    errorMetrics.record(error);
    throw error;
  }
  if (!sessionId || !messageId || !vector || !metadata) {
    const error = new errors.ValidationError("Missing required parameters for upsertToPinecone (sessionId, messageId, vector, metadata).");
    errorMetrics.record(error);
    throw error;
  }

    try {
      // Generate sparse vector for hybrid search
      const text = metadata.text || metadata.originalText || '';
      const sparseVector = sparseEncoder.encode(text);

      // Check if the index supports sparse vectors
      let supportsSparse = false;
      try {
        const indexStats = await pineconeIndex.describeIndexStats();
        supportsSparse = indexStats.indexFullness !== undefined &&
                        (indexStats.indexConfig?.metric === 'dotproduct' ||
                         indexStats.indexConfig?.sparseVectorConfig);
      } catch (error) {
        console.log(`[Pinecone] Error checking index configuration, using dense vectors only:`, error.message);
      }

      const record = {
        id: messageId, // Pinecone requires string IDs
        values: vector, // Dense vector (embeddings)
        ...(supportsSparse ? { sparseValues: sparseVector } : {}), // Only include sparse vector if supported
        metadata: { ...metadata, sessionId } // Ensure sessionId is part of the metadata for filtering
      };

    // Debug output
    console.log('Debug - Upserting record:', {
      id: record.id,
      valuesLength: record.values.length,
      hasSparseValues: !!record.sparseValues,
      metadataKeys: Object.keys(record.metadata)
    });

    await retry(async () => {
      await pineconeIndex.namespace(PINECONE_NAMESPACE).upsert({
        records: [record]
      });
    }, { maxRetries: 3, initialDelay: 500, backoffFactor: 2, jitter: true });
    log('info', `Upserted message ${messageId} to Pinecone`, {
      sessionId,
      namespace: PINECONE_NAMESPACE,
      vectorType: supportsSparse ? 'hybrid' : 'dense'
    });
    metricsCollector.endOperation(operationId, true);
  } catch (error) {
    log('error', `Error upserting vector ${messageId} to Pinecone`, {
      sessionId,
      error: error.message,
      stack: error.stack
    });
    metricsCollector.endOperation(operationId, false, error);
    // Consider the nature of the error, e.g., if it's a connection issue or data format issue.
    throw error; // Re-throw to allow caller to handle
  }
}

export async function queryFromPinecone(sessionId, queryVector, topK, userId = null, options = {}) {
  const operationId = metricsCollector.startOperation('queryFromPinecone', {
    sessionId,
    topK,
    hasUserId: !!userId,
    enableHybrid: options.enableHybrid || false
  });
  if (!pineconeIndex) {
    const error = new errors.ConfigurationError("Pinecone index is not initialized. Cannot query vector.");
    errorMetrics.record(error);
    throw error;
  }
  if (!sessionId || !queryVector || !topK) {
    const error = new errors.ValidationError("Missing required parameters for queryFromPinecone (sessionId, queryVector, topK).");
    errorMetrics.record(error);
    throw error;
  }

  try {
    // Build filter object - always filter by sessionId, optionally by userId
    const filter = { sessionId: { '$eq': sessionId } };
    if (userId) {
      filter.userId = { '$eq': userId };
    }

    // Prepare query parameters
    const queryParams = {
      vector: queryVector,
      topK: topK,
      includeValues: false, // Usually not needed for RAG context, saves bandwidth
      includeMetadata: true, // Essential to get the original text and other info
      filter: filter
    };

    // Add hybrid search parameters if enabled
    if (options.enableHybrid && options.queryText) {
      try {
        // First check if the index supports sparse vectors
        const indexStats = await pineconeIndex.describeIndexStats();
        const supportsSparse = indexStats.indexFullness !== undefined &&
                              (indexStats.indexConfig?.metric === 'dotproduct' ||
                               indexStats.indexConfig?.sparseVectorConfig);

        if (supportsSparse) {
          const sparseVector = sparseEncoder.encode(options.queryText);
          if (sparseVector.indices.length > 0) {
            queryParams.sparseVector = sparseVector;
            console.log(`[Pinecone] Using hybrid search with sparse vector`);
          }
        } else {
          console.log(`[Pinecone] Index does not support sparse vectors. Using dense search only.`);
        }
      } catch (error) {
        console.log(`[Pinecone] Error checking index configuration, using dense search only:`, error.message);
      }
    }

    const queryResponse = await retry(async () => {
      return await pineconeIndex.namespace(PINECONE_NAMESPACE).query(queryParams);
    }, { maxRetries: 3, initialDelay: 500, backoffFactor: 2, jitter: true });

    log('info', `Pinecone query completed`, {
      sessionId,
      userId: userId || undefined,
      topK,
      enableHybrid: options.enableHybrid || false,
      matchCount: queryResponse.matches?.length || 0
    });
    metricsCollector.endOperation(operationId, true);
    return queryResponse.matches || [];
  } catch (error) {
    log('error', `Error querying Pinecone`, {
      sessionId,
      userId: userId || undefined,
      error: error.message,
      stack: error.stack
    });
    metricsCollector.endOperation(operationId, false, error);
    // Consider the nature of the error
    throw error; // Re-throw to allow caller to handle
  }
}

/**
 * Delete all vectors for a specific session from Pinecone.
 * This is used for cleanup when a session is cleared.
 * @param {string} sessionId - The session ID to delete vectors for.
 * @returns {Promise<void>}
 */
export async function deleteFromPinecone(sessionId) {
  if (!pineconeIndex) {
    console.warn("Pinecone index is not initialized. Cannot delete vectors.");
    return; // Gracefully skip if Pinecone is not available
  }
  if (!sessionId) {
    const error = new errors.ValidationError("Missing required parameter sessionId for deleteFromPinecone.");
    errorMetrics.record(error);
    throw error;
  }

  try {
    await retry(async () => {
      // Delete all vectors matching the sessionId filter
      await pineconeIndex.namespace(PINECONE_NAMESPACE).deleteMany({
        filter: {
          sessionId: sessionId
        }
      });
    }, { maxRetries: 3, initialDelay: 500, backoffFactor: 2, jitter: true });
    console.log(`Successfully deleted all vectors for session ${sessionId} from Pinecone namespace: ${PINECONE_NAMESPACE}.`);
  } catch (error) {
    console.error(`Error deleting vectors for session ${sessionId} from Pinecone (after retries):`, error);
    // Don't throw - log and continue gracefully
    // This prevents cleanup failures from breaking the application
  }
}
