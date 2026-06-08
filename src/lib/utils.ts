import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Transforms a Wix media URL (image or document) to a standard public HTTPS URL.
 * Fallbacks to a placeholder image if undefined or empty.
 */
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
