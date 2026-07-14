const CSS_VAR = /var\((--[\w-]+)\)/g;

/**
 * Resolves `var(--joy-palette-…)` references against the live document.
 *
 * A standalone SVG has no Joy theme and no CSS custom properties, so every var() left in the
 * markup would render as nothing. They are baked to concrete colors at export time, which is
 * also what makes the export honor the current light/dark scheme.
 */
function resolveCssVars(markup: string, contextEl: Element): string {
    const style = getComputedStyle(contextEl);
    const cache = new Map<string, string>();

    return markup.replace(CSS_VAR, (whole, name: string) => {
        if (!cache.has(name)) cache.set(name, style.getPropertyValue(name).trim());
        return cache.get(name) || whole;
    });
}

// @fontsource ships one file per unicode subset. Only the latin ones are worth embedding —
// pulling in cyrillic/greek/vietnamese would multiply the file size for glyphs a plasmid map
// will never contain.
const LATIN_SUBSET = /-latin-\d/;
const MAX_FONT_BYTES = 400_000;

async function buildFontFaceCss(families: string[]): Promise<string> {
    const faces: string[] = [];
    let budget = MAX_FONT_BYTES;

    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue; // cross-origin stylesheet; nothing we can read
        }

        for (const rule of Array.from(rules)) {
            if (!(rule instanceof CSSFontFaceRule)) continue;

            const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
            if (!families.includes(family)) continue;

            const url = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"))?.[1];
            if (!url || !LATIN_SUBSET.test(url)) continue;

            try {
                const blob = await (await fetch(url)).blob();
                if (blob.size > budget) continue;
                budget -= blob.size;

                const dataUri = await blobToDataUri(blob);
                faces.push(
                    `@font-face{font-family:'${family}';font-style:${rule.style.getPropertyValue("font-style") || "normal"};` +
                    `font-weight:${rule.style.getPropertyValue("font-weight") || "400"};src:url(${dataUri}) format('woff2');}`
                );
            } catch {
                // A font that will not load is not worth failing the export over — the text
                // simply falls back to a generic family.
            }
        }
    }

    return faces.join("");
}

function blobToDataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read font"));
        reader.readAsDataURL(blob);
    });
}

export interface SvgExportOptions {
    background: string;
    /** Embedding fonts makes the file self-contained; skipping it keeps it small. */
    embedFonts?: boolean;
}

/** Serializes a live SVG element into a standalone, self-contained SVG document. */
export async function buildStandaloneSvg(
    source: SVGSVGElement,
    { background, embedFonts = true }: SvgExportOptions,
): Promise<string> {
    const width = Number(source.getAttribute("width")) || source.getBoundingClientRect().width;
    const height = Number(source.getAttribute("height")) || source.getBoundingClientRect().height;

    const clone = source.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const backdrop = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    backdrop.setAttribute("width", "100%");
    backdrop.setAttribute("height", "100%");
    backdrop.setAttribute("fill", background);
    clone.insertBefore(backdrop, clone.firstChild);

    if (embedFonts) {
        const css = await buildFontFaceCss(["Inter", "Roboto Mono"]);
        if (css) {
            const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
            styleEl.textContent = css;
            clone.insertBefore(styleEl, clone.firstChild);
        }
    }

    const markup = new XMLSerializer().serializeToString(clone);
    return resolveCssVars(markup, source);
}

function download(href: string, filename: string) {
    const link = document.createElement("a");
    link.download = filename;
    link.href = href;
    link.click();
}

export async function exportSvg(source: SVGSVGElement, filename: string, options: SvgExportOptions) {
    const markup = await buildStandaloneSvg(source, options);
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    try {
        download(url, filename);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Rasterizes the map to PNG by drawing our own SVG onto a canvas.
 *
 * This deliberately does not use html-to-image: that library resolves inside a
 * requestAnimationFrame, which Chrome never fires in a background tab, so an export started
 * and then tabbed away from would hang forever. Image.onload has no such dependency.
 */
export async function exportPng(
    source: SVGSVGElement,
    filename: string,
    options: SvgExportOptions & { scale: number },
) {
    const markup = await buildStandaloneSvg(source, options);
    const width = Number(source.getAttribute("width")) || source.getBoundingClientRect().width;
    const height = Number(source.getAttribute("height")) || source.getBoundingClientRect().height;

    const svgUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));

    try {
        const image = await loadImage(svgUrl);

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * options.scale);
        canvas.height = Math.round(height * options.scale);

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not get a 2D canvas context");

        ctx.setTransform(options.scale, 0, 0, options.scale, 0, 0);
        ctx.drawImage(image, 0, 0, width, height);

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Could not encode the PNG");

        const pngUrl = URL.createObjectURL(blob);
        try {
            download(pngUrl, filename);
        } finally {
            URL.revokeObjectURL(pngUrl);
        }
    } finally {
        URL.revokeObjectURL(svgUrl);
    }
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not rasterize the map"));
        image.src = url;
    });
}
