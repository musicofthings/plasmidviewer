import { describe, it, expect } from "vitest";
import type { LibraryNode, SequenceRecord } from "../models/library";
import { childrenOf, descendantIds, nodePath, defaultChildName, type LibraryData } from "./libraryTree";

const node = (id: string, name: string, parentId: string | null): LibraryNode =>
    ({ id, name, parentId, createdAt: 0, updatedAt: 0 });

// workspace w1 > project p1 > experiment e1 > sample s1 > sequence q1
const data: LibraryData = {
    workspaces: [node("w1", "WS", null), node("w2", "WS 2", null)],
    projects: [node("p1", "Proj", "w1")],
    experiments: [node("e1", "Exp", "p1")],
    samples: [node("s1", "Samp", "e1")],
    sequences: [{ ...node("q1", "Seq", "s1"), plasmid: { name: "Seq", length: 0, sequence: "", features: [], topology: "linear" } } as SequenceRecord],
};

describe("childrenOf", () => {
    it("returns the contained level's nodes for a parent", () => {
        expect(childrenOf(data, "workspace", "w1").map(n => n.id)).toEqual(["p1"]);
        expect(childrenOf(data, "sample", "s1").map(n => n.id)).toEqual(["q1"]);
    });

    it("is empty for a leaf and for a childless parent", () => {
        expect(childrenOf(data, "sequence", "q1")).toEqual([]);
        expect(childrenOf(data, "workspace", "w2")).toEqual([]);
    });
});

describe("descendantIds", () => {
    it("collects every id below a node, all levels deep", () => {
        expect(descendantIds(data, "workspace", "w1").sort()).toEqual(["e1", "p1", "q1", "s1"]);
        expect(descendantIds(data, "sample", "s1")).toEqual(["q1"]);
        expect(descendantIds(data, "sequence", "q1")).toEqual([]);
    });
});

describe("nodePath", () => {
    it("walks a sequence up to its root workspace", () => {
        expect(nodePath(data, "sequence", "q1").map(p => `${p.level}:${p.node.id}`))
            .toEqual(["workspace:w1", "project:p1", "experiment:e1", "sample:s1", "sequence:q1"]);
    });

    it("is just the node itself for a workspace", () => {
        expect(nodePath(data, "workspace", "w1").map(p => p.node.id)).toEqual(["w1"]);
    });
});

describe("defaultChildName", () => {
    it("uses the base label, then numbers to avoid collisions", () => {
        const existing = [node("a", "Sample", "x"), node("b", "Sample 2", "x")];
        expect(defaultChildName([], "Sample")).toBe("Sample");
        expect(defaultChildName(existing, "Sample")).toBe("Sample 3");
    });
});
