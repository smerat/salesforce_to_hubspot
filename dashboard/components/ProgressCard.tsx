"use client";

import { MigrationProgress } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ProgressCardProps {
  progress: MigrationProgress;
}

export default function ProgressCard({ progress }: ProgressCardProps) {
  const totalRecords = progress.total_records || 0;
  const processedRecords = progress.processed_records || 0;
  const failedRecords = progress.failed_records || 0;
  const percentage =
    totalRecords > 0 ? (processedRecords / totalRecords) * 100 : 0;

  const statusConfig = {
    pending: { label: "Pending", variant: "secondary" as const },
    in_progress: { label: "In Progress", variant: "default" as const },
    completed: { label: "Completed", variant: "outline" as const },
    failed: { label: "Failed", variant: "destructive" as const },
  };

  const config = statusConfig[progress.status] || statusConfig.pending;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg capitalize">
            {progress.object_type}
          </CardTitle>
          <Badge variant={config.variant}>{config.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="flex items-end justify-between">
          <div>
            <div className="text-3xl font-bold">
              {processedRecords.toLocaleString()}
            </div>
            <div className="text-sm text-muted-foreground">
              of {totalRecords.toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold">
              {percentage.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">Complete</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
        </div>

        {/* Detailed Stats */}
        <div className="grid grid-cols-3 gap-4 text-center text-sm">
          <div>
            <div className="text-muted-foreground">Processed</div>
            <div className="mt-1 font-semibold text-green-400">
              {processedRecords.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Failed</div>
            <div className="mt-1 font-semibold text-red-400">
              {failedRecords.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Remaining</div>
            <div className="mt-1 font-semibold">
              {Math.max(0, totalRecords - processedRecords).toLocaleString()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
