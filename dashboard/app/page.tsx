'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { MigrationRun, MigrationProgress, MigrationError } from '@/lib/types';
import ProgressCard from '@/components/ProgressCard';
import ErrorsTable from '@/components/ErrorsTable';

export default function DashboardPage() {
  const [runs, setRuns] = useState<MigrationRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<MigrationRun | null>(null);
  const [progress, setProgress] = useState<MigrationProgress[]>([]);
  const [errors, setErrors] = useState<MigrationError[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch migration runs
  useEffect(() => {
    fetchMigrationRuns();
  }, []);

  // Fetch progress and errors when a run is selected
  useEffect(() => {
    if (selectedRun) {
      fetchProgress(selectedRun.id);
      fetchErrors(selectedRun.id);

      // Subscribe to real-time updates for progress
      const progressChannel = supabase
        .channel('progress-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'migration_progress',
            filter: `run_id=eq.${selectedRun.id}`,
          },
          (payload) => {
            console.log('Progress update:', payload);
            fetchProgress(selectedRun.id);
          }
        )
        .subscribe();

      // Subscribe to real-time updates for errors
      const errorsChannel = supabase
        .channel('errors-changes')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'migration_errors',
            filter: `run_id=eq.${selectedRun.id}`,
          },
          (payload) => {
            console.log('New error:', payload);
            fetchErrors(selectedRun.id);
          }
        )
        .subscribe();

      // Subscribe to run status changes
      const runChannel = supabase
        .channel('run-changes')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'migration_runs',
            filter: `id=eq.${selectedRun.id}`,
          },
          (payload) => {
            console.log('Run update:', payload);
            setSelectedRun(payload.new as MigrationRun);
            fetchMigrationRuns();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(progressChannel);
        supabase.removeChannel(errorsChannel);
        supabase.removeChannel(runChannel);
      };
    }
  }, [selectedRun]);

  async function fetchMigrationRuns() {
    const { data, error } = await supabase
      .from('migration_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching runs:', error);
      return;
    }

    setRuns(data || []);
    if (data && data.length > 0 && !selectedRun) {
      setSelectedRun(data[0]);
    }
    setLoading(false);
  }

  async function fetchProgress(runId: string) {
    const { data, error } = await supabase
      .from('migration_progress')
      .select('*')
      .eq('run_id', runId)
      .order('object_type');

    if (error) {
      console.error('Error fetching progress:', error);
      return;
    }

    setProgress(data || []);
  }

  async function fetchErrors(runId: string) {
    const { data, error } = await supabase
      .from('migration_errors')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching errors:', error);
      return;
    }

    setErrors(data || []);
  }

  async function createNewMigration() {
    const { data, error } = await supabase
      .from('migration_runs')
      .insert({
        status: 'queued',
        config_snapshot: {
          objectTypes: ['companies', 'contacts', 'deals'],
        },
        notes: 'Created from dashboard',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating migration:', error);
      alert('Failed to create migration: ' + error.message);
      return;
    }

    alert('Migration queued successfully! Start the worker to begin processing.');
    fetchMigrationRuns();
  }

  const statusColors = {
    queued: 'bg-gray-100 text-gray-800',
    running: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    paused: 'bg-yellow-100 text-yellow-800',
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Migration Dashboard
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Salesforce to HubSpot Data Migration
              </p>
            </div>
            <button
              onClick={createNewMigration}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              + New Migration
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Migration Run Selector */}
        <div className="mb-8 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Migration Runs</h2>
          <div className="space-y-2">
            {runs.length === 0 ? (
              <p className="text-gray-500 text-center py-4">
                No migration runs found. Create one to get started.
              </p>
            ) : (
              runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => setSelectedRun(run)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    selectedRun?.id === run.id
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-gray-900">
                        Run ID: {run.id.slice(0, 8)}...
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        Started: {new Date(run.started_at).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        statusColors[run.status] || statusColors.queued
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {selectedRun && (
          <>
            {/* Progress Cards */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Migration Progress
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {progress.length === 0 ? (
                  <div className="col-span-full text-center py-8 text-gray-500">
                    No progress data available
                  </div>
                ) : (
                  progress.map((prog) => (
                    <ProgressCard key={prog.id} progress={prog} />
                  ))
                )}
              </div>
            </div>

            {/* Overall Stats */}
            <div className="mb-8 bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Overall Statistics
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">
                    {progress.reduce((sum, p) => sum + (p.total_records || 0), 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Total Records</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">
                    {progress.reduce((sum, p) => sum + p.processed_records, 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-red-600">
                    {progress.reduce((sum, p) => sum + p.failed_records, 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Failed</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-700">
                    {progress.filter((p) => p.status === 'completed').length}/{progress.length}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Completed Objects</div>
                </div>
              </div>
            </div>

            {/* Errors Table */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Errors</h2>
              <ErrorsTable errors={errors} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
