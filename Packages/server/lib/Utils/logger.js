const fs = require('fs');
const path = require('path');
const { globalAccessPoint } = require('./GlobalAccessPoint');

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

    this.logToFile = globalAccessPoint.getValue("systemConfig").logToFile;
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

  info(...args) {
    const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
    const timestamp = this.#getTimestamp();
    console.log(`[${timestamp}] INFO: ${parsedArgs}`);
    if (this.logToFile) {
      this.#writeToFile(this.logFilePath, 'INFO', parsedArgs);
    }
  }

  warn(...args) {
    const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
    const timestamp = this.#getTimestamp();
    console.log(`${this.colors.yellow}[${timestamp}] WARN: ${parsedArgs}${this.colors.reset}`);
    if (this.logToFile) {
      this.#writeToFile(this.logFilePath, 'WARN', parsedArgs);
    }
  }

  error(...args) {
    const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
    const timestamp = this.#getTimestamp();
    console.log(`${this.colors.red}[${timestamp}] ERROR: ${parsedArgs}${this.colors.reset}`);
    if (this.logToFile) {
      this.#writeToFile(this.logFilePath, 'ERROR', parsedArgs);
    }
  }

  // Private method to bind process shutdown events
  #bindShutdownEvents() {
    const shutdownHandler = (signal) => {
      const msg1 = `Server is shutting down (${signal})`;
      const msg2 = 'Cleanup finished. Exiting now.';

      // Log to console
      this.info(msg1);
      this.info(msg2);

      // Also log to shutdown log file
      this.#writeToFile(this.shutdownLogFilePath, 'SHUTDOWN', msg1);
      this.#writeToFile(this.shutdownLogFilePath, 'SHUTDOWN', msg2);

      process.exit(0);
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('uncaughtException', (err) => {
      this.error('Uncaught Exception:', err);
      shutdownHandler('EXCEPTION');
    });
  }
}

// Export a singleton instance
const logger = new CustomLogger();
module.exports = { logger };
