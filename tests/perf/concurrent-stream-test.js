/**
 * Concurrent Stream Test
 * Tests CPU performance under concurrent streaming load
 */

import { MockStreamProvider, MockResponse, createMockProviderPoolManager } from '../mocks/mock-stream-provider.js';
import { measureCpuUsage, PERFORMANCE_THRESHOLDS } from './streaming-cpu-benchmark.js';

/**
 * Run concurrent stream test
 * @param {Object} options - Test options
 * @param {number} [options.concurrency=10] - Number of concurrent streams
 * @param {number} [options.chunksPerStream=100] - Chunks per stream
 * @param {number} [options.chunkDelay=0] - Delay between chunks in ms
 * @param {number} [options.chunkSize=50] - Size of each chunk
 * @param {Function} [options.streamHandler] - Custom stream handler function
 * @returns {Object} Test results
 */
export async function runConcurrentStreamTest(options = {}) {
    const {
        concurrency = 10,
        chunksPerStream = 100,
        chunkDelay = 0,
        chunkSize = 50,
        streamHandler = null
    } = options;

    const results = {
        concurrency,
        chunksPerStream,
        totalChunks: concurrency * chunksPerStream,
        streams: []
    };

    const startCpu = process.cpuUsage();
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    const promises = [];

    for (let i = 0; i < concurrency; i++) {
        const provider = new MockStreamProvider({
            chunkCount: chunksPerStream,
            chunkDelay,
            chunkSize,
            format: 'gemini'
        });

        const mockRes = new MockResponse();

        const streamPromise = (async () => {
            const streamStart = Date.now();
            let chunkCount = 0;

            if (streamHandler) {
                // Use custom handler (e.g., the actual handleStreamRequest)
                await streamHandler(mockRes, provider, 'mock-model', {});
                chunkCount = mockRes.getChunkCount();
            } else {
                // Default: directly consume the stream
                const stream = provider.generateContentStream('mock-model', {});
                for await (const chunk of stream) {
                    mockRes.write(JSON.stringify(chunk));
                    chunkCount++;
                }
                mockRes.end();
            }

            return {
                streamIndex: i,
                duration: Date.now() - streamStart,
                chunkCount,
                responseSize: mockRes.getBody().length
            };
        })();

        promises.push(streamPromise);
    }

    const streamResults = await Promise.all(promises);
    results.streams = streamResults;

    const endCpu = process.cpuUsage(startCpu);
    const endTime = Date.now();
    const endMemory = process.memoryUsage().heapUsed;

    results.wallTimeMs = endTime - startTime;
    results.cpuUserMs = endCpu.user / 1000;
    results.cpuSystemMs = endCpu.system / 1000;
    results.cpuTotalMs = (endCpu.user + endCpu.system) / 1000;
    results.memoryDelta = endMemory - startMemory;

    // Derived metrics
    results.cpuPerChunk = results.cpuTotalMs / results.totalChunks;
    results.throughput = results.totalChunks / (results.wallTimeMs / 1000); // chunks/sec
    results.avgStreamDuration = streamResults.reduce((sum, s) => sum + s.duration, 0) / streamResults.length;

    return results;
}

/**
 * Run performance regression test
 * @param {Object} options - Test options
 * @returns {Object} Test results with pass/fail status
 */
export async function runPerformanceRegressionTest(options = {}) {
    const testConfig = {
        concurrency: options.concurrency || 10,
        chunksPerStream: options.chunksPerStream || 50,
        chunkDelay: 0,
        ...options
    };

    const result = await runConcurrentStreamTest(testConfig);

    const failures = [];
    const warnings = [];

    // Check CPU per chunk threshold
    if (result.cpuPerChunk > PERFORMANCE_THRESHOLDS.maxCpuPerChunk) {
        failures.push(
            `CPU per chunk ${result.cpuPerChunk.toFixed(3)}ms exceeds threshold ${PERFORMANCE_THRESHOLDS.maxCpuPerChunk}ms`
        );
    }

    // Check memory growth
    if (result.memoryDelta > PERFORMANCE_THRESHOLDS.maxMemoryGrowth) {
        failures.push(
            `Memory growth ${(result.memoryDelta / 1024 / 1024).toFixed(2)}MB exceeds threshold ${PERFORMANCE_THRESHOLDS.maxMemoryGrowth / 1024 / 1024}MB`
        );
    }

    // Check wall time for high concurrency test
    if (testConfig.concurrency >= 100 && result.wallTimeMs > PERFORMANCE_THRESHOLDS.maxWallTimeFor100Streams) {
        failures.push(
            `Wall time ${result.wallTimeMs}ms exceeds threshold ${PERFORMANCE_THRESHOLDS.maxWallTimeFor100Streams}ms for ${testConfig.concurrency} streams`
        );
    }

    // Warnings for concerning but not failing metrics
    if (result.cpuPerChunk > PERFORMANCE_THRESHOLDS.maxCpuPerChunk * 0.8) {
        warnings.push(
            `CPU per chunk ${result.cpuPerChunk.toFixed(3)}ms is approaching threshold`
        );
    }

    return {
        passed: failures.length === 0,
        failures,
        warnings,
        metrics: result,
        thresholds: PERFORMANCE_THRESHOLDS
    };
}

