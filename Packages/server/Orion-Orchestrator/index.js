/**
 * Orion-Orchestrator (orion-orch) Package Exports
 *
 * Cluster control plane for the Orion (Alpine) authentication framework.
 * Supervises Orion-core nodes over R_Sync encrypted M2M tunnels.
 */

import { OrionOrchestrator } from './lib/OrionOrchestrator.js';
import { NodeRegistry } from './lib/NodeRegistry.js';
import { CommandDispatcher, DEFAULT_COMMAND_TIMEOUT_MS } from './lib/CommandDispatcher.js';
import { PolicyEngine, DEFAULT_POLICIES } from './lib/PolicyEngine.js';
import { ConsensusEngine } from './lib/ConsensusEngine.js';
import { ClusterHealth } from './lib/ClusterHealth.js';
import { EscalationHub } from './lib/EscalationHub.js';
import { RegistryStore, REGISTRY_FILE_NAME } from './lib/RegistryStore.js';
import {
    PROTOCOL_VERSION,
    ClusterEvents,
    ClusterCommands,
    ClusterAlerts,
    ALERT_SEVERITIES,
    ConsensusTopics,
    ClusterStates,
    buildCommandEnvelope,
    buildCommandResult,
    buildAlert,
    buildVote,
    buildClusterState,
    isKnownCommand,
    isKnownTopic
} from './lib/protocol.js';
import { __Version__, __Status__, __PackageType__ } from './lib/orch.meta.js';

export {
    OrionOrchestrator,
    NodeRegistry,
    CommandDispatcher,
    DEFAULT_COMMAND_TIMEOUT_MS,
    PolicyEngine,
    DEFAULT_POLICIES,
    ConsensusEngine,
    ClusterHealth,
    EscalationHub,
    RegistryStore,
    REGISTRY_FILE_NAME,
    PROTOCOL_VERSION,
    ClusterEvents,
    ClusterCommands,
    ClusterAlerts,
    ALERT_SEVERITIES,
    ConsensusTopics,
    ClusterStates,
    buildCommandEnvelope,
    buildCommandResult,
    buildAlert,
    buildVote,
    buildClusterState,
    isKnownCommand,
    isKnownTopic,
    __Version__,
    __Status__,
    __PackageType__
};

export default OrionOrchestrator;
