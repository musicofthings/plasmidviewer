import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Stack from "@mui/joy/Stack";
import ButtonGroup from "@mui/joy/ButtonGroup";
import Select from "@mui/joy/Select";
import Option from "@mui/joy/Option";
import Typography from "@mui/joy/Typography";
import Chip from "@mui/joy/Chip";

import type { Feature } from "../models/plasmid";
import type { Viewport, Track } from "../state/viewerState";
import { Backbone } from "./Backbone";
import { FeatureGlyph } from "./FeatureGlyph";
import { CircularBackbone } from "./CircularBackbone";
import { Ruler } from "./Ruler";
import { DiffTrack } from "./DiffTrack";
import { SequenceTrack } from "./SequenceTrack";
import { DetailPanel, type Selection } from "./DetailPanel";
import { parseFasta } from "../parsers/fasta";
import { alignSequences, calculateOffset, type Mismatch } from "../utils/alignment";
import {
    assignLanes, laneCount, cullToViewport, stackTracks, glyphY, sequenceRowCount,
    bpToLocalPx, GLYPH_HEIGHT, TRACK_HEADER_HEIGHT,
} from "../utils/layout";
import { exportPng, exportSvg } from "../utils/export";

interface PlasmidViewerProps {
    tracks: Track[];
    setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
    viewMode: "linear" | "circular";
    setViewMode: (mode: "linear" | "circular") => void;
}

const MIN_SPAN_BP = 20;
const CIRCULAR_SIZE = 640;

