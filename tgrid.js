// Terrain Grammar Parser (tgrid)
// Recursive descent parser for terrain.rules

function parseTerrainGrammar(text) {
    const rules = {};
    const lines = text.split('\n');

    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;
        if (!line.includes('=>')) continue;

        const [lhsRaw, rhsRaw] = line.split('=>').map(s => s.trim());
        // lhs like <terrainConfig> -> terrainConfig
        const lhs = lhsRaw.replace(/[<>]/g, '');

        // Split RHS by '|' at top level (not inside parens)
        const alternatives = [];
        let current = '';
        let depth = 0;
        for (let ch of rhsRaw) {
            if (ch === '(' || ch === '`') depth++;
            if (ch === ')' || ch === '`') depth--;
            if (ch === '|' && depth === 0) {
                alternatives.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) alternatives.push(current.trim());

        // Parse each alternative into tokens
        const parsedAlts = [];
        for (let alt of alternatives) {
            // Extract weight [N] at end
            const weightMatch = alt.match(/\[(\d+)\]$/);
            const weight = weightMatch ? parseInt(weightMatch[1]) : 1;
            const rhs = weightMatch ? alt.slice(0, -weightMatch[0].length).trim() : alt;

            // Tokenize: identify calls (name(...)), refs <...>, and literals
            const tokens = [];
            let i = 0;
            while (i < rhs.length) {
                if (rhs[i] === '<') {
                    // ref or otnref
                    let j = i+1;
                    while (j < rhs.length && rhs[j] !== '>') j++;
                    const name = rhs.slice(i+1, j);
                    tokens.push({ type: 'ref', name });
                    i = j+1;
                } else if (/[a-zA-Z_]/.test(rhs[i])) {
                    // could be a function call or plain word
                    let j = i;
                    while (j < rhs.length && /[a-zA-Z0-9_]/.test(rhs[j])) j++;
                    const name = rhs.slice(i, j);
                    // Skip whitespace
                    while (j < rhs.length && /\s/.test(rhs[j])) j++;
                    if (rhs[j] === '(') {
                        // Function call with args
                        j++; // skip '('
                        const args = [];
                        let arg = '';
                        let parenDepth = 1;
                        while (j < rhs.length && parenDepth > 0) {
                            const c = rhs[j];
                            if (c === '(') parenDepth++;
                            if (c === ')') parenDepth--;
                            if (c === ',' && parenDepth === 1) {
                                args.push(arg.trim());
                                arg = '';
                            } else {
                                arg += c;
                            }
                            j++;
                        }
                        if (arg.trim()) args.push(arg.trim());
                        tokens.push({ type: 'call', name, args });
                    } else {
                        tokens.push({ type: 'literal', value: name });
                    }
                    i = j;
                } else if (rhs[i] === '`') {
                    // backtick expression
                    let j = i+1;
                    while (j < rhs.length && rhs[j] !== '`') j++;
                    const expr = rhs.slice(i+1, j);
                    tokens.push({ type: 'js', value: expr });
                    i = j+1;
                } else {
                    // skip other whitespace
                    i++;
                }
            }
            parsedAlts.push({ tokens, weight });
        }

        if (!rules[lhs]) rules[lhs] = [];
        rules[lhs].push(...parsedAlts);
    }

    return rules;
}

