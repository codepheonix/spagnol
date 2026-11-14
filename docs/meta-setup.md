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
8. **Leave the app in Development mode for the first test.** Only people with a role on the app can
   sign in, so press Connect with the Facebook profile that created the app (or one added under
   App roles that accepted the invitation) and that may publish on the Page — Page access alone does
   not give an app role. Test posts made in Development mode are visible only to people with an app
   role: verify the first post while signed in as that profile.
9. **App settings → Basic**: copy **App ID** and **App secret** into the form on `/accounts/setup/meta`.
   The pair is checked with Meta (app access token) and stored encrypted.

## Permissions
| Purpose | Requested at sign-in | When |
| --- | --- | --- |
| Publish to Pages | `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `business_management` | always |
| Publish to Instagram (Facebook Login) | + `instagram_basic`, `instagram_content_publish` | "Connect with Facebook login" on the Instagram row |
| Comments + insights | `pages_read_user_content`, `pages_manage_engagement`, `read_insights`, `instagram_manage_comments`, `instagram_manage_insights` | only after adding them in Meta **and** ticking the option in the setup page (a permission the Meta app does not have makes Meta reject the whole sign-in) |
| Ads (not built yet) | `ads_read`, then `ads_management` | milestone 5 |

## Development mode, Live mode, clients
Source: <https://developers.facebook.com/documentation/development/build-and-test/app-modes>
- **Development mode (first test, own accounts)**: works with no review for people with an app role.
  Data created (test posts) is visible only to role users.
- **Live mode (posts visible to everyone)**: Meta says to switch only after testing and App Review,
  because in Live mode only permissions approved through App Review can be requested. Before
  switching, set Privacy policy URL and User data deletion to
  `https://spagnol-social-manager.vercel.app/privacy`.
- **Clients signing in with their own Facebook**: each permission needs **Advanced Access**
  (**App Review** + **Business Verification**). Until then a client can be connected only if their
  Facebook profile is added under **App roles**.
- Not built yet: a sign-in link a client can open without an account in this app.

## Verification status
Nothing here is `LIVE_VERIFIED`. The flow has been exercised end to end against a stand-in Graph
server (`packages/core/src/meta-flow.test.ts`) and in a browser walkthrough; the first real
connection + scheduled photo post on a real Page and Instagram account is the remaining check.
