//
//  Top level file for Terrain Generation
//
import Utils from './utils.js';
import Draw from './draw.js';
import TGrid from './tgrid.js';

//
//  Generate elevation heightmap using ValueNoise
//
function generateHeightmap(width, height, config) {
    const noise = new Utils.ValueNoise(config.seed);
    const heights = new Array(height);

    for (let y = 0; y < height; y++) {
        heights[y] = new Array(width);
        for (let x = 0; x < width; x++) {
            heights[y][x] = noise.getHeight(
                x, y, width, height,
                config.octaves,
                config.persistence,
                config.lacunarity
            );
        }
    }
    return heights;
}

//
//  Simulate rivers: flow from high elevations downhill to edges
//  Simple cellular automata approach
//
function generateRivers(heights, riverCount, width, height) {
    const rivers = [];

    // Find high points as river sources
    const sources = [];
    const margin = 20;

    for (let i = 0; i < riverCount * 10; i++) {
        const x = Math.floor(Utils.randIntRange(margin, width - margin));
        const y = Math.floor(Utils.randIntRange(margin, height - margin));
        const h = heights[y][x];
        // Pick points in top 30% of elevation
        if (h > 0.7) {
            sources.push({ x, y, path: [] });
            if (sources.length >= riverCount) break;
        }
    }

    // Trace flow downhill for each source
    for (let src of sources) {
        let x = src.x;
        let y = src.y;
        const path = [{x, y}];

        for (let step = 0; step < 500; step++) {
            // Find lowest neighbor
            let minH = heights[y][x];
            let minX = x, minY = y;
            const dirs = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];

            for (let [dx, dy] of dirs) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nh = heights[ny][nx];
                    if (nh < minH) {
                        minH = nh;
                        minX = nx;
                        minY = ny;
                    }
                }
            }

            // Stop if at edge or stuck
            if (minX <= 0 || minX >= width-1 || minY <= 0 || minY >= height-1) break;
            if (minX === x && minY === y) break;

            x = minX; y = minY;
            path.push({x, y});
        }
        rivers.push(path);
    }

    return rivers;
}

//
//  Assign biomes based on elevation and moisture
//
function generateBiomes(heights, moisture) {
    const height = heights.length;
    const width = heights[0].length;
    const biomes = new Array(height);

    for (let y = 0; y < height; y++) {
        biomes[y] = new Array(width);
        for (let x = 0; x < width; x++) {
            const h = heights[y][x];
            let biome;

            if (h < 0.3) {
                biome = 'water';  // Deep water
            } else if (h < 0.35) {
                biome = moisture > 0.6 ? 'wetland' : 'beach';
            } else if (h < 0.5) {
                biome = 'grassland';
            } else if (h < 0.7) {
                biome = moisture > 0.5 ? 'forest' : 'savanna';
            } else if (h < 0.85) {
                biome = 'mountain';
            } else {
                biome = 'snow';
            }

            biomes[y][x] = biome;
        }
    }
    return biomes;
}

//
//  Extract contour lines at specified interval
//
function generateContours(heights, interval) {
    const contours = [];
    const height = heights.length;
    const width = heights[0].length;

    // Build elevation levels
    const levels = [];
    for (let i = interval; i < 1; i += interval) {
        levels.push(i);
    }

    for (let level of levels) {
        const line = [];
        const threshold = level;

        // Marching squares (simplified)
        for (let y = 0; y < height - 1; y++) {
            for (let x = 0; x < width - 1; x++) {
                const h00 = heights[y][x] >= threshold ? 1 : 0;
                const h10 = heights[y][x+1] >= threshold ? 1 : 0;
                const h01 = heights[y+1][x] >= threshold ? 1 : 0;
                const h11 = heights[y+1][x+1] >= threshold ? 1 : 0;

                const config = (h00 << 3) | (h10 << 2) | (h01 << 1) | h11;
                // Only draw lines on 0-1, 1-0 transitions
                if (config === 5 || config === 10) {
                    // Interpolate position along edge
                    const t = (threshold - (heights[y][x] * (1 - 0) + 0)) /
                              ((heights[y+1][x+1] + heights[y][x] - heights[y][x+1] - heights[y+1][x]) * 0.5 + 0.001);
                    const px = x + 0.5;
                    const py = y + 0.5;
                    line.push({ x: px, y: py });
                }
            }
        }
        if (line.length > 0) contours.push({ level, line });
    }
    return contours;
}

//
//  Render terrain to SVG
//
function renderTerrain(svg, width, height, heights, biomes, rivers, contours, config) {
    // Cell size
    const cellSize = Math.min(width, height) / Math.max(heights.length, heights[0].length);

    // Color schemes
    const biomeColors = {
        water: '#1E88E5',
        wetland: '#43A047',
        beach: '#FDD835',
        grassland: '#7CB342',
        forest: '#2E7D32',
        savanna: '#CDDC39',
        mountain: '#795548',
        snow: '#FFFFFF'
    };

    // Draw biome cells
    for (let y = 0; y < heights.length; y++) {
        for (let x = 0; x < heights[0].length; x++) {
            const biome = biomes[y][x];
            svg.append('rect')
                .attr('x', x * cellSize)
                .attr('y', y * cellSize)
                .attr('width', Math.ceil(cellSize))
                .attr('height', Math.ceil(cellSize))
                .style('fill', biomeColors[biome])
                .style('stroke', 'none');
        }
    }

    // Draw rivers (simple polyline)
    rivers.forEach(river => {
        if (river.length < 2) return;
        const points = river.map(p => [p.x * cellSize, p.y * cellSize]);
        Draw.polyline(svg, points, 2, '#1976D2');
    });

    // Draw contour lines
    contours.forEach(contour => {
        if (contour.line.length < 2) return;
        const points = contour.line.map(p => [p.x * cellSize, p.y * cellSize]);
        Draw.polyline(svg, points, 1, '#555', 0.6);
    });
}

//
//  Main entry: parse rules and render
//
async function loadTerrainRules() {
    const response = await fetch('terrain.rules');
    const text = await response.text();
    return text;
}

async function test(svg) {
    // Clear previous
    svg.selectAll('*').remove();

    // Parse config from grammar
    const rulesText = await loadTerrainRules();
    const config = TGrid.generateTerrain(rulesText);

    console.log('Terrain config:', config);

    const width = config.size || 512;
    const height = config.size || 512;

    // Generate components
    const heights = generateHeightmap(width, height, config);
    const rivers = generateRivers(heights, config.riverCount || 8, width, height);
    const biomes = generateBiomes(heights, config.moisture || 0.5);
    const contours = generateContours(heights, config.contourInterval || 20);

    // Render
    renderTerrain(svg, width, height, heights, biomes, rivers, contours, config);

    return config;
}

export default {
    test
};
