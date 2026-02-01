/**
 * Request Metrics Module
 * P4: Performance monitoring - request counting, latency tracking, throughput calculation
 *
 * Features:
 * - Request counting by endpoint, method, status code
 * - Latency histogram with configurable buckets
 * - Percentile calculation (p50, p90, p99)
 * - Throughput (requests per second)
 * - Error rate tracking
 * - Active request tracking
 */

import { v4 as uuidv4 } from 'uuid';

// Default histogram buckets (in milliseconds)
const DEFAULT_BUCKETS = [100, 250, 500, 1000, 2500, 5000];

// CRITICAL-1 fix: Bounded latency storage to prevent memory exhaustion
const MAX_LATENCY_SAMPLES = 10000;

// HIGH-2 fix: Cache sorted latencies to avoid O(n log n) on every getMetrics()
let sortedLatenciesCache = null;
let sortedLatenciesCacheValid = false;

// Metrics state
let state = createInitialState();

/**
 * Create initial metrics state
 * @returns {Object} Initial state object
 */
function createInitialState() {
    return {
        totalRequests: 0,
        byEndpoint: {},
        byStatusCode: {},
        byMethod: {},
        latencies: [],
        latencySum: 0,
        latencyMin: Infinity,
        latencyMax: -Infinity,
        histogram: createEmptyHistogram(),
        activeRequests: new Map(),
        startTime: Date.now(),
        errorCount: 0
    };
}

/**
 * Create empty histogram with default buckets
 * @returns {Object} Empty histogram object
 */
function createEmptyHistogram() {
    const histogram = {};
    for (const bucket of DEFAULT_BUCKETS) {
        histogram[bucket.toString()] = 0;
    }
    histogram['+Inf'] = 0;
    return histogram;
}

/**
 * Normalize endpoint for grouping
 * @param {string} endpoint - Raw endpoint path
 * @returns {string} Normalized endpoint
 */
function normalizeEndpoint(endpoint) {
    if (!endpoint) return 'unknown';
    // Remove query parameters
    const path = endpoint.split('?')[0];
    // Normalize common patterns
    return path;
}

/**
 * Record a completed request
 * @param {string} endpoint - Request endpoint
 * @param {string} method - HTTP method
 * @param {number} statusCode - Response status code
 */
function recordRequest(endpoint, method, statusCode) {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const normalizedMethod = method || 'UNKNOWN';
    const normalizedStatus = String(statusCode || 0);

    state.totalRequests++;

    // Track by endpoint
    state.byEndpoint[normalizedEndpoint] = (state.byEndpoint[normalizedEndpoint] || 0) + 1;

    // Track by status code
    state.byStatusCode[normalizedStatus] = (state.byStatusCode[normalizedStatus] || 0) + 1;

    // Track by method
    state.byMethod[normalizedMethod] = (state.byMethod[normalizedMethod] || 0) + 1;

    // Track errors (5xx status codes)
    if (statusCode >= 500) {
        state.errorCount++;
    }
}

/**
 * Record request latency
 * @param {string} endpoint - Request endpoint
 * @param {number} latencyMs - Latency in milliseconds
 */
function recordLatency(endpoint, latencyMs) {
    // Ignore negative or invalid latencies
    if (typeof latencyMs !== 'number' || latencyMs < 0) {
        latencyMs = 0;
    }

    // Cap extremely large values to prevent overflow
    if (latencyMs > Number.MAX_SAFE_INTEGER / 2) {
        latencyMs = Number.MAX_SAFE_INTEGER / 2;
    }

    // CRITICAL-1 fix: Sliding window to prevent unbounded memory growth
    if (state.latencies.length >= MAX_LATENCY_SAMPLES) {
        // Remove oldest value and adjust sum
        const removed = state.latencies.shift();
        state.latencySum -= removed;
    }
    state.latencies.push(latencyMs);
    state.latencySum += latencyMs;

    // HIGH-2 fix: Invalidate sorted cache when new data added
    sortedLatenciesCacheValid = false;

    if (latencyMs < state.latencyMin) {
        state.latencyMin = latencyMs;
    }
    if (latencyMs > state.latencyMax) {
        state.latencyMax = latencyMs;
    }

    // Update histogram
    let bucketFound = false;
    for (const bucket of DEFAULT_BUCKETS) {
        if (latencyMs <= bucket) {
            state.histogram[bucket.toString()]++;
            bucketFound = true;
            break;
        }
    }
    if (!bucketFound) {
        state.histogram['+Inf']++;
    }
}

