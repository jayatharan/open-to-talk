import { json, preflight } from "@/lib/http";
import { stats } from "@/lib/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Used by the desktop and mobile apps to validate the host configured in Settings. */
export function GET() {
  return json({ app: "open2talk", version: process.env.npm_package_version ?? "0.1.0", ...stats() });
}