export function PlasmidViewer({ tracks, setTracks, viewMode, setViewMode }: PlasmidViewerProps) {
    const referenceTrack = tracks[0];
    const plasmid = referenceTrack.plasmid;

    // The viewport is in *reference* base pairs, 1-based inclusive, and is the single source
    // of truth: the ruler, every track's glyphs, the diff marks and the sequence strip are
    // all derived from it, so they cannot drift out of sync (FR-6, FR-13).
    const [viewport, setViewport] = useState<Viewport>({ start: 1, end: plasmid.length });
    const [selection, setSelection] = useState<Selection | null>(null);
    const [exportScale, setExportScale] = useState(2);
    const [error, setError] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [showComplement, setShowComplement] = useState(false);
    const [showTranslation, setShowTranslation] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const linearSvgRef = useRef<SVGSVGElement>(null);
    const circularSvgRef = useRef<SVGSVGElement>(null);
    const [containerWidth, setContainerWidth] = useState(1000);

    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerWidth(Math.max(1, Math.floor(entry.contentRect.width)));
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    // A new reference (or a cleared session) invalidates the old viewport.
    useEffect(() => {
        setViewport({ start: 1, end: plasmid.length });
        setSelection(null);
    }, [plasmid.length, plasmid.name]);

    const spanBp = Math.max(1, viewport.end - viewport.start + 1);
    const pxPerBp = containerWidth / spanBp;
    const bpToPx = useCallback(
        (bp: number) => (bp - viewport.start) * (containerWidth / Math.max(1, viewport.end - viewport.start + 1)),
        [viewport.start, viewport.end, containerWidth],
    );

    const setSpan = useCallback((newSpan: number, anchorBp: number) => {
        const clampedSpan = Math.round(Math.min(plasmid.length, Math.max(MIN_SPAN_BP, newSpan)));
        // Keep the anchor base at the same fractional position across the zoom.
        const fraction = spanBp <= 1 ? 0.5 : (anchorBp - viewport.start) / spanBp;
        let start = Math.round(anchorBp - fraction * clampedSpan);
        start = Math.max(1, Math.min(start, plasmid.length - clampedSpan + 1));
        setViewport({ start, end: start + clampedSpan - 1 });
    }, [plasmid.length, spanBp, viewport.start]);

    const centerBp = viewport.start + spanBp / 2;
    const zoomIn = useCallback(() => setSpan(spanBp * 0.5, centerBp), [setSpan, spanBp, centerBp]);
    const zoomOut = useCallback(() => setSpan(spanBp * 2, centerBp), [setSpan, spanBp, centerBp]);
    const fit = useCallback(() => setViewport({ start: 1, end: plasmid.length }), [plasmid.length]);

    const zoomTo = useCallback((startBp: number, endBp: number) => {
        const padding = Math.max(10, Math.round((endBp - startBp + 1) * 0.25));
        const span = Math.min(plasmid.length, Math.max(MIN_SPAN_BP, endBp - startBp + 1 + padding * 2));
        let start = Math.round(startBp - padding);
        start = Math.max(1, Math.min(start, plasmid.length - span + 1));
        setViewport({ start, end: start + span - 1 });
    }, [plasmid.length]);

    const panByBp = useCallback((deltaBp: number) => {
        setViewport(prev => {
            const span = prev.end - prev.start + 1;
            let start = Math.round(prev.start + deltaBp);
            start = Math.max(1, Math.min(start, plasmid.length - span + 1));
            return { start, end: start + span - 1 };
        });
    }, [plasmid.length]);

    const panByPx = useCallback((deltaPx: number) => {
        // Dragging the map right should reveal earlier bases, so the viewport moves left.
        panByBp(-deltaPx / Math.max(pxPerBp, 1e-9));
    }, [panByBp, pxPerBp]);

    const startPanDrag = (e: React.MouseEvent) => {
        e.preventDefault();
        let lastX = e.clientX;
        const onMove = (move: MouseEvent) => {
            panByPx(move.clientX - lastX);
            lastX = move.clientX;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const startAlignDrag = (e: React.MouseEvent, trackIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startOffsetBp = tracks[trackIndex].offsetBp;

        const onMove = (move: MouseEvent) => {
            const deltaBp = Math.round((move.clientX - startX) / pxPerBp);
            setTracks(prev => {
                const next = [...prev];
                if (next[trackIndex]) {
                    next[trackIndex] = { ...next[trackIndex], offsetBp: startOffsetBp + deltaBp };
                }
                return next;
            });
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const handleWheel = (e: React.WheelEvent) => {
        // Plain wheel is left alone so the page can still scroll; modifier + wheel zooms
        // around the cursor, which is what a map is expected to do.
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const anchorBp = viewport.start + ((e.clientX - rect.left) / containerWidth) * spanBp;
        setSpan(spanBp * (e.deltaY > 0 ? 1.25 : 0.8), anchorBp);
    };

    const mismatchesByTrackId = useMemo(() => {
        const map = new Map<string, Mismatch[]>();
        for (const track of tracks.slice(1)) {
            map.set(track.id, alignSequences(plasmid.sequence, track.plasmid.sequence));
        }
        return map;
    }, [tracks, plasmid.sequence]);

    // Lanes are assigned over *all* features in track-local pixels, so they depend on the zoom
    // but not on where the viewport sits — panning cannot make a feature hop lanes (FR-9).
    const layoutByTrackId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof assignLanes>>();
        for (const track of tracks) {
            map.set(track.id, assignLanes(track.plasmid.features, pxPerBp, track.plasmid.length));
        }
        return map;
    }, [tracks, pxPerBp]);

    const visibleTracks = useMemo(() => tracks.filter(t => t.isVisible), [tracks]);

    const seqRows = sequenceRowCount(showComplement, showTranslation);
    const { boxes, totalHeight } = useMemo(() => stackTracks(
        visibleTracks.map(track => ({
            lanes: Math.max(1, laneCount(layoutByTrackId.get(track.id) ?? [])),
            hasDiff: mismatchesByTrackId.has(track.id),
            seqRows,
        })),
    ), [visibleTracks, layoutByTrackId, mismatchesByTrackId, seqRows]);

    // Every feature on screen, in reference coordinates, ordered as you would read the map —
    // this is what the keyboard steps through (FR-25).
    const navigableFeatures = useMemo(() => visibleTracks
        .flatMap(track => track.plasmid.features.map(feature => ({
            feature,
            trackName: track.plasmid.name,
            refStart: feature.start + track.offsetBp,
            refEnd: feature.end + track.offsetBp,
        })))
        .sort((a, b) => a.refStart - b.refStart || a.refEnd - b.refEnd),
        [visibleTracks]);

    const selectedFeatureId = selection?.kind === "feature" ? selection.feature.id : undefined;
    const selectedMismatch = selection?.kind === "mismatch" ? selection.mismatch : null;

    const selectFeature = (feature: Feature, trackName: string) =>
        setSelection({ kind: "feature", feature, trackName });

    /** Brings a feature into view without changing the zoom unless it cannot fit. */
    const reveal = useCallback((refStart: number, refEnd: number) => {
        setViewport(prev => {
            if (refStart >= prev.start && refEnd <= prev.end) return prev;

            const span = prev.end - prev.start + 1;
            const needed = Math.min(plasmid.length, Math.max(span, refEnd - refStart + 1));
            let start = Math.round((refStart + refEnd) / 2 - needed / 2);
            start = Math.max(1, Math.min(start, plasmid.length - needed + 1));
            return { start, end: start + needed - 1 };
        });
    }, [plasmid.length]);

    const stepFeature = useCallback((delta: 1 | -1) => {
        if (navigableFeatures.length === 0) return;

        const current = navigableFeatures.findIndex(f => f.feature.id === selectedFeatureId);
        const next = current === -1
            ? (delta === 1 ? 0 : navigableFeatures.length - 1)
            : (current + delta + navigableFeatures.length) % navigableFeatures.length;

        const target = navigableFeatures[next];
        setSelection({ kind: "feature", feature: target.feature, trackName: target.trackName });
        setViewMode("linear");
        reveal(target.refStart, target.refEnd);
    }, [navigableFeatures, selectedFeatureId, reveal, setViewMode]);

    // FR-25. The map is a focusable widget: arrows pan, +/- zoom, n/p walk the features.
    const handleKeyDown = (e: React.KeyboardEvent) => {
        const step = Math.max(1, Math.round(spanBp * (e.shiftKey ? 0.5 : 0.1)));

        switch (e.key) {
            case "ArrowLeft": panByBp(-step); break;
            case "ArrowRight": panByBp(step); break;
            case "ArrowUp": case "+": case "=": zoomIn(); break;
            case "ArrowDown": case "-": case "_": zoomOut(); break;
            case "Home": setViewport({ start: 1, end: Math.min(plasmid.length, spanBp) }); break;
            case "End": setViewport({ start: Math.max(1, plasmid.length - spanBp + 1), end: plasmid.length }); break;
            case "0": case "f": fit(); break;
            case "n": case "]": stepFeature(1); break;
            case "p": case "[": stepFeature(-1); break;
            case "Escape": setSelection(null); break;
            default: return;
        }

        // Only swallow the keys we actually handled — Tab must still move focus.
        e.preventDefault();
    };

    const handleExport = async (format: "png" | "svg") => {
        const source = viewMode === "linear" ? linearSvgRef.current : circularSvgRef.current;
        if (!source) return;

        setError(null);
        setExporting(true);
        try {
            // Read the background off the live theme rather than a hardcoded pair, so the export
            // matches whatever scheme is on screen — including "system".
            const background = getComputedStyle(source)
                .getPropertyValue("--joy-palette-background-body").trim() || "#ffffff";

            const stem = `${plasmid.name}-${viewMode}`;
            if (format === "svg") {
                await exportSvg(source, `${stem}.svg`, { background });
            } else {
                await exportPng(source, `${stem}@${exportScale}x.png`, { background, scale: exportScale });
            }
        } catch (err) {
            setError(err instanceof Error ? `Export failed: ${err.message}` : "Export failed");
        } finally {
            setExporting(false);
        }
    };

    const handleTrackAlign = async (e: React.ChangeEvent<HTMLInputElement>, trackIndex: number) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        try {
            const refPlasmid = parseFasta(await file.text());
            if (refPlasmid.length === 0) throw new Error("No sequence found in that file");

            const offsetBp = calculateOffset(refPlasmid.sequence, tracks[trackIndex].plasmid.sequence);
            setTracks(prev => {
                const next = [...prev];
                next[trackIndex] = { ...next[trackIndex], offsetBp };
                return next;
            });
            e.target.value = "";
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to align track");
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

            <Stack direction="row" spacing={2} alignItems="center" sx={{ p: 1, bgcolor: 'background.surface', borderRadius: 'md', border: '1px solid', borderColor: 'divider', flexWrap: 'wrap', gap: 1 }}>
                <ButtonGroup variant="soft">
                    <Button onClick={() => setViewMode("linear")} color={viewMode === "linear" ? "primary" : "neutral"}>Linear</Button>
                    <Button onClick={() => setViewMode("circular")} color={viewMode === "circular" ? "primary" : "neutral"}>Circular</Button>
                </ButtonGroup>

                {viewMode === "linear" && (
                    <>
                        <ButtonGroup variant="outlined">
                            <Button onClick={zoomOut} disabled={spanBp >= plasmid.length}>−</Button>
                            <Button onClick={zoomIn} disabled={spanBp <= MIN_SPAN_BP}>+</Button>
                            <Button onClick={fit}>Fit</Button>
                        </ButtonGroup>

                        <ButtonGroup variant="outlined">
                            <Button
                                onClick={() => setShowComplement(v => !v)}
                                color={showComplement ? "primary" : "neutral"}
                                aria-pressed={showComplement}
                                title="Show the complement strand"
                            >
                                Complement
                            </Button>
                            <Button
                                onClick={() => setShowTranslation(v => !v)}
                                color={showTranslation ? "primary" : "neutral"}
                                aria-pressed={showTranslation}
                                title="Show all three forward reading frames"
                            >
                                Translation
                            </Button>
                        </ButtonGroup>

                        <Typography level="body-xs" sx={{ fontFamily: 'code', color: 'text.tertiary' }}>
                            {`${Math.round(viewport.start)}–${Math.round(viewport.end)} of ${plasmid.length} bp`}
                        </Typography>
                    </>
                )}

                <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Select
                        size="sm"
                        value={exportScale}
                        onChange={(_, v) => setExportScale(v ?? 2)}
                        sx={{ minWidth: 72 }}
                        slotProps={{ button: { 'aria-label': 'PNG export scale' } }}
                    >
                        <Option value={1}>1x</Option>
                        <Option value={2}>2x</Option>
                        <Option value={3}>3x</Option>
                    </Select>
                    <Button onClick={() => handleExport("png")} variant="solid" color="primary" loading={exporting}>Export PNG</Button>
                    <Button onClick={() => handleExport("svg")} variant="outlined" color="primary" loading={exporting}>Export SVG</Button>
                </Box>
            </Stack>

            {error && <Typography level="body-sm" color="danger">{error}</Typography>}

            <DetailPanel
                selection={selection}
                onZoomTo={(s, e) => { setViewMode("linear"); zoomTo(s, e); }}
                onClear={() => setSelection(null)}
            />

            <Box ref={containerRef} sx={{ width: '100%', p: 2, overflow: 'hidden', bgcolor: 'background.body', borderRadius: 'md' }}>
                {viewMode === "linear" ? (
                    // position: relative anchors the per-track HTML controls over the SVG. The map
                    // itself stays a single pure SVG so that exporting it is just serialization
                    // (FR-23) — no HTML rasterization step, and no html-to-image.
                    <Box sx={{ position: 'relative' }}>
                        <svg
                            ref={linearSvgRef}
                            width={containerWidth}
                            height={totalHeight}
                            viewBox={`0 0 ${containerWidth} ${totalHeight}`}
                            style={{ display: 'block', cursor: 'grab', outline: 'none' }}
                            tabIndex={0}
                            role="application"
                            aria-label="Plasmid map. Arrow keys pan, plus and minus zoom, n and p step through features."
                            onKeyDown={handleKeyDown}
                            onWheel={handleWheel}
                            onMouseDown={startPanDrag}
                        >
                            <Ruler
                                viewportStart={viewport.start}
                                viewportEnd={viewport.end}
                                width={containerWidth}
                                bpToPx={bpToPx}
                            />

                            {visibleTracks.map((track, i) => {
                                const box = boxes[i];
                                const isReference = track.id === referenceTrack.id;
                                const mismatches = mismatchesByTrackId.get(track.id);
                                const laidOut = layoutByTrackId.get(track.id) ?? [];

                                // Where this track's first base sits in viewport space. Glyphs are
                                // laid out in track-local px, so the offset lives in the transform.
                                const originPx = bpToPx(1 + track.offsetBp);
                                const visible = cullToViewport(laidOut, originPx, containerWidth);

                                const header = `${isReference ? "Reference" : `Track ${i + 1}`}: `
                                    + `${track.plasmid.name} (${track.plasmid.length} bp)`
                                    + (!isReference && track.offsetBp !== 0
                                        ? ` · offset ${track.offsetBp > 0 ? "+" : ""}${track.offsetBp} bp` : "")
                                    + (mismatches
                                        ? ` · ${mismatches.length} diff${mismatches.length === 1 ? "" : "s"}` : "");

                                return (
                                    <g key={track.id}>
                                        <text
                                            x={0}
                                            y={box.headerY}
                                            fontSize="12"
                                            fontWeight="600"
                                            fill={isReference
                                                ? "var(--joy-palette-primary-600)"
                                                : "var(--joy-palette-text-secondary)"}
                                            style={{ userSelect: 'none' }}
                                        >
                                            {header}
                                        </text>

                                        <g
                                            transform={`translate(${originPx}, ${box.mapY})`}
                                            onMouseDown={(e) => {
                                                if (!isReference) startAlignDrag(e, tracks.indexOf(track));
                                            }}
                                        >
                                            <title>
                                                {isReference ? "Drag to pan" : "Drag to shift this track's alignment"}
                                            </title>
                                            <Backbone
                                                x1={0}
                                                x2={bpToLocalPx(track.plasmid.length + 1, pxPerBp)}
                                                y={glyphY(0) + GLYPH_HEIGHT / 2}
                                            />
                                            {visible.map(({ feature, startPx, endPx, labelPlacement, lane }) => (
                                                <FeatureGlyph
                                                    key={feature.id}
                                                    feature={feature}
                                                    startPx={startPx}
                                                    endPx={endPx}
                                                    y={glyphY(lane)}
                                                    height={GLYPH_HEIGHT}
                                                    labelPlacement={labelPlacement}
                                                    selected={feature.id === selectedFeatureId}
                                                    onClick={(f) => selectFeature(f, track.plasmid.name)}
                                                />
                                            ))}
                                        </g>

                                        {mismatches && box.diffY !== null && (
                                            <DiffTrack
                                                mismatches={mismatches}
                                                viewportStart={viewport.start}
                                                viewportEnd={viewport.end}
                                                pxPerBp={pxPerBp}
                                                bpToPx={bpToPx}
                                                y={box.diffY}
                                                selected={selectedMismatch}
                                                onSelect={(m) => setSelection({ kind: "mismatch", mismatch: m, trackName: track.plasmid.name })}
                                            />
                                        )}

                                        <SequenceTrack
                                            plasmid={track.plasmid}
                                            offsetBp={track.offsetBp}
                                            viewportStart={viewport.start}
                                            viewportEnd={viewport.end}
                                            pxPerBp={pxPerBp}
                                            bpToPx={bpToPx}
                                            y={box.seqY}
                                            showComplement={showComplement}
                                            showTranslation={showTranslation}
                                        />
                                    </g>
                                );
                            })}
                        </svg>

                        {visibleTracks.map((track, i) => track.id === referenceTrack.id ? null : (
                            <Button
                                key={track.id}
                                component="label"
                                size="sm"
                                variant="outlined"
                                color="neutral"
                                sx={{
                                    position: 'absolute',
                                    right: 0,
                                    top: boxes[i].y,
                                    height: TRACK_HEADER_HEIGHT,
                                    minHeight: TRACK_HEADER_HEIGHT,
                                    py: 0,
                                }}
                            >
                                Align to File
                                <input type="file" hidden onChange={(e) => handleTrackAlign(e, tracks.indexOf(track))} accept=".fasta,.fa,.txt" />
                            </Button>
                        ))}
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <svg
                            ref={circularSvgRef}
                            // Fixed intrinsic size, scaled down by CSS: the export reads the width
                            // and height attributes, and they must keep matching the viewBox or the
                            // exported map would be cropped on a narrow screen.
                            width={CIRCULAR_SIZE}
                            height={CIRCULAR_SIZE}
                            viewBox={`0 0 ${CIRCULAR_SIZE} ${CIRCULAR_SIZE}`}
                            style={{ width: '100%', maxWidth: CIRCULAR_SIZE, height: 'auto' }}
                        >
                            <CircularBackbone
                                radius={270}
                                cx={320}
                                cy={320}
                                totalLength={plasmid.length}
                                selectedFeatureId={selectedFeatureId}
                                onFeatureClick={selectFeature}
                                tracks={visibleTracks.map(t => ({
                                    id: t.id,
                                    name: t.plasmid.name,
                                    length: t.plasmid.length,
                                    features: t.plasmid.features,
                                }))}
                            />
                        </svg>
                    </Box>
                )}
            </Box>

            {viewMode === "linear" && (
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    {[
                        ["← →", "pan"],
                        ["+ −", "zoom"],
                        ["0", "fit"],
                        ["n / p", "next / previous feature"],
                        ["Esc", "clear selection"],
                    ].map(([keys, what]) => (
                        <Chip key={keys} size="sm" variant="soft" color="neutral">
                            <Typography level="body-xs" sx={{ fontFamily: 'code' }}>{keys}</Typography>
                            <Typography level="body-xs" sx={{ ml: 0.5, color: 'text.tertiary' }}>{what}</Typography>
                        </Chip>
                    ))}
                </Stack>
            )}
        </Box>
    );
}
