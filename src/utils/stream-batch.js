/**
 * Stream Batch Writer
 * P0-2 Optimization: Use cork/uncork for batch writes to reduce event loop blocking
 *
 * Problem: Each chunk executes synchronous JSON.stringify blocking event loop
 * Solution: Batch multiple writes using Node.js cork/uncork mechanism
 */

/**
 * Creates a batched stream writer that uses cork/uncork for efficient writes
 * @param {import('http').ServerResponse} response - HTTP response object
 * @param {Object} options - Configuration options
 * @param {number} [options.batchSize=5] - Number of writes to batch before uncork
 * @param {number} [options.flushInterval=10] - Auto-flush interval in ms (0 to disable)
 * @returns {Object} Batched writer with write() and flush() methods
 */
export function createBatchedStreamWriter(response, options = {}) {
    const { batchSize = 5, flushInterval = 10 } = options;

    let writeCount = 0;
    let isCorked = false;
    let flushTimer = null;

    // Check if response supports cork/uncork (Node.js streams)
    const supportsCork = typeof response.cork === 'function' &&
                         typeof response.uncork === 'function';

    /**
     * Start batching writes
     */
    const startBatch = () => {
        if (supportsCork && !isCorked) {
            response.cork();
            isCorked = true;
        }
    };

    /**
     * End batch and flush writes
     */
    const endBatch = () => {
        if (supportsCork && isCorked) {
            // Use process.nextTick to ensure uncork happens after all writes
            process.nextTick(() => {
                if (isCorked) {
                    response.uncork();
                    isCorked = false;
                }
            });
        }
        writeCount = 0;
    };

    /**
     * Schedule auto-flush if enabled
     */
    const scheduleFlush = () => {
        if (flushInterval > 0 && !flushTimer) {
            flushTimer = setTimeout(() => {
                flushTimer = null;
                if (writeCount > 0) {
                    endBatch();
                }
            }, flushInterval);
        }
    };

    /**
     * Write data to the response with batching
     * @param {string|Buffer} data - Data to write
     * @returns {boolean} - Whether the write was successful
     */
    const write = (data) => {
        // Start batch on first write
        if (writeCount === 0) {
            startBatch();
        }

        const result = response.write(data);
        writeCount++;

        // End batch when batch size reached
        if (writeCount >= batchSize) {
            endBatch();
        } else {
            scheduleFlush();
        }

        return result;
    };

    /**
     * Flush any pending writes immediately
     */
    const flush = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (writeCount > 0) {
            endBatch();
        }
    };

    /**
     * Clean up resources
     */
    const destroy = () => {
        flush();
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
    };

    return {
        write,
        flush,
        destroy,
        get pendingWrites() {
            return writeCount;
        },
        get isBatching() {
            return isCorked;
        }
    };
}

/**
 * Pre-serialize common stream data structures for reuse
 * Avoids repeated JSON.stringify for identical objects
 */
export class StreamDataSerializer {
    constructor(maxCacheSize = 100) {
        this._cache = new Map();
        this._maxCacheSize = maxCacheSize;
    }

    /**
     * Serialize data with caching for repeated structures
     * @param {Object} data - Data to serialize
     * @param {string} [cacheKey] - Optional cache key for repeated data
     * @returns {string} - JSON string
     */
    serialize(data, cacheKey = null) {
        if (cacheKey) {
            const cached = this._cache.get(cacheKey);
            if (cached !== undefined) {
                return cached;
            }
        }

        const serialized = JSON.stringify(data);

        if (cacheKey) {
            // Prevent cache from growing unbounded
            if (this._cache.size >= this._maxCacheSize) {
                // Remove oldest entry (first key)
                const firstKey = this._cache.keys().next().value;
                this._cache.delete(firstKey);
            }
            this._cache.set(cacheKey, serialized);
        }

        return serialized;
    }

    /**
     * Clear the serialization cache
     */
    clear() {
        this._cache.clear();
    }

    /**
     * Get cache statistics
     */
    get stats() {
        return {
            size: this._cache.size,
            maxSize: this._maxCacheSize
        };
    }
}

// Singleton serializer for common use
let defaultSerializer = null;

/**
 * Get the default stream data serializer
 * @returns {StreamDataSerializer}
 */
export function getDefaultSerializer() {
    if (!defaultSerializer) {
        defaultSerializer = new StreamDataSerializer();
    }
    return defaultSerializer;
}
