import { z } from "zod";
import { confirmPendingSelection, discardPendingSelection, getPendingSelection } from "@sm/core";
import { apiUser, handle, json, parseJson } from "@/lib/api";

/** Assets granted at sign-in that are waiting for the owner's choice (no tokens in the response). */
export const GET = handle(async (req) => {
  const user = await apiUser();
  const state = new URL(req.url).searchParams.get("state") ?? "";
  return json(await getPendingSelection(user.id, state));
});

const schema = z.object({ state: z.string().min(10), keys: z.array(z.string()).max(50) });

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const r = await confirmPendingSelection(user.id, input.state, input.keys);
  return json({ ok: true, brandId: r.brandId, accounts: r.accounts.map((a) => ({ id: a.id, provider: a.provider, displayName: a.displayName })) });
});

export const DELETE = handle(async (req) => {
  const user = await apiUser();
  await discardPendingSelection(user.id, new URL(req.url).searchParams.get("state") ?? "");
  return json({ ok: true });
});
