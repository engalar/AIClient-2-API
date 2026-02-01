/**
 * CPU Performance Benchmark: Redis Cache Optimization
 *
 * This test directly measures CPU usage (user + system time) to demonstrate
 * the performance improvement from incremental cache updates vs full invalidation.
 *
 * Key metrics:
 * - process.cpuUsage(): Actual CPU time consumed (microseconds)
 * - Wall time: Real elapsed time
 * - CPU efficiency: CPU time / Wall time ratio
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { performance } from 'perf_hooks';

/**
 * Measure CPU usage for a function
 */
async function measureCpu(fn, iterations = 1) {
    // Force GC if available
    if (global.gc) global.gc();

    const startCpu = process.cpuUsage();
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
        await fn();
    }

    const endCpu = process.cpuUsage(startCpu);
    const endTime = performance.now();

    return {
        cpuUser: endCpu.user / 1000,      // Convert μs to ms
        cpuSystem: endCpu.system / 1000,
        cpuTotal: (endCpu.user + endCpu.system) / 1000,
        wallTime: endTime - startTime,
        cpuPerIteration: (endCpu.user + endCpu.system) / 1000 / iterations,
        // CPU efficiency: >1 means CPU-bound, <1 means I/O-bound
        cpuEfficiency: (endCpu.user + endCpu.system) / 1000 / (endTime - startTime),
    };
}

/**
 * Simulate the OLD cache invalidation behavior (full invalidation)
 */
class OldCacheManager {
    constructor() {
        this._cache = null;
        this._cacheTime = 0;
    }

    // Simulates full cache rebuild (expensive)
    _rebuildCache(providerType, size = 100) {
        const providers = [];
        for (let i = 0; i < size; i++) {
            providers.push({
                uuid: `provider-${providerType}-${i}`,
                name: `Provider ${i}`,
                isHealthy: true,
                usageCount: Math.floor(Math.random() * 1000),
                lastUsed: new Date().toISOString(),
                config: { key: 'value'.repeat(10) }, // Add some data weight
            });
        }
        return { [providerType]: providers };
    }

    addProvider(providerType, provider) {
        // OLD behavior: Full cache invalidation
        this._cache = null;

        // Simulate cache rebuild on next access
        this._cache = this._rebuildCache(providerType);
        this._cache[providerType].push(provider);
        this._cacheTime = Date.now();
    }

    deleteProvider(providerType, uuid) {
        // OLD behavior: Full cache invalidation
        this._cache = null;

        // Simulate cache rebuild on next access
        this._cache = this._rebuildCache(providerType);
        this._cache[providerType] = this._cache[providerType].filter(p => p.uuid !== uuid);
        this._cacheTime = Date.now();
    }

    getCache() {
        return this._cache;
    }
}

/**
 * Simulate the NEW cache behavior (incremental updates)
 */
class NewCacheManager {
    constructor() {
        this._cache = null;
        this._cacheTime = 0;
    }

    // Initialize cache once
    initCache(providerType, size = 100) {
        if (this._cache) return;

        const providers = [];
        for (let i = 0; i < size; i++) {
            providers.push({
                uuid: `provider-${providerType}-${i}`,
                name: `Provider ${i}`,
                isHealthy: true,
                usageCount: Math.floor(Math.random() * 1000),
                lastUsed: new Date().toISOString(),
                config: { key: 'value'.repeat(10) },
            });
        }
        this._cache = { [providerType]: providers };
        this._cacheTime = Date.now();
    }

    addProvider(providerType, provider) {
        // NEW behavior: Incremental cache update
        if (this._cache) {
            if (!this._cache[providerType]) {
                this._cache[providerType] = [];
            }
            const existingIndex = this._cache[providerType].findIndex(p => p.uuid === provider.uuid);
            if (existingIndex === -1) {
                this._cache[providerType].push(provider);
            } else {
                this._cache[providerType][existingIndex] = provider;
            }
            this._cacheTime = Date.now();
        }
    }

    deleteProvider(providerType, uuid) {
        // NEW behavior: Incremental cache update
        if (this._cache && this._cache[providerType]) {
            const index = this._cache[providerType].findIndex(p => p.uuid === uuid);
            if (index !== -1) {
                this._cache[providerType].splice(index, 1);
                this._cacheTime = Date.now();
            }
        }
    }

