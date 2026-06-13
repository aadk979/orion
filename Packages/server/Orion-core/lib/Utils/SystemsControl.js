import { globalAccessPoint } from "./GlobalAccessPoint";
import { logger } from "./logger";
import { errorTrackerSystem } from "./Systems/ErrorTrackerSystem";

const SAFE_MODE_OVERRIDE_INFO = '(Only system config can perform this change and requires a restart of the application)'

class OrionSystemsControl {

    constructor(safeMode) {
        if (OrionSystemsControl.instance) {
            throw new Error('Only one instance of orion systems control is allowed');
        }

        this.safeMode = safeMode !== undefined ? safeMode : true;

        OrionSystemsControl.instance = this;

        globalAccessPoint.getValue("OrionSystemsControlServerLock")
    }

    lockServer() {
        globalAccessPoint.setValue("OrionSystemsControlServerLock", true);
        return true;
    }

    unlockServer() {
        globalAccessPoint.setValue("OrionSystemsControlServerLock", false);
        return true;
    }

    errorTrackerSystem() {
        return errorTrackerSystem;
    }

    deactivateSystemSecurity(system) {

        if (this.safeMode) {

            logger.warn(`Orion Systems Control: Unable to deactivate system "${system}" as safe mode is enabled. ${SAFE_MODE_OVERRIDE_INFO}`)
            return false;

        }

        const SUPPORTED_SYSTEMS = ["captcha", "deviceAuthorization", "dip"];

        if (!SUPPORTED_SYSTEMS.includes(system)) {
            throw new Error(`Orion Systems Control: Unable to deactivate system "${system}" as it does not exist`);
        }

        globalAccessPoint.setValue(system, false);

        return true;

    }

    reactivateSystemSecurity(system) {

        if (this.safeMode) {

            logger.warn(`Orion Systems Control: Unable to reactivate system "${system}" as safe mode is enabled. ${SAFE_MODE_OVERRIDE_INFO}`)
            return false;

        }

        const SUPPORTED_SYSTEMS = ["captcha", "deviceAuthorization", "dip"];

        if (!SUPPORTED_SYSTEMS.includes(system)) {
            throw new Error(`Orion Systems Control: Unable to reactivate system "${system}" as it does not exist`);
        }

        globalAccessPoint.setValue(system, true);

        return true;

    }

    deactivateMemoryMonitoring() {

        if (!globalAccessPoint.memoryMonitioringSystem().active) {
            return;
        }

        globalAccessPoint.memoryMonitioringSystem().stop();

        return;

    }

    reactivateMemoryMonitoring() {

        if (globalAccessPoint.memoryMonitioringSystem().active) {
            return;
        }

        globalAccessPoint.memoryMonitioringSystem().start();

        return;

    }

    pauseAuditTrail() {

        if (this.safeMode) {

            logger.warn(`Orion Systems Control: Unable to pause audit trail as safe mode is enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;

        }

        const auditTrail = globalAccessPoint.auditTrailSystem();

        if (auditTrail) {

            auditTrail.enabled = false;

        }

        return true;
    }

    resumeAuditTrail() {

        if (this.safeMode) {

            logger.warn(`Orion Systems Control: Unable to resume audit trail as safe mode is enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;

        }

        const auditTrail = globalAccessPoint.auditTrailSystem();

        if (auditTrail) {

            auditTrail.enabled = true;

        }

        return true;
    }
}