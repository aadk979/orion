/**
 * Deployment policy for proof-of-possession binding.
 *
 * `dpop.js` is pure protocol — it verifies a proof and says yes or no. This
 * module is the half that decides WHETHER a proof is wanted, reads the
 * `tokens.binding` setting resolved at boot, and turns the request's DPoP
 * header into the thumbprint that issuance stamps into `cnf.jkt`.
 *
 * It exists because the two concerns were previously split between a config
 * value nothing read (`tokenBinding`) and an issuance path that never passed a
 * thumbprint — so the entire RFC 9449 implementation was unreachable. Every
 * sign-in flow now goes through `resolveIssuanceBinding`, and there is exactly
 * one place that answers "is binding on?".
 */
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
// The leaf store, NOT the re-export from requestMetadata.js — that module
// imports the step-up validator, which now imports this one, and going through
// it would close requestMetadata → StepUpAuth → dpopBinding → requestMetadata.
import { requestContext } from '../../../../Server/Middleware/requestContextStore.js';
import { verifyDpopProof, thumbprintFromProof } from './dpop.js';
import { logger } from '../../../logger.js';

/** True when this deployment issues key-bound tokens. */
const isBindingRequired = () => globalAccessPoint.getValue('tokenBinding') === 'dpop';

/**
 * Resolves the thumbprint to bind a newly issued token to.
 *
 * Reads the in-flight request's DPoP header from the request context, so the
 * sign-in flows need no extra plumbing — they call this and pass the result
 * through to token generation.
 *
 * The proof is FULLY verified here, not merely decoded. At issuance there is no
 * prior `cnf.jkt` to compare against and no access token to hash, so the checks
 * that carry the weight are the signature, `htm`/`htu`, freshness and `jti`
 * replay — enough that an attacker cannot register a key they do not hold, or
 * replay a captured issuance proof to bind a session to their own key.
 *
 * @returns {Promise<{error: false, jkt: string|null} | {error: true, errorCode: string, reason?: string}>}
 *   `jkt: null` means binding is disabled for this deployment, which leaves the
 *   token unbound — the pre-existing behaviour, kept so binding can be rolled
 *   out without invalidating live sessions.
 */
const resolveIssuanceBinding = async () => {
    if (!isBindingRequired()) {
        return { error: false, jkt: null };
    }

    const metadata = requestContext.getStore();
    const proof = metadata?.dpopProof || null;

    if (!proof) {
        return { error: true, errorCode: 'TOKEN-BINDING::PROOF-REQUIRED::A::p', reason: 'MISSING_PROOF' };
    }

    const result = await verifyDpopProof({
        proof,
        method: metadata?.method || 'POST',
        url: metadata?.requestUri,
        // No token exists yet at issuance, so there is nothing for `ath` to
        // hash. RFC 9449 only requires the claim when a token is presented.
        accessToken: null,
        expectedJkt: null,
        requireAth: false
    });

    if (!result.valid) {
        logger.warn(`TokenBinding: issuance proof rejected — ${result.reason}`);
        return { error: true, errorCode: 'TOKEN-BINDING::PROOF-INVALID::A::p', reason: result.reason };
    }

    // verifyDpopProof already returns the thumbprint it computed; thumbprintFromProof
    // is the unverified read used only where no verification is possible.
    return { error: false, jkt: result.jkt || thumbprintFromProof(proof) };
};

export { isBindingRequired, resolveIssuanceBinding };
