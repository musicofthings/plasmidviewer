import { useEffect, useState } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import IconButton from "@mui/joy/IconButton";
import Input from "@mui/joy/Input";
import Typography from "@mui/joy/Typography";
import type { NodeLevel, LibraryNode, SequenceRecord } from "../models/library";
import { CHILD_LEVEL, LEVEL_LABEL } from "../models/library";
import { childrenOf, defaultChildName, nodesAtLevel, nodePath } from "../utils/libraryTree";
import type { Library } from "../state/useLibrary";

const ICON: Record<NodeLevel, string> = {
    workspace: "🗂", project: "📁", experiment: "⚗", sample: "🧪", sequence: "🧬",
};

interface LibrarySidebarProps {
    library: Library;
    openSequenceId?: string;
    selectedNode: { level: NodeLevel; id: string } | null;
    onSelectNode: (level: NodeLevel, id: string) => void;
    onOpenSequence: (seq: SequenceRecord) => void;
}

export function LibrarySidebar({
    library, openSequenceId, selectedNode, onSelectNode, onOpenSequence,
}: LibrarySidebarProps) {
    const { data } = library;
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const toggle = (id: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const expand = (id: string) => setExpanded(prev => new Set(prev).add(id));

    // When a sequence is open (e.g. restored on reload), reveal it by expanding its ancestors.
    useEffect(() => {
        if (!openSequenceId) return;
        const path = nodePath(data, "sequence", openSequenceId);
        if (path.length === 0) return;
        // Genuinely reactive: the path only resolves once the library finishes loading from
        // IndexedDB, which happens *after* a restored openSequenceId is set — so this must key
        // on `data`, not just run once during render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setExpanded(prev => {
            const next = new Set(prev);
            for (const step of path) next.add(step.node.id);
            return next;
        });
    }, [openSequenceId, data]);

    const startEdit = (node: LibraryNode) => { setEditingId(node.id); setEditValue(node.name); };
    const commitEdit = async (level: NodeLevel, node: LibraryNode) => {
        const name = editValue.trim();
        setEditingId(null);
        if (name && name !== node.name) await library.rename(level, node, name);
    };

    const addChild = async (level: NodeLevel, node: LibraryNode) => {
        const childLevel = CHILD_LEVEL[level];
        if (!childLevel) return;
        const siblings = childrenOf(data, level, node.id);
        const child = await library.create(childLevel, node.id, defaultChildName(siblings, LEVEL_LABEL[childLevel]));
        expand(node.id);
        startEdit(child);
    };

    const addWorkspace = async () => {
        const ws = await library.create(
            "workspace", null, defaultChildName(data.workspaces, "Workspace"),
        );
        startEdit(ws);
    };

    function renderNode(level: NodeLevel, node: LibraryNode, depth: number) {
        const childLevel = CHILD_LEVEL[level];
        const children = childrenOf(data, level, node.id);
        const isOpen = expanded.has(node.id);
        const isSequence = level === "sequence";
        const isSelected = isSequence
            ? node.id === openSequenceId
            : selectedNode?.id === node.id;
        const isEditing = editingId === node.id;
        const isConfirming = confirmDeleteId === node.id;

        const rowClick = () => {
            if (isSequence) {
                onOpenSequence(node as SequenceRecord);
            } else {
                onSelectNode(level, node.id);
                expand(node.id);
            }
        };

        return (
            <Box key={node.id}>
                <Box
                    sx={{
                        display: 'flex', alignItems: 'center', gap: 0.25,
                        pl: `${depth * 14 + 4}px`, pr: 0.5, py: '2px', borderRadius: 'sm',
                        cursor: 'pointer', minHeight: 28,
                        bgcolor: isSelected ? 'primary.softBg' : 'transparent',
                        '&:hover': { bgcolor: isSelected ? 'primary.softBg' : 'neutral.softBg' },
                        '&:hover .row-actions': { opacity: 1 },
                    }}
                >
                    <IconButton
                        size="sm" variant="plain" color="neutral"
                        onClick={(e) => { e.stopPropagation(); if (childLevel) toggle(node.id); }}
                        sx={{ minWidth: 18, minHeight: 18, visibility: childLevel ? 'visible' : 'hidden' }}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                        {isOpen ? "▾" : "▸"}
                    </IconButton>

                    <Typography component="span" sx={{ fontSize: 14, lineHeight: 1, width: 18, textAlign: 'center' }}>
                        {ICON[level]}
                    </Typography>

                    {isEditing ? (
                        <Input
                            size="sm"
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(level, node)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit(level, node);
                                else if (e.key === "Escape") setEditingId(null);
                            }}
                            sx={{ flex: 1, minHeight: 24, '--Input-minHeight': '24px' }}
                            slotProps={{ input: { 'aria-label': `${LEVEL_LABEL[level]} name` } }}
                        />
                    ) : (
                        <Typography
                            level="body-sm"
                            onClick={rowClick}
                            onDoubleClick={() => startEdit(node)}
                            sx={{
                                flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                fontWeight: isSelected ? 600 : 400,
                            }}
                            title={node.name}
                        >
                            {node.name}
                        </Typography>
                    )}

                    {isConfirming ? (
                        <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center' }}>
                            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>Delete?</Typography>
                            <IconButton
                                size="sm" variant="plain" color="danger"
                                aria-label={`Confirm delete ${node.name}`}
                                onClick={async (e) => { e.stopPropagation(); setConfirmDeleteId(null); await library.remove(level, node.id); }}
                            >✓</IconButton>
                            <IconButton
                                size="sm" variant="plain" color="neutral"
                                aria-label="Cancel delete"
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            >✕</IconButton>
                        </Box>
                    ) : !isEditing && (
                        <Box className="row-actions" sx={{ display: 'flex', gap: 0, opacity: 0, transition: 'opacity 0.15s' }}>
                            {childLevel && (
                                <IconButton
                                    size="sm" variant="plain" color="neutral"
                                    aria-label={`Add ${LEVEL_LABEL[childLevel]} to ${node.name}`}
                                    title={`Add ${LEVEL_LABEL[childLevel]}`}
                                    onClick={(e) => { e.stopPropagation(); addChild(level, node); }}
                                >＋</IconButton>
                            )}
                            <IconButton
                                size="sm" variant="plain" color="neutral"
                                aria-label={`Rename ${node.name}`} title="Rename"
                                onClick={(e) => { e.stopPropagation(); startEdit(node); }}
                            >✎</IconButton>
                            <IconButton
                                size="sm" variant="plain" color="neutral"
                                aria-label={`Delete ${node.name}`} title="Delete"
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(node.id); }}
                            >🗑</IconButton>
                        </Box>
                    )}
                </Box>

                {isOpen && childLevel && children.map(child => renderNode(childLevel, child, depth + 1))}
            </Box>
        );
    }

    const workspaces = nodesAtLevel(data, "workspace").slice().sort((a, b) => a.name.localeCompare(b.name));

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography level="title-sm">Library</Typography>
                <Button size="sm" variant="soft" color="primary" onClick={addWorkspace}>＋ Workspace</Button>
            </Box>

            <Box sx={{ flex: 1, overflowY: 'auto', p: 0.5 }}>
                {workspaces.length === 0 ? (
                    <Typography level="body-xs" sx={{ color: 'text.tertiary', p: 1 }}>
                        No workspaces yet. Create one to start organizing projects, experiments,
                        samples, and sequences.
                    </Typography>
                ) : (
                    workspaces.map(ws => renderNode("workspace", ws, 0))
                )}
            </Box>
        </Box>
    );
}
