/**
 * imageSyncJobStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * In-memory job store for tracking upload progress.
 * In production you'd replace this with Redis or a DB, but for a
 * single-server Next.js deployment this is sufficient.
 */

export interface JobLog {
  productName: string;
  fileName: string;
  status: "success" | "error";
  wixUrl?: string;
  error?: string;
  timestamp: string;
}

export interface JobEntry {
  jobId: string;
  status: "running" | "done" | "error";
  total: number;
  processed: number;
  successCount: number;
  failedCount: number;
  logs: JobLog[];
  startedAt: string;
  completedAt?: string;
}

// Global singleton Map (survives across requests in same process)
export const jobStore = new Map<string, JobEntry>();

/** Prune jobs older than 1 hour to prevent memory leaks. */
export function pruneOldJobs(): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobStore.entries()) {
    const jobTime = job.completedAt
      ? new Date(job.completedAt).getTime()
      : new Date(job.startedAt).getTime();
    if (jobTime < oneHourAgo) {
      jobStore.delete(id);
    }
  }
}
