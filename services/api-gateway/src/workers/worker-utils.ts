/**
 * Shared utilities for BullMQ workers — common error logging setup.
 */

import type { Worker } from "bullmq";

/**
 * Attach standard error logging to a BullMQ worker.
 * Workers can still attach their own "failed" handler for custom logic;
 * this adds a baseline "error" handler that prevents unhandled exceptions.
 */
export function attachWorkerErrorHandler(worker: Worker, workerName: string): void {
  worker.on("error", (err) => {
    console.error(`[${workerName}] Worker error:`, err.message);
  });
}
