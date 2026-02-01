/**
 * Fiddler Data Integration Tests
 * Tests using real captured HTTP session data from Fiddler
 */

import { describe, test, expect } from '@jest/globals';
import {
    loadFiddlerData,
    getClaudeSessions,
    parseRequestBody,
    getSessionByModel,
    getAllParsedSessions,
    createMockRequest,
    getTestFixtures
} from './mocks/fiddler-data-loader.js';

describe('Fiddler Data Loader', () => {
    test('loads fiddler export data', () => {
        const data = loadFiddlerData();
        expect(data).toBeDefined();
        expect(data.sessions).toBeInstanceOf(Array);
        expect(data.count).toBeGreaterThan(0);
    });

    test('filters Claude API sessions', () => {
        const sessions = getClaudeSessions();
        expect(sessions.length).toBeGreaterThan(0);
        sessions.forEach(session => {
            expect(session.url).toContain('/messages');
        });
    });

    test('parses base64 encoded request body', () => {
        const sessions = getClaudeSessions();
        const body = parseRequestBody(sessions[0]);
        expect(body).toBeDefined();
        expect(body.model).toBeDefined();
        expect(body.stream).toBe(true);
        expect(body.messages).toBeInstanceOf(Array);
    });

    test('gets session by model pattern', () => {
        const result = getSessionByModel('haiku');
        expect(result).not.toBeNull();
        expect(result.requestBody.model).toContain('haiku');
    });

    test('gets all parsed sessions', () => {
        const sessions = getAllParsedSessions();
        expect(sessions.length).toBeGreaterThan(0);
        sessions.forEach(({ session, requestBody, metadata }) => {
            expect(session).toBeDefined();
            expect(requestBody).toBeDefined();
            expect(metadata.sseEventCount).toBeGreaterThanOrEqual(0);
        });
    });

    test('creates mock request from session', () => {
        const sessions = getClaudeSessions();
        const mockReq = createMockRequest(sessions[0]);
        expect(mockReq.method).toBe('POST');
        expect(mockReq.url).toContain('/messages');
        expect(mockReq.headers).toBeDefined();
        expect(mockReq.body).toBeDefined();
    });

    test('provides test fixtures by scenario', () => {
        const fixtures = getTestFixtures();
        expect(fixtures.small).toBeDefined();
        expect(fixtures.haiku).toBeDefined();
        expect(fixtures.sonnet).toBeDefined();
        expect(fixtures.all.length).toBeGreaterThan(0);
    });
});

describe('Real Request Data Validation', () => {
    test('request bodies have valid Claude API structure', () => {
        const sessions = getAllParsedSessions();
        sessions.forEach(({ requestBody }) => {
            // Required fields
            expect(requestBody.model).toBeDefined();
            expect(requestBody.messages).toBeInstanceOf(Array);
            expect(requestBody.messages.length).toBeGreaterThan(0);

            // Stream should be true for SSE
            expect(requestBody.stream).toBe(true);

            // Max tokens should be set
            expect(requestBody.max_tokens).toBeGreaterThan(0);
        });
    });

    test('messages have valid structure', () => {
        const sessions = getAllParsedSessions();
        sessions.forEach(({ requestBody }) => {
            requestBody.messages.forEach(msg => {
                expect(['user', 'assistant', 'system']).toContain(msg.role);
                expect(msg.content).toBeDefined();
            });
        });
    });

    test('authorization headers are redacted', () => {
        const sessions = getClaudeSessions();
        sessions.forEach(session => {
            const auth = session.request.headers.authorization;
            if (auth) {
                expect(auth).toBe('Bearer [REDACTED]');
            }
        });
    });

    test('sessions have timing metadata', () => {
        const sessions = getAllParsedSessions();
        sessions.forEach(({ metadata }) => {
            expect(typeof metadata.durationMs).toBe('number');
            expect(typeof metadata.sseEventCount).toBe('number');
            expect(typeof metadata.isSSE).toBe('boolean');
        });
    });
});

describe('Test Fixtures Usage Examples', () => {
    test('small fixture for quick tests', () => {
        const { small } = getTestFixtures();
        expect(small.metadata.sseEventCount).toBeLessThan(50);
    });

    test('large fixture for stress tests', () => {
        const { large } = getTestFixtures();
        if (large) {
            expect(large.metadata.sseEventCount).toBeGreaterThanOrEqual(500);
        }
    });

    test('model-specific fixtures', () => {
        const { haiku, sonnet } = getTestFixtures();

        expect(haiku.requestBody.model).toContain('haiku');
        expect(sonnet.requestBody.model).toContain('sonnet');
    });
});
