import { describe, it, expect } from "vitest";
import { resolveCollection, ALLOWED_COLLECTIONS, MAX_TRANSLATION_BATCH_SIZE } from "./wix-translation.config";

describe("resolveCollection", () => {
  it("resolves a known collection key to its allowlisted collection ID", () => {
    const resolved = resolveCollection("products");
    expect(resolved).not.toBeNull();
    expect(resolved?.collectionId).toBe(ALLOWED_COLLECTIONS.products.collectionId);
  });

  it("returns null for a collection key that isn't in the allowlist, never falling back to using it as a raw ID", () => {
    expect(resolveCollection("../../secret-collection")).toBeNull();
    expect(resolveCollection("arbitrary-client-supplied-id")).toBeNull();
  });
});

describe("MAX_TRANSLATION_BATCH_SIZE", () => {
  it("caps batches at 20 per the AV_Catalog translation feature spec", () => {
    expect(MAX_TRANSLATION_BATCH_SIZE).toBe(20);
  });
});
