// Terrain Grammar Parser (tgrid)
// Recursive descent parser + evaluator for terrain.rules

function parseTerrainGrammar(text) {
    const rules = {};
    const lines = text.split('\n');

    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;
        if (!line.includes('=>')) continue;

        const [lhsRaw, rhsRaw] = line.split('=>').map(s => s.trim());
        const lhs = lhsRaw.replace(/[<>]/g, '');

        // Split RHS by '|' at top level (outside parentheses)
        const alternatives = [];
        let current = '';
        let depth = 0;
        for (let ch of rhsRaw) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === '|' && depth === 0) {
                alternatives.push(current.trim());
                current = '';
            } else current += ch;
        }
        if (current.trim()) alternatives.push(current.trim());

        const parsedAlts = [];
        for (let alt of alternatives) {
            const weightMatch = alt.match(/\[(\d+)\]$/);
            const weight = weightMatch ? parseInt(weightMatch[1]) : 1;
            const rhs = weightMatch ? alt.slice(0, -weightMatch[0].length).trim() : alt;

            const tokens = [];
            let i = 0;
            while (i < rhs.length) {
                if (/\s/.test(rhs[i])) { i++; continue; }

                // Numeric literal (integer or decimal)
                if (/[0-9]/.test(rhs[i])) {
                    let j = i;
                    while (j < rhs.length && /[0-9.]/.test(rhs[j])) j++;
                    tokens.push({ type: 'literal', value: rhs.slice(i, j) });
                    i = j;
                    continue;
                }

                // <...> nonterminal or variable reference
                if (rhs[i] === '<') {
                    let j = i+1;
                    while (j < rhs.length && rhs[j] !== '>') j++;
                    const name = rhs.slice(i+1, j);
                    tokens.push({ type: 'ref', name });
                    i = j+1;
                    continue;
                }

                // `...` embedded JS
                if (rhs[i] === '`') {
                    let j = i+1;
                    while (j < rhs.length && rhs[j] !== '`') j++;
                    const expr = rhs.slice(i+1, j);
                    tokens.push({ type: 'js', value: expr });
                    i = j+1;
                    continue;
                }

                // identifier or function call
                if (/[a-zA-Z_]/.test(rhs[i])) {
                    let j = i;
                    while (j < rhs.length && /[a-zA-Z0-9_]/.test(rhs[j])) j++;
                    const name = rhs.slice(i, j);
                    while (j < rhs.length && /\s/.test(rhs[j])) j++;

                    if (rhs[j] === '(') {
                        j++; // '('
                        const args = [];
                        let arg = '';
                        let depth = 1;
                        while (j < rhs.length && depth > 0) {
                            const c = rhs[j];
                            if (c === '(') { depth++; arg += c; }
                            else if (c === ')') { depth--; if (depth > 0) arg += c; }
                            else if (c === ',' && depth === 1) {
                                args.push(arg.trim());
                                arg = '';
                            } else { arg += c; }
                            j++;
                        }
                        if (arg.trim()) args.push(arg.trim());
                        tokens.push({ type: 'call', name, args });
                    } else {
                        tokens.push({ type: 'literal', value: name });
                    }
                    i = j;
                    continue;
                }

                // Unknown char - skip
                i++;
            }

            parsedAlts.push({ tokens, weight });
        }

        if (!rules[lhs]) rules[lhs] = [];
        rules[lhs].push(...parsedAlts);
    }

    return rules;
}

// Evaluate a single argument string to a primitive value
function evalArg(arg, context, rules) {
    const s = arg.trim();
    // Variable reference: <$var>
    if (/^<\$(\w+)>$/.test(s)) {
        const varName = s.slice(2, -1);
        if (context[varName] !== undefined) return context[varName];
        // Resolve on demand if not yet
        if (rules['$' + varName]) {
            const val = resolveVariable(rules, '$' + varName, context);
            context[varName] = val;
            return val;
        }
        console.warn('Unknown variable', varName);
        return NaN;
    }
    // Backtick expression
    if (s.startsWith('`') && s.endsWith('`')) {
        try {
            return eval(s.slice(1, -1));
        } catch(e) {
            console.warn('Eval failed:', s, e);
            return NaN;
        }
    }
    // Numeric literal
    const num = parseFloat(s);
    if (!isNaN(num)) return num;
    // String literal with quotes
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    // Plain string
    return s;
}