function evaluateRule(rules, startSymbol, context = {}) {
    const symbolRules = rules[startSymbol];
    if (!symbolRules || symbolRules.length === 0) return [];

    // Weighted random selection
    const totalWeight = symbolRules.reduce((sum, r) => sum + r.weight, 0);
    let pick = Math.random() * totalWeight;
    let chosen = null;
    for (let rule of symbolRules) {
        pick -= rule.weight;
        if (pick <= 0) {
            chosen = rule;
            break;
        }
    }
    if (!chosen) chosen = symbolRules[symbolRules.length - 1];

    // Expand tokens recursively
    const expanded = [];
    for (let token of chosen.tokens) {
        if (token.type === 'call') {
            // Evaluate args
            const args = token.args.map(arg => {
                if (arg.startsWith('`') && arg.endsWith('`')) {
                    // Should not happen because args are split on commas and don't include backticks
                }
                // Check for embedded JS with backticks contained
                if (arg.includes('`') && arg.endsWith('`')) {
                    const parts = arg.split('`');
                    if (parts.length >= 3) {
                        try {
                            return eval(parts[1]);
                        } catch (e) {
                            console.warn('Eval failed:', parts[1]);
                            return arg;
                        }
                    }
                }
                // Check for a rule reference in angle brackets
                if (arg.startsWith('<') && arg.endsWith('>')) {
                    const refName = arg.slice(1, -1);
                    if (refName.startsWith('@')) return { type: 'otnref', name: refName.slice(1) };
                    if (refName.startsWith('$')) {
                        return context[refName] !== undefined ? context[refName] : arg;
                    }
                    // Expand non-terminal
                    const sub = evaluateRule(rules, refName, context);
                    // Return raw expanded tokens for further processing
                    return { type: 'expansion', tokens: sub };
                }
                // Try parse as number
                const num = parseFloat(arg);
                if (!isNaN(num)) return num;
                // Return string literal (strip quotes)
                if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
                    return arg.slice(1, -1);
                }
                return arg;
            });
            expanded.push({ type: 'op', name: token.name, args });
        } else if (token.type === 'ref') {
            // Expand
            const sub = evaluateRule(rules, token.name, context);
            expanded.push(...sub);
        } else if (token.type === 'js') {
            // Backtick expression (standalone)
            try {
                const val = eval(token.value);
                expanded.push({ type: 'value', value: val });
            } catch (e) {
                console.warn('Failed to eval backtick:', token.value);
            }
        } else if (token.type === 'literal') {
            expanded.push({ type: 'value', value: token.value });
        }
    }
    return expanded;
}

function expandToOps(expanded) {
    // Flatten expansions and produce a flat list of op objects
    const ops = [];
    for (let item of expanded) {
        if (item.type === 'op') {
            ops.push(item);
        } else if (item.type === 'expansion' && item.tokens) {
            ops.push(...expandToOps(item.tokens));
        } else if (item.type === 'value') {
            // plain values could be used directly
        }
    }
    return ops;
}

// Generate full terrain command sequence
function generateTerrain(rulesText) {
    const rules = parseTerrainGrammar(rulesText);
    const context = {};

    // First: get terrain config (size)
    // Evaluate top-level <terrain> to get all ops
    const expanded = evaluateRule(rules, 'terrain', context);
    const ops = expandToOps(expanded);

    // Extract config values from ops
    for (let op of ops) {
        if (op.name === 'SIZE') {
            context.size = parseInt(op.args[0]);
        } else if (op.name === 'HEIGHTMAP') {
            context.noiseScale = parseFloat(op.args[0]);
            context.octaves = parseInt(op.args[1]);
            context.persistence = parseFloat(op.args[2]);
            context.lacunarity = parseFloat(op.args[3]);
            context.seed = parseInt(op.args[4]);
        } else if (op.name === 'RIVERS') {
            context.riverCount = parseInt(op.args[0]);
        } else if (op.name === 'BIOMES') {
            context.moisture = parseFloat(op.args[0]);
        } else if (op.name === 'CONTOURS') {
            context.contourInterval = parseInt(op.args[0]);
        }
    }

    // Defaults
    context.size = context.size || 512;
    context.noiseScale = context.noiseScale || 80;
    context.octaves = context.octaves || 5;
    context.persistence = context.persistence || 0.5;
    context.lacunarity = context.lacunarity || 2.0;
    context.seed = context.seed || Math.floor(Math.random()*100000);
    context.riverCount = context.riverCount || 8;
    context.moisture = context.moisture || 0.5;
    context.contourInterval = context.contourInterval || 20;

    return context;
}

export default {
    parseTerrainGrammar,
    evaluateRule,
    generateTerrain
};
