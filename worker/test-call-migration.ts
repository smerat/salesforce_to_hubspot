import database from "./src/services/database";
import logger from "./src/utils/logger";

/**
 * Test script to create a call migration run in test mode
 */
async function createCallMigrationRun() {
  try {
    logger.info("Creating call migration run in TEST MODE...");

    const migrationRun = await database.createMigrationRun(
      "queued",
      {
        migrationType: "call_migration_from_excel",
        testMode: true,
        testModeLimit: 10, // Test with 10 unique calls first
      },
      "Test call migration from Excel files",
    );

    logger.info("✅ Migration run created successfully", {
      runId: migrationRun.id,
      status: migrationRun.status,
      config: migrationRun.config_snapshot,
    });

    console.log("\n" + "=".repeat(80));
    console.log("Migration Run Created");
    console.log("=".repeat(80));
    console.log(`Run ID: ${migrationRun.id}`);
    console.log(`Status: ${migrationRun.status}`);
    console.log(`Test Mode: ${migrationRun.config_snapshot?.testMode}`);
    console.log(
      `Test Mode Limit: ${migrationRun.config_snapshot?.testModeLimit}`,
    );
    console.log("=".repeat(80));
    console.log("\nNow start the worker to process this migration:");
    console.log("  cd worker && npm run dev");
    console.log("\nThen monitor progress in the dashboard:");
    console.log("  cd dashboard && npm run dev");
    console.log("=".repeat(80));

    await database.close();
  } catch (error: any) {
    logger.error("Failed to create migration run", {
      error: error.message,
    });
    console.error(error);
    process.exit(1);
  }
}

createCallMigrationRun();
