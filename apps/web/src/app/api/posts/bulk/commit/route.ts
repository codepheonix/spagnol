import { z } from "zod";
import { createPost, schedulePost, audit } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson, HttpError } from "@/lib/api";
import { validateBulk } from "@/lib/bulk";

const schema = z.object({ brandId: z.string().optional(), csv: z.string().max(2_000_000), timezone: z.string().default("Europe/Rome"), schedule: z.boolean().default(true) });

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const brand = await apiBrand(user, input.brandId);
  const rows = await validateBulk(brand.id, input.csv, input.timezone);
  if (!rows.length || rows.some((r) => r.errors.length)) throw new HttpError(422, "Fix the CSV errors first (run validate).", "bulk_invalid");
  const created = [];
  for (const r of rows) {
    const post = await createPost(user.id, brand.id, { body: r.body, link: r.link ?? null, tags: ["bulk-import"], mediaIds: [], targets: r.accounts.map((socialAccountId) => ({ socialAccountId, overrides: {} })), scheduledAt: r.scheduledAt ?? null, scheduleTimezone: input.timezone });
    if (input.schedule && r.scheduledAt) await schedulePost(user.id, post.id, { scheduledAt: new Date(r.scheduledAt), scheduleTimezone: input.timezone }).catch(() => undefined);
    created.push(post.id);
  }
  await audit({ actorUserId: user.id, brandId: brand.id, action: "post.bulk_import", details: { count: created.length } });
  return json({ created }, { status: 201 });
});
