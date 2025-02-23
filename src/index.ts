import express from "express";
import cors from "cors";
import cron from "node-cron";
import config from "./config"; // This will load dotenv
import { CORS_CONFIG, RATE_UPDATE_CRON, getForexConfig } from "./constants";
import { rateService } from "./services/rateService";
import routes from "./routes";

const app = express();
const port = config.port;

// Middleware
app.use(cors(CORS_CONFIG));
app.use(express.json());

// Routes
app.use("/api", routes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Periodic rate update function
async function updateAllRates(): Promise<void> {
  try {
    console.log("Starting periodic rate update...");
    const config = getForexConfig();
    await rateService.aggregateForexRates(config);
    console.log("Periodic rate update completed successfully");
  } catch (error) {
    console.error("Error during periodic rate update:", error);
  }
}

// Schedule updates using the configured cron expression
cron.schedule(RATE_UPDATE_CRON, updateAllRates);

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
try {
  app.listen(port, async () => {
    console.log(`Forex rate aggregator running on port ${port}`);
    try {
      // Perform initial update when server starts
      console.log("Performing initial rate update...");
      await updateAllRates();
      console.log("Initial rate update completed successfully");
    } catch (error) {
      console.error("Failed to perform initial rate update:", error);
      console.log("Server will continue running, rates will be updated on next scheduled interval");
    }
  });
} catch (error) {
  console.error("Failed to start server:", error);
  process.exit(1);
}

export default app;
