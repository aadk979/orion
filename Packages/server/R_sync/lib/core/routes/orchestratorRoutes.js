import express from "express";
import {
  registerWorker,
  getWorkers,
  broadcastEvent,
  heartbeat,
  getStatus,
  flushSystem,
  handleWorkerEvent,
  sendToWorkerById,
} from "../controllers/orchestratorController.js";
import {
  restrictToLocalhost,
  enforceETSLockdown,
  validateWorkerSignature,
  validateRegistrationSignature,
} from "../middleware/securityMiddleware.js";

const router = express.Router();

// Worker discovery/registration (Protected by PoP + ETS lockdown guard)
router.post(
  "/discover-me",
  enforceETSLockdown,
  validateRegistrationSignature,
  registerWorker,
);

// List all workers (Admin only - Localhost)
router.get("/workers", restrictToLocalhost, getWorkers);

// Broadcast event to all workers (Admin only - Localhost)
router.post("/broadcast", restrictToLocalhost, broadcastEvent);

// Receive event from a worker (Authenticated + ETS lockdown guard)
router.post(
  "/worker-event",
  enforceETSLockdown,
  validateWorkerSignature,
  handleWorkerEvent,
);

// Send event to a specific worker by ID (Admin only - Localhost)
router.post("/send-to", restrictToLocalhost, sendToWorkerById);

// Worker heartbeat (Authenticated + ETS lockdown guard)
router.post(
  "/heartbeat",
  enforceETSLockdown,
  validateWorkerSignature,
  heartbeat,
);

// Orchestrator status (Admin only - Localhost)
router.get("/status", restrictToLocalhost, getStatus);

// Flush system (Admin only - Localhost)
router.post("/flush", restrictToLocalhost, flushSystem);

export { router as orchestratorRoutes };
