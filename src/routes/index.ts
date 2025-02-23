import { Router } from 'express';
import rateRoutes from './rateRoutes';

const router = Router();

// Mount rate routes
router.use('/', rateRoutes);

// Health check endpoint
router.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
