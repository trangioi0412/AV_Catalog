import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The overview dashboard moved to "/"; keep old links and bookmarks working. */
export default function LegacyDashboardRedirect() {
  redirect("/");
}
