import { describe, expect, it } from "vitest";

import { suggestSplitZipName } from "./opsExcel";

describe("suggestSplitZipName", () => {
  it("strips .xlsx and appends _split.zip", () => {
    expect(suggestSplitZipName("data.xlsx")).toBe("data_split.zip");
  });

  it("strips .xlsm extension too", () => {
    expect(suggestSplitZipName("orders.xlsm")).toBe("orders_split.zip");
  });

  it("handles filenames with multiple dots", () => {
    expect(suggestSplitZipName("báo.giá.2026.xlsx")).toBe(
      "báo.giá.2026_split.zip"
    );
  });

  it("handles filenames without extension", () => {
    expect(suggestSplitZipName("noext")).toBe("noext_split.zip");
  });

  it("falls back to a generic name when input is empty", () => {
    expect(suggestSplitZipName("")).toBe("split.zip");
    expect(suggestSplitZipName("   ")).toBe("split.zip");
  });

  it("preserves a leading dot as a hidden filename", () => {
    // ".env" is "no extension" semantically — the dot is at position 0,
    // so we treat the whole name as the stem.
    expect(suggestSplitZipName(".env")).toBe(".env_split.zip");
  });
});
