/**
 * Streaming CPU Benchmark
 * Measures CPU usage and performance metrics for streaming operations
 */

import { performance } from 'perf_hooks';
import v8 from 'v8';

/**
 * CPU and memory benchmark utility for streaming operations
 */
export class StreamingCpuBenchmark {
    constructor() {
        this.results = [];
        this.baselineMetrics = null;
    }

    /**
     * Capture baseline metrics before running tests
     */
    captureBaseline() {
        if (global.gc) {
            global.gc();
        }
        this.baselineMetrics = {
            heapUsed: v8.getHeapStatistics().used_heap_size,
            timestamp: Date.now()
        };
    }

    /**
     * Run a benchmark test
     * @param {Function} testFn - Async function to benchmark
     * @param {Object} options - Benchmark options
     * @param {number} [options.iterations=10] - Number of iterations
     * @param {number} [options.warmup=2] - Warmup runs (not counted)
     * @param {string} [options.name='unnamed'] - Test name
     * @returns {Object} Benchmark statistics
     */
    async runBenchmark(testFn, options = {}) {
        const iterations = options.iterations || 10;
        const warmupRuns = options.warmup || 2;
        const name = options.name || 'unnamed';

        // Warmup runs
        for (let i = 0; i < warmupRuns; i++) {
            await testFn();
        }

        // Force GC if available
        if (global.gc) {
            global.gc();
        }

        const iterationResults = [];

        // Actual benchmark runs
        for (let i = 0; i < iterations; i++) {
            const startCpu = process.cpuUsage();
            const startTime = performance.now();
            const startHeap = v8.getHeapStatistics().used_heap_size;

            await testFn();

            const endCpu = process.cpuUsage(startCpu);
            const endTime = performance.now();
            const endHeap = v8.getHeapStatistics().used_heap_size;

            iterationResults.push({
                iteration: i,
                cpuUser: endCpu.user / 1000, // Convert to ms
                cpuSystem: endCpu.system / 1000,
                wallTime: endTime - startTime,
                heapDelta: endHeap - startHeap
            });
        }

        const stats = this._calculateStatistics(iterationResults);
        stats.name = name;
        this.results.push(stats);

        return stats;
    }

    /**
     * Run multiple benchmarks and compare results
     * @param {Array<{name: string, fn: Function}>} benchmarks - Array of benchmark configs
     * @param {Object} options - Benchmark options
     * @returns {Object} Comparison results
     */
    async runComparison(benchmarks, options = {}) {
        const results = [];

        for (const benchmark of benchmarks) {
            const stats = await this.runBenchmark(benchmark.fn, {
                ...options,
                name: benchmark.name
            });
            results.push(stats);
        }

        return {
            results,
            comparison: this._compareResults(results)
        };
    }

    /**
     * Calculate statistics from iteration results
     * @private
     */
    _calculateStatistics(iterationResults) {
        const cpuTimes = iterationResults.map(r => r.cpuUser + r.cpuSystem);
        const wallTimes = iterationResults.map(r => r.wallTime);
        const heapDeltas = iterationResults.map(r => r.heapDelta);

        return {
            iterations: iterationResults.length,
            cpu: {
                avg: this._average(cpuTimes),
                min: Math.min(...cpuTimes),
                max: Math.max(...cpuTimes),
                p50: this._percentile(cpuTimes, 50),
                p95: this._percentile(cpuTimes, 95),
                p99: this._percentile(cpuTimes, 99),
                stdDev: this._standardDeviation(cpuTimes)
            },
            wallTime: {
                avg: this._average(wallTimes),
                min: Math.min(...wallTimes),
                max: Math.max(...wallTimes),
                p50: this._percentile(wallTimes, 50),
                p95: this._percentile(wallTimes, 95)
            },
            memory: {
                avgHeapDelta: this._average(heapDeltas),
                maxHeapDelta: Math.max(...heapDeltas)
            },
            raw: iterationResults
        };
    }

    /**
     * Compare benchmark results
     * @private
     */
    _compareResults(results) {
        if (results.length < 2) return null;

        const baseline = results[0];
        const comparisons = results.slice(1).map(result => ({
            name: result.name,
            vsBaseline: {
                cpuRatio: result.cpu.avg / baseline.cpu.avg,
                wallTimeRatio: result.wallTime.avg / baseline.wallTime.avg,
                cpuImprovement: ((baseline.cpu.avg - result.cpu.avg) / baseline.cpu.avg * 100).toFixed(2) + '%',
                wallTimeImprovement: ((baseline.wallTime.avg - result.wallTime.avg) / baseline.wallTime.avg * 100).toFixed(2) + '%'
            }
        }));

        return {
            baseline: baseline.name,
            comparisons
        };
    }

    _average(arr) {
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    _percentile(arr, p) {
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, idx)];
    }

    _standardDeviation(arr) {
        const avg = this._average(arr);
        const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
        return Math.sqrt(this._average(squareDiffs));
    }

    /**
     * Get all benchmark results
     */
    getAllResults() {
        return this.results;
    }

    /**
     * Clear all results
     */
    clear() {
        this.results = [];
        this.baselineMetrics = null;
    }

    /**
     * Format results as a readable report
     */
    formatReport() {
        const lines = ['=== Streaming CPU Benchmark Report ===\n'];

        for (const result of this.results) {
            lines.push(`\n--- ${result.name} ---`);
            lines.push(`Iterations: ${result.iterations}`);
            lines.push(`CPU Time (ms): avg=${result.cpu.avg.toFixed(2)}, p95=${result.cpu.p95.toFixed(2)}, max=${result.cpu.max.toFixed(2)}`);
            lines.push(`Wall Time (ms): avg=${result.wallTime.avg.toFixed(2)}, p95=${result.wallTime.p95.toFixed(2)}`);
            lines.push(`Memory (bytes): avgDelta=${result.memory.avgHeapDelta.toFixed(0)}, maxDelta=${result.memory.maxHeapDelta}`);
        }

        return lines.join('\n');
    }
}

/**
 * Measure CPU usage for a single operation
 * @param {Function} fn - Function to measure
 * @returns {Object} CPU usage metrics
 */
export async function measureCpuUsage(fn) {
    const startCpu = process.cpuUsage();
    const startTime = performance.now();

    await fn();

    const endCpu = process.cpuUsage(startCpu);
    const endTime = performance.now();

    return {
        cpuUser: endCpu.user / 1000,
        cpuSystem: endCpu.system / 1000,
        cpuTotal: (endCpu.user + endCpu.system) / 1000,
        wallTime: endTime - startTime,
        cpuEfficiency: (endCpu.user + endCpu.system) / 1000 / (endTime - startTime)
    };
}

/**
 * Performance thresholds for regression testing
 */
export const PERFORMANCE_THRESHOLDS = {
    // Maximum CPU time per chunk in ms
    maxCpuPerChunk: 0.5,
    // Maximum wall time for 100 concurrent streams with 50 chunks each
    maxWallTimeFor100Streams: 10000,
    // Maximum memory growth in bytes
    maxMemoryGrowth: 50 * 1024 * 1024, // 50MB
    // Maximum P95 CPU time ratio vs baseline
    maxP95CpuRatio: 1.5
};
