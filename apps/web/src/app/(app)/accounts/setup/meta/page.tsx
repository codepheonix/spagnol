import Link from "next/link";
import { appUrl, providerAppStatus } from "@sm/core";
import { META_GRAPH_VERSION } from "@sm/integrations";
import { requireUser } from "@/lib/auth";
import { MetaSetupForm } from "@/components/Connections";

/** One-time registration of this app with Meta. Everything a person needs is on this page. */
export default async function MetaSetupPage() {
  await requireUser();
  const apps = await providerAppStatus();
  const base = appUrl();
  const fbCallback = `${base}/api/oauth/facebook/callback`;
  const igCallback = `${base}/api/oauth/instagram/callback`;
  const ready = apps.META_APP_ID && apps.META_APP_SECRET;
  return (
    <div style={{ maxWidth: 860 }}>
      <p className="small"><Link href="/accounts">← Connections</Link></p>
      <h1>Meta setup (once)</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Facebook only shows its “Allow this app to manage your Pages?” sign-in to apps it knows. Registering takes about 10 minutes, is free, and is done once for all brands. Tools like Zernio did this same registration themselves, which is why their button works straight away.
      </p>
      {ready ? <div className="msg ok">Meta app saved. <Link href="/accounts"><b>Go to Connections and press “Connect with Facebook” →</b></Link></div> : null}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>1 · Create the app at Meta</h3>
        <ol>
          <li>Open <a href="https://developers.facebook.com/apps/creation/" target="_blank" rel="noreferrer">developers.facebook.com/apps/creation</a>, signed in with the Facebook profile that manages the brand Pages. (First time: accept the developer terms.)</li>
          <li><b>App details</b>: name it e.g. “Spagnol Social Manager”, add your email → <b>Next</b>.</li>
          <li><b>Use cases</b>: tick <b>Manage everything on your Page</b> and <b>Manage messaging and content on Instagram</b> → <b>Next</b>.</li>
          <li><b>Business</b>: pick the group&apos;s business portfolio (or “I don&apos;t want to connect a business portfolio yet”) → <b>Next</b> → <b>Next</b> → <b>Go to dashboard</b>.</li>
        </ol>
        <h3>2 · Add the permissions</h3>
        <ol>
          <li>Dashboard → <b>Manage everything on your Page</b> → <b>Customize</b> → Permissions: press <b>Add</b> on <span className="mono">pages_manage_posts</span> and <span className="mono">pages_read_engagement</span> (<span className="mono">pages_show_list</span> and <span className="mono">business_management</span> should already be listed; add them if not).</li>
          <li>Dashboard → <b>Manage messaging and content on Instagram</b> → <b>Customize</b> → choose <b>API setup with Facebook Login</b> → <b>Add all required permissions</b> (this adds <span className="mono">instagram_basic</span> and <span className="mono">instagram_content_publish</span>).</li>
        </ol>
        <h3>3 · Tell Meta where to send you back</h3>
        <p>In <b>Facebook Login for Business → Settings</b> (left menu), under <b>Valid OAuth Redirect URIs</b>, add both lines exactly, then <b>Save changes</b>:</p>
        <p className="mono" style={{ userSelect: "all" }}>{fbCallback}</p>
        <p className="mono" style={{ userSelect: "all" }}>{igCallback}</p>
        <h3>4 · Make the app Live</h3>
        <p>In <b>App settings → Basic</b>, set <b>Privacy policy URL</b> to <span className="mono" style={{ userSelect: "all" }}>{base}/privacy</span> and <b>User data deletion</b> to the same address, choose a category, save, then switch the app from Development to <b>Live</b> (the <b>Publish</b> entry in the left menu). Posts made by an app left in Development mode can be visible only to the app&apos;s own team, so do this before the first real post.</p>
        <h3>5 · Copy the two values here</h3>
        <p>Still in <b>App settings → Basic</b>: copy the <b>App ID</b>, press <b>Show</b> next to <b>App secret</b> and copy it. Paste both below.</p>
      </div>

      <MetaSetupForm configured={{ meta: ready, configId: apps.META_LOGIN_CONFIG_ID, extended: apps.META_EXTENDED_SCOPES, instagram: apps.INSTAGRAM_APP_ID && apps.INSTAGRAM_APP_SECRET }} />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>What works without Meta&apos;s review, and what needs it</h3>
        <table><tbody>
          <tr><td><b>Your own Pages and Instagram accounts</b></td><td>Work right after this setup (Standard Access). You are the app&apos;s admin, so no App Review is needed.</td></tr>
          <tr><td><b>Clients signing in with their own Facebook</b></td><td>Needs <b>Advanced Access</b> for each permission, granted through <b>App Review</b> plus <b>Business Verification</b>: <span className="mono">pages_show_list, pages_manage_posts, pages_read_engagement, business_management, instagram_basic, instagram_content_publish</span>. Until then a client can only be connected if they are added under <b>App roles</b> in the Meta app, or if you are an admin of their Page.</td></tr>
          <tr><td><b>If Meta&apos;s sign-in complains about a configuration</b></td><td>Create one under <b>Facebook Login for Business → Configurations</b> (User access token; tick the permissions above) and paste its ID in the optional settings.</td></tr>
        </tbody></table>
        <p className="small muted">Graph API version pinned by this app: {META_GRAPH_VERSION}. Meta renames dashboard screens from time to time; the names above follow Meta&apos;s current developer documentation.</p>
      </div>
    </div>
  );
}
