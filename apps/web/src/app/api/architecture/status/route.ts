import { getArchitectureStatus } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Live status of every monitored node, computed from the system's own records at request time. */
export const GET = handle(async () => {
  const user = await apiUser();
  return json(await getArchitectureStatus(user.id));
});
