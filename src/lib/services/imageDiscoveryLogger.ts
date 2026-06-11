import fs from "fs";
import path from "path";

export interface ImageDiscoveryLogEntry {
  timestamp?: string;
  productName: string;
  brand: string;
  searchQuery?: string;
  productUrl?: string;
  imageUrl?: string;
  status: "SUCCESS" | "MISSING_BRAND" | "IMAGE_NOT_FOUND" | "SEARCH_PROVIDER_TIMEOUT" | "RATE_LIMITED" | "SEARCH_PROVIDER_ERROR" | "PRODUCT_PAGE_NOT_FOUND" | "UPLOAD_FAILED";
  reason?: string;
  source?: string;
}

const LOG_FILE = path.join(process.cwd(), "logs", "image-discovery.json");

export async function logImageDiscovery(entry: ImageDiscoveryLogEntry) {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    let logs: ImageDiscoveryLogEntry[] = [];
    if (fs.existsSync(LOG_FILE)) {
      const data = fs.readFileSync(LOG_FILE, "utf8");
      try {
        logs = JSON.parse(data);
      } catch {
        logs = [];
      }
    }
    
    logs.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
    
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
  } catch (err) {
    console.error("[ImageDiscoveryLogger] Failed to log:", err);
  }
}
