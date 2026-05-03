//
//  Various utility functions.
//

//
//  Uniform random number from lo to hi.  If called with one argument,
//  should treat that as hi, with lo == 0
//
function rand(lo=0, hi=false) {
    if (!hi) {
	hi = lo;
	lo = 0;
    };
    if (isNaN(lo) || isNaN(hi)) {
	console.log('Utils.rand called with non-numbers.');
	debugger;
    };
    return lo + Math.random() * (hi - lo);
}

// Random real number in a range
// randRange(lo, hi)
// randRange([lo, hi])
// randRange(hi) lo == 0
function randRange(lo, hi=false) {
    if (!hi) {
	if (Array.isArray(lo)) {
	    hi = lo[1];
	    lo = lo[0];
	} else {
	    hi = lo;
	    lo = 0;
	};
    };
    return rand(lo, hi);
};

// Random integer from 0 to num-1
function randInt(num) {
    return Math.floor(Math.random()*num);
};

// Random integer in a range.
// randIntRange(lo, hi)
// randIntRange([lo, hi])
// randIntRange(hi) lo == 0
function randIntRange(lo, hi=false) {
    if (!hi) {
	if (Array.isArray(lo)) {
	    hi = lo[1];
	    lo = lo[0];
	} else {
	    hi = lo;
	    lo = 0;
	};
    };
    return Math.floor(randInt(hi-lo+1)+lo);
};

// rnorm is R for "random normal".  This generates a random
// number with mean 0 and std = 1.
function rnorm() {
    let rand = 0;
    for(let i = 0; i < 6; i++) {
    	rand += Math.random();
    }
    return (rand-3) / 3;
}

//  Randomly select an element from an array.
function randElement(choices) {
    let choice = Array.isArray(choices) ? choices[randInt(choices.length)] : choices;
    return choice;
};

function SyncFileReader(file) {
    let self = this;
    let ready = false;
    let result = '';

    const sleep = function (ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    };

    self.readAsArrayBuffer = async function() {
        while (ready === false) {
          await sleep(100);
        }
        return result;
    };    

    const reader = new FileReader();
    reader.onloadend = function(evt) {
        result = evt.target.result;
        ready = true;
    };
    reader.readAsDataURL(file);
};

function distance(p1, p2) {
    return Math.sqrt(Math.pow(p1[0]-p2[0],2)+Math.pow(p1[1]-p2[1],2));
}

//
//  Value Noise Generator
//  Creates smooth random values for terrain heightmaps
//  Usage:
//    let noise = new ValueNoise(scale, octaves, persistence, lacunarity);
//    let height = noise.get(x, z);
//
class ValueNoise {
    constructor(seed = Math.random() * 10000) {
        this.seed = seed;
        this.perm = [];
        // Generate permutation table (0-255 shuffled)
        for (let i = 0; i < 256; i++) this.perm[i] = i;
        // Shuffle using seed
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(this.rand(this.seed + i) * (i + 1));
            [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
            this.seed += 0.1;
        }
        // Duplicate for overflow
        for (let i = 0; i < 256; i++) this.perm[256 + i] = this.perm[i];
    }

    rand(seed) {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
    }

    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    lerp(a, b, t) {
        return a + t * (b - a);
    }

    grad(hash, x, z) {
        const h = hash & 15;
        const u = h < 8 ? x : z;
        const v = h < 4 ? z : h === 12 || h === 14 ? x : 0;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise2D(x, z) {
        const X = Math.floor(x) & 255;
        const Z = Math.floor(z) & 255;
        x -= Math.floor(x);
        z -= Math.floor(z);
        const u = this.fade(x);
        const v = this.fade(z);
        const A = this.perm[X] + Z, AA = this.perm[A], AB = this.perm[A + 1];
        const B = this.perm[X + 1] + Z, BA = this.perm[B], BB = this.perm[B + 1];

        return this.lerp(
            this.lerp(this.grad(this.perm[AA], x, z), this.grad(this.perm[BA], x - 1, z), u),
            this.lerp(this.grad(this.perm[AB], x, z - 1), this.grad(this.perm[BB], x - 1, z - 1), u),
            v
        );
    }

    // Multi-octave noise (fractal brownian motion)
    fbm(x, z, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            total += this.noise2D(x * frequency, z * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return total / maxValue;
    }

    // Get height in range 0-1
    getHeight(x, z, width, height, octaves, persistence, lacunarity) {
        const nx = (x / width) * 4 - 2;   // Scale to [-2, 2]
        const nz = (z / height) * 4 - 2;  // Scale to [-2, 2]
        let value = this.fbm(nx, nz, octaves, persistence, lacunarity);
        // Normalize from [-1,1] to [0,1]
        return (value + 1) / 2;
    }

    // Ridged multi-fractal for mountains
    ridged(x, z, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            let n = Math.abs(this.noise2D(x * frequency, z * frequency));
            n = 1 - n; // Invert for ridges
            n = n * n; // Sharpen ridgelines
            total += n * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return total / maxValue;
    }
}

export default {
    rand: rand,
    randRange: randRange,
    randInt: randInt,
    randIntRange: randIntRange,
    rnorm: rnorm,
    randElement: randElement,
    SyncFileReader: SyncFileReader,
    distance: distance,
    ValueNoise: ValueNoise,
    dummy: null
};
