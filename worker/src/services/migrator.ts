import logger from "../utils/logger";
import config from "../config";
import database from "./database";
import salesforceExtractor from "../extractors/salesforce";
import hubspotLoader from "../loaders/hubspot";
import ownerMapper from "./owner-mapper";
import { ObjectType, MigrationRun, SalesforceRecord } from "../types";

interface FieldMapping {
  salesforceField: string;
  hubspotField: string;
  enabled: boolean;
}

class Migrator {
  private runId: string | null = null;
  private shouldStop: boolean = false;
  private isPolling: boolean = false;

  /**
   * Start polling for queued migrations
   */
  async startPolling(): Promise<void> {
    this.isPolling = true;
    logger.info("🔍 Started polling for queued migrations...");

    while (this.isPolling) {
      try {
        // Check for queued migrations
        const queuedRuns = await database.getQueuedMigrationRuns();

        if (queuedRuns.length > 0) {
          logger.info(`Found ${queuedRuns.length} queued migration(s)`);

          for (const run of queuedRuns) {
            if (this.shouldStop) break;
            await this.executeMigration(run);
          }
        }

        // Wait 5 seconds before checking again
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } catch (error: any) {
        logger.error("Error in polling loop", { error: error.message });
        // Wait a bit longer on error
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }

  /**
   * Execute a queued migration
   */
  private async executeMigration(run: MigrationRun): Promise<void> {
    this.runId = run.id;
    logger.info(`📦 Starting migration run: ${this.runId}`);

    try {
      // Update status to running
      await database.updateMigrationRun(this.runId, { status: "running" });

      // Parse config
      const config = run.config_snapshot as any;
      const migrationType = config.migrationType;
      const fieldMappings: FieldMapping[] = config.fieldMappings || [];
      const testMode = config.testMode || false;
      const testModeLimit = config.testModeLimit || 5;

      if (testMode) {
        logger.info(`🧪 TEST MODE: Will migrate only ${testModeLimit} records`);
      }

      logger.info(`Migration type: ${migrationType}`, {
        fieldCount: fieldMappings.filter((f) => f.enabled).length,
        testMode,
      });

      // Connect to Salesforce
      await salesforceExtractor.connect();

      // Execute based on migration type
      if (migrationType === "account_to_company") {
        await this.migrateAccountsToCompanies(
          fieldMappings,
          testMode,
          testModeLimit,
        );
      } else if (migrationType === "opportunity_renewal_associations") {
        await this.migrateOpportunityRenewalAssociations(
          testMode,
          testModeLimit,
        );
      } else {
        throw new Error(`Unknown migration type: ${migrationType}`);
      }

      // Mark migration as completed
      await database.updateMigrationRun(this.runId, {
        status: "completed",
        completed_at: new Date(),
      });

      await database.createAuditLog(this.runId, "migration_completed");

      logger.info("✅ Migration completed successfully");
    } catch (error: any) {
      logger.error("❌ Migration failed", { error: error.message });

      if (this.runId) {
        await database.updateMigrationRun(this.runId, {
          status: "failed",
          completed_at: new Date(),
          notes: error.message,
        });

        await database.createAuditLog(
          this.runId,
          "migration_failed",
          undefined,
          undefined,
          {
            error: error.message,
          },
        );
      }

      throw error;
    } finally {
      // Cleanup
      await salesforceExtractor.disconnect();
    }
  }

  /**
   * Migrate Salesforce Accounts to HubSpot Companies
   */
  private async migrateAccountsToCompanies(
    fieldMappings: FieldMapping[],
    testMode: boolean = false,
    testModeLimit: number = 5,
  ): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "companies";

    logger.info("📦 Starting Account to Company migration");

    try {
      // Create progress tracking
      await database.createMigrationProgress(
        this.runId,
        objectType,
        "in_progress",
      );
      await database.updateMigrationProgress(this.runId, objectType, {
        started_at: new Date(),
      });

      // Initialize owner mapper
      logger.info("Initializing owner mapper...");
      const connection = salesforceExtractor.getConnection();
      if (!connection) {
        throw new Error("Salesforce connection not available");
      }
      await ownerMapper.initialize(connection, this.runId);
      logger.info("Owner mapper initialized");

      // Get enabled field mappings
      const enabledMappings = fieldMappings.filter((m) => m.enabled);
      const sfFields = ["Id", ...enabledMappings.map((m) => m.salesforceField)];

      logger.info(`Extracting fields: ${sfFields.join(", ")}`);

      // Get total count
      const totalRecords = await salesforceExtractor.getRecordCount("Account");
      const recordsToMigrate = testMode
        ? Math.min(testModeLimit, totalRecords)
        : totalRecords;

      await database.updateMigrationProgress(this.runId, objectType, {
        total_records: recordsToMigrate,
      });

      if (testMode) {
        logger.info(
          `🧪 TEST MODE: Will process ${recordsToMigrate} of ${totalRecords} total Accounts`,
        );
      } else {
        logger.info(`Total Accounts to migrate: ${totalRecords}`);
      }

      let lastId: string | undefined;
      let processedCount = 0;
      let hasMore = true;

      while (hasMore && !this.shouldStop) {
        // In test mode, stop if we've reached the limit
        if (testMode && processedCount >= testModeLimit) {
          logger.info(
            `🧪 TEST MODE: Reached limit of ${testModeLimit} records, stopping`,
          );
          break;
        }

        // Calculate batch size (respect test mode limit)
        const batchSize = testMode
          ? Math.min(config.migration.batchSize, testModeLimit - processedCount)
          : config.migration.batchSize;

        // Extract batch from Salesforce
        const extractResult = await salesforceExtractor.extract(
          "Account",
          sfFields,
          batchSize,
          lastId,
        );

        logger.info(
          `Extracted ${extractResult.records.length} Accounts from Salesforce`,
        );

        if (extractResult.records.length === 0) {
          break;
        }

        // In test mode, limit the records we process
        const recordsToProcess = testMode
          ? extractResult.records.slice(0, testModeLimit - processedCount)
          : extractResult.records;

        // Transform and load
        await this.processBatch(objectType, recordsToProcess, enabledMappings);

        // Update progress
        processedCount += recordsToProcess.length;
        lastId = extractResult.nextPage;
        hasMore =
          extractResult.hasMore &&
          (!testMode || processedCount < testModeLimit);

        await database.updateMigrationProgress(this.runId, objectType, {
          processed_records: processedCount,
          last_sf_id_processed: lastId,
        });

        logger.info(
          `Progress: ${processedCount}/${totalRecords} Accounts processed`,
        );
      }

      // Mark as completed
      await database.updateMigrationProgress(this.runId, objectType, {
        status: "completed",
        completed_at: new Date(),
      });

      await database.createAuditLog(
        this.runId,
        "object_migration_completed",
        objectType,
        processedCount,
      );

      logger.info(
        `✅ Completed Account to Company migration: ${processedCount} records`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to migrate Accounts to Companies", {
        error: error.message,
      });

      await database.updateMigrationProgress(this.runId, objectType, {
        status: "failed",
        completed_at: new Date(),
      });

      throw error;
    }
  }

