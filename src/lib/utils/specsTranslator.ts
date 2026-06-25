export interface TechnicalSpecification {
  label: string;
  value: string;
}

/**
 * Convert Technical Specifications Array → Plain Text
 * 
 * Rules:
 * - One specification per line
 * - Format: label: value
 * - Ignore empty items
 * - Trim whitespace
 * - Preserve special characters
 * - Preserve units
 * - Return empty string when array is empty or input is invalid
 * - Never throw runtime exceptions
 */
export function technicalSpecsToText(
  specs: TechnicalSpecification[]
): string {
  try {
    if (!specs || !Array.isArray(specs)) {
      return "";
    }

    return specs
      .filter((spec) => {
        if (!spec || typeof spec !== "object") {
          return false;
        }
        const label = spec.label;
        const value = spec.value;
        
        // Ensure label and value are strings and are not empty
        if (typeof label !== "string" || typeof value !== "string") {
          return false;
        }
        
        return label.trim() !== "" && value.trim() !== "";
      })
      .map((spec) => `${spec.label.trim()}: ${spec.value.trim()}`)
      .join("\n");
  } catch (error) {
    console.error("Error in technicalSpecsToText:", error);
    return "";
  }
}

/**
 * Convert Plain Text → Technical Specifications Array
 * 
 * Rules:
 * - Split by line
 * - First colon separates label and value
 * - Ignore empty lines
 * - Trim whitespace
 * - Support values containing additional colons
 * - Return empty array when text is empty or input is invalid
 * - Never throw runtime exceptions
 */
export function textToTechnicalSpecs(
  text: string
): TechnicalSpecification[] {
  try {
    if (!text || typeof text !== "string") {
      return [];
    }

    const specs: TechnicalSpecification[] = [];
    // Split by any standard newline separator
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine === "") {
        continue;
      }

      const colonIndex = trimmedLine.indexOf(":");
      if (colonIndex <= 0) {
        // No colon found, or colon is at the very beginning (empty label)
        continue;
      }

      const label = trimmedLine.slice(0, colonIndex).trim();
      const value = trimmedLine.slice(colonIndex + 1).trim();

      // Ignore if label or value is empty
      if (label === "" || value === "") {
        continue;
      }

      specs.push({ label, value });
    }

    return specs;
  } catch (error) {
    console.error("Error in textToTechnicalSpecs:", error);
    return [];
  }
}
