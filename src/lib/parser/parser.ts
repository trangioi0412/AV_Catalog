import { Specification, ParsingError } from "@/types";

/**
 * Robust Regex Parser for Technical Specifications
 * 
 * Supports:
 * - Label: Value structure
 * - Multiline values
 * - Vietnamese UTF-8 characters
 * - Internal colons within values
 * - Deduplication of labels
 * - Trimmed whitespace
 * - Safe handling of malformed formatting
 */
export function parseSpecifications(text: string): {
  specifications: Specification[];
  errors: ParsingError[];
} {
  const specifications: Specification[] = [];
  const errors: ParsingError[] = [];

  if (!text || typeof text !== "string") {
    return { specifications, errors };
  }

  // Normalize line breaks
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  /**
   * Strategy:
   * 1. Split text into blocks by looking for "Label:" at the start of a line
   * 2. Or use a regex that matches "Label:" and everything until the next "Label:" or end of text.
   * 
   * The suggested regex: /([^:\n]+):\s*([\s\S]*?)(?=\n\s*\n|$)/g
   * Improvement: Look for "Label:" patterns that are likely to be actual keys (not too long, usually at the start of lines or after a newline)
   */
  
  // Improved Regex: 
  // Matches (Any character except colon or newline)+ followed by a colon
  // Then captures everything until the next match or the end of the string
  // Uses a positive lookahead to find the next label or end of string
  const regex = /^([^:\n]{2,100}):\s*([\s\S]*?)(?=\n[^:\n]{2,100}:|$)/gm;

  let match;
  const labelMap = new Map<string, string>();

  while ((match = regex.exec(normalizedText)) !== null) {
    let [_, label, value] = match;

    label = label.trim();
    value = value.trim();

    if (label && value) {
      // Handle duplicated labels: merge or store unique? 
      // Requirement says "Handle duplicated labels" - usually merging or appending is good.
      // Here we will keep the latest but track as a potential warning if needed.
      if (labelMap.has(label)) {
        // Appending for now
        labelMap.set(label, `${labelMap.get(label)}, ${value}`);
      } else {
        labelMap.set(label, value);
      }
    }
  }

  // Convert map to array
  labelMap.forEach((value, label) => {
    specifications.push({ label, value });
  });

  // If no specs found but text exists, maybe it's not in Label: Value format
  if (specifications.length === 0 && text.trim().length > 0) {
    errors.push({
      field: "Technical Specifications",
      message: "No structured specifications found. Please check format (Label: Value).",
      severity: "warning",
    });
  }

  return { specifications, errors };
}

/**
 * Normalizes labels for consistency
 */
export function normalizeLabel(label: string): string {
  const mapping: Record<string, string> = {
    "WiFi": "Wi-Fi",
    "Wireless": "Wi-Fi",
    "Thông số kỹ thuật": "Technical Specifications",
    "Loại thiết bị": "Device Type",
    "Cấu trúc thiết bị": "Device Structure",
    "Công nghệ xử lý": "Processing Technology",
  };

  return mapping[label] || label;
}
