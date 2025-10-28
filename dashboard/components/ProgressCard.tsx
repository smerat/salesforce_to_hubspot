'use client';

import { MigrationProgress } from '@/lib/types';

interface ProgressCardProps {
  progress: MigrationProgress;
}

export default function ProgressCard({ progress }: ProgressCardProps) {
  const totalRecords = progress.total_records || 0;
  const processedRecords = progress.processed_records || 0;
  const failedRecords = progress.failed_records || 0;
  const percentage = totalRecords > 0 ? (processedRecords / totalRecords) * 100 : 0;

  const statusColors = {
    pending: 'bg-gray-200 text-gray-700',
    in_progress: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };

  const statusColor = statusColors[progress.status] || statusColors.pending;

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 capitalize">
            {progress.object_type}
          </h3>
          <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium ${statusColor}`}>
            {progress.status.replace('_', ' ')}
          </span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900">
            {processedRecords.toLocaleString()}
          </div>
          <div className="text-sm text-gray-500">
            of {totalRecords.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-blue-600 h-3 rounded-full transition-all duration-300"
            style={{ width: `${Math.min(percentage, 100)}%` }}
          ></div>
        </div>
        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>{percentage.toFixed(1)}% complete</span>
          {failedRecords > 0 && (
            <span className="text-red-600">{failedRecords} failed</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <div className="text-gray-500">Processed</div>
          <div className="font-semibold text-green-600">{processedRecords.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Failed</div>
          <div className="font-semibold text-red-600">{failedRecords.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Remaining</div>
          <div className="font-semibold text-gray-700">
            {Math.max(0, totalRecords - processedRecords).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}
