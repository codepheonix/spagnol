# Meta setup (Facebook Pages + Instagram) — one-time

The same steps are shown inside the app at **Connections → Meta setup** (`/accounts/setup/meta`), with
the callback URLs filled in for the current deployment. Meta renames dashboard screens from time to
time; names below follow Meta's developer documentation as of November 2026.

## Why it is needed
Facebook only shows its consent screen ("Allow *App* to manage your Pages?") for a registered app.
Hosted tools registered their own app once; a self-hosted tool needs its own. It is free, takes
about ten minutes, and is done once for all brands.

## Steps
1. <https://developers.facebook.com/apps/creation/> — signed in with the Facebook profile that manages the brand Pages.
2. **App details**: name + contact email → Next.
3. **Use cases**: *Manage everything on your Page* and *Manage messaging and content on Instagram* → Next.
   (Ads later: *Create & manage ads with Marketing API*.)
4. **Business**: the group's business portfolio (or "not yet") → Next → Next → Go to dashboard.
5. *Manage everything on your Page* → Customize → add `pages_manage_posts`, `pages_read_engagement`
   (`pages_show_list`, `business_management` are normally present).
6. *Manage messaging and content on Instagram* → Customize → **API setup with Facebook Login** →
   *Add all required permissions* (`instagram_basic`, `instagram_content_publish`, …).
   Meta allows one Instagram setup per app; "API setup with Instagram Login" needs a second app.
7. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**:
   - `https://spagnol-social-manager.vercel.app/api/oauth/facebook/callback`
   - `https://spagnol-social-manager.vercel.app/api/oauth/instagram/callback`
8. **App settings → Basic**: Privacy policy URL and User data deletion →
   `https://spagnol-social-manager.vercel.app/privacy`; pick a category; then set the app **Live**
   (Publish). Posts made by an app in Development mode can be visible only to people with a role on the app.
9. **App settings → Basic**: copy **App ID** and **App secret** into the form on `/accounts/setup/meta`.
   The pair is checked with Meta (app access token) and stored encrypted.

## Permissions
| Purpose | Requested at sign-in | When |
| --- | --- | --- |
| Publish to Pages | `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `business_management` | always |
| Publish to Instagram (Facebook Login) | + `instagram_basic`, `instagram_content_publish` | "Connect with Facebook login" on the Instagram row |
| Comments + insights | `pages_read_user_content`, `pages_manage_engagement`, `read_insights`, `instagram_manage_comments`, `instagram_manage_insights` | only after adding them in Meta **and** ticking the option in the setup page (a permission the Meta app does not have makes Meta reject the whole sign-in) |
| Ads (not built yet) | `ads_read`, then `ads_management` | milestone 5 |

## Own accounts vs. clients
- **Own Pages / Instagram accounts**: Standard Access — works as soon as the app exists, because the
  person signing in is an admin of the app.
- **Clients signing in with their own Facebook**: each permission above needs **Advanced Access**,
  which Meta grants through **App Review** (screen recording + description per permission) and
  **Business Verification**. Until then a client can be connected only if they are added under
  **App roles**, or if the app admin is also an admin of the client's Page.
- Not built yet: a sign-in link a client can open without an account in this app (today the owner
  must be signed in to this app when the connection is started).

## Verification status
Nothing here is `LIVE_VERIFIED`. The flow has been exercised end to end against a stand-in Graph
server (`packages/core/src/meta-flow.test.ts`) and in a browser walkthrough; the first real
connection + scheduled photo post on a real Page and Instagram account is the remaining check.
