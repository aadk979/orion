/**
 * The dedicated bulk SMTP transport.
 *
 * Pooled with a single connection: the sliding rate budget already decides how
 * fast this node sends, and a second connection would let it send twice that
 * without the limiter ever noticing.
 */
const createBulkTransport = async (mail = {}) => {
    const nodemailer = (await import('nodemailer')).default;

    return nodemailer.createTransport(
        mail.service
            ? { service: mail.service, auth: { user: mail.email, pass: mail.password }, pool: true, maxConnections: 1 }
            : {
                  host: mail.host,
                  port: mail.port || 587,
                  secure: mail.secure === true,
                  auth: mail.email ? { user: mail.email, pass: mail.password } : undefined,
                  pool: true,
                  maxConnections: 1
              }
    );
};

/** Whether `utilities.batchMailer.mail` names somewhere to send through at all. */
const hasTransportConfig = (mail = {}) => Boolean(mail.email || mail.host || mail.service);

export { createBulkTransport, hasTransportConfig };
