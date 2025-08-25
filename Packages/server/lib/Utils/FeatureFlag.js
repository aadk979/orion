// Default orion feature flags.
// Do not modify unless you know what you are doing.
// This file is used to manage feature flags in the database. It is used to enable or disable features in the application.

const { globalAccessPoint } = require("./GlobalAccessPoint");
const { tryCatch } = require("./TryCatch");

const defaultFeatureFlags = [
    "orion:sign-in-with-password:action:post:v1",
    "orion:sign-up-with-password:action:post:v1",
]

const getFeatureStatus = async (feature) => {
    const Function = async (parameters) => {
        const feature = parameters.feature;

        const db = globalAccessPoint.db();
        const featureFlag = await db.getData("FeatureFlags", feature);

        if (featureFlag.data === undefined) {
            return { error: false, active: true };
        }

        if (featureFlag.data.active === undefined) {
            return { error: false, active: true };
        }

        if (featureFlag.data.active === false) {
            return { error: false, active: false };
        }

        return { error: false, active: true };
    }

    const parameters = {
        feature: feature
    }

    const result = await tryCatch(Function, true, parameters);
    return result;
}

const setAllDefaultFeatureFlags = async (activeState = false) => {
    const Function = async (parameters) => {
        const db = globalAccessPoint.db();

        const results = await Promise.all(defaultFeatureFlags.map(async (feature) => {
            const storage = await db.addData("FeatureFlags", feature, { active: parameters.activeState });
            return { feature, ...storage };
        }));

        const errorResult = results.find(r => r.error);

        if (errorResult) {
            return { error: true, errorCode: "UNABLE-TO-SET-FEATURE-FLAG", feature: errorResult.feature };
        }

        return { error: false, completed: true };
    };

    const parameters = {
        activeState: activeState
    }

    const result = await tryCatch(Function, true, parameters);
    return result;
}

const setCustomFeatureFlags = async (features, activeState) => {
    const Function = async (parameters) => {
        const db = globalAccessPoint.db();

        const results = await Promise.all(parameters.features.map(async (feature) => {
            const storage = await db.addData("FeatureFlags", feature, { active: parameters.activeState });
            return { feature, ...storage };
        }));

        const errorResult = results.find(r => r.error);

        if (errorResult) {
            return { error: true, errorCode: "UNABLE-TO-SET-FEATURE-FLAG", feature: errorResult.feature };
        }

        return { error: false, completed: true };
    };

    const parameters = {
        features: features,
        activeState: activeState
    }

    const result = await tryCatch(Function, true, parameters);
    return result;
}

const setFeatureFlag = async (feature, activeState) => {
    const Function = async (parameters) => {
        const db = globalAccessPoint.db();
        const storage = await db.addData("FeatureFlags", parameters.feature, { active: parameters.activeState });

        if (storage.error) {
            return { error: true, errorCode: "UNABLE-TO-SET-FEATURE-FLAG", feature: parameters.feature };
        }

        return { error: false, completed: true };
    };

    const parameters = {
        feature: feature,
        activeState: activeState
    }

    const result = await tryCatch(Function, true, parameters);
    return result;
}

module.exports = { setAllDefaultFeatureFlags, setCustomFeatureFlags, setFeatureFlag, getFeatureStatus };