// Resolve a $variable to its value (randomly chosen alternative)
function resolveVariable(rules, name, context) {
    const alts = rules[name];
    if (!alts) return undefined;
    const totalW = alts.reduce((sum,a)=>sum+a.weight,0);
    let pick = Math.random()*totalW, chosen = null;
    for (let a of alts) { pick -= a.weight; if (pick<=0) { chosen=a; break; } }
    if (!chosen) chosen = alts[alts.length-1];
    if (chosen.tokens.length === 0) return undefined;
    const tok = chosen.tokens[0];
    if (tok.type === 'literal') return parseFloat(tok.value) || tok.value;
    if (tok.type === 'js') return eval(tok.value);
    return undefined;
}

// Resolve all $ variables in a first pass
function resolveAllVariables(rules) {
    const context = {};
    for (let name in rules) {
        if (name.startsWith('$')) {
            const varName = name.slice(1); // strip leading $
            context[varName] = resolveVariable(rules, name, context);
        }
    }
    return context;
}

// Evaluate a non-terminal into array of op objects
function evaluateRule(rules, symbol, context) {
    const alts = rules[symbol];
    if (!alts) return [];

    const totalW = alts.reduce((s,a)=>s+a.weight,0);
    let pick = Math.random()*totalW, chosen = null;
    for (let a of alts) { pick -= a.weight; if (pick<=0) { chosen=a; break; } }
    if (!chosen) chosen = alts[alts.length-1];

    const result = [];
    for (let token of chosen.tokens) {
        if (token.type === 'call') {
            const args = token.args.map(arg => evalArg(arg, context, rules));
            result.push({ type: 'op', name: token.name, args });
        } else if (token.type === 'ref') {
            // Expand non-$ non-terminal recursively
            const sub = evaluateRule(rules, token.name, context);
            result.push(...sub);
        } else if (token.type === 'literal') {
            // Push literal as value-op (unlikely for terrain but safe)
            const val = parseFloat(token.value) || token.value;
            result.push({ type: 'op', name: 'LITERAL', args: [val] });
        } else if (token.type === 'js') {
            try {
                const val = eval(token.value);
                result.push({ type: 'op', name: 'LITERAL', args: [val] });
            } catch(e) {}
        }
    }
    return result;
}

// Generate config from grammar
function generateTerrain(rulesText) {
    const rules = parseTerrainGrammar(rulesText);
    console.log('Parsed rules:', Object.keys(rules));
    const context = resolveAllVariables(rules);
    console.log('Resolved context:', context);
    const ops = evaluateRule(rules, 'terrain', context);

    const config = {
        size: 512,
        noiseScale: 80,
        octaves: 5,
        persistence: 0.5,
        lacunarity: 2.0,
        seed: Math.floor(Math.random()*100000),
        riverCount: 8,
        moisture: 0.5,
        contourInterval: 20
    };

    for (let op of ops) {
        switch(op.name) {
            case 'SIZE': config.size = op.args[0]; break;
            case 'HEIGHTMAP':
                config.noiseScale = op.args[0];
                config.octaves = op.args[1];
                config.persistence = op.args[2];
                config.lacunarity = op.args[3];
                config.seed = op.args[4];
                break;
            case 'RIVERS': config.riverCount = op.args[0]; break;
            case 'BIOMES': config.moisture = op.args[0]; break;
            case 'CONTOURS': config.contourInterval = op.args[0]; break;
        }
    }
    return config;
}

export default {
    parseTerrainGrammar,
    evaluateRule,
    generateTerrain
};
