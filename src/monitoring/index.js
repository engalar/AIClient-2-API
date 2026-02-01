/**
 * Performance Monitoring Module
 * P4: Centralized export for all monitoring components
 *
 * Components:
 * - RequestMetrics: Request counting, latency tracking
 * - SystemMetrics: CPU, memory, event loop monitoring
 * - MetricsExporter: Prometheus and JSON format export
 * - MetricsCollector: Singleton aggregator
 */

import { RequestMetrics } from './request-metrics.js';
import { SystemMetrics } from './system-metrics.js';
import { MetricsExporter } from './metrics-exporter.js';
import { MetricsCollector } from './metrics-collector.js';

/**
 * Reset all metrics (for testing)
 */
function resetAllMetrics() {
    RequestMetrics.reset();
    SystemMetrics.reset();
    MetricsCollector.resetInstance();
}

export {
    RequestMetrics,
    SystemMetrics,
    MetricsExporter,
    MetricsCollector,
    resetAllMetrics
};

export default {
    RequestMetrics,
    SystemMetrics,
    MetricsExporter,
    MetricsCollector,
    resetAllMetrics
};
