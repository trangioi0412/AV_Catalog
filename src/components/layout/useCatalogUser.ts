"use client";

import React from "react";
import type { CatalogUser } from "@/lib/auth/session";

// One request per page load, shared by every DashboardLayout mount.
let userPromise: Promise<CatalogUser | null> | null = null;

function loadUser(): Promise<CatalogUser | null> {
  userPromise ??= fetch("/api/auth/me", { cache: "no-store" })
    .then(async (res) => (res.ok ? ((await res.json()) as { user: CatalogUser }).user : null))
    .catch(() => {
      userPromise = null; // retry on next mount after a network error
      return null;
    });
  return userPromise;
}

/** Signed-in Portal SSO user, or null while loading / when signed out. */
export function useCatalogUser(): CatalogUser | null {
  const [user, setUser] = React.useState<CatalogUser | null>(null);
  React.useEffect(() => {
    let active = true;
    loadUser().then((u) => {
      if (active) setUser(u);
    });
    return () => {
      active = false;
    };
  }, []);
  return user;
}

const ROLE_LABELS: Record<string, string> = { viewer: "Xem", editor: "Chỉnh sửa", admin: "Quản trị" };

export function roleLabel(user: CatalogUser): string {
  if (user.superAdmin) return "Super admin";
  return ROLE_LABELS[user.role] ?? user.role;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}
