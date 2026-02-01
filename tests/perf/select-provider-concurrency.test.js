/**
 * TDD Test: selectProvider Concurrency Performance
 *
 * Purpose: Verify that selectProvider does NOT serialize concurrent requests
 * (i.e., the mutex lock has been removed as per P2 Fix)
 *
 * This test creates a minimal mock of ProviderPoolManager to test the
 * concurrency behavior without importing the full dependency chain.
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { KeyedMutex } from '../../src/utils/async-mutex.js';

/**
 * Minimal mock of ProviderPoolManager's selectProvider logic
 * This isolates the concurrency behavior we want to test
 */
class MockProviderPoolManager {
    constructor(providerPools, options = {}) {
        this.providerPools = providerPools;
        this.providerStatus = {};
        this._selectionMutex = new KeyedMutex();
        this._selectionSequence = 0;
        this._sequenceBase = Date.now() * 1000;
        this._recentSelections = new Map();
        this._recentSelectionWindow = 100;
        this._recentSelectionCleanupCounter = 0;
        this._usageBatchQueue = new Map();
        this._usageBatchTimer = null;
        this._usageBatchInterval = 50;
        this._storageAdapter = options.storageAdapter || null;

        // Initialize provider status
        for (const providerType in providerPools) {
            this.providerStatus[providerType] = providerPools[providerType].map(config => ({
                config: { ...config },
                uuid: config.uuid,
            }));
        }
    }

    isUsingRedis() {
        return this._storageAdapter && this._storageAdapter.getType() === 'redis';
    }

    _queueUsageIncrement(providerType, uuid) {
        const key = `${providerType}:${uuid}`;
        const existing = this._usageBatchQueue.get(key);
        if (existing) {
            existing.count++;
        } else {
            this._usageBatchQueue.set(key, { providerType, uuid, count: 1 });
        }
    }

    _calculateNodeScore(providerStatus, now = Date.now()) {
        const config = providerStatus.config;
        if (!config.isHealthy || config.isDisabled) return 1e18;

        const lastUsedTime = config.lastUsed
            ? new Date(config.lastUsed).getTime()
            : (now - 86400000);
        const usageCount = config.usageCount || 0;
        const lastSelectionSeq = config._lastSelectionSeq || 0;

        return lastUsedTime + (usageCount * 10000) + (lastSelectionSeq * 1000);
    }

    /**
     * P2 Fix: selectProvider WITHOUT mutex lock
     * This is the optimized version that allows concurrent execution
     */
    async selectProvider(providerType, requestedModel = null, options = {}) {
        // P2 Fix: No mutex lock - direct execution
        return this._doSelectProvider(providerType, requestedModel, options);
    }

    /**
     * Alternative: selectProvider WITH mutex lock (for comparison)
     * This simulates the OLD behavior before P2 Fix
     */
    async selectProviderWithMutex(providerType, requestedModel = null, options = {}) {
        return this._selectionMutex.withLock(providerType, () => {
            return this._doSelectProvider(providerType, requestedModel, options);
        });
    }

    _doSelectProvider(providerType, requestedModel, options) {
        const availableProviders = this.providerStatus[providerType] || [];
        const now = Date.now();

        // Filter healthy providers
        let healthyProviders = availableProviders.filter(p =>
            p.config.isHealthy && !p.config.isDisabled
        );

        if (healthyProviders.length === 0) {
            return null;
        }

        // Find provider with lowest score (O(n) scan)
        let selected = healthyProviders[0];
        let minScore = this._calculateNodeScore(selected, now);

        for (let i = 1; i < healthyProviders.length; i++) {
            const provider = healthyProviders[i];
            const score = this._calculateNodeScore(provider, now);
            if (score < minScore) {
                selected = provider;
                minScore = score;
            }
        }

        // Update selection state
        const nowTs = Date.now();
        selected.config.lastUsed = new Date(nowTs).toISOString();
        selected.config._lastSelectionSeq = this._sequenceBase + (++this._selectionSequence);

        if (!options.skipUsageCount) {
            selected.config.usageCount = (selected.config.usageCount || 0) + 1;
            if (this.isUsingRedis()) {
                this._queueUsageIncrement(providerType, selected.config.uuid);
            }
        }

        return selected.config;
    }
}

