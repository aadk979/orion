const cron = require('node-cron');
const { logger } = require('./logger');

class EventScheduler {
    constructor() {
        this.events = new Map();
    }

    addEvent(eventID, callback, time, params) {
        const delayInMinutes = this.parseTime(time);
        if (delayInMinutes === null) {
            throw new Error('Invalid time format. Use formats like "15m", "1h".');
        }

        const runTime = new Date(Date.now() + delayInMinutes * 60000);
        const cronExpression = `${runTime.getMinutes()} ${runTime.getHours()} * * *`;

        const task = cron.schedule(cronExpression, () => {
            callback(params);
            logger.info(`Event ${eventID} ran successfully`)
            this.events.delete(eventID);
        }, { scheduled: true });

        this.events.set(eventID, task);
        logger.info(`Scheduled event "${eventID}" to run at ${runTime}`);
    }

    parseTime(time) {
        const match = time.match(/(\d+)([smhdw])/);
        if (!match) return null;
        const value = parseInt(match[1], 10);
    
        switch (match[2]) {
            case 's': return value / 60;  // Convert seconds to minutes
            case 'm': return value;       // Minutes as is
            case 'h': return value * 60;  // Convert hours to minutes
            case 'd': return value * 1440; // Convert days to minutes (24*60)
            case 'w': return value * 10080; // Convert weeks to minutes (7*24*60)
            default: return null;
        }
    }    

    cancelEvent(eventID) {
        if (this.events.has(eventID)) {
            this.events.get(eventID).stop();
            this.events.delete(eventID);
            logger.info(`Cancelled event "${eventID}"`);
        } else {
            logger.info(`Event "${eventID}" not found.`);
        }
    }
}

const cronScheduler = new EventScheduler();

module.exports = { cronScheduler };