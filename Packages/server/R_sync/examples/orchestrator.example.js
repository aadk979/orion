/**
 * R_Sync Orchestrator Example
 *
 * This example demonstrates how to start an orchestrator node
 * that accepts worker registrations, receives worker events,
 * and can broadcast or send targeted events.
 *
 * Run with: npm run start:orchestrator
 */

import { R_Sync } from '../index.js';

// Create orchestrator instance
const orchestrator = new R_Sync({
    role: 'ORCHESTRATOR',
    publicIp: '127.0.0.1',
    port: 55321,
    encryptionAlg: 'ECC_256',
    cluster: 'default' // Required: cluster name for validation
});

// Register handler for events coming FROM workers
orchestrator.onWorkerEvent((workerId, event) => {
    console.log('\n===========================================');
    console.log('   WORKER EVENT RECEIVED');
    console.log('===========================================');
    console.log(`   From Worker: ${workerId}`);
    console.log(`   Event Name: ${event.name}`);
    console.log(`   Event ID: ${event.id}`);
    console.log(`   Data:`, JSON.stringify(event.data, null, 2));
    console.log('===========================================\n');

    // Example: respond back to the specific worker that sent the event
    orchestrator
        .sendTo(workerId, 'ack:received', {
            originalEventId: event.id,
            message: 'Your event was received!'
        })
        .catch(err => console.error('Failed to ack worker:', err.message));
});

// Start the orchestrator
await orchestrator.startOrchestrator();

console.log('\n===========================================');
console.log('   R_Sync Orchestrator Running');
console.log('===========================================');
console.log(`   Listening on port: 55321`);
console.log(`   Discovery API:   POST /r_sync/api/v1/discover-me`);
console.log(`   Workers API:     GET  /r_sync/api/v1/workers`);
console.log(`   Broadcast API:   POST /r_sync/api/v1/broadcast`);
console.log(`   Send-To API:     POST /r_sync/api/v1/send-to`);
console.log(`   Worker Event:    POST /r_sync/api/v1/worker-event`);
console.log('===========================================\n');

// Example: Broadcast an event every 10 seconds
let eventCount = 0;

setInterval(async () => {
    eventCount++;

    console.log(`\nBroadcasting test event #${eventCount}...`);

    try {
        const results = await orchestrator.broadcast('system:heartbeat', {
            eventNumber: eventCount,
            message: `Heartbeat event ${eventCount}`,
            timestamp: new Date().toISOString()
        });

        const successCount = results.filter(r => r.success).length;
        console.log(`Broadcast complete: ${successCount}/${results.length} workers reached`);
    } catch (err) {
        console.log(`No workers to broadcast to yet: ${err.message}`);
    }
}, 10000);

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    console.log('\nShutting down orchestrator...');
    await orchestrator.stop();
    process.exit(0);
});
