/**
 * Audit-trail helper for the token systems.
 *
 * Every token event repeats the same envelope (request-scoped requestId,
 * ipAddress, source/function attribution); this fills that in so call sites
 * only state what actually varies between events.
 */
import { requestContext } from '../../../../Server/Middleware/requestMetadata.js';

function recordTokenEvent(auditModule, { source, functionName, action, status, ip, impact, user = {}, device = {}, metadata = {}, errorCode }) {
    const record = {
        user,
        device,
        action,
        status,
        source,
        functionName,
        requestId: requestContext.getStore()?.requestId,
        ipAddress: ip,
        impact,
        metadata
    };

    if (errorCode) record.errorCode = errorCode;

    auditModule.getModule().record(record);
}

export { recordTokenEvent };
