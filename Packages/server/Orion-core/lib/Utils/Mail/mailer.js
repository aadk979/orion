import nodemailer from 'nodemailer';
import { logger } from '../logger.js';
import { tryCatch } from '../TryCatch.js';
import { fileURLToPath } from 'url';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'mailer.js');


const sendMail = async (to, subject, text) => {
    const Function = async parameters => {
        const systemConfig = systemConfigModule.getModule();

        const transporter = nodemailer.createTransport({
            service: systemConfig.mail.service,
            auth: {
                user: systemConfig.mail.email,
                pass: systemConfig.mail.password
            }
        });

        const mailOptions = {
            from: systemConfig.appName,
            to: parameters.to,
            subject: parameters.subject,
            text: parameters.text
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                logger.error('MAIL ERROR: ' + error);
                return { error: true, errorCode: 'MAIL::SEND-FAILED::A::i' };
            }
        });

        return { error: false, sent: true };
    };

    const parameters = {
        to,
        subject,
        text
    };

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'sendMail', functionSource);

    return result;
};

export { sendMail };