  /**
   * Process a batch of records
   */
  private async processBatch(
    objectType: ObjectType,
    records: SalesforceRecord[],
    fieldMappings: FieldMapping[],
  ): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const transformedRecords: Array<{
      salesforceId: string;
      properties: Record<string, any>;
    }> = [];

    // Transform records using field mappings
    for (const record of records) {
      try {
        const properties: Record<string, any> = {};

        // Apply field mappings
        for (const mapping of fieldMappings) {
          if (mapping.enabled) {
            const value = record[mapping.salesforceField];

            // Special handling for OwnerId field
            if (mapping.salesforceField === "OwnerId" && value) {
              const hsOwnerId = ownerMapper.getHubSpotOwnerId(value);
              if (hsOwnerId) {
                properties[mapping.hubspotField] = hsOwnerId;
                logger.debug("Mapped owner", {
                  sfOwnerId: value,
                  hsOwnerId: hsOwnerId,
                  recordId: record.Id,
                });
              } else {
                logger.warn("No HubSpot owner mapping found", {
                  sfOwnerId: value,
                  recordId: record.Id,
                });
              }
            } else if (value !== null && value !== undefined) {
              // Special handling for domain field - validate before setting
              if (mapping.hubspotField === "domain") {
                const cleanDomain = this.validateDomain(value);
                if (cleanDomain) {
                  properties[mapping.hubspotField] = cleanDomain;
                }
              } else {
                const transformedValue = this.transformValue(
                  value,
                  mapping.hubspotField,
                );
                // Only set the property if transformation returned a valid value
                if (transformedValue !== null) {
                  properties[mapping.hubspotField] = transformedValue;
                }
              }
            }
          }
        }

        // Add Salesforce Account ID for reference
        // Note: salesforce_id removed - property doesn't exist in HubSpot
        properties["salesforce_account_id"] = record.Id;

        transformedRecords.push({
          salesforceId: record.Id,
          properties,
        });
      } catch (error: any) {
        logger.warn("Failed to transform record", {
          salesforceId: record.Id,
          error: error.message,
        });

        await database.createMigrationError(
          this.runId,
          objectType,
          record.Id,
          "Account",
          `Transformation failed: ${error.message}`,
        );

        await database.incrementFailedRecords(this.runId, objectType, 1);
      }
    }

