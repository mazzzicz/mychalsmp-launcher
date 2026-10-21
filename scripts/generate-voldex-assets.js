/**
 * Voldex Client & VoldexSMP Asset Generator (Voldex Studios)
 * Uses exact Monocraft glyph bitmaps from monocraft-characters.json
 * to render an elaborate 3D voxel Monocraft client icon, wordmark logo,
 * profile icons, and keyart derivatives.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoPkg = require('png-to-ico');
const pngToIco = pngToIcoPkg.default || pngToIcoPkg;

const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'src/renderer/assets');
const ICONS_DIR = path.join(ASSETS_DIR, 'icons');
const KEYARTS_DIR = path.join(ASSETS_DIR, 'keyarts');
const BUILD_DIR = path.join(ROOT, 'build');
const CHARS_PATH = path.join(ASSETS_DIR, 'fonts/monocraft-characters.json');

const monocraftChars = JSON.parse(fs.readFileSync(CHARS_PATH, 'utf8'));
const GLYPHS = {};
for (const entry of monocraftChars) {
    if (entry.character && Array.isArray(entry.pixels)) {
        GLYPHS[entry.character] = entry.pixels;
    }
}

function hash2D(x, y, seed = 1) {
    let n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
    return n - Math.floor(n);
}

/**
 * Generates an elaborate 512x512 Client Icon in the Monocraft font style:
 * - Chiseled Deepslate & Oxidized Copper octagonal-squircle crest with pixel-art stepped border
 * - Glowing prismarine/portal core matrix
 * - Central monumental 3D-extruded Monocraft 'V' glyph with 3x3 micro-voxel diamond/turquoise facets per glyph pixel
 * - Crisp Monocraft 'VOLDEX' pixel-art plate integrated at the base
 */
