// Mesh-based Terrain Worker
// Heavy computation: Voronoi mesh, erosion, rivers, territories
// Runs off-main-thread, sends SVG path data back

importScripts('./Libraries/d3.js');
importScripts('./terrain.mesh.js');

// Generate full terrain mesh and derived features
function generateMeshTerrain(config) {
    var npts = config.npts;
    var extent = config.extent;
    var ncities = config.ncities;
    var nterrs = config.nterrs;
    var seed = config.seed;

    // Seed random for reproducibility
    if (seed !== undefined) {
        // SimpleMulberry32 – seeded PRNG
        var s = Math.imul(1664525, seed | 0);
        s = Math.imul(1664525, s + 0x6C38E853);
        var mulberry32 = function() {
            var t = s += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
        // Override Math.random for this worker
        Math.random = mulberry32;
    }

    console.log('[worker] START config:', config);

    // ─── 1. Build the Voronoi mesh ────────────────────────────────────────
    console.log('[worker] Step 1: calling Mesh.generateGoodMesh');
    var mesh = Mesh.generateGoodMesh(npts, extent);
    console.log('[worker] Step 1 result: mesh =', mesh);
    if (!mesh) throw new Error('Mesh.generateGoodMesh returned null/undefined');
    console.log('[worker] mesh.vxs exists?', mesh.vxs !== undefined, 'length:', mesh.vxs?.length);

    // ─── 2. Build base heightfield ──────────────────────────────────────────────
    console.log('[worker] Step 2: calling Mesh.zero');
    var h = Mesh.zero(mesh);
    console.log('[worker] Step 2 result: h =', h, 'h.mesh?', h.mesh !== undefined);
    if (!h) throw new Error('Mesh.zero returned null/undefined');

    console.log('[worker] Step 2b: calling Mesh.slope');
    var h_slope = Mesh.slope(mesh, Mesh.randomVector(4));
    console.log('[worker] Step 2b result: h_slope ok');

    console.log('[worker] Step 2c: calling Mesh.cone');
    var h_cone = Mesh.cone(mesh, 1.0 * (Math.random() < 0.5 ? -1 : 1));
    console.log('[worker] Step 2c result: h_cone ok');

    console.log('[worker] Step 2d: calling Mesh.mountains');
    var h_mount = Mesh.mountains(mesh, 50);
    console.log('[worker] Step 2d result: h_mount ok');

    console.log('[worker] Step 2e: Mesh.add');
    h = Mesh.add(h_slope, h_cone, h_mount);
    console.log('[worker] Step 2e result: h =', h, 'h.mesh?', h.mesh !== undefined);

    // 3. Relax to smooth
    console.log('[worker] Step 3: relaxing 10 iterations');
    for (var i = 0; i < 10; i++) {
        h = Mesh.relax(h);
        if (!h) throw new Error('Mesh.relax iteration ' + i + ' returned null/undefined');
    }
    console.log('[worker] Step 3: relax done, h.mesh?', h.mesh !== undefined);

    console.log('[worker] Step 4: Mesh.peaky');
    h = Mesh.peaky(h);
    console.log('[worker] Step 4: peaky done, h.mesh?', h.mesh !== undefined);

    // 4. Erosion
    console.log('[worker] Step 5: Mesh.doErosion');
    h = Mesh.doErosion(h, 0.02 + Math.random()*0.1, 5);
    console.log('[worker] Step 5: erosion done, h.mesh?', h.mesh !== undefined);

    // 5. Sea level
    console.log('[worker] Step 6: setSeaLevel');
    h = Mesh.setSeaLevel(h, 0.25 + Math.random()*0.35);
    console.log('[worker] Step 6a: after setSeaLevel, h.mesh?', h.mesh !== undefined);
    console.log('[worker] Step 6b: calling fillSinks');
    h = Mesh.fillSinks(h);
    console.log('[worker] Step 6c: after fillSinks, h.mesh?', h.mesh !== undefined);
    console.log('[worker] Step 6d: calling cleanCoast');
    h = Mesh.cleanCoast(h, 3);
    console.log('[worker] Step 6: preprocessing done, h.mesh?', h.mesh !== undefined);

    // 6. Rivers
    console.log('[worker] Step 7: getRivers');
    var rivers = Mesh.getRivers(h, 0.02);
    console.log('[worker] Step 7: rivers ok');
    console.log('[worker] Step 7: rivers ok');

    // 7. Cities & territories
    console.log('[worker] Step 8: placeCities & getTerritories');
    console.log('[worker] h before placeCities, h.mesh?', h.mesh !== undefined);
    var cities = Mesh.placeCities(h, ncities || 15);
    console.log('[worker] cities placed, h.mesh still?', h.mesh !== undefined);
    var territories = Mesh.getTerritories(h, cities, nterrs || 5);
    console.log('[worker] territories obtained, h.mesh?', h.mesh !== undefined);
    territories.mesh = mesh; // Attach mesh reference for getBorders
    var borders = Mesh.getBorders(territories);
    console.log('[worker] Step 8: cities/territories ok');

    // 8. Coast contour
    console.log('[worker] Step 9: contour');
    var coast = Mesh.contour(h, 0);

    // 9. Slope strokes for hatching
    console.log('[worker] Step 10: computeSlopeHatching');
    var slopeHatching = computeSlopeHatching(h);

    // 10. Text labels
    console.log('[worker] Step 11: computeLabels');
    var labels = computeLabels(h, cities, territories, nterrs);

    console.log('[worker] FINISHED: building result object');
    console.log('[worker] Final mesh check:', {vxsExists: mesh.vxs !== undefined, extentExists: mesh.extent !== undefined});
    console.log('[worker] Result heights h:', {length: h.length, hasMesh: h.mesh !== undefined});
    console.log('[worker] About to return result with mesh.vxs length:', mesh.vxs.length);

    var result = {
        mesh: {
            vxs: mesh.vxs,
            extent: mesh.extent
        },
        heights: Array.prototype.slice.call(h),
        rivers: rivers,
        coast: coast,
        borders: borders,
        cities: cities,
        territories: Array.prototype.slice.call(territories),
        labels: labels,
        slopeHatching: slopeHatching,
        config: config
    };
    console.log('[worker] Result object created, result.mesh exists?', result.mesh !== undefined);
    return result;
}

// Compute slope hatching (short strokes indicating slope direction)
function computeSlopeHatching(h) {
    console.log('[computeSlopeHatching] entry: h.mesh?', h.mesh !== undefined, 'h.length:', h.length);
    var strokes = [];
    var rscale = 0.15 / Math.sqrt(h.length);
    
    // Local Box-Muller for this function
    var z2_local = null;
    function rnorm_local() {
        if (z2_local !== null) { var t = z2_local; z2_local = null; return t; }
        var x1 = 0, x2 = 0, w = 2.0;
        while (w >= 1) {
            x1 = Math.random() * 2 - 1;
            x2 = Math.random() * 2 - 1;
            w = x1*x1 + x2*x2;
        }
        w = Math.sqrt(-2 * Math.log(w) / w);
        z2_local = x2 * w;
        return x1 * w;
    }
    
    for (var i = 0; i < h.length; i++) {
        if (h[i] <= 0 || Mesh.isnearedge(h.mesh, i)) continue;
        var nbs = Mesh.neighbours(h.mesh, i);
        nbs.push(i);
        var s = 0, s2 = 0;
        for (var j_idx = 0; j_idx < nbs.length; j_idx++) {
            var j = nbs[j_idx];
            var slope = Mesh.trislope(h, j);
            s += slope[0]/10; s2 += slope[1];
        }
        s /= nbs.length; s2 /= nbs.length;
        if (Math.abs(s) < Math.random() * 0.3) continue;

        // Guard against non-finite slope components
        if (!isFinite(s) || !isFinite(s2)) continue;

        var l = rscale * (1 + Math.random()) * (1 - 0.2*Math.pow(Math.atan(s),2)) * Math.exp(s2/100);
        if (!isFinite(l)) continue;  // prevent overflow
        var pos = h.mesh.vxs[i];
        var x = pos[0], y = pos[1];
        if (Math.abs(l*s) > 2*rscale) {
            var n = Math.min(4, Math.floor(Math.abs(l*s/rscale)));
            l /= n;
            for (var k = 0; k < n; k++) {
                var u = rnorm_local() * rscale, v = rnorm_local() * rscale;
                var p1 = [x+u-l, y+v+l*s];
                var p2 = [x+u+l, y+v-l*s];
                if (isFinite(p1[0]) && isFinite(p1[1]) && isFinite(p2[0]) && isFinite(p2[1])) {
                    strokes.push([p1, p2]);
                }
            }
        } else {
            var p1 = [x-l, y+l*s];
            var p2 = [x+l, y-l*s];
            if (isFinite(p1[0]) && isFinite(p1[1]) && isFinite(p2[0]) && isFinite(p2[1])) {
                strokes.push([p1, p2]);
            }
        }
    }
    return strokes;
}

// Compute city/region labels with placement heuristics
function computeLabels(h, cities, terr, nterrs) {
    var labels = [];
    var cityLabels = [];
    for (var i = 0; i < cities.length; i++) {
        var pos = h.mesh.vxs[cities[i]];
        var cx = pos[0], cy = pos[1];
        var text = Mesh.makeName('city');
        var size = i < nterrs ? 40 : 25;
        var sy = size / 1000;
        var sx = 0.6 * text.length * sy;

        var opts = [
            {x: cx+0.8*sy, y: cy+0.3*sy, align: 'start',  x0: cx+0.7*sy, y0: cy-0.6*sy, x1: cx+0.7*sy+sx, y1: cy+0.6*sy},
            {x: cx-0.8*sy, y: cy+0.3*sy, align: 'end',   x0: cx-0.9*sy-sx, y0: cy-0.7*sy, x1: cx-0.9*sy,   y1: cy+0.7*sy},
            {x: cx,               y: cy-0.8*sy, align: 'middle',x0: cx-sx/2,    y0: cy-1.9*sy, x1: cx+sx/2,    y1: cy-0.7*sy},
            {x: cx,               y: cy+1.2*sy, align: 'middle',x0: cx-sx/2,    y0: cy+0.1*sy, x1: cx+sx/2,    y1: cy+1.3*sy}
        ];
        var opt = opts[0];
        opt.text = text; opt.size = size;
        cityLabels.push(opt);
    }
    labels.push({type: 'cities', items: cityLabels});

    // Region labels
    var regLabels = [];
    for (var i = 0; i < nterrs; i++) {
        var lc = Mesh.terrCenter(h, terr, cities[i], true);
        var text = Mesh.makeName('region');
        var sy = 0.04;
        var sx = 0.6 * text.length * sy;
        regLabels.push({text: text, x: lc[0], y: lc[1], size: sy, width: sx});
    }
    labels.push({type: 'regions', items: regLabels});

    return labels;
}

// ─── Worker entry point ────────────────────────────────────────────────────
self.onmessage = function(e) {
    var config = e.data.config;
    try {
        var result = generateMeshTerrain(config);
        self.postMessage(result);
    } catch (err) {
        self.postMessage({error: err.message});
    }
};
