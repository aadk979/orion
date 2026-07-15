import express from 'express';
import { handleEvent, getWorkerStatus } from '../controllers/workerController.js';

const router = express.Router();

// Receive encrypted events from orchestrator
router.post('/event', handleEvent);

// Worker status
router.get('/status', getWorkerStatus);

export { router as workerRoutes };
