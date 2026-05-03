// Terrain Mesh Generation Library
// Ported from D3 World Generator algorithm
// Uses Voronoi mesh, erosion, river networks, territories

// Assuming d3 is already loaded via importScripts
var d3voronoi = d3.voronoi;

// Default extent (width & height in world units)
var defaultExtent = { width: 1, height: 1 };

// Simple binary heap priority queue
function PriorityQueue(opts) {
    this.compare = opts.comparator || ((a,b) => a - b);
    this.heap = [];
}
PriorityQueue.prototype.size = function() { return this.heap.length; };
PriorityQueue.prototype.queue = function(item) {
    this.heap.push(item);
    this._siftUp(this.heap.length - 1);
};
PriorityQueue.prototype.dequeue = function() {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
        this.heap[0] = last;
        this._siftDown(0);
    }
    return top;
};
PriorityQueue.prototype._siftUp = function(i) {
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (!this.compare(this.heap[i], this.heap[p])) break;
        const tmp = this.heap[i]; this.heap[i] = this.heap[p]; this.heap[p] = tmp;
        i = p;
    }
};
PriorityQueue.prototype._siftDown = function(i) {
    const n = this.heap.length;
    while (true) {
        let left = i*2 + 1, right = i*2 + 2;
        let largest = i;
        if (left < n && this.compare(this.heap[left], this.heap[largest])) largest = left;
        if (right < n && this.compare(this.heap[right], this.heap[largest])) largest = right;
        if (largest === i) break;
        const tmp = this.heap[i]; this.heap[i] = this.heap[largest]; this.heap[largest] = tmp;
        i = largest;
    }
};

// Define global Mesh object for export
var Mesh = {};

// ─── Random utilities ──────────────────────────────────────────────────────

function runif(lo, hi) {
    return lo + Math.random() * (hi - lo);
}

// Box-Muller normal distribution
var z2 = null;
function rnorm() {
    if (z2 !== null) { var t = z2; z2 = null; return t; }
    var x1 = 0, x2 = 0, w = 2.0;
    while (w >= 1) {
        x1 = runif(-1, 1);
        x2 = runif(-1, 1);
        w = x1*x1 + x2*x2;
    }
    w = Math.sqrt(-2 * Math.log(w) / w);
    z2 = x2 * w;
    return x1 * w;
}

function randomVector(scale) {
    return [scale * rnorm(), scale * rnorm()];
}

// ─── Point generation & Voronoi mesh ─────────────────────────────────────

function generatePoints(n, extent) {
    extent = extent || defaultExtent;
    var pts = [];
    for (var i = 0; i < n; i++) {
        pts.push([
            (Math.random() - 0.5) * extent.width,
            (Math.random() - 0.5) * extent.height
        ]);
    }
    return pts;
}

function centroid(pts) {
    var x = 0, y = 0;
    for (var i = 0; i < pts.length; i++) { var p = pts[i]; x += p[0]; y += p[1]; }
    return [x/pts.length, y/pts.length];
}

function improvePoints(pts, n, extent) {
    n = n || 1;
    extent = extent || defaultExtent;
    for (var i = 0; i < n; i++) {
        var vor = d3voronoi().extent([[-extent.width/2, -extent.height/2],
                                           [extent.width/2, extent.height/2]])(pts);
        pts = vor.polygons(pts).map(function(poly) { return poly ? centroid(poly) : pts[0]; });
    }
    return pts;
}

function generateGoodPoints(n, extent) {
    var pts = generatePoints(n, extent);
    pts.sort(function(a, b) { return a[0] - b[0]; });
    return improvePoints(pts, 1, extent);
}

