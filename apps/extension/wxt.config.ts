import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  vite: () => ({
    plugins: [tailwindcss()],
  }),

  // Names the store artifact after the product rather than the workspace package, so
  // what gets uploaded is `leetspacer-1.0.0-chrome.zip`.
  zip: {
    name: "leetspacer",
  },

  manifest: {
    name: "LeetSpacer",
    // Under Chrome's 12-character display budget, so the toolbar and the extensions page
    // show the real name rather than a truncation of it.
    short_name: "LeetSpacer",
    // `side_panel` landed in Chrome 114. Without this, an older browser installs the
    // extension and lands on a panel API that isn't there; with it, Chrome refuses the
    // install cleanly and says why.
    minimum_chrome_version: "114",
    // No `author`. The field takes the publishing account's email address, and the
    // manifest ships inside the package — so anyone who unpacks the extension, or reads
    // this file, has the maintainer's personal address. Chrome does not require it, and
    // nothing about the listing is worse without it. Leave it out.
    // 127 characters. The store truncates at 132, so this fits whole rather than being
    // cut mid-word in the listing.
    description:
      "Spaced repetition for coding interview prep. Schedules reviews from your own LeetCode and NeetCode history, all stored locally.",
    // No `version` here on purpose — WXT takes it from package.json, so there is one
    // place to bump and no way for the two to disagree.

    // Regenerate with `python3 scripts/build-icons.py`.
    icons: {
      16: "/icons/16.png",
      32: "/icons/32.png",
      48: "/icons/48.png",
      128: "/icons/128.png",
    },

    homepage_url: "https://github.com/CurtisLuu/LeetSpacer",

    // Deliberately small. `sidePanel` for the main UI, `alarms` to schedule background
    // syncs. No `tabs`, no `<all_urls>`, no remote code.
    //
    // No `storage`: every byte this extension keeps is in IndexedDB, which needs no
    // permission at all. Declaring one nothing calls is a routine rejection, and it
    // overstates what the extension can reach.
    permissions: ["sidePanel", "alarms"],

    // Both sites are read from a content script on their own origin, using the session
    // you're already signed in with. Content scripts are declared statically, so these
    // appear in the install prompt.
    host_permissions: ["https://neetcode.io/*", "https://leetcode.com/*"],

    action: {
      default_title: "LeetSpacer",
      default_icon: {
        16: "/icons/16.png",
        32: "/icons/32.png",
        48: "/icons/48.png",
        128: "/icons/128.png",
      },
    },
  },
});