    // Load to HubSpot in batch
    if (transformedRecords.length > 0) {
      const loadResult = await hubspotLoader.batchCreate(
        "companies",
        transformedRecords,
      );

      // Store ID mappings for successful records
      if (loadResult.successful.length > 0) {
        await database.bulkCreateIdMappings(
          loadResult.successful.map((item) => ({
            runId: this.runId!,
            salesforceId: item.salesforceId,
            salesforceType: "Account",
            hubspotId: item.hubspotId,
            hubspotType: "company",
          })),
        );

        logger.info(
          `Successfully loaded ${loadResult.successful.length} companies to HubSpot`,
        );
      }

      // Log failed loads
      for (const failed of loadResult.failed) {
        await database.createMigrationError(
          this.runId,
          objectType,
          failed.salesforceId,
          "Account",
          failed.error,
        );
      }

      if (loadResult.failed.length > 0) {
        await database.incrementFailedRecords(
          this.runId,
          objectType,
          loadResult.failed.length,
        );
        logger.warn(
          `Failed to load ${loadResult.failed.length} companies to HubSpot`,
        );
      }
    }
  }

  /**
   * Transform value for HubSpot
   */
  private transformValue(value: any, hubspotField?: string): any {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle HubSpot enum field transformations
    if (hubspotField) {
      const transformed = this.transformEnumValue(value, hubspotField);
      if (transformed !== value) {
        return transformed;
      }
    }

    // Convert Date objects to ISO string
    if (value instanceof Date) {
      return value.toISOString();
    }

    // Convert numbers to strings if needed
    if (typeof value === "number") {
      return value.toString();
    }

    // Convert boolean to string
    if (typeof value === "boolean") {
      return value.toString();
    }

    return value;
  }

  /**
   * Validate and clean domain values
   */
  private validateDomain(value: any): string | null {
    if (typeof value !== "string" || !value) {
      return null;
    }

    const lowerValue = value.toLowerCase().trim();

    // Filter out invalid domains
    const invalidDomains = [
      "about:blank",
      "localhost",
      "example.com",
      "test.com",
      "none",
      "n/a",
      "na",
      "null",
      "undefined",
    ];

    if (invalidDomains.includes(lowerValue)) {
      logger.debug(`Skipping invalid domain: "${value}"`);
      return null;
    }

    // Remove protocol if present
    let cleanDomain = value.replace(/^https?:\/\//i, "");

    // Remove path if present (keep only domain)
    cleanDomain = cleanDomain.split("/")[0];

    // Remove port if present
    cleanDomain = cleanDomain.split(":")[0];

    // Basic domain validation - must have at least one dot and valid characters
    if (
      !/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(
        cleanDomain,
      )
    ) {
      logger.debug(`Invalid domain format: "${value}"`);
      return null;
    }

    return cleanDomain;
  }

  /**
   * Transform enum values to match HubSpot's expected format
   */
  private transformEnumValue(value: any, hubspotField: string): any {
    if (typeof value !== "string") {
      return value;
    }

    const lowerValue = value.toLowerCase();

    // Industry field transformations
    if (hubspotField === "industry") {
      // HubSpot expects uppercase with underscores
      // Common mappings
      const industryMap: Record<string, string> = {
        insurance: "INSURANCE",
        technology: "TECHNOLOGY",
        healthcare: "HOSPITAL_HEALTH_CARE",
        "health care": "HOSPITAL_HEALTH_CARE",
        financial: "FINANCIAL_SERVICES",
        "financial services": "FINANCIAL_SERVICES",
        "lending & brokerage": "FINANCIAL_SERVICES",
        "lending brokerage": "FINANCIAL_SERVICES",
        lending: "FINANCIAL_SERVICES",
        brokerage: "FINANCIAL_SERVICES",
        banking: "BANKING",
        retail: "RETAIL",
        manufacturing: "MANUFACTURING",
        education: "EDUCATION_MANAGEMENT",
        "real estate": "REAL_ESTATE",
        construction: "CONSTRUCTION",
        consulting: "MANAGEMENT_CONSULTING",
        "business services": "BUSINESS_SUPPLIES_AND_EQUIPMENT",
        "business supplies": "BUSINESS_SUPPLIES_AND_EQUIPMENT",
        automotive: "AUTOMOTIVE",
        telecommunications: "TELECOMMUNICATIONS",
        media: "MEDIA_PRODUCTION",
        hospitality: "HOSPITALITY",
        agriculture: "FARMING",
        "oil & gas": "OIL_ENERGY",
        energy: "OIL_ENERGY",
        transportation: "TRANSPORTATION_TRUCKING_RAILROAD",
        logistics: "LOGISTICS_SUPPLY_CHAIN",
        legal: "LAW_PRACTICE",
        accounting: "ACCOUNTING",
      };

      if (industryMap[lowerValue]) {
        return industryMap[lowerValue];
      }

      // For unmapped industry values, skip the field by returning null
      logger.info(
        `Unknown industry value: "${value}", skipping field (leaving empty)`,
      );
      return null;
    }

    // Company type field transformations
    if (hubspotField === "type") {
      // HubSpot expects: PROSPECT, PARTNER, RESELLER, VENDOR, OTHER, ACTIVE_OPPORTUNITY, CUSTOMER (custom)
      const typeMap: Record<string, string> = {
        prospect: "PROSPECT",
        customer: "CUSTOMER", // Now maps to custom CUSTOMER value in HubSpot
        partner: "PARTNER",
        reseller: "RESELLER",
        vendor: "VENDOR",
        engaged: "PROSPECT", // Map engaged to prospect
        active_opportunity: "ACTIVE_OPPORTUNITY", // Now maps to custom ACTIVE_OPPORTUNITY value
        "active opportunity": "ACTIVE_OPPORTUNITY", // Handle with space too
        other: "OTHER",
      };

      if (typeMap[lowerValue]) {
        return typeMap[lowerValue];
      }

      // Default to OTHER for unmapped values
      logger.warn(`Unknown type value: "${value}", defaulting to: OTHER`);
      return "OTHER";
    }

    return value;
  }

  /**
   * Migrate Opportunity renewal associations to HubSpot Deal associations
   */
  private async migrateOpportunityRenewalAssociations(
    testMode: boolean = false,
    testModeLimit: number = 5,
  ): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "deal_associations";

    logger.info("📦 Starting Opportunity Renewal Association migration");

    try {
      // Create progress tracking
      await database.createMigrationProgress(
        this.runId,
        objectType,
        "in_progress",
      );
      await database.updateMigrationProgress(this.runId, objectType, {
        started_at: new Date(),
      });

      // Get association label IDs from HubSpot
      logger.info("Fetching association label IDs from HubSpot...");
      const associationIds = await hubspotLoader.getDealAssociationLabelIds(
        "renewed_in_renewal_of",
      );

      if (!associationIds) {
        throw new Error(
          'Association label "renewed_in_renewal_of" not found in HubSpot. Please create this custom association label in your HubSpot account first.',
        );
      }

      logger.info("Association label IDs retrieved", {
        renewedInTypeId: associationIds.forward,
        renewalOfTypeId: associationIds.reverse,
      });

      // Get total count of opportunities with renewals
      const totalRecords = await salesforceExtractor.getRecordCount(
        "Opportunity WHERE renewal_opportunity__c != null",
      );

      const recordsToMigrate = testMode
        ? Math.min(testModeLimit, totalRecords)
        : totalRecords;

      await database.updateMigrationProgress(this.runId, objectType, {
        total_records: recordsToMigrate,
      });

      if (testMode) {
        logger.info(
          `🧪 TEST MODE: Will process ${recordsToMigrate} of ${totalRecords} total Opportunities with renewals`,
        );
      } else {
        logger.info(
          `Total Opportunities with renewals to process: ${totalRecords}`,
        );
      }

      let lastId: string | undefined;
      let processedCount = 0;
      let successCount = 0;
      let failedCount = 0;
      let hasMore = true;

      while (hasMore && !this.shouldStop) {
        // In test mode, stop if we've reached the limit
        if (testMode && processedCount >= testModeLimit) {
          logger.info(
            `🧪 TEST MODE: Reached limit of ${testModeLimit} records, stopping`,
          );
          break;
        }

        // Calculate batch size (respect test mode limit)
        const batchSize = testMode
          ? Math.min(config.migration.batchSize, testModeLimit - processedCount)
          : config.migration.batchSize;

        // Extract batch from Salesforce
        const extractResult =
          await salesforceExtractor.extractOpportunitiesWithRenewals(
            batchSize,
            lastId,
          );

        logger.info(
          `Extracted ${extractResult.records.length} Opportunities with renewals from Salesforce`,
        );

        if (extractResult.records.length === 0) {
          break;
        }

        // In test mode, limit the records we process
        const recordsToProcess = testMode
          ? extractResult.records.slice(0, testModeLimit - processedCount)
          : extractResult.records;

        // Process each opportunity renewal relationship
        for (const opportunity of recordsToProcess) {
          if (this.shouldStop) break;

          try {
            const opportunityId = opportunity.Id;
            const renewalOpportunityId = opportunity.renewal_opportunity__c;

            logger.debug("Processing renewal relationship", {
              opportunityId,
              renewalOpportunityId,
            });

            // Find the source deal (the opportunity being renewed)
            const sourceDealId = await hubspotLoader.searchDealsByProperty(
              "hs_salesforceopportunityid",
              opportunityId,
            );

            if (!sourceDealId) {
              logger.warn("Source deal not found in HubSpot", {
                salesforceOpportunityId: opportunityId,
              });
              await database.createMigrationError(
                this.runId,
                objectType,
                opportunityId,
                "Opportunity",
                `Source deal not found in HubSpot for Salesforce Opportunity ID: ${opportunityId}`,
              );
              failedCount++;
              continue;
            }

            // Find the target deal (the renewal opportunity)
            const targetDealId = await hubspotLoader.searchDealsByProperty(
              "hs_salesforceopportunityid",
              renewalOpportunityId,
            );

            if (!targetDealId) {
              logger.warn("Target renewal deal not found in HubSpot", {
                salesforceRenewalOpportunityId: renewalOpportunityId,
              });
              await database.createMigrationError(
                this.runId,
                objectType,
                opportunityId,
                "Opportunity",
                `Renewal deal not found in HubSpot for Salesforce Opportunity ID: ${renewalOpportunityId}`,
              );
              failedCount++;
              continue;
            }

            // Create bidirectional associations
            console.log("=== CREATING ASSOCIATIONS ===");
            console.log(`  Source Opportunity ID: ${opportunityId}`);
            console.log(`  Renewal Opportunity ID: ${renewalOpportunityId}`);
            console.log(`  Source Deal ID: ${sourceDealId}`);
            console.log(`  Target Deal ID: ${targetDealId}`);
            console.log(`  Forward Type ID: ${associationIds.forward}`);
            console.log(`  Reverse Type ID: ${associationIds.reverse}`);
            console.log("============================");

            // Source deal "renewed in" target deal
            await hubspotLoader.createAssociation(
              "deals",
              sourceDealId,
              "deals",
              targetDealId,
              associationIds.forward,
            );

            logger.info("Created forward association (renewed in)", {
              from: sourceDealId,
              to: targetDealId,
            });

            // Target deal "renewal of" source deal
            await hubspotLoader.createAssociation(
              "deals",
              targetDealId,
              "deals",
              sourceDealId,
              associationIds.reverse,
            );

            logger.info("Created reverse association (renewal of)", {
              from: targetDealId,
              to: sourceDealId,
            });

            logger.info("Successfully created renewal associations", {
              sourceDealId,
              targetDealId,
              salesforceOpportunityId: opportunityId,
              salesforceRenewalOpportunityId: renewalOpportunityId,
            });

            successCount++;
          } catch (error: any) {
            logger.error("Failed to create renewal association", {
              opportunityId: opportunity.Id,
              error: error.message,
            });

            await database.createMigrationError(
              this.runId,
              objectType,
              opportunity.Id,
              "Opportunity",
              `Failed to create association: ${error.message}`,
            );

            failedCount++;
          }
        }

        // Update progress
        processedCount += recordsToProcess.length;
        lastId = extractResult.nextPage;
        hasMore =
          extractResult.hasMore &&
          (!testMode || processedCount < testModeLimit);

        await database.updateMigrationProgress(this.runId, objectType, {
          processed_records: processedCount,
          last_sf_id_processed: lastId,
        });

        logger.info(
          `Progress: ${processedCount}/${recordsToMigrate} Opportunities processed (${successCount} successful, ${failedCount} failed)`,
        );
      }

      // Update final counts
      await database.updateMigrationProgress(this.runId, objectType, {
        status: "completed",
        completed_at: new Date(),
        failed_records: failedCount,
      });

      await database.createAuditLog(
        this.runId,
        "object_migration_completed",
        objectType,
        processedCount,
        {
          successCount,
          failedCount,
        },
      );

      logger.info(
        `✅ Completed Opportunity Renewal Association migration: ${processedCount} records processed (${successCount} successful, ${failedCount} failed)`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to migrate Opportunity Renewal Associations", {
        error: error.message,
      });

      await database.updateMigrationProgress(this.runId, objectType, {
        status: "failed",
        completed_at: new Date(),
      });

      throw error;
    }
  }

  /**
   * Stop the migrator
   */
  stop(): void {
    logger.warn("Stopping migration worker...");
    this.shouldStop = true;
    this.isPolling = false;
  }
}

export default new Migrator();
