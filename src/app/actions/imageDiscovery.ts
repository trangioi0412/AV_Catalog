"use server";

import { revalidatePath } from "next/cache";
import { 
  processMissingImages, 
  isImageDiscoveryInProgress, 
  activeImageDiscoveryLogs, 
  resetImageDiscoveryStatus 
} from "@/lib/services/imageDiscoveryService";

export interface ImageDiscoveryStatus {
  inProgress: boolean;
  logs: string[];
}

/**
 * Starts the AI image discovery and sync process in the background.
 */
export async function startImageDiscoveryAction() {
  if (isImageDiscoveryInProgress) {
    return { success: false, error: "AI Image Discovery is already in progress." };
  }

  // Run in background without awaiting to keep request quick
  processMissingImages()
    .then((result) => {
      console.log(`[AI Image Discovery] Finished. Processed: ${result.totalProcessed}, Success: ${result.successCount}`);
    })
    .catch((err) => {
      console.error("[AI Image Discovery] Failed in background:", err);
    });

  return { success: true };
}

/**
 * Returns current progress status and logs.
 */
export async function getImageDiscoveryStatusAction(): Promise<ImageDiscoveryStatus> {
  return {
    inProgress: isImageDiscoveryInProgress,
    logs: [...activeImageDiscoveryLogs], // Return copy of logs
  };
}

/**
 * Resets the active status if it gets stuck.
 */
export async function resetImageDiscoveryAction() {
  resetImageDiscoveryStatus();
  revalidatePath("/admin/image-discovery");
  return { success: true };
}
