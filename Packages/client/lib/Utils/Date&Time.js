function getCurrentUnixTime() {
    return Math.floor(Date.now() / 1000);
}

function getFutureUnixTime(duration) {
    const now = getCurrentUnixTime();
    const match = /^(\d+)(s|m|h|d|w|y)$/.exec(duration);

    if (!match) throw new Error('Invalid duration format');

    const value = parseInt(match[1]);
    const unit = match[2];

    const multipliers = {
        s: 1, // second
        m: 60, // minute
        h: 3600, // hour
        d: 86400, // day
        w: 604800, // week
        y: 31536000 // year (365 days)
    };

    const secondsToAdd = value * multipliers[unit];
    return now + secondsToAdd;
}

function isUnixExpired(unixTime) {
    return getCurrentUnixTime() > unixTime;
}

function parseDuration(str) {
    const timeUnits = {
        ms: 1,
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    };

    let totalMs = 0;
    const regex = /(\d+)\s*(ms|s|m|h|d)/g;
    let match;

    while ((match = regex.exec(str)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        totalMs += value * timeUnits[unit];
    }

    return totalMs;
}

function formatTime(ms) {
    if (ms === 0) return '0ms';
    if (ms < 1) return `${ms.toFixed(3)}ms`;

    const units = [
        { label: 'd', ms: 86400000 },
        { label: 'h', ms: 3600000 },
        { label: 'min', ms: 60000 },
        { label: 'sec', ms: 1000 },
        { label: 'ms', ms: 1 }
    ];

    const parts = [];
    let remaining = ms;

    for (const unit of units) {
        if (remaining >= unit.ms) {
            const value = Math.floor(remaining / unit.ms);
            remaining %= unit.ms;

            // For seconds and below, include decimals for precision when small
            if (unit.label === 'sec' && remaining > 0 && value < 60) {
                const preciseValue = (value + remaining / unit.ms).toFixed(2);
                parts.push(`${preciseValue}${unit.label}`);
                break;
            } else if (unit.label === 'ms' && parts.length === 0) {
                // If we only have milliseconds, show decimals
                parts.push(`${ms.toFixed(2)}${unit.label}`);
            } else {
                parts.push(`${value}${unit.label}`);
            }
        }
    }

    return parts.join(' ');
}

function formatTimePrecise(ms) {
    if (ms === 0) return '0ms';

    const units = [
        { label: 'd', ms: 86400000 },
        { label: 'h', ms: 3600000 },
        { label: 'min', ms: 60000 },
        { label: 's', ms: 1000 },
        { label: 'ms', ms: 1 }
    ];

    const parts = [];
    let remaining = ms;

    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        if (remaining >= unit.ms || (i === units.length - 1 && parts.length === 0)) {
            const value = remaining / unit.ms;

            if (i === units.length - 1 || remaining < units[i + 1].ms * 10) {
                const decimalPlaces = unit.label === 'ms' ? 2 : value < 10 ? 2 : 1;
                parts.push(`${value.toFixed(decimalPlaces)}${unit.label}`);
                break;
            } else {
                const wholeValue = Math.floor(value);
                parts.push(`${wholeValue}${unit.label}`);
                remaining -= wholeValue * unit.ms;
            }
        }
    }

    return parts.join(' ');
}

export { isUnixExpired, getCurrentUnixTime, getFutureUnixTime, formatTime, formatTimePrecise, parseDuration };
