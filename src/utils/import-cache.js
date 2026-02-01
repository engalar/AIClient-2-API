/**
 * Import Cache
 * P0-3 Optimization: Cache dynamic import results to avoid repeated imports in hot paths
 *
 * Problem: Dynamic import() in handleStreamRequest and handleUnaryRequest hot paths
 * Solution: Cache import results for reuse
 */

// Cache for imported modules
const importCache = new Map();

/**
 * Get cached service manager module
 * Caches the import result to avoid repeated dynamic imports
 * @returns {Promise<Object>} - The service-manager module
 */
export async function getCachedServiceManager() {
    const cacheKey = 'service-manager';

    if (importCache.has(cacheKey)) {
        return importCache.get(cacheKey);
    }

    // Perform the actual import
    const module = await import('../services/service-manager.js');

    // Cache the result
    importCache.set(cacheKey, module);

    return module;
}

/**
 * Get a cached module by path
 * Generic function for caching any dynamic import
 * @param {string} modulePath - The module path to import
 * @returns {Promise<Object>} - The imported module
 */
export async function getCachedModule(modulePath) {
    if (importCache.has(modulePath)) {
        return importCache.get(modulePath);
    }

    const module = await import(modulePath);
    importCache.set(modulePath, module);

    return module;
}

/**
 * Clear the import cache
 * Useful for testing or when modules need to be reloaded
 */
export function clearImportCache() {
    importCache.clear();
}

/**
 * Get import cache statistics
 * @returns {Object} - Cache statistics
 */
export function getImportCacheStats() {
    return {
        size: importCache.size,
        keys: Array.from(importCache.keys())
    };
}

/**
 * Pre-warm the import cache with commonly used modules
 * Call this during application startup to avoid first-request latency
 * @returns {Promise<void>}
 */
export async function prewarmImportCache() {
    try {
        await getCachedServiceManager();
        console.log('[ImportCache] Pre-warmed service-manager module');
    } catch (error) {
        console.warn('[ImportCache] Failed to pre-warm cache:', error.message);
    }
}
