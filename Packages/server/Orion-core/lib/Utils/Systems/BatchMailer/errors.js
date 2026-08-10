/**
 * Raised when a retire affects no rows: the orchestrator handed this group to
 * another node while this one was still sending it. Not a delivery failure —
 * it means stop, immediately, before duplicating the new holder's mail.
 */
class LeaseLostError extends Error {
    constructor(jobId, groupNumber) {
        super(
            `The lease on group ${groupNumber} of ${jobId} is no longer held by this node — it was reassigned mid-send, ` +
                'so the remainder belongs to another node'
        );
        this.code = 'MAILING::LEASE-LOST';
        this.jobId = jobId;
        this.groupNumber = groupNumber;
    }
}

export { LeaseLostError };