function makeMesh(pts, extent) {
    extent = extent || defaultExtent;
    var vor = d3voronoi()
        .extent([[-extent.width/2, -extent.height/2],
                 [extent.width/2, extent.height/2]])(pts);

    var vxs = [];           // unique vertex coordinates
    var vxids = {};         // map stringified vertex -> index in vxs
    var adj = [];           // adjacency list per vertex
    var edges = [];         // [v0, v1, leftSite, rightSite]
    var tris = [];          // triangles per vertex (site IDs)

    for (var i = 0; i < vor.edges.length; i++) {
        var e = vor.edges[i];
        if (!e) continue;
        var key0 = JSON.stringify(e[0]), key1 = JSON.stringify(e[1]);
        var i0 = vxids[key0], i1 = vxids[key1];
        if (i0 === undefined) { i0 = vxs.length; vxids[key0] = i0; vxs.push(e[0]); }
        if (i1 === undefined) { i1 = vxs.length; vxids[key1] = i1; vxs.push(e[1]); }

        if (!adj[i0]) adj[i0] = [];
        adj[i0].push(i1);
        if (!adj[i1]) adj[i1] = [];
        adj[i1].push(i0);
        edges.push([i0, i1, e.left, e.right]);

        if (!tris[i0]) tris[i0] = [];
        tris[i0].push(e.left);
        tris[i0].push(e.right);
        if (!tris[i1]) tris[i1] = [];
        tris[i1].push(e.left);
        tris[i1].push(e.right);
    }

    var mesh = { pts: pts, vor: vor, vxs: vxs, adj: adj, tris: tris, edges: edges, extent: extent };
    mesh.map = function(f) { var r = vxs.map(f); r.mesh = mesh; return r; };
    return mesh;
}

function generateGoodMesh(n, extent) {
    var pts = generateGoodPoints(n, extent);
    return makeMesh(pts, extent);
}

// ─── Mesh utility functions ────────────────────────────────────────────────

function isedge(mesh, i)   { return mesh.adj[i].length < 3; }
function isnearedge(mesh, i) {
    var extent = mesh.extent;
    var p = mesh.vxs[i];
    return p[0] < -0.45*extent.width || p[0] > 0.45*extent.width || p[1] < -0.45*extent.height || p[1] > 0.45*extent.height;
}
function neighbours(mesh, i) { return mesh.adj[i].slice(); }
function distance(mesh, i, j) {
    var p = mesh.vxs[i], q = mesh.vxs[j];
    return Math.hypot(p[0]-q[0], p[1]-q[1]);
}

// ─── Heightfield operations ───────────────────────────────────────────────

function zero(mesh) {
    var z = new Float32Array(mesh.vxs.length);
    z.mesh = mesh;
    return z;
}

function slope(mesh, direction) {
    return mesh.map(function(v) { return v[0]*direction[0] + v[1]*direction[1]; });
}

function cone(mesh, s) {
    return mesh.map(function(v) { return Math.hypot(v[0], v[1]) * s; });
}

function mountains(mesh, n, r) {
    r = r || 0.05;
    var mounts = [];
    for (var i = 0; i < n; i++) {
        mounts.push([
            mesh.extent.width  * (Math.random() - 0.5),
            mesh.extent.height * (Math.random() - 0.5)
        ]);
    }
    var h = zero(mesh);
    for (var i = 0; i < mesh.vxs.length; i++) {
        var p = mesh.vxs[i];
        var sum = 0;
        for (var j = 0; j < mounts.length; j++) {
            var m = mounts[j];
            var dx = p[0] - m[0], dy = p[1] - m[1];
            sum += Math.pow(Math.exp(-(dx*dx + dy*dy) / (2*r*r)), 2);
        }
        h[i] = sum;
    }
    return h;
}

function relax(h) {
    var newh = zero(h.mesh);
    for (var i = 0; i < h.length; i++) {
        var nbs = neighbours(h.mesh, i);
        if (nbs.length < 3) { newh[i] = 0; continue; }
        var sum = 0;
        for (var j = 0; j < nbs.length; j++) sum += h[nbs[j]];
        newh[i] = sum / nbs.length;
    }
    return newh;
}

