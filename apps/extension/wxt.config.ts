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

    homepage_url: "https://github.com/CurtisLuu/leetcode-spaced",

    // Deliberately small. `storage` for local state, `sidePanel` for the main UI,
    // `alarms` to schedule background syncs. No `tabs`, no `<all_urls>`, no remote code.
    permissions: ["storage", "sidePanel", "alarms"],

    // Requested from the options page when you connect a repository, not at install.
    optional_host_permissions: ["https://api.github.com/*"],

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
