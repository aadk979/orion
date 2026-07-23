/**
 * The per-request AsyncLocalStorage instance, on its own with no imports.
 *
 * This lives apart from requestMetadata.js deliberately. That module imports the
 * response layer (to reject malformed requests) and the step-up validator, so
 * anything importing the store *from* it inherits those edges — and the response
 * layer needs the store too, which closed a cycle through GlobalAccessPoint and
 * tripped a temporal-dead-zone error at module evaluation.
 *
 * A leaf module has no such edges: both sides import this and neither depends on
 * the other. requestMetadata.js re-exports `requestContext` so existing importers
 * keep working.
 */
import { AsyncLocalStorage } from 'async_hooks';

const requestContext = new AsyncLocalStorage();

export { requestContext };
