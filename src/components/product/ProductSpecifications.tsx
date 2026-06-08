"use client";

import React from "react";
import { Search } from "lucide-react";

interface SpecItem {
  label: string;
  value: string;
}

interface ProductSpecificationsProps {
  technicalSpecifications?: string;
}

export function ProductSpecifications({ technicalSpecifications }: ProductSpecificationsProps) {
  const [searchQuery, setSearchQuery] = React.useState("");

  // Parse specifications dynamically
  const specsList = React.useMemo((): SpecItem[] => {
    if (!technicalSpecifications) return [];

    const raw = technicalSpecifications.trim();
    if (!raw) return [];

    // 1. Attempt to parse as JSON
    try {
      const parsed = JSON.parse(raw);

      // Scenario A: Array of { label, value } or { key, value }
      if (Array.isArray(parsed)) {
        return parsed
          .map((item: any) => {
            const label = item.label || item.key || item.name || "";
            const value = item.value || item.desc || "";
            return {
              label: String(label).trim(),
              value: String(value).trim(),
            };
          })
          .filter((item) => item.label && item.value);
      }

      // Scenario B: Flat Key-Value Object { "Weight": "1.5kg", "Color": "Black" }
      if (typeof parsed === "object" && parsed !== null) {
        return Object.entries(parsed)
          .map(([key, val]) => ({
            label: String(key).trim(),
            value: String(val).trim(),
          }))
          .filter((item) => item.label && item.value);
      }
    } catch {
      // JSON parsing failed, move on to text parsing
    }

    // 2. Fallback: Parse as a string split by newlines or list items
    // (e.g. "Weight: 1.5kg\nDimensions: 100x200mm")
    const lines = raw
      .replace(/<[^>]*>/g, "\n") // strip simple HTML
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const extracted: SpecItem[] = [];
    lines.forEach((line) => {
      // Look for delimiters like ':' or '-'
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0 && colonIndex < line.length - 1) {
        const label = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (label && value) {
          extracted.push({ label, value });
        }
      } else {
        // Just text, treat it as general specification
        extracted.push({ label: "Details", value: line });
      }
    });

    return extracted.filter((e) => e.label !== "Details" || e.value !== "");
  }, [technicalSpecifications]);

  // Filtered specifications based on search input
  const filteredSpecs = React.useMemo(() => {
    if (!searchQuery.trim()) return specsList;
    const query = searchQuery.toLowerCase().trim();
    return specsList.filter(
      (spec) =>
        spec.label.toLowerCase().includes(query) ||
        spec.value.toLowerCase().includes(query)
    );
  }, [specsList, searchQuery]);

  if (specsList.length === 0) {
    return (
      <div className="text-center p-8 border border-dashed rounded-2xl bg-card/20 text-muted-foreground text-sm">
        No technical specifications available for this product model.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search Input Filter */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Technical Specifications</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Showing {filteredSpecs.length} of {specsList.length} specification rows.
          </p>
        </div>
        
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search specifications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-card/40 border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Specifications Table */}
      <div className="border border-border/80 rounded-2xl overflow-hidden shadow-sm bg-card/10 backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm text-muted-foreground">
            <thead>
              <tr className="border-b bg-card/50 text-foreground font-semibold">
                <th className="px-6 py-4 w-1/3">Feature / Parameter</th>
                <th className="px-6 py-4">Specification Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredSpecs.length > 0 ? (
                filteredSpecs.map((spec, idx) => (
                  <tr 
                    key={idx} 
                    className="hover:bg-card/30 transition-colors duration-150 odd:bg-card/5"
                  >
                    <td className="px-6 py-4 font-semibold text-foreground align-top">
                      {spec.label}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground whitespace-pre-line leading-relaxed align-top">
                      {spec.value}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-6 py-8 text-center text-muted-foreground italic">
                    No specifications match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
