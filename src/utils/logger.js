/**
 * Global Logger Utility
 * P1-1: Centralized log level control to reduce console output in production
 *
 * Usage:
 *   import { Logger } from './logger.js';
 *   Logger.debug('Debug message');
 *   Logger.info('Info message');
 *   Logger.warn('Warning message');
 *   Logger.error('Error message');
 *
 * Environment variable:
 *   LOG_LEVEL=debug|info|warn|error (default: info)
 *
 * Lazy evaluation (avoids expensive computation when log level is higher):
 *   Logger.debug(() => `Expensive: ${JSON.stringify(largeObject)}`);
 */

/**
 * Log level constants with numeric values for comparison
 */
export const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

/**
 * Current log level (initialized from environment)
 * @type {number}
 */
let currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

/**
 * Logger class with level-based logging methods
 */
class LoggerClass {
    /**
     * Set the log level at runtime
     * @param {string} level - 'debug', 'info', 'warn', or 'error'
     */
    setLevel(level) {
        if (LOG_LEVELS[level] !== undefined) {
            currentLevel = LOG_LEVELS[level];
        }
    }

    /**
     * Get the current log level name
     * @returns {string}
     */
    getLevel() {
        return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLevel) || 'info';
    }

    /**
     * Internal log method with level check and lazy evaluation
     * @param {number} level - Numeric log level
     * @param {string} method - Console method to use
     * @param {string|function} message - Message or function returning message
     * @param {string} [prefix] - Optional prefix for the message
     * @private
     */
    _log(level, method, message, prefix = '') {
        if (level >= currentLevel) {
            const msg = typeof message === 'function' ? message() : message;
            console[method](prefix ? `${prefix} ${msg}` : msg);
        }
    }

    /**
     * Log debug message (only when LOG_LEVEL=debug)
     * @param {string|function} message - Message or lazy function
     * @param {string} [prefix] - Optional prefix
     */
    debug(message, prefix = '') {
        this._log(LOG_LEVELS.debug, 'log', message, prefix);
    }

    /**
     * Log info message (when LOG_LEVEL=debug or info)
     * @param {string|function} message - Message or lazy function
     * @param {string} [prefix] - Optional prefix
     */
    info(message, prefix = '') {
        this._log(LOG_LEVELS.info, 'log', message, prefix);
    }

    /**
     * Log warning message (when LOG_LEVEL=debug, info, or warn)
     * @param {string|function} message - Message or lazy function
     * @param {string} [prefix] - Optional prefix
     */
    warn(message, prefix = '') {
        this._log(LOG_LEVELS.warn, 'warn', message, prefix);
    }

    /**
     * Log error message (always logged)
     * @param {string|function} message - Message or lazy function
     * @param {string} [prefix] - Optional prefix
     */
    error(message, prefix = '') {
        this._log(LOG_LEVELS.error, 'error', message, prefix);
    }

    /**
     * Check if a log level is enabled
     * @param {string} level - Level name to check
     * @returns {boolean}
     */
    isEnabled(level) {
        return (LOG_LEVELS[level] ?? LOG_LEVELS.info) >= currentLevel;
    }
}

/**
 * Singleton logger instance
 */
export const Logger = new LoggerClass();

export default Logger;
