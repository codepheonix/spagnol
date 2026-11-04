import { z } from "zod";
import { isValidTimeZone } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson } from "@/lib/api";
import { validateBulk } from "@/lib/bulk";

const schema = z.object({ brandId: z.string().optional(), csv: z.string().max(2_000_000), timezone: z.string().default("Europe/Rome") });

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const brand = await apiBrand(user, input.brandId);
  if (!isValidTimeZone(input.timezone)) return json({ error: "Invalid timezone" }, { status: 422 });
  const rows = await validateBulk(brand.id, input.csv, input.timezone);
  return json({ rows, ok: rows.length > 0 && rows.every((r) => !r.errors.length) });
});
