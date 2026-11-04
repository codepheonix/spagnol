import { z } from "zod";
import { parseBackend, parseProvider, startConnection } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson } from "@/lib/api";

const schema = z.object({ backend: z.enum(["native", "zernio"]).default("native"), options: z.record(z.string()).optional() });

export const POST = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id, provider } = await params;
  const brand = await apiBrand(user, id);
  const input = await parseJson(req, schema).catch(() => ({ backend: "native" as const, options: undefined }));
  const r = await startConnection({ brandId: brand.id, userId: user.id, provider: parseProvider(provider), backend: parseBackend(input.backend), options: input.options });
  return json({ redirectUrl: r.redirectUrl, connect: r.descriptor.connect });
});
