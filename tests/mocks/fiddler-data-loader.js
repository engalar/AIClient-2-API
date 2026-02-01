/**
 * Fiddler Data Loader
 * Loads and processes real HTTP session data captured from Fiddler
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Load Fiddler export data
 * @returns {Object} Parsed Fiddler export data
 */
export function loadFiddlerData() {
    // Use process.cwd() based path for Jest compatibility
    const dataPath = join(process.cwd(), 'tests/mocks/fiddler-claude-sessions.json');
    const raw = readFileSync(dataPath, 'utf-8');
    return JSON.parse(raw);
}

/**
 * Get Claude API sessions from Fiddler data
 * @returns {Array} Array of Claude API session objects
 */
export function getClaudeSessions() {
    const data = loadFiddlerData();
    return data.sessions.filter(s => s.url.includes('/messages'));
}

/**
 * Parse request body from a session
 * @param {Object} session - Fiddler session object
 * @returns {Object} Parsed request body
 */
export function parseRequestBody(session) {
    if (!session.request?.body) return null;
    const decoded = Buffer.from(session.request.body, 'base64').toString('utf-8');
    return JSON.parse(decoded);
}

/**
 * Get session by model name
 * @param {string} modelPattern - Model name pattern to match
 * @returns {Object|null} First matching session or null
 */
export function getSessionByModel(modelPattern) {
    const sessions = getClaudeSessions();
    for (const session of sessions) {
        const body = parseRequestBody(session);
        if (body?.model?.includes(modelPattern)) {
            return { session, requestBody: body };
        }
    }
    return null;
}

/**
 * Get all sessions with parsed request bodies
 * @returns {Array} Array of {session, requestBody} objects
 */
export function getAllParsedSessions() {
    return getClaudeSessions().map(session => ({
        session,
        requestBody: parseRequestBody(session),
        metadata: {
            durationMs: session.durationMs,
            sseEventCount: session.sseEventCount,
            isSSE: session.isSSE
        }
    }));
}

/**
 * Create a mock request from Fiddler session data
 * @param {Object} session - Fiddler session object
 * @returns {Object} Mock request object for testing
 */
export function createMockRequest(session) {
    const body = parseRequestBody(session);
    return {
        method: session.method,
        url: new URL(session.url).pathname + new URL(session.url).search,
        headers: { ...session.request.headers },
        body
    };
}

/**
 * Get test fixtures for different scenarios
 * @returns {Object} Test fixtures organized by scenario
 */
export function getTestFixtures() {
    const sessions = getAllParsedSessions();

    return {
        // Small request (few messages, low token count)
        small: sessions.find(s => s.metadata.sseEventCount < 50),
        // Medium request
        medium: sessions.find(s => s.metadata.sseEventCount >= 50 && s.metadata.sseEventCount < 500),
        // Large request (many SSE events)
        large: sessions.find(s => s.metadata.sseEventCount >= 500),
        // Haiku model
        haiku: sessions.find(s => s.requestBody?.model?.includes('haiku')),
        // Sonnet model
        sonnet: sessions.find(s => s.requestBody?.model?.includes('sonnet')),
        // All sessions
        all: sessions
    };
}
