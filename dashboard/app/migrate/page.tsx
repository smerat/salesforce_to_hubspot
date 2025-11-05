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
type MigrationType = "account_to_company" | "opportunity_renewal_associations";

export default function MigratePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("select");
  const [migrationType, setMigrationType] =
    useState<MigrationType>("account_to_company");
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);

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
