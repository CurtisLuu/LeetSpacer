import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  vite: () => ({
    plugins: [tailwindcss()],
  }),

  manifest: {
    name: "LeetCode Spaced",
    description:
      "Recommends which coding problems to practice next, using spaced repetition over your own NeetCode history. All data stays on your device.",
    version: "0.1.0",

    // Deliberately small. `storage` for local state, `sidePanel` for the main UI,
    // `alarms` to schedule background syncs. No `tabs`, no `<all_urls>`, no remote code.
    permissions: ["storage", "sidePanel", "alarms"],

    // Requested from the options page when you connect a repository, not at install.
    optional_host_permissions: ["https://api.github.com/*"],

    // NeetCode only for now — LeetCode is deferred until its adapter is worked out, and
    // asking for a host permission we don't use would be both rude and a review risk.
    // Content scripts are declared statically, so this appears in the install prompt.
    host_permissions: ["https://neetcode.io/*"],

    action: {
      default_title: "LeetCode Spaced",
    },
  },
});