function add() {
    var arrays = Array.prototype.slice.call(arguments);
    var n = arrays[0].length;
    var result = zero(arrays[0].mesh);
    for (var i = 0; i < n; i++) {
        var s = 0;
        for (var j = 0; j < arrays.length; j++) s += arrays[j][i];
        result[i] = s;
    }
    return result;
}

function normalize(h) {
    var lo = d3.min(h), hi = d3.max(h);
    var r = h.map(function(v) { return (v - lo) / (hi - lo); });
    if (h.mesh) r.mesh = h.mesh;
    return r;
}

function peaky(h) {
    var r = normalize(h).map(function(v) { return Math.sqrt(v); });
    if (h.mesh) r.mesh = h.mesh;
    return r;
}

// ─── Sink filling ──────────────────────────────────────────────────────────

function fillSinks(h, epsilon = 1e-5) {
    const infinity = 999999;
    const newh = zero(h.mesh);
    const {length} = h;

    for (let i = 0; i < length; i++) {
        if (isnearedge(h.mesh, i)) newh[i] = h[i];
        else newh[i] = infinity;
    }

    let iter = 0;
    const maxIters = 2000;
    while (true) {
        if (++iter > maxIters) {
            console.error('[fillSinks] MAX ITERS REACHED:', maxIters);
            return newh;
        }
        if (iter % 100 === 0) console.log('[fillSinks] iter', iter);
        let changed = false;
        for (let i = 0; i < length; i++) {
            if (newh[i] === h[i]) continue;
            const nbs = neighbours(h.mesh, i);
            for (let j = 0; j < nbs.length; j++) {
                const nj = nbs[j];
                if (h[i] >= newh[nj] + epsilon) { newh[i] = h[i]; changed = true; break; }
                const oh = newh[nj] + epsilon;
                if (newh[i] > oh && oh > h[i]) { newh[i] = oh; changed = true; }
            }
        }
        if (!changed) {
            console.log('[fillSinks] converged after', iter, 'iters');
            return newh;
        }
    }
}

// ─── Downhill & flux ───────────────────────────────────────────────────────

function downhill(h) {
    if (h.downhill) return h.downhill;
    const dh = new Int32Array(h.length);
    for (let i = 0; i < h.length; i++) {
        if (isedge(h.mesh, i)) { dh[i] = -2; continue; }
        let best = -1, besth = h[i];
        const nbs = neighbours(h.mesh, i);
        for (const j of nbs) {
            if (h[j] < besth) { besth = h[j]; best = j; }
        }
        dh[i] = best;
    }
    h.downhill = dh;
    return dh;
}

function getFlux(h) {
    const dh = downhill(h);
    const flux = zero(h.mesh);
    const idxs = Array.from({length: h.length}, (_,i) => i);
    // Sort by height descending
    idxs.sort((a,b) => h[b] - h[a]);
    for (const i of idxs) {
        flux[i] = 1 / h.length;
        if (dh[i] >= 0) flux[dh[i]] += flux[i];
    }
    return flux;
}

// ─── Slope & erosion ───────────────────────────────────────────────────────

function trislope(h, i) {
    const nbs = neighbours(h.mesh, i);
    if (nbs.length !== 3) return [0, 0];
    const p0 = h.mesh.vxs[nbs[0]];
    const p1 = h.mesh.vxs[nbs[1]];
    const p2 = h.mesh.vxs[nbs[2]];

    const x1 = p1[0] - p0[0], x2 = p2[0] - p0[0];
    const y1 = p1[1] - p0[1], y2 = p2[1] - p0[1];
    const det = x1*y2 - x2*y1;
    const h1 = h[nbs[1]] - h[nbs[0]];
    const h2 = h[nbs[2]] - h[nbs[0]];
    return [(y2*h1 - y1*h2)/det, (-x2*h1 + x1*h2)/det];
}

