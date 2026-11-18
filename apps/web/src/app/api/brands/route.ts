import { z } from "zod";
import { createWorkspace, isValidTimeZone, listWorkspaces, WORKSPACE_KINDS } from "@sm/core";
import { apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

const text = (max: number) => z.string().max(max).optional().nullable();
const schema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(WORKSPACE_KINDS).default("business"),
  websiteUrl: z.string().url().optional().nullable().or(z.literal("")),
  industry: text(80),
  country: text(60),
  description: text(1000),
  brandVoice: text(1000),
  targetAudience: text(1000),
  logoUrl: z.string().url().max(500).optional().nullable().or(z.literal("")),
  timezone: z.string().default("Europe/Rome"),
  locale: z.enum(["it", "en"]).default("en"),
});

export const GET = handle(async () => {
  const user = await apiUser();
  return json({ workspaces: await listWorkspaces(user.id, { includeArchived: true }) });
});

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  if (!isValidTimeZone(input.timezone)) throw new HttpError(422, "Invalid timezone.", "validation");
  const brand = await createWorkspace(user.id, input);
  return json({ brand }, { status: 201 });
});
