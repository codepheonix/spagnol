import { z } from "zod";
import { parseBackend, parseProvider, startConnection } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson } from "@/lib/api";

const schema = z.object({
  backend: z.enum(["native", "zernio"]).default("native"),
  /** e.g. { loginMethod: "facebook_login" | "instagram_login" } */
  options: z.record(z.string(), z.string()).optional(),
  /** Refresh the permission of an existing account record instead of adding a new one. */
  reconnectAccountId: z.string().optional(),
});

/** Starts a connection for THIS brand; the brand stays bound to the sign-in through the OAuth state. */
export const POST = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id, provider } = await params;
  const brand = await apiBrand(user, id);
  const input = await parseJson(req, schema).catch(() => ({ backend: "native" as const, options: undefined, reconnectAccountId: undefined }));
  const r = await startConnection({ brandId: brand.id, userId: user.id, provider: parseProvider(provider), backend: parseBackend(input.backend), options: input.options, reconnectAccountId: input.reconnectAccountId });
  return json({ redirectUrl: r.redirectUrl, connect: r.descriptor.connect });
});
