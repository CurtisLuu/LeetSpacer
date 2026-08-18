/**
 * Opening the extension's own full pages in a tab.
 *
 * The side panel is a few hundred pixels wide, which suits a queue of ten rows and
 * nothing longer. Anything that wants a table goes in a tab instead.
 */
function open(path: "/welcome.html" | "/problems.html"): void {
  void browser.tabs
    .create({ url: browser.runtime.getURL(path) })
    .catch((error: unknown) => console.error(`[lcs] open ${path}`, error));
}

/**
 * The walkthrough. It shows itself once on install, and that tab is easy to close before
 * reading, so every surface that could leave someone stuck offers a way back to it.
 */
export function openWelcome(): void {
  open("/welcome.html");
}

/** The full problem list, with unlock countdowns. */
export function openProblems(): void {
  open("/problems.html");
}
