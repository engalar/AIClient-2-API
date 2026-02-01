/**
 * Streaming CPU Performance Test Suite
 *
 * This test reproduces and measures the CPU performance issue in HTTP streaming responses.
 * Run with: node --expose-gc tests/reproduce_streaming_cpu.js
 */

import { MockStreamProvider, MockResponse } from './mocks/mock-stream-provider.js';
import { StreamingCpuBenchmark, measureCpuUsage, PERFORMANCE_THRESHOLDS } from './perf/streaming-cpu-benchmark.js';
import { runConcurrentStreamTest, runPerformanceRegressionTest, formatTestReport } from './perf/concurrent-stream-test.js';

// ============================================================
// Test Configuration
// ============================================================

const TEST_CONFIG = {
    // Basic test parameters
    concurrency: 10,
    chunksPerStream: 100,
    chunkSize: 50,

    // Stress test parameters
    stressConcurrency: 50,
    stressChunksPerStream: 200,

    // Benchmark iterations
    benchmarkIterations: 5,
    warmupRuns: 2
};

// ============================================================
// Baseline Implementation (Current - with setImmediate every 10 chunks)
// ============================================================

async function baselineStreamHandler(res, provider, model, requestBody) {
    const stream = provider.generateContentStream(model, requestBody);
    let chunkCount = 0;

    for await (const chunk of stream) {
        const serialized = JSON.stringify(chunk);
        res.write(`data: ${serialized}\n\n`);

        // Current implementation: yield every 10 chunks
        chunkCount++;
        if (chunkCount % 10 === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }
    res.end();
}

// ============================================================
// Optimized Implementation (Time-based yielding)
// ============================================================

async function optimizedStreamHandler(res, provider, model, requestBody) {
    const stream = provider.generateContentStream(model, requestBody);
    let lastYieldTime = Date.now();
    const YIELD_THRESHOLD_MS = 50;

    // Use cork/uncork for batching
    if (res.socket?.cork) {
        res.socket.cork();
    }

    let batchCount = 0;
    const BATCH_SIZE = 5;

    for await (const chunk of stream) {
        const serialized = JSON.stringify(chunk);
        res.write(`data: ${serialized}\n\n`);
        batchCount++;

        // Uncork after batch size reached
        if (batchCount >= BATCH_SIZE && res.socket?.uncork) {
            res.socket.uncork();
            res.socket.cork();
            batchCount = 0;
        }

        // Time-based yielding instead of chunk-count based
        const now = Date.now();
        if (now - lastYieldTime > YIELD_THRESHOLD_MS) {
            await new Promise(resolve => setImmediate(resolve));
            lastYieldTime = now;
        }
    }

    if (res.socket?.uncork) {
        res.socket.uncork();
    }
    res.end();
}

// ============================================================
// Test Functions
// ============================================================

/**
 * Test 1: Basic CPU measurement for single stream
 */
async function testSingleStreamCpu() {
    console.log('\n=== Test 1: Single Stream CPU Measurement ===\n');

    const provider = new MockStreamProvider({
        chunkCount: 100,
        chunkDelay: 0,
        chunkSize: 50
    });

    const benchmark = new StreamingCpuBenchmark();

    // Test baseline
    const baselineStats = await benchmark.runBenchmark(
        async () => {
            const mockRes = new MockResponse();
            await baselineStreamHandler(mockRes, provider, 'test-model', {});
        },
        { name: 'Baseline (setImmediate/10)', iterations: TEST_CONFIG.benchmarkIterations }
    );

    // Test optimized
    const optimizedStats = await benchmark.runBenchmark(
        async () => {
            const mockRes = new MockResponse();
            await optimizedStreamHandler(mockRes, provider, 'test-model', {});
        },
        { name: 'Optimized (time-based)', iterations: TEST_CONFIG.benchmarkIterations }
    );

    console.log(benchmark.formatReport());

    const improvement = ((baselineStats.cpu.avg - optimizedStats.cpu.avg) / baselineStats.cpu.avg * 100).toFixed(2);
    console.log(`\nCPU Improvement: ${improvement}%`);

    return { baselineStats, optimizedStats };
}

/**
 * Test 2: Concurrent streams performance
 */
async function testConcurrentStreams() {
    console.log('\n=== Test 2: Concurrent Streams Performance ===\n');

    // Test with baseline handler
    console.log('Testing baseline implementation...');
    const baselineResult = await runConcurrentStreamTest({
        concurrency: TEST_CONFIG.concurrency,
        chunksPerStream: TEST_CONFIG.chunksPerStream,
        chunkDelay: 0,
        streamHandler: baselineStreamHandler
    });

    console.log('\nBaseline Results:');
    console.log(formatTestReport(baselineResult));

    // Test with optimized handler
    console.log('\n\nTesting optimized implementation...');
    const optimizedResult = await runConcurrentStreamTest({
        concurrency: TEST_CONFIG.concurrency,
        chunksPerStream: TEST_CONFIG.chunksPerStream,
        chunkDelay: 0,
        streamHandler: optimizedStreamHandler
    });

    console.log('\nOptimized Results:');
    console.log(formatTestReport(optimizedResult));

    // Compare
    const cpuImprovement = ((baselineResult.cpuTotalMs - optimizedResult.cpuTotalMs) / baselineResult.cpuTotalMs * 100).toFixed(2);
    const wallTimeImprovement = ((baselineResult.wallTimeMs - optimizedResult.wallTimeMs) / baselineResult.wallTimeMs * 100).toFixed(2);

    console.log('\n=== Comparison ===');
    console.log(`CPU Time Improvement: ${cpuImprovement}%`);
    console.log(`Wall Time Improvement: ${wallTimeImprovement}%`);

    return { baselineResult, optimizedResult };
}

/**
 * Test 3: Stress test with high concurrency
 */
async function testStressLoad() {
    console.log('\n=== Test 3: Stress Test (High Concurrency) ===\n');

    const result = await runConcurrentStreamTest({
        concurrency: TEST_CONFIG.stressConcurrency,
        chunksPerStream: TEST_CONFIG.stressChunksPerStream,
        chunkDelay: 0,
        streamHandler: optimizedStreamHandler
    });

    console.log(formatTestReport(result));

    // Check against thresholds
    console.log('\n--- Threshold Check ---');
    if (result.cpuPerChunk > PERFORMANCE_THRESHOLDS.maxCpuPerChunk) {
        console.log(`❌ CPU per chunk ${result.cpuPerChunk.toFixed(4)}ms exceeds threshold ${PERFORMANCE_THRESHOLDS.maxCpuPerChunk}ms`);
    } else {
        console.log(`✓ CPU per chunk ${result.cpuPerChunk.toFixed(4)}ms within threshold`);
    }

    if (result.memoryDelta > PERFORMANCE_THRESHOLDS.maxMemoryGrowth) {
        console.log(`❌ Memory growth ${(result.memoryDelta / 1024 / 1024).toFixed(2)}MB exceeds threshold`);
    } else {
        console.log(`✓ Memory growth ${(result.memoryDelta / 1024 / 1024).toFixed(2)}MB within threshold`);
    }

    return result;
}

/**
 * Test 4: Performance regression test
 */
async function testPerformanceRegression() {
    console.log('\n=== Test 4: Performance Regression Test ===\n');

    const result = await runPerformanceRegressionTest({
        concurrency: TEST_CONFIG.concurrency,
        chunksPerStream: TEST_CONFIG.chunksPerStream
    });

    if (result.passed) {
        console.log('✓ All performance thresholds passed');
    } else {
        console.log('❌ Performance regression detected:');
        result.failures.forEach(f => console.log(`  - ${f}`));
    }

    if (result.warnings.length > 0) {
        console.log('\nWarnings:');
        result.warnings.forEach(w => console.log(`  ⚠ ${w}`));
    }

    console.log('\nMetrics:');
    console.log(`  CPU per chunk: ${result.metrics.cpuPerChunk.toFixed(4)}ms`);
    console.log(`  Throughput: ${result.metrics.throughput.toFixed(2)} chunks/sec`);
    console.log(`  Memory delta: ${(result.metrics.memoryDelta / 1024).toFixed(2)}KB`);

    return result;
}

/**
 * Test 5: JSON serialization overhead
 */
async function testJsonSerializationOverhead() {
    console.log('\n=== Test 5: JSON Serialization Overhead ===\n');

    const provider = new MockStreamProvider({
        chunkCount: 1000,
        chunkDelay: 0,
        chunkSize: 100
    });

    // Collect chunks first
    const chunks = [];
    for await (const chunk of provider.generateContentStream('test', {})) {
        chunks.push(chunk);
    }

    // Measure serialization time
    const serializationResult = await measureCpuUsage(async () => {
        for (const chunk of chunks) {
            JSON.stringify(chunk);
        }
    });

    console.log(`Serializing ${chunks.length} chunks:`);
    console.log(`  CPU time: ${serializationResult.cpuTotal.toFixed(2)}ms`);
    console.log(`  Wall time: ${serializationResult.wallTime.toFixed(2)}ms`);
    console.log(`  Per chunk: ${(serializationResult.cpuTotal / chunks.length).toFixed(4)}ms`);

    // Test with caching (for repeated structures)
    const cache = new Map();
    const cachedSerializationResult = await measureCpuUsage(async () => {
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            // Simulate caching for stop chunks (which are identical)
            const cacheKey = chunk.candidates?.[0]?.finishReason === 'STOP' ? 'stop' : null;
            if (cacheKey && cache.has(cacheKey)) {
                cache.get(cacheKey); // Use cached value
            } else {
                const serialized = JSON.stringify(chunk);
                if (cacheKey) {
                    cache.set(cacheKey, serialized);
                }
            }
        }
    });

    console.log(`\nWith caching:`);
    console.log(`  CPU time: ${cachedSerializationResult.cpuTotal.toFixed(2)}ms`);
    console.log(`  Improvement: ${((serializationResult.cpuTotal - cachedSerializationResult.cpuTotal) / serializationResult.cpuTotal * 100).toFixed(2)}%`);

    return { serializationResult, cachedSerializationResult };
}

