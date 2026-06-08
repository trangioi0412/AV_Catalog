/**
 * GET /api/image-sync/status?jobId=xxx
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns the current progress of an upload job from the in-memory store.
 */

import { NextRequest, NextResponse } from "next/server";
import { jobStore, pruneOldJobs } from "@/lib/services/imageSyncJobStore";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  pruneOldJobs();

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId query param is required." }, { status: 400 });
  }

  const job = jobStore.get(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const percent =
    job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  return NextResponse.json({
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    successCount: job.successCount,
    failedCount: job.failedCount,
    percent,
    startedAt: job.startedAt,
    completedAt: job.completedAt ?? null,
    // Return last 20 logs for display
    recentLogs: job.logs.slice(-20),
  });
}
