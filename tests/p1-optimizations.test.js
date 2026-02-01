/**
 * P1 Performance Optimizations Tests
 * TDD: RED -> GREEN -> REFACTOR
 *
 * P1-1: Global log level control
 * P1-2: Date object reuse in markProviderError
 * P1-3: Redis cache TTL optimization
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// P1-1: Global Log Level Control Tests
// ============================================================

describe('P1-1: Global Log Level Control', () => {
    let originalEnv;
    let consoleLogSpy;
    let consoleWarnSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        originalEnv = process.env.LOG_LEVEL;
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.LOG_LEVEL = originalEnv;
        } else {
            delete process.env.LOG_LEVEL;
        }
        jest.restoreAllMocks();
        jest.resetModules();
    });

    describe('Logger utility', () => {
        test('should export a logger with level-based methods', async () => {
            const { Logger } = await import('../src/utils/logger.js');
            expect(Logger).toBeDefined();
            expect(typeof Logger.debug).toBe('function');
            expect(typeof Logger.info).toBe('function');
            expect(typeof Logger.warn).toBe('function');
            expect(typeof Logger.error).toBe('function');
        });

        test('should respect LOG_LEVEL=error environment variable', async () => {
            process.env.LOG_LEVEL = 'error';
            jest.resetModules();
            const { Logger } = await import('../src/utils/logger.js');

            Logger.debug('debug message');
            Logger.info('info message');
            Logger.warn('warn message');
            Logger.error('error message');

            // Only error should be logged
            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });

        test('should respect LOG_LEVEL=warn environment variable', async () => {
            process.env.LOG_LEVEL = 'warn';
            jest.resetModules();
            const { Logger } = await import('../src/utils/logger.js');

            Logger.debug('debug message');
            Logger.info('info message');
            Logger.warn('warn message');
            Logger.error('error message');

            // warn and error should be logged
            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });

        test('should default to info level when LOG_LEVEL not set', async () => {
            delete process.env.LOG_LEVEL;
            jest.resetModules();
            const { Logger } = await import('../src/utils/logger.js');

            Logger.debug('debug message');
            Logger.info('info message');
            Logger.warn('warn message');
            Logger.error('error message');

            // info, warn, error should be logged (debug excluded)
            expect(consoleLogSpy).toHaveBeenCalledTimes(1); // info uses console.log
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });

        test('should support lazy evaluation with function messages', async () => {
            process.env.LOG_LEVEL = 'error';
            jest.resetModules();
            const { Logger } = await import('../src/utils/logger.js');

            const expensiveComputation = jest.fn(() => 'expensive result');

            Logger.debug(() => expensiveComputation());
            Logger.info(() => expensiveComputation());

            // Function should NOT be called when log level is higher
            expect(expensiveComputation).not.toHaveBeenCalled();
        });

        test('should call lazy function only when log level matches', async () => {
            process.env.LOG_LEVEL = 'debug';
            jest.resetModules();
            const { Logger } = await import('../src/utils/logger.js');

            const expensiveComputation = jest.fn(() => 'expensive result');

            Logger.debug(() => expensiveComputation());

            // Function SHOULD be called when log level matches
            expect(expensiveComputation).toHaveBeenCalledTimes(1);
        });

        test('should support setLevel method for runtime level changes', async () => {
            delete process.env.LOG_LEVEL;
            jest.resetModules();
            const { Logger } = await import('../src/utils/logger.js');

            // Default is info
            Logger.info('should log');
            expect(consoleLogSpy).toHaveBeenCalledTimes(1);

            // Change to error
            Logger.setLevel('error');
            consoleLogSpy.mockClear();

            Logger.info('should not log');
            expect(consoleLogSpy).not.toHaveBeenCalled();

            Logger.error('should log');
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });

        test('should export LOG_LEVELS constant', async () => {
            const { LOG_LEVELS } = await import('../src/utils/logger.js');
            expect(LOG_LEVELS).toEqual({
                debug: 0,
                info: 1,
                warn: 2,
                error: 3
            });
        });
    });
});

// ============================================================
// P1-2: Date Object Reuse Tests (Source Code Verification)
// ============================================================

describe('P1-2: Date Object Reuse in markProviderError', () => {
    const providerPoolManagerPath = path.resolve(__dirname, '../src/providers/provider-pool-manager.js');

    test('markProviderUnhealthy should reuse timestamp variable', () => {
        const sourceCode = fs.readFileSync(providerPoolManagerPath, 'utf-8');

        // Find the markProviderUnhealthy method and check for timestamp reuse pattern
        // Pattern: const timestamp = new Date().toISOString();
        // Then: provider.config.lastErrorTime = timestamp;
        // And: provider.config.lastUsed = timestamp;

        // Check that we have the timestamp variable pattern
        const hasTimestampVariable = sourceCode.includes('const timestamp = new Date().toISOString()');
        expect(hasTimestampVariable).toBe(true);

        // Check that lastErrorTime uses the timestamp variable
        const hasLastErrorTimeAssignment = sourceCode.includes('provider.config.lastErrorTime = timestamp');
        expect(hasLastErrorTimeAssignment).toBe(true);

        // Check that lastUsed uses the timestamp variable
        const hasLastUsedAssignment = sourceCode.includes('provider.config.lastUsed = timestamp');
        expect(hasLastUsedAssignment).toBe(true);
    });

    test('should NOT have consecutive new Date().toISOString() calls for same fields', () => {
        const sourceCode = fs.readFileSync(providerPoolManagerPath, 'utf-8');

        // This pattern is BAD - two consecutive Date creations for related fields
        // provider.config.lastErrorTime = new Date().toISOString();
        // provider.config.lastUsed = new Date().toISOString();
        const badPattern = /provider\.config\.lastErrorTime\s*=\s*new Date\(\)\.toISOString\(\);\s*[\r\n\s]*(?:\/\/[^\n]*\n\s*)?provider\.config\.lastUsed\s*=\s*new Date\(\)\.toISOString\(\)/;

        const hasBadPattern = badPattern.test(sourceCode);
        expect(hasBadPattern).toBe(false);
    });

    test('markProviderUnhealthyImmediately should also reuse timestamp', () => {
        const sourceCode = fs.readFileSync(providerPoolManagerPath, 'utf-8');

        // Extract the markProviderUnhealthyImmediately method
        const methodMatch = sourceCode.match(/markProviderUnhealthyImmediately\s*\([^)]*\)\s*\{[\s\S]*?^\s{4}\}/m);

        if (methodMatch) {
            const methodBody = methodMatch[0];
            // Should have timestamp reuse pattern
            const hasTimestampReuse = methodBody.includes('const timestamp = new Date().toISOString()');
            expect(hasTimestampReuse).toBe(true);
        }
    });

    test('markProviderUnhealthyWithRecoveryTime should also reuse timestamp', () => {
        const sourceCode = fs.readFileSync(providerPoolManagerPath, 'utf-8');

        // Extract the markProviderUnhealthyWithRecoveryTime method
        const methodMatch = sourceCode.match(/markProviderUnhealthyWithRecoveryTime\s*\([^)]*\)\s*\{[\s\S]*?^\s{4}\}/m);

        if (methodMatch) {
            const methodBody = methodMatch[0];
            // Should have timestamp reuse pattern
            const hasTimestampReuse = methodBody.includes('const timestamp = new Date().toISOString()');
            expect(hasTimestampReuse).toBe(true);
        }
    });
});

// ============================================================
// P1-3: Redis Cache TTL Optimization Tests (Source Code Verification)
// ============================================================

describe('P1-3: Redis Cache TTL Optimization', () => {
    const redisConfigManagerPath = path.resolve(__dirname, '../src/core/redis-config-manager.js');

    test('should have cache TTL of 30 seconds (30000ms) as default', () => {
        const sourceCode = fs.readFileSync(redisConfigManagerPath, 'utf-8');

        // Check for the new default value
        // Pattern: this._cacheMaxAge = options.cacheMaxAge ?? 30000;
        const has30SecondDefault = sourceCode.includes('30000');
        expect(has30SecondDefault).toBe(true);

        // Should NOT have the old 5000ms default as the only value
        const hasOld5SecondOnly = /this\._cacheMaxAge\s*=\s*5000\s*;/.test(sourceCode);
        expect(hasOld5SecondOnly).toBe(false);
    });

    test('should allow cache TTL to be configured via options', () => {
        const sourceCode = fs.readFileSync(redisConfigManagerPath, 'utf-8');

        // Check for options.cacheMaxAge pattern
        const hasOptionsPattern = sourceCode.includes('options.cacheMaxAge');
        expect(hasOptionsPattern).toBe(true);
    });

    test('should use nullish coalescing for default value', () => {
        const sourceCode = fs.readFileSync(redisConfigManagerPath, 'utf-8');

        // Pattern: options.cacheMaxAge ?? 30000
        const hasNullishCoalescing = /options\.cacheMaxAge\s*\?\?\s*30000/.test(sourceCode);
        expect(hasNullishCoalescing).toBe(true);
    });

    test('should have P1-3 comment documenting the change', () => {
        const sourceCode = fs.readFileSync(redisConfigManagerPath, 'utf-8');

        // Check for documentation comment
        const hasP1Comment = sourceCode.includes('P1-3');
        expect(hasP1Comment).toBe(true);
    });
});

// ============================================================
// Integration: All P1 optimizations working together
// ============================================================

describe('P1 Optimizations Integration', () => {
    test('Logger should be importable and functional', async () => {
        const { Logger } = await import('../src/utils/logger.js');
        expect(Logger).toBeDefined();

        // Should not throw
        expect(() => {
            Logger.info('Integration test message');
        }).not.toThrow();
    });

    test('All P1 source files should exist', () => {
        const files = [
            '../src/utils/logger.js',
            '../src/providers/provider-pool-manager.js',
            '../src/core/redis-config-manager.js'
        ];

        for (const file of files) {
            const fullPath = path.resolve(__dirname, file);
            expect(fs.existsSync(fullPath)).toBe(true);
        }
    });
});
