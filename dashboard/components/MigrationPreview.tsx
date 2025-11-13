"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReloadIcon, RocketIcon, ArrowLeftIcon } from "@radix-ui/react-icons";
import { FieldMapping } from "./FieldMapper";

type MigrationType =
  | "account_to_company"
  | "opportunity_renewal_associations"
  | "pilot_opportunity_associations"
  | "event_to_meeting_migration"
  | "call_migration_from_excel"
  | "email_migration_from_excel"
  | "meeting_migration_from_excel"
  | "task_migration_from_excel"
  | "opportunity_product_dates"
  | "sync_deal_contract_dates"
  | "opportunity_line_item_dates"
  | "line_items"
  | "cleanup_tasks"
  | "cleanup_meetings"
  | "cleanup_emails"
  | "cleanup_line_items";

interface MigrationPreviewProps {
  migrationType: MigrationType;
  fieldMappings: FieldMapping[];
  onBack: () => void;
  onConfirm: (testMode?: boolean) => void;
}

interface PreviewData {
  totalCount: number;
  sampleRecords: any[];
}

export default function MigrationPreview({
  migrationType,
  fieldMappings,
  onBack,
  onConfirm,
}: MigrationPreviewProps) {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPreview() {
    setLoading(true);
    setError(null);

    try {
      // For cleanup types and call/email/meeting migration - no preview needed, just set dummy data
      if (
        migrationType === "cleanup_tasks" ||
        migrationType === "cleanup_meetings" ||
        migrationType === "cleanup_emails" ||
        migrationType === "cleanup_line_items" ||
        migrationType === "call_migration_from_excel" ||
        migrationType === "email_migration_from_excel" ||
        migrationType === "meeting_migration_from_excel" ||
        migrationType === "task_migration_from_excel"
      ) {
        setPreviewData({
          totalCount:
            migrationType === "call_migration_from_excel"
              ? 2800
              : migrationType === "email_migration_from_excel"
                ? 4500
                : migrationType === "meeting_migration_from_excel"
                  ? 1424
                  : migrationType === "task_migration_from_excel"
                    ? 53
                    : 0,
          sampleRecords: [],
        });
        setLoading(false);
        return;
      }

      // For opportunity renewal associations
      if (migrationType === "opportunity_renewal_associations") {
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectName: "Opportunity",
            fields: ["Id", "renewal_opportunity__c"],
            limit: 3,
            whereClause: "renewal_opportunity__c != null",
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch preview");
        }

        const data = await response.json();
        setPreviewData(data);
      } else if (migrationType === "pilot_opportunity_associations") {
        // For pilot opportunity associations
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectName: "Opportunity",
            fields: ["Id", "Pilot_Opportunity__c"],
            limit: 3,
            whereClause: "Pilot_Opportunity__c != null",
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch preview");
        }

        const data = await response.json();
        setPreviewData(data);
      } else if (migrationType === "event_to_meeting_migration") {
        // For event to meeting migration
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectName: "Event",
            fields: [
              "Id",
              "Subject",
              "Description",
              "Location",
              "StartDateTime",
              "EndDateTime",
              "WhoId",
              "WhatId",
              "OwnerId",
            ],
            limit: 3,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch preview");
        }

        const data = await response.json();
        setPreviewData(data);
      } else if (migrationType === "opportunity_product_dates") {
        // For opportunity product dates migration
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectName: "Opportunity",
            fields: [
              "Id",
              "Name",
              "Product_Start_Date__c",
              "Product_End_Date__c",
            ],
            limit: 3,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch preview");
        }

        const data = await response.json();
        setPreviewData(data);
      } else if (migrationType === "sync_deal_contract_dates") {
        // For sync deal contract dates migration
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectName: "Opportunity",
            fields: [
              "Id",
              "Name",
              "Product_Start_Date__c",
              "Product_End_Date__c",
              "CloseDate",
            ],
            limit: 3,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch preview");
        }

        const data = await response.json();
        setPreviewData(data);
      } else if (migrationType === "opportunity_line_item_dates") {
        // For opportunity line item dates migration
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectName: "OpportunityLineItem",
            fields: [
              "Id",
              "Name",
              "Start_Date__c",
              "End_Date__c",
              "OpportunityId",
            ],
            limit: 3,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch preview");
        }

        const data = await response.json();
        setPreviewData(data);
      } else if (migrationType === "line_items") {
        // For line items migration
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectName: "OpportunityLineItem",
            fields: [
              "Id",
              "OpportunityId",
              "Product2.Name",
              "Quantity",
              "UnitPrice",
              "TotalPrice",
              "Start_Date__c",
              "End_Date__c",
              "installments__c",
            ],
            limit: 3,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch preview");
        }

        const data = await response.json();
        setPreviewData(data);
      } else {
        // For account to company migration
        const sfFields = fieldMappings.map((m) => m.salesforceField);

        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objectName: "Account",
            fields: sfFields,
            limit: 3,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch preview");
        }

        const data = await response.json();
        setPreviewData(data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch preview on mount
  useState(() => {
    fetchPreview();
  });

  const estimatedTime = previewData
    ? Math.ceil((previewData.totalCount / 100) * 0.5) // ~0.5 min per 100 records
    : 0;

  const isAssociationMigration =
    migrationType === "opportunity_renewal_associations" ||
    migrationType === "pilot_opportunity_associations";

  const isEventToMeeting = migrationType === "event_to_meeting_migration";

  const isCallMigration = migrationType === "call_migration_from_excel";

  const isEmailMigration = migrationType === "email_migration_from_excel";

  const isMeetingMigration = migrationType === "meeting_migration_from_excel";

  const isTaskMigration = migrationType === "task_migration_from_excel";

  const isOpportunityProductDates =
    migrationType === "opportunity_product_dates";

  const isSyncDealContractDates = migrationType === "sync_deal_contract_dates";

  const isOpportunityLineItemDates =
    migrationType === "opportunity_line_item_dates";

  const isLineItems = migrationType === "line_items";

  const isCleanup =
    migrationType === "cleanup_tasks" ||
    migrationType === "cleanup_meetings" ||
    migrationType === "cleanup_emails" ||
    migrationType === "cleanup_line_items";
  const isCleanupTasks = migrationType === "cleanup_tasks";
  const isCleanupMeetings = migrationType === "cleanup_meetings";
  const isCleanupEmails = migrationType === "cleanup_emails";
  const isCleanupLineItems = migrationType === "cleanup_line_items";

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>Migration Preview</CardTitle>
          <CardDescription>
            {isCleanupTasks
              ? "⚠️ This will permanently delete ALL tasks from HubSpot"
              : isCleanupMeetings
                ? "⚠️ This will permanently delete ALL meetings from HubSpot"
                : isCleanupEmails
                  ? "⚠️ This will permanently delete ALL emails from HubSpot"
                  : isCleanupLineItems
                    ? "⚠️ This will permanently delete ALL line items from HubSpot"
                    : isAssociationMigration
                      ? migrationType === "opportunity_renewal_associations"
                        ? "Review renewal associations that will be created"
                        : "Review pilot associations that will be created"
                      : isCallMigration
                        ? "Review call migration from Excel files to HubSpot"
                        : isEmailMigration
                          ? "Review email migration from Excel files to HubSpot"
                          : isMeetingMigration
                            ? "Review meeting migration from Excel files to HubSpot"
                            : isTaskMigration
                              ? "Review task migration from Excel files to HubSpot"
                              : isEventToMeeting
                                ? "Review Salesforce Events that will be migrated to HubSpot Meetings"
                                : isOpportunityProductDates
                                  ? "Review Opportunities that will be updated in Salesforce"
                                  : isSyncDealContractDates
                                    ? "Review Opportunities that will sync dates to HubSpot Deals"
                                    : isOpportunityLineItemDates
                                      ? "Review Opportunity Line Items that will be updated in Salesforce"
                                      : isLineItems
                                        ? "Review OpportunityLineItems that will be migrated to HubSpot Deal Line Items"
                                        : "Review what will be migrated"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <ReloadIcon className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">
                Loading preview...
              </span>
            </div>
          ) : error ? (
            <div className="py-8 text-center">
              <p className="text-red-400">Error: {error}</p>
              <Button onClick={fetchPreview} className="mt-4" variant="outline">
                Retry
              </Button>
            </div>
          ) : previewData ? (
            <>
              {/* Stats */}
              {isCallMigration ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Excel Files</p>
                    <p className="text-2xl font-bold text-primary">3</p>
                    <p className="text-xs text-muted-foreground">
                      Source files (~5,455 rows)
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Unique Calls
                    </p>
                    <p className="text-2xl font-bold text-green-400">
                      ~{previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To create in HubSpot
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : isEmailMigration ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Excel Files</p>
                    <p className="text-2xl font-bold text-primary">3</p>
                    <p className="text-xs text-muted-foreground">
                      Source files (~9,321 rows)
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Unique Emails
                    </p>
                    <p className="text-2xl font-bold text-green-400">
                      ~{previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To create in HubSpot
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : isMeetingMigration ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Excel Files</p>
                    <p className="text-2xl font-bold text-primary">3</p>
                    <p className="text-xs text-muted-foreground">
                      Source files (~3,155 rows)
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Unique Meetings
                    </p>
                    <p className="text-2xl font-bold text-green-400">
                      ~{previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To create in HubSpot
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : isTaskMigration ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Excel Files</p>
                    <p className="text-2xl font-bold text-primary">3</p>
                    <p className="text-xs text-muted-foreground">
                      Source files (~110 rows)
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Unique Tasks
                    </p>
                    <p className="text-2xl font-bold text-green-400">
                      ~{previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To create in HubSpot
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : isCleanup ? (
                <div className="rounded-lg border-2 border-red-500 bg-red-500/10 p-6">
                  <h3 className="text-lg font-semibold text-red-600">
                    ⚠️ Warning: Destructive Operation
                  </h3>
                  <p className="mt-2 text-sm">This will permanently delete:</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {isCleanupTasks && (
                      <li className="flex items-center gap-2">
                        <span className="text-red-500">•</span>
                        <span className="font-semibold">ALL Tasks</span> from
                        HubSpot
                      </li>
                    )}
                    {isCleanupMeetings && (
                      <li className="flex items-center gap-2">
                        <span className="text-red-500">•</span>
                        <span className="font-semibold">ALL Meetings</span> from
                        HubSpot
                      </li>
                    )}
                    {isCleanupEmails && (
                      <li className="flex items-center gap-2">
                        <span className="text-red-500">•</span>
                        <span className="font-semibold">ALL Emails</span> from
                        HubSpot
                      </li>
                    )}
                    {isCleanupLineItems && (
                      <li className="flex items-center gap-2">
                        <span className="text-red-500">•</span>
                        <span className="font-semibold">
                          ALL Line Items
                        </span>{" "}
                        from HubSpot
                      </li>
                    )}
                  </ul>
                  <div className="mt-4 rounded-md bg-red-500/20 p-3">
                    <p className="text-sm font-semibold text-red-600">
                      This action cannot be undone.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Use this before re-running migrations to clean up test
                      data.
                    </p>
                  </div>
                </div>
              ) : isLineItems ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Line Items</p>
                    <p className="text-2xl font-bold text-primary">
                      {previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      From Salesforce
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Target</p>
                    <p className="text-2xl font-bold text-green-400">
                      HubSpot Deals
                    </p>
                    <p className="text-xs text-muted-foreground">Line Items</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : isEventToMeeting ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Events</p>
                    <p className="text-2xl font-bold text-primary">
                      {previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      From Salesforce
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Target</p>
                    <p className="text-2xl font-bold text-green-400">
                      Meetings
                    </p>
                    <p className="text-xs text-muted-foreground">In HubSpot</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : isSyncDealContractDates ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Opportunities
                    </p>
                    <p className="text-2xl font-bold text-primary">
                      {previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To Sync from Salesforce
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Target</p>
                    <p className="text-2xl font-bold text-green-400">Deals</p>
                    <p className="text-xs text-muted-foreground">In HubSpot</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : isOpportunityLineItemDates ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Line Items</p>
                    <p className="text-2xl font-bold text-primary">
                      {previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To Update in Salesforce
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Fields Updated
                    </p>
                    <p className="text-2xl font-bold text-green-400">2</p>
                    <p className="text-xs text-muted-foreground">
                      Start_Date__c & End_Date__c
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : isOpportunityProductDates ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Opportunities
                    </p>
                    <p className="text-2xl font-bold text-primary">
                      {previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To Update in Salesforce
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Fields Updated
                    </p>
                    <p className="text-2xl font-bold text-green-400">2</p>
                    <p className="text-xs text-muted-foreground">
                      Product_Start_Date__c & Product_End_Date__c
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : isAssociationMigration ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {migrationType === "opportunity_renewal_associations"
                        ? "Opportunities with Renewals"
                        : "Opportunities with Pilots"}
                    </p>
                    <p className="text-2xl font-bold text-primary">
                      {previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      In Salesforce
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Associations to Create
                    </p>
                    <p className="text-2xl font-bold text-green-400">
                      {previewData.totalCount * 2}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Bidirectional in HubSpot
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Source</p>
                    <p className="text-2xl font-bold text-primary">
                      {previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Salesforce Accounts
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Destination</p>
                    <p className="text-2xl font-bold text-green-400">
                      {previewData.totalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      HubSpot Companies
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Fields</p>
                    <p className="text-2xl font-bold">{fieldMappings.length}</p>
                    <p className="text-xs text-muted-foreground">
                      Will be migrated
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Est. Time</p>
                    <p className="text-2xl font-bold">{estimatedTime}</p>
                    <p className="text-xs text-muted-foreground">Minutes</p>
                  </div>
                </div>
              )}

              {/* Field Mappings or Association Details */}
              {isCallMigration ? (
                <div>
                  <h3 className="mb-3 font-semibold">Migration Details</h3>
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Source</Badge>
                      <div>
                        <p className="font-semibold">Excel Files (3 files)</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Calls - Contacts, Accounts, Opportunities
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Processing</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">
                          Deduplication & Grouping
                        </p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Groups calls by Activity ID</li>
                          <li>
                            • Same call in multiple files = 1 call with multiple
                            associations
                          </li>
                          <li>• ~5,455 rows → ~2,800 unique calls</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Associations</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">HubSpot Associations</p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Call → Contact (Type ID: 194)</li>
                          <li>• Call → Company (Type ID: 182)</li>
                          <li>• Call → Deal (Type ID: 206)</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Owner Mapping</Badge>
                      <div>
                        <p className="font-semibold">Owner Assignment</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Maps owner names to HubSpot owners, falls back to Sean
                          Merat if not found
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isEmailMigration ? (
                <div>
                  <h3 className="mb-3 font-semibold">Migration Details</h3>
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Source</Badge>
                      <div>
                        <p className="font-semibold">Excel Files (3 files)</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Emails - Contacts, Accounts, Opportunities
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Processing</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">
                          Deduplication & Grouping
                        </p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Groups emails by Activity ID</li>
                          <li>
                            • Same email in multiple files = 1 email with
                            multiple associations
                          </li>
                          <li>• ~9,321 rows → ~4,500 unique emails</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Associations</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">HubSpot Associations</p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Email → Contact (Type ID: 198)</li>
                          <li>• Email → Company (Type ID: 186)</li>
                          <li>• Email → Deal (Type ID: 210)</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Owner Mapping</Badge>
                      <div>
                        <p className="font-semibold">Owner Assignment</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Maps owner names to HubSpot owners, falls back to Sean
                          Merat if not found
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isMeetingMigration ? (
                <div>
                  <h3 className="mb-3 font-semibold">Migration Details</h3>
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Source</Badge>
                      <div>
                        <p className="font-semibold">Excel Files (3 files)</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Meetings - Contacts, Accounts, Opportunities
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Processing</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">
                          Deduplication & Grouping
                        </p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Groups meetings by Activity ID</li>
                          <li>
                            • Same meeting in multiple files = 1 meeting with
                            multiple associations
                          </li>
                          <li>• ~3,155 rows → ~1,424 unique meetings</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Associations</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">HubSpot Associations</p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Meeting → Contact (Type ID: 200)</li>
                          <li>• Meeting → Company (Type ID: 188)</li>
                          <li>• Meeting → Deal (Type ID: 212)</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Owner Mapping</Badge>
                      <div>
                        <p className="font-semibold">Owner Assignment</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Maps owner names to HubSpot owners, falls back to Sean
                          Merat if not found
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isTaskMigration ? (
                <div>
                  <h3 className="mb-3 font-semibold">Migration Details</h3>
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Source</Badge>
                      <div>
                        <p className="font-semibold">Excel Files (3 files)</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Tasks - Contacts, Accounts, Opportunities
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Processing</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">
                          Deduplication & Grouping
                        </p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Groups tasks by Activity ID</li>
                          <li>
                            • Same task in multiple files = 1 task with multiple
                            associations
                          </li>
                          <li>• ~110 rows → ~53 unique tasks</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Associations</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">HubSpot Associations</p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Task → Contact (Type ID: 204)</li>
                          <li>• Task → Company (Type ID: 192)</li>
                          <li>• Task → Deal (Type ID: 216)</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Owner Mapping</Badge>
                      <div>
                        <p className="font-semibold">Owner Assignment</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Maps owner names to HubSpot owners, falls back to Sean
                          Merat if not found
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isCleanup ? (
                <div>
                  <h3 className="mb-3 font-semibold">Operation Details</h3>
                  <div className="space-y-3 rounded-md border border-red-500/50 p-4">
                    {isCleanupTasks && (
                      <div className="flex items-start gap-3">
                        <Badge
                          variant="outline"
                          className="border-red-500 text-red-600"
                        >
                          Tasks
                        </Badge>
                        <div>
                          <p className="font-semibold">
                            Delete All HubSpot Tasks
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Searches for all tasks in HubSpot and deletes them
                            in batches of 100
                          </p>
                        </div>
                      </div>
                    )}
                    {isCleanupMeetings && (
                      <div className="flex items-start gap-3">
                        <Badge
                          variant="outline"
                          className="border-red-500 text-red-600"
                        >
                          Meetings
                        </Badge>
                        <div>
                          <p className="font-semibold">
                            Delete All HubSpot Meetings
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Searches for all meetings in HubSpot and deletes
                            them in batches of 100
                          </p>
                        </div>
                      </div>
                    )}
                    {isCleanupEmails && (
                      <div className="flex items-start gap-3">
                        <Badge
                          variant="outline"
                          className="border-red-500 text-red-600"
                        >
                          Emails
                        </Badge>
                        <div>
                          <p className="font-semibold">
                            Delete All HubSpot Emails
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Searches for all emails in HubSpot and deletes them
                            in batches of 100
                          </p>
                        </div>
                      </div>
                    )}
                    {isCleanupLineItems && (
                      <div className="flex items-start gap-3">
                        <Badge
                          variant="outline"
                          className="border-red-500 text-red-600"
                        >
                          Line Items
                        </Badge>
                        <div>
                          <p className="font-semibold">
                            Delete All HubSpot Line Items
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Searches for all line items in HubSpot and deletes
                            them in batches of 100
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="mt-3 rounded-md bg-yellow-500/10 p-3 text-sm border border-yellow-500/50">
                      <p className="font-semibold text-yellow-600">Note:</p>
                      <p className="mt-1 text-muted-foreground">
                        This operation will continue looping until all
                        engagement objects are deleted, regardless of the total
                        count. This may take several minutes for large datasets.
                      </p>
                    </div>
                  </div>
                </div>
              ) : isEventToMeeting ? (
                <div>
                  <h3 className="mb-3 font-semibold">Migration Details</h3>
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Source</Badge>
                      <div>
                        <p className="font-semibold">Event (Salesforce)</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Calendar events and scheduled appointments
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Mapping</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">Field Transformations</p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Subject → hs_meeting_title</li>
                          <li>• Description → hs_meeting_body</li>
                          <li>• Location → hs_meeting_location</li>
                          <li>• StartDateTime → hs_meeting_start_time</li>
                          <li>• EndDateTime → hs_meeting_end_time</li>
                          <li>• OwnerId → hubspot_owner_id (mapped)</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Associations</Badge>
                      <div>
                        <p className="font-semibold">
                          Meetings (HubSpot Engagement)
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Associated with Contacts (WhoId), Companies/Deals
                          (WhatId), and mapped to HubSpot owners
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isLineItems ? (
                <div>
                  <h3 className="mb-3 font-semibold">Migration Details</h3>
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Source</Badge>
                      <div>
                        <p className="font-semibold">
                          OpportunityLineItem (Salesforce)
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Product line items with pricing, dates, and details
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Mapping</Badge>
                      <div className="text-sm">
                        <p className="font-semibold">Field Transformations</p>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          <li>• Product2.Name → name</li>
                          <li>• Quantity → quantity</li>
                          <li>• UnitPrice → price</li>
                          <li>• TotalPrice → amount</li>
                          <li>• Start_Date__c → start_date (custom)</li>
                          <li>• End_Date__c → end_date (custom)</li>
                          <li>• installments__c → installments (custom)</li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Target</Badge>
                      <div>
                        <p className="font-semibold">
                          Deal Line Items (HubSpot)
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Associated with deals via OpportunityId matching.
                          Owner: Sean Merat, Type: Service, Pricing:
                          Volume-based
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isOpportunityLineItemDates ? (
                <div>
                  <h3 className="mb-3 font-semibold">Migration Details</h3>
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Source</Badge>
                      <div>
                        <p className="font-semibold">
                          OpportunityLineItemSchedule
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Line Item Schedules linked via OpportunityLineItemId
                          field
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Logic</Badge>
                      <div>
                        <p className="font-semibold">
                          Calculate MIN and MAX ScheduleDate
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          For each Line Item, find earliest and latest schedule
                          dates
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Target</Badge>
                      <div>
                        <p className="font-semibold">
                          OpportunityLineItem (Salesforce Only)
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Updates Start_Date__c (earliest) and End_Date__c
                          (latest)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isOpportunityProductDates ? (
                <div>
                  <h3 className="mb-3 font-semibold">Migration Details</h3>
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Source</Badge>
                      <div>
                        <p className="font-semibold">
                          OpportunityLineItemSchedule
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Line Item Schedules linked via psi_Opportunity__c
                          field
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Logic</Badge>
                      <div>
                        <p className="font-semibold">
                          Calculate MIN and MAX ScheduleDate
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          For each Opportunity, find earliest and latest
                          schedule dates
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Target</Badge>
                      <div>
                        <p className="font-semibold">
                          Opportunity (Salesforce Only)
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Updates Product_Start_Date__c (earliest) and
                          Product_End_Date__c (latest)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isAssociationMigration ? (
                <div>
                  <h3 className="mb-3 font-semibold">Association Details</h3>
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Label</Badge>
                      <div>
                        <p className="font-semibold">
                          {migrationType === "opportunity_renewal_associations"
                            ? "renewed_in_renewal_of"
                            : "has_pilot_pilot_for"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Bidirectional association label in HubSpot
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Source</Badge>
                      <div>
                        <p className="font-semibold">
                          {migrationType === "opportunity_renewal_associations"
                            ? "Salesforce renewal_opportunity__c"
                            : "Salesforce Pilot_Opportunity__c"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Lookup field on Opportunity object
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline">Target</Badge>
                      <div>
                        <p className="font-semibold">HubSpot Deal-to-Deal</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Associates deals using hs_salesforceopportunityid
                          property
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="mb-3 font-semibold">Field Mappings</h3>
                  <div className="space-y-1 rounded-md border p-3">
                    {fieldMappings.map((mapping) => (
                      <div
                        key={mapping.salesforceField}
                        className="flex items-center text-sm"
                      >
                        <span className="font-mono text-muted-foreground">
                          {mapping.salesforceField}
                        </span>
                        <span className="mx-2 text-muted-foreground">→</span>
                        <span className="font-mono">
                          {mapping.hubspotField}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sample Data */}
              {previewData.sampleRecords.length > 0 && (
                <div>
                  <h3 className="mb-3 font-semibold">
                    Sample Data (First {previewData.sampleRecords.length}{" "}
                    Records)
                  </h3>
                  <div className="space-y-4">
                    {isEventToMeeting
                      ? previewData.sampleRecords.map((record, idx) => (
                          <Card key={record.Id}>
                            <CardHeader className="pb-3">
                              <CardTitle className="text-base">
                                {record.Subject || `Event ${idx + 1}`}
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">Event ID</Badge>
                                  <span className="font-mono text-sm">
                                    {record.Id}
                                  </span>
                                </div>
                                {record.Description && (
                                  <div className="flex items-start gap-2">
                                    <Badge variant="secondary">
                                      Description
                                    </Badge>
                                    <span className="text-sm text-muted-foreground">
                                      {record.Description.substring(0, 100)}
                                      {record.Description.length > 100
                                        ? "..."
                                        : ""}
                                    </span>
                                  </div>
                                )}
                                {record.Location && (
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary">Location</Badge>
                                    <span className="text-sm">
                                      {record.Location}
                                    </span>
                                  </div>
                                )}
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">
                                      Start:
                                    </span>{" "}
                                    {record.StartDateTime
                                      ? new Date(
                                          record.StartDateTime,
                                        ).toLocaleString()
                                      : "N/A"}
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">
                                      End:
                                    </span>{" "}
                                    {record.EndDateTime
                                      ? new Date(
                                          record.EndDateTime,
                                        ).toLocaleString()
                                      : "N/A"}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">
                                    Associations
                                  </Badge>
                                  <span className="text-sm text-muted-foreground">
                                    WhoId: {record.WhoId || "None"} | WhatId:{" "}
                                    {record.WhatId || "None"}
                                  </span>
                                </div>
                                <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs">
                                  <p className="text-muted-foreground">
                                    Will be created as HubSpot Meeting and
                                    associated with Contacts, Companies, and
                                    Deals
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      : isLineItems
                        ? previewData.sampleRecords.map((record, idx) => (
                            <Card key={record.Id}>
                              <CardHeader className="pb-3">
                                <CardTitle className="text-base">
                                  {record.Product2?.Name ||
                                    `Line Item ${idx + 1}`}
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary">
                                      Line Item ID
                                    </Badge>
                                    <span className="font-mono text-sm">
                                      {record.Id}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary">
                                      Opportunity ID
                                    </Badge>
                                    <span className="font-mono text-sm">
                                      {record.OpportunityId || (
                                        <span className="text-muted-foreground">
                                          Not Set
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div>
                                      <span className="text-muted-foreground">
                                        Quantity:
                                      </span>{" "}
                                      {record.Quantity || "N/A"}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">
                                        Price:
                                      </span>{" "}
                                      ${record.UnitPrice || 0}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">
                                        Total:
                                      </span>{" "}
                                      ${record.TotalPrice || 0}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary">Dates</Badge>
                                    <span className="text-sm text-muted-foreground">
                                      {record.Start_Date__c || "N/A"} →{" "}
                                      {record.End_Date__c || "N/A"}
                                    </span>
                                  </div>
                                  <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs">
                                    <p className="text-muted-foreground">
                                      Will be created as HubSpot line item and
                                      associated with corresponding deal
                                    </p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        : isOpportunityLineItemDates
                          ? previewData.sampleRecords.map((record, idx) => (
                              <Card key={record.Id}>
                                <CardHeader className="pb-3">
                                  <CardTitle className="text-base">
                                    {record.Name || `Line Item ${idx + 1}`}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="secondary">
                                        Line Item ID
                                      </Badge>
                                      <span className="font-mono text-sm">
                                        {record.Id}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge variant="secondary">
                                        Opportunity ID
                                      </Badge>
                                      <span className="font-mono text-sm">
                                        {record.OpportunityId || (
                                          <span className="text-muted-foreground">
                                            Not Set
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge variant="secondary">
                                        Current Start Date
                                      </Badge>
                                      <span className="font-mono text-sm">
                                        {record.Start_Date__c || (
                                          <span className="text-muted-foreground">
                                            Not Set
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge variant="secondary">
                                        Current End Date
                                      </Badge>
                                      <span className="font-mono text-sm">
                                        {record.End_Date__c || (
                                          <span className="text-muted-foreground">
                                            Not Set
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                    <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs">
                                      <p className="text-muted-foreground">
                                        Will be updated based on associated Line
                                        Item Schedule dates
                                      </p>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))
                          : isOpportunityProductDates
                            ? previewData.sampleRecords.map((record, idx) => (
                                <Card key={record.Id}>
                                  <CardHeader className="pb-3">
                                    <CardTitle className="text-base">
                                      {record.Name || `Opportunity ${idx + 1}`}
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2">
                                        <Badge variant="secondary">
                                          Opportunity ID
                                        </Badge>
                                        <span className="font-mono text-sm">
                                          {record.Id}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Badge variant="secondary">
                                          Current Start Date
                                        </Badge>
                                        <span className="font-mono text-sm">
                                          {record.Product_Start_Date__c || (
                                            <span className="text-muted-foreground">
                                              Not Set
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Badge variant="secondary">
                                          Current End Date
                                        </Badge>
                                        <span className="font-mono text-sm">
                                          {record.Product_End_Date__c || (
                                            <span className="text-muted-foreground">
                                              Not Set
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                      <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs">
                                        <p className="text-muted-foreground">
                                          Will be updated based on associated
                                          Line Item Schedule dates
                                        </p>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))
                            : isAssociationMigration
                              ? previewData.sampleRecords.map((record, idx) => (
                                  <Card key={record.Id}>
                                    <CardHeader className="pb-3">
                                      <CardTitle className="text-base">
                                        Opportunity {idx + 1}
                                      </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                          <Badge variant="secondary">
                                            Opportunity ID
                                          </Badge>
                                          <span className="font-mono text-sm">
                                            {record.Id}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Badge variant="secondary">
                                            {migrationType ===
                                            "opportunity_renewal_associations"
                                              ? "Renews In"
                                              : "Has Pilot"}
                                          </Badge>
                                          <span className="font-mono text-sm">
                                            {migrationType ===
                                            "opportunity_renewal_associations"
                                              ? record.renewal_opportunity__c
                                              : record.Pilot_Opportunity__c}
                                          </span>
                                        </div>
                                        <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs">
                                          <p className="text-muted-foreground">
                                            Will create bidirectional
                                            association between deals with these
                                            Salesforce IDs
                                          </p>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))
                              : previewData.sampleRecords.map((record, idx) => (
                                  <Card key={record.Id}>
                                    <CardHeader className="pb-3">
                                      <CardTitle className="text-base">
                                        Record {idx + 1}
                                      </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                      <div className="space-y-2">
                                        {fieldMappings.map((mapping) => {
                                          const sfValue =
                                            record[mapping.salesforceField];
                                          return (
                                            <div
                                              key={mapping.salesforceField}
                                              className="flex items-start border-b border-border/50 pb-2 last:border-0"
                                            >
                                              <div className="flex-1">
                                                <p className="text-xs text-muted-foreground">
                                                  {mapping.salesforceField}
                                                </p>
                                                <p className="font-medium">
                                                  {sfValue || (
                                                    <span className="text-muted-foreground">
                                                      null
                                                    </span>
                                                  )}
                                                </p>
                                              </div>
                                              <div className="px-2 text-muted-foreground">
                                                →
                                              </div>
                                              <div className="flex-1">
                                                <p className="text-xs text-muted-foreground">
                                                  {mapping.hubspotField}
                                                </p>
                                                <p className="font-medium">
                                                  {sfValue || (
                                                    <span className="text-muted-foreground">
                                                      null
                                                    </span>
                                                  )}
                                                </p>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))}
                  </div>
                </div>
              )}
            </>
          ) : null}

          {/* Actions */}
          <div className="flex justify-between">
            <Button onClick={onBack} variant="outline">
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
              Back to Field Mapping
            </Button>
            <div className="flex gap-3">
              <Button
                onClick={() => onConfirm(true)}
                size="lg"
                variant="outline"
                disabled={loading || !!error}
              >
                Test Migration (5 records)
              </Button>
              <Button
                onClick={() => onConfirm(false)}
                size="lg"
                disabled={loading || !!error}
              >
                <RocketIcon className="mr-2 h-4 w-4" />
                Start Full Migration
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