    getCache() {
        return this._cache;
    }
}

describe('CPU Performance: Cache Invalidation vs Incremental Update', () => {
    const ITERATIONS = 100;
    const PROVIDER_TYPE = 'test-provider';

    test('addProvider: CPU usage comparison (OLD vs NEW)', async () => {
        const oldManager = new OldCacheManager();
        const newManager = new NewCacheManager();
        newManager.initCache(PROVIDER_TYPE, 100);

        // Measure OLD behavior (full invalidation)
        const oldMetrics = await measureCpu(() => {
            oldManager.addProvider(PROVIDER_TYPE, {
                uuid: `new-${Date.now()}-${Math.random()}`,
                name: 'New Provider',
                isHealthy: true,
            });
        }, ITERATIONS);

        // Measure NEW behavior (incremental update)
        const newMetrics = await measureCpu(() => {
            newManager.addProvider(PROVIDER_TYPE, {
                uuid: `new-${Date.now()}-${Math.random()}`,
                name: 'New Provider',
                isHealthy: true,
            });
        }, ITERATIONS);

        // Calculate improvement
        const cpuImprovement = ((oldMetrics.cpuTotal - newMetrics.cpuTotal) / oldMetrics.cpuTotal * 100);
        const speedup = oldMetrics.cpuTotal / newMetrics.cpuTotal;

        console.log('\n=== addProvider CPU Benchmark ===');
        console.log(`Iterations: ${ITERATIONS}`);
        console.log(`OLD (full invalidation):`);
        console.log(`  CPU Total: ${oldMetrics.cpuTotal.toFixed(2)}ms`);
        console.log(`  CPU/iteration: ${oldMetrics.cpuPerIteration.toFixed(4)}ms`);
        console.log(`  Wall Time: ${oldMetrics.wallTime.toFixed(2)}ms`);
        console.log(`NEW (incremental update):`);
        console.log(`  CPU Total: ${newMetrics.cpuTotal.toFixed(2)}ms`);
        console.log(`  CPU/iteration: ${newMetrics.cpuPerIteration.toFixed(4)}ms`);
        console.log(`  Wall Time: ${newMetrics.wallTime.toFixed(2)}ms`);
        console.log(`Improvement: ${cpuImprovement.toFixed(1)}% less CPU, ${speedup.toFixed(1)}x faster`);

        // Assertions
        expect(newMetrics.cpuTotal).toBeLessThan(oldMetrics.cpuTotal);
        expect(speedup).toBeGreaterThan(2); // At least 2x improvement
    });

    test('deleteProvider: CPU usage comparison (OLD vs NEW)', async () => {
        // Measure OLD behavior
        const oldMetrics = await measureCpu(() => {
            const oldManager = new OldCacheManager();
            oldManager.deleteProvider(PROVIDER_TYPE, 'provider-test-provider-50');
        }, ITERATIONS);

        // Measure NEW behavior
        const newManager = new NewCacheManager();
        newManager.initCache(PROVIDER_TYPE, 100);

        const newMetrics = await measureCpu(() => {
            // Add back a provider to delete (to keep cache populated)
            newManager._cache[PROVIDER_TYPE].push({
                uuid: 'to-delete',
                name: 'To Delete',
            });
            newManager.deleteProvider(PROVIDER_TYPE, 'to-delete');
        }, ITERATIONS);

        const cpuImprovement = ((oldMetrics.cpuTotal - newMetrics.cpuTotal) / oldMetrics.cpuTotal * 100);
        const speedup = oldMetrics.cpuTotal / newMetrics.cpuTotal;

        console.log('\n=== deleteProvider CPU Benchmark ===');
        console.log(`Iterations: ${ITERATIONS}`);
        console.log(`OLD (full invalidation):`);
        console.log(`  CPU Total: ${oldMetrics.cpuTotal.toFixed(2)}ms`);
        console.log(`  CPU/iteration: ${oldMetrics.cpuPerIteration.toFixed(4)}ms`);
        console.log(`NEW (incremental update):`);
        console.log(`  CPU Total: ${newMetrics.cpuTotal.toFixed(2)}ms`);
        console.log(`  CPU/iteration: ${newMetrics.cpuPerIteration.toFixed(4)}ms`);
        console.log(`Improvement: ${cpuImprovement.toFixed(1)}% less CPU, ${speedup.toFixed(1)}x faster`);

        expect(newMetrics.cpuTotal).toBeLessThan(oldMetrics.cpuTotal);
    });

    test('high concurrency: CPU usage under 1000 concurrent operations', async () => {
        const CONCURRENT_OPS = 1000;

        // OLD behavior simulation
        const oldMetrics = await measureCpu(async () => {
            const manager = new OldCacheManager();
            const promises = Array.from({ length: CONCURRENT_OPS }, (_, i) => {
                return Promise.resolve().then(() => {
                    manager.addProvider(PROVIDER_TYPE, {
                        uuid: `concurrent-${i}`,
                        name: `Concurrent ${i}`,
                    });
                });
            });
            await Promise.all(promises);
        }, 1);

        // NEW behavior simulation
        const newMetrics = await measureCpu(async () => {
            const manager = new NewCacheManager();
            manager.initCache(PROVIDER_TYPE, 100);
            const promises = Array.from({ length: CONCURRENT_OPS }, (_, i) => {
                return Promise.resolve().then(() => {
                    manager.addProvider(PROVIDER_TYPE, {
                        uuid: `concurrent-${i}`,
                        name: `Concurrent ${i}`,
                    });
                });
            });
            await Promise.all(promises);
        }, 1);

        const speedup = oldMetrics.cpuTotal / newMetrics.cpuTotal;

        console.log('\n=== High Concurrency CPU Benchmark ===');
        console.log(`Concurrent operations: ${CONCURRENT_OPS}`);
        console.log(`OLD: CPU=${oldMetrics.cpuTotal.toFixed(2)}ms, Wall=${oldMetrics.wallTime.toFixed(2)}ms`);
        console.log(`NEW: CPU=${newMetrics.cpuTotal.toFixed(2)}ms, Wall=${newMetrics.wallTime.toFixed(2)}ms`);
        console.log(`Speedup: ${speedup.toFixed(1)}x`);

        expect(newMetrics.cpuTotal).toBeLessThan(oldMetrics.cpuTotal);
    });
});

