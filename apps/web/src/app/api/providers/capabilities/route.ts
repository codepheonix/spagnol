import { listDescriptors, nativeEnvMissing } from "@sm/integrations";
import { getZernioConfig } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const GET = handle(async () => {
  await apiUser();
  const zernio = Boolean(await getZernioConfig());
  const providers = listDescriptors().map((d) => ({ ...d, missingEnv: d.backend === "native" ? nativeEnvMissing(d) : zernio ? [] : ["ZERNIO_API_KEY"] }));
  return json({ providers, zernioConfigured: zernio });
});
