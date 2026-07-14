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
import type { Track } from "./state/viewerState";
import { loadSession, saveSession, clearSession } from "./utils/persistence";

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
  // Nothing may be written back until the restore has settled, or the empty initial state
  // would overwrite the very session we are about to load (FR-26).
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadSession()
      .then(session => {
        if (cancelled || !session) return;
        setTracks(session.tracks);
        setViewMode(session.viewMode);
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
        : saveSession({ tracks, viewMode });
      write.catch(() => setError("Could not save this session for next time"));
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [tracks, viewMode, restored]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
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

      const newTrack: Track = {
        id: crypto.randomUUID(),
        plasmid: p,
        offsetBp: 0,
        color: tracks.length === 0 ? "primary" : "neutral",
        isVisible: true,
      };

      setTracks(prev => [...prev, newTrack]);
      e.target.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    }
  };

  return (
    <CssVarsProvider theme={theme} defaultMode="light" modeStorageKey="plasmidviewer-mode">
      <CssBaseline />
      <Box sx={{
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minHeight: '100vh',
        bgcolor: 'background.body',
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography level="h3" component="h1" sx={{ fontWeight: 800 }}>
              Plasmid Viewer
            </Typography>
            <Typography level="body-sm" sx={{ color: 'neutral.500' }}>
              Multi-Track Alignment &amp; Visualization
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <ModeToggle />
            {tracks.length > 0 && (
              <Button variant="outlined" color="danger" onClick={() => { setTracks([]); setError(null); }}>
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
            <Typography level="h4">Upload Plasmid Map</Typography>
            <Typography level="body-md">Support for FASTA, GenBank, and SnapGene</Typography>
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
    </CssVarsProvider>
  );
}

export default App;
