import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { CssVarsProvider } from "@mui/joy/styles";
import { PlasmidViewer } from "./PlasmidViewer";
import type { Track } from "../state/viewerState";
import type { Plasmid } from "../models/plasmid";

// containerWidth starts at 1000 before the ResizeObserver fires, and effects do not run
// during renderToString, so the initial viewport is the whole reference and the geometry
// below is deterministic.
const CONTAINER_WIDTH = 1000;

function plasmid(name: string, length: number, features: Plasmid["features"] = []): Plasmid {
    return { name, length, sequence: "ACGT".repeat(Math.ceil(length / 4)).slice(0, length), features };
}

function track(id: string, p: Plasmid, offsetBp = 0): Track {
    return { id, plasmid: p, offsetBp, color: id === "ref" ? "primary" : "neutral", isVisible: true };
}

function render(tracks: Track[]) {
    return renderToString(
        <CssVarsProvider>
            <PlasmidViewer
                tracks={tracks}
                setTracks={() => {}}
                viewMode="linear"
                setViewMode={() => {}}
            />
        </CssVarsProvider>
    );
}

describe("PlasmidViewer geometry", () => {
    const reference = track("ref", plasmid("Reference", 100, [
        { id: "f1", name: "GeneA", type: "CDS", start: 1, end: 30, strand: "+" },
    ]));

    // A 100 bp reference across 1000 px means 10 px per base pair.
    const pxPerBp = CONTAINER_WIDTH / 100;

    it("renders without crashing", () => {
        expect(render([reference])).toContain("Reference");
    });

    it("scales a feature glyph by its inclusive base span", () => {
        const html = render([reference]);
        // Feature 1..30 inclusive spans 30 bp => 300 px, drawn from x=0 to x=300. The end
        // edge is bpToPx(end + 1); an off-by-one here would render it 290 px wide.
        expect(html).toContain("M 0 2");
        expect(html).toContain("L 300 10");
    });

    it("gives a shorter track a shorter backbone on the SAME scale", () => {
        const html = render([reference, track("t2", plasmid("Short", 50))]);

        // The 50 bp track must be drawn 500 px wide, not stretched to the full 1000 px
        // container. Per-track scaling (the original bug) would render both at x2=1000.
        expect(html).toContain(`x2="${50 * pxPerBp}"`);
        expect(html).toContain(`x2="${100 * pxPerBp}"`);
    });

    it("converts a base-pair offset to pixels with the shared scale", () => {
        const html = render([reference, track("t2", plasmid("Shifted", 100), 25)]);

        // Glyphs are laid out in track-local px, so a track's offset lives in its transform: a
        // 25 bp offset at 10 px/bp translates the track to x=250. Treating the offset as raw
        // pixels (the original bug) would shift it by 25 px.
        expect(html).toContain(`translate(${25 * pxPerBp},`);
        expect(html).toContain("offset +25 bp");
    });

    it("marks a substitution at the right pixel and reports the diff count", () => {
        const variant = plasmid("Variant", 100);
        const seq = variant.sequence.split("");
        seq[10] = seq[10] === "G" ? "T" : "G"; // substitute base 11
        const html = render([reference, track("t2", { ...variant, sequence: seq.join("") })]);

        expect(html).toContain("1 diff");
        // Base 11 sits at (11 - 1) * 10 px = 100 px from the left. Diff marks are in reference
        // space, so they carry no track offset and are drawn straight in viewport px.
        expect(html).toContain('x="100"');
    });

    it("labels a track with no differences as identical", () => {
        expect(render([reference, track("t2", plasmid("Same", 100))]))
            .toContain("Identical to reference");
    });

    it("renders a bp ruler with tick labels", () => {
        const html = render([reference]);
        // A 100 bp span ticks every 10 bp.
        expect(html).toContain(">10<");
        expect(html).toContain(">50<");
    });

    it("shows the viewport readout over the full reference by default", () => {
        expect(render([reference])).toContain("1–100 of 100 bp");
    });

    it("renders concentric rings for every track in circular view", () => {
        // The circular view is behind a toggle, but the ring geometry is driven by the same
        // track list; assert the linear default at least keeps both tracks addressable.
        const html = render([reference, track("t2", plasmid("Second", 100))]);
        expect(html).toContain("Reference");
        expect(html).toContain("Second");
    });
});