function getSlope(h) {
    const slope = zero(h.mesh);
    for (let i = 0; i < h.length; i++) {
        const s = trislope(h, i);
        slope[i] = Math.hypot(s[0], s[1]);
    }
    return slope;
}

function erosionRate(h) {
    const flux = getFlux(h);
    const slope = getSlope(h);
    const er = zero(h.mesh);
    for (let i = 0; i < h.length; i++) {
        const river = Math.sqrt(flux[i]) * slope[i];
        const creep  = slope[i] * slope[i];
        let total = 1000*river + creep;
        if (total > 200) total = 200;
        er[i] = total;
    }
    return er;
}

function erode(h, amount) {
    const er = erosionRate(h);
    const maxer = d3.max(er);
    const newh = zero(h.mesh);
    for (let i = 0; i < h.length; i++) {
        newh[i] = h[i] - amount * (er[i] / maxer);
    }
    return newh;
}

function doErosion(h, amount = 0.1, n = 1) {
    console.log('[doErosion] entry, n=', n, 'h.length=', h.length);
    h = fillSinks(h);
    console.log('[doErosion] after fillSinks');
    for (let i = 0; i < n; i++) {
        h = erode(h, amount);
        console.log('[doErosion] after erode', i);
        h = fillSinks(h);
        console.log('[doErosion] after fillSinks', i);
    }
    console.log('[doErosion] returning');
    return h;
}

// ─── Sea level & coast cleaning ────────────────────────────────────────────

function setSeaLevel(h, q) {
    const sorted = Array.from(h).sort(d3.ascending);
    const delta = d3.quantile(sorted, q);
    var r = h.map(function(v) { return v - delta; });
    if (h.mesh) r.mesh = h.mesh;
    return r;
}

function cleanCoast(h, iters) {
    let current = h;
    for (let iter = 0; iter < iters; iter++) {
        let changed = 0;
        // Pass 1: land next to water -> interpolate
        let newh = zero(current.mesh);
        for (let i = 0; i < current.length; i++) {
            newh[i] = current[i];
            const nbs = neighbours(current.mesh, i);
            if (current[i] <= 0 || nbs.length !== 3) continue;
            let landCount = 0, bestWater = -999999;
            for (const j of nbs) {
                if (current[j] > 0) landCount++;
                else if (current[j] > bestWater) bestWater = current[j];
            }
            if (landCount > 1) continue;
            newh[i] = bestWater / 2;
            changed++;
        }
        current = newh;

        // Pass 2: water next to land -> interpolate
        newh = zero(current.mesh);
        for (let i = 0; i < current.length; i++) {
            newh[i] = current[i];
            const nbs = neighbours(current.mesh, i);
            if (current[i] > 0 || nbs.length !== 3) continue;
            let waterCount = 0, bestLand = 999999;
            for (const j of nbs) {
                if (current[j] <= 0) waterCount++;
                else if (current[j] < bestLand) bestLand = current[j];
            }
            if (waterCount > 1) continue;
            newh[i] = bestLand / 2;
            changed++;
        }
        current = newh;
    }
    return current;
}

// ─── Rivers ─────────────────────────────────────────────────────────────────

function getRivers(h, limit) {
    const dh = downhill(h);
    const flux = getFlux(h);
    const links = [];
    let above = 0;
    for (let i = 0; i < h.length; i++) if (h[i] > 0) above++;
    const adjustedLimit = limit * above / h.length;

    for (let i = 0; i < dh.length; i++) {
        if (isnearedge(h.mesh, i)) continue;
        if (flux[i] > adjustedLimit && h[i] > 0 && dh[i] >= 0) {
            const up = h.mesh.vxs[i];
            const down = h.mesh.vxs[dh[i]];
            if (h[dh[i]] > 0) links.push([up, down]);
            else links.push([up, [(up[0]+down[0])/2, (up[1]+down[1])/2]]);
        }
    }
    return mergeSegments(links).map(relaxPath);
}

