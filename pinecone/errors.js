class VectorStoreError extends Error {
  constructor(message, type, isRetryable = false, originalError = null) {
    super(message);
    this.name = 'VectorStoreError';
    this.type = type;
    this.isRetryable = isRetryable;
    this.originalError = originalError;
    this.timestamp = new Date();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      message: this.message,
      type: this.type,
      isRetryable: this.isRetryable,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack?.split('\n')
    };
  }
}

class ConfigurationError extends VectorStoreError {
  constructor(message, originalError) {
    super(message, 'CONFIGURATION_ERROR', false, originalError);
    this.name = 'ConfigurationError';
  }
}

class NetworkError extends VectorStoreError {
  constructor(message, originalError) {
    super(message, 'NETWORK_ERROR', true, originalError);
    this.name = 'NetworkError';
  }
}

class RateLimitError extends VectorStoreError {
  constructor(message, originalError, retryAfter) {
    super(message, 'RATE_LIMIT_ERROR', true, originalError);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

class ValidationError extends VectorStoreError {
  constructor(message, originalError) {
    super(message, 'VALIDATION_ERROR', false, originalError);
    this.name = 'ValidationError';
  }
}

class CacheError extends VectorStoreError {
  constructor(message, originalError) {
    super(message, 'CACHE_ERROR', false, originalError);
    this.name = 'CacheError';
  }
}

// Error metrics collector
class ErrorMetrics {
  constructor() {
    this.errors = [];
    this.errorCounts = {};
  }

  record(error) {
    this.errors.push({
      ...error,
      timestamp: new Date()
    });

    const type = error.type || 'UNKNOWN';
    this.errorCounts[type] = (this.errorCounts[type] || 0) + 1;
  }

  getMetrics() {
    return {
      total: this.errors.length,
      byType: { ...this.errorCounts },
      recent: this.errors.slice(-100).map(e => ({
        type: e.type,
        message: e.message,
        timestamp: e.timestamp
      }))
    };
  }
}

export const errors = {
  VectorStoreError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  ValidationError,
  CacheError
};

export const errorMetrics = new ErrorMetrics();