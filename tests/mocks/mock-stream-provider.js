/**
 * Mock Stream Provider for Performance Testing
 * Simulates real streaming response behavior without external service dependencies
 */

/**
 * Creates a mock streaming provider for testing
 * @param {Object} options - Configuration options
 * @param {number} [options.chunkCount=100] - Number of chunks to generate
 * @param {number} [options.chunkDelay=1] - Delay between chunks in ms (0 for no delay)
 * @param {number} [options.chunkSize=50] - Size of text content per chunk
 * @param {boolean} [options.simulateCpuWork=false] - Whether to simulate CPU-intensive work
 * @param {string} [options.format='gemini'] - Output format: 'gemini', 'openai', 'claude'
 */
export class MockStreamProvider {
    constructor(options = {}) {
        this.chunkCount = options.chunkCount || 100;
        this.chunkDelay = options.chunkDelay ?? 1;
        this.chunkSize = options.chunkSize || 50;
        this.simulateCpuWork = options.simulateCpuWork || false;
        this.format = options.format || 'gemini';
        this.cpuWorkIterations = options.cpuWorkIterations || 1000;
    }

    /**
     * Generate streaming content (async generator)
     * @param {string} model - Model name
     * @param {Object} requestBody - Request body
     * @yields {Object} Stream chunks in the configured format
     */
    async *generateContentStream(model, requestBody) {
        for (let i = 0; i < this.chunkCount; i++) {
            if (this.chunkDelay > 0) {
                await new Promise(r => setTimeout(r, this.chunkDelay));
            }

            if (this.simulateCpuWork) {
                this._simulateCpuWork();
            }

            yield this._createChunk(i, model);
        }
    }

    /**
     * Generate non-streaming content
     * @param {string} model - Model name
     * @param {Object} requestBody - Request body
     * @returns {Object} Complete response
     */
    async generateContent(model, requestBody) {
        const text = 'x'.repeat(this.chunkSize * this.chunkCount);
        return this._createResponse(text, model);
    }

    /**
     * List available models
     * @returns {Object} Model list
     */
    async listModels() {
        return {
            models: [
                { name: 'mock-model-1', displayName: 'Mock Model 1' },
                { name: 'mock-model-2', displayName: 'Mock Model 2' }
            ]
        };
    }

    _createChunk(index, model) {
        const text = `chunk-${index}-${'x'.repeat(this.chunkSize)}`;

        switch (this.format) {
            case 'openai':
                return {
                    id: `chatcmpl-mock-${index}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model || 'mock-model',
                    choices: [{
                        index: 0,
                        delta: { content: text },
                        finish_reason: index === this.chunkCount - 1 ? 'stop' : null
                    }]
                };

            case 'claude':
                if (index === 0) {
                    return {
                        type: 'content_block_start',
                        index: 0,
                        content_block: { type: 'text', text: '' }
                    };
                }
                return {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text }
                };

            case 'gemini':
            default:
                return {
                    candidates: [{
                        content: {
                            parts: [{ text }],
                            role: 'model'
                        },
                        finishReason: index === this.chunkCount - 1 ? 'STOP' : null
                    }],
                    usageMetadata: index === this.chunkCount - 1 ? {
                        promptTokenCount: 10,
                        candidatesTokenCount: this.chunkCount * 10,
                        totalTokenCount: this.chunkCount * 10 + 10
                    } : undefined
                };
        }
    }

    _createResponse(text, model) {
        switch (this.format) {
            case 'openai':
                return {
                    id: 'chatcmpl-mock',
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: model || 'mock-model',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: text },
                        finish_reason: 'stop'
                    }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: text.length / 4,
                        total_tokens: 10 + text.length / 4
                    }
                };

            case 'claude':
                return {
                    id: 'msg-mock',
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'text', text }],
                    model: model || 'mock-model',
                    stop_reason: 'end_turn',
                    usage: {
                        input_tokens: 10,
                        output_tokens: text.length / 4
                    }
                };

            case 'gemini':
            default:
                return {
                    candidates: [{
                        content: {
                            parts: [{ text }],
                            role: 'model'
                        },
                        finishReason: 'STOP'
                    }],
                    usageMetadata: {
                        promptTokenCount: 10,
                        candidatesTokenCount: text.length / 4,
                        totalTokenCount: 10 + text.length / 4
                    }
                };
        }
    }

    _simulateCpuWork() {
        // Simulate CPU-intensive work (e.g., JSON parsing, string operations)
        let result = 0;
        for (let i = 0; i < this.cpuWorkIterations; i++) {
            result += Math.sqrt(i) * Math.sin(i);
        }
        return result;
    }
}

/**
 * Mock HTTP Response for testing stream handlers
 */
export class MockResponse {
    constructor() {
        this.chunks = [];
        this.headers = {};
        this.statusCode = 200;
        this.headersSent = false;
        this.finished = false;
        this.socket = {
            cork: () => {},
            uncork: () => {}
        };
    }

    writeHead(status, headers) {
        this.statusCode = status;
        this.headers = { ...this.headers, ...headers };
        this.headersSent = true;
    }

    write(chunk) {
        this.chunks.push(chunk);
        return true;
    }

    end(data) {
        if (data) {
            this.chunks.push(data);
        }
        this.finished = true;
    }

    on(event, handler) {
        // No-op for mock
    }

    getBody() {
        return this.chunks.join('');
    }

    getChunkCount() {
        return this.chunks.length;
    }
}

/**
 * Create a provider pool manager mock for testing
 */
export function createMockProviderPoolManager() {
    return {
        selectProvider: async () => ({
            uuid: 'mock-provider-uuid',
            provider: 'openai-custom'
        }),
        incrementUsage: async () => {},
        incrementError: async () => {},
        updateHealthStatus: async () => {},
        markProviderHealthy: async () => {},
        markProviderUnhealthy: async () => {},
        getProvider: async () => ({
            uuid: 'mock-provider-uuid',
            provider: 'openai-custom'
        })
    };
}
