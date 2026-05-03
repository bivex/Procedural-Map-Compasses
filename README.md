# Procedural Map Compasses

This GitHub repository holds the companion code for the [Dragons Abound](https://heredragonsabound.blogspot.com/) series on procedural generation of map compasses. You are currently viewing the Part 18 branch of the repository. This branch contains the code associated with Part 18 of the blog series.

## Overview

This system procedurally generates decorative compasses for fantasy maps using a domain-specific language (DSL) called CDL (Compass Design Language). Compass designs are defined as grammar rules in `compass.rules` and interpreted at runtime to produce unique SVG-based compasses.

## Quick Start

1. Start a local HTTP server:
   ```bash
   node server.js
   ```
   or use Python: `python3 -m http.server 8080`

2. Open `http://127.0.0.1:8080/test.html` in your browser

3. Click the "Test" button to generate a random compass

## File Structure

| File | Description |
|------|-------------|
| `compass.js` | Main entry point — parses CDL grammar and interprets drawing commands |
| `cdl.js` | Nearley-generated parser for the CDL grammar syntax |
| `lodestone.js` | Nearley-generated parser for Lodestone meta-grammar |
| `draw.js` | SVG/D3 drawing primitives (circles, lines, triangles, arcs, diamonds, waves, text) |
| `utils.js` | Utility functions (random number generation, angle math, etc.) |
| `compass.rules` | Grammar rules defining compass design variations |
| `test.html` | Simple test page with "Test" button to generate compasses |
| `Libraries/` | Third-party libraries (D3.js, Nearley parser, Moo lexer) |
| `Examples/` | Sample compass output images |
| `server.js` | Simple Node.js HTTP server for local development |

## How It Works

### CDL Commands

The system understands a set of drawing commands:

- `CIRCLE(lineWidth, lineColor, fillColor)` — draw a circle
- `SPACE(n)` — skip radial space
- `MOVE(n)` — move to specified radius
- `RLINE(start, repeats, length, width, color)` — radial lines
- `RCIRCLE(start, repeats, size, lineWidth, color, fill)` — radial circles
- `RTRI(start, repeats, size, lwidth, color, fill)` — radial triangles
- `RDIAMOND(start, repeats, size, lwidth, color, fill)` — radial diamonds
- `RWAVE(start, repeats, size, ...)` — radial wavy points
- `RPOINT(start, repeats, shoulder, ...)` — radial compass points (arrowheads)
- `RTEXT(start, repeats, font, size, color, fill, style, orientation, labels[])` — radial labels
- `RARC(start, repeats, radius, width, color)` — radial arcs
- `REMEMBER(name)` / `RECALL(name)` — store/restore radius state

### Grammar-Based Generation

The `compass.rules` file defines a nearley grammar that generates valid CDL sequences. Rules use weighted choices (`[weight]`) and probabilistic selections to create diverse output. Each generation run picks a random path through the grammar, yielding unique compasses.

### Example Output

A typical generated compass might be:

```
<two-layer compass>:
  - Labels: N, E, S, W (random font, size, style)
  - Outer ring: thick black circle (3–4px) + inner thin circle (0.5–1.5px)
  - Cardinal points: RPOINT elements at 0° (N)
  - Optional: inter-cardinal or ordinal points, scale rings, radial decorations
```

## Customization

To modify compass generation, edit `compass.rules` and re-run. The grammar uses embedded JavaScript snippets for dynamic values:

```nearley
<$shoulder> => `Utils.randRange(0.825,0.925)`;
<labels> => RTEXT(0, 4, <$labelFont>, <$labelSize>, "black", "", <$labelStyle>, ...);
```

To add new drawing primitives, extend `draw.js` and reference them in `compass.rules`.

## Dependencies

- **D3.js** — SVG manipulation and rendering
- **Nearley** — parser generation from EBNF grammar
- **Moo** — lexer for tokenization

All libraries are included in the `Libraries/` directory.

## License

Companion code for the Dragons Abound blog series. See repository for license details.
