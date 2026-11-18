import Link from "next/link";
import { appUrl, getOrCreateWebhookVerifyToken, providerAppStatus } from "@sm/core";
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
  const webhookUrl = `${base}/api/webhooks/meta`;
  const verifyToken = await getOrCreateWebhookVerifyToken();
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
          <li><b>App details</b>: name it after your own product or company (the name people see on Meta’s permission screen), add your email → <b>Next</b>.</li>
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
        <h3>4 · Leave the app in Development mode for the first test</h3>
        <p>Do not switch the app to Live yet. In Development mode Meta lets only people with a <b>role on the app</b> sign in, so:</p>
        <ul>
          <li>Sign in (when you press Connect) with the Facebook profile that created the app, or one added under <b>App roles → Roles</b> that has accepted the invitation. Being an admin of the Page is not enough on its own — that profile also needs the app role, <i>and</i> it must be allowed to publish on the Page.</li>
          <li>Test posts made in Development mode are visible only to people with an app role. Check the first post while signed in to Facebook and Instagram as that same profile; other people will not see it until the app is Live.</li>
        </ul>
        <h3>5 · Comment → DM (optional now, needed for the Automations rule)</h3>
        <p>Private replies and comment events need the comments permissions, which are <b>not</b> in the publishing set. Add them in Meta, then tick <b>Request comments + insights permissions</b> below and press <b>Reconnect</b> on the Instagram/Facebook row in Connections (the sign-in has to be repeated so Meta grants the new permissions).</p>
        <ul>
          <li><b>Manage messaging and content on Instagram → Customize → Permissions</b>: add <span className="mono">instagram_manage_comments</span> (private replies and comment webhooks) — and <span className="mono">instagram_manage_messages</span> if you also want to read DMs later.</li>
          <li><b>Manage everything on your Page → Customize → Permissions</b>: add <span className="mono">pages_manage_metadata</span> (webhook subscription), <span className="mono">pages_read_user_content</span>, <span className="mono">pages_manage_engagement</span> and <span className="mono">pages_messaging</span> (Facebook private replies).</li>
          <li>If the account was connected with <b>Instagram login</b> instead (no Page): in that app add <span className="mono">instagram_business_manage_comments</span> and <span className="mono">instagram_business_manage_messages</span>.</li>
        </ul>
        <p><b>Webhooks</b> (so Meta pushes new comments to this app): Dashboard → <b>Webhooks</b> (or <b>Manage messaging and content on Instagram → Customize → Webhooks</b>) → choose object <b>Instagram</b> → <b>Subscribe to this object</b>:</p>
        <p className="mono small" style={{ userSelect: "all" }}>Callback URL: {webhookUrl}</p>
        <p className="mono small" style={{ userSelect: "all" }}>Verify token: {verifyToken}</p>
        <p>Then press <b>Subscribe</b> on the field <span className="mono">comments</span>. Repeat for object <b>Page</b> with the field <span className="mono">feed</span> (Facebook comments). After that, on <b>Automations</b>, press <b>Subscribe at Meta</b> next to the account (this registers the Page / Instagram account itself). Meta signs every delivery with the App secret and this app rejects anything unsigned.</p>
        <p className="small muted">Meta only sends live <span className="mono">comments</span> notifications to apps that are <b>Live</b> and hold <b>Advanced Access</b> to the comments permission (App Review). Until then the dashboard&apos;s <b>Test</b> button sends a sample to the URL above, and this app polls the watched posts every minute with your own token, so the rule works in Development mode for your own accounts.</p>
        <h3>6 · Copy the two values here</h3>
        <p>Still in <b>App settings → Basic</b>: copy the <b>App ID</b>, press <b>Show</b> next to <b>App secret</b> and copy it. Paste both below.</p>
      </div>

      <MetaSetupForm configured={{ meta: ready, configId: apps.META_LOGIN_CONFIG_ID, extended: apps.META_EXTENDED_SCOPES, instagram: apps.INSTAGRAM_APP_ID && apps.INSTAGRAM_APP_SECRET }} />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Development mode, Live mode, and clients</h3>
        <div className="scroll-x"><table><tbody>
          <tr><td><b>First test, your own Pages and Instagram accounts</b></td><td>Works in Development mode with no review, as long as the Facebook profile signing in has a role on the app. Posts are visible only to people with an app role.</td></tr>
          <tr><td><b>Posts visible to everyone</b></td><td>The app has to be <b>Live</b>. Meta says to switch only once testing is finished and App Review is done, because in Live mode only permissions approved through App Review can be requested. Before switching, set <b>Privacy policy URL</b> and <b>User data deletion</b> in <b>App settings → Basic</b> to <span className="mono" style={{ userSelect: "all" }}>{base}/privacy</span>.</td></tr>
          <tr><td><b>Clients signing in with their own Facebook</b></td><td>Needs <b>Advanced Access</b> for each permission, granted through <b>App Review</b> plus <b>Business Verification</b>: <span className="mono">pages_show_list, pages_manage_posts, pages_read_engagement, business_management, instagram_basic, instagram_content_publish</span>. Until then a client can only be connected if their Facebook profile is added under <b>App roles</b> in the Meta app.</td></tr>
          <tr><td><b>If Meta&apos;s sign-in complains about a configuration</b></td><td>Create one under <b>Facebook Login for Business → Configurations</b> (User access token; tick the permissions above) and paste its ID in the optional settings.</td></tr>
        </tbody></table></div>
        <p className="small muted">Graph API version pinned by this app: {META_GRAPH_VERSION}. Meta renames dashboard screens from time to time; the names above follow Meta&apos;s current developer documentation.</p>
      </div>
    </div>
  );
}
