import Sheet from "@mui/joy/Sheet";
import Box from "@mui/joy/Box";
import Input from "@mui/joy/Input";
import IconButton from "@mui/joy/IconButton";
import Typography from "@mui/joy/Typography";
import Chip from "@mui/joy/Chip";
import type { Track } from "../state/viewerState";

interface TrackPanelProps {
    tracks: Track[];
    setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
}

// The first track is the reference — it defines the coordinate system and every other track is
// diffed against it — so reordering here is meaningful: moving a track to the top makes it the
// new reference (FR-19).
export function TrackPanel({ tracks, setTracks }: TrackPanelProps) {
    const rename = (id: string, name: string) =>
        setTracks(prev => prev.map(t => (t.id === id ? { ...t, plasmid: { ...t.plasmid, name } } : t)));

    const toggle = (id: string) =>
        setTracks(prev => prev.map(t => (t.id === id ? { ...t, isVisible: !t.isVisible } : t)));

    const remove = (id: string) =>
        setTracks(prev => prev.filter(t => t.id !== id));

    const move = (index: number, delta: -1 | 1) =>
        setTracks(prev => {
            const j = index + delta;
            if (j < 0 || j >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[j]] = [next[j], next[index]];
            return next;
        });

    return (
        <Sheet variant="outlined" sx={{ p: 1.5, borderRadius: 'md' }}>
            <Typography level="title-sm" sx={{ mb: 1 }}>
                Tracks ({tracks.length})
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {tracks.map((track, i) => (
                    <Box
                        key={track.id}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: track.isVisible ? 1 : 0.45 }}
                    >
                        <IconButton
                            size="sm"
                            variant="plain"
                            color="neutral"
                            onClick={() => toggle(track.id)}
                            aria-label={track.isVisible ? `Hide ${track.plasmid.name}` : `Show ${track.plasmid.name}`}
                            title={track.isVisible ? "Hide track" : "Show track"}
                        >
                            {track.isVisible ? "●" : "○"}
                        </IconButton>

                        <Input
                            size="sm"
                            value={track.plasmid.name}
                            onChange={(e) => rename(track.id, e.target.value)}
                            sx={{ flex: 1, minWidth: 120 }}
                            slotProps={{ input: { 'aria-label': 'Track name' } }}
                        />

                        <Typography
                            level="body-xs"
                            sx={{ fontFamily: 'code', color: 'text.tertiary', whiteSpace: 'nowrap' }}
                        >
                            {track.plasmid.length} bp
                        </Typography>

                        <Chip size="sm" variant="soft" color={i === 0 ? "primary" : "neutral"}>
                            {i === 0 ? "reference" : track.plasmid.topology}
                        </Chip>

                        <IconButton
                            size="sm"
                            variant="plain"
                            color="neutral"
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                            aria-label={`Move ${track.plasmid.name} up`}
                            title="Move up"
                        >
                            ▲
                        </IconButton>
                        <IconButton
                            size="sm"
                            variant="plain"
                            color="neutral"
                            disabled={i === tracks.length - 1}
                            onClick={() => move(i, 1)}
                            aria-label={`Move ${track.plasmid.name} down`}
                            title="Move down"
                        >
                            ▼
                        </IconButton>
                        <IconButton
                            size="sm"
                            variant="plain"
                            color="danger"
                            onClick={() => remove(track.id)}
                            aria-label={`Remove ${track.plasmid.name}`}
                            title="Remove track"
                        >
                            ✕
                        </IconButton>
                    </Box>
                ))}
            </Box>
        </Sheet>
    );
}
