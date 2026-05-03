// Terrain Worker - runs heavy terrain generation off-main-thread
// Usage: postMessage({ config: {...} }); receives { heights, rivers, biomes, contours }

import Utils from './utils.js';

// ---- SAME UTILS AS MAIN ----
class ValueNoise {
    constructor(seed = Math.random() * 10000) {
        this.seed = seed;
        this.perm = [];
        for (let i = 0; i < 256; i++) this.perm[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(this.rand(this.seed + i) * (i+1));
            [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
            this.seed += 0.1;
        }
        for (let i = 0; i < 256; i++) this.perm[256+i] = this.perm[i];
    }
    rand(seed) {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
    }
    fade(t) { return t*t*t*(t*(t*6-15)+10); }
    lerp(a,b,t) { return a + t*(b-a); }
    grad(hash, x, z) {
        const h = hash & 15;
        const u = h<8 ? x : z;
        const v = h<4 ? z : h===12||h===14 ? x : 0;
        return ((h&1)===0?u:-u) + ((h&2)===0?v:-v);
    }
    noise2D(x,z) {
        const X = Math.floor(x)&255, Z = Math.floor(z)&255;
        x -= Math.floor(x); z -= Math.floor(z);
        const u = this.fade(x), v = this.fade(z);
        const A = this.perm[X]+Z, AA=this.perm[A], AB=this.perm[A+1];
        const B = this.perm[X+1]+Z, BA=this.perm[B], BB=this.perm[B+1];
        return this.lerp(
            this.lerp(this.grad(this.perm[AA],x,z), this.grad(this.perm[BA],x-1,z), u),
            this.lerp(this.grad(this.perm[AB],x,z-1), this.grad(this.perm[BB],x-1,z-1), u),
            v);
    }
    fbm(x,z,octaves=4,persistence=0.5,lacunarity=2.0) {
        let total=0, amplitude=1, frequency=1, maxValue=0;
        for(let i=0;i<octaves;i++) {
            total += this.noise2D(x*frequency, z*frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }
        return total/maxValue;
    }
    getHeight(x,z,w,h,oct,per,lac) {
        const nx = (x/w)*4-2, nz = (z/h)*4-2;
        return (this.fbm(nx,nz,oct,per,lac)+1)/2;
    }
}

// ---- RIVER TRACING ----
function traceRiverPath(heights, startX, startY, width, height, visited, maxSteps) {
    const path = [];
    let x = startX, y = startY;
    const idx = y*width + x;
    if (visited[idx]) return path;

    for (let step = 0; step < maxSteps; step++) {
        path.push({x, y});
        visited[y*width + x] = 1;

        let minH = heights[y][x];
        let minX = x, minY = y;
        const dirs = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];

        for (let [dx,dy] of dirs) {
            const nx = x+dx, ny = y+dy;
            if (nx>=0 && nx<width && ny>=0 && ny<height) {
                const nh = heights[ny][nx];
                if (nh < minH) { minH = nh; minX = nx; minY = ny; }
            }
        }
        if (minX<=1||minX>=width-2||minY<=1||minY>=height-2) break;
        if (minX===x && minY===y) break;
        x = minX; y = minY;
    }
    return path;
}

function generateRiversOptimized(heights, riverCount, width, height) {
    const rivers = [];
    const visited = new Uint8Array(width*height);
    const candidates = [];

    for(let i=0; i<riverCount*50; i++) {
        const x = Math.floor(Utils.randIntRange(20, width-20));
        const y = Math.floor(Utils.randIntRange(20, height-20));
        candidates.push({x, y, h: heights[y][x]});
    }
    candidates.sort((a,b)=>b.h-a.h);

    for (let c of candidates) {
        if (rivers.length >= riverCount) break;
        let tooClose = false;
        for (let r of rivers) {
            if (r.length>0) {
                const last = r[r.length-1];
                if (Math.abs(last.x-c.x)+Math.abs(last.y-c.y) < 40) { tooClose=true; break; }
            }
        }
        if (tooClose) continue;
        const river = traceRiverPath(heights, c.x, c.y, width, height, visited, 400);
        if (river.length > 8) rivers.push(river);
    }
    return rivers;
}

// ---- BIOMES ----
function generateBiomes(heights, moisture) {
    const height = heights.length, width = heights[0].length;
    const biomes = new Array(height);
    for (let y = 0; y < height; y++) {
        biomes[y] = new Uint8Array(width);
        for (let x = 0; x < width; x++) {
            const h = heights[y][x];
            // encoded biome IDs: 0=water,1=wetland,2=beach,3=grassland,4=forest,5=savanna,6=mountain,7=snow
            let biome;
            if (h < 0.3) biome = 0;
            else if (h < 0.35) biome = moisture > 0.6 ? 1 : 2;
            else if (h < 0.5) biome = 3;
            else if (h < 0.7) biome = moisture > 0.5 ? 4 : 5;
            else if (h < 0.85) biome = 6;
            else biome = 7;
            biomes[y][x] = biome;
        }
    }
    return biomes;
}

// ---- CONTOURS ----
function generateContoursProper(heights, interval, width, height) {
    const contours = [];
    const levels = [];
    for (let lev = interval; lev < 1.0; lev += interval) levels.push(lev);

    // Pre-allocate array for line points
    for (let level of levels) {
        const line = [];
        const thr = level;

        for (let y = 0; y < height-1; y++) {
            for (let x = 0; x < width-1; x++) {
                const h00 = heights[y][x], h10 = heights[y][x+1];
                const h01 = heights[y+1][x], h11 = heights[y+1][x+1];
                const cfg = (h00>=thr?1:0)|(h10>=thr?2:0)|(h11>=thr?4:0)|(h01>=thr?8:0);

                if (cfg === 5 || cfg === 10) {
                    const denom = (h11 + h00 - h10 - h01) * 0.5;
                    if (Math.abs(denom) > 1e-6) {
                        const t = (thr - h00) / denom;
                        const px = x + 0.5, py = y + 0.5;
                        if (cfg === 5) {
                            line.push({x: px, y: py - t*0.5});
                            line.push({x: px + t*0.5, y: py});
                        } else {
                            line.push({x: px - t*0.5, y: py});
                            line.push({x: px, y: py + t*0.5});
                        }
                    }
                }
            }
        }
        if (line.length > 1) contours.push({ level, line });
    }
    return contours;
}

// ---- WORKER MESSAGE HANDLER ----
self.onmessage = function(e) {
    const config = e.data.config;
    console.log('Worker received config:', config);
    const width = config.size || 512;
    const height = config.size || 512;

    console.log('Generating terrain of size', width, height);

    // 1. Heightmap
    const noise = new ValueNoise(config.seed);
    const heights = new Array(height);
    for (let y = 0; y < height; y++) {
        heights[y] = new Float32Array(width);
        for (let x = 0; x < width; x++) {
            heights[y][x] = noise.getHeight(x, y, width, height,
                config.octaves || 5, config.persistence || 0.5, config.lacunarity || 2.0);
        }
    }

    // 2. Rivers
    const rivers = generateRiversOptimized(heights, config.riverCount || 8, width, height);

    // 3. Biomes
    const biomes = generateBiomes(heights, config.moisture || 0.5);

    // 4. Contours
    const contours = generateContoursProper(heights, config.contourInterval || 20, width, height);

    self.postMessage({
        heights,
        rivers,
        biomes,
        contours,
        config
    });
    console.log('Worker finished');
};
