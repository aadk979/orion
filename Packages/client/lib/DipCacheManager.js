import { getDIP } from './API-Handlers/Helper/dip.js';
import { clientCacheTTLs } from './Configs.js';
import { SecureClientCache } from './Utils/SecureClientCache.js';

export class DIPCacheManager {
    constructor(systemConfig, Api, getAuthHeader) {
        this.systemConfig = systemConfig;
        this.Api = Api;
        this.getAuthHeader = getAuthHeader;
        this.dipConfig = null;
        this.secureCache = new SecureClientCache('CACHE');
        this.DIP_CACHE_NAMESPACE = 'ORION_DIP_CONFIG';
    }

    async fetchDIPFromServer() {
        const dipConfig = await getDIP({
            Api: this.Api,
            getAuthHeader: this.getAuthHeader,
            nameSpace: this.systemConfig.nameSpace
        });

        if (dipConfig.error) {
            this.dipConfig = { disabled: true };
        } else {
            this.dipConfig = dipConfig;
        }

        return dipConfig;
    }

    async cacheDIPConfig(dipConfig) {
        // Add additional DIP-specific metadata
        const cacheData = {
            ...dipConfig,
            unix: dipConfig.unix || Math.floor(Date.now() / 1000),
            cachedAt: Math.floor(Date.now() / 1000)
        };

        await this.secureCache.cacheData(
            cacheData,
            this.DIP_CACHE_NAMESPACE,
            clientCacheTTLs.dipConfig
        );
        
        return true;
    }

    async validateDIPCachePayload(payload) {
        // DIP-specific validation beyond the generic cache validation
        if (!payload || typeof payload !== 'object') {
            return { valid: false, reason: 'invalid_payload' };
        }

        // Check if DIP itself has expired (based on its own expiry timestamp)
        const currentUnix = Math.floor(Date.now() / 1000);
        if (payload.unix && (currentUnix - payload.unix) > clientCacheTTLs.dipConfig) {
            return { valid: false, reason: 'dip_expired' };
        }

        // Additional DIP-specific validations can be added here
        if (payload.disabled === true) {
            return { valid: false, reason: 'dip_disabled' };
        }

        return { valid: true, reason: 'valid' };
    }

    async getDIPConfig(globalAccessPoint) {
        // Try to retrieve from cache first
        const cacheResult = await this.secureCache.retrieveAndDecryptData(this.DIP_CACHE_NAMESPACE);
        
        if (cacheResult.exists && cacheResult.valid) {
            // Perform DIP-specific validation
            const dipValidation = await this.validateDIPCachePayload(cacheResult.payload);
            
            if (dipValidation.valid) {
                this.dipConfig = cacheResult.payload;
                globalAccessPoint.setValue('dipConfig', cacheResult.payload);
                return cacheResult.payload;
            }
            
            // DIP-specific validation failed, delete cache
            await this.secureCache.deleteCachedData(this.DIP_CACHE_NAMESPACE);
        }

        // Cache doesn't exist or is invalid, fetch from server
        const dipConfig = await this.fetchDIPFromServer();
        globalAccessPoint.setValue('dipConfig', dipConfig);
        
        // Cache the fresh DIP config
        await this.cacheDIPConfig(dipConfig);
        
        return dipConfig;
    }

    async refreshDIPConfig(globalAccessPoint) {
        // Force refresh by deleting cache and fetching fresh
        await this.secureCache.deleteCachedData(this.DIP_CACHE_NAMESPACE);
        return await this.getDIPConfig(globalAccessPoint);
    }

    async clearDIPCache() {
        return await this.secureCache.deleteCachedData(this.DIP_CACHE_NAMESPACE);
    }
}