/**
 * POST /api/admin/translations/save
 * ─────────────────────────────────────────────────────────────────────────────
 * Writes reviewed/edited English translations to Wix Multilingual for the
 * given CMS items — as a draft (`published: false`) or published
 * (`published: true`). Uses the Translation Content API exclusively
 * (Bulk Create Content / Bulk Update Content By Key); never the plain Wix
 * Data Items API with a locale, which Wix rejects for translatable
 * collections (WDE0175).
 *
 * An item whose "en" translation already exists is only overwritten if the
 * caller marks it `overwrite: true` — otherwise it comes back as "skipped" so
 * the UI can ask the user to confirm before trying again.
 *
 * Admin-only. `proxy.ts` excludes `/api/*` from its route protection, so the
 * admin_session cookie is re-checked here (same pattern as /api/admin/wix-media).
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import {
  bulkCreateContent,
  bulkUpdateContentByKey,
  findCollectionSchema,
  getTranslatableFields,
  isLocaleAvailable,
  queryContentForEntity,
  WixMultilingualError,
  type BulkContentInput,
} from "@/lib/services/wixMultilingual";
import { mapWithConcurrency } from "@/lib/utils/concurrencyLimit";
import type { SaveTranslationsResponse, TranslationItemResult } from "@/types/translation";

export const runtime = "nodejs";

const TARGET_LOCALE = "en";
const MAX_BATCH_SIZE = 20;
const CONCURRENCY = 4;

const itemSchema = z.object({
  entityId: z.string().min(1).max(100),
  name: z.string().max(300).optional().default(""),
  fields: z.record(z.string(), z.string().max(100000)),
  overwrite: z.boolean().optional().default(false),
});

const requestSchema = z.object({
  collectionId: z.string().min(1).max(100).optional().default("Import1"),
  published: z.boolean().optional().default(false),
  items: z.array(itemSchema).min(1).max(MAX_BATCH_SIZE),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof WixMultilingualError) {
    return noStore({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[/api/admin/translations/save] Unexpected error:", err);
  return noStore({ error: "Internal server error." }, { status: 500 });
}

export async function POST(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return noStore({ error: "Invalid request.", details: parsed.error.flatten() }, { status: 400 });
  }
  const { collectionId, published, items } = parsed.data;

  try {
    const schema = await findCollectionSchema(collectionId);
    if (!schema) {
      return noStore(
        {
          error: `No Wix Multilingual translation schema found for collection "${collectionId}".`,
          code: "SCHEMA_NOT_FOUND",
        },
        { status: 422 }
      );
    }

    const translatableFields = getTranslatableFields(schema);
    const allowedKeys = new Set(translatableFields.map((f) => f.key));
    if (allowedKeys.size === 0) {
      return noStore(
        { error: `The Wix Multilingual schema for "${collectionId}" has no translatable text fields.`, code: "SCHEMA_NOT_FOUND" },
        { status: 422 }
      );
    }

    const localeOk = await isLocaleAvailable(TARGET_LOCALE);
    if (!localeOk) {
      return noStore(
        { error: `Locale "${TARGET_LOCALE}" is not enabled/visible in Wix Multilingual for this site.`, code: "LOCALE_NOT_AVAILABLE" },
        { status: 409 }
      );
    }

    // Phase 1: sanitize fields to the allowlist and check for an existing translation per item.
    type Plan =
      | { entityId: string; name: string; action: "create"; sanitizedFields: Record<string, string> }
      | { entityId: string; name: string; action: "update"; sanitizedFields: Record<string, string> }
      | { entityId: string; name: string; action: "skip"; message: string };

    const plans: Plan[] = await mapWithConcurrency(items, CONCURRENCY, async (item) => {
      const sanitizedFields: Record<string, string> = {};
      for (const [key, value] of Object.entries(item.fields)) {
        if (allowedKeys.has(key)) sanitizedFields[key] = value;
      }
      if (Object.keys(sanitizedFields).length === 0) {
        return { entityId: item.entityId, name: item.name, action: "skip", message: "No translatable fields were submitted." };
      }

      try {
        const existing = await queryContentForEntity(schema.id, item.entityId, TARGET_LOCALE);
        if (existing && !item.overwrite) {
          return {
            entityId: item.entityId,
            name: item.name,
            action: "skip",
            message: "A translation already exists for this item — overwrite not confirmed.",
          };
        }
        return {
          entityId: item.entityId,
          name: item.name,
          action: existing ? "update" : "create",
          sanitizedFields,
        };
      } catch (err) {
        const message = err instanceof WixMultilingualError ? err.message : `Unexpected error: ${(err as Error)?.message ?? err}`;
        return { entityId: item.entityId, name: item.name, action: "skip", message };
      }
    });

    const nameByEntityId = new Map(plans.map((p) => [p.entityId, p.name]));
    const toCreate = plans.filter((p): p is Extract<Plan, { action: "create" }> => p.action === "create");
    const toUpdate = plans.filter((p): p is Extract<Plan, { action: "update" }> => p.action === "update");
    const skipped = plans.filter((p): p is Extract<Plan, { action: "skip" }> => p.action === "skip");

    const toBulkInput = (p: Extract<Plan, { action: "create" | "update" }>): BulkContentInput => ({
      schemaId: schema.id,
      entityId: p.entityId,
      locale: TARGET_LOCALE,
      fields: Object.fromEntries(
        Object.entries(p.sanitizedFields).map(([key, value]) => [key, { textValue: value, published }])
      ),
    });

    const [createResults, updateResults] = await Promise.all([
      bulkCreateContent(toCreate.map(toBulkInput)),
      bulkUpdateContentByKey(toUpdate.map(toBulkInput)),
    ]);

    const writeResults = [...createResults, ...updateResults];
    const writeResultByEntityId = new Map(writeResults.map((r) => [r.entityId, r]));

    // Phase 2: verify successful writes by re-querying the content back from Wix.
    const verifiedEntityIds = [...toCreate, ...toUpdate]
      .map((p) => p.entityId)
      .filter((id) => writeResultByEntityId.get(id)?.success);

    const verificationByEntityId = new Map(
      await mapWithConcurrency(verifiedEntityIds, CONCURRENCY, async (entityId) => {
        try {
          const content = await queryContentForEntity(schema.id, entityId, TARGET_LOCALE);
          return [entityId, !!content] as const;
        } catch {
          return [entityId, false] as const;
        }
      })
    );

    const items_out: TranslationItemResult[] = [
      ...skipped.map((p) => ({
        entityId: p.entityId,
        name: nameByEntityId.get(p.entityId) || p.entityId,
        status: "skipped" as const,
        message: p.message,
      })),
      ...[...toCreate, ...toUpdate].map((p) => {
        const writeResult = writeResultByEntityId.get(p.entityId);
        const name = nameByEntityId.get(p.entityId) || p.entityId;
        if (!writeResult?.success) {
          return { entityId: p.entityId, name, status: "failed" as const, message: writeResult?.error || "Write to Wix Multilingual failed." };
        }
        const verified = verificationByEntityId.get(p.entityId);
        if (!verified) {
          return { entityId: p.entityId, name, status: "failed" as const, message: "Write succeeded but verification query did not find the saved content." };
        }
        return { entityId: p.entityId, name, status: "success" as const };
      }),
    ];

    // Only the admin dashboard's live CMS product list depends on this data today.
    revalidatePath("/admin/dashboard");

    const response: SaveTranslationsResponse = {
      schemaId: schema.id,
      collectionId,
      locale: TARGET_LOCALE,
      published,
      items: items_out,
    };
    return noStore(response);
  } catch (err) {
    return errorResponse(err);
  }
}
