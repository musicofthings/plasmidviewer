import { diff, lcs } from "fast-myers-diff";

export interface Mismatch {
    type: "sub" | "ins" | "del";
    /** 1-based inclusive coordinate in the reference, matching Feature.start/end. */
    pos: number;
    /** Reference bases at `pos`, or "-" for an insertion. */
    refChar: string;
    /** Query bases aligned to `pos`, or "-" for a deletion. */
    queryChar: string;
    /** Span in reference base pairs. 0 for an insertion (it consumes no reference). */
    length: number;
}

// fast-myers-diff `diff` yields 4-tuples [sx, ex, sy, ey] meaning "replace
// reference[sx:ex] with query[sy:ey]" — these are already the difference ranges,
// so each tuple maps directly to one Mismatch.
export function alignSequences(reference: string, query: string): Mismatch[] {
    const mismatches: Mismatch[] = [];

    for (const [sx, ex, sy, ey] of diff(reference, query)) {
        const refSeg = reference.slice(sx, ex);
        const querySeg = query.slice(sy, ey);
        const pos = sx + 1;

        if (refSeg.length > 0 && querySeg.length > 0) {
            mismatches.push({
                type: "sub",
                pos,
                refChar: refSeg,
                queryChar: querySeg,
                length: refSeg.length,
            });
        } else if (refSeg.length > 0) {
            mismatches.push({
                type: "del",
                pos,
                refChar: refSeg,
                queryChar: "-",
                length: refSeg.length,
            });
        } else if (querySeg.length > 0) {
            mismatches.push({
                type: "ins",
                pos,
                refChar: "-",
                queryChar: querySeg,
                length: 0,
            });
        }
    }

    return mismatches;
}

// Returns the offset, in base pairs, to add to a query coordinate to land on the
// corresponding reference coordinate. Uses `lcs` (matching ranges) rather than
// `diff` (differing ranges): the best offset comes from the longest block the two
// sequences share.
export function calculateOffset(reference: string, query: string): number {
    let bestOffset = 0;
    let maxLen = 0;

    for (const [sx, sy, len] of lcs(reference, query)) {
        if (len > maxLen) {
            maxLen = len;
            bestOffset = sx - sy;
        }
    }

    return bestOffset;
}
