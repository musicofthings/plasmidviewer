import { useState, useEffect } from "react";
import { CssVarsProvider, extendTheme, useColorScheme } from "@mui/joy/styles";
import CssBaseline from "@mui/joy/CssBaseline";
import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import Button from "@mui/joy/Button";
import IconButton from "@mui/joy/IconButton";
import Sheet from "@mui/joy/Sheet";
import type { Plasmid } from "./models/plasmid";
import { parseFasta } from "./parsers/fasta";
import { parseSnapGene } from "./parsers/snapgene";
import { parseGenBank } from "./parsers/genbank";
import { PlasmidViewer } from "./components/PlasmidViewer";
import { LibrarySidebar } from "./components/LibrarySidebar";
import type { Track } from "./state/viewerState";
import { useLibrary } from "./state/useLibrary";
import type { NodeLevel, SequenceRecord } from "./models/library";
import { nodePath } from "./utils/libraryTree";
import { loadSession, saveSession, clearSession } from "./utils/persistence";
import { findNonStandardBases, describeNonStandardBases } from "./utils/sequence";

const theme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
        background: {
          body: "#ffffff",
          surface: "#fbfbfb",
        },
        primary: {
          50: "#f0fdf4",
          100: "#dcfce7",
          500: "#7cba01",
          600: "#659b01",
        },
        neutral: {
          100: "#f5f5f5",
          200: "#e5e5e5",
          500: "#757575",
          800: "#1a1a1a",
        },
        danger: {
          500: "#e53935",
        },
      },
    },
    dark: {
      palette: {
        background: {
          body: "#141414",
          surface: "#1e1e1e",
        },
        // Only the hue tokens the SVG layers read are overridden here. The neutral scale is
        // deliberately left to Joy: in dark mode it is *inverted* (text.primary resolves to
        // neutral.100), so overriding it with light-mode-shaped values makes text unreadable.
        primary: {
          500: "#8fd104",
          600: "#a5e01e",
        },
        danger: {
          500: "#ff6b66",
        },
      },
    },
  },
  fontFamily: {
    body: "'Inter', sans-serif",
    display: "'Inter', sans-serif",
    code: "'Roboto Mono', monospace",
  },
});

function ModeToggle() {
  const { mode, setMode } = useColorScheme();
  return (
    <IconButton
      variant="outlined"
      color="neutral"
      onClick={() => setMode(mode === "dark" ? "light" : "dark")}
      aria-label="Toggle dark mode"
      title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {mode === "dark" ? "☀" : "☾"}
    </IconButton>
  );
}

// Long enough that dragging a track's alignment does not write to IndexedDB on every frame.
const SAVE_DEBOUNCE_MS = 400;