/**
 * Start tracking an active request
 * @param {string} endpoint - Request endpoint
 * @param {string} method - HTTP method
 * @returns {string} Request ID for tracking
 */
function startRequest(endpoint, method) {
    const requestId = uuidv4();
    state.activeRequests.set(requestId, {
        endpoint,
        method,
        startTime: Date.now()
    });
    return requestId;
}

/**
 * End tracking an active request
 * @param {string} requestId - Request ID from startRequest
 * @param {number} statusCode - Response status code
 * @returns {number|null} Latency in ms, or null if request not found
 */
function endRequest(requestId, statusCode) {
    const request = state.activeRequests.get(requestId);
    if (!request) return null;

    const latency = Date.now() - request.startTime;
    state.activeRequests.delete(requestId);

    recordRequest(request.endpoint, request.method, statusCode);
    recordLatency(request.endpoint, latency);

    return latency;
}

/**
 * Get number of active requests
 * @returns {number} Active request count
 */
function getActiveRequests() {
    return state.activeRequests.size;
}

/**
 * Calculate percentile from sorted array
 * @param {number[]} sortedArray - Sorted array of values
 * @param {number} percentile - Percentile (0-100)
 * @returns {number} Percentile value
 */
function calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
}

/**
 * Get all request metrics
 * @returns {Object} Metrics object
 */
function getMetrics() {
    const now = Date.now();
    const elapsedSeconds = Math.max(1, (now - state.startTime) / 1000);

    // HIGH-2 fix: Use cached sorted latencies to avoid O(n log n) on every call
    if (!sortedLatenciesCacheValid || !sortedLatenciesCache) {
        sortedLatenciesCache = [...state.latencies].sort((a, b) => a - b);
        sortedLatenciesCacheValid = true;
    }
    const sortedLatencies = sortedLatenciesCache;
    const latencyCount = sortedLatencies.length;
    const latencyAvg = latencyCount > 0 ? state.latencySum / latencyCount : 0;

    return {
        totalRequests: state.totalRequests,
        byEndpoint: { ...state.byEndpoint },
        byStatusCode: { ...state.byStatusCode },
        byMethod: { ...state.byMethod },
        latency: {
            count: latencyCount,
            sum: state.latencySum,
            avg: latencyAvg,
            min: latencyCount > 0 ? state.latencyMin : 0,
            max: latencyCount > 0 ? state.latencyMax : 0,
            p50: calculatePercentile(sortedLatencies, 50),
            p90: calculatePercentile(sortedLatencies, 90),
            p99: calculatePercentile(sortedLatencies, 99),
            histogram: { ...state.histogram }
        },
        throughput: {
            requestsPerSecond: state.totalRequests / elapsedSeconds
        },
        errorRate: state.totalRequests > 0 ? state.errorCount / state.totalRequests : 0,
        activeRequests: state.activeRequests.size
    };
}

/**
 * Reset all request metrics
 */
function reset() {
    state = createInitialState();
    // HIGH-2 fix: Clear sorted cache on reset
    sortedLatenciesCache = null;
    sortedLatenciesCacheValid = false;
}

export const RequestMetrics = {
    recordRequest,
    recordLatency,
    startRequest,
    endRequest,
    getActiveRequests,
    getMetrics,
    reset
};

export default RequestMetrics;
