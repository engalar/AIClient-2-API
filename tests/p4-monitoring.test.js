/**
 * P4 Performance Monitoring Tests
 * TDD: RED phase - Write tests first, then implement
 *
 * This module tests the performance monitoring system including:
 * - RequestMetrics: Request counting, latency histograms
 * - SystemMetrics: CPU, memory, event loop delay
 * - MetricsExporter: Prometheus format export
 * - API endpoint: GET /api/metrics
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Import the modules we will implement
import {
    RequestMetrics,
    SystemMetrics,
    MetricsExporter,
    MetricsCollector,
    resetAllMetrics
} from '../src/monitoring/index.js';

describe('P4 Performance Monitoring', () => {

    beforeEach(() => {
        // Reset all metrics before each test
        resetAllMetrics();
    });

    // ============================================
    // RequestMetrics Tests
    // ============================================
    describe('RequestMetrics', () => {

        describe('request counting', () => {
            test('should start with zero requests', () => {
                const metrics = RequestMetrics.getMetrics();
                expect(metrics.totalRequests).toBe(0);
            });

            test('should increment request count', () => {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                const metrics = RequestMetrics.getMetrics();
                expect(metrics.totalRequests).toBe(1);
            });

            test('should track requests by endpoint', () => {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordRequest('/v1/models', 'GET', 200);

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.byEndpoint['/v1/chat/completions']).toBe(2);
                expect(metrics.byEndpoint['/v1/models']).toBe(1);
            });

            test('should track requests by status code', () => {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 400);
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 500);

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.byStatusCode['200']).toBe(2);
                expect(metrics.byStatusCode['400']).toBe(1);
                expect(metrics.byStatusCode['500']).toBe(1);
            });

            test('should track requests by method', () => {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordRequest('/v1/models', 'GET', 200);
                RequestMetrics.recordRequest('/v1/models', 'GET', 200);

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.byMethod['POST']).toBe(1);
                expect(metrics.byMethod['GET']).toBe(2);
            });
        });

        describe('latency tracking', () => {
            test('should record request latency', () => {
                RequestMetrics.recordLatency('/v1/chat/completions', 150);
                RequestMetrics.recordLatency('/v1/chat/completions', 250);

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.latency.count).toBe(2);
                expect(metrics.latency.sum).toBe(400);
            });

            test('should calculate average latency', () => {
                RequestMetrics.recordLatency('/v1/chat/completions', 100);
                RequestMetrics.recordLatency('/v1/chat/completions', 200);
                RequestMetrics.recordLatency('/v1/chat/completions', 300);

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.latency.avg).toBe(200);
            });

            test('should track min and max latency', () => {
                RequestMetrics.recordLatency('/v1/chat/completions', 100);
                RequestMetrics.recordLatency('/v1/chat/completions', 500);
                RequestMetrics.recordLatency('/v1/chat/completions', 200);

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.latency.min).toBe(100);
                expect(metrics.latency.max).toBe(500);
            });

            test('should build latency histogram with buckets', () => {
                // Record latencies in different buckets
                RequestMetrics.recordLatency('/v1/chat/completions', 50);   // 0-100ms bucket
                RequestMetrics.recordLatency('/v1/chat/completions', 150);  // 100-250ms bucket
                RequestMetrics.recordLatency('/v1/chat/completions', 300);  // 250-500ms bucket
                RequestMetrics.recordLatency('/v1/chat/completions', 800);  // 500-1000ms bucket
                RequestMetrics.recordLatency('/v1/chat/completions', 1500); // 1000-2500ms bucket
                RequestMetrics.recordLatency('/v1/chat/completions', 3000); // 2500-5000ms bucket
                RequestMetrics.recordLatency('/v1/chat/completions', 6000); // 5000+ bucket

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.latency.histogram['100']).toBe(1);   // <= 100ms
                expect(metrics.latency.histogram['250']).toBe(1);   // <= 250ms
                expect(metrics.latency.histogram['500']).toBe(1);   // <= 500ms
                expect(metrics.latency.histogram['1000']).toBe(1);  // <= 1000ms
                expect(metrics.latency.histogram['2500']).toBe(1);  // <= 2500ms
                expect(metrics.latency.histogram['5000']).toBe(1);  // <= 5000ms
                expect(metrics.latency.histogram['+Inf']).toBe(1);  // > 5000ms
            });

            test('should calculate percentiles (p50, p90, p99)', () => {
                // Record 100 latencies from 1 to 100
                for (let i = 1; i <= 100; i++) {
                    RequestMetrics.recordLatency('/v1/chat/completions', i);
                }

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.latency.p50).toBeGreaterThanOrEqual(49);
                expect(metrics.latency.p50).toBeLessThanOrEqual(51);
                expect(metrics.latency.p90).toBeGreaterThanOrEqual(89);
                expect(metrics.latency.p90).toBeLessThanOrEqual(91);
                expect(metrics.latency.p99).toBeGreaterThanOrEqual(98);
                expect(metrics.latency.p99).toBeLessThanOrEqual(100);
            });
        });

        describe('throughput calculation', () => {
            test('should calculate requests per second', async () => {
                // Record 10 requests
                for (let i = 0; i < 10; i++) {
                    RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                }

                // Wait a bit to allow time window calculation
                await new Promise(resolve => setTimeout(resolve, 100));

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.throughput.requestsPerSecond).toBeGreaterThan(0);
            });
        });

        describe('error rate tracking', () => {
            test('should calculate error rate', () => {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 500);
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 502);

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.errorRate).toBe(0.5); // 2 errors out of 4 requests
            });

            test('should return 0 error rate when no requests', () => {
                const metrics = RequestMetrics.getMetrics();
                expect(metrics.errorRate).toBe(0);
            });
        });

        describe('active requests tracking', () => {
            test('should track active requests', () => {
                const requestId1 = RequestMetrics.startRequest('/v1/chat/completions', 'POST');
                const requestId2 = RequestMetrics.startRequest('/v1/chat/completions', 'POST');

                expect(RequestMetrics.getActiveRequests()).toBe(2);

                RequestMetrics.endRequest(requestId1, 200);
                expect(RequestMetrics.getActiveRequests()).toBe(1);

                RequestMetrics.endRequest(requestId2, 200);
                expect(RequestMetrics.getActiveRequests()).toBe(0);
            });
        });
    });

    // ============================================
    // SystemMetrics Tests
    // ============================================
    describe('SystemMetrics', () => {

        describe('memory metrics', () => {
            test('should return memory usage', () => {
                const metrics = SystemMetrics.getMetrics();

                expect(metrics.memory).toBeDefined();
                expect(metrics.memory.heapUsed).toBeGreaterThan(0);
                expect(metrics.memory.heapTotal).toBeGreaterThan(0);
                expect(metrics.memory.external).toBeGreaterThanOrEqual(0);
                expect(metrics.memory.rss).toBeGreaterThan(0);
            });

            test('should return memory in bytes', () => {
                const metrics = SystemMetrics.getMetrics();

                // Memory values should be reasonable (at least 1MB, less than 10GB)
                expect(metrics.memory.heapUsed).toBeGreaterThan(1024 * 1024);
                expect(metrics.memory.heapUsed).toBeLessThan(10 * 1024 * 1024 * 1024);
            });
        });

        describe('CPU metrics', () => {
            test('should return CPU usage', () => {
                const metrics = SystemMetrics.getMetrics();

                expect(metrics.cpu).toBeDefined();
                expect(metrics.cpu.user).toBeGreaterThanOrEqual(0);
                expect(metrics.cpu.system).toBeGreaterThanOrEqual(0);
            });

            test('should return CPU percentage', async () => {
                // Need to call twice to get delta
                SystemMetrics.getMetrics();
                await new Promise(resolve => setTimeout(resolve, 100));
                const metrics = SystemMetrics.getMetrics();

                expect(metrics.cpu.percentage).toBeGreaterThanOrEqual(0);
                expect(metrics.cpu.percentage).toBeLessThanOrEqual(100);
            });
        });

        describe('event loop metrics', () => {
            test('should return event loop delay', async () => {
                // Allow some time for event loop monitoring
                await new Promise(resolve => setTimeout(resolve, 100));

                const metrics = SystemMetrics.getMetrics();

                expect(metrics.eventLoop).toBeDefined();
                expect(metrics.eventLoop.delay).toBeGreaterThanOrEqual(0);
            });

            test('should track event loop lag', async () => {
                // Simulate some blocking work
                const start = Date.now();
                while (Date.now() - start < 50) {
                    // Busy wait to create lag
                }

                await new Promise(resolve => setTimeout(resolve, 100));

                const metrics = SystemMetrics.getMetrics();
                expect(metrics.eventLoop.lag).toBeGreaterThanOrEqual(0);
            });
        });

        describe('uptime metrics', () => {
            test('should return process uptime', () => {
                const metrics = SystemMetrics.getMetrics();

                expect(metrics.uptime).toBeDefined();
                expect(metrics.uptime).toBeGreaterThan(0);
            });
        });

        describe('system info', () => {
            test('should return system information', () => {
                const metrics = SystemMetrics.getMetrics();

                expect(metrics.system).toBeDefined();
                expect(metrics.system.platform).toBeDefined();
                expect(metrics.system.nodeVersion).toBeDefined();
                expect(metrics.system.cpuCount).toBeGreaterThan(0);
                expect(metrics.system.totalMemory).toBeGreaterThan(0);
            });
        });
    });

    // ============================================
    // MetricsExporter Tests
    // ============================================
    describe('MetricsExporter', () => {

        describe('Prometheus format', () => {
            test('should export metrics in Prometheus format', () => {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordLatency('/v1/chat/completions', 150);

                const output = MetricsExporter.toPrometheus();

                expect(output).toContain('# HELP');
                expect(output).toContain('# TYPE');
                expect(output).toContain('aiclient_http_requests_total');
            });

            test('should include request counter with labels', () => {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordRequest('/v1/models', 'GET', 200);

                const output = MetricsExporter.toPrometheus();

                expect(output).toContain('aiclient_http_requests_total{');
                expect(output).toContain('method="POST"');
                expect(output).toContain('method="GET"');
                expect(output).toContain('status="200"');
            });

            test('should include latency histogram', () => {
                RequestMetrics.recordLatency('/v1/chat/completions', 150);

                const output = MetricsExporter.toPrometheus();

                expect(output).toContain('aiclient_http_request_duration_ms');
                expect(output).toContain('le="100"');
                expect(output).toContain('le="250"');
                expect(output).toContain('le="+Inf"');
            });

            test('should include memory metrics', () => {
                const output = MetricsExporter.toPrometheus();

                expect(output).toContain('aiclient_memory_heap_used_bytes');
                expect(output).toContain('aiclient_memory_heap_total_bytes');
                expect(output).toContain('aiclient_memory_rss_bytes');
            });

            test('should include CPU metrics', () => {
                const output = MetricsExporter.toPrometheus();

                expect(output).toContain('aiclient_cpu_usage_percent');
            });

            test('should include event loop metrics', () => {
                const output = MetricsExporter.toPrometheus();

                expect(output).toContain('aiclient_eventloop_delay_ms');
            });

            test('should include uptime metric', () => {
                const output = MetricsExporter.toPrometheus();

                expect(output).toContain('aiclient_uptime_seconds');
            });
        });

        describe('JSON format', () => {
            test('should export metrics in JSON format', () => {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);

                const output = MetricsExporter.toJSON();

                expect(typeof output).toBe('object');
                expect(output.requests).toBeDefined();
                expect(output.system).toBeDefined();
                expect(output.timestamp).toBeDefined();
            });

            test('should include all metric categories', () => {
                const output = MetricsExporter.toJSON();

                expect(output.requests).toBeDefined();
                expect(output.system).toBeDefined();
                expect(output.system.memory).toBeDefined();
                expect(output.system.cpu).toBeDefined();
                expect(output.system.eventLoop).toBeDefined();
            });
        });
    });

    // ============================================
    // MetricsCollector Tests
    // ============================================
    describe('MetricsCollector', () => {

        test('should be a singleton', () => {
            const collector1 = MetricsCollector.getInstance();
            const collector2 = MetricsCollector.getInstance();

            expect(collector1).toBe(collector2);
        });

        test('should aggregate all metrics', () => {
            RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);

            const collector = MetricsCollector.getInstance();
            const allMetrics = collector.collect();

            expect(allMetrics.requests).toBeDefined();
            expect(allMetrics.system).toBeDefined();
        });

        test('should support custom metric registration', () => {
            const collector = MetricsCollector.getInstance();

            collector.registerCustomMetric('custom_counter', () => ({
                value: 42,
                type: 'counter',
                help: 'A custom counter'
            }));

            const allMetrics = collector.collect();
            expect(allMetrics.custom.custom_counter.value).toBe(42);
        });
    });

    // ============================================
    // Edge Cases and Error Handling
    // ============================================
    describe('Edge Cases', () => {

        test('should handle null/undefined endpoint gracefully', () => {
            expect(() => {
                RequestMetrics.recordRequest(null, 'POST', 200);
            }).not.toThrow();

            expect(() => {
                RequestMetrics.recordRequest(undefined, 'GET', 200);
            }).not.toThrow();
        });

        test('should handle negative latency gracefully', () => {
            expect(() => {
                RequestMetrics.recordLatency('/v1/chat/completions', -100);
            }).not.toThrow();

            const metrics = RequestMetrics.getMetrics();
            // Negative latency should be ignored or treated as 0
            expect(metrics.latency.min).toBeGreaterThanOrEqual(0);
        });

        test('should handle very large latency values', () => {
            expect(() => {
                RequestMetrics.recordLatency('/v1/chat/completions', Number.MAX_SAFE_INTEGER);
            }).not.toThrow();
        });

        test('should handle concurrent metric updates', async () => {
            const promises = [];
            for (let i = 0; i < 100; i++) {
                promises.push(
                    Promise.resolve().then(() => {
                        RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                        RequestMetrics.recordLatency('/v1/chat/completions', Math.random() * 1000);
                    })
                );
            }

            await Promise.all(promises);

            const metrics = RequestMetrics.getMetrics();
            expect(metrics.totalRequests).toBe(100);
            expect(metrics.latency.count).toBe(100);
        });

        test('should reset metrics correctly', () => {
            RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
            RequestMetrics.recordLatency('/v1/chat/completions', 150);

            resetAllMetrics();

            const metrics = RequestMetrics.getMetrics();
            expect(metrics.totalRequests).toBe(0);
            expect(metrics.latency.count).toBe(0);
        });
    });

    // ============================================
    // Code Review Fixes Tests
    // ============================================
    describe('Code Review Fixes', () => {

        describe('CRITICAL-1: Bounded latency storage', () => {
            test('should limit latency samples to MAX_LATENCY_SAMPLES', () => {
                // Record more than MAX_LATENCY_SAMPLES (10000) latencies
                for (let i = 0; i < 10100; i++) {
                    RequestMetrics.recordLatency('/v1/chat/completions', i);
                }

                const metrics = RequestMetrics.getMetrics();
                // Should be capped at 10000
                expect(metrics.latency.count).toBe(10000);
            });

            test('should maintain correct sum when sliding window removes old values', () => {
                // Fill to max
                for (let i = 0; i < 10000; i++) {
                    RequestMetrics.recordLatency('/v1/chat/completions', 100);
                }

                // Add more - should remove old ones
                for (let i = 0; i < 100; i++) {
                    RequestMetrics.recordLatency('/v1/chat/completions', 200);
                }

                const metrics = RequestMetrics.getMetrics();
                expect(metrics.latency.count).toBe(10000);
                // Sum should reflect the sliding window adjustment
                // 9900 * 100 + 100 * 200 = 990000 + 20000 = 1010000
                expect(metrics.latency.sum).toBe(1010000);
            });
        });

        describe('HIGH-2: Cached sorted latencies', () => {
            test('should return consistent percentiles on repeated calls', () => {
                for (let i = 1; i <= 100; i++) {
                    RequestMetrics.recordLatency('/v1/chat/completions', i);
                }

                const metrics1 = RequestMetrics.getMetrics();
                const metrics2 = RequestMetrics.getMetrics();

                expect(metrics1.latency.p50).toBe(metrics2.latency.p50);
                expect(metrics1.latency.p90).toBe(metrics2.latency.p90);
                expect(metrics1.latency.p99).toBe(metrics2.latency.p99);
            });

            test('should invalidate cache when new latency is recorded', () => {
                for (let i = 1; i <= 100; i++) {
                    RequestMetrics.recordLatency('/v1/chat/completions', i);
                }

                const metrics1 = RequestMetrics.getMetrics();

                // Add a very high latency
                RequestMetrics.recordLatency('/v1/chat/completions', 10000);

                const metrics2 = RequestMetrics.getMetrics();

                // p99 should change after adding high value
                expect(metrics2.latency.max).toBe(10000);
            });
        });

        describe('MEDIUM-5: Metric name validation', () => {
            test('should accept valid Prometheus metric names', () => {
                const collector = MetricsCollector.getInstance();

                expect(() => {
                    collector.registerCustomMetric('valid_metric', () => 1);
                }).not.toThrow();

                expect(() => {
                    collector.registerCustomMetric('valid:metric:name', () => 2);
                }).not.toThrow();

                expect(() => {
                    collector.registerCustomMetric('_private_metric', () => 3);
                }).not.toThrow();

                expect(() => {
                    collector.registerCustomMetric('metric123', () => 4);
                }).not.toThrow();
            });

            test('should reject invalid metric names', () => {
                const collector = MetricsCollector.getInstance();

                expect(() => {
                    collector.registerCustomMetric('123invalid', () => 1);
                }).toThrow(/Invalid metric name format/);

                expect(() => {
                    collector.registerCustomMetric('invalid-name', () => 2);
                }).toThrow(/Invalid metric name format/);

                expect(() => {
                    collector.registerCustomMetric('invalid.name', () => 3);
                }).toThrow(/Invalid metric name format/);

                expect(() => {
                    collector.registerCustomMetric('', () => 4);
                }).toThrow(/non-empty string/);

                expect(() => {
                    collector.registerCustomMetric(null, () => 5);
                }).toThrow(/non-empty string/);
            });
        });
    });

    // ============================================
    // Performance Tests
    // ============================================
    describe('Performance', () => {

        test('should record metrics with minimal overhead', () => {
            const iterations = 10000;
            const start = Date.now();

            for (let i = 0; i < iterations; i++) {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordLatency('/v1/chat/completions', 100);
            }

            const elapsed = Date.now() - start;
            const avgTimePerOp = elapsed / (iterations * 2);

            // Each operation should take less than 0.1ms on average
            expect(avgTimePerOp).toBeLessThan(0.1);
        });

        test('should export Prometheus format efficiently', () => {
            // Record many metrics
            for (let i = 0; i < 1000; i++) {
                RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
                RequestMetrics.recordLatency('/v1/chat/completions', Math.random() * 1000);
            }

            const start = Date.now();
            const output = MetricsExporter.toPrometheus();
            const elapsed = Date.now() - start;

            // Export should complete in less than 50ms
            expect(elapsed).toBeLessThan(50);
            expect(output.length).toBeGreaterThan(0);
        });
    });

    // ============================================
    // Metrics API Handler Tests
    // ============================================
    describe('Metrics API Handlers', () => {
        // Import API handlers
        let metricsApi;

        beforeEach(async () => {
            metricsApi = await import('../src/ui-modules/metrics-api.js');
        });

        test('handleGetMetrics should return Prometheus format', async () => {
            // Record some metrics first
            RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
            RequestMetrics.recordLatency('/v1/chat/completions', 150);

            // Mock request and response
            const req = {};
            const res = {
                writeHead: jest.fn(),
                end: jest.fn()
            };

            const result = await metricsApi.handleGetMetrics(req, res);

            expect(result).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
                'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
            }));
            expect(res.end).toHaveBeenCalled();

            // Verify the output contains Prometheus format
            const output = res.end.mock.calls[0][0];
            expect(output).toContain('# HELP');
            expect(output).toContain('aiclient_http_requests_total');
        });

        test('handleGetMetricsJSON should return JSON format', async () => {
            // Record some metrics first
            RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);

            // Mock request and response
            const req = {};
            const res = {
                writeHead: jest.fn(),
                end: jest.fn()
            };

            const result = await metricsApi.handleGetMetricsJSON(req, res);

            expect(result).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
                'Content-Type': 'application/json'
            }));
            expect(res.end).toHaveBeenCalled();

            // Verify the output is valid JSON
            const output = JSON.parse(res.end.mock.calls[0][0]);
            expect(output.requests).toBeDefined();
            expect(output.system).toBeDefined();
            expect(output.timestamp).toBeDefined();
        });

        test('handleResetMetrics should reset all metrics', async () => {
            // Record some metrics first
            RequestMetrics.recordRequest('/v1/chat/completions', 'POST', 200);
            RequestMetrics.recordLatency('/v1/chat/completions', 150);

            // Verify metrics exist
            let metrics = RequestMetrics.getMetrics();
            expect(metrics.totalRequests).toBe(1);

            // Mock request and response
            const req = {};
            const res = {
                writeHead: jest.fn(),
                end: jest.fn()
            };

            const result = await metricsApi.handleResetMetrics(req, res);

            expect(result).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });

            // Verify metrics are reset
            metrics = RequestMetrics.getMetrics();
            expect(metrics.totalRequests).toBe(0);
            expect(metrics.latency.count).toBe(0);
        });
    });
});
