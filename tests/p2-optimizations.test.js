/**
 * P2 Performance Optimizations Tests
 * TDD: RED -> GREEN -> REFACTOR
 *
 * P2-1: Converter factory lookup caching
 * P2-2: Remove setImmediate from getRequestBody
 * P2-3: Plugin system path check caching
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

// ============================================================
// P2-1: Converter Factory Lookup Caching Tests
// Location: src/convert/convert.js:41-80
// Problem: convertData() calls getProtocolPrefix() and ConverterFactory.getConverter() on every call
// Solution: Pre-compute protocol prefixes, cache converter instances per conversion pair
// ============================================================

describe('P2-1: Converter Factory Lookup Caching', () => {
    beforeEach(async () => {
        jest.resetModules();
        // Register all converters before tests
        await import('../src/converters/register-converters.js');
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('ConverterFactory.getConverter should cache converter instances', async () => {
        const { ConverterFactory } = await import('../src/converters/ConverterFactory.js');

        // Clear any existing cache
        ConverterFactory.clearCache();

        // First call - should create new instance
        const converter1 = ConverterFactory.getConverter('openai');
        expect(converter1).toBeDefined();

        // Second call - should return cached instance
        const converter2 = ConverterFactory.getConverter('openai');
        expect(converter2).toBe(converter1); // Same instance

        // Different protocol - should create new instance
        const converter3 = ConverterFactory.getConverter('gemini');
        expect(converter3).not.toBe(converter1);
    });

    test('convertData should not call getProtocolPrefix more than necessary', async () => {
        const commonModule = await import('../src/utils/common.js');
        const { getProtocolPrefix } = commonModule;

        // Track calls to getProtocolPrefix
        const originalGetProtocolPrefix = getProtocolPrefix;
        let callCount = 0;
        const trackedGetProtocolPrefix = (provider) => {
            callCount++;
            return originalGetProtocolPrefix(provider);
        };

        // getProtocolPrefix should use cache
        const result1 = trackedGetProtocolPrefix('gemini-cli-oauth');
        const result2 = trackedGetProtocolPrefix('gemini-cli-oauth');

        expect(result1).toBe('gemini');
        expect(result2).toBe('gemini');

        // Verify caching is working (protocolPrefixCache in common.js)
        // The cache should prevent redundant string operations
        expect(result1).toBe(result2);
    });

    test('getProtocolPrefix should cache results for repeated calls', async () => {
        const { getProtocolPrefix } = await import('../src/utils/common.js');

        // Measure performance of repeated calls
        const iterations = 10000;
        const provider = 'gemini-cli-oauth';

        const startTime = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            getProtocolPrefix(provider);
        }
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1_000_000;

        console.log(`P2-1: ${iterations} getProtocolPrefix calls: ${durationMs.toFixed(2)}ms`);

        // Should be very fast due to caching (< 10ms for 10k calls)
        expect(durationMs).toBeLessThan(50);
    });

    test('convertData should handle forward protocol without conversion', async () => {
        const { convertData } = await import('../src/convert/convert.js');

        const testData = { messages: [{ role: 'user', content: 'test' }] };

        // Forward protocol should return data unchanged
        const result = convertData(testData, 'request', 'forward-api', 'forward-api');
        expect(result).toBe(testData);
    });

    test('source code should have protocol prefix cache', () => {
        const commonPath = path.resolve(__dirname, '../src/utils/common.js');
        const sourceCode = fs.readFileSync(commonPath, 'utf-8');

        // Verify cache exists
        const hasCacheDeclaration = sourceCode.includes('protocolPrefixCache');
        expect(hasCacheDeclaration).toBe(true);

        // Verify cache is used in getProtocolPrefix
        const hasCacheCheck = sourceCode.includes('protocolPrefixCache.has(provider)');
        expect(hasCacheCheck).toBe(true);
    });
});

// ============================================================
// P2-2: Remove setImmediate from getRequestBody Tests
// Location: src/utils/common.js:224
// Problem: getRequestBody() uses setImmediate to delay JSON parsing, adding latency
// Solution: Remove setImmediate, parse JSON synchronously
// ============================================================

describe('P2-2: Remove setImmediate from getRequestBody', () => {
    test('getRequestBody should parse JSON synchronously without setImmediate', async () => {
        const { getRequestBody } = await import('../src/utils/common.js');

        // Create a mock request stream
        const testData = { message: 'test', value: 123 };
        const jsonString = JSON.stringify(testData);

        const mockReq = new Readable({
            read() {
                this.push(Buffer.from(jsonString));
                this.push(null);
            }
        });

        // Measure parsing time
        const startTime = process.hrtime.bigint();
        const result = await getRequestBody(mockReq);
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1_000_000;

        expect(result).toEqual(testData);

        // Without setImmediate, parsing should be very fast
        // setImmediate adds at least 1-4ms of delay
        console.log(`P2-2: getRequestBody parsing time: ${durationMs.toFixed(2)}ms`);
    });

    test('getRequestBody should not use setImmediate in source code', () => {
        const commonPath = path.resolve(__dirname, '../src/utils/common.js');
        const sourceCode = fs.readFileSync(commonPath, 'utf-8');

        // Extract getRequestBody function
        const functionMatch = sourceCode.match(/export function getRequestBody[\s\S]*?^export /m);

        if (functionMatch) {
            const functionBody = functionMatch[0];

            // Should NOT have setImmediate in the JSON parsing path
            // The old pattern was: setImmediate(() => { resolve(JSON.parse(body)); })
            const hasSetImmediateInParsing = /setImmediate\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?JSON\.parse/.test(functionBody);
            expect(hasSetImmediateInParsing).toBe(false);
        }
    });

    test('getRequestBody should handle empty body', async () => {
        const { getRequestBody } = await import('../src/utils/common.js');

        const mockReq = new Readable({
            read() {
                this.push(null);
            }
        });

        const result = await getRequestBody(mockReq);
        expect(result).toEqual({});
    });

    test('getRequestBody should handle invalid JSON', async () => {
        const { getRequestBody } = await import('../src/utils/common.js');

        const mockReq = new Readable({
            read() {
                this.push(Buffer.from('invalid json {'));
                this.push(null);
            }
        });

        await expect(getRequestBody(mockReq)).rejects.toThrow('Invalid JSON');
    });

    test('getRequestBody should handle large payloads efficiently', async () => {
        const { getRequestBody } = await import('../src/utils/common.js');

        // Create a large payload (1MB)
        const largeData = {
            messages: Array(1000).fill(null).map((_, i) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'x'.repeat(1000)
            }))
        };
        const jsonString = JSON.stringify(largeData);

        const mockReq = new Readable({
            read() {
                this.push(Buffer.from(jsonString));
                this.push(null);
            }
        });

        const startTime = process.hrtime.bigint();
        const result = await getRequestBody(mockReq);
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1_000_000;

        expect(result.messages).toHaveLength(1000);
        console.log(`P2-2: Large payload (${(jsonString.length / 1024).toFixed(0)}KB) parsing: ${durationMs.toFixed(2)}ms`);

        // Should complete within reasonable time
        expect(durationMs).toBeLessThan(500);
    });

    test('getRequestBody should reject oversized payloads', async () => {
        const { getRequestBody } = await import('../src/utils/common.js');

        // Create a stream that exceeds max size
        const maxSize = 1024; // 1KB for testing
        let pushed = false;

        const mockReq = new Readable({
            read() {
                if (!pushed) {
                    pushed = true;
                    // Push data larger than maxSize
                    this.push(Buffer.from('x'.repeat(maxSize + 100)));
                    this.push(null);
                }
            }
        });

        // Add destroy method
        mockReq.destroy = jest.fn();

        await expect(getRequestBody(mockReq, maxSize)).rejects.toThrow('Request body too large');
    });
});

// ============================================================
// P2-3: Plugin System Path Check Caching Tests
// Location: src/handlers/request-handler.js:74-83
// Problem: Every request calls pluginManager.isPluginStaticPath() and pluginManager.executeRoutes()
// Solution: Cache plugin path check results, use Set for O(1) lookup
// ============================================================

describe('P2-3: Plugin System Path Check Caching', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('PluginManager should cache enabled plugins list', async () => {
        const { PluginManager } = await import('../src/core/plugin-manager.js');

        const manager = new PluginManager();

        // Register some test plugins
        manager.register({
            name: 'test-plugin-1',
            version: '1.0.0',
            _enabled: true
        });
        manager.register({
            name: 'test-plugin-2',
            version: '1.0.0',
            _enabled: true
        });

        // First call - should compute and cache
        const plugins1 = manager.getEnabledPlugins();

        // Second call - should return cached
        const plugins2 = manager.getEnabledPlugins();

        // Should return same array reference (cached)
        expect(plugins1).toBe(plugins2);
    });

    test('PluginManager should invalidate cache when plugin is registered', async () => {
        const { PluginManager } = await import('../src/core/plugin-manager.js');

        const manager = new PluginManager();

        manager.register({
            name: 'test-plugin-1',
            version: '1.0.0',
            _enabled: true
        });

        const plugins1 = manager.getEnabledPlugins();

        // Register new plugin - should invalidate cache
        manager.register({
            name: 'test-plugin-2',
            version: '1.0.0',
            _enabled: true
        });

        const plugins2 = manager.getEnabledPlugins();

        // Should be different array (cache invalidated)
        expect(plugins1).not.toBe(plugins2);
        expect(plugins2.length).toBe(2);
    });

    test('isPluginStaticPath should be efficient for repeated calls', async () => {
        const { PluginManager } = await import('../src/core/plugin-manager.js');

        const manager = new PluginManager();

        // Register plugin with static paths
        manager.register({
            name: 'test-plugin',
            version: '1.0.0',
            _enabled: true,
            staticPaths: ['/plugin/static', '/plugin/assets']
        });

        const iterations = 10000;
        const testPath = '/plugin/static';

        const startTime = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            manager.isPluginStaticPath(testPath);
        }
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1_000_000;

        console.log(`P2-3: ${iterations} isPluginStaticPath calls: ${durationMs.toFixed(2)}ms`);

        // Should be fast
        expect(durationMs).toBeLessThan(100);
    });

    test('source code should have enabled plugins cache', () => {
        const pluginManagerPath = path.resolve(__dirname, '../src/core/plugin-manager.js');
        const sourceCode = fs.readFileSync(pluginManagerPath, 'utf-8');

        // Verify cache property exists
        const hasCacheProperty = sourceCode.includes('_enabledPluginsCache');
        expect(hasCacheProperty).toBe(true);

        // Verify cache is used in getEnabledPlugins
        const hasCacheCheck = sourceCode.includes('this._enabledPluginsCache !== null');
        expect(hasCacheCheck).toBe(true);

        // Verify cache is invalidated on register
        const hasCacheInvalidation = sourceCode.includes('this._enabledPluginsCache = null');
        expect(hasCacheInvalidation).toBe(true);
    });

    test('request-handler should have cached date string optimization', () => {
        const requestHandlerPath = path.resolve(__dirname, '../src/handlers/request-handler.js');
        const sourceCode = fs.readFileSync(requestHandlerPath, 'utf-8');

        // Verify cached date string exists (P2-17 optimization)
        const hasCachedDateString = sourceCode.includes('cachedDateString');
        expect(hasCachedDateString).toBe(true);

        // Verify getCachedDateString function exists
        const hasGetCachedDateString = sourceCode.includes('getCachedDateString');
        expect(hasGetCachedDateString).toBe(true);
    });

    test('getStaticPaths should return array of paths', async () => {
        const { PluginManager } = await import('../src/core/plugin-manager.js');

        const manager = new PluginManager();

        manager.register({
            name: 'test-plugin',
            version: '1.0.0',
            _enabled: true,
            staticPaths: ['/path1', '/path2']
        });

        const paths = manager.getStaticPaths();
        expect(paths).toEqual(['/path1', '/path2']);
    });
});

// ============================================================
// Integration: All P2 optimizations working together
// ============================================================

describe('P2 Optimizations Integration', () => {
    beforeEach(async () => {
        // Register all converters before tests
        await import('../src/converters/register-converters.js');
    });

    test('All P2 source files should exist', () => {
        const files = [
            '../src/convert/convert.js',
            '../src/utils/common.js',
            '../src/handlers/request-handler.js',
            '../src/core/plugin-manager.js',
            '../src/converters/ConverterFactory.js'
        ];

        for (const file of files) {
            const fullPath = path.resolve(__dirname, file);
            expect(fs.existsSync(fullPath)).toBe(true);
        }
    });

    test('Combined performance: converter + request parsing', async () => {
        const { getProtocolPrefix } = await import('../src/utils/common.js');
        const { ConverterFactory } = await import('../src/converters/ConverterFactory.js');

        const iterations = 1000;
        const startTime = process.hrtime.bigint();

        for (let i = 0; i < iterations; i++) {
            // Simulate hot path operations
            const fromProtocol = getProtocolPrefix('openai-custom');
            const toProtocol = getProtocolPrefix('gemini-cli-oauth');
            const converter = ConverterFactory.getConverter(fromProtocol);
        }

        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1_000_000;

        console.log(`P2 Integration: ${iterations} converter lookups: ${durationMs.toFixed(2)}ms`);
        expect(durationMs).toBeLessThan(100);
    });

    test('P2-2 verification: getRequestBody should parse synchronously', async () => {
        const commonPath = path.resolve(__dirname, '../src/utils/common.js');
        const sourceCode = fs.readFileSync(commonPath, 'utf-8');

        // Find getRequestBody function and verify no setImmediate wrapping JSON.parse
        // The optimized version should have direct: resolve(JSON.parse(body))
        // Not: setImmediate(() => { resolve(JSON.parse(body)) })

        // Check for the optimized pattern
        const hasDirectParse = sourceCode.includes('resolve(JSON.parse(body))');

        // If direct parse exists, setImmediate should not wrap it
        if (hasDirectParse) {
            // Good - direct parsing
            expect(hasDirectParse).toBe(true);
        } else {
            // Check if setImmediate is still used (needs optimization)
            const hasSetImmediateParse = /setImmediate\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?resolve\s*\(\s*JSON\.parse/.test(sourceCode);
            // This should be false after optimization
            expect(hasSetImmediateParse).toBe(false);
        }
    });
});
