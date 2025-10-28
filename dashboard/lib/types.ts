export type ObjectType = 'contacts' | 'companies' | 'deals' | 'activities' | 'notes';
export type MigrationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'paused';
export type ProgressStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface MigrationRun {
  id: string;
  started_at: string;
  completed_at?: string;
  status: MigrationStatus;
  config_snapshot?: any;
  notes?: string;
  created_by?: string;
  updated_at: string;
}

export interface MigrationProgress {
  id: string;
  run_id: string;
  object_type: ObjectType;
  total_records?: number;
  processed_records: number;
  failed_records: number;
  skipped_records: number;
  last_sf_id_processed?: string;
  status: ProgressStatus;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
}

export interface MigrationError {
  id: string;
  run_id: string;
  salesforce_id?: string;
  salesforce_type?: string;
  object_type: ObjectType;
  error_message?: string;
  error_details?: any;
  retry_count: number;
  status: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  run_id: string;
  action: string;
  object_type?: ObjectType;
  record_count?: number;
  metadata?: any;
  timestamp: string;
}
