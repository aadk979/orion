const { generateEmailFromTemplate } = require("./mailConstructor");
const { sendMail } = require("./mailer");

const generateAndSendMail = async (numPath, to, details) => {
    const mail = generateEmailFromTemplate(numPath, details);

    const sending = await sendMail(to, mail.subject, mail.body);

    return sending;
}

module.exports = { generateAndSendMail }