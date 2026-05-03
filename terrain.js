//
//  Top level file for Terrain Generation (Web Worker version)
//  Heavy computation runs in background worker; main thread only renders
//
import TGrid from './tgrid.js';

let worker = null;
let terrainConfig = null;

//
//  Render to Canvas (biome colors + hillshade + rivers + contours)
//
function renderResult(canvas, result) {
    const { heights, rivers, biomes, contours, config } = result;
    const ctx = canvas.getContext('2d');
    const w = config.size | 0; // force integer
    const h = config.size | 0;
    console.log('Render: size=', w, 'heights dims:', heights.length, heights[0].length);
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    // Biome color palette
    const palette = [
        [30, 80, 160],    // 0: deep water
        [60, 120, 200],   // 1: shallow water
        [255, 220, 100],  // 2: beach
        [120, 180, 100],  // 3: grassland
        [50, 120, 50],    // 4: forest
        [180, 150, 80],   // 5: savanna (brownish-yellow)
        [100, 80, 50],    // 6: mountain
        [255, 255, 255]   // 7: snow
    ];

    // Simple hillshade using Sobel-like gradient
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const biomeId = biomes[y][x];
            const baseColor = palette[biomeId] || palette[3];

            // Compute slope shading from nearby height samples
            let dx = 0, dy = 0;
            if (x > 0 && x < w-1 && y > 0 && y < h-1) {
                dx = (heights[y][x+1] - heights[y][x-1]) * 0.5;
                dy = (heights[y+1][x] - heights[y-1][x]) * 0.5;
            }
            const shade = 1 - 0.2 * Math.sqrt(dx*dx + dy*dy);
            const r = Math.min(255, baseColor[0] * shade);
            const g = Math.min(255, baseColor[1] * shade);
            const b = Math.min(255, baseColor[2] * shade);

            data[idx] = r;
            data[idx+1] = g;
            data[idx+2] = b;
            data[idx+3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);

    // Rivers (blue overlay)
    if (rivers.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#1565C0';
        ctx.lineWidth = Math.max(2, w/256);
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        for (let river of rivers) {
            if (river.length < 2) continue;
            ctx.moveTo(river[0].x + 0.5, river[0].y + 0.5);
            for (let i = 1; i < river.length; i++) {
                ctx.lineTo(river[i].x + 0.5, river[i].y + 0.5);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    // Contours (thin grey lines)
    if (contours.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        for (let contour of contours) {
            const pts = contour.line;
            if (pts.length < 2) continue;
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
        }
        ctx.stroke();
        ctx.restore();
    }
}

//
//  Load grammar and create/start worker
//
async function loadConfig() {
    if (terrainConfig) return terrainConfig;
    const resp = await fetch('terrain.rules');
    const text = await resp.text();
    terrainConfig = TGrid.generateTerrain(text);
    return terrainConfig;
}

//
//  Get or create worker
//
function getWorker() {
    if (!worker) {
        worker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
    }
    return worker;
}

//
//  Cancel any running computation
//
function cancel() {
    if (worker) {
        worker.terminate();
        worker = null;
    }
}

//
//  Main test function - asynchronous
//
async function test(svg) {
    // Clear any previous
    svg.selectAll('*').remove();

    // Load config (or use cached)
    const config = await loadConfig();

    // Create canvas element
    const canvas = document.createElement('canvas');
    canvas.width = config.size;
    canvas.height = config.size;
    canvas.style.width = config.size + 'px';
    canvas.style.height = config.size + 'px';
    canvas.style.imageRendering = 'pixelated';
    svg.node().appendChild(canvas);

    // Spawn worker and wait for result
    return new Promise((resolve) => {
        const w = getWorker();
        w.onmessage = function(e) {
            const result = e.data;
            renderResult(canvas, result);
            resolve(config);
        };
        w.postMessage({ config });
    });
}

export default {
    test,
    cancel
};
