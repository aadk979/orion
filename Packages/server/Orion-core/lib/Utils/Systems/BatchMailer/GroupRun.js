/**
 * One group being worked on right now — the in-memory bookkeeping for a single
 * assignment, from `mailing:assign` to the completion report.
 *
 * The counters here are for reporting only. What is genuinely left is always a
 * COUNT(*) against the queue table, never this object: a node that crashes
 * mid-group takes its counters with it, but the rows are still there.
 */
class GroupRun {
    constructor(jobId, jobName, groupNumber) {
        this.jobId = jobId;
        this.jobName = jobName;
        this.groupNumber = groupNumber;
        this.sent = 0;
        this.failed = 0;
        this.remaining = null;
        this.startedAt = Date.now();
        this.cancelled = false;
        this.consecutiveFailures = 0;
    }

    get key() {
        return `${this.jobId}::${this.groupNumber}`;
    }
}

export { GroupRun };
