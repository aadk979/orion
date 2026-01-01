import { globalAccessPoint } from '../GlobalAccessPoint.js';
import { generateEmailFromTemplate } from './mailConstructor.js';
import { sendMail } from './mailer.js';

const generateAndSendMail = async (numPath, to, details) => {
    details.APPNAME = globalAccessPoint.systemConfig()?.app?.appName || 'Orion';

    const mail = generateEmailFromTemplate(numPath, details);

    const sending = await sendMail(to, mail.subject, mail.body);

    return sending;
};

export { generateAndSendMail };
