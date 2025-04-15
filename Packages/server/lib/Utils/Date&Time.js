function getCurrentUnixTime() {
    return Math.floor(Date.now() / 1000);
}

function getFutureUnixTime(duration) {
    const now = getCurrentUnixTime();
    const match = /^(\d+)(s|m|h|d|w|y)$/.exec(duration);

    if (!match) throw new Error("Invalid duration format");

    const value = parseInt(match[1]);
    const unit = match[2];

    const multipliers = {
        s: 1,                // second
        m: 60,               // minute
        h: 3600,             // hour
        d: 86400,            // day
        w: 604800,           // week
        y: 31536000          // year (365 days)
    };

    const secondsToAdd = value * multipliers[unit];
    return now + secondsToAdd;
}

function isUnixExpired(unixTime) {
    return getCurrentUnixTime() > unixTime;
}

module.exports = { isUnixExpired , getCurrentUnixTime , getFutureUnixTime }