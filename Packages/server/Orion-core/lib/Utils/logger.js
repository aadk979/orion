import fs from 'fs';
import path from 'path';
import { globalAccessPoint } from './GlobalAccessPoint.js';
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
        this.logToFile = false;
    }

    #getTimestamp() {
        return new Date().toISOString();
    }

    #parseInput(input) {
        // Errors must be handled before the generic object branch: JSON.stringify
        // of an Error yields "{}" because name/message/stack are non-enumerable,
        // which destroyed the diagnostic on exactly the paths that need it most
        // (an uncaught exception logged as "Uncaught Exception: {}").
        if (input instanceof Error) {
            const base = input.stack || `${input.name}: ${input.message}`;
            // Preserve the codes Orion attaches to its own errors.
            const extras = [input.code, input.errorCode].filter(Boolean);

            return extras.length > 0 ? `${base}\n    [${extras.join(' ')}]` : base;
        }

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
            const systemConfig = globalAccessPoint.systemConfig();
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
        // A signal is a requested, graceful stop and exits 0. A crash is NOT a
        // clean exit and must exit non-zero: exiting 0 told every process
        // supervisor the run had SUCCEEDED, so a node that hit an uncaught
        // exception stayed down under Kubernetes `restartPolicy: OnFailure`,
        // systemd `Restart=on-failure` and `docker --restart on-failure`. The same
        // bug made `node --test` report a crashed suite as a pass.
        //
        // Note this also covers unhandled promise rejections: since Node 15 the
        // default mode raises them as uncaught exceptions.
        const shutdownHandler = (signal, exitCode = 0) => {
            const msg1 = `Server is shutting down (${signal})`;

            const timestamp = this.#getTimestamp();
            console.log(`[${timestamp}] INFO: ${msg1}`);

            process.exit(exitCode);
        };

        process.on('SIGINT', () => shutdownHandler('SIGINT'));
        process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
        process.on('uncaughtException', err => {
            // Written synchronously: the async appendFile used by the normal log
            // path is truncated by the process.exit() below, so the crash record —
            // the one record that matters — never reached disk.
            this.#logCrashSync(err);
            shutdownHandler('EXCEPTION', 1);
        });
    }

    #logCrashSync(err) {
        const parsed = this.#parseInput(err);
        const timestamp = this.#getTimestamp();

        console.log(`${this.colors.red}[${timestamp}::${getCurrentUnixTime()}] ERROR: Uncaught Exception: ${parsed}${this.colors.reset}`);

        if (!this.logToFile) return;

        try {
            fs.appendFileSync(this.logFilePath, `[${timestamp}] ERROR: Uncaught Exception: ${parsed}\n`);
        } catch (e) {
            console.error('Failed to write crash log to file:', e.message);
        }
    }
}

// Export a singleton instance
const logger = new CustomLogger();

globalAccessPoint.setValue('logger', logger);

export { logger };