function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [viewMode, setViewMode] = useState<"linear" | "circular">("linear");
  const [error, setError] = useState<string | null>(null);
  // A non-blocking notice (e.g. non-standard bases): the track still loads (FR-3).
  const [warning, setWarning] = useState<string | null>(null);
  // Nothing may be written back until the restore has settled, or the empty initial state
  // would overwrite the very session we are about to load (FR-26).
  const [restored, setRestored] = useState(false);

  const library = useLibrary();
  // The library sequence shown in the viewer (highlighted in the tree), and the tree node
  // selected as the target for "Save to Library".
  const [openSequenceId, setOpenSequenceId] = useState<string | undefined>(undefined);
  const [selectedNode, setSelectedNode] = useState<{ level: NodeLevel; id: string } | null>(null);
  const [sourceName, setSourceName] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    loadSession()
      .then(session => {
        if (cancelled || !session) return;
        setTracks(session.tracks);
        setViewMode(session.viewMode);
        setOpenSequenceId(session.openSequenceId);
      })
      .catch(() => {
        // A session we cannot read is not worth an error banner — the app simply opens empty.
      })
      .finally(() => {
        if (!cancelled) setRestored(true);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!restored) return;

    const timer = setTimeout(() => {
      const write = tracks.length === 0
        ? clearSession()
        : saveSession({ tracks, viewMode, openSequenceId });
      write.catch(() => setError("Could not save this session for next time"));
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [tracks, viewMode, openSequenceId, restored]);

  // Keep the tree selection consistent with what still exists after a delete.
  useEffect(() => {
    if (!library.loaded) return;
    if (openSequenceId && !library.data.sequences.some(s => s.id === openSequenceId)) {
      setOpenSequenceId(undefined);
    }
    if (selectedNode) {
      const stores = [library.data.workspaces, library.data.projects, library.data.experiments,
        library.data.samples, library.data.sequences];
      if (!stores.some(list => list.some(n => n.id === selectedNode.id))) setSelectedNode(null);
    }
  }, [library.loaded, library.data, openSequenceId, selectedNode]);

  const loadPlasmid = (p: Plasmid, append: boolean) => {
    const newTrack: Track = {
      id: crypto.randomUUID(),
      plasmid: p,
      offsetBp: 0,
      color: !append ? "primary" : "neutral",
      isVisible: true,
    };
    if (!append) setViewMode(p.topology === "circular" ? "circular" : "linear");
    setTracks(prev => append ? [...prev, newTrack] : [newTrack]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setWarning(null);
    try {
      let p: Plasmid;
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".dna")) {
        p = await parseSnapGene(file);
      } else if (lowerName.endsWith(".gb") || lowerName.endsWith(".gbk")) {
        p = await parseGenBank(file);
      } else {
        p = parseFasta(await file.text());
      }

      if (p.length === 0) throw new Error(`${file.name} contains no sequence`);

      const nonStandard = describeNonStandardBases(findNonStandardBases(p.sequence));
      if (nonStandard) {
        setWarning(`${file.name}: contains ${nonStandard}. These are shown in grey and ignored in GC% and translation.`);
      }

      const append = tracks.length > 0;
      // A freshly uploaded construct is transient until saved; adding it clears the "open
      // library sequence" mark so the tree highlight does not lie.
      if (!append) { setOpenSequenceId(undefined); setSourceName(file.name); }
      loadPlasmid(p, append);
      e.target.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    }
  };

  const openSequence = (seq: SequenceRecord) => {
    setError(null);
    setWarning(null);
    setSourceName(seq.sourceName);
    setOpenSequenceId(seq.id);
    loadPlasmid(seq.plasmid, false);
  };

  const saveTargetSampleId = selectedNode?.level === "sample" ? selectedNode.id : null;

  const handleSaveToLibrary = async () => {
    if (!saveTargetSampleId || tracks.length === 0) return;
    const plasmid = tracks[0].plasmid;
    try {
      const seq = await library.saveSequence(saveTargetSampleId, plasmid.name, plasmid, sourceName);
      setOpenSequenceId(seq.id);
      const sampleName = library.data.samples.find(s => s.id === saveTargetSampleId)?.name ?? "sample";
      setWarning(`Saved “${plasmid.name}” to ${sampleName}.`);
    } catch {
      setError("Could not save this sequence to the library");
    }
  };

  const breadcrumb = openSequenceId
    ? nodePath(library.data, "sequence", openSequenceId).map(p => p.node.name).join(" / ")
    : null;

  return (
    <CssVarsProvider theme={theme} defaultMode="light" modeStorageKey="plasmidviewer-mode">
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.body' }}>
        <Box sx={{ width: 300, flexShrink: 0, height: '100%', bgcolor: 'background.surface', borderRight: '1px solid', borderColor: 'divider' }}>
          <LibrarySidebar
            library={library}
            openSequenceId={openSequenceId}
            selectedNode={selectedNode}
            onSelectNode={(level, id) => setSelectedNode({ level, id })}
            onOpenSequence={openSequence}
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography level="h3" component="h1" sx={{ fontWeight: 800 }}>
                Plasmid Viewer
              </Typography>
              <Typography level="body-sm" sx={{ color: 'neutral.500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {breadcrumb ?? "Multi-Track Alignment & Visualization"}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0 }}>
              <ModeToggle />
              <Button
                variant="outlined"
                color="primary"
                disabled={tracks.length === 0 || !saveTargetSampleId}
                onClick={handleSaveToLibrary}
                title={saveTargetSampleId
                  ? "Save the reference sequence into the selected sample"
                  : "Select a sample in the library first"}
              >
                Save to Library
              </Button>
              {tracks.length > 0 && (
                <Button variant="outlined" color="danger" onClick={() => { setTracks([]); setError(null); setWarning(null); setOpenSequenceId(undefined); }}>
                  Clear All
                </Button>
              )}
              <Button component="label" variant="solid" color="primary">
                {tracks.length === 0 ? "Open File" : "Add Track"}
                <input type="file" hidden onChange={handleFileUpload} accept=".fasta,.fa,.txt,.dna,.gb,.gbk" />
              </Button>
            </Box>
          </Box>

          {error && <Typography color="danger" level="body-sm">{error}</Typography>}
          {warning && <Typography color="warning" level="body-sm">{warning}</Typography>}

          {tracks.length === 0 ? (
            <Sheet
              variant="outlined"
              sx={{
                p: 10,
                borderRadius: 'md',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                borderStyle: 'dashed',
              }}
            >
              <Typography level="h4">Open a sequence</Typography>
              <Typography level="body-md">
                Pick a sequence from the library on the left, or upload a FASTA, GenBank, or SnapGene file.
              </Typography>
              <Button component="label" size="lg" sx={{ mt: 2 }}>
                Select File
                <input type="file" hidden onChange={handleFileUpload} accept=".fasta,.fa,.txt,.dna,.gb,.gbk" />
              </Button>
            </Sheet>
          ) : (
            <PlasmidViewer
              tracks={tracks}
              setTracks={setTracks}
              viewMode={viewMode}
              setViewMode={setViewMode}
            />
          )}
        </Box>
      </Box>
    </CssVarsProvider>
  );
}

export default App;
