/**
 * Helpers for the Core → Storage Microsoft SSO hand-off.
 *
 * When Core opens Storage it appends `?microsoft=1` plus `login_hint` (and
 * optionally `sid`) so Storage's MSAL can sign in silently. ProtectedRoute
 * bounces an unauthenticated user to `/login` to start that flow — and it MUST
 * carry those hints across, otherwise loginRedirect runs without a loginHint
 * and Azure falls back to the account picker.
 */

export function readMicrosoftSsoHints(incomingSearch: string): {
  loginHint?: string;
  sid?: string;
} {
  const incoming = new URLSearchParams(incomingSearch);
  const loginHint = incoming.get("login_hint")?.trim() || undefined;
  const sid = incoming.get("sid")?.trim() || undefined;
  return { loginHint, sid };
}

export function shouldBridgeMicrosoftResponse(options: {
  hasOpener: boolean;
  embedded: boolean;
}): boolean {
  return options.hasOpener || options.embedded;
}

/**
 * Build the `/login` query string for the Microsoft hand-off, preserving the
 * SSO hints from the incoming URL. Always sets `microsoft=1`.
 *
 * @param incomingSearch `window.location.search` (with or without leading `?`)
 * @returns the query string WITHOUT a leading `?` (e.g. `microsoft=1&login_hint=a%40b.com`)
 */
export function buildMicrosoftLoginSearch(incomingSearch: string): string {
  const next = new URLSearchParams({ microsoft: "1" });
  const { loginHint, sid } = readMicrosoftSsoHints(incomingSearch);

  if (loginHint) {
    next.set("login_hint", loginHint);
  }
  if (sid) {
    next.set("sid", sid);
  }

  return next.toString();
}
