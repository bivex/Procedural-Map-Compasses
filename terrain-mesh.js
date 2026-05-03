//
//  Mesh-based Terrain Generation (Web Worker version)
//  Renders Voronoi-based terrain with rivers, territories, cities as SVG
//
import TGrid from './tgrid.js';
// D3 is loaded globally via CDN in the HTML

let worker = null;
let terrainConfig = null;

//
//  Convert array of points to SVG path
//
function pointsToPath(points) {
    if (!points || points.length === 0) return '';
    const [x0, y0] = points[0];
    let d = `M ${x0} ${y0}`;
    for (let i = 1; i < points.length; i++) {
        const [x, y] = points[i];
        d += ` L ${x} ${y}`;
    }
    d += ' Z';
    return d;
}

//
//  Render mesh result to SVG
//
function renderMeshSVG(containerOrSelection, result) {
    const container = window.d3.select(containerOrSelection);
    const { mesh, rivers, coast, borders, cities, territories, labels, slopeHatching, config } = result;
    const vxs = mesh.vxs;
    const extent = mesh.extent;
    const { width, height } = extent;
    const scale = 600 / Math.max(width, height);

    
    // Clear container
    container.selectAll('*').remove();
    
    // Create SVG
    const svg = container.append('svg')
        .attr('width', 600)
        .attr('height', 600)
        .style('border', '1px solid #ccc')
        .style('background', '#e6f0ff');
    
    const g = svg.append('g').attr('transform', `scale(${scale}) translate(${300/scale},${300/scale})`);
    
    // Land polygons (colored by territory)
    const territoryColors = window.d3.scaleOrdinal(window.d3.schemeCategory10);
    
    // Render slopes as hatching lines (background)
    if (slopeHatching && slopeHatching.length > 0) {
        g.selectAll('.slope')
            .data(slopeHatching)
            .enter().append('line')
            .attr('x1', d => d[0][0])
            .attr('y1', d => d[0][1])
            .attr('x2', d => d[1][0])
            .attr('y2', d => d[1][1])
            .attr('stroke', '#aaa')
            .attr('stroke-width', 0.3);
    }
    
    // Render water (background, larger than land to show sea around edges)
    const waterScale = scale * 1.2;
    g.append('rect')
        .attr('x', -width/2 * waterScale)
        .attr('y', -height/2 * waterScale)
        .attr('width', width * waterScale)
        .attr('height', height * waterScale)
        .attr('fill', '#a0c8f0')
        .attr('class', 'water-bg');
    
    // Render coast/continent boundary (over water)
    if (coast && coast.length > 0) {
        g.selectAll('.coast-water')
            .data(coast)
            .enter().append('path')
            .attr('d', d => pointsToPath(d))
            .attr('fill', '#e6d5a8')
            .attr('stroke', '#8b7355')
            .attr('stroke-width', 0.5);
    }
    
    // Render rivers
    if (rivers && rivers.length > 0) {
        g.selectAll('.river')
            .data(rivers)
            .enter().append('path')
            .attr('d', d => pointsToPath(d))
            .attr('fill', 'none')
            .attr('stroke', '#2196F3')
            .attr('stroke-width', 0.8);
    }
    
    // Draw borders between territories
    if (borders && borders.length > 0) {
        g.selectAll('.border')
            .data(borders)
            .enter().append('path')
            .attr('d', d => pointsToPath(d))
            .attr('fill', 'none')
            .attr('stroke', '#555')
            .attr('stroke-width', 0.4);
    }
    
    // Draw city labels
    if (labels && labels.length > 0) {
        const cityLabels = labels.find(l => l.type === 'cities');
        if (cityLabels && cityLabels.items) {
            g.selectAll('.city-label')
                .data(cityLabels.items)
                .enter().append('text')
                .attr('x', d => d.x)
                .attr('y', d => d.y)
                .attr('font-size', d => d.size)
                .attr('text-anchor', d => d.align || 'middle')
                .attr('fill', '#000')
                .attr('font-weight', d => d.size > 35 ? 'bold' : 'normal')
                .text(d => d.text);
        }
        
        // Region labels
        const regionLabels = labels.find(l => l.type === 'regions');
        if (regionLabels && regionLabels.items) {
            g.selectAll('.region-label')
                .data(regionLabels.items)
                .enter().append('text')
                .attr('x', d => d.x)
                .attr('y', d => d.y)
                .attr('font-size', 30)
                .attr('text-anchor', 'middle')
                .attr('fill', '#333')
                .attr('font-weight', 'bold')
                .text(d => d.text);
        }
    }
    
    // Render city markers
    if (cities && cities.length > 0) {
        g.selectAll('.city-marker')
            .data(cities)
            .enter().append('circle')
            .attr('cx', i => vxs[i][0])
            .attr('cy', i => vxs[i][1])
            .attr('r', 1)
            .attr('fill', '#000');
    }
}

//
//  Load grammar
//
async function loadTerrainRules() {
    const response = await fetch('terrain.rules');
    return await response.text();
}

//
//  Get or create worker
//
function getWorker() {
    if (!worker) {
        worker = new Worker(new URL('./mesh.worker.js', import.meta.url));
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
//  Main test function - returns Promise<config>
//
async function test(containerElement) {
    // Load config (cached after first call)
    if (!terrainConfig) {
        const rulesText = await loadTerrainRules();
        terrainConfig = TGrid.generateTerrain(rulesText);
    }
    const config = terrainConfig;
    
    console.log('Terrain config:', config);
    
    // Wait for worker result
    return new Promise((resolve) => {
        const w = getWorker();
        w.onmessage = function(e) {
            const result = e.data;
            console.log('Worker result:', result);
            if (result.error) {
                console.error('Worker error:', result.error);
                resolve(config);
                return;
            }
            renderMeshSVG(containerElement, result);
            resolve(config);
        };
        w.postMessage({ config });
    });
}

export default {
    test: (containerElement) => test(containerElement),
    cancel
};