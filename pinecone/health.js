import { metricsCollector } from './metrics.js';
import { errorMetrics } from './errors.js';
import { config } from './config.js';
import { embeddingCache } from './cache.js';

class HealthMonitor {
  constructor() {
    this.healthStatus = {
      system: 'operational',
      lastChecked: new Date(),
      components: {}
    };
  }

  async checkSystemHealth() {
    const healthReport = {
      timestamp: new Date().toISOString(),
      system: 'operational',
      components: {
        configuration: this.checkConfiguration(),
        cache: this.checkCache(),
        metrics: this.getMetricsSummary(),
        errors: this.getErrorSummary()
      }
    };

    this.healthStatus = healthReport;
    return healthReport;
  }

  checkConfiguration() {
    return {
      status: 'healthy',
      config: config.getDocumentation(),
      environment: {
        pineconeIndex: process.env.PINECONE_INDEX_NAME || 'not set',
        pineconeEnvironment: process.env.PINECONE_ENVIRONMENT || 'not set',
        cacheEnabled: config.get('caching.enabled')
      }
    };
  }

  checkCache() {
    const cacheMetrics = embeddingCache.getMetrics();
    return {
      status: 'healthy',
      metrics: cacheMetrics,
      hitRate: cacheMetrics.hitRate,
      size: cacheMetrics.size,
      maxSize: config.get('caching.maxItems')
    };
  }

  getMetricsSummary() {
    const metrics = metricsCollector.getMetrics();
    return {
      status: 'healthy',
      operations: metrics.operations.length,
      counters: metrics.counters,
      timings: metrics.timings,
      errorCounts: metrics.errorCounts
    };
  }

  getErrorSummary() {
    const errorStats = errorMetrics.getMetrics();
    return {
      status: errorStats.total > 0 ? 'degraded' : 'healthy',
      totalErrors: errorStats.total,
      byType: errorStats.byType,
      recentErrors: errorStats.recent
    };
  }

  getHealthStatus() {
    return this.healthStatus;
  }
}

export const healthMonitor = new HealthMonitor();

// Health check endpoint functions
export async function getSystemHealth() {
  return await healthMonitor.checkSystemHealth();
}

export function getComponentHealth(component) {
  const health = healthMonitor.getHealthStatus();
  return health.components[component] || { status: 'unknown' };
}

export function getHealthSummary() {
  const health = healthMonitor.getHealthStatus();
  return {
    status: health.system,
    lastChecked: health.lastChecked,
    components: Object.keys(health.components).reduce((acc, key) => {
      acc[key] = health.components[key].status;
      return acc;
    }, {})
  };
}