// ============================================================
// Main Entry Point
// ============================================================

async function runAllTests() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     Streaming CPU Performance Test Suite                    ║');
    console.log('║     Run with: node --expose-gc tests/reproduce_streaming_cpu.js ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    if (!global.gc) {
        console.log('\n⚠ Warning: Running without --expose-gc flag. Memory measurements may be less accurate.\n');
    }

    const results = {};

    try {
        results.singleStream = await testSingleStreamCpu();
        results.concurrent = await testConcurrentStreams();
        results.stress = await testStressLoad();
        results.regression = await testPerformanceRegression();
        results.serialization = await testJsonSerializationOverhead();

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                    Test Summary                             ║');
        console.log('╚════════════════════════════════════════════════════════════╝');

        console.log('\nAll tests completed.');
        console.log(`Regression test: ${results.regression.passed ? '✓ PASSED' : '❌ FAILED'}`);

        if (results.concurrent.baselineResult && results.concurrent.optimizedResult) {
            const cpuImprovement = ((results.concurrent.baselineResult.cpuTotalMs - results.concurrent.optimizedResult.cpuTotalMs) / results.concurrent.baselineResult.cpuTotalMs * 100).toFixed(2);
            console.log(`Overall CPU improvement: ${cpuImprovement}%`);
        }

    } catch (error) {
        console.error('\n❌ Test failed with error:', error);
        process.exit(1);
    }

    return results;
}

// Run tests if executed directly
runAllTests().catch(console.error);
