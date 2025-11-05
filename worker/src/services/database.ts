import { Pool, QueryResult, QueryResultRow } from "pg";
import config from "../config";
import logger from "../utils/logger";
import {
  MigrationRun,
  MigrationProgress,
  IdMapping,
  MigrationError,
  AuditLog,
  ObjectType,
  MigrationStatus,
  ProgressStatus,
} from "../types";

class DatabaseService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.supabase.dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.pool.on("error", (err) => {
      logger.error("Unexpected error on idle client", err);
    });
  }

  async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[],
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      logger.debug("Executed query", { text, duration, rows: result.rowCount });
      return result;
    } catch (error: any) {
      logger.error("Database query error", {
        text,
        params,
        errorMessage: error.message,
        errorCode: error.code,
        errorDetail: error.detail,
        error,
      });
      throw error;
    }
  }

  // Migration Runs
  async createMigrationRun(
    status: MigrationStatus = "queued",
    config_snapshot?: Record<string, any>,
    notes?: string,
  ): Promise<MigrationRun> {
    const result = await this.query<MigrationRun>(
      `INSERT INTO migration_runs (status, config_snapshot, notes)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [status, JSON.stringify(config_snapshot), notes],
    );
    return result.rows[0];
  }

  async updateMigrationRun(
    runId: string,
    updates: Partial<Pick<MigrationRun, "status" | "completed_at" | "notes">>,
  ): Promise<MigrationRun> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.status) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.completed_at) {
      setClauses.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completed_at);
    }
    if (updates.notes) {
      setClauses.push(`notes = $${paramIndex++}`);
      values.push(updates.notes);
    }

    values.push(runId);

    const result = await this.query<MigrationRun>(
      `UPDATE migration_runs
       SET ${setClauses.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  async getMigrationRun(runId: string): Promise<MigrationRun | null> {
    const result = await this.query<MigrationRun>(
      "SELECT * FROM migration_runs WHERE id = $1",
      [runId],
    );
    return result.rows[0] || null;
  }

  async getQueuedMigrationRuns(): Promise<MigrationRun[]> {
    const result = await this.query<MigrationRun>(
      "SELECT * FROM migration_runs WHERE status = $1 ORDER BY started_at ASC",
      ["queued"],
    );
    return result.rows;
  }

  // Migration Progress
  async createMigrationProgress(
    runId: string,
    objectType: ObjectType,
    status: ProgressStatus = "pending",
  ): Promise<MigrationProgress> {
    const result = await this.query<MigrationProgress>(
      `INSERT INTO migration_progress (run_id, object_type, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [runId, objectType, status],
    );
    return result.rows[0];
  }

  async updateMigrationProgress(
    runId: string,
    objectType: ObjectType,
    updates: Partial<MigrationProgress>,
  ): Promise<MigrationProgress> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const allowedFields = [
      "total_records",
      "processed_records",
      "failed_records",
      "skipped_records",
      "last_sf_id_processed",
      "last_sf_modified_date",
      "status",
      "started_at",
      "completed_at",
    ];

    for (const field of allowedFields) {
      if (updates[field as keyof MigrationProgress] !== undefined) {
        setClauses.push(`${field} = $${paramIndex++}`);
        values.push(updates[field as keyof MigrationProgress]);
      }
    }

    values.push(runId, objectType);

    const result = await this.query<MigrationProgress>(
      `UPDATE migration_progress
       SET ${setClauses.join(", ")}
       WHERE run_id = $${paramIndex++} AND object_type = $${paramIndex}
       RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  async getMigrationProgress(
    runId: string,
    objectType: ObjectType,
  ): Promise<MigrationProgress | null> {
    const result = await this.query<MigrationProgress>(
      "SELECT * FROM migration_progress WHERE run_id = $1 AND object_type = $2",
      [runId, objectType],
    );
    return result.rows[0] || null;
  }

  async getAllMigrationProgress(runId: string): Promise<MigrationProgress[]> {
    const result = await this.query<MigrationProgress>(
      "SELECT * FROM migration_progress WHERE run_id = $1 ORDER BY object_type",
      [runId],
    );
    return result.rows;
  }

  async incrementProcessedRecords(
    runId: string,
    objectType: ObjectType,
    count: number = 1,
  ): Promise<void> {
    await this.query(
      `UPDATE migration_progress
       SET processed_records = processed_records + $1
       WHERE run_id = $2 AND object_type = $3`,
      [count, runId, objectType],
    );
  }

  async incrementFailedRecords(
    runId: string,
    objectType: ObjectType,
    count: number = 1,
  ): Promise<void> {
    await this.query(
      `UPDATE migration_progress
       SET failed_records = failed_records + $1
       WHERE run_id = $2 AND object_type = $3`,
      [count, runId, objectType],
    );
  }

  // ID Mappings
  async createIdMapping(
    runId: string,
    salesforceId: string,
    salesforceType: string,
    hubspotId: string,
    hubspotType: string,
    metadata?: Record<string, any>,
  ): Promise<IdMapping> {
    const result = await this.query<IdMapping>(
      `INSERT INTO id_mappings (run_id, salesforce_id, salesforce_type, hubspot_id, hubspot_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (salesforce_id, salesforce_type)
       DO UPDATE SET hubspot_id = $4, metadata = $6, migrated_at = NOW()
       RETURNING *`,
      [
        runId,
        salesforceId,
        salesforceType,
        hubspotId,
        hubspotType,
        JSON.stringify(metadata),
      ],
    );
    return result.rows[0];
  }

  async bulkCreateIdMappings(
    mappings: Array<{
      runId: string;
      salesforceId: string;
      salesforceType: string;
      hubspotId: string;
      hubspotType: string;
      metadata?: Record<string, any>;
    }>,
  ): Promise<void> {
    if (mappings.length === 0) return;

    const values: any[] = [];
    const valuePlaceholders: string[] = [];

    mappings.forEach((mapping, index) => {
      const offset = index * 6;
      valuePlaceholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`,
      );
      values.push(
        mapping.runId,
        mapping.salesforceId,
        mapping.salesforceType,
        mapping.hubspotId,
        mapping.hubspotType,
        JSON.stringify(mapping.metadata || {}),
      );
    });

    await this.query(
      `INSERT INTO id_mappings (run_id, salesforce_id, salesforce_type, hubspot_id, hubspot_type, metadata)
       VALUES ${valuePlaceholders.join(", ")}
       ON CONFLICT (salesforce_id, salesforce_type)
       DO UPDATE SET hubspot_id = EXCLUDED.hubspot_id, metadata = EXCLUDED.metadata, migrated_at = NOW()`,
      values,
    );
  }

  async getIdMapping(
    salesforceId: string,
    salesforceType: string,
  ): Promise<IdMapping | null> {
    const result = await this.query<IdMapping>(
      "SELECT * FROM id_mappings WHERE salesforce_id = $1 AND salesforce_type = $2",
      [salesforceId, salesforceType],
    );
    return result.rows[0] || null;
  }

  async getHubSpotId(
    salesforceId: string,
    salesforceType: string,
  ): Promise<string | null> {
    const mapping = await this.getIdMapping(salesforceId, salesforceType);
    return mapping?.hubspot_id || null;
  }

  // Migration Errors
  async createMigrationError(
    runId: string,
    objectType: ObjectType,
    salesforceId: string,
    salesforceType: string,
    error_message: string,
    error_details?: Record<string, any>,
  ): Promise<MigrationError> {
    const result = await this.query<MigrationError>(
      `INSERT INTO migration_errors (run_id, object_type, salesforce_id, salesforce_type, error_message, error_details)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        runId,
        objectType,
        salesforceId,
        salesforceType,
        error_message,
        JSON.stringify(error_details),
      ],
    );
    return result.rows[0];
  }

  async incrementErrorRetryCount(errorId: string): Promise<void> {
    await this.query(
      "UPDATE migration_errors SET retry_count = retry_count + 1 WHERE id = $1",
      [errorId],
    );
  }

  async getPendingRetryErrors(
    runId: string,
    maxRetries: number,
  ): Promise<MigrationError[]> {
    const result = await this.query<MigrationError>(
      `SELECT * FROM migration_errors
       WHERE run_id = $1 AND status = 'pending_retry' AND retry_count < $2
       ORDER BY created_at ASC`,
      [runId, maxRetries],
    );
    return result.rows;
  }

  // Audit Log
  async createAuditLog(
    runId: string,
    action: string,
    objectType?: ObjectType,
    recordCount?: number,
    metadata?: Record<string, any>,
  ): Promise<AuditLog> {
    const result = await this.query<AuditLog>(
      `INSERT INTO audit_log (run_id, action, object_type, record_count, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [runId, action, objectType, recordCount, JSON.stringify(metadata)],
    );
    return result.rows[0];
  }

  // Utility
  async close(): Promise<void> {
    await this.pool.end();
    logger.info("Database connection pool closed");
  }
}

export default new DatabaseService();
