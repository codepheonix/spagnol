import { createActivationConfirmation } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

/** Explicit owner action: mints a 10-minute confirmation token showing the exact spend. */
export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  return json(await createActivationConfirmation(user.id, id));
});