/**
 * Compare two implementations
 * @param {Function} baselineHandler - Baseline stream handler
 * @param {Function} optimizedHandler - Optimized stream handler
 * @param {Object} options - Test options
 * @returns {Object} Comparison results
 */
export async function compareImplementations(baselineHandler, optimizedHandler, options = {}) {
    const testConfig = {
        concurrency: options.concurrency || 10,
        chunksPerStream: options.chunksPerStream || 50,
        iterations: options.iterations || 3
    };

    const baselineResults = [];
    const optimizedResults = [];

    for (let i = 0; i < testConfig.iterations; i++) {
        // Run baseline
        const baselineResult = await runConcurrentStreamTest({
            ...testConfig,
            streamHandler: baselineHandler
        });
        baselineResults.push(baselineResult);

        // Run optimized
        const optimizedResult = await runConcurrentStreamTest({
            ...testConfig,
            streamHandler: optimizedHandler
        });
        optimizedResults.push(optimizedResult);
    }

    // Calculate averages
    const avgBaseline = {
        cpuTotalMs: baselineResults.reduce((sum, r) => sum + r.cpuTotalMs, 0) / testConfig.iterations,
        wallTimeMs: baselineResults.reduce((sum, r) => sum + r.wallTimeMs, 0) / testConfig.iterations,
        cpuPerChunk: baselineResults.reduce((sum, r) => sum + r.cpuPerChunk, 0) / testConfig.iterations
    };

    const avgOptimized = {
        cpuTotalMs: optimizedResults.reduce((sum, r) => sum + r.cpuTotalMs, 0) / testConfig.iterations,
        wallTimeMs: optimizedResults.reduce((sum, r) => sum + r.wallTimeMs, 0) / testConfig.iterations,
        cpuPerChunk: optimizedResults.reduce((sum, r) => sum + r.cpuPerChunk, 0) / testConfig.iterations
    };

    return {
        baseline: avgBaseline,
        optimized: avgOptimized,
        improvement: {
            cpuReduction: ((avgBaseline.cpuTotalMs - avgOptimized.cpuTotalMs) / avgBaseline.cpuTotalMs * 100).toFixed(2) + '%',
            wallTimeReduction: ((avgBaseline.wallTimeMs - avgOptimized.wallTimeMs) / avgBaseline.wallTimeMs * 100).toFixed(2) + '%',
            cpuPerChunkReduction: ((avgBaseline.cpuPerChunk - avgOptimized.cpuPerChunk) / avgBaseline.cpuPerChunk * 100).toFixed(2) + '%'
        },
        rawResults: {
            baseline: baselineResults,
            optimized: optimizedResults
        }
    };
}

/**
 * Format test results as readable report
 * @param {Object} results - Test results from runConcurrentStreamTest
 * @returns {string} Formatted report
 */
export function formatTestReport(results) {
    const lines = [
        '=== Concurrent Stream Test Report ===',
        '',
        `Concurrency: ${results.concurrency}`,
        `Chunks per stream: ${results.chunksPerStream}`,
        `Total chunks: ${results.totalChunks}`,
        '',
        '--- Performance Metrics ---',
        `Wall time: ${results.wallTimeMs.toFixed(2)}ms`,
        `CPU time (user): ${results.cpuUserMs.toFixed(2)}ms`,
        `CPU time (system): ${results.cpuSystemMs.toFixed(2)}ms`,
        `CPU time (total): ${results.cpuTotalMs.toFixed(2)}ms`,
        `CPU per chunk: ${results.cpuPerChunk.toFixed(4)}ms`,
        `Throughput: ${results.throughput.toFixed(2)} chunks/sec`,
        `Memory delta: ${(results.memoryDelta / 1024).toFixed(2)}KB`,
        '',
        '--- Stream Statistics ---',
        `Average stream duration: ${results.avgStreamDuration.toFixed(2)}ms`,
        `Min stream duration: ${Math.min(...results.streams.map(s => s.duration))}ms`,
        `Max stream duration: ${Math.max(...results.streams.map(s => s.duration))}ms`
    ];

    return lines.join('\n');
}
