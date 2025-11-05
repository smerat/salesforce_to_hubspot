#!/usr/bin/env node

import logger from "./utils/logger";
import migrator from "./services/migrator";
import database from "./services/database";

/**
 * Main entry point for the migration worker
 * Worker runs in passive mode, polling for queued migrations
 */
async function main() {
  logger.info("🔧 Salesforce to HubSpot Migration Worker");
  logger.info("==========================================");
  logger.info("Worker is running in passive mode");
  logger.info("Waiting for migration tasks from dashboard...");
  logger.info("");

  try {
    // Start polling for queued migrations
    await migrator.startPolling();
  } catch (error: any) {
    logger.error("❌ Worker failed:", {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack,
    });
    console.error("\nFull error details:", error);
    process.exit(1);
  } finally {
    // Cleanup
    await database.close();
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  logger.warn("Received SIGINT, stopping worker...");
  migrator.stop();
  await database.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.warn("Received SIGTERM, stopping worker...");
  migrator.stop();
  await database.close();
  process.exit(0);
});

// Start the application
main().catch((error) => {
  logger.error("Unhandled error:", error);
  process.exit(1);
});