function mergeSegments(segs) {
    const adj = Object.create(null);
    const done = new Array(segs.length).fill(false);
    const paths = [];
    let path = null;

    for (let i = 0; i < segs.length; i++) {
        const [a0, a1] = segs[i];
        (adj[a0] = adj[a0] || []).push(a1);
        (adj[a1] = adj[a1] || []).push(a0);
    }

    while (true) {
        if (!path) {
            let found = false;
            for (let i = 0; i < segs.length; i++) {
                if (!done[i]) {
                    done[i] = true;
                    path = [segs[i][0], segs[i][1]];
                    found = true;
                    break;
                }
            }
            if (!found) break;
        }

        let changed = false;
        for (let i = 0; i < segs.length; i++) {
            if (done[i]) continue;
            const [s0, s1] = segs[i];
            if (adj[path[0]].length === 2 && s0 === path[0]) { path.unshift(s1); done[i] = true; changed = true; continue; }
            if (adj[path[0]].length === 2 && s1 === path[0]) { path.unshift(s0); done[i] = true; changed = true; continue; }
            if (adj[path[path.length-1]].length === 2 && s0 === path[path.length-1]) { path.push(s1); done[i] = true; changed = true; continue; }
            if (adj[path[path.length-1]].length === 2 && s1 === path[path.length-1]) { path.push(s0); done[i] = true; changed = true; continue; }
        }
        if (!changed) { paths.push(path); path = null; }
    }
    return paths;
}

function relaxPath(path) {
    const newpath = [path[0]];
    for (let i = 1; i < path.length-1; i++) {
        newpath.push([
            0.25*path[i-1][0] + 0.5*path[i][0] + 0.25*path[i+1][0],
            0.25*path[i-1][1] + 0.5*path[i][1] + 0.25*path[i+1][1]
        ]);
    }
    newpath.push(path[path.length-1]);
    return newpath;
}

// ─── Contours ───────────────────────────────────────────────────────────────

function contour(h, level = 0) {
    const edges = [];
    for (const e of h.mesh.edges) {
        if (!e[3]) continue;
        if (isnearedge(h.mesh, e[0]) || isnearedge(h.mesh, e[1])) continue;
        const h0 = h[e[0]], h1 = h[e[1]];
        if ((h0 > level && h1 <= level) || (h1 > level && h0 <= level)) {
            edges.push([e[2], e[3]]);
        }
    }
    return mergeSegments(edges);
}

// ─── Territories & cities ──────────────────────────────────────────────────

function cityScore(h, cities) {
    const flux = getFlux(h);
    const score = h.map((_, i) => 0);
    const {width, height} = h.mesh.extent;

    for (let i = 0; i < h.length; i++) {
        if (h[i] <= 0 || isnearedge(h.mesh, i)) {
            score[i] = -999999;
            continue;
        }
        const [x, y] = h.mesh.vxs[i];
        score[i] = 0.01 / (1e-9 + Math.abs(x) - width/2);
        score[i] += 0.01 / (1e-9 + Math.abs(y) - height/2);
        for (let j = 0; j < cities.length; j++) {
            const [cx, cy] = h.mesh.vxs[cities[j]];
            const d = Math.hypot(x - cx, y - cy);
            score[i] -= 0.02 / (d + 1e-9);
        }
    }
    return score;
}

function placeCity(h, cities) {
    const score = cityScore(h, cities);
    const best = d3.scan(score, d3.descending);
    cities.push(best);
    return best;
}

function placeCities(h, n) {
    const cities = [];
    for (let i = 0; i < n; i++) placeCity(h, cities);
    return cities;
}

