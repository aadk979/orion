import { UserModel, UserProviderModel } from '../../Databases/models/index.js';
import { generateUID } from '../../valueGenerator.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { logger } from '../../logger.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'Account.js');

/**
 * Check if an account exists for the given email.
 */
const accountExist = async email => {
    const user = await UserModel.getUserByEmail(email);
    if (!user) {
        return { error: false, userExist: false };
    }
    return { error: false, userExist: true, uid: user.uid };
};

/**
 * If the user already has an account, ensure the OAuth provider is linked.
 *
 * @deprecated Superseded by resolveOAuthIdentity. Linking on the email string
 * alone means any provider that will assert a victim's address — including one
 * whose directory the attacker controls — resolves to the victim's account.
 * Retained only so external callers do not break; it now REFUSES to create a new
 * link and will only confirm one that already exists.
 */
const checkAndAddProviderToAccount = async (email, providerName) => {
    const Function = async parameters => {
        const user = await UserModel.getUserByEmail(parameters.email);

        if (!user) {
            return { error: true, errorCode: 'OAUTH::ACCOUNT-NOT-FOUND::A::p' };
        }

        const hasProvider = await UserProviderModel.hasProvider(user.uid, parameters.providerName);

        if (!hasProvider) {
            logger.warn(
                `checkAndAddProviderToAccount refused to link ${parameters.providerName} to an account by email alone. Use resolveOAuthIdentity.`
            );
            return { error: true, errorCode: 'OAUTH::LINK-REQUIRES-VERIFICATION::A::p' };
        }

        return { error: false, uid: user.uid };
    };

    const parameters = { email, providerName };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'checkAndAddProviderToAccount', functionSource);
};

/**
 * Resolves an authenticated provider identity to a local account.
 *
 * Identity is keyed on (provider, subject) — never on the asserted email. The
 * subject is the provider's own immutable id for that account; the email is an
 * attribute whose trustworthiness varies per provider and, for multi-tenant
 * directories, is settable by whoever controls the tenant.
 *
 * Outcomes:
 *   - known (provider, subject)                  → sign in to that account
 *   - unknown subject, no account for the email  → create a new account, bound
 *   - unknown subject, provider already linked
 *     to that email's account with NO subject    → adopt the subject (one-time
 *                                                  upgrade for links created
 *                                                  before subjects were stored)
 *   - unknown subject, account exists for email  → REFUSE. Silently attaching a
 *                                                  new provider identity to an
 *                                                  existing account is the whole
 *                                                  takeover primitive; the user
 *                                                  must prove control of the
 *                                                  account with a factor it
 *                                                  already has.
 *
 * @param {object} identity
 * @param {string} identity.providerName
 * @param {string} identity.subject        provider's stable id (OIDC `sub`)
 * @param {string} identity.email
 * @param {boolean} identity.emailVerified provider's own verification claim
 */
const resolveOAuthIdentity = async ({ providerName, subject, email, emailVerified }) => {
    const Function = async parameters => {
        const provider = parameters.providerName.trim().toUpperCase();

        if (!parameters.subject) {
            // Without a stable subject there is nothing safe to key on.
            return { error: true, errorCode: 'OAUTH::MISSING-PROVIDER-SUBJECT::A::i' };
        }

        // 1. Known provider identity — the only path that signs into an existing account.
        const boundUid = await UserProviderModel.findUidBySubject(provider, parameters.subject);

        if (boundUid) {
            return { error: false, uid: boundUid, created: false };
        }

        // Everything below needs a usable email, and one the provider vouches for.
        if (!parameters.email) {
            return { error: true, errorCode: 'OAUTH::EMAIL-NOT-PROVIDED::A::p' };
        }

        if (!parameters.emailVerified) {
            return { error: true, errorCode: 'OAUTH::EMAIL-NOT-VERIFIED::A::p' };
        }

        const existing = await UserModel.getUserByEmail(parameters.email);

        // 2. No local account — create one, bound to this provider identity.
        if (!existing) {
            const created = await createAccountWithProvider(parameters.email, provider, parameters.subject);
            if (created.error) return created;
            return { error: false, uid: created.uid, created: true };
        }

        // 3. Legacy link with no recorded subject — adopt it once.
        const adopted = await UserProviderModel.adoptSubjectIfUnbound(existing.uid, provider, parameters.subject);

        if (adopted) {
            logger.info(`OAuth: adopted ${provider} subject for uid ${existing.uid} (link predated subject binding)`);
            return { error: false, uid: existing.uid, created: false };
        }

        // 4. An account owns this email but this provider identity is not it.
        logger.warn(`OAuth: refused to auto-link a new ${provider} identity to the existing account for this email — verification required`);
        return { error: true, errorCode: 'OAUTH::LINK-REQUIRES-VERIFICATION::A::p' };
    };

    const parameters = { providerName, subject, email, emailVerified };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'resolveOAuthIdentity', functionSource);
};

/**
 * Create a new account for a user that signed up via an OAuth provider.
 */
const createAccountWithProvider = async (email, providerName, subject = null) => {
    const Function = async parameters => {
        const systemConfig = systemConfigModule.getModule();
        const uid = generateUID(parameters.email);

        const createResult = await UserModel.createUser({
            uid,
            // Normalized on the way in, matching the password-registration path —
            // lookups are case-insensitive, so storage should be consistent too.
            email: parameters.email.toLowerCase(),
            passwordHash: null,
            role: 'USER'
        });

        if (createResult.error) {
            return { error: true, errorCode: 'OAUTH::CREATE-ACCOUNT-FAILED::A::i' };
        }

        await UserProviderModel.addProvider(uid, parameters.providerName, parameters.subject);

        try {
            systemConfig?.utilities?.onUserCreation(parameters.email, uid);
        } catch (e) {
            logger.error('An error occurred in the onUserCreation callback: ' + e);
        }

        return { error: false, uid };
    };

    const parameters = { email, providerName, subject };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'createAccountWithProvider', functionSource);
};

export { accountExist, checkAndAddProviderToAccount, createAccountWithProvider, resolveOAuthIdentity };
