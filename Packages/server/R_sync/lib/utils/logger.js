import fs from 'fs';
import path from 'path';
import { globalAccessPoint } from './globalAccessPoint.js';
import { getCurrentUnixTime } from './Date&Time.js';

class CustomLogger {
    constructor(logFileName = 'app.log', shutdownLogFileName = 'shutdown.log') {
        // ANSI color codes
        this.colors = {
            reset: '\x1b[0m',
            yellow: '\x1b[33m',
            red: '\x1b[31m'
        };

        // Ensure logs folder exists
        const logsDir = path.resolve(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

        // Normal log file
        this.logFilePath = path.join(logsDir, logFileName);

        // Shutdown log file
        this.shutdownLogFilePath = path.join(logsDir, shutdownLogFileName);

        // Bind shutdown events
        this.#bindShutdownEvents();

        // Default to console-only until configured after system load
        this.logToFile = true;
    }

    #getTimestamp() {
        return new Date().toISOString();
    }

    #parseInput(input) {
        if (typeof input === 'object' && input !== null) {
            try {
                return JSON.stringify(input, null, 2);
            } catch (e) {
                return String(input);
            }
        }
        return String(input);
    }

    #writeToFile(filePath, level, message) {
        const logLine = `[${this.#getTimestamp()}] ${level}: ${message}\n`;
        fs.appendFile(filePath, logLine, err => {
            if (err) console.error('Failed to write log to file:', err);
        });
    }

    // Configure logger after system has fully loaded
    configure(options = {}) {
        if (typeof options.logToFile === 'boolean') {
            this.logToFile = options.logToFile;
        }
    }

    // Convenience: pull config from GlobalAccessPoint lazily to avoid circular require
    configureFromGlobalAccessPoint() {
        try {
            const systemConfig = globalAccessPoint.getValue('systemConfig');
            if (systemConfig && typeof systemConfig?.utilities?.logToFile === 'boolean') {
                this.logToFile = systemConfig?.utilities?.logToFile || false;
            }
        } catch (e) {}
    }

    log(...args) {
        if (!this.logToFile) return; // do nothing if logging to file is disabled

        const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
        this.#writeToFile(this.logFilePath, 'LOG', parsedArgs);
    }

    info(...args) {
        const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
        const timestamp = this.#getTimestamp();
        console.log(`[${timestamp}::${getCurrentUnixTime()}] INFO: ${parsedArgs}`);
        if (this.logToFile) {
            this.#writeToFile(this.logFilePath, 'INFO', parsedArgs);
        }
    }

    warn(...args) {
        const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
        const timestamp = this.#getTimestamp();
        console.log(`${this.colors.yellow}[${timestamp}::${getCurrentUnixTime()}] WARN: ${parsedArgs}${this.colors.reset}`);
        if (this.logToFile) {
            this.#writeToFile(this.logFilePath, 'WARN', parsedArgs);
        }
    }

    error(...args) {
        const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
        const timestamp = this.#getTimestamp();
        console.log(`${this.colors.red}[${timestamp}::${getCurrentUnixTime()}] ERROR: ${parsedArgs}${this.colors.reset}`);
        if (this.logToFile) {
            this.#writeToFile(this.logFilePath, 'ERROR', parsedArgs);
        }
    }

    // Private method to bind process shutdown events
    #bindShutdownEvents() {
        process.on('uncaughtException', err => {
            this.error('Uncaught Exception:', err);
            process.exit(1);
        });

        process.on('unhandledRejection', reason => {
            this.error('Unhandled Rejection:', reason);
        });

        // Library default: do not register SIGINT/SIGTERM — let the host app own graceful shutdown.
        if (process.env.R_SYNC_LOGGER_HANDLE_SIGNALS !== '1') {
            return;
        }

        const shutdownHandler = signal => {
            const msg1 = `Server is shutting down (${signal})`;
            const timestamp = this.#getTimestamp();
            console.log(`[${timestamp}] INFO: ${msg1}`);
            process.exit(0);
        };

        process.on('SIGINT', () => shutdownHandler('SIGINT'));
        process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    }
}

// Export a singleton instance
const logger = new CustomLogger();

globalAccessPoint.setValue('logger', logger);

export { logger };
