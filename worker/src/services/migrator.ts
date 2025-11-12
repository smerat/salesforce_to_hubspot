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
      } else if (migrationType === "pilot_opportunity_associations") {
        await this.migratePilotOpportunityAssociations(testMode, testModeLimit);
      } else if (migrationType === "event_to_meeting_migration") {
        await this.migrateEventsToMeetings(testMode, testModeLimit);
      } else if (migrationType === "opportunity_product_dates") {
        await this.migrateOpportunityProductDates(testMode, testModeLimit);
      } else if (migrationType === "sync_deal_contract_dates") {
        await this.syncDealContractDates(testMode, testModeLimit);
      } else if (migrationType === "opportunity_line_item_dates") {
        await this.migrateOpportunityLineItemDates(testMode, testModeLimit);
      } else if (migrationType === "line_items") {
        await this.migrateLineItems(testMode, testModeLimit);
      } else if (migrationType === "cleanup_tasks") {
        await this.cleanupHubSpotTasks();
      } else if (migrationType === "cleanup_meetings") {
        await this.cleanupHubSpotMeetings();
      } else if (migrationType === "cleanup_line_items") {
        await this.cleanupHubSpotLineItems();
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
          failed_records: failedCount,
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
   * Migrate Pilot Opportunity associations to HubSpot Deal associations
   */
  private async migratePilotOpportunityAssociations(
    testMode: boolean = false,
    testModeLimit: number = 5,
  ): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "deal_associations";

    logger.info("📦 Starting Pilot Opportunity Association migration");

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
        "has_pilot_pilot_for",
      );

      if (!associationIds) {
        throw new Error(
          'Association label "has_pilot_pilot_for" not found in HubSpot. Please create this custom association label in your HubSpot account first.',
        );
      }

      logger.info("Association label IDs retrieved", {
        hasPilotTypeId: associationIds.forward,
        pilotForTypeId: associationIds.reverse,
      });

      // Get total count of opportunities with pilots
      const totalRecords = await salesforceExtractor.getRecordCount(
        "Opportunity WHERE Pilot_Opportunity__c != null",
      );

      const recordsToMigrate = testMode
        ? Math.min(testModeLimit, totalRecords)
        : totalRecords;

      await database.updateMigrationProgress(this.runId, objectType, {
        total_records: recordsToMigrate,
      });

      if (testMode) {
        logger.info(
          `🧪 TEST MODE: Will process ${recordsToMigrate} of ${totalRecords} total Opportunities with pilots`,
        );
      } else {
        logger.info(
          `Total Opportunities with pilots to process: ${totalRecords}`,
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
          await salesforceExtractor.extractOpportunitiesWithPilots(
            batchSize,
            lastId,
          );

        logger.info(
          `Extracted ${extractResult.records.length} Opportunities with pilots from Salesforce`,
        );

        if (extractResult.records.length === 0) {
          break;
        }

        // In test mode, limit the records we process
        const recordsToProcess = testMode
          ? extractResult.records.slice(0, testModeLimit - processedCount)
          : extractResult.records;

        // Process each opportunity pilot relationship
        for (const opportunity of recordsToProcess) {
          if (this.shouldStop) break;

          try {
            const opportunityId = opportunity.Id;
            const pilotOpportunityId = opportunity.Pilot_Opportunity__c;

            logger.debug("Processing pilot relationship", {
              opportunityId,
              pilotOpportunityId,
            });

            // Find the source deal (the production opportunity)
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

            // Find the target deal (the pilot opportunity)
            const targetDealId = await hubspotLoader.searchDealsByProperty(
              "hs_salesforceopportunityid",
              pilotOpportunityId,
            );

            if (!targetDealId) {
              logger.warn("Target pilot deal not found in HubSpot", {
                salesforcePilotOpportunityId: pilotOpportunityId,
              });
              await database.createMigrationError(
                this.runId,
                objectType,
                opportunityId,
                "Opportunity",
                `Pilot deal not found in HubSpot for Salesforce Opportunity ID: ${pilotOpportunityId}`,
              );
              failedCount++;
              continue;
            }

            // Create bidirectional associations
            logger.debug("Creating pilot associations", {
              sourceOpportunityId: opportunityId,
              pilotOpportunityId: pilotOpportunityId,
              sourceDealId: sourceDealId,
              targetDealId: targetDealId,
              forwardTypeId: associationIds.forward,
              reverseTypeId: associationIds.reverse,
            });

            // Source deal (production) "has pilot" target deal (pilot)
            await hubspotLoader.createAssociation(
              "deals",
              sourceDealId,
              "deals",
              targetDealId,
              associationIds.forward,
            );

            logger.info("Created forward association (has pilot)", {
              from: sourceDealId,
              to: targetDealId,
            });

            // Target deal (pilot) "pilot for" source deal (production)
            await hubspotLoader.createAssociation(
              "deals",
              targetDealId,
              "deals",
              sourceDealId,
              associationIds.reverse,
            );

            logger.info("Created reverse association (pilot for)", {
              from: targetDealId,
              to: sourceDealId,
            });

            logger.info("Successfully created pilot associations", {
              sourceDealId,
              targetDealId,
              salesforceOpportunityId: opportunityId,
              salesforcePilotOpportunityId: pilotOpportunityId,
            });

            successCount++;
          } catch (error: any) {
            logger.error("Failed to create pilot association", {
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
        `✅ Completed Pilot Opportunity Association migration: ${processedCount} records processed (${successCount} successful, ${failedCount} failed)`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to migrate Pilot Opportunity Associations", {
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
   * Migrate Salesforce Events to HubSpot Meetings
   */
  private async migrateEventsToMeetings(
    testMode: boolean = false,
    testModeLimit: number = 5,
  ): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "activities";

    logger.info("📦 Starting Event to Meeting migration");

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

      // Get total count
      const totalRecords = await salesforceExtractor.getRecordCount("Event");
      const recordsToMigrate = testMode
        ? Math.min(testModeLimit, totalRecords)
        : totalRecords;

      await database.updateMigrationProgress(this.runId, objectType, {
        total_records: recordsToMigrate,
      });

      if (testMode) {
        logger.info(
          `🧪 TEST MODE: Will process ${recordsToMigrate} of ${totalRecords} total Events`,
        );
      } else {
        logger.info(`Total Events to migrate: ${totalRecords}`);
      }

      // Initialize owner mapper
      const connection = salesforceExtractor.getConnection();
      if (!connection) {
        throw new Error("Salesforce connection not available");
      }
      await ownerMapper.initialize(connection, this.runId);
      logger.info("Owner mapper initialized");

      let lastId: string | undefined;
      let processedCount = 0;
      let successCount = 0;
      let failedCount = 0;
      let hasMore = true;

      while (hasMore && !this.shouldStop) {
        if (testMode && processedCount >= testModeLimit) {
          logger.info(
            `🧪 TEST MODE: Reached limit of ${testModeLimit} records, stopping`,
          );
          break;
        }

        const batchSize = testMode
          ? Math.min(config.migration.batchSize, testModeLimit - processedCount)
          : config.migration.batchSize;

        // Extract batch
        const extractResult = await salesforceExtractor.extractEvents(
          batchSize,
          lastId,
        );

        logger.info(
          `Extracted ${extractResult.records.length} Events from Salesforce`,
        );

        if (extractResult.records.length === 0) {
          break;
        }

        const recordsToProcess = testMode
          ? extractResult.records.slice(0, testModeLimit - processedCount)
          : extractResult.records;

        // Fetch EventRelation records for all events in this batch
        const eventIds = recordsToProcess.map((event) => event.Id);
        const eventRelations =
          await salesforceExtractor.extractEventRelations(eventIds);

        logger.info(
          `Fetched ${eventRelations.length} EventRelation records for ${eventIds.length} events`,
        );

        // Group EventRelations by EventId
        const eventRelationsByEventId = new Map<string, any[]>();
        eventRelations.forEach((relation) => {
          if (!eventRelationsByEventId.has(relation.EventId)) {
            eventRelationsByEventId.set(relation.EventId, []);
          }
          eventRelationsByEventId.get(relation.EventId)!.push(relation);
        });

        // Separate RelationIds by type (Contact vs Account/Opportunity)
        const contactIds = new Set<string>();
        const accountIds = new Set<string>();
        const opportunityIds = new Set<string>();

        eventRelations.forEach((relation) => {
          if (!relation.RelationId) return;

          // IsWhat=true means Account or Opportunity
          if (relation.IsWhat) {
            // Salesforce Account IDs start with 001, Opportunity IDs start with 006
            if (relation.RelationId.startsWith("001")) {
              accountIds.add(relation.RelationId);
            } else if (relation.RelationId.startsWith("006")) {
              opportunityIds.add(relation.RelationId);
            }
          }
          // IsWhat=false means Contact or Lead
          else {
            // Salesforce Contact IDs start with 003
            if (relation.RelationId.startsWith("003")) {
              contactIds.add(relation.RelationId);
            }
          }
        });

        logger.info("Found RelationIds to lookup", {
          contacts: contactIds.size,
          contactIds: Array.from(contactIds),
          accounts: accountIds.size,
          accountIds: Array.from(accountIds),
          opportunities: opportunityIds.size,
          opportunityIds: Array.from(opportunityIds),
        });

        // Search HubSpot for objects by Salesforce IDs
        const [contactMappings, companyMappings, dealMappings] =
          await Promise.all([
            contactIds.size > 0
              ? hubspotLoader.bulkFindObjectsBySalesforceIds(
                  "contacts",
                  Array.from(contactIds),
                )
              : Promise.resolve(new Map<string, string>()),
            accountIds.size > 0
              ? hubspotLoader.bulkFindObjectsBySalesforceIds(
                  "companies",
                  Array.from(accountIds),
                )
              : Promise.resolve(new Map<string, string>()),
            opportunityIds.size > 0
              ? hubspotLoader.bulkFindObjectsBySalesforceIds(
                  "deals",
                  Array.from(opportunityIds),
                )
              : Promise.resolve(new Map<string, string>()),
          ]);

        logger.info("HubSpot object lookup results", {
          contactsFound: contactMappings.size,
          contactMappings: Object.fromEntries(contactMappings),
          companiesFound: companyMappings.size,
          companyMappings: Object.fromEntries(companyMappings),
          dealsFound: dealMappings.size,
          dealMappings: Object.fromEntries(dealMappings),
        });

        // Transform all events to meeting records
        const meetingsToCreate: Array<{
          salesforceId: string;
          properties: Record<string, any>;
          event: any;
        }> = [];

        for (const event of recordsToProcess) {
          try {
            // Transform to HubSpot properties
            const properties: Record<string, any> = {
              hs_meeting_title: event.Subject || "Untitled Meeting",
              hs_meeting_body: event.Description || "",
              hs_meeting_location: event.Location || "",
            };

            // Convert DateTime to Unix timestamp (milliseconds)
            if (event.StartDateTime) {
              const startTime = new Date(event.StartDateTime).getTime();
              properties.hs_meeting_start_time = startTime;
              // hs_timestamp is required and should be set to the start time
              properties.hs_timestamp = startTime;
            }
            if (event.EndDateTime) {
              properties.hs_meeting_end_time = new Date(
                event.EndDateTime,
              ).getTime();
            }

            // Map owner
            if (event.OwnerId) {
              const hsOwnerId = ownerMapper.getHubSpotOwnerId(event.OwnerId);
              if (hsOwnerId) {
                properties.hubspot_owner_id = hsOwnerId;
              }
            }

            meetingsToCreate.push({
              salesforceId: event.Id,
              properties,
              event,
            });
          } catch (error: any) {
            logger.error("Failed to transform event", {
              eventId: event.Id,
              error: error.message,
            });

            await database.createMigrationError(
              this.runId,
              objectType,
              event.Id,
              "Event",
              `Failed to transform: ${error.message}`,
            );

            failedCount++;
          }
        }

        // Batch create meetings in HubSpot
        if (meetingsToCreate.length > 0) {
          const createResult = await hubspotLoader.batchCreate(
            "meetings",
            meetingsToCreate,
          );

          logger.info(
            `Batch created ${createResult.successful.length} meetings in HubSpot`,
          );

          // Store ID mappings for successful meetings
          if (createResult.successful.length > 0) {
            await database.bulkCreateIdMappings(
              createResult.successful.map((item) => ({
                runId: this.runId!,
                salesforceId: item.salesforceId,
                salesforceType: "Event",
                hubspotId: item.hubspotId,
                hubspotType: "meeting",
              })),
            );

            successCount += createResult.successful.length;

            // Create associations for successful meetings using EventRelation
            for (const { salesforceId, hubspotId } of createResult.successful) {
              try {
                // Get EventRelations for this event
                const relations =
                  eventRelationsByEventId.get(salesforceId) || [];

                logger.info("Processing associations for meeting", {
                  salesforceId,
                  hubspotId,
                  relationCount: relations.length,
                });

                if (relations.length === 0) {
                  logger.info("Event has no EventRelation records", {
                    salesforceId,
                  });
                  continue;
                }

                // Process each EventRelation
                for (const relation of relations) {
                  let hubspotObjectId: string | undefined;
                  let objectType:
                    | "contacts"
                    | "companies"
                    | "deals"
                    | undefined;

                  // IsWhat=true means this is the "Related To" (Account/Opportunity)
                  if (relation.IsWhat) {
                    if (relation.RelationId.startsWith("001")) {
                      // Account -> Company
                      hubspotObjectId = companyMappings.get(
                        relation.RelationId,
                      );
                      objectType = "companies";
                    } else if (relation.RelationId.startsWith("006")) {
                      // Opportunity -> Deal
                      hubspotObjectId = dealMappings.get(relation.RelationId);
                      objectType = "deals";
                    }
                  }
                  // IsWhat=false means this is an attendee (Contact/Lead)
                  else {
                    if (relation.RelationId.startsWith("003")) {
                      // Contact
                      hubspotObjectId = contactMappings.get(
                        relation.RelationId,
                      );
                      objectType = "contacts";
                    }
                  }

                  logger.info("Processing EventRelation", {
                    salesforceEventId: salesforceId,
                    salesforceRelationId: relation.RelationId,
                    isWhat: relation.IsWhat,
                    objectType,
                    hubspotMeetingId: hubspotId,
                    hubspotObjectId,
                    found: !!hubspotObjectId,
                  });

                  if (!hubspotObjectId || !objectType) {
                    logger.warn("No HubSpot object found for RelationId", {
                      relationId: relation.RelationId,
                      salesforceId,
                    });
                    continue;
                  }

                  // Create the association
                  const associationTypeId =
                    objectType === "contacts"
                      ? 200 // Meeting → Contact
                      : objectType === "companies"
                        ? 182 // Meeting → Company
                        : 206; // Meeting → Deal

                  logger.info(`Creating ${objectType} association`, {
                    salesforceEventId: salesforceId,
                    salesforceRelationId: relation.RelationId,
                    hubspotMeetingId: hubspotId,
                    hubspotObjectId: hubspotObjectId,
                    associationTypeId,
                  });

                  await hubspotLoader.createEngagementAssociation(
                    "meetings",
                    hubspotId,
                    objectType,
                    hubspotObjectId,
                    associationTypeId,
                  );

                  logger.info(`Successfully created ${objectType} association`);
                }
              } catch (error: any) {
                const relations =
                  eventRelationsByEventId.get(salesforceId) || [];
                console.error("=== ASSOCIATION ERROR ===");
                console.error("Error message:", error.message);
                console.error("Error code:", error.code);
                console.error(
                  "Error body:",
                  JSON.stringify(error.body, null, 2),
                );
                console.error("Meeting ID:", hubspotId);
                console.error("Salesforce Event ID:", salesforceId);
                console.error(
                  "EventRelations:",
                  JSON.stringify(relations, null, 2),
                );
                console.error("Full error:", error);
                console.error("========================");

                logger.error("Failed to create associations for meeting", {
                  error: error.message,
                  errorCode: error.code,
                  errorBody: error.body,
                  meetingId: hubspotId,
                  salesforceId,
                  relationCount: relations.length,
                });
                // Don't fail the whole migration for association errors
              }
            }
          }

          // Log failed creates
          for (const failed of createResult.failed) {
            await database.createMigrationError(
              this.runId,
              objectType,
              failed.salesforceId,
              "Event",
              failed.error,
            );

            failedCount++;
          }

          if (createResult.failed.length > 0) {
            logger.warn(
              `Failed to create ${createResult.failed.length} meetings in HubSpot`,
            );
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
          failed_records: failedCount,
        });

        logger.info(
          `Progress: ${processedCount}/${recordsToMigrate} Events processed (${successCount} successful, ${failedCount} failed)`,
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
        `✅ Completed Event to Meeting migration: ${processedCount} records processed (${successCount} successful, ${failedCount} failed)`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to migrate Events to Meetings", {
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
   * Migrate Opportunity Product Dates from Line Item Schedules
   * This is a Salesforce-only migration that updates Opportunity fields
   */
  private async migrateOpportunityProductDates(
    testMode: boolean = false,
    testModeLimit: number = 5,
  ): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "opportunity_product_dates";

    logger.info("📦 Starting Opportunity Product Dates migration");

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

      // Get total count of opportunities
      const totalRecords =
        await salesforceExtractor.getRecordCount("Opportunity");
      const recordsToMigrate = testMode
        ? Math.min(testModeLimit, totalRecords)
        : totalRecords;

      await database.updateMigrationProgress(this.runId, objectType, {
        total_records: recordsToMigrate,
      });

      if (testMode) {
        logger.info(
          `🧪 TEST MODE: Will process ${recordsToMigrate} of ${totalRecords} total Opportunities`,
        );
      } else {
        logger.info(`Total Opportunities to process: ${totalRecords}`);
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

        // Extract batch of Opportunities from Salesforce
        const extractResult = await salesforceExtractor.extract(
          "Opportunity",
          ["Id", "Name", "Product_Start_Date__c", "Product_End_Date__c"],
          batchSize,
          lastId,
        );

        logger.info(
          `Extracted ${extractResult.records.length} Opportunities from Salesforce`,
        );

        if (extractResult.records.length === 0) {
          break;
        }

        // In test mode, limit the records we process
        const recordsToProcess = testMode
          ? extractResult.records.slice(0, testModeLimit - processedCount)
          : extractResult.records;

        // Extract opportunity IDs for this batch
        const opportunityIds = recordsToProcess.map((opp) => opp.Id);

        // Get all Line Item Schedules for these opportunities
        const schedulesByOpp =
          await salesforceExtractor.extractLineItemSchedulesByOpportunity(
            opportunityIds,
          );

        logger.info(
          `Found Line Item Schedules for ${schedulesByOpp.size} out of ${recordsToProcess.length} opportunities`,
        );

        // Log which opportunities were found/not found
        logger.info("Opportunities in this batch:");
        for (const opp of recordsToProcess) {
          const hasSchedules = schedulesByOpp.has(opp.Id);
          const scheduleCount = hasSchedules
            ? schedulesByOpp.get(opp.Id)!.length
            : 0;
          logger.info(`  ${hasSchedules ? "✓" : "✗"} ${opp.Name || opp.Id}`, {
            opportunityId: opp.Id,
            hasLineItemSchedules: hasSchedules,
            scheduleCount: scheduleCount,
          });
        }

        // Prepare updates for opportunities that have schedules
        const opportunityUpdates: Array<{
          Id: string;
          Product_Start_Date__c: string;
          Product_End_Date__c: string;
        }> = [];

        for (const opportunity of recordsToProcess) {
          if (this.shouldStop) break;

          const opportunityId = opportunity.Id;
          const schedules = schedulesByOpp.get(opportunityId);

          if (!schedules || schedules.length === 0) {
            logger.debug("No Line Item Schedules found for opportunity", {
              opportunityId,
              opportunityName: opportunity.Name,
            });
            continue;
          }

          // Find min and max ScheduleDate
          const scheduleDates = schedules
            .map((s) => new Date(s.ScheduleDate))
            .filter((d) => !isNaN(d.getTime())); // Filter out invalid dates

          if (scheduleDates.length === 0) {
            logger.warn("No valid ScheduleDates found for opportunity", {
              opportunityId,
              scheduleCount: schedules.length,
            });
            continue;
          }

          const minDate = new Date(
            Math.min(...scheduleDates.map((d) => d.getTime())),
          );
          const maxDate = new Date(
            Math.max(...scheduleDates.map((d) => d.getTime())),
          );

          // Format dates as YYYY-MM-DD for Salesforce
          const productStartDate = minDate.toISOString().split("T")[0];
          const productEndDate = maxDate.toISOString().split("T")[0];

          logger.info("✓ Calculated product dates for opportunity", {
            opportunityId,
            opportunityName: opportunity.Name,
            scheduleCount: schedules.length,
            productStartDate,
            productEndDate,
            currentStartDate: opportunity.Product_Start_Date__c || "Not Set",
            currentEndDate: opportunity.Product_End_Date__c || "Not Set",
          });

          opportunityUpdates.push({
            Id: opportunityId,
            Product_Start_Date__c: productStartDate,
            Product_End_Date__c: productEndDate,
          });
        }

        // Show summary of what will be updated
        logger.info(
          `Opportunities with Line Item Schedules: ${opportunityUpdates.length} out of ${recordsToProcess.length}`,
        );

        // Batch update opportunities in Salesforce
        if (opportunityUpdates.length > 0) {
          logger.info(
            `Updating ${opportunityUpdates.length} opportunities with product dates`,
          );

          const updateResult =
            await salesforceExtractor.batchUpdateOpportunities(
              opportunityUpdates,
            );

          successCount += updateResult.successful.length;
          failedCount += updateResult.failed.length;

          logger.info("Batch update completed", {
            successful: updateResult.successful.length,
            failed: updateResult.failed.length,
          });

          // Log successful updates
          if (updateResult.successful.length > 0) {
            logger.info(
              `✅ Successfully updated ${updateResult.successful.length} Opportunities in this batch`,
            );
          }

          // Log errors for failed updates
          for (const failed of updateResult.failed) {
            logger.error(`❌ Failed to update Opportunity: ${failed.id}`, {
              error: failed.error,
            });

            await database.createMigrationError(
              this.runId,
              objectType,
              failed.id,
              "Opportunity",
              `Failed to update: ${failed.error}`,
            );
          }

          if (updateResult.failed.length > 0) {
            await database.incrementFailedRecords(
              this.runId,
              objectType,
              updateResult.failed.length,
            );
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
          `Progress: ${processedCount}/${recordsToMigrate} Opportunities processed (${successCount} updated, ${failedCount} failed)`,
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
        `✅ Completed Opportunity Product Dates migration: ${processedCount} opportunities processed (${successCount} updated, ${failedCount} failed)`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to migrate Opportunity Product Dates", {
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
   * Sync Opportunity dates to HubSpot Deal contract dates
   */
  private async syncDealContractDates(
    testMode: boolean = false,
    testModeLimit: number = 5,
  ): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "sync_deal_contract_dates";

    logger.info("📦 Starting Sync Deal Contract Dates migration");

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

      // Connect to Salesforce
      await salesforceExtractor.connect();

      // Get total count of opportunities
      const totalRecords =
        await salesforceExtractor.getRecordCount("Opportunity");
      const recordsToMigrate = testMode
        ? Math.min(testModeLimit, totalRecords)
        : totalRecords;

      await database.updateMigrationProgress(this.runId, objectType, {
        total_records: recordsToMigrate,
      });

      if (testMode) {
        logger.info(
          `🧪 TEST MODE: Will process ${recordsToMigrate} of ${totalRecords} total Opportunities`,
        );
      } else {
        logger.info(`Total Opportunities to process: ${totalRecords}`);
      }

      let lastId: string | undefined;
      let processedCount = 0;
      let successCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
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

        // Extract batch of Opportunities from Salesforce
        const extractResult = await salesforceExtractor.extract(
          "Opportunity",
          [
            "Id",
            "Name",
            "Product_Start_Date__c",
            "Product_End_Date__c",
            "CloseDate",
          ],
          batchSize,
          lastId,
        );

        logger.info(
          `Extracted ${extractResult.records.length} Opportunities from Salesforce`,
        );

        if (extractResult.records.length === 0) {
          break;
        }

        // In test mode, limit the records we process
        const recordsToProcess = testMode
          ? extractResult.records.slice(0, testModeLimit - processedCount)
          : extractResult.records;

        // Prepare updates for HubSpot deals
        const dealUpdates: Array<{
          dealId: string;
          opportunityId: string;
          opportunityName: string;
          properties: Record<string, any>;
        }> = [];

        for (const opportunity of recordsToProcess) {
          if (this.shouldStop) break;

          const opportunityId = opportunity.Id;
          const opportunityName = opportunity.Name || "Unnamed";

          // Find the corresponding HubSpot deal
          const dealId = await hubspotLoader.searchDealsByProperty(
            "hs_salesforceopportunityid",
            opportunityId,
          );

          if (!dealId) {
            logger.warn("No HubSpot deal found for Opportunity", {
              opportunityId,
              opportunityName,
            });
            skippedCount++;
            continue;
          }

          // Calculate contract_start_date
          let contractStartDate: string;
          if (opportunity.Product_Start_Date__c) {
            contractStartDate = opportunity.Product_Start_Date__c;
          } else if (opportunity.CloseDate) {
            contractStartDate = opportunity.CloseDate;
            logger.debug("Using CloseDate as contract start", {
              opportunityId,
              closeDate: opportunity.CloseDate,
            });
          } else {
            logger.warn("No start date or CloseDate available", {
              opportunityId,
              opportunityName,
            });
            skippedCount++;
            continue;
          }

          // Calculate contract_end_date
          let contractEndDate: string;
          if (opportunity.Product_End_Date__c) {
            // Add 1 month to Product_End_Date__c
            const productEndDate = new Date(opportunity.Product_End_Date__c);
            const endDate = new Date(productEndDate);
            endDate.setMonth(endDate.getMonth() + 1);
            contractEndDate = endDate.toISOString().split("T")[0];
            logger.debug(
              "Calculated end date as Product_End_Date__c + 1 month",
              {
                opportunityId,
                productEndDate: opportunity.Product_End_Date__c,
                contractEndDate,
              },
            );
          } else {
            // Add 1 year to contract_start_date
            const startDate = new Date(contractStartDate);
            const endDate = new Date(startDate);
            endDate.setFullYear(endDate.getFullYear() + 1);
            contractEndDate = endDate.toISOString().split("T")[0];
            logger.debug(
              "Calculated end date as start + 1 year (no product end date)",
              {
                opportunityId,
                contractStartDate,
                contractEndDate,
              },
            );
          }

          logger.info("Calculated contract dates for opportunity", {
            opportunityId,
            opportunityName,
            dealId,
            contractStartDate,
            contractEndDate,
          });

          dealUpdates.push({
            dealId,
            opportunityId,
            opportunityName,
            properties: {
              contract_start_date: contractStartDate,
              contract_end_date: contractEndDate,
              recurring_revenue_inactive_date: contractEndDate,
            },
          });
        }

        // Batch update deals in HubSpot
        if (dealUpdates.length > 0) {
          logger.info(`Updating ${dealUpdates.length} deals in HubSpot`);

          const updateResult = await hubspotLoader.batchUpdateDeals(
            dealUpdates.map((u) => ({
              dealId: u.dealId,
              properties: u.properties,
            })),
          );

          successCount += updateResult.successful.length;
          failedCount += updateResult.failed.length;

          logger.info("Batch update completed", {
            successful: updateResult.successful.length,
            failed: updateResult.failed.length,
          });

          // Log successful updates
          if (updateResult.successful.length > 0) {
            logger.info(
              `✅ Successfully updated ${updateResult.successful.length} deals in this batch`,
            );
          }

          // Log errors for failed updates
          for (const failed of updateResult.failed) {
            const dealUpdate = dealUpdates.find((u) => u.dealId === failed.id);
            logger.error(`❌ Failed to update deal: ${failed.id}`, {
              error: failed.error,
              opportunityId: dealUpdate?.opportunityId,
            });

            await database.createMigrationError(
              this.runId,
              objectType,
              dealUpdate?.opportunityId || failed.id,
              "Opportunity",
              `Failed to update deal: ${failed.error}`,
            );
          }

          if (updateResult.failed.length > 0) {
            await database.incrementFailedRecords(
              this.runId,
              objectType,
              updateResult.failed.length,
            );
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
          skipped_records: skippedCount,
          last_sf_id_processed: lastId,
        });

        logger.info(
          `Progress: ${processedCount}/${recordsToMigrate} Opportunities processed (${successCount} deals updated, ${skippedCount} skipped, ${failedCount} failed)`,
        );
      }

      // Update final counts
      await database.updateMigrationProgress(this.runId, objectType, {
        status: "completed",
        completed_at: new Date(),
        failed_records: failedCount,
        skipped_records: skippedCount,
      });

      await database.createAuditLog(
        this.runId,
        "object_migration_completed",
        objectType,
        processedCount,
        {
          successCount,
          failedCount,
          skippedCount,
        },
      );

      logger.info(
        `✅ Completed Sync Deal Contract Dates migration: ${processedCount} opportunities processed (${successCount} deals updated, ${skippedCount} skipped, ${failedCount} failed)`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to sync deal contract dates", {
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
   * Migrate OpportunityLineItem dates from Line Item Schedules
   * This is a Salesforce-only migration that updates OpportunityLineItem fields
   */
  private async migrateOpportunityLineItemDates(
    testMode: boolean = false,
    testModeLimit: number = 5,
  ): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "opportunity_line_item_dates";

    logger.info("📦 Starting OpportunityLineItem Dates migration");

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

      // Get total count of opportunity line items
      const totalRecords = await salesforceExtractor.getRecordCount(
        "OpportunityLineItem",
      );
      const recordsToMigrate = testMode
        ? Math.min(testModeLimit, totalRecords)
        : totalRecords;

      await database.updateMigrationProgress(this.runId, objectType, {
        total_records: recordsToMigrate,
      });

      if (testMode) {
        logger.info(
          `🧪 TEST MODE: Will process ${recordsToMigrate} of ${totalRecords} total OpportunityLineItems`,
        );
      } else {
        logger.info(`Total OpportunityLineItems to process: ${totalRecords}`);
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

        // Extract batch of OpportunityLineItems from Salesforce
        const extractResult = await salesforceExtractor.extract(
          "OpportunityLineItem",
          ["Id", "Name", "Start_Date__c", "End_Date__c"],
          batchSize,
          lastId,
        );

        logger.info(
          `Extracted ${extractResult.records.length} OpportunityLineItems from Salesforce`,
        );

        if (extractResult.records.length === 0) {
          break;
        }

        // In test mode, limit the records we process
        const recordsToProcess = testMode
          ? extractResult.records.slice(0, testModeLimit - processedCount)
          : extractResult.records;

        // Extract line item IDs for this batch
        const lineItemIds = recordsToProcess.map((li) => li.Id);

        // Get all Line Item Schedules for these line items
        const schedulesByLineItem =
          await salesforceExtractor.extractLineItemSchedulesByLineItem(
            lineItemIds,
          );

        logger.info(
          `Found Line Item Schedules for ${schedulesByLineItem.size} out of ${recordsToProcess.length} line items`,
        );

        // Prepare updates for line items that have schedules
        const lineItemUpdates: Array<{
          Id: string;
          Start_Date__c: string;
          End_Date__c: string;
        }> = [];

        for (const lineItem of recordsToProcess) {
          if (this.shouldStop) break;

          const lineItemId = lineItem.Id;
          const schedules = schedulesByLineItem.get(lineItemId);

          if (!schedules || schedules.length === 0) {
            logger.debug("No Line Item Schedules found for line item", {
              lineItemId,
              lineItemName: lineItem.Name,
            });
            continue;
          }

          // Find min and max ScheduleDate
          const scheduleDates = schedules
            .map((s) => new Date(s.ScheduleDate))
            .filter((d) => !isNaN(d.getTime())); // Filter out invalid dates

          if (scheduleDates.length === 0) {
            logger.warn("No valid ScheduleDates found for line item", {
              lineItemId,
              scheduleCount: schedules.length,
            });
            continue;
          }

          const minDate = new Date(
            Math.min(...scheduleDates.map((d) => d.getTime())),
          );
          const maxDate = new Date(
            Math.max(...scheduleDates.map((d) => d.getTime())),
          );

          // Format dates as YYYY-MM-DD for Salesforce
          const startDate = minDate.toISOString().split("T")[0];
          const endDate = maxDate.toISOString().split("T")[0];

          logger.debug("Calculated dates for line item", {
            lineItemId,
            lineItemName: lineItem.Name,
            scheduleCount: schedules.length,
            startDate,
            endDate,
          });

          lineItemUpdates.push({
            Id: lineItemId,
            Start_Date__c: startDate,
            End_Date__c: endDate,
          });
        }

        // Batch update line items in Salesforce
        if (lineItemUpdates.length > 0) {
          logger.info(
            `Updating ${lineItemUpdates.length} line items with dates`,
          );

          const updateResult =
            await salesforceExtractor.batchUpdateOpportunityLineItems(
              lineItemUpdates,
            );

          successCount += updateResult.successful.length;
          failedCount += updateResult.failed.length;

          logger.info("Batch update completed", {
            successful: updateResult.successful.length,
            failed: updateResult.failed.length,
          });

          if (updateResult.successful.length > 0) {
            logger.info(
              `✅ Successfully updated ${updateResult.successful.length} OpportunityLineItems in this batch`,
            );
          }

          // Log errors for failed updates
          for (const failed of updateResult.failed) {
            await database.createMigrationError(
              this.runId,
              objectType,
              failed.id,
              "OpportunityLineItem",
              `Failed to update: ${failed.error}`,
            );
          }

          if (updateResult.failed.length > 0) {
            await database.incrementFailedRecords(
              this.runId,
              objectType,
              updateResult.failed.length,
            );
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
          `Progress: ${processedCount}/${recordsToMigrate} OpportunityLineItems processed (${successCount} updated, ${failedCount} failed)`,
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
        `✅ Completed OpportunityLineItem Dates migration: ${processedCount} line items processed (${successCount} updated, ${failedCount} failed)`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to migrate OpportunityLineItem Dates", {
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
   * Migrate Salesforce OpportunityLineItems to HubSpot Line Items
   */
  private async migrateLineItems(
    testMode: boolean = false,
    testModeLimit: number = 5,
  ): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "line_items";

    logger.info("Starting OpportunityLineItem to HubSpot Line Item migration");

    try {
      // Clean up existing line items first to avoid duplicates
      logger.info("Cleaning up existing line items in HubSpot...");
      const deletedCount = await hubspotLoader.deleteAllLineItems();
      logger.info(`Deleted ${deletedCount} existing line items`);

      // Initialize progress tracking
      await database.createMigrationProgress(
        this.runId,
        objectType,
        "in_progress",
      );
      await database.updateMigrationProgress(this.runId, objectType, {
        started_at: new Date(),
      });

      await database.createAuditLog(
        this.runId,
        "object_migration_started",
        objectType,
      );

      // Get total count
      const totalCount = await salesforceExtractor.getRecordCount(
        "OpportunityLineItem",
      );
      const recordsToMigrate = testMode
        ? Math.min(totalCount, testModeLimit)
        : totalCount;

      await database.updateMigrationProgress(this.runId, objectType, {
        total_records: recordsToMigrate,
      });

      logger.info(`Total OpportunityLineItems to migrate: ${recordsToMigrate}`);

      let processedCount = 0;
      let successCount = 0;
      let failedCount = 0;
      let lastId: string | undefined = undefined;
      let hasMore = true;

      while (hasMore && !this.shouldStop) {
        // Extract batch from Salesforce
        const batchSize = testMode ? testModeLimit : 100;

        logger.info(
          `=== LOOP ITERATION START === testMode=${testMode}, testModeLimit=${testModeLimit}, batchSize=${batchSize}, processedCount=${processedCount}, hasMore=${hasMore}, lastId=${lastId || "null"}`,
        );

        const extractResult =
          await salesforceExtractor.extractOpportunityLineItems(
            batchSize,
            lastId,
          );

        logger.info(
          `Extract result from Salesforce: extracted ${extractResult.records.length} records, hasMore=${extractResult.hasMore}, nextPage=${extractResult.nextPage || "null"}`,
        );

        if (extractResult.records.length === 0) {
          logger.warn("No records extracted, breaking loop");
          break;
        }

        const recordsToProcess = testMode
          ? extractResult.records.slice(0, testModeLimit - processedCount)
          : extractResult.records;

        logger.info(
          `Records to process in this batch: ${recordsToProcess.length} (testMode=${testMode})`,
        );

        logger.info(
          `Processing batch of ${recordsToProcess.length} OpportunityLineItems`,
        );

        // Transform to HubSpot line items
        const lineItemsToCreate: Array<{
          salesforceId: string;
          opportunityId: string;
          properties: Record<string, any>;
        }> = [];

        for (const lineItem of recordsToProcess) {
          try {
            // Get product name from Product2 lookup
            const productName =
              lineItem.Product2?.Name || `Product ${lineItem.Product2Id}`;

            // Build HubSpot line item properties
            const properties: Record<string, any> = {
              name: productName,
              hs_product_id: "", // Will be left empty for now
            };

            // Map fields
            if (lineItem.Start_Date__c) {
              properties.start_date = lineItem.Start_Date__c;
            }
            if (lineItem.End_Date__c) {
              properties.end_date = lineItem.End_Date__c;
            }
            if (
              lineItem.installments__c !== undefined &&
              lineItem.installments__c !== null
            ) {
              properties.installments = lineItem.installments__c.toString();
            }
            if (
              lineItem.TotalPrice !== undefined &&
              lineItem.TotalPrice !== null
            ) {
              properties.amount = lineItem.TotalPrice.toString();
            }
            if (lineItem.Quantity !== undefined && lineItem.Quantity !== null) {
              properties.quantity = lineItem.Quantity.toString();
            }
            if (
              lineItem.UnitPrice !== undefined &&
              lineItem.UnitPrice !== null
            ) {
              properties.price = lineItem.UnitPrice.toString();
            }

            lineItemsToCreate.push({
              salesforceId: lineItem.Id,
              opportunityId: lineItem.OpportunityId,
              properties,
            });

            // Log the first few items for debugging
            if (lineItemsToCreate.length <= 3) {
              logger.info(`Sample line item properties:`, {
                salesforceId: lineItem.Id,
                properties,
              });
            }
          } catch (transformError: any) {
            logger.error(
              `Failed to transform OpportunityLineItem ${lineItem.Id}`,
              {
                error: transformError.message,
              },
            );
            failedCount++;

            await database.createMigrationError(
              this.runId,
              lineItem.Id,
              "OpportunityLineItem",
              objectType,
              transformError.message,
            );
          }
        }

        // Find deal IDs BEFORE creating line items so we can include associations in the create call
        if (lineItemsToCreate.length > 0) {
          logger.info(
            `Finding deal IDs for ${lineItemsToCreate.length} line items`,
          );

          const lineItemsWithDeals: Array<{
            salesforceId: string;
            opportunityId: string;
            properties: Record<string, any>;
            dealId: string;
          }> = [];

          for (const item of lineItemsToCreate) {
            // Find the HubSpot Deal by Salesforce OpportunityId
            const dealId = await hubspotLoader.getDealBySalesforceOpportunityId(
              item.opportunityId,
            );

            if (dealId) {
              lineItemsWithDeals.push({
                salesforceId: item.salesforceId,
                opportunityId: item.opportunityId,
                properties: item.properties,
                dealId: dealId,
              });
            } else {
              logger.warn(
                `Could not find HubSpot Deal for Opportunity ${item.opportunityId}`,
                {
                  salesforceLineItemId: item.salesforceId,
                },
              );
              failedCount++;

              await database.createMigrationError(
                this.runId,
                item.salesforceId,
                "OpportunityLineItem",
                objectType,
                `Could not find HubSpot Deal for Opportunity ${item.opportunityId}`,
              );
            }
          }

          logger.info(
            `Creating ${lineItemsWithDeals.length} line items in HubSpot with associations`,
          );

          // Create line items with associations included in the create call
          const createResult = await hubspotLoader.createLineItems(
            lineItemsWithDeals.map((item) => ({
              salesforceId: item.salesforceId,
              properties: item.properties,
              dealId: item.dealId,
            })),
          );

          // Store ID mappings for successful creations
          for (const created of createResult.successful) {
            const lineItemData = lineItemsWithDeals.find(
              (item) => item.salesforceId === created.salesforceId,
            );

            if (lineItemData) {
              await database.createIdMapping(
                this.runId,
                created.salesforceId,
                "OpportunityLineItem",
                created.hubspotId,
                "line_item",
                {
                  opportunityId: lineItemData.opportunityId,
                  dealId: lineItemData.dealId,
                },
              );
            }
          }

          successCount += createResult.successful.length;

          logger.info(
            `Successfully created ${createResult.successful.length} line items with associations`,
          );

          // Log creation failures
          for (const failed of createResult.failed) {
            logger.error(`Failed to create line item`, {
              salesforceId: failed.salesforceId,
              error: failed.error,
            });
            failedCount++;

            await database.createMigrationError(
              this.runId,
              failed.salesforceId,
              "OpportunityLineItem",
              objectType,
              failed.error,
            );
          }
        }

        // Update progress
        processedCount += recordsToProcess.length;
        if (recordsToProcess.length > 0) {
          lastId = recordsToProcess[recordsToProcess.length - 1].Id;
        }

        // Calculate hasMore for next iteration
        const testModeCondition = !testMode || processedCount < testModeLimit;
        hasMore = extractResult.hasMore && testModeCondition;

        logger.info(
          `=== LOOP ITERATION END === processedCount=${processedCount}, extractHasMore=${extractResult.hasMore}, testMode=${testMode}, testModeLimit=${testModeLimit}, testModeCondition=${testModeCondition}, calculatedHasMore=${hasMore}, willContinue=${hasMore && !this.shouldStop}`,
        );

        await database.updateMigrationProgress(this.runId, objectType, {
          processed_records: processedCount,
          last_sf_id_processed: lastId,
        });

        logger.info(
          `Progress: ${processedCount}/${recordsToMigrate} OpportunityLineItems processed (${successCount} created, ${failedCount} failed)`,
        );
      }

      logger.info(
        `=== LOOP EXITED === finalProcessedCount=${processedCount}, finalHasMore=${hasMore}, shouldStop=${this.shouldStop}`,
      );

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
        `✅ Completed Line Items migration: ${processedCount} line items processed (${successCount} created, ${failedCount} failed)`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to migrate Line Items", {
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
   * Cleanup HubSpot Tasks
   */
  private async cleanupHubSpotTasks(): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "cleanup_tasks";

    logger.info("🧹 Starting HubSpot Tasks Cleanup");

    try {
      await database.createMigrationProgress(
        this.runId,
        objectType,
        "in_progress",
      );
      await database.updateMigrationProgress(this.runId, objectType, {
        started_at: new Date(),
      });

      logger.info("Deleting all Tasks from HubSpot...");
      const tasksDeleted = await hubspotLoader.deleteAllTasks();
      logger.info(`✅ Deleted ${tasksDeleted} tasks`);

      await database.updateMigrationProgress(this.runId, objectType, {
        status: "completed",
        completed_at: new Date(),
        processed_records: tasksDeleted,
      });

      await database.createAuditLog(
        this.runId,
        "object_migration_completed",
        objectType,
        tasksDeleted,
      );

      logger.info(`✅ Tasks cleanup completed: ${tasksDeleted} tasks deleted`);
    } catch (error: any) {
      logger.error("❌ Failed to cleanup HubSpot tasks", {
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
   * Cleanup HubSpot Meetings
   */
  private async cleanupHubSpotMeetings(): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "cleanup_meetings";

    logger.info("🧹 Starting HubSpot Meetings Cleanup");

    try {
      await database.createMigrationProgress(
        this.runId,
        objectType,
        "in_progress",
      );
      await database.updateMigrationProgress(this.runId, objectType, {
        started_at: new Date(),
      });

      logger.info("Deleting all Meetings from HubSpot...");
      const meetingsDeleted = await hubspotLoader.deleteAllMeetings();
      logger.info(`✅ Deleted ${meetingsDeleted} meetings`);

      await database.updateMigrationProgress(this.runId, objectType, {
        status: "completed",
        completed_at: new Date(),
        processed_records: meetingsDeleted,
      });

      await database.createAuditLog(
        this.runId,
        "object_migration_completed",
        objectType,
        meetingsDeleted,
      );

      logger.info(
        `✅ Meetings cleanup completed: ${meetingsDeleted} meetings deleted`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to cleanup HubSpot meetings", {
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
   * Cleanup HubSpot Line Items
   */
  private async cleanupHubSpotLineItems(): Promise<void> {
    if (!this.runId) {
      throw new Error("No active migration run");
    }

    const objectType: ObjectType = "cleanup_line_items";

    logger.info("🧹 Starting HubSpot Line Items Cleanup");

    try {
      await database.createMigrationProgress(
        this.runId,
        objectType,
        "in_progress",
      );
      await database.updateMigrationProgress(this.runId, objectType, {
        started_at: new Date(),
      });

      logger.info("Deleting all Line Items from HubSpot...");
      const lineItemsDeleted = await hubspotLoader.deleteAllLineItems();
      logger.info(`✅ Deleted ${lineItemsDeleted} line items`);

      await database.updateMigrationProgress(this.runId, objectType, {
        status: "completed",
        completed_at: new Date(),
        processed_records: lineItemsDeleted,
      });

      await database.createAuditLog(
        this.runId,
        "object_migration_completed",
        objectType,
        lineItemsDeleted,
      );

      logger.info(
        `✅ Line Items cleanup completed: ${lineItemsDeleted} line items deleted`,
      );
    } catch (error: any) {
      logger.error("❌ Failed to cleanup HubSpot line items", {
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
