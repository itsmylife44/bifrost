import { describe, expect, it } from "bun:test";
import { shouldFilterAgent } from "../src/manager";

describe("IdentitiesOnly agent filtering", () => {
  it("disables filtering by default when identitiesOnly is unset", () => {
    expect(shouldFilterAgent({ identitiesOnly: undefined })).toBe(false);
  });

  it("keeps filtering enabled when identitiesOnly is true", () => {
    expect(shouldFilterAgent({ identitiesOnly: true })).toBe(true);
  });

  it("disables filtering only when identitiesOnly is explicitly false", () => {
    expect(shouldFilterAgent({ identitiesOnly: false })).toBe(false);
  });
});
