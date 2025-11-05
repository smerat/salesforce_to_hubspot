import * as jsforce from "jsforce";
import { Client } from "@hubspot/api-client";
import config from "../config";
import logger from "../utils/logger";
import database from "./database";

export interface SalesforceUser {
  Id: string;
  Email: string;
  Name: string;
  IsActive: boolean;
}

export interface HubSpotOwner {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  userId?: number;
}

export interface OwnerMapping {
  sfUserId: string;
  sfUserEmail: string;
  sfUserName: string;
  hsOwnerId: string;
  hsOwnerEmail: string;
  hsOwnerName: string;
  matchMethod: "email" | "name" | "manual";
}

class OwnerMapperService {
  private ownerCache: Map<string, string> = new Map(); // SF User ID -> HS Owner ID
  private runId: string | null = null;
  private initialized: boolean = false;
  private defaultOwnerId: string | null = null; // Default owner for unmapped users

  /**
   * Initialize the owner mapper with SF and HS owner data
   */
  async initialize(
    connection: jsforce.Connection,
    runId: string,
  ): Promise<void> {
    if (this.initialized && this.runId === runId) {
      logger.info("Owner mapper already initialized for this run");
      return;
    }

    logger.info("Initializing owner mapper...");
    this.runId = runId;
    this.ownerCache.clear();

    try {
      // Fetch Salesforce Users
      logger.info("Fetching Salesforce users...");
      const sfUsers = await this.getSalesforceUsers(connection);
      logger.info(`Found ${sfUsers.length} active Salesforce users`);

      // Fetch HubSpot Owners
      logger.info("Fetching HubSpot owners...");
      const hsOwners = await this.getHubSpotOwners();
      logger.info(`Found ${hsOwners.length} HubSpot owners`);

      // Find default owner (Sean Merat)
      const defaultOwner = hsOwners.find(
        (owner) =>
          owner.email?.toLowerCase().includes("sean") ||
          `${owner.firstName} ${owner.lastName}`
            .toLowerCase()
            .includes("sean merat"),
      );
      if (defaultOwner) {
        this.defaultOwnerId = defaultOwner.id;
        logger.info(
          `Default owner set: ${defaultOwner.firstName} ${defaultOwner.lastName} (${defaultOwner.email})`,
        );
      } else {
        logger.warn("Could not find default owner 'Sean Merat' in HubSpot");
      }

      // Build mappings
      const mappings = this.buildOwnerMappings(sfUsers, hsOwners);
      logger.info(`Created ${mappings.length} owner mappings`);

      // Store in database
      await this.storeOwnerMappings(runId, mappings);

      // Populate cache
      for (const mapping of mappings) {
        this.ownerCache.set(mapping.sfUserId, mapping.hsOwnerId);
      }

      this.initialized = true;
      logger.info("✅ Owner mapper initialized successfully");
    } catch (error: any) {
      logger.error("Failed to initialize owner mapper", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get Salesforce users
   */
  private async getSalesforceUsers(
    connection: jsforce.Connection,
  ): Promise<SalesforceUser[]> {
    try {
      const query =
        "SELECT Id, Email, Name, IsActive FROM User WHERE IsActive = true AND Email != null";
      const result = await connection.query<SalesforceUser>(query);

      return result.records.map((record) => ({
        Id: record.Id,
        Email: record.Email,
        Name: record.Name,
        IsActive: record.IsActive,
      }));
    } catch (error: any) {
      logger.error("Failed to fetch Salesforce users", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get HubSpot owners
   */
  private async getHubSpotOwners(): Promise<HubSpotOwner[]> {
    try {
      const client = new Client({
        accessToken: config.hubspot.accessToken,
      });

      const response = await client.crm.owners.ownersApi.getPage();

      return response.results.map((owner: any) => ({
        id: owner.id,
        email: owner.email,
        firstName: owner.firstName,
        lastName: owner.lastName,
        userId: owner.userId,
      }));
    } catch (error: any) {
      logger.error("Failed to fetch HubSpot owners", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Build owner mappings by matching SF users to HS owners
   */
  private buildOwnerMappings(
    sfUsers: SalesforceUser[],
    hsOwners: HubSpotOwner[],
  ): OwnerMapping[] {
    const mappings: OwnerMapping[] = [];

    // Create lookup map by email for faster matching
    const hsOwnersByEmail = new Map<string, HubSpotOwner>();
    for (const owner of hsOwners) {
      if (owner.email) {
        hsOwnersByEmail.set(owner.email.toLowerCase(), owner);
      }
    }

    // Match SF users to HS owners
    for (const sfUser of sfUsers) {
      if (!sfUser.Email) continue;

      const sfEmailLower = sfUser.Email.toLowerCase();

      // Try exact email match first
      const hsOwner = hsOwnersByEmail.get(sfEmailLower);

      if (hsOwner) {
        mappings.push({
          sfUserId: sfUser.Id,
          sfUserEmail: sfUser.Email,
          sfUserName: sfUser.Name,
          hsOwnerId: hsOwner.id,
          hsOwnerEmail: hsOwner.email,
          hsOwnerName:
            `${hsOwner.firstName || ""} ${hsOwner.lastName || ""}`.trim(),
          matchMethod: "email",
        });

        logger.debug(`Mapped SF user to HS owner by email`, {
          sfUser: sfUser.Name,
          sfEmail: sfUser.Email,
          hsOwner: `${hsOwner.firstName} ${hsOwner.lastName}`,
          hsEmail: hsOwner.email,
        });
      } else {
        logger.warn(`No HubSpot owner found for Salesforce user`, {
          sfUserId: sfUser.Id,
          sfUserName: sfUser.Name,
          sfUserEmail: sfUser.Email,
        });
      }
    }

    return mappings;
  }

  /**
   * Store owner mappings in database
   */
  private async storeOwnerMappings(
    runId: string,
    mappings: OwnerMapping[],
  ): Promise<void> {
    if (mappings.length === 0) {
      logger.warn("No owner mappings to store");
      return;
    }

    try {
      const values: any[] = [];
      const valuePlaceholders: string[] = [];

      mappings.forEach((mapping, index) => {
        const offset = index * 8;
        valuePlaceholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
        );
        values.push(
          runId,
          mapping.sfUserId,
          mapping.sfUserEmail,
          mapping.sfUserName,
          mapping.hsOwnerId,
          mapping.hsOwnerEmail,
          mapping.hsOwnerName,
          mapping.matchMethod,
        );
      });

      await database.query(
        `INSERT INTO owner_mappings
         (run_id, sf_user_id, sf_user_email, sf_user_name, hs_owner_id, hs_owner_email, hs_owner_name, match_method)
         VALUES ${valuePlaceholders.join(", ")}
         ON CONFLICT (sf_user_id, run_id)
         DO UPDATE SET
           hs_owner_id = EXCLUDED.hs_owner_id,
           hs_owner_email = EXCLUDED.hs_owner_email,
           hs_owner_name = EXCLUDED.hs_owner_name,
           match_method = EXCLUDED.match_method,
           updated_at = NOW()`,
        values,
      );

      logger.info(`Stored ${mappings.length} owner mappings in database`);
    } catch (error: any) {
      logger.error("Failed to store owner mappings", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get HubSpot owner ID for a Salesforce user ID
   */
  getHubSpotOwnerId(sfUserId: string | null | undefined): string | null {
    if (!sfUserId) return this.defaultOwnerId;

    const hsOwnerId = this.ownerCache.get(sfUserId);

    if (!hsOwnerId) {
      // Return default owner for unmapped Salesforce users
      if (this.defaultOwnerId) {
        logger.debug(
          `No HubSpot owner mapping found for Salesforce user: ${sfUserId}, using default owner`,
        );
        return this.defaultOwnerId;
      }
      logger.debug(
        `No HubSpot owner mapping found for Salesforce user: ${sfUserId}`,
      );
      return null;
    }

    return hsOwnerId;
  }

  /**
   * Load owner mappings from database (for resuming runs)
   */
  async loadMappingsFromDatabase(runId: string): Promise<void> {
    try {
      logger.info(`Loading owner mappings from database for run: ${runId}`);

      const result = await database.query<{
        sf_user_id: string;
        hs_owner_id: string;
      }>(
        "SELECT sf_user_id, hs_owner_id FROM owner_mappings WHERE run_id = $1",
        [runId],
      );

      this.ownerCache.clear();
      for (const row of result.rows) {
        this.ownerCache.set(row.sf_user_id, row.hs_owner_id);
      }

      this.runId = runId;
      this.initialized = true;

      logger.info(`Loaded ${result.rows.length} owner mappings from database`);
    } catch (error: any) {
      logger.error("Failed to load owner mappings from database", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get mapping statistics
   */
  getStats(): { totalMappings: number; runId: string | null } {
    return {
      totalMappings: this.ownerCache.size,
      runId: this.runId,
    };
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.ownerCache.clear();
    this.runId = null;
    this.initialized = false;
  }
}

export default new OwnerMapperService();
