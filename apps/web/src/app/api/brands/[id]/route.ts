import { z } from "zod";
import { isValidTimeZone, updateWorkspace, WORKSPACE_KINDS } from "@sm/core";
import { apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

const text = (max: number) => z.string().max(max).optional().nullable();
const schema = z.object({
  name: z.string().min(1).max(80).optional(),
  kind: z.enum(WORKSPACE_KINDS).optional(),
  websiteUrl: z.string().url().optional().nullable().or(z.literal("")),
  industry: text(80),
  country: text(60),
  description: text(1000),
  brandVoice: text(1000),
  targetAudience: text(1000),
  logoUrl: z.string().url().max(500).optional().nullable().or(z.literal("")),
  timezone: z.string().optional(),
  locale: z.enum(["it", "en"]).optional(),
  archived: z.boolean().optional(),
});

export const PATCH = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const input = await parseJson(req, schema);
  if (input.timezone && !isValidTimeZone(input.timezone)) throw new HttpError(422, "Invalid timezone.", "validation");
  return json({ brand: await updateWorkspace(user.id, id, input) });
});
