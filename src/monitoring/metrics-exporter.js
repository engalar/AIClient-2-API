/**
 * Metrics Exporter Module
 * P4: Performance monitoring - Prometheus and JSON format export
 *
 * Features:
 * - Prometheus text format export
 * - JSON format export
 * - Configurable metric prefix
 */

import { RequestMetrics } from './request-metrics.js';
import { SystemMetrics } from './system-metrics.js';

const DEFAULT_PREFIX = 'aiclient';

/**
 * Format a Prometheus metric line
 * @param {string} name - Metric name
 * @param {Object} labels - Label key-value pairs
 * @param {number} value - Metric value
 * @returns {string} Formatted metric line
 */
function formatMetricLine(name, labels, value) {
    if (Object.keys(labels).length === 0) {
        return `${name} ${value}`;
    }

    const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');

    return `${name}{${labelStr}} ${value}`;
}

/**
 * Export metrics in Prometheus text format
 * @param {string} prefix - Metric name prefix
 * @returns {string} Prometheus format metrics
 */
function toPrometheus(prefix = DEFAULT_PREFIX) {
    const lines = [];
    const requestMetrics = RequestMetrics.getMetrics();
    const systemMetrics = SystemMetrics.getMetrics();

    // ============================================
    // Request Metrics
    // ============================================

    // Total requests counter
    lines.push(`# HELP ${prefix}_http_requests_total Total number of HTTP requests`);
    lines.push(`# TYPE ${prefix}_http_requests_total counter`);

    // Group by method and status
    const requestsByMethodStatus = {};
    for (const [method, count] of Object.entries(requestMetrics.byMethod)) {
        for (const [status, statusCount] of Object.entries(requestMetrics.byStatusCode)) {
            const key = `${method}_${status}`;
            if (!requestsByMethodStatus[key]) {
                requestsByMethodStatus[key] = { method, status, count: 0 };
            }
        }
    }

    // Output by method
    for (const [method, count] of Object.entries(requestMetrics.byMethod)) {
        for (const [status, statusCount] of Object.entries(requestMetrics.byStatusCode)) {
            // Approximate distribution (in real implementation, track this directly)
            const approxCount = Math.round((count / requestMetrics.totalRequests) * statusCount) || 0;
            if (approxCount > 0 || (count > 0 && statusCount > 0)) {
                lines.push(formatMetricLine(
                    `${prefix}_http_requests_total`,
                    { method, status },
                    approxCount || statusCount
                ));
            }
        }
    }

    // If no requests yet, output a zero line
    if (requestMetrics.totalRequests === 0) {
        lines.push(formatMetricLine(`${prefix}_http_requests_total`, { method: 'GET', status: '200' }, 0));
    }

    // Request duration histogram
    lines.push('');
    lines.push(`# HELP ${prefix}_http_request_duration_ms HTTP request duration in milliseconds`);
    lines.push(`# TYPE ${prefix}_http_request_duration_ms histogram`);

    // Histogram buckets
    let cumulativeCount = 0;
    const buckets = ['100', '250', '500', '1000', '2500', '5000', '+Inf'];
    for (const bucket of buckets) {
        const bucketCount = requestMetrics.latency.histogram[bucket] || 0;
        cumulativeCount += bucketCount;
        lines.push(formatMetricLine(
            `${prefix}_http_request_duration_ms_bucket`,
            { le: bucket },
            cumulativeCount
        ));
    }

    lines.push(formatMetricLine(`${prefix}_http_request_duration_ms_sum`, {}, requestMetrics.latency.sum));
    lines.push(formatMetricLine(`${prefix}_http_request_duration_ms_count`, {}, requestMetrics.latency.count));

    // Latency percentiles
    lines.push('');
    lines.push(`# HELP ${prefix}_http_request_duration_ms_percentile HTTP request duration percentiles`);
    lines.push(`# TYPE ${prefix}_http_request_duration_ms_percentile gauge`);
    lines.push(formatMetricLine(`${prefix}_http_request_duration_ms_percentile`, { quantile: '0.5' }, requestMetrics.latency.p50));
    lines.push(formatMetricLine(`${prefix}_http_request_duration_ms_percentile`, { quantile: '0.9' }, requestMetrics.latency.p90));
    lines.push(formatMetricLine(`${prefix}_http_request_duration_ms_percentile`, { quantile: '0.99' }, requestMetrics.latency.p99));

    // Active requests
    lines.push('');
    lines.push(`# HELP ${prefix}_http_requests_active Number of active HTTP requests`);
    lines.push(`# TYPE ${prefix}_http_requests_active gauge`);
    lines.push(formatMetricLine(`${prefix}_http_requests_active`, {}, requestMetrics.activeRequests));

    // Error rate
    lines.push('');
    lines.push(`# HELP ${prefix}_http_error_rate HTTP error rate (5xx responses)`);
    lines.push(`# TYPE ${prefix}_http_error_rate gauge`);
    lines.push(formatMetricLine(`${prefix}_http_error_rate`, {}, requestMetrics.errorRate));

    // Throughput
    lines.push('');
    lines.push(`# HELP ${prefix}_http_requests_per_second HTTP requests per second`);
    lines.push(`# TYPE ${prefix}_http_requests_per_second gauge`);
    lines.push(formatMetricLine(`${prefix}_http_requests_per_second`, {}, requestMetrics.throughput.requestsPerSecond.toFixed(2)));

    // ============================================
    // Memory Metrics
    // ============================================

    lines.push('');
    lines.push(`# HELP ${prefix}_memory_heap_used_bytes Process heap memory used`);
    lines.push(`# TYPE ${prefix}_memory_heap_used_bytes gauge`);
    lines.push(formatMetricLine(`${prefix}_memory_heap_used_bytes`, {}, systemMetrics.memory.heapUsed));

    lines.push('');
    lines.push(`# HELP ${prefix}_memory_heap_total_bytes Process heap memory total`);
    lines.push(`# TYPE ${prefix}_memory_heap_total_bytes gauge`);
    lines.push(formatMetricLine(`${prefix}_memory_heap_total_bytes`, {}, systemMetrics.memory.heapTotal));

    lines.push('');
    lines.push(`# HELP ${prefix}_memory_rss_bytes Process resident set size`);
    lines.push(`# TYPE ${prefix}_memory_rss_bytes gauge`);
    lines.push(formatMetricLine(`${prefix}_memory_rss_bytes`, {}, systemMetrics.memory.rss));

    lines.push('');
    lines.push(`# HELP ${prefix}_memory_external_bytes Process external memory`);
    lines.push(`# TYPE ${prefix}_memory_external_bytes gauge`);
    lines.push(formatMetricLine(`${prefix}_memory_external_bytes`, {}, systemMetrics.memory.external));

    // ============================================
    // CPU Metrics
    // ============================================

    lines.push('');
    lines.push(`# HELP ${prefix}_cpu_usage_percent Process CPU usage percentage`);
    lines.push(`# TYPE ${prefix}_cpu_usage_percent gauge`);
    lines.push(formatMetricLine(`${prefix}_cpu_usage_percent`, {}, systemMetrics.cpu.percentage));

    lines.push('');
    lines.push(`# HELP ${prefix}_cpu_user_microseconds Process CPU user time in microseconds`);
    lines.push(`# TYPE ${prefix}_cpu_user_microseconds counter`);
    lines.push(formatMetricLine(`${prefix}_cpu_user_microseconds`, {}, systemMetrics.cpu.user));

    lines.push('');
    lines.push(`# HELP ${prefix}_cpu_system_microseconds Process CPU system time in microseconds`);
    lines.push(`# TYPE ${prefix}_cpu_system_microseconds counter`);
    lines.push(formatMetricLine(`${prefix}_cpu_system_microseconds`, {}, systemMetrics.cpu.system));

    // ============================================
    // Event Loop Metrics
    // ============================================

    lines.push('');
    lines.push(`# HELP ${prefix}_eventloop_delay_ms Event loop delay in milliseconds`);
    lines.push(`# TYPE ${prefix}_eventloop_delay_ms gauge`);
    lines.push(formatMetricLine(`${prefix}_eventloop_delay_ms`, {}, systemMetrics.eventLoop.delay));

    lines.push('');
    lines.push(`# HELP ${prefix}_eventloop_lag_ms Event loop lag in milliseconds`);
    lines.push(`# TYPE ${prefix}_eventloop_lag_ms gauge`);
    lines.push(formatMetricLine(`${prefix}_eventloop_lag_ms`, {}, systemMetrics.eventLoop.lag));

    // ============================================
    // Uptime Metric
    // ============================================

    lines.push('');
    lines.push(`# HELP ${prefix}_uptime_seconds Process uptime in seconds`);
    lines.push(`# TYPE ${prefix}_uptime_seconds counter`);
    lines.push(formatMetricLine(`${prefix}_uptime_seconds`, {}, systemMetrics.uptime.toFixed(2)));

    // ============================================
    // System Info
    // ============================================

    lines.push('');
    lines.push(`# HELP ${prefix}_system_info System information`);
    lines.push(`# TYPE ${prefix}_system_info gauge`);
    lines.push(formatMetricLine(`${prefix}_system_info`, {
        platform: systemMetrics.system.platform,
        arch: systemMetrics.system.arch,
        node_version: systemMetrics.system.nodeVersion
    }, 1));

    lines.push('');
    lines.push(`# HELP ${prefix}_system_cpu_count Number of CPU cores`);
    lines.push(`# TYPE ${prefix}_system_cpu_count gauge`);
    lines.push(formatMetricLine(`${prefix}_system_cpu_count`, {}, systemMetrics.system.cpuCount));

    lines.push('');
    lines.push(`# HELP ${prefix}_system_memory_total_bytes Total system memory`);
    lines.push(`# TYPE ${prefix}_system_memory_total_bytes gauge`);
    lines.push(formatMetricLine(`${prefix}_system_memory_total_bytes`, {}, systemMetrics.system.totalMemory));

    return lines.join('\n');
}

/**
 * Export metrics in JSON format
 * @returns {Object} JSON metrics object
 */
function toJSON() {
    const requestMetrics = RequestMetrics.getMetrics();
    const systemMetrics = SystemMetrics.getMetrics();

    return {
        timestamp: new Date().toISOString(),
        requests: {
            total: requestMetrics.totalRequests,
            byEndpoint: requestMetrics.byEndpoint,
            byStatusCode: requestMetrics.byStatusCode,
            byMethod: requestMetrics.byMethod,
            latency: requestMetrics.latency,
            throughput: requestMetrics.throughput,
            errorRate: requestMetrics.errorRate,
            activeRequests: requestMetrics.activeRequests
        },
        system: {
            memory: systemMetrics.memory,
            cpu: systemMetrics.cpu,
            eventLoop: systemMetrics.eventLoop,
            uptime: systemMetrics.uptime,
            info: systemMetrics.system
        }
    };
}

export const MetricsExporter = {
    toPrometheus,
    toJSON
};

export default MetricsExporter;
