"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { MigrationRun, MigrationProgress, MigrationError } from "@/lib/types";
import ProgressCard from "@/components/ProgressCard";
import ErrorsTable from "@/components/ErrorsTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReloadIcon, RocketIcon } from "@radix-ui/react-icons";

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
        .channel("progress-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "migration_progress",
            filter: `run_id=eq.${selectedRun.id}`,
          },
          () => {
            fetchProgress(selectedRun.id);
          },
        )
        .subscribe();

      // Subscribe to real-time updates for errors
      const errorsChannel = supabase
        .channel("errors-changes")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "migration_errors",
            filter: `run_id=eq.${selectedRun.id}`,
          },
          () => {
            fetchErrors(selectedRun.id);
          },
        )
        .subscribe();

      // Subscribe to run status changes
      const runChannel = supabase
        .channel("run-changes")
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "migration_runs",
            filter: `id=eq.${selectedRun.id}`,
          },
          (payload) => {
            setSelectedRun(payload.new as MigrationRun);
            fetchMigrationRuns();
          },
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
      .from("migration_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("Error fetching runs:", error);
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
      .from("migration_progress")
      .select("*")
      .eq("run_id", runId)
      .order("object_type");

    if (error) {
      console.error("Error fetching progress:", error);
      return;
    }

    setProgress(data || []);
  }

  async function fetchErrors(runId: string) {
    const { data, error } = await supabase
      .from("migration_errors")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching errors:", error);
      return;
    }

    setErrors(data || []);
  }

  function createNewMigration() {
    // Navigate to migration wizard
    window.location.href = "/migrate";
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "completed":
        return "outline";
      case "running":
        return "default";
      case "failed":
        return "destructive";
      default:
        return "secondary";
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <ReloadIcon className="mx-auto h-12 w-12 animate-spin text-primary" />
          <p className="mt-4 text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Migration Dashboard</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Salesforce to HubSpot Data Migration
              </p>
            </div>
            <Button onClick={createNewMigration} size="lg">
              <RocketIcon className="mr-2 h-4 w-4" />
              New Migration
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Migration Run Selector */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Migration Runs</CardTitle>
            <CardDescription>
              Select a migration run to view details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {runs.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  No migration runs found. Create one to get started.
                </div>
              ) : (
                runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRun(run)}
                    className={`w-full rounded-lg border-2 p-4 text-left transition-all ${
                      selectedRun?.id === run.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-mono text-sm font-medium">
                            Run ID: {run.id.slice(0, 8)}...
                          </div>
                          {run.config_snapshot?.testMode && (
                            <Badge variant="secondary" className="text-xs">
                              🧪 TEST
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Started: {new Date(run.started_at).toLocaleString()}
                        </div>
                        {run.config_snapshot?.migrationType && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Type: {run.config_snapshot.migrationType}
                            {run.config_snapshot?.testMode &&
                              ` (${run.config_snapshot.testModeLimit || 5} records)`}
                          </div>
                        )}
                      </div>
                      <Badge variant={getStatusVariant(run.status)}>
                        {run.status}
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {selectedRun && (
          <>
            {/* Progress Cards */}
            <div className="mb-8">
              <h2 className="mb-4 text-2xl font-semibold">
                Migration Progress
              </h2>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {progress.length === 0 ? (
                  <div className="col-span-full py-8 text-center text-muted-foreground">
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
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Overall Statistics</CardTitle>
                <CardDescription>Summary of migration progress</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Total Records
                    </p>
                    <p className="text-3xl font-bold text-primary">
                      {progress
                        .reduce((sum, p) => sum + (p.total_records || 0), 0)
                        .toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Processed</p>
                    <p className="text-3xl font-bold text-green-400">
                      {progress
                        .reduce((sum, p) => sum + p.processed_records, 0)
                        .toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Failed</p>
                    <p className="text-3xl font-bold text-red-400">
                      {progress
                        .reduce((sum, p) => sum + p.failed_records, 0)
                        .toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Completed Objects
                    </p>
                    <p className="text-3xl font-bold">
                      {progress.filter((p) => p.status === "completed").length}/
                      {progress.length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Errors Table */}
            <div>
              <h2 className="mb-4 text-2xl font-semibold">Errors</h2>
              <ErrorsTable errors={errors} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
