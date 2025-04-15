class CustomLogger {
    constructor() {
      // ANSI color codes
      this.colors = {
        reset: '\x1b[0m',
        yellow: '\x1b[33m',
        red: '\x1b[31m'
      };
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
  
    info(...args) {
      const timestamp = this.#getTimestamp();
      const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
      console.log(`[${timestamp}] INFO: ${parsedArgs}`);
    }
  
    warn(...args) {
      const timestamp = this.#getTimestamp();
      const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
      console.log(`${this.colors.yellow}[${timestamp}] WARN: ${parsedArgs}${this.colors.reset}`);
    }
  
    error(...args) {
      const timestamp = this.#getTimestamp();
      const parsedArgs = args.map(arg => this.#parseInput(arg)).join(' ');
      console.log(`${this.colors.red}[${timestamp}] ERROR: ${parsedArgs}${this.colors.reset}`);
    }
  }
  
  // Create a singleton instance
  const logger = new CustomLogger();
  
  // Export the logger instance
  module.exports = { logger };