/**
 * Metrics Collector Module
 * P4: Performance monitoring - Singleton collector for all metrics
 *
 * Features:
 * - Singleton pattern for global access
 * - Aggregates all metric sources
 * - Custom metric registration
 */

import { RequestMetrics } from './request-metrics.js';
import { SystemMetrics } from './system-metrics.js';

// MEDIUM-5 fix: Prometheus metric name validation regex
const METRIC_NAME_REGEX = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

let instance = null;

/**
 * MetricsCollector class - Singleton
 */
class MetricsCollectorClass {
    constructor() {
        if (instance) {
            return instance;
        }
        this.customMetrics = new Map();
        instance = this;
    }

    /**
     * Get singleton instance
     * @returns {MetricsCollectorClass} Singleton instance
     */
    static getInstance() {
        if (!instance) {
            instance = new MetricsCollectorClass();
        }
        return instance;
    }

    /**
     * Register a custom metric
     * @param {string} name - Metric name (must follow Prometheus naming convention)
     * @param {Function} collector - Function that returns metric value
     */
    registerCustomMetric(name, collector) {
        // MEDIUM-5 fix: Validate metric name format
        if (!name || typeof name !== 'string') {
            throw new Error('Metric name must be a non-empty string');
        }
        if (!METRIC_NAME_REGEX.test(name)) {
            throw new Error(`Invalid metric name format: "${name}". Must match [a-zA-Z_:][a-zA-Z0-9_:]*`);
        }
        if (typeof collector !== 'function') {
            throw new Error('Collector must be a function');
        }
        this.customMetrics.set(name, collector);
    }

    /**
     * Unregister a custom metric
     * @param {string} name - Metric name
     */
    unregisterCustomMetric(name) {
        this.customMetrics.delete(name);
    }

    /**
     * Collect all metrics
     * @returns {Object} All metrics
     */
    collect() {
        const result = {
            requests: RequestMetrics.getMetrics(),
            system: SystemMetrics.getMetrics(),
            custom: {},
            timestamp: new Date().toISOString()
        };

        // Collect custom metrics
        for (const [name, collector] of this.customMetrics) {
            try {
                result.custom[name] = collector();
            } catch (error) {
                result.custom[name] = {
                    error: error.message,
                    value: null
                };
            }
        }

        return result;
    }

    /**
     * Reset all metrics
     */
    reset() {
        RequestMetrics.reset();
        SystemMetrics.reset();
        this.customMetrics.clear();
    }
}

/**
 * Reset singleton instance (for testing)
 */
function resetInstance() {
    if (instance) {
        instance.customMetrics.clear();
    }
    instance = null;
}

export const MetricsCollector = {
    getInstance: () => MetricsCollectorClass.getInstance(),
    resetInstance
};

export default MetricsCollector;
