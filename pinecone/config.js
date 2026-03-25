import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

// Default configuration
const defaultConfig = {
  pinecone: {
    indexName: 'varjis-2',
    namespace: 'chat-history',
    environment: 'us-east-1',
    maxRetries: 3,
    connectionTimeout: 5000,
    hostUrl: process.env.PINECONE_HOST_URL || 'https://varjis-2-5l8xinc.svc.aped-4627-b74a.pinecone.io'
  },
  mistral: {
    model: 'mistral-embed',
    maxTokens: 8192,
    apiKeyRotation: false,
    batchSize: 10
  },
  chunking: {
    defaultSize: 2000,
    overlap: 200,
    maxTokens: 500
  },
  caching: {
    enabled: true,
    ttl: 3600, // 1 hour
    maxItems: 10000
  },
  performance: {
    maxConcurrentRequests: 5,
    rateLimit: 100, // requests per minute
    circuitBreaker: {
      enabled: true,
      threshold: 3,
      resetTimeout: 30000
    }
  }
};

class ConfigManager {
  constructor() {
    this.config = { ...defaultConfig };
    this.validateEnvironment();
    this.applyOverrides();
  }

  validateEnvironment() {
    const requiredVars = [
      { name: 'PINECONE_API_KEY', description: 'Pinecone API key for vector database operations' },
      { name: 'MISTRAL_API_KEY', description: 'Mistral API key for embedding generation' },
      { name: 'PINECONE_INDEX_NAME', description: 'Name of the Pinecone index to use' }
    ];

    const missing = requiredVars.filter(varName => !process.env[varName.name]);
    if (missing.length > 0) {
      const errorMessage = missing.map(varInfo =>
        `- ${varInfo.name}: ${varInfo.description}`
      ).join('\n');
      throw new Error(`Missing required environment variables:\n${errorMessage}`);
    }
  }

  applyOverrides() {
    // Apply environment variable overrides
    if (process.env.CHUNK_SIZE) {
      this.config.chunking.defaultSize = parseInt(process.env.CHUNK_SIZE);
    }
    if (process.env.CACHE_TTL) {
      this.config.caching.ttl = parseInt(process.env.CACHE_TTL);
    }
    if (process.env.MAX_CONCURRENT_REQUESTS) {
      this.config.performance.maxConcurrentRequests = parseInt(process.env.MAX_CONCURRENT_REQUESTS);
    }
    if (process.env.RATE_LIMIT) {
      this.config.performance.rateLimit = parseInt(process.env.RATE_LIMIT);
    }
  }

