"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

const TRIGGERS = ["publish_completed", "publish_failed", "account_disconnected", "comment_keyword", "message_received", "lead_received", "review_received"];
const ACTIONS = ["notify_owner", "create_draft", "tag_contact"];

export function AutomationForm({ brandId }: { brandId: string }) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("publish_failed");
  const [keyword, setKeyword] = useState("");
  const [action, setAction] = useState("notify_owner");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function submit() {
    setErr(null);
    const filters: Record<string, string> = {};
    if (keyword) filters.keyword = keyword;
    const payload = { brandId, name, trigger: { type: trigger, filters }, actions: [{ type: action, params: {} }], enabled: true };
    try {
      await api("/api/automations", { method: "POST", json: payload });
      setName("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>New rule</h3>
      <label>Name</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="row">
        <div>
          <label>Trigger</label>
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {TRIGGERS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        {trigger === "comment_keyword" && (
          <div>
            <label>Keyword</label>
            <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="PREZZO" />
          </div>
        )}
        <div>
          <label>Action</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      {err && <div className="msg err">{err}</div>}
      <div style={{ marginTop: 10 }}>
        <button className="primary" disabled={!name} onClick={() => void submit()}>
          Create (enabled)
        </button>
      </div>
    </div>
  );
}