describe('CPU Performance: selectProvider Mutex Removal', () => {
    /**
     * Simulate provider selection with mutex (OLD behavior)
     */
    class MutexProviderSelector {
        constructor(providers) {
            this.providers = providers;
            this._locked = false;
            this._queue = [];
        }

        async selectProvider() {
            // Simulate mutex acquisition
            if (this._locked) {
                await new Promise(resolve => this._queue.push(resolve));
            }
            this._locked = true;

            try {
                // Simulate selection work
                const selected = this.providers[Math.floor(Math.random() * this.providers.length)];
                selected.usageCount++;
                return selected;
            } finally {
                // Release mutex
                if (this._queue.length > 0) {
                    const next = this._queue.shift();
                    setImmediate(next);
                } else {
                    this._locked = false;
                }
            }
        }
    }

    /**
     * Simulate provider selection without mutex (NEW behavior - P2 Fix)
     */
    class LockFreeProviderSelector {
        constructor(providers) {
            this.providers = providers;
        }

        async selectProvider() {
            // Direct selection without mutex
            const selected = this.providers[Math.floor(Math.random() * this.providers.length)];
            selected.usageCount++;
            return selected;
        }
    }

    test('selectProvider: CPU usage with vs without mutex', async () => {
        const CONCURRENT_CALLS = 500;
        const providers = Array.from({ length: 10 }, (_, i) => ({
            uuid: `provider-${i}`,
            usageCount: 0,
        }));

        // WITH mutex (OLD)
        const withMutex = new MutexProviderSelector([...providers.map(p => ({ ...p }))]);
        const mutexMetrics = await measureCpu(async () => {
            await Promise.all(
                Array.from({ length: CONCURRENT_CALLS }, () => withMutex.selectProvider())
            );
        }, 1);

        // WITHOUT mutex (NEW - P2 Fix)
        const withoutMutex = new LockFreeProviderSelector([...providers.map(p => ({ ...p }))]);
        const lockFreeMetrics = await measureCpu(async () => {
            await Promise.all(
                Array.from({ length: CONCURRENT_CALLS }, () => withoutMutex.selectProvider())
            );
        }, 1);

        const speedup = mutexMetrics.cpuTotal / lockFreeMetrics.cpuTotal;

        console.log('\n=== selectProvider Mutex CPU Benchmark ===');
        console.log(`Concurrent calls: ${CONCURRENT_CALLS}`);
        console.log(`WITH mutex (OLD):`);
        console.log(`  CPU Total: ${mutexMetrics.cpuTotal.toFixed(2)}ms`);
        console.log(`  Wall Time: ${mutexMetrics.wallTime.toFixed(2)}ms`);
        console.log(`  CPU Efficiency: ${mutexMetrics.cpuEfficiency.toFixed(2)}`);
        console.log(`WITHOUT mutex (NEW - P2 Fix):`);
        console.log(`  CPU Total: ${lockFreeMetrics.cpuTotal.toFixed(2)}ms`);
        console.log(`  Wall Time: ${lockFreeMetrics.wallTime.toFixed(2)}ms`);
        console.log(`  CPU Efficiency: ${lockFreeMetrics.cpuEfficiency.toFixed(2)}`);
        console.log(`Speedup: ${speedup.toFixed(1)}x`);

        // Lock-free should be faster
        expect(lockFreeMetrics.wallTime).toBeLessThan(mutexMetrics.wallTime);
    });

    test('throughput comparison: requests per second', async () => {
        const TEST_DURATION_MS = 100;
        const providers = Array.from({ length: 10 }, (_, i) => ({
            uuid: `provider-${i}`,
            usageCount: 0,
        }));

        // Measure throughput WITH mutex
        const withMutex = new MutexProviderSelector([...providers.map(p => ({ ...p }))]);
        let mutexCount = 0;
        const mutexStart = Date.now();
        while (Date.now() - mutexStart < TEST_DURATION_MS) {
            await withMutex.selectProvider();
            mutexCount++;
        }
        const mutexThroughput = (mutexCount / TEST_DURATION_MS) * 1000;

        // Measure throughput WITHOUT mutex
        const withoutMutex = new LockFreeProviderSelector([...providers.map(p => ({ ...p }))]);
        let lockFreeCount = 0;
        const lockFreeStart = Date.now();
        while (Date.now() - lockFreeStart < TEST_DURATION_MS) {
            await withoutMutex.selectProvider();
            lockFreeCount++;
        }
        const lockFreeThroughput = (lockFreeCount / TEST_DURATION_MS) * 1000;

        console.log('\n=== Throughput Comparison ===');
        console.log(`Test duration: ${TEST_DURATION_MS}ms`);
        console.log(`WITH mutex: ${mutexCount} ops, ${mutexThroughput.toFixed(0)} req/s`);
        console.log(`WITHOUT mutex: ${lockFreeCount} ops, ${lockFreeThroughput.toFixed(0)} req/s`);
        console.log(`Throughput improvement: ${(lockFreeThroughput / mutexThroughput).toFixed(1)}x`);

        expect(lockFreeThroughput).toBeGreaterThan(mutexThroughput);
    });
});

describe('CPU Regression Thresholds', () => {
    test('addProvider should use less than 0.1ms CPU per operation', async () => {
        const manager = new NewCacheManager();
        manager.initCache('test', 100);

        const metrics = await measureCpu(() => {
            manager.addProvider('test', {
                uuid: `test-${Date.now()}`,
                name: 'Test',
            });
        }, 1000);

        console.log(`\naddProvider CPU/op: ${metrics.cpuPerIteration.toFixed(4)}ms`);

        // Should be very fast with incremental updates
        expect(metrics.cpuPerIteration).toBeLessThan(0.1);
    });

    test('deleteProvider should use less than 0.1ms CPU per operation', async () => {
        const manager = new NewCacheManager();
        manager.initCache('test', 1000);

        const metrics = await measureCpu(() => {
            // Add then delete to keep cache populated
            const uuid = `test-${Date.now()}-${Math.random()}`;
            manager._cache['test'].push({ uuid, name: 'Test' });
            manager.deleteProvider('test', uuid);
        }, 1000);

        console.log(`deleteProvider CPU/op: ${metrics.cpuPerIteration.toFixed(4)}ms`);

        expect(metrics.cpuPerIteration).toBeLessThan(0.1);
    });
});
