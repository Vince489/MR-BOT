import { config } from './config.js';

class MetricsCollector {
  constructor() {
    this.operations = new Map();
    this.timings = new Map();
    this.counters = new Map();
    this.errorCounts = new Map();
  }

  startOperation(operationName, metadata = {}) {
    const startTime = Date.now();
    const operationId = `${operationName}_${startTime}`;

    this.operations.set(operationId, {
      name: operationName,
      startTime,
      metadata,
      completed: false
    });

    return operationId;
  }

  endOperation(operationId, success = true, error = null) {
    const operation = this.operations.get(operationId);
    if (!operation) return;

    operation.endTime = Date.now();
    operation.duration = operation.endTime - operation.startTime;
    operation.success = success;
    operation.error = error;
    operation.completed = true;

    // Update counters
    const counterKey = `${operation.name}_${success ? 'success' : 'failure'}`;
    this.counters.set(counterKey, (this.counters.get(counterKey) || 0) + 1);

    // Update timings
    const timingKey = `${operation.name}_duration`;
    const currentTimings = this.timings.get(timingKey) || [];
    currentTimings.push(operation.duration);
    this.timings.set(timingKey, currentTimings);

    // Update error counts if applicable
    if (!success && error) {
      const errorType = error.type || 'unknown';
      this.errorCounts.set(errorType, (this.errorCounts.get(errorType) || 0) + 1);
    }

    return operation;
  }

  recordTiming(operationName, duration) {
    const timingKey = `${operationName}_duration`;
    const currentTimings = this.timings.get(timingKey) || [];
    currentTimings.push(duration);
    this.timings.set(timingKey, currentTimings);
  }

  incrementCounter(counterName) {
    this.counters.set(counterName, (this.counters.get(counterName) || 0) + 1);
  }

  getMetrics() {
    const result = {
      operations: Array.from(this.operations.values()).filter(op => op.completed),
      counters: Object.fromEntries(this.counters),
      timings: {},
      errorCounts: Object.fromEntries(this.errorCounts)
    };

    // Calculate timing statistics
    for (const [key, values] of this.timings) {
      const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
      const max = Math.max(...values);
      const min = Math.min(...values);

      result.timings[key] = {
        count: values.length,
        average: avg,
        max,
        min
      };
    }

    return result;
  }

  logMetrics() {
    const metrics = this.getMetrics();
    console.log('[Metrics Report]', {
      timestamp: new Date().toISOString(),
      ...metrics
    });
    return metrics;
  }
}

export const metricsCollector = new MetricsCollector();

// Performance timing decorator
export function timeOperation(operationName) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      const operationId = metricsCollector.startOperation(operationName, {
        class: target.constructor.name,
        method: propertyKey,
        args: args.length > 0 ? JSON.stringify(args[0]) : 'none'
      });

      try {
        const result = await originalMethod.apply(this, args);
        metricsCollector.endOperation(operationId, true);
        return result;
      } catch (error) {
        metricsCollector.endOperation(operationId, false, error);
        throw error;
      }
    };

    return descriptor;
  };
}