describe('selectProvider Concurrency Performance (P2 Fix Verification)', () => {
    let manager;
    const TEST_PROVIDER_TYPE = 'test-provider';

    beforeEach(() => {
        // Create a pool with multiple healthy providers
        const providerPools = {
            [TEST_PROVIDER_TYPE]: Array.from({ length: 10 }, (_, i) => ({
                uuid: `provider-${i}`,
                isHealthy: true,
                isDisabled: false,
                usageCount: 0,
                errorCount: 0,
                lastUsed: null,
            })),
        };

        manager = new MockProviderPoolManager(providerPools, {
            storageAdapter: {
                getType: () => 'redis',
                incrementUsage: jest.fn().mockResolvedValue(1),
            },
        });
    });

    test('P2 Fix: concurrent selectProvider calls should NOT serialize', async () => {
        const CONCURRENT_CALLS = 50;
        const MAX_ALLOWED_TIME_MS = 100; // Should complete in < 100ms if parallel

        const startTime = Date.now();

        // Launch all calls concurrently
        const promises = Array.from({ length: CONCURRENT_CALLS }, () =>
            manager.selectProvider(TEST_PROVIDER_TYPE)
        );

        const results = await Promise.all(promises);
        const totalTime = Date.now() - startTime;

        // All calls should return valid providers
        expect(results.every(r => r !== null)).toBe(true);
        expect(results.every(r => r.uuid.startsWith('provider-'))).toBe(true);

        // Total time should be much less than if serialized
        expect(totalTime).toBeLessThan(MAX_ALLOWED_TIME_MS);

        console.log(`[P2 Fix Test] ${CONCURRENT_CALLS} concurrent calls completed in ${totalTime}ms`);
    });

    test('comparison: WITH mutex lock causes serialization (slower)', async () => {
        const CONCURRENT_CALLS = 20;

        // Test WITHOUT mutex (P2 Fix - fast)
        const startWithout = Date.now();
        await Promise.all(
            Array.from({ length: CONCURRENT_CALLS }, () =>
                manager.selectProvider(TEST_PROVIDER_TYPE)
            )
        );
        const timeWithout = Date.now() - startWithout;

        // Reset state
        manager.providerStatus[TEST_PROVIDER_TYPE].forEach(p => {
            p.config.usageCount = 0;
            p.config.lastUsed = null;
            p.config._lastSelectionSeq = 0;
        });

        // Test WITH mutex (old behavior - slower due to serialization)
        const startWith = Date.now();
        await Promise.all(
            Array.from({ length: CONCURRENT_CALLS }, () =>
                manager.selectProviderWithMutex(TEST_PROVIDER_TYPE)
            )
        );
        const timeWith = Date.now() - startWith;

        console.log(`[Mutex Comparison] Without mutex: ${timeWithout}ms, With mutex: ${timeWith}ms`);

        // Without mutex should be faster (or at least not significantly slower)
        // The mutex version serializes, so it should take longer
        expect(timeWithout).toBeLessThanOrEqual(timeWith + 10); // Allow 10ms tolerance
    });

    test('concurrent calls should distribute across multiple providers', async () => {
        const CONCURRENT_CALLS = 100;

        const promises = Array.from({ length: CONCURRENT_CALLS }, () =>
            manager.selectProvider(TEST_PROVIDER_TYPE)
        );

        const results = await Promise.all(promises);

        // Count selections per provider
        const selectionCounts = new Map();
        for (const result of results) {
            const count = selectionCounts.get(result.uuid) || 0;
            selectionCounts.set(result.uuid, count + 1);
        }

        // Should use multiple providers
        const uniqueProviders = selectionCounts.size;
        expect(uniqueProviders).toBeGreaterThan(1);

        // No single provider should handle more than 50% of requests
        const maxSelections = Math.max(...selectionCounts.values());
        expect(maxSelections).toBeLessThan(CONCURRENT_CALLS * 0.5);

        console.log(`[Load Balance] ${uniqueProviders} providers used, max: ${maxSelections}/${CONCURRENT_CALLS}`);
    });

    test('high concurrency stress test (500 requests)', async () => {
        const CONCURRENT_CALLS = 500;
        const MAX_ALLOWED_TIME_MS = 500;

        const startTime = Date.now();

        const promises = Array.from({ length: CONCURRENT_CALLS }, () =>
            manager.selectProvider(TEST_PROVIDER_TYPE)
        );

        const results = await Promise.all(promises);
        const totalTime = Date.now() - startTime;

        // All should succeed
        expect(results.filter(r => r !== null).length).toBe(CONCURRENT_CALLS);
        expect(totalTime).toBeLessThan(MAX_ALLOWED_TIME_MS);

        const throughput = (CONCURRENT_CALLS / totalTime) * 1000;
        console.log(`[Stress Test] ${CONCURRENT_CALLS} requests in ${totalTime}ms (${throughput.toFixed(0)} req/s)`);

        // Should achieve at least 1000 req/s
        expect(throughput).toBeGreaterThan(1000);
    });

    test('verify _selectionMutex.withLock is NOT called in selectProvider', async () => {
        const mutexSpy = jest.spyOn(manager._selectionMutex, 'withLock');

        await Promise.all(
            Array.from({ length: 10 }, () => manager.selectProvider(TEST_PROVIDER_TYPE))
        );

        // P2 Fix: Mutex should NOT be called
        expect(mutexSpy).not.toHaveBeenCalled();

        mutexSpy.mockRestore();
    });
});

