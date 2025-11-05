"use client";

import { MigrationError } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ErrorsTableProps {
  errors: MigrationError[];
}

export default function ErrorsTable({ errors }: ErrorsTableProps) {
  if (errors.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migration Errors</CardTitle>
          <CardDescription>No errors recorded</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center text-muted-foreground">
            All records migrated successfully
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "resolved":
        return "outline";
      case "failed":
        return "destructive";
      default:
        return "secondary";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Migration Errors</CardTitle>
        <CardDescription>
          {errors.length} error{errors.length !== 1 ? "s" : ""} recorded
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Object Type</TableHead>
              <TableHead>Salesforce ID</TableHead>
              <TableHead className="max-w-md">Error Message</TableHead>
              <TableHead className="text-center">Retries</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {errors.map((error) => (
              <TableRow key={error.id}>
                <TableCell className="font-medium capitalize">
                  {error.object_type}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {error.salesforce_id || "N/A"}
                </TableCell>
                <TableCell className="max-w-md truncate text-sm">
                  {error.error_message || "No message"}
                </TableCell>
                <TableCell className="text-center">
                  <span className="rounded-full bg-muted px-2 py-1 text-xs">
                    {error.retry_count}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(error.status)}>
                    {error.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
