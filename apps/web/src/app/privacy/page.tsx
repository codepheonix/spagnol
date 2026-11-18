import { appUrl } from "@sm/core";

export const metadata = { title: "Privacy" };

/** Public page required by Meta for a Live app: what this installation stores and how to remove it. */
export default function PrivacyPage() {
  const contact = process.env.SUPPORT_EMAIL || null;
  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 20px", lineHeight: 1.6 }}>
      <h1>Privacy policy</h1>
      <p>iGerald is a tool for managing social media accounts: publishing, replies, statistics and advertising. People and companies connect only the accounts they are authorised to manage, through each platform&apos;s official sign-in.</p>
      <h2>What is stored</h2>
      <ul>
        <li>For each social account an authorised person connects: the account&apos;s public name, identifier and picture, the permissions granted, and an access token. Tokens are encrypted and kept on the server only.</li>
        <li>The posts, images and schedules created in the tool, and the publishing results returned by each network.</li>
        <li>Comments, messages and statistics of the connected accounts, when those features are enabled, as provided by each network&apos;s official API.</li>
      </ul>
      <h2>What it is used for</h2>
      <p>Only to publish and manage content on the connected accounts on behalf of the person who connected them. Data is not sold, shared with advertisers, or used for any other purpose.</p>
      <h2 id="data-deletion">Removing access and deleting data</h2>
      <p>The person who connected an account can press <b>Disconnect</b> in the tool at any time: the stored token is deleted immediately and queued posts for that account are canceled. Access can also be removed from Facebook under Settings → Business integrations, or from Instagram under Settings → Website permissions. To have all remaining data about an account deleted, write to {contact ? <a href={`mailto:${contact}`}>{contact}</a> : "the operator of this installation (the person or company that gave you access)"}; deletion is completed within 30 days.</p>
      <p style={{ color: "#888", fontSize: 13 }}>{appUrl()}</p>
    </main>
  );
}
