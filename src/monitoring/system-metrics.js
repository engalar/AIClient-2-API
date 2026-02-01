/**
 * System Metrics Module
 * P4: Performance monitoring - CPU, memory, event loop delay
 *
 * Features:
 * - Memory usage (heap, RSS, external)
 * - CPU usage percentage
 * - Event loop delay/lag monitoring
 * - Process uptime
 * - System information
 */

import os from 'os';

// MEDIUM-1 fix: Extract magic numbers to named constants
const EVENT_LOOP_CHECK_INTERVAL_MS = 100;
const EVENT_LOOP_LAG_THRESHOLD_MULTIPLIER = 1.5;
const EVENT_LOOP_LAG_DECAY_FACTOR = 0.9;

// State for CPU calculation
let previousCpuUsage = null;
let previousCpuTime = null;

// State for event loop monitoring
let eventLoopDelay = 0;
let eventLoopLag = 0;
let lastEventLoopCheck = Date.now();
let eventLoopMonitorInterval = null;

/**
 * Start event loop monitoring
 * Uses setImmediate to measure event loop delay
 */
function startEventLoopMonitoring() {
    if (eventLoopMonitorInterval) return;

    const checkEventLoop = () => {
        const now = Date.now();
        const expected = EVENT_LOOP_CHECK_INTERVAL_MS;
        const actual = now - lastEventLoopCheck;

        // Delay is how much longer than expected
        eventLoopDelay = Math.max(0, actual - expected);

        // Lag is accumulated delay
        if (actual > expected * EVENT_LOOP_LAG_THRESHOLD_MULTIPLIER) {
            eventLoopLag = actual - expected;
        } else {
            // Decay lag over time
            eventLoopLag = Math.max(0, eventLoopLag * EVENT_LOOP_LAG_DECAY_FACTOR);
        }

        lastEventLoopCheck = now;
    };

    // Use setInterval for periodic checks
    eventLoopMonitorInterval = setInterval(checkEventLoop, EVENT_LOOP_CHECK_INTERVAL_MS);

    // Don't prevent process exit
    if (eventLoopMonitorInterval.unref) {
        eventLoopMonitorInterval.unref();
    }
}

/**
 * Stop event loop monitoring
 */
function stopEventLoopMonitoring() {
    if (eventLoopMonitorInterval) {
        clearInterval(eventLoopMonitorInterval);
        eventLoopMonitorInterval = null;
    }
}

/**
 * Get memory metrics
 * @returns {Object} Memory metrics in bytes
 */
function getMemoryMetrics() {
    const memUsage = process.memoryUsage();
    return {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
        arrayBuffers: memUsage.arrayBuffers || 0
    };
}

/**
 * Get CPU metrics
 * @returns {Object} CPU metrics
 */
function getCpuMetrics() {
    const cpuUsage = process.cpuUsage(previousCpuUsage);
    const now = Date.now();

    let percentage = 0;

    if (previousCpuUsage && previousCpuTime) {
        const elapsedMs = now - previousCpuTime;
        if (elapsedMs > 0) {
            // CPU usage is in microseconds, convert to percentage
            const totalCpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
            percentage = Math.min(100, (totalCpuMs / elapsedMs) * 100);
        }
    }

    // Store for next calculation
    previousCpuUsage = process.cpuUsage();
    previousCpuTime = now;

    return {
        user: cpuUsage.user,
        system: cpuUsage.system,
        percentage: Math.round(percentage * 100) / 100
    };
}

/**
 * Get event loop metrics
 * @returns {Object} Event loop metrics
 */
function getEventLoopMetrics() {
    // Start monitoring if not already started
    if (!eventLoopMonitorInterval) {
        startEventLoopMonitoring();
    }

    return {
        delay: eventLoopDelay,
        lag: eventLoopLag
    };
}

/**
 * Get system information
 * @returns {Object} System info
 */
function getSystemInfo() {
    return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        cpuCount: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        loadAverage: os.loadavg()
    };
}

/**
 * Get all system metrics
 * @returns {Object} All system metrics
 */
function getMetrics() {
    return {
        memory: getMemoryMetrics(),
        cpu: getCpuMetrics(),
        eventLoop: getEventLoopMetrics(),
        uptime: process.uptime(),
        system: getSystemInfo()
    };
}

/**
 * Reset system metrics state
 */
function reset() {
    previousCpuUsage = null;
    previousCpuTime = null;
    eventLoopDelay = 0;
    eventLoopLag = 0;
    lastEventLoopCheck = Date.now();
}

export const SystemMetrics = {
    getMetrics,
    getMemoryMetrics,
    getCpuMetrics,
    getEventLoopMetrics,
    getSystemInfo,
    startEventLoopMonitoring,
    stopEventLoopMonitoring,
    reset
};

export default SystemMetrics;
