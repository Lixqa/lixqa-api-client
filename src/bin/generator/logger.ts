/**
 * Logger utility for the API client generator
 * Provides consistent logging with emoji prefixes for different log levels
 */

/**
 * Logger interface with methods for different log levels
 */
export interface Logger {
  info: (msg: string) => void;
  success: (msg: string) => void;
  error: (msg: string) => void;
  warning: (msg: string) => void;
  debug: (msg: string) => void;
}

/**
 * Creates a logger instance with debug flag support
 * @param debug - Whether to enable debug logging
 * @returns Logger object with info, success, error, warning, and debug methods
 */
export function createLogger(debug = false): Logger {
  return {
    /**
     * Log an informational message
     * @param msg - Message to log
     */
    info: (msg: string) => console.log(`ℹ️  ${msg}`),

    /**
     * Log a success message
     * @param msg - Message to log
     */
    success: (msg: string) => console.log(`✅ ${msg}`),

    /**
     * Log an error message
     * @param msg - Message to log
     */
    error: (msg: string) => console.error(`❌ ${msg}`),

    /**
     * Log a warning message
     * @param msg - Message to log
     */
    warning: (msg: string) => console.log(`⚠️  ${msg}`),

    /**
     * Log a debug message (only if debug is enabled)
     * @param msg - Message to log
     */
    debug: (msg: string) => debug && console.log(`🔍 ${msg}`),
  };
}

