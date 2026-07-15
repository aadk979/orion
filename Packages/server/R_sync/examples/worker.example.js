/**
 * R_Sync Worker Example
 * 
 * This example demonstrates how to start a worker node
 * that registers with an orchestrator, receives events,
 * and can emit events to the orchestrator.
 * 
 * Run with: npm run start:worker
 * 
 * Note: Make sure the orchestrator is running first!
 */

import { R_Sync } from '../index.js';

// Create worker instance
const worker = new R_Sync({
    role: 'WORKER',
    publicIp: '127.0.0.1',
    port: 55322,
    orchestratorIp: '127.0.0.1',
    orchestratorPort: 55321,
    encryptionAlg: 'ECC_256',
    heartbeatIntervalMs: 30000,  // Send heartbeat every 30 seconds
    cluster: 'default'  // Required: must match orchestrator cluster
});

// Register event handler BEFORE starting
worker.onEvent((event) => {
    console.log('\n===========================================');
    console.log('   EVENT RECEIVED');
    console.log('===========================================');
    console.log(`   Event Name: ${event.name}`);
    console.log(`   Event ID: ${event.id}`);
    console.log(`   Timestamp: ${new Date(event.timestamp * 1000).toISOString()}`);
    console.log(`   Data:`, JSON.stringify(event.data, null, 2));
    console.log('===========================================\n');
});

// Start the worker (this will register with orchestrator)
try {
    await worker.startWorker();

    console.log('\n===========================================');
    console.log('   R_Sync Worker Running');
    console.log('===========================================');
    console.log(`   Worker ID: ${worker.workerId}`);
    console.log(`   Listening on port: 55322`);
    console.log(`   Connected to orchestrator: 127.0.0.1:55321`);
    console.log('   Waiting for events...');
    console.log('===========================================\n');

    // Example: Emit a status report to the orchestrator after 5 seconds
    setTimeout(async () => {
        try {
            console.log('Sending status report to orchestrator...');
            const result = await worker.emitToOrchestrator('status:report', {
                cpuUsage: '12%',
                memoryUsage: '45%',
                uptime: process.uptime()
            });
            console.log('Status report sent!', result);
        } catch (err) {
            console.error('Failed to send status report:', err.message);
        }
    }, 5000);

} catch (err) {
    console.error('Failed to start worker:', err.message);
    console.error('Make sure the orchestrator is running first!');
    process.exit(1);
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    console.log('\nShutting down worker...');
    await worker.stop();
    process.exit(0);
});

