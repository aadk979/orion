/**
 * Configuration Schemas and Validator
 * 
 * Defines the expected structure and types for Orchestrator and Worker configurations.
 * Provides a validation function to ensure configs match schema.
 */

const VALID_ROLES = ["ORCHESTRATOR", "WORKER"];
const VALID_ENCRYPTION_ALGS = ["ECC_256", "ECC_384", "ECC_521"];

const OrchestratorConfigSchema = {
    role: { type: 'string', required: true, enum: VALID_ROLES },
    cluster: { type: 'string', required: true, minLength: 1 },
    publicIp: { type: 'string', required: false, default: '127.0.0.1' }, // Optional, defaults in interface.js
    port: { type: 'number', required: false, default: 55321 },
    encryptionAlg: { type: 'string', required: false, enum: VALID_ENCRYPTION_ALGS, default: 'ECC_256' },
    /**
     * When true, use x-r_sync-ip for callback address (NAT / advertised IP).
     * When false (default), use the TCP peer address only — avoids trivial IP spoofing.
     */
    trustAdvertisedWorkerIp: { type: 'boolean', required: false, default: false }
};

const WorkerConfigSchema = {
    role: { type: 'string', required: true, enum: VALID_ROLES },
    cluster: { type: 'string', required: true, minLength: 1 },
    publicIp: { type: 'string', required: false, default: '127.0.0.1' },
    orchestratorIp: { type: 'string', required: false, default: '127.0.0.1' },
    orchestratorPort: { type: 'number', required: false, default: 55321 },
    port: { type: 'number', required: false, default: 55322 },
    encryptionAlg: { type: 'string', required: false, enum: VALID_ENCRYPTION_ALGS, default: 'ECC_256' },
    heartbeatIntervalMs: { type: 'number', required: false, min: 1000, default: 30000 }
};

/**
 * Validates a config object against a schema
 * @param {Object} config - The configuration object to validate
 * @param {Object} schema - The schema definition
 * @returns {Object} - The validated config with defaults applied, or throws Error
 */
function validateConfig(config, schema) {
    if (!config || typeof config !== 'object') {
        throw new Error("Configuration must be an object");
    }

    const validatedConfig = { ...config };
    const errors = [];

    for (const [key, rules] of Object.entries(schema)) {
        let value = validatedConfig[key];

        // Apply default if undefined
        if (value === undefined && rules.default !== undefined) {
            value = rules.default;
            validatedConfig[key] = value;
        }

        // Check required
        if (rules.required && (value === undefined || value === null || value === '')) {
            errors.push(`Missing required field: ${key}`);
            continue;
        }

        // Skip type check if optional and missing
        if (value === undefined) continue;

        // Type check
        if (rules.type === 'array') {
            if (!Array.isArray(value)) {
                errors.push(`Field ${key} must be an array`);
            }
        } else if (rules.type === 'boolean') {
            if (typeof value !== 'boolean') {
                errors.push(`Field ${key} must be of type boolean, got ${typeof value}`);
            }
        } else if (typeof value !== rules.type) {
            errors.push(`Field ${key} must be of type ${rules.type}, got ${typeof value}`);
        }

        // Enum check
        if (rules.enum && !rules.enum.includes(value)) {
            errors.push(`Field ${key} must be one of: ${rules.enum.join(', ')}`);
        }

        // String constraints
        if (rules.type === 'string') {
            if (rules.minLength && value.length < rules.minLength) {
                errors.push(`Field ${key} must be at least ${rules.minLength} characters`);
            }
        }

        // Number constraints
        if (rules.type === 'number') {
            if (rules.min !== undefined && value < rules.min) {
                errors.push(`Field ${key} must be at least ${rules.min}`);
            }
        }
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n- ${errors.join('\n- ')}`);
    }

    return validatedConfig;
}

export {
    OrchestratorConfigSchema,
    WorkerConfigSchema,
    validateConfig
};
