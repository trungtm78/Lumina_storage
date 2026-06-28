import { describe, expect, it } from "vitest";

import {
  buildMicrosoftLoginSearch,
  readMicrosoftSsoHints,
  shouldBridgeMicrosoftResponse,
} from "./microsoftSso";

describe("buildMicrosoftLoginSearch", () => {
  it("always sets microsoft=1", () => {
    expect(buildMicrosoftLoginSearch("")).toBe("microsoft=1");
    expect(buildMicrosoftLoginSearch("?microsoft=1")).toBe("microsoft=1");
  });

  // Regression: ProtectedRoute used to hardcode `/login?microsoft=1`, dropping
  // login_hint. Without it, loginRedirect runs with no hint and Azure shows the
  // account picker instead of carrying the Core session over.
  it("preserves login_hint from the incoming URL", () => {
    const result = new URLSearchParams(
      buildMicrosoftLoginSearch("?microsoft=1&login_hint=alice@contoso.com"),
    );
    expect(result.get("microsoft")).toBe("1");
    expect(result.get("login_hint")).toBe("alice@contoso.com");
  });

  it("preserves both login_hint and sid", () => {
    const result = new URLSearchParams(
      buildMicrosoftLoginSearch("?microsoft=1&login_hint=bob@contoso.com&sid=abc-123"),
    );
    expect(result.get("login_hint")).toBe("bob@contoso.com");
    expect(result.get("sid")).toBe("abc-123");
  });

  it("ignores unrelated params and empty hint values", () => {
    const result = new URLSearchParams(
      buildMicrosoftLoginSearch("?microsoft=1&login_hint=&foo=bar"),
    );
    expect(result.get("login_hint")).toBeNull();
    expect(result.get("foo")).toBeNull();
    expect(result.get("microsoft")).toBe("1");
  });
});

describe("readMicrosoftSsoHints", () => {
  it("extracts trimmed login_hint and sid for popup fallback", () => {
    expect(
      readMicrosoftSsoHints("?microsoft=1&login_hint=%20alice%40contoso.com%20&sid=%20abc-123%20"),
    ).toEqual({
      loginHint: "alice@contoso.com",
      sid: "abc-123",
    });
  });

  it("drops empty values", () => {
    expect(readMicrosoftSsoHints("?microsoft=1&login_hint=&sid=%20")).toEqual({
      loginHint: undefined,
      sid: undefined,
    });
  });
});

describe("shouldBridgeMicrosoftResponse", () => {
  it("bridges popup and silent iframe callbacks", () => {
    expect(shouldBridgeMicrosoftResponse({ hasOpener: true, embedded: false })).toBe(true);
    expect(shouldBridgeMicrosoftResponse({ hasOpener: false, embedded: true })).toBe(true);
  });

  it("keeps top-level redirect callbacks in the current window", () => {
    expect(shouldBridgeMicrosoftResponse({ hasOpener: false, embedded: false })).toBe(false);
  });
});
