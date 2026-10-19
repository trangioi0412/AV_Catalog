import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Formats a byte count as a human-readable size string, e.g. 1536 -> "1.5 KB". */
export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * Transforms a Wix media URL (image or document) to a standard public HTTPS URL.
 * Fallbacks to a placeholder image if undefined or empty.
 */
/**
 * Like transformWixImageUrl, but asks Wix's CDN for a resized rendition
 * (/v1/fit/w_,h_/) when the image is hosted on static.wixstatic.com — a
 * thumbnail then costs a few KB instead of the full-resolution original.
 * Any other URL is returned unchanged.
 */
export function wixImageThumbUrl(wixUrl: unknown, width: number, height: number): string {
  const url = transformWixImageUrl(wixUrl);
  const match = url.match(/^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)$/);
  if (!match) return url;
  return `${url}/v1/fit/w_${width},h_${height},q_80/${match[1]}`;
}

export function transformWixImageUrl(wixUrl?: any): string {
  if (!wixUrl) return "/placeholder-image.png";
  
  // Defensively extract src string if wixUrl is a Wix Media Object (e.g. { src: "wix:image..." })
  let urlStr = "";
  if (typeof wixUrl === "object" && wixUrl !== null) {
    urlStr = wixUrl.src || wixUrl.url || wixUrl.urlPath || "";
  } else {
    urlStr = String(wixUrl).trim();
  }
  
  if (!urlStr) return "/placeholder-image.png";

  // Handle image URLs (wix:image://v1/...)
  if (urlStr.startsWith("wix:image://v1/")) {
    const cleanPath = urlStr.replace("wix:image://v1/", "");
    const slashIndex = cleanPath.indexOf("/");
    if (slashIndex !== -1) {
      const fileId = cleanPath.substring(0, slashIndex);
      return `https://static.wixstatic.com/media/${fileId}`;
    }
    const hashIndex = cleanPath.indexOf("#");
    const fileId = hashIndex !== -1 ? cleanPath.substring(0, hashIndex) : cleanPath;
    return `https://static.wixstatic.com/media/${fileId}`;
  }
  
  // Handle document URLs (wix:document://v1/...)
  if (urlStr.startsWith("wix:document://v1/")) {
    const cleanPath = urlStr.replace("wix:document://v1/", "");
    const slashIndex = cleanPath.indexOf("/");
    if (slashIndex !== -1) {
      const fileId = cleanPath.substring(0, slashIndex);
      let fileName = cleanPath.substring(slashIndex + 1);
      const hashIndex = fileName.indexOf("#");
      if (hashIndex !== -1) {
        fileName = fileName.substring(0, hashIndex);
      }
      return `https://static.wixstatic.com/ugd/${fileId}?dn=${encodeURIComponent(fileName)}`;
    }
    return `https://static.wixstatic.com/media/${cleanPath}`;
  }
  
  return urlStr;
}