  get(keyPath) {
    return keyPath.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  update(newConfig) {
    const oldConfig = { ...this.config };
    this.config = this.deepMerge(this.config, newConfig);

    // Emit change event if there are listeners
    if (this.listeners && this.listeners.length > 0) {
      this.emitChange(oldConfig, this.config);
    }
  }

  onChange(callback) {
    if (!this.listeners) {
      this.listeners = [];
    }
    this.listeners.push(callback);
  }

  emitChange(oldConfig, newConfig) {
    const changes = this.detectChanges(oldConfig, newConfig);
    this.listeners.forEach(callback => {
      callback(oldConfig, newConfig, changes);
    });
  }

  detectChanges(oldConfig, newConfig) {
    const changes = [];
    this.findChanges(oldConfig, newConfig, '', changes);
    return changes;
  }

  findChanges(oldObj, newObj, path, changes) {
    for (const key in newObj) {
      const currentPath = path ? `${path}.${key}` : key;
      if (typeof newObj[key] === 'object' && newObj[key] !== null) {
        if (!oldObj[key] || typeof oldObj[key] !== 'object') {
          changes.push({
            path: currentPath,
            type: 'added',
            oldValue: undefined,
            newValue: newObj[key]
          });
        } else {
          this.findChanges(oldObj[key], newObj[key], currentPath, changes);
        }
      } else if (oldObj[key] !== newObj[key]) {
        changes.push({
          path: currentPath,
          type: oldObj[key] === undefined ? 'added' : 'changed',
          oldValue: oldObj[key],
          newValue: newObj[key]
        });
      }
    }

    // Check for removed properties
    for (const key in oldObj) {
      if (newObj[key] === undefined) {
        const currentPath = path ? `${path}.${key}` : key;
        changes.push({
          path: currentPath,
          type: 'removed',
          oldValue: oldObj[key],
          newValue: undefined
        });
      }
    }
  }

  deepMerge(target, source) {
    for (const key in source) {
      if (source[key] instanceof Object && key in target) {
        Object.assign(source[key], this.deepMerge(target[key], source[key]));
      }
    }
    return Object.assign({}, target, source);
  }

  getDocumentation() {
    return {
      description: "Centralized configuration system for Pinecone Vector Project",
      sections: [
        {
          title: "Pinecone Configuration",
          description: "Settings related to Pinecone vector database operations",
          options: {
            indexName: {
              type: "string",
              default: this.config.pinecone.indexName,
              description: "Name of the Pinecone index to use"
            },
            namespace: {
              type: "string",
              default: this.config.pinecone.namespace,
              description: "Namespace for organizing vectors within the index"
            },
            environment: {
              type: "string",
              default: this.config.pinecone.environment,
              description: "Pinecone environment/region"
            },
            maxRetries: {
              type: "number",
              default: this.config.pinecone.maxRetries,
              description: "Maximum number of retries for failed operations"
            },
            connectionTimeout: {
              type: "number",
              default: this.config.pinecone.connectionTimeout,
              description: "Connection timeout in milliseconds"
            },
            hostUrl: {
              type: "string",
              default: this.config.pinecone.hostUrl,
              description: "Pinecone host URL for direct API calls"
            }
          }
        },
        {
          title: "Mistral Configuration",
          description: "Settings related to Mistral embedding service",
          options: {
            model: {
              type: "string",
              default: this.config.mistral.model,
              description: "Mistral model to use for embeddings"
            },
            maxTokens: {
              type: "number",
              default: this.config.mistral.maxTokens,
              description: "Maximum number of tokens for embedding inputs"
            },
            apiKeyRotation: {
              type: "boolean",
              default: this.config.mistral.apiKeyRotation,
              description: "Enable automatic rotation of API keys"
            },
            batchSize: {
              type: "number",
              default: this.config.mistral.batchSize,
              description: "Number of embeddings to process in a single batch"
            }
          }
        },
        {
          title: "Chunking Configuration",
          description: "Settings related to text chunking for embedding",
          options: {
            defaultSize: {
              type: "number",
              default: this.config.chunking.defaultSize,
              description: "Default chunk size in characters"
            },
            overlap: {
              type: "number",
              default: this.config.chunking.overlap,
              description: "Overlap between chunks in characters"
            },
            maxTokens: {
              type: "number",
              default: this.config.chunking.maxTokens,
              description: "Maximum tokens per chunk for embedding"
            }
          }
        },
        {
          title: "Caching Configuration",
          description: "Settings related to caching of embeddings and query results",
          options: {
            enabled: {
              type: "boolean",
              default: this.config.caching.enabled,
              description: "Enable or disable caching"
            },
            ttl: {
              type: "number",
              default: this.config.caching.ttl,
              description: "Time-to-live for cache entries in seconds"
            },
            maxItems: {
              type: "number",
              default: this.config.caching.maxItems,
              description: "Maximum number of items in cache"
            }
          }
        },
        {
          title: "Performance Configuration",
          description: "Settings related to system performance and resource usage",
          options: {
            maxConcurrentRequests: {
              type: "number",
              default: this.config.performance.maxConcurrentRequests,
              description: "Maximum number of concurrent requests"
            },
            rateLimit: {
              type: "number",
              default: this.config.performance.rateLimit,
              description: "Maximum requests per minute"
            },
            circuitBreaker: {
              type: "object",
              default: this.config.performance.circuitBreaker,
              description: "Circuit breaker settings for fault tolerance",
              options: {
                enabled: {
                  type: "boolean",
                  default: this.config.performance.circuitBreaker.enabled,
                  description: "Enable or disable circuit breaker"
                },
                threshold: {
                  type: "number",
                  default: this.config.performance.circuitBreaker.threshold,
                  description: "Number of failures to trigger circuit breaker"
                },
                resetTimeout: {
                  type: "number",
                  default: this.config.performance.circuitBreaker.resetTimeout,
                  description: "Time in milliseconds before circuit breaker resets"
                }
              }
            }
          }
        }
      ],
      environmentVariables: [
        {
          name: "PINECONE_API_KEY",
          description: "Pinecone API key for vector database operations",
          required: true
        },
        {
          name: "MISTRAL_API_KEY",
          description: "Mistral API key for embedding generation",
          required: true
        },
        {
          name: "PINECONE_INDEX_NAME",
          description: "Name of the Pinecone index to use",
          required: true
        },
        {
          name: "CHUNK_SIZE",
          description: "Override for default chunk size",
          required: false
        },
        {
          name: "CACHE_TTL",
          description: "Override for cache time-to-live in seconds",
          required: false
        },
        {
          name: "MAX_CONCURRENT_REQUESTS",
          description: "Override for maximum concurrent requests",
          required: false
        },
        {
          name: "RATE_LIMIT",
          description: "Override for rate limit (requests per minute)",
          required: false
        }
      ]
    };
  }
}

export const config = new ConfigManager();