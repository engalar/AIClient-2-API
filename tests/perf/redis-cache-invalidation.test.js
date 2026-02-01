/**
 * TDD Test: Redis Cache Invalidation Storm Fix
 *
 * Purpose: Verify that addProvider() and deleteProvider() use incremental
 * cache updates instead of full cache invalidation to prevent cache stampede.
 *
 * Problem:
 * - addProvider() and deleteProvider() set this._poolsCache = null
 * - This causes getProviderPools() to trigger Redis keys() scan on next call
 * - Under high concurrency, this creates a "cache stampede" effect
 *
 * Solution:
 * - Use incremental cache updates (like incrementUsage() already does)
 * - Add new provider to cache instead of invalidating
 * - Remove provider from cache instead of invalidating
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

describe('Redis Cache Invalidation Storm Fix', () => {
    let RedisConfigManager;
    let manager;
    let mockRedisClient;
    let mockRedisManager;

    beforeEach(async () => {
        jest.resetModules();

        // Mock Redis client
        mockRedisClient = {
            hgetall: jest.fn(),
            hget: jest.fn(),
            hset: jest.fn(),
            hdel: jest.fn(),
            del: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
            sadd: jest.fn(),
            srem: jest.fn(),
            smembers: jest.fn().mockResolvedValue(['test-provider']),
            keys: jest.fn().mockResolvedValue([]),
            multi: jest.fn(() => ({
                hset: jest.fn().mockReturnThis(),
                sadd: jest.fn().mockReturnThis(),
                del: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([])
            })),
            defineCommand: jest.fn(),
            atomicProviderUpdate: jest.fn().mockResolvedValue(1),
        };

        mockRedisManager = {
            getClient: () => mockRedisClient,
            isConnected: () => true,
            onConnect: jest.fn(),
            onDisconnect: jest.fn(),
            setQueuedWrites: jest.fn(),
        };

        // Import the module
        const module = await import('../../src/core/redis-config-manager.js');
        RedisConfigManager = module.RedisConfigManager || module.default;

        manager = new RedisConfigManager(mockRedisManager, {
            cacheMaxAge: 30000,
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('addProvider() cache behavior', () => {
        test('should NOT invalidate entire cache when adding a provider', async () => {
            // Pre-populate cache with existing providers
            const existingProviders = [
                { uuid: 'existing-1', name: 'Provider 1', isHealthy: true },
                { uuid: 'existing-2', name: 'Provider 2', isHealthy: true },
            ];

            manager._poolsCache = {
                'test-provider': existingProviders,
                'other-provider': [{ uuid: 'other-1', name: 'Other' }],
            };
            manager._poolsCacheTime = Date.now();

            // Add a new provider
            const newProvider = { uuid: 'new-provider', name: 'New Provider', isHealthy: true };
            await manager.addProvider('test-provider', newProvider);

            // Cache should NOT be null (incremental update)
            expect(manager._poolsCache).not.toBeNull();

            // Other provider type should still be cached
            expect(manager._poolsCache['other-provider']).toBeDefined();
            expect(manager._poolsCache['other-provider'].length).toBe(1);

            // New provider should be added to cache
            expect(manager._poolsCache['test-provider']).toBeDefined();
            expect(manager._poolsCache['test-provider'].some(p => p.uuid === 'new-provider')).toBe(true);

            // Existing providers should still be in cache
            expect(manager._poolsCache['test-provider'].some(p => p.uuid === 'existing-1')).toBe(true);
            expect(manager._poolsCache['test-provider'].some(p => p.uuid === 'existing-2')).toBe(true);
        });

        test('should create cache entry if provider type does not exist', async () => {
            // Start with empty cache
            manager._poolsCache = {};
            manager._poolsCacheTime = Date.now();

            const newProvider = { uuid: 'first-provider', name: 'First', isHealthy: true };
            await manager.addProvider('new-type', newProvider);

            // Cache should have the new type
            expect(manager._poolsCache['new-type']).toBeDefined();
            expect(manager._poolsCache['new-type'].length).toBe(1);
            expect(manager._poolsCache['new-type'][0].uuid).toBe('first-provider');
        });

        test('should handle null cache gracefully', async () => {
            // Start with null cache
            manager._poolsCache = null;

            const newProvider = { uuid: 'provider-1', name: 'Provider', isHealthy: true };
            await manager.addProvider('test-provider', newProvider);

            // Should initialize cache with the new provider
            expect(manager._poolsCache).not.toBeNull();
            expect(manager._poolsCache['test-provider']).toBeDefined();
        });
    });

    describe('deleteProvider() cache behavior', () => {
        test('should NOT invalidate entire cache when deleting a provider', async () => {
            // Pre-populate cache
            manager._poolsCache = {
                'test-provider': [
                    { uuid: 'provider-1', name: 'Provider 1' },
                    { uuid: 'provider-2', name: 'Provider 2' },
                    { uuid: 'provider-3', name: 'Provider 3' },
                ],
                'other-provider': [{ uuid: 'other-1', name: 'Other' }],
            };
            manager._poolsCacheTime = Date.now();

            // Delete a provider
            await manager.deleteProvider('test-provider', 'provider-2');

            // Cache should NOT be null
            expect(manager._poolsCache).not.toBeNull();

            // Other provider type should still be cached
            expect(manager._poolsCache['other-provider']).toBeDefined();

            // Deleted provider should be removed from cache
            expect(manager._poolsCache['test-provider'].some(p => p.uuid === 'provider-2')).toBe(false);

            // Other providers should still be in cache
            expect(manager._poolsCache['test-provider'].some(p => p.uuid === 'provider-1')).toBe(true);
            expect(manager._poolsCache['test-provider'].some(p => p.uuid === 'provider-3')).toBe(true);
        });

        test('should handle deleting non-existent provider gracefully', async () => {
            manager._poolsCache = {
                'test-provider': [{ uuid: 'provider-1', name: 'Provider 1' }],
            };
            manager._poolsCacheTime = Date.now();

            // Delete non-existent provider
            await manager.deleteProvider('test-provider', 'non-existent');

            // Cache should still be intact
            expect(manager._poolsCache).not.toBeNull();
            expect(manager._poolsCache['test-provider'].length).toBe(1);
        });

        test('should handle null cache gracefully', async () => {
            manager._poolsCache = null;

            // Should not throw
            await expect(manager.deleteProvider('test-provider', 'provider-1')).resolves.not.toThrow();
        });
    });

    describe('cache stampede prevention', () => {
        test('concurrent addProvider calls should not trigger multiple cache rebuilds', async () => {
            // Pre-populate cache
            manager._poolsCache = {
                'test-provider': [{ uuid: 'existing', name: 'Existing' }],
            };
            manager._poolsCacheTime = Date.now();

            // Simulate concurrent adds
            const providers = Array.from({ length: 10 }, (_, i) => ({
                uuid: `concurrent-${i}`,
                name: `Concurrent ${i}`,
                isHealthy: true,
            }));

            await Promise.all(
                providers.map(p => manager.addProvider('test-provider', p))
            );

            // Cache should still be valid (not null)
            expect(manager._poolsCache).not.toBeNull();

            // All providers should be in cache
            expect(manager._poolsCache['test-provider'].length).toBe(11); // 1 existing + 10 new
        });

        test('getProviderPools should NOT call keys() if cache is valid', async () => {
            // Pre-populate cache
            manager._poolsCache = {
                'test-provider': [{ uuid: 'cached', name: 'Cached' }],
            };
            manager._poolsCacheTime = Date.now();

            // Call getProviderPools
            const result = await manager.getProviderPools();

            // Should return cached data
            expect(result).toEqual(manager._poolsCache);

            // keys() should NOT be called (cache hit)
            expect(mockRedisClient.keys).not.toHaveBeenCalled();
        });

        test('getProviderPools should call smembers (not keys) when cache is stale', async () => {
            // Set stale cache
            manager._poolsCache = null;
            manager._poolsCacheTime = 0;

            // Setup mock for smembers
            mockRedisClient.smembers.mockResolvedValue(['test-provider']);
            mockRedisClient.hgetall.mockResolvedValue({
                'provider-1': JSON.stringify({ uuid: 'provider-1', name: 'Provider 1' }),
            });

            await manager.getProviderPools();

            // Should use smembers (O(M)) instead of keys (O(N))
            expect(mockRedisClient.smembers).toHaveBeenCalled();
        });
    });

    describe('incrementUsage() reference implementation', () => {
        test('incrementUsage should update cache incrementally (existing P0 Fix)', async () => {
            // Pre-populate cache
            manager._poolsCache = {
                'test-provider': [
                    { uuid: 'provider-1', usageCount: 5, lastUsed: null },
                ],
            };
            manager._poolsCacheTime = Date.now();

            // Mock the atomic update
            mockRedisClient.atomicUsageUpdate = jest.fn().mockResolvedValue(6);

            await manager.incrementUsage('test-provider', 'provider-1');

            // Cache should NOT be null
            expect(manager._poolsCache).not.toBeNull();

            // Usage count should be incremented in cache
            const provider = manager._poolsCache['test-provider'].find(p => p.uuid === 'provider-1');
            expect(provider.usageCount).toBe(6);
            expect(provider.lastUsed).not.toBeNull();
        });
    });
});

describe('Performance comparison: cache invalidation vs incremental update', () => {
    test('incremental update should be faster than full invalidation', async () => {
        // This test demonstrates the performance difference conceptually
        const ITERATIONS = 1000;

        // Simulate full cache invalidation
        let cache = { providers: Array.from({ length: 100 }, (_, i) => ({ id: i })) };
        const invalidationStart = Date.now();
        for (let i = 0; i < ITERATIONS; i++) {
            cache = null; // Full invalidation
            cache = { providers: Array.from({ length: 100 }, (_, j) => ({ id: j })) }; // Rebuild
        }
        const invalidationTime = Date.now() - invalidationStart;

        // Simulate incremental update
        cache = { providers: Array.from({ length: 100 }, (_, i) => ({ id: i })) };
        const incrementalStart = Date.now();
        for (let i = 0; i < ITERATIONS; i++) {
            cache.providers.push({ id: 100 + i }); // Incremental add
        }
        const incrementalTime = Date.now() - incrementalStart;

        console.log(`[Performance] Full invalidation: ${invalidationTime}ms, Incremental: ${incrementalTime}ms`);

        // Incremental should be faster
        expect(incrementalTime).toBeLessThan(invalidationTime);
    });
});
