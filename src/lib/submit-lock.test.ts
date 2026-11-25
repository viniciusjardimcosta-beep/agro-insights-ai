import { describe, expect, it } from "vitest";
import { createSubmitLock } from "./submit-lock";

describe("createSubmitLock", () => {
  it("segundo toque seguido é ignorado até soltar", () => {
    const l = createSubmitLock();
    expect(l.take()).toBe(true);
    expect(l.take()).toBe(false);
    l.release();
    expect(l.take()).toBe(true);
  });
});
