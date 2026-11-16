import { describe, expect, it } from "vitest";
import { getRepackRequirement, normalizeUids } from "@/lib/api";

describe("helper PO dan RFID", () => {
  it("menghitung total repack dan RFID dari kemasan supplier", () => {
    expect(getRepackRequirement(50, 12, 5)).toEqual({ totalPcs: 600, requiredRfid: 120 });
    expect(getRepackRequirement(1, 12, 5)).toBeNull();
    expect(getRepackRequirement(0, 12, 5)).toBeNull();
  });

  it("menormalkan UID untuk buffer scan", () => {
    expect(normalizeUids(" e28001\nE28002, e28001 ")).toEqual(["E28001", "E28002", "E28001"]);
  });
});
