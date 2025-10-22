import { generateEmailFromTemplate } from './mailConstructor.js';
import { sendMail } from './mailer.js';

const generateAndSendMail = async (numPath, to, details) => {
    const mail = generateEmailFromTemplate(numPath, details);

    const sending = await sendMail(to, mail.subject, mail.body);

    return sending;
}

export { generateAndSendMail };;