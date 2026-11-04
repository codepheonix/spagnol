import { z } from "zod";
import { localToUtc, schedulePost, isValidTimeZone } from "@sm/core";
import { apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

const schema = z.object({ scheduledAt: z.string().datetime().optional(), localDate: z.string().optional(), localTime: z.string().optional(), timezone: z.string().default("Europe/Rome") });

export const POST = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const input = await parseJson(req, schema);
  if (!isValidTimeZone(input.timezone)) throw new HttpError(422, "Invalid timezone.", "validation");
  const at = input.scheduledAt ? new Date(input.scheduledAt) : input.localDate && input.localTime ? localToUtc(input.localDate, input.localTime, input.timezone) : null;
  if (!at) throw new HttpError(422, "Provide scheduledAt or localDate+localTime.", "validation");
  return json({ post: await schedulePost(user.id, id, { scheduledAt: at, scheduleTimezone: input.timezone }) });
});