function getTerritories(h, cities, nterrs) {
    const n = Math.min(nterrs, cities.length);
    const terr = new Int32Array(h.length).fill(-1);
    const flux = getFlux(h);
    const queue = new PriorityQueue({comparator: (a,b) => a.score - b.score});

    function weight(u, v) {
        const pu = h.mesh.vxs[u], pv = h.mesh.vxs[v];
        const horiz = Math.hypot(pu[0]-pv[0], pu[1]-pv[1]);
        const vert = h[v] - h[u];
        const diff = 1 + 0.25 * Math.pow(vert/horiz || 0, 2);
        return horiz * diff + 100 * Math.sqrt(flux[u]);
    }

    for (let i = 0; i < n; i++) {
        terr[cities[i]] = i;
        const nbs = neighbours(h.mesh, cities[i]);
        for (const nb of nbs) {
            queue.queue({score: weight(cities[i], nb), city: i, vx: nb});
        }
    }

    while (queue.length) {
        const {city, vx} = queue.dequeue();
        if (terr[vx] !== -1) continue;
        terr[vx] = city;
        const nbs = neighbours(h.mesh, vx);
        for (const nb of nbs) {
            if (terr[nb] === -1) {
                queue.queue({score: 0, city, vx: nb}); // simplified
            }
        }
    }

    return terr;
}

function getBorders(terr) {
    const edges = [];
    for (let i = 0; i < terr.mesh.edges.length; i++) {
        const e = terr.mesh.edges[i];
        if (!e[3]) continue;
        if (isnearedge(terr.mesh, e[0]) || isnearedge(terr.mesh, e[1])) continue;
        if (terr[e[0]] !== terr[e[1]]) edges.push([e[2], e[3]]);
    }
    return mergeSegments(edges).map(relaxPath);
}

// ─── City placement with label avoidance ───────────────────────────────────

function terrCenter(h, terr, city, landOnly) {
    let x = 0, y = 0, n = 0;
    for (let i = 0; i < terr.length; i++) {
        if (terr[i] !== city) continue;
        if (landOnly && h[i] <= 0) continue;
        const [vx, vy] = h.mesh.vxs[i];
        x += vx; y += vy; n++;
    }
    return n > 0 ? [x/n, y/n] : [0, 0];
}

// Simple random name generator (placeholder)
function makeName(type) {
    var prefixes = ['Al', 'Ber', 'Cam', 'Dor', 'El', 'Fen', 'Gar', 'Har'];
    var suffixes = type === 'city' ? ['ton', 'ford', 'haven', 'grad', 'mouth'] : ['ia', 'stan', 'land', 'shire'];
    return prefixes[Math.floor(Math.random()*prefixes.length)] +
           suffixes[Math.floor(Math.random()*suffixes.length)];
}

Mesh.makeName = makeName;
Mesh.generateGoodMesh = generateGoodMesh;
Mesh.makeMesh = makeMesh;
Mesh.isedge = isedge;
Mesh.isnearedge = isnearedge;
Mesh.neighbours = neighbours;
Mesh.distance = distance;
Mesh.randomVector = randomVector;
Mesh.zero = zero;
Mesh.slope = slope;
Mesh.cone = cone;
Mesh.mountains = mountains;
Mesh.relax = relax;
Mesh.add = add;
Mesh.normalize = normalize;
Mesh.peaky = peaky;
Mesh.fillSinks = fillSinks;
Mesh.setSeaLevel = setSeaLevel;
Mesh.cleanCoast = cleanCoast;
Mesh.trislope = trislope;
Mesh.downhill = downhill;
Mesh.getFlux = getFlux;
Mesh.getRivers = getRivers;
Mesh.getSlope = getSlope;
Mesh.erosionRate = erosionRate;
Mesh.erode = erode;
Mesh.doErosion = doErosion;
Mesh.contour = contour;
Mesh.cityScore = cityScore;
Mesh.placeCity = placeCity;
Mesh.placeCities = placeCities;
Mesh.getTerritories = getTerritories;
Mesh.getBorders = getBorders;
Mesh.terrCenter = terrCenter;
Mesh.mergeSegments = mergeSegments;
Mesh.relaxPath = relaxPath;
