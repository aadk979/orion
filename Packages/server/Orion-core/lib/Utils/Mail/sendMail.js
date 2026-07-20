import { generateEmailFromTemplate } from './mailConstructor.js';
import { sendMail } from './mailer.js';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'sendMail.js');

const generateAndSendMail = async (numPath, to, details) => {
    details.APPNAME = systemConfigModule.getModule()?.app?.appName || 'Orion';

    const mail = generateEmailFromTemplate(numPath, details);

    const sending = await sendMail(to, mail.subject, mail.body);

    return sending;
};

export { generateAndSendMail };
