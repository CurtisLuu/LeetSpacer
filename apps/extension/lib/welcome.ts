/**
 * Opening the walkthrough.
 *
 * It shows itself once on install, and that tab is easy to close before reading. Every
 * surface that could leave someone stuck offers a way back to it, and it doubles as the
 * only way to see the page again without reinstalling the extension.
 */
export function openWelcome(): void {
  void browser.tabs
    .create({ url: browser.runtime.getURL("/welcome.html") })
    .catch((error: unknown) => console.error("[lcs] welcome tab", error));
}
