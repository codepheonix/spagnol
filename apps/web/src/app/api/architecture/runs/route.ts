import { listRuns, traceRun } from "@sm/core";
import { apiUser, handle, HttpError, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** ?diagram=…           → recent runs of that workflow;  ?diagram=…&id=… → the path one run took. */
export const GET = handle(async (req) => {
  const user = await apiUser();
  const url = new URL(req.url);
  const diagram = url.searchParams.get("diagram") ?? "";
  const id = url.searchParams.get("id");
  if (!id) return json({ runs: await listRuns(user.id, diagram) });
  const trace = await traceRun(user.id, diagram, id);
  if (!trace) throw new HttpError(404, "Run not found.", "not_found");
  return json(trace);
});
