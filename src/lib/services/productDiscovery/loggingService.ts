import fs from "fs";
import path from "path";

export interface DiscoveryLogEntry {
  searchQuery: string;
  productName: string;
  brand: string;
  selectedUrl: string;
  imageFound: boolean;
  datasheetFound: boolean;
  confidenceScore: number;
  timestamp: string;
  provider?: string;
  duration?: number;
  candidates?: { url: string; accepted: boolean; rejectReason?: string; score?: number }[];
}

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "product-discovery.json");
const STEPS_LOG_FILE = path.join(LOG_DIR, "discovery-steps.json");

/**
 * Appends a product discovery transaction record into the local json log file.
 */
export function logDiscoveryEntry(entry: Omit<DiscoveryLogEntry, "timestamp">) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    let logs: DiscoveryLogEntry[] = [];
    if (fs.existsSync(LOG_FILE)) {
      try {
        const content = fs.readFileSync(LOG_FILE, "utf8");
        logs = JSON.parse(content);
        if (!Array.isArray(logs)) logs = [];
      } catch {
        logs = [];
      }
    }

    const fullEntry: DiscoveryLogEntry = {
      ...entry,
      timestamp: new Date().toISOString()
    };

    logs.push(fullEntry);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
  } catch (err) {
    console.error("[LoggingService] Failed to append log entry:", err);
  }
}

/**
 * Logs structured progress step for image/product discovery transactions.
 */
export function logDiscoveryStep(
  step: "SEARCH_STARTED" | "SEARCH_FINISHED" | "IMAGE_DOWNLOAD_STARTED" | "IMAGE_DOWNLOAD_SUCCESS" | "IMAGE_DOWNLOAD_FAILED"
        | "CACHE_HIT_POSITIVE" | "CACHE_HIT_NEGATIVE" | "CACHE_EXPIRED" | "CACHE_BYPASSED",
  product: string,
  brand: string,
  duration = 0,
  status = "",
  error = ""
) {
  const timestamp = new Date().toISOString();
  const logObj = {
    timestamp,
    step,
    product,
    brand,
    duration,
    status,
    error
  };

  console.log(`[StructuredLog] ${JSON.stringify(logObj)}`);

  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    let logs = [];
    if (fs.existsSync(STEPS_LOG_FILE)) {
      try {
        const content = fs.readFileSync(STEPS_LOG_FILE, "utf8");
        logs = JSON.parse(content);
        if (!Array.isArray(logs)) logs = [];
      } catch {
        logs = [];
      }
    }

    logs.push(logObj);
    fs.writeFileSync(STEPS_LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
  } catch (err) {
    console.error("[LoggingService] Failed to write structured step log:", err);
  }
}
