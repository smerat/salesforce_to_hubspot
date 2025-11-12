"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import FieldMapper, { FieldMapping } from "@/components/FieldMapper";
import MigrationPreview from "@/components/MigrationPreview";
import { supabase } from "@/lib/supabase";

type Step = "select" | "mapping" | "preview";
type MigrationType =
  | "account_to_company"
  | "opportunity_renewal_associations"
  | "pilot_opportunity_associations"
  | "event_to_meeting_migration"
  | "opportunity_product_dates"
  | "sync_deal_contract_dates"
  | "opportunity_line_item_dates"
  | "line_items"
  | "cleanup_tasks"
  | "cleanup_meetings"
  | "cleanup_line_items";

export default function MigratePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("select");
  const [migrationType, setMigrationType] =
    useState<MigrationType>("account_to_company");
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeletingMeetings, setIsDeletingMeetings] = useState(false);
  const [isDeletingTasks, setIsDeletingTasks] = useState(false);

  async function handleDeleteAllTasks() {
    if (
      !confirm(
        "Are you sure you want to delete ALL tasks from HubSpot? This action cannot be undone.",
      )
    ) {
      return;
    }

    setIsDeletingTasks(true);

    try {
      const response = await fetch("/api/delete-tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete tasks");
      }

      alert(
        result.message || `Successfully deleted ${result.deletedCount} tasks`,
      );
    } catch (err: any) {
      console.error("Error deleting tasks:", err);
      alert("Error: " + err.message);
    } finally {
      setIsDeletingTasks(false);
    }
  }

  async function handleDeleteAllMeetings() {
    if (
      !confirm(
        "Are you sure you want to delete ALL meetings from HubSpot? This action cannot be undone.",
      )
    ) {
      return;
    }

    setIsDeletingMeetings(true);

    try {
      const response = await fetch("/api/delete-meetings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete meetings");
      }

      alert(
        result.message ||
          `Successfully deleted ${result.deletedCount} meetings`,
      );
    } catch (err: any) {
      console.error("Error deleting meetings:", err);
      alert("Error: " + err.message);
    } finally {
      setIsDeletingMeetings(false);
    }
  }

  async function handleDeleteAllLineItems() {
    if (
      !confirm(
        "Are you sure you want to delete ALL line items from HubSpot? This action cannot be undone.",
      )
    ) {
      return;
    }

    setIsDeleting(true);

    try {
      const response = await fetch("/api/delete-line-items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete line items");
      }

      alert(
        result.message ||
          `Successfully deleted ${result.deletedCount} line items`,
      );
    } catch (err: any) {
      console.error("Error deleting line items:", err);
      alert("Error: " + err.message);
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleConfirmMigration(testMode: boolean = false) {
    try {
      // Build config based on migration type
      const configSnapshot: any = {
        migrationType: migrationType,
        testMode: testMode,
        testModeLimit: testMode ? 5 : undefined,
      };

      // Only include field mappings for account_to_company
      if (migrationType === "account_to_company") {
        configSnapshot.fieldMappings = fieldMappings;
      }

      // Create migration run in Supabase
      const { data, error } = await supabase
        .from("migration_runs")
        .insert({
          status: "queued",
          config_snapshot: configSnapshot,
          notes: testMode
            ? `TEST: ${getMigrationTypeName(migrationType)} (5 records only)`
            : `${getMigrationTypeName(migrationType)} from dashboard`,
        })
        .select()
        .single();

      if (error) {
        console.error("Failed to queue migration:", error);
        alert("Failed to queue migration: " + error.message);
        return;
      }

      const message = testMode
        ? "Test migration queued! The worker will process 5 records only."
        : "Migration queued successfully! The worker will process it shortly.";
      alert(message);

      // Redirect to dashboard to monitor progress
      router.push(`/?run=${data.id}`);
    } catch (err: any) {
      console.error("Error queuing migration:", err);
      alert("Error: " + err.message);
    }
  }

  function getMigrationTypeName(type: MigrationType): string {
    switch (type) {
      case "account_to_company":
        return "Account to Company migration";
      case "opportunity_renewal_associations":
        return "Opportunity Renewal Associations migration";
      case "pilot_opportunity_associations":
        return "Pilot Opportunity Associations migration";
      case "event_to_meeting_migration":
        return "Event to Meeting migration";
      case "opportunity_product_dates":
        return "Opportunity Product Dates migration";
      case "sync_deal_contract_dates":
        return "Sync Deal Contract Dates migration";
      case "opportunity_line_item_dates":
        return "OpportunityLineItem Dates migration";
      case "line_items":
        return "OpportunityLineItem to Deal Line Items migration";
      case "cleanup_tasks":
        return "Cleanup HubSpot Tasks";
      case "cleanup_meetings":
        return "Cleanup HubSpot Meetings";
      case "cleanup_line_items":
        return "Cleanup HubSpot Line Items";
      default:
        return "Migration";
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold">New Migration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Salesforce Account → HubSpot Company
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Progress Steps */}
        <div className="mb-8 flex items-center justify-center gap-4">
          <div className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                step === "select"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              1
            </div>
            <span className="ml-2 text-sm">Select Type</span>
          </div>
          <div className="h-px w-12 bg-border" />
          <div className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                step === "mapping"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              2
            </div>
            <span className="ml-2 text-sm">Field Mapping</span>
          </div>
          <div className="h-px w-12 bg-border" />
          <div className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                step === "preview"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              3
            </div>
            <span className="ml-2 text-sm">Preview</span>
          </div>
        </div>

        {/* Step 1: Select Migration Type */}
        {step === "select" && (
          <Card>
            <CardHeader>
              <CardTitle>Select Migration Type</CardTitle>
              <CardDescription>Choose what you want to migrate</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {/* Utility Section */}
                <div className="mb-4 rounded-lg border-2 border-red-500/50 bg-red-500/5 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-red-600">
                    🧹 Cleanup Utilities
                  </h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        setMigrationType("cleanup_tasks");
                        setStep("preview");
                      }}
                      className="w-full rounded-lg border-2 border-red-500 bg-red-500/10 p-3 text-left transition-all hover:bg-red-500/20"
                    >
                      <h4 className="text-sm font-semibold text-red-600">
                        Delete All Tasks
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        ⚠️ Removes ALL tasks from HubSpot
                      </p>
                    </button>
                    <button
                      onClick={() => {
                        setMigrationType("cleanup_meetings");
                        setStep("preview");
                      }}
                      className="w-full rounded-lg border-2 border-red-500 bg-red-500/10 p-3 text-left transition-all hover:bg-red-500/20"
                    >
                      <h4 className="text-sm font-semibold text-red-600">
                        Delete All Meetings
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        ⚠️ Removes ALL meetings from HubSpot
                      </p>
                    </button>
                    <button
                      onClick={() => {
                        setMigrationType("cleanup_line_items");
                        setStep("preview");
                      }}
                      className="w-full rounded-lg border-2 border-red-500 bg-red-500/10 p-3 text-left transition-all hover:bg-red-500/20"
                    >
                      <h4 className="text-sm font-semibold text-red-600">
                        Delete All Line Items
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        ⚠️ Removes ALL line items from HubSpot
                      </p>
                    </button>
                  </div>
                </div>

                {/* Migrations Section */}
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                  Data Migrations
                </h3>

                <button
                  onClick={() => {
                    setMigrationType("account_to_company");
                    setStep("mapping");
                  }}
                  className="w-full rounded-lg border-2 border-primary bg-primary/10 p-6 text-left transition-all hover:bg-primary/20"
                >
                  <h3 className="text-lg font-semibold">
                    Salesforce Account → HubSpot Company
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Migrate Salesforce Accounts to HubSpot Companies with custom
                    field mapping
                  </p>
                </button>

                <button
                  onClick={() => {
                    setMigrationType("opportunity_renewal_associations");
                    setStep("preview");
                  }}
                  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
                >
                  <h3 className="text-lg font-semibold">
                    Opportunity Renewal Associations
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create deal-to-deal associations for renewal opportunities
                    based on Salesforce renewal_opportunity__c field
                  </p>
                </button>

                <button
                  onClick={() => {
                    setMigrationType("pilot_opportunity_associations");
                    setStep("preview");
                  }}
                  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
                >
                  <h3 className="text-lg font-semibold">
                    Pilot Opportunity Associations
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create deal-to-deal associations for pilot opportunities
                    based on Salesforce Pilot_Opportunity__c field
                  </p>
                </button>

                <button
                  onClick={() => {
                    setMigrationType("event_to_meeting_migration");
                    setStep("preview");
                  }}
                  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
                >
                  <h3 className="text-lg font-semibold">
                    Events to Meetings (Salesforce → HubSpot)
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Migrate Salesforce Events to HubSpot Meeting engagements
                    with associations to Contacts, Companies, and Deals
                  </p>
                </button>

                <button
                  onClick={() => {
                    setMigrationType("opportunity_product_dates");
                    setStep("preview");
                  }}
                  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
                >
                  <h3 className="text-lg font-semibold">
                    Opportunity Product Dates (Salesforce Only)
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Update Opportunity Product_Start_Date__c and
                    Product_End_Date__c from Line Item Schedule dates
                    (psi_Opportunity__c)
                  </p>
                </button>

                <button
                  onClick={() => {
                    setMigrationType("sync_deal_contract_dates");
                    setStep("preview");
                  }}
                  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
                >
                  <h3 className="text-lg font-semibold">
                    Sync Deal Contract Dates
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Sync Salesforce Opportunity dates to HubSpot Deal contract
                    dates (contract_end_date = Product_End_Date__c + 1 month,
                    uses CloseDate as fallback)
                  </p>
                </button>

                <button
                  onClick={() => {
                    setMigrationType("opportunity_line_item_dates");
                    setStep("preview");
                  }}
                  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
                >
                  <h3 className="text-lg font-semibold">
                    OpportunityLineItem Dates (Salesforce Only)
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Update OpportunityLineItem Start_Date__c and End_Date__c
                    from Line Item Schedule dates (OpportunityLineItemId lookup)
                  </p>
                </button>

                <button
                  onClick={() => {
                    setMigrationType("line_items");
                    setStep("preview");
                  }}
                  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
                >
                  <h3 className="text-lg font-semibold">
                    Line Items (Salesforce → HubSpot)
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Migrate OpportunityLineItems to HubSpot Deal Line Items with
                    product details, pricing, and dates
                  </p>
                </button>
              </div>

              <div className="mt-6 flex justify-start">
                <Button onClick={() => router.push("/")} variant="outline">
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Field Mapping */}
        {step === "mapping" && (
          <FieldMapper
            onNext={(mappings) => {
              setFieldMappings(mappings);
              setStep("preview");
            }}
          />
        )}

        {/* Step 3: Preview */}
        {step === "preview" && (
          <MigrationPreview
            migrationType={migrationType}
            fieldMappings={fieldMappings}
            onBack={() => {
              if (migrationType === "account_to_company") {
                setStep("mapping");
              } else {
                setStep("select");
              }
            }}
            onConfirm={handleConfirmMigration}
          />
        )}
      </main>
    </div>
  );
}
