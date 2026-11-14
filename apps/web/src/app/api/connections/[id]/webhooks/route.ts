import { subscribeAccountWebhooks } from "@sm/core";
import { apiUser, handle, HttpError, json } from "@/lib/api";

/** Subscribes the account (Page / Instagram account) to this app's webhook fields at Meta. */
export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  try {
    return json(await subscribeAccountWebhooks(user.id, id));
  } catch (err) {
    if ((err as Error).name === "ProviderError") throw err;
    throw new HttpError(400, (err as Error).message, "bad_request");
  }
});