function buildMonocraftClientIconSvg() {
    const size = 512;
    let els = [];

    // 1. Background pixel texture inside the crest (32x32 voxel grid mapped to 432x432)
    const bgStart = 44;
    const bgSize = 424;
    const cell = bgSize / 32;
    let bgTiles = [];
    for (let gy = 0; gy < 32; gy++) {
        for (let gx = 0; gx < 32; gx++) {
            const dx = (gx - 15.5) / 16;
            const dy = (gy - 15.5) / 16;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const h = hash2D(gx, gy, 19);
            // Deep obsidian-prismarine subtle checkerboard
            const baseL = Math.max(4, Math.round(14 - dist * 8 + (h - 0.5) * 4));
            const r = Math.max(3, Math.round(baseL * 0.45));
            const g = Math.max(8, Math.round(baseL * 1.35));
            const b = Math.max(14, Math.round(baseL * 1.75));
            bgTiles.push(`<rect x="${(bgStart + gx * cell).toFixed(1)}" y="${(bgStart + gy * cell).toFixed(1)}" width="${(cell + 0.4).toFixed(1)}" height="${(cell + 0.4).toFixed(1)}" fill="rgb(${r},${g},${b})"/>`);

            // Subtle portal/circuit glow nodes near center
            if (dist > 0.35 && dist < 0.82 && h > 0.86) {
                const alpha = ((1 - dist) * 0.35).toFixed(2);
                bgTiles.push(`<rect x="${(bgStart + gx * cell).toFixed(1)}" y="${(bgStart + gy * cell).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="#00e5ff" opacity="${alpha}"/>`);
            }
        }
    }

    // 2. Stepped pixel-art inner energy ring (authentic voxel circle)
    const ringRadius = 11.5;
    for (let gy = 0; gy < 32; gy++) {
        for (let gx = 0; gx < 32; gx++) {
            const dx = gx - 15.5;
            const dy = gy - 14.0;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (Math.abs(d - ringRadius) < 0.75) {
                const isTop = dy < 0;
                const col = isTop ? '#22d3ee' : '#0d9488';
                bgTiles.push(`<rect x="${(bgStart + gx * cell).toFixed(1)}" y="${(bgStart + gy * cell).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${col}" opacity="0.28"/>`);
            }
        }
    }

    // 3. The iconic Monocraft 'V' (5 columns x 7 rows), scaled with 3x3 sub-voxels per Monocraft pixel
    // Total grid: 15x21 micro-voxels, each 14px => 210px wide x 294px tall
    const vMatrix = GLYPHS['V'];
    const pixelSize = 44; // Size of 1 Monocraft font pixel
    const subSize = pixelSize / 3;
    const vWidth = 5 * pixelSize; // 220
    const vHeight = 7 * pixelSize; // 308
    const vOriginX = (size - vWidth) / 2; // 146
    const vOriginY = 64; // Leaves room at bottom for VOLDEX Monocraft badge

    const hasPixel = (r, c) => (r >= 0 && r < 7 && c >= 0 && c < 5 && vMatrix[r][c] === 1);

    let shadowBlocks = [];
    let extrudeBlocks = [];
    let faceBlocks = [];
    let highlightBlocks = [];

    // Extrusion depth layers (down-right & straight-down for chunky 3D Minecraft block look)
    const maxDepth = 26;
    for (let d = maxDepth; d >= 1; d -= 2) {
        const t = d / maxDepth;
        const offX = Math.round(d * 0.45);
        const offY = d;
        const rCol = Math.round(4 + (1 - t) * 8);
        const gCol = Math.round(28 + (1 - t) * 68);
        const bCol = Math.round(42 + (1 - t) * 84);
        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 5; c++) {
                if (!hasPixel(r, c)) continue;
                const px = vOriginX + c * pixelSize;
                const py = vOriginY + r * pixelSize;
                extrudeBlocks.push(
                    `<rect x="${px + offX}" y="${py + offY}" width="${pixelSize}" height="${pixelSize}" fill="rgb(${rCol},${gCol},${bCol})"/>`
                );
            }
        }
    }

    // Drop shadow behind extrusion
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
            if (!hasPixel(r, c)) continue;
            const px = vOriginX + c * pixelSize;
            const py = vOriginY + r * pixelSize;
            shadowBlocks.push(
                `<rect x="${px + 14}" y="${py + 34}" width="${pixelSize + 4}" height="${pixelSize + 4}" fill="#000000" opacity="0.65"/>`
            );
        }
    }

    // Front face of Monocraft 'V': each font pixel is a 3x3 textured diamond/prismarine block
    const topPalette = ['#a5f3fc', '#67e8f9', '#22d3ee', '#38bdf8'];
    const midPalette = ['#22d3ee', '#06b6d4', '#0891b2', '#2dd4bf'];
    const botPalette = ['#14b8a6', '#0d9488', '#0891b2', '#0f766e'];

    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
            if (!hasPixel(r, c)) continue;
            const px = vOriginX + c * pixelSize;
            const py = vOriginY + r * pixelSize;

            // Dark outer voxel frame for crisp Monocraft pixel separation
            faceBlocks.push(
                `<rect x="${px - 2}" y="${py - 2}" width="${pixelSize + 4}" height="${pixelSize + 4}" fill="#042f2e"/>`
            );

            const pal = r <= 1 ? topPalette : (r <= 4 ? midPalette : botPalette);
            for (let sy = 0; sy < 3; sy++) {
                for (let sx = 0; sx < 3; sx++) {
                    const h = hash2D(c * 7 + sx, r * 11 + sy, 42);
                    let color = pal[Math.floor(h * pal.length) % pal.length];
                    // Inner core of each Monocraft block glows brighter like a Sea Lantern / Diamond core
                    if (sx === 1 && sy === 1) {
                        color = r <= 2 ? '#ecfeff' : '#67e8f9';
                    }
                    const bx = px + sx * subSize;
                    const by = py + sy * subSize;
                    faceBlocks.push(
                        `<rect x="${bx.toFixed(2)}" y="${by.toFixed(2)}" width="${(subSize + 0.35).toFixed(2)}" height="${(subSize + 0.35).toFixed(2)}" fill="${color}"/>`
                    );
                }
            }

            // Grid bevel inside each Monocraft pixel block
            faceBlocks.push(
                `<rect x="${px}" y="${py}" width="${pixelSize}" height="${pixelSize}" fill="none" stroke="#083344" stroke-width="1.5" opacity="0.55"/>`
            );

            // Top & Left specular bevels on exposed Monocraft edges
            if (!hasPixel(r - 1, c)) {
                highlightBlocks.push(
                    `<rect x="${px}" y="${py}" width="${pixelSize}" height="6" fill="#ecfeff" opacity="0.92"/>`
                );
            }
            if (!hasPixel(r, c - 1)) {
                highlightBlocks.push(
                    `<rect x="${px}" y="${py}" width="5" height="${pixelSize}" fill="#a5f3fc" opacity="0.75"/>`
                );
            }
            if (!hasPixel(r + 1, c)) {
                highlightBlocks.push(
                    `<rect x="${px}" y="${py + pixelSize - 5}" width="${pixelSize}" height="5" fill="#042f2e" opacity="0.7"/>`
                );
            }
        }
    }

    // 4. Bottom Monocraft wordplate "VOLDEX" rendered with exact Monocraft 5x7 glyphs
    const word = 'VOLDEX';
    const wDot = 6; // 6px per Monocraft pixel -> each char 30px wide, 6 chars * 30 + 5 * 6 = 210px
    const charW = 5 * wDot;
    const charGap = wDot;
    const totalWordW = word.length * charW + (word.length - 1) * charGap;
    const wordStartX = Math.round((size - totalWordW) / 2);
    const wordStartY = 408;

    let wordBlocks = [];
    // Plate behind VOLDEX text
    wordBlocks.push(
        `<rect x="${wordStartX - 22}" y="${wordStartY - 12}" width="${totalWordW + 44}" height="${7 * wDot + 24}" rx="6" fill="#050d14" stroke="#14b8a6" stroke-width="2.5"/>`,
        `<rect x="${wordStartX - 18}" y="${wordStartY - 8}" width="${totalWordW + 36}" height="3" fill="#22d3ee" opacity="0.45"/>`
    );

    for (let i = 0; i < word.length; i++) {
        const ch = word[i];
        const mat = GLYPHS[ch];
        if (!mat) continue;
        const cx = wordStartX + i * (charW + charGap);
        for (let r = 0; r < mat.length; r++) {
            for (let c = 0; c < mat[r].length; c++) {
                if (!mat[r][c]) continue;
                const dx = cx + c * wDot;
                const dy = wordStartY + r * wDot;
                // 3D shadow pixel
                wordBlocks.push(`<rect x="${dx + 2}" y="${dy + 3}" width="${wDot}" height="${wDot}" fill="#022c22"/>`);
                // Crisp Monocraft pixel
                const pCol = r < 2 ? '#ecfeff' : (r < 5 ? '#67e8f9' : '#2dd4bf');
                wordBlocks.push(`<rect x="${dx}" y="${dy}" width="${wDot}" height="${wDot}" fill="${pCol}"/>`);
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">
        <defs>
            <linearGradient id="frameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#22d3ee"/>
                <stop offset="50%" stop-color="#0d9488"/>
                <stop offset="100%" stop-color="#0f766e"/>
            </linearGradient>
            <clipPath id="innerClip">
                <rect x="44" y="44" width="424" height="424" rx="56"/>
            </clipPath>
        </defs>

        <!-- Outer dark obsidian base -->
        <rect x="16" y="16" width="480" height="480" rx="76" fill="#03080e"/>
        <!-- Metallic turquoise-prismarine rim -->
        <rect x="24" y="24" width="464" height="464" rx="68" fill="none" stroke="url(#frameGrad)" stroke-width="8"/>
        <!-- Chiseled dark inner bevel -->
        <rect x="34" y="34" width="444" height="444" rx="62" fill="#061019" stroke="#115e59" stroke-width="4"/>

        <!-- Voxel interior -->
        <g clip-path="url(#innerClip)">
            ${bgTiles.join('\n')}
        </g>

        <!-- Corner Monocraft voxel rivets -->
        <rect x="52" y="52" width="16" height="16" fill="#22d3ee"/>
        <rect x="56" y="56" width="8" height="8" fill="#ecfeff"/>
        <rect x="444" y="52" width="16" height="16" fill="#22d3ee"/>
        <rect x="448" y="56" width="8" height="8" fill="#ecfeff"/>
        <rect x="52" y="444" width="16" height="16" fill="#14b8a6"/>
        <rect x="56" y="448" width="8" height="8" fill="#67e8f9"/>
        <rect x="444" y="444" width="16" height="16" fill="#14b8a6"/>
        <rect x="448" y="448" width="8" height="8" fill="#67e8f9"/>

        <!-- Monumental Monocraft 'V' -->
        <g>
            ${shadowBlocks.join('\n')}
            ${extrudeBlocks.join('\n')}
            ${faceBlocks.join('\n')}
            ${highlightBlocks.join('\n')}
        </g>

        <!-- Bottom Monocraft 'VOLDEX' plate -->
        <g>
            ${wordBlocks.join('\n')}
        </g>
    </svg>`;
}

/**
 * Generates the horizontal 1000x280 VOLDEX wordmark logo using exact Monocraft glyphs.
 */
function buildMonocraftWordmarkSvg() {
    const width = 1000;
    const height = 280;
    const text = 'VOLDEX';
    const pSize = 22; // 1 Monocraft pixel = 22x22 px
    const subSize = pSize / 2;
    const charW = 5 * pSize; // 110
    const gap = 20;
    const totalW = text.length * charW + (text.length - 1) * gap; // 760
    const startX = Math.round((width - totalW) / 2);
    const startY = 34;

    let shadows = [];
    let extrudes = [];
    let faces = [];
    let bevels = [];

    for (let idx = 0; idx < text.length; idx++) {
        const ch = text[idx];
        const mat = GLYPHS[ch];
        if (!mat) continue;
        const ox = startX + idx * (charW + gap);
        const has = (r, c) => (r >= 0 && r < 7 && c >= 0 && c < 5 && mat[r][c] === 1);

        // Shadow
        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 5; c++) {
                if (!has(r, c)) continue;
                shadows.push(`<rect x="${ox + c * pSize + 8}" y="${startY + r * pSize + 24}" width="${pSize + 4}" height="${pSize + 4}" fill="#000000" opacity="0.65"/>`);
            }
        }

        // 3D Extrusion
        for (let d = 18; d >= 1; d--) {
            const t = d / 18;
            const rC = Math.round(5 + (1 - t) * 10);
            const gC = Math.round(35 + (1 - t) * 75);
            const bC = Math.round(48 + (1 - t) * 90);
            const dx = Math.round(d * 0.35);
            for (let r = 0; r < 7; r++) {
                for (let c = 0; c < 5; c++) {
                    if (!has(r, c)) continue;
                    extrudes.push(`<rect x="${ox + c * pSize + dx}" y="${startY + r * pSize + d}" width="${pSize}" height="${pSize}" fill="rgb(${rC},${gC},${bC})"/>`);
                }
            }
        }

        // Front faces with 2x2 sub-voxel texture
        const topPal = ['#ecfeff', '#a5f3fc', '#67e8f9', '#22d3ee'];
        const midPal = ['#22d3ee', '#06b6d4', '#2dd4bf', '#0891b2'];
        const botPal = ['#14b8a6', '#0d9488', '#0891b2', '#0f766e'];

        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 5; c++) {
                if (!has(r, c)) continue;
                const px = ox + c * pSize;
                const py = startY + r * pSize;
                faces.push(`<rect x="${px - 1.5}" y="${py - 1.5}" width="${pSize + 3}" height="${pSize + 3}" fill="#042f2e"/>`);
                const pal = r <= 1 ? topPal : (r <= 4 ? midPal : botPal);
                for (let sy = 0; sy < 2; sy++) {
                    for (let sx = 0; sx < 2; sx++) {
                        const h = hash2D(idx * 19 + c * 3 + sx, r * 5 + sy, 77);
                        const col = pal[Math.floor(h * pal.length) % pal.length];
                        faces.push(`<rect x="${px + sx * subSize}" y="${py + sy * subSize}" width="${subSize + 0.4}" height="${subSize + 0.4}" fill="${col}"/>`);
                    }
                }
                if (!has(r - 1, c)) {
                    bevels.push(`<rect x="${px}" y="${py}" width="${pSize}" height="4" fill="#ffffff" opacity="0.88"/>`);
                }
                if (!has(r, c - 1)) {
                    bevels.push(`<rect x="${px}" y="${py}" width="3.5" height="${pSize}" fill="#a5f3fc" opacity="0.72"/>`);
                }
            }
        }
    }

    // Sub-badge: "VOLDEXSMP • VOLDEX STUDIOS" rendered in Monocraft pixels
    const subText = 'VOLDEXSMP';
    const sDot = 4;
    const sCharW = 5 * sDot;
    const sGap = 6;
    const sTotalW = subText.length * sCharW + (subText.length - 1) * sGap;
    const sStartX = Math.round((width - sTotalW) / 2);
    const sStartY = 224;
    let subEls = [
        `<rect x="${sStartX - 28}" y="${sStartY - 10}" width="${sTotalW + 56}" height="${7 * sDot + 20}" rx="6" fill="#04111a" stroke="#14b8a6" stroke-width="2"/>`
    ];
    for (let i = 0; i < subText.length; i++) {
        const mat = GLYPHS[subText[i]];
        if (!mat) continue;
        const cx = sStartX + i * (sCharW + sGap);
        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 5; c++) {
                if (!mat[r][c]) continue;
                const col = i >= 6 ? '#2dd4bf' : '#ecfeff';
                subEls.push(`<rect x="${cx + c * sDot}" y="${sStartY + r * sDot}" width="${sDot}" height="${sDot}" fill="${col}"/>`);
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">
        <g>
            ${shadows.join('\n')}
            ${extrudes.join('\n')}
            ${faces.join('\n')}
            ${bevels.join('\n')}
            ${subEls.join('\n')}
        </g>
    </svg>`;
}

/**
 * Generates an isometric 3D Minecraft block icon (256x256) for profile cards.
 */
function generateIsometricBlockSvg(palette) {
    const size = 256;
    const cx = 128;
    const cy = 50;
    const tileW = 11.5;
    const tileH = 5.75;
    const stepZ = 11.5;

    let polys = [];
    polys.push(`<ellipse cx="128" cy="222" rx="68" ry="20" fill="#000000" opacity="0.5"/>`);

    // Top 8x8 face
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const h = hash2D(x, y, palette.seed);
            const col = palette.top[Math.floor(h * palette.top.length) % palette.top.length];
            const sx = cx + (x - y) * tileW;
            const sy = cy + (x + y) * tileH;
            const pts = `${sx},${sy} ${sx + tileW},${sy + tileH} ${sx},${sy + 2 * tileH} ${sx - tileW},${sy + tileH}`;
            polys.push(`<polygon points="${pts}" fill="${col}" stroke="${col}" stroke-width="0.4"/>`);
        }
    }
    // Left 8x8 face
    for (let z = 0; z < 8; z++) {
        for (let y = 0; y < 8; y++) {
            const h = hash2D(y, z + 10, palette.seed);
            const col = z === 0
                ? palette.topSide[Math.floor(h * palette.topSide.length) % palette.topSide.length]
                : palette.left[Math.floor(h * palette.left.length) % palette.left.length];
            const sx = cx - (8 - y) * tileW;
            const sy = cy + (8 + y) * tileH + z * stepZ;
            const pts = `${sx},${sy} ${sx + tileW},${sy + tileH} ${sx + tileW},${sy + tileH + stepZ} ${sx},${sy + stepZ}`;
            polys.push(`<polygon points="${pts}" fill="${col}" stroke="${col}" stroke-width="0.4"/>`);
        }
    }
    // Right 8x8 face
    for (let z = 0; z < 8; z++) {
        for (let x = 0; x < 8; x++) {
            const h = hash2D(x + 20, z + 20, palette.seed);
            const col = z === 0
                ? palette.topSideDark[Math.floor(h * palette.topSideDark.length) % palette.topSideDark.length]
                : palette.right[Math.floor(h * palette.right.length) % palette.right.length];
            const sx = cx + x * tileW;
            const sy = cy + (8 + x) * tileH + z * stepZ;
            const pts = `${sx},${sy + tileH} ${sx + tileW},${sy} ${sx + tileW},${sy + stepZ} ${sx},${sy + tileH + stepZ}`;
            polys.push(`<polygon points="${pts}" fill="${col}" stroke="${col}" stroke-width="0.4"/>`);
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${polys.join('')}</svg>`;
}

async function main() {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
    fs.mkdirSync(KEYARTS_DIR, { recursive: true });
    fs.mkdirSync(BUILD_DIR, { recursive: true });

    // 1. Generate Monocraft Client Icon
    const iconSvg = buildMonocraftClientIconSvg();
    fs.writeFileSync(path.join(ASSETS_DIR, 'voldex-emblem.svg'), iconSvg, 'utf8');

    const iconPng512 = await sharp(Buffer.from(iconSvg)).resize(512, 512).png().toBuffer();
    fs.writeFileSync(path.join(ASSETS_DIR, 'server-icon.png'), iconPng512);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), iconPng512);

    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const icoBuffers = await Promise.all(
        icoSizes.map(s => sharp(Buffer.from(iconSvg)).resize(s, s).png().toBuffer())
    );
    const icoBuf = await pngToIco(icoBuffers);
    fs.writeFileSync(path.join(ASSETS_DIR, 'icon.ico'), icoBuf);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoBuf);
    console.log('✓ Generated Monocraft Client Icons (server-icon.png, build/icon.png, icon.ico)');

    // 2. Generate Monocraft Wordmark Logo
    const logoSvg = buildMonocraftWordmarkSvg();
    fs.writeFileSync(path.join(ASSETS_DIR, 'voldex-logo.svg'), logoSvg, 'utf8');
    await sharp(Buffer.from(logoSvg)).png().toFile(path.join(ASSETS_DIR, 'logo.png'));
    await sharp(Buffer.from(logoSvg)).webp({ quality: 95 }).toFile(path.join(ASSETS_DIR, 'logo.webp'));
    console.log('✓ Generated Monocraft Wordmark Logo (logo.png, logo.webp)');

    // 3. Generate Isometric Voxel Profile Icons
    const palettes = {
        newest: {
            seed: 11,
            top: ['#67e8f9', '#22d3ee', '#06b6d4', '#a5f3fc'],
            topSide: ['#0891b2', '#06b6d4', '#0e7490'],
            topSideDark: ['#0e7490', '#155e75', '#164e63'],
            left: ['#1e293b', '#0f172a', '#164e63', '#0d9488'],
            right: ['#0f172a', '#020617', '#115e59', '#134e4a']
        },
        mostplayed: {
            seed: 22,
            top: ['#34d399', '#10b981', '#2dd4bf', '#6ee7b7'],
            topSide: ['#059669', '#0d9488', '#10b981'],
            topSideDark: ['#047857', '#0f766e', '#065f46'],
            left: ['#1e293b', '#0f172a', '#065f46', '#115e59'],
            right: ['#0f172a', '#020617', '#064e3b', '#134e4a']
        },
        old: {
            seed: 33,
            top: ['#38bdf8', '#0284c7', '#0369a1', '#7dd3fc'],
            topSide: ['#0284c7', '#0369a1', '#075985'],
            topSideDark: ['#075985', '#0c4a6e', '#082f49'],
            left: ['#334155', '#1e293b', '#0f172a', '#1e3a8a'],
            right: ['#1e293b', '#0f172a', '#020617', '#172554']
        }
    };
    for (const [name, pal] of Object.entries(palettes)) {
        const svg = generateIsometricBlockSvg(pal);
        await sharp(Buffer.from(svg)).png().toFile(path.join(ICONS_DIR, `${name}.png`));
    }
    console.log('✓ Generated Isometric Voxel Profile Icons');

    // 4. Process Custom Keyart Backgrounds into card-*.jpg, card-*.webp, default.jpg, default.webp
    const keyartVersions = ['26.2', '26.3', '26.1', '1.21.11'];
    const defaultSrc = path.join(KEYARTS_DIR, '26.2.jpg');
    if (fs.existsSync(defaultSrc)) {
        fs.copyFileSync(defaultSrc, path.join(KEYARTS_DIR, 'default.jpg'));
        await sharp(defaultSrc).webp({ quality: 90 }).toFile(path.join(KEYARTS_DIR, 'default.webp'));
    }
    for (const ver of keyartVersions) {
        const srcJpg = path.join(KEYARTS_DIR, `${ver}.jpg`);
        if (fs.existsSync(srcJpg)) {
            await sharp(srcJpg).resize(800, 450, { fit: 'cover' }).jpeg({ quality: 90 }).toFile(path.join(KEYARTS_DIR, `card-${ver}.jpg`));
            await sharp(srcJpg).resize(800, 450, { fit: 'cover' }).webp({ quality: 90 }).toFile(path.join(KEYARTS_DIR, `card-${ver}.webp`));
            await sharp(srcJpg).webp({ quality: 90 }).toFile(path.join(KEYARTS_DIR, `${ver}.webp`));
        }
    }
    console.log('✓ Generated all custom keyart JPG & WEBP variants');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
