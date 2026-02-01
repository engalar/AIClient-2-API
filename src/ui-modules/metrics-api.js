/**
 * Metrics API Module
 * P4: Performance monitoring API endpoints
 *
 * Endpoints:
 * - GET /api/metrics - Prometheus format metrics
 * - GET /api/metrics/json - JSON format metrics
 * - POST /api/metrics/reset - Reset all metrics (admin only)
 */

import { MetricsExporter, resetAllMetrics } from '../monitoring/index.js';

/**
 * Handle GET /api/metrics - Prometheus format
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 * @returns {boolean} True if handled
 */
export async function handleGetMetrics(req, res) {
    try {
        const output = MetricsExporter.toPrometheus();

        res.writeHead(200, {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(output);
        return true;
    } catch (error) {
        console.error('[Metrics API] Error exporting Prometheus metrics:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to export metrics: ' + error.message,
                code: 'METRICS_EXPORT_ERROR'
            }
        }));
        return true;
    }
}

/**
 * Handle GET /api/metrics/json - JSON format
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 * @returns {boolean} True if handled
 */
export async function handleGetMetricsJSON(req, res) {
    try {
        const output = MetricsExporter.toJSON();

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(JSON.stringify(output, null, 2));
        return true;
    } catch (error) {
        console.error('[Metrics API] Error exporting JSON metrics:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to export metrics: ' + error.message,
                code: 'METRICS_EXPORT_ERROR'
            }
        }));
        return true;
    }
}

/**
 * Handle POST /api/metrics/reset - Reset all metrics
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 * @returns {boolean} True if handled
 */
export async function handleResetMetrics(req, res) {
    try {
        // HIGH-1 fix: Add audit logging for metrics reset
        console.log('[Metrics API] Metrics reset requested');
        resetAllMetrics();
        console.log('[Metrics API] All metrics have been reset');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'All metrics have been reset',
            timestamp: new Date().toISOString()
        }));
        return true;
    } catch (error) {
        console.error('[Metrics API] Error resetting metrics:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to reset metrics: ' + error.message,
                code: 'METRICS_RESET_ERROR'
            }
        }));
        return true;
    }
}
