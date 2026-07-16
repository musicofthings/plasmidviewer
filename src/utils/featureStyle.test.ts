import { describe, it, expect } from "vitest";
import { featureCategory, categoriesPresent, featureColor } from "./featureStyle";

const feat = (type: string, rawType?: string) =>
    ({ type: type as "CDS" | "promoter" | "terminator" | "marker" | "misc", rawType });

describe("featureCategory", () => {
    it("keys origins and primers off rawType even though their bucket is 'misc'", () => {
        expect(featureCategory(feat("misc", "rep_origin"))).toBe("origin");
        expect(featureCategory(feat("misc", "primer_bind"))).toBe("primer");
        expect(featureCategory(feat("misc", "protein_bind"))).toBe("primer");
        expect(featureCategory(feat("misc", "LTR"))).toBe("ltr");
    });

    it("falls back to the type bucket when rawType is unremarkable", () => {
        expect(featureCategory(feat("CDS", "CDS"))).toBe("cds");
        expect(featureCategory(feat("promoter", "promoter"))).toBe("promoter");
        expect(featureCategory(feat("misc", "misc_feature"))).toBe("misc");
        expect(featureCategory(feat("misc"))).toBe("misc");
    });
});

describe("categoriesPresent", () => {
    it("returns the distinct categories in stable legend order", () => {
        const features = [
            feat("misc", "primer_bind"),
            feat("CDS", "CDS"),
            feat("misc", "rep_origin"),
            feat("CDS", "CDS"),
        ];
        // Order is cds, promoter, terminator, marker, origin, primer, ltr, misc.
        expect(categoriesPresent(features)).toEqual(["cds", "origin", "primer"]);
    });

    it("is empty for no features", () => {
        expect(categoriesPresent([])).toEqual([]);
    });
});

describe("featureColor", () => {
    it("resolves to the category's CSS custom property", () => {
        expect(featureColor(feat("CDS", "CDS"))).toBe("var(--feat-cds)");
        expect(featureColor(feat("misc", "rep_origin"))).toBe("var(--feat-origin)");
    });
});