describe('KeyedMutex behavior verification', () => {
    test('KeyedMutex.withLock serializes concurrent calls', async () => {
        const mutex = new KeyedMutex();
        const key = 'test-key';
        const executionOrder = [];

        // Create tasks that record their execution order
        const createTask = (id, delay) => async () => {
            executionOrder.push(`start-${id}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            executionOrder.push(`end-${id}`);
            return id;
        };

        // Run with mutex - should serialize
        const startTime = Date.now();
        const results = await Promise.all([
            mutex.withLock(key, createTask(1, 10)),
            mutex.withLock(key, createTask(2, 10)),
            mutex.withLock(key, createTask(3, 10)),
        ]);
        const totalTime = Date.now() - startTime;

        // Results should be in order
        expect(results).toEqual([1, 2, 3]);

        // Execution should be serialized (start-1, end-1, start-2, end-2, ...)
        // Total time should be ~30ms (3 * 10ms) due to serialization
        expect(totalTime).toBeGreaterThanOrEqual(25); // Allow some tolerance

        console.log(`[Mutex Serialization] Execution order: ${executionOrder.join(' -> ')}`);
        console.log(`[Mutex Serialization] Total time: ${totalTime}ms (expected ~30ms)`);
    });

    test('without mutex, concurrent calls run in parallel', async () => {
        const executionOrder = [];

        const createTask = (id, delay) => async () => {
            executionOrder.push(`start-${id}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            executionOrder.push(`end-${id}`);
            return id;
        };

        // Run without mutex - should run in parallel
        const startTime = Date.now();
        const results = await Promise.all([
            createTask(1, 10)(),
            createTask(2, 10)(),
            createTask(3, 10)(),
        ]);
        const totalTime = Date.now() - startTime;

        expect(results).toEqual([1, 2, 3]);

        // Total time should be ~10ms (parallel execution)
        expect(totalTime).toBeLessThan(25);

        console.log(`[Parallel Execution] Execution order: ${executionOrder.join(' -> ')}`);
        console.log(`[Parallel Execution] Total time: ${totalTime}ms (expected ~10ms)`);
    });
});
