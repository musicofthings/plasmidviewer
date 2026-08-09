import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Sheet from "@mui/joy/Sheet";
import Typography from "@mui/joy/Typography";
import Chip from "@mui/joy/Chip";

// The diagrams are committed SVG rather than JSX so they stay editable as drawings, and they are
// painted in Joy palette tokens rather than fixed hues, so they follow the light/dark toggle.
// Inlining them (rather than <img>) is what lets those tokens resolve at all.
import pipeline from "../assets/diagrams/pipeline.svg?raw";
import primerAnneal from "../assets/diagrams/primer-anneal.svg?raw";
import dependencies from "../assets/diagrams/dependencies.svg?raw";

interface HowItWorksProps {
    onBack: () => void;
}

function Figure({ svg, caption }: { svg: string; caption: string }) {
    return (
        <Box component="figure" sx={{ m: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Sheet
                variant="soft"
                sx={{
                    p: 1.5,
                    borderRadius: 'md',
                    overflowX: 'auto',
                    // The drawings are laid out on a fixed grid; below this they stop being
                    // legible, so they scroll rather than squash.
                    '& svg': { display: 'block', width: '100%', minWidth: 760, height: 'auto' },
                }}
                dangerouslySetInnerHTML={{ __html: svg }}
            />
            <Typography component="figcaption" level="body-xs" sx={{ color: 'text.tertiary', maxWidth: '80ch' }}>
                {caption}
            </Typography>
        </Box>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography level="h4" component="h2">{title}</Typography>
            {children}
        </Box>
    );
}

function Prose({ children }: { children: React.ReactNode }) {
    return (
        <Typography level="body-md" sx={{ maxWidth: '72ch', color: 'text.secondary' }}>
            {children}
        </Typography>
    );
}

export function HowItWorks({ onBack }: HowItWorksProps) {
    return (
        <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.body' }}>
            <Box sx={{ maxWidth: 1060, mx: 'auto', p: { xs: 2, md: 4 }, display: 'flex', flexDirection: 'column', gap: 5 }}>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Typography level="h2" component="h1" sx={{ fontWeight: 800 }}>
                            How it works
                        </Typography>
                        <Button variant="outlined" color="neutral" onClick={onBack}>
                            ← Back to the viewer
                        </Button>
                    </Box>
                    <Prose>
                        Everything on this page happens in your browser. Your sequence is never uploaded,
                        there is no server to send it to, and no account to create — the app is a static
                        page, and the only thing it stores is a copy of your own session in the browser's
                        own database so it comes back on reload.
                    </Prose>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
                        {["No upload", "No account", "No backend", "Works offline once loaded"].map(claim => (
                            <Chip key={claim} size="sm" variant="soft" color="primary">{claim}</Chip>
                        ))}
                    </Box>
                </Box>

                <Section title="What happens when you open a file">
                    <Prose>
                        A FASTA, GenBank or SnapGene file is parsed into one plain object — the sequence,
                        its features, and whether it is circular. Coordinates are converted to 1-based
                        inclusive numbering exactly once, at the parser boundary, which is why a feature's
                        start and end read the same here as they do in the source file.
                    </Prose>
                    <Prose>
                        That object is then <em>read-only</em>. Search, restriction digestion, primer
                        matching and track comparison are separate engines that each read it and produce
                        their own layer of the map; none of them modifies it. Four of those layers are
                        drawn onto a single SVG, which is why exporting a picture is exact rather than a
                        screenshot — the file you download is the same drawing you are looking at.
                    </Prose>
                    <Figure
                        svg={pipeline}
                        caption="Layers are drawn in a fixed order: search highlights sit under the glyphs they mark, while cut ticks and primer arrows sit in bands above the ruler. A band only takes up space when something is actually shown."
                    />
                </Section>

                <Section title="How restriction sites are found">
                    <Prose>
                        Enzymes come from REBASE, the reference database of restriction enzymes — 722 of
                        them, every one with a known recognition sequence <em>and</em> a known cut
                        position. Roughly 350 further entries are deliberately left out: their site is
                        predicted but their cut position is not, and drawing a cut mark for a cut nobody
                        has measured would be worse than showing nothing.
                    </Prose>
                    <Prose>
                        Two details are easy to get wrong and are handled explicitly. A Type IIS enzyme
                        such as BsaI cuts <em>outside</em> its own recognition site, so cut positions are
                        allowed to fall before or after the site rather than being clamped to it. And on a
                        circular construct the search continues past the origin and back to base 1, so a
                        site straddling position 1 is found — the usual reason a site appears to go
                        missing in tools that treat every sequence as linear.
                    </Prose>
                    <Prose>
                        A palindromic site is reported once, not once per strand. Reporting it twice is
                        the classic way a fragment count silently doubles.
                    </Prose>
                </Section>

                <Section title="How primers are matched, and what the Tm means">
                    <Prose>
                        A primer is not simply a piece of your construct. A cloning primer usually carries
                        a 5′ tail — a restriction site, an overlap for assembly, a tag — that pairs with
                        nothing at all. Searching for the whole oligo would therefore find it nowhere.
                    </Prose>
                    <Prose>
                        Instead the match starts at the 3′ end, because that is the end a polymerase
                        extends from, and runs backwards until it stops matching. What gets reported is
                        the part that actually anneals, plus how much of the oligo hung off the front. The
                        3′-most bases must pair exactly however tolerant the rest of the match is: a
                        primer mismatched at its final base does not prime.
                    </Prose>
                    <Figure
                        svg={primerAnneal}
                        caption="A reverse primer mirrors this — its 3′ end sits at the lower coordinate and it extends leftward, which is why the arrowheads on the map point toward each other for a usable primer pair."
                    />
                    <Prose>
                        Melting temperature is nearest-neighbour, using the standard published parameters,
                        with corrections for salt and for oligos that fold back on themselves. It is
                        quoted for the annealing region rather than the whole oligo, because a tail that
                        pairs with nothing does not raise the temperature you should anneal at — at least
                        not in the first cycle.
                    </Prose>
                    <Sheet variant="soft" color="warning" sx={{ p: 1.5, borderRadius: 'md', maxWidth: '72ch' }}>
                        <Typography level="body-sm">
                            Defaults are 0.25 µM primer and 50 mM Na⁺ — an ordinary reaction. Magnesium and
                            dNTP chelation are <strong>not</strong> modelled, so a Mg²⁺-heavy buffer will
                            run a few degrees warmer than the number shown. Mismatches are not
                            thermodynamically penalised either, so a mismatched site reads slightly high.
                        </Typography>
                    </Sheet>
                </Section>

                <Section title="What it does not do">
                    <Prose>
                        Being clear about the edges is more useful than a longer feature list:
                    </Prose>
                    <Box component="ul" sx={{ pl: 3, m: 0, maxWidth: '72ch', display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Typography component="li" level="body-md" sx={{ color: 'text.secondary' }}>
                            <strong>Sequences cannot be edited.</strong> This is a viewer and an analysis
                            tool; nothing you do here changes the construct.
                        </Typography>
                        <Typography component="li" level="body-md" sx={{ color: 'text.secondary' }}>
                            <strong>Track comparison is a difference, not an alignment.</strong> It finds
                            where two sequences disagree, quickly and exactly, but it has no scoring
                            matrix and no gap penalties — do not read it as a biological alignment.
                        </Typography>
                        <Typography component="li" level="body-md" sx={{ color: 'text.secondary' }}>
                            <strong>Translation is the standard genetic code only</strong>, and the
                            sequence view shows three forward frames. Searching a peptide does use all
                            six.
                        </Typography>
                        <Typography component="li" level="body-md" sx={{ color: 'text.secondary' }}>
                            <strong>Features are whatever the file said.</strong> Nothing is annotated
                            automatically, so an unannotated file stays unannotated.
                        </Typography>
                    </Box>
                </Section>

                <Section title="What is here, and what is next">
                    <Prose>
                        Simulated cloning — Gibson, Golden Gate, restriction cloning and the rest — all
                        produce a <em>new</em> construct from an old one, and that is precisely what a
                        read-only model cannot represent. So the work below the line is one structural
                        change that everything else waits on, rather than six independent features.
                    </Prose>
                    <Figure
                        svg={dependencies}
                        caption="Above the line the work is ordinary: PCR simulation is the last piece between here and a simulated agarose gel. Below it, nothing ships until an editable document exists."
                    />
                </Section>

                <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2, pb: 4 }}>
                    <Typography level="body-xs" sx={{ color: 'text.tertiary', maxWidth: '80ch' }}>
                        Enzyme data: REBASE — the Restriction Enzyme Database, © Dr Richard J. Roberts,
                        used with attribution. Melting temperatures follow SantaLucia's unified
                        nearest-neighbour parameters (PNAS, 1998).
                    </Typography>
                    <Button variant="outlined" color="neutral" onClick={onBack} sx={{ mt: 2 }}>
                        ← Back to the viewer
                    </Button>
                </Box>

            </Box>
        </Box>
    );
}
