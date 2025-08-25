const nodemailer = require("nodemailer");
const { globalAccessPoint } = require("../GlobalAccessPoint");
const { logger } = require("../logger");
const { tryCatch } = require("../TryCatch");

const sendMail = async (to, subject, text) => {
    const Function = async (parameters) => {
        const systemConfig = globalAccessPoint.getValue("systemConfig");

        const transporter = nodemailer.createTransport({
            service: systemConfig.mail.service,
            auth: {
                user: systemConfig.mail.email,
                pass: systemConfig.mail.password,
            },
        });

        const mailOptions = {
            from: systemConfig.appName,
            to: parameters.to,
            subject: parameters.subject,
            text: parameters.text
        }

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                logger.error("MAIL ERROR: " + error);
                return { error: true , errorCode: "UNABLE-TO-SEND-MAIL" };
            }

            return { error: false , sent: true }
        });
    }

    const parameters = {
        to,
        subject,
        text
    }

    const result = await tryCatch(Function, true, parameters);

    return result;
};

module.exports = { sendMail };