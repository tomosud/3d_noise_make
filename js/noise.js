// ============================================================
// noise.js — Periodic 3D Perlin Noise + Seeded PRNG + fBm
// ============================================================

(function () {
    'use strict';

    // --- Seeded PRNG (Mulberry32) ---
    function mulberry32(seed) {
        return function () {
            seed |= 0;
            seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // --- Permutation table (512 entries, seeded) ---
    function buildPermTable(seed) {
        var rng = mulberry32(seed);
        var p = new Uint8Array(256);
        var i, j, tmp;
        for (i = 0; i < 256; i++) p[i] = i;
        // Fisher-Yates shuffle
        for (i = 255; i > 0; i--) {
            j = (rng() * (i + 1)) | 0;
            tmp = p[i]; p[i] = p[j]; p[j] = tmp;
        }
        var perm = new Uint16Array(512);
        for (i = 0; i < 512; i++) perm[i] = p[i & 255];
        return perm;
    }

    // --- 12 gradient directions for 3D Perlin ---
    var GRAD3 = [
        1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
        1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
        0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
    ];

    function grad3dot(hash, x, y, z) {
        var idx = hash * 3;
        return GRAD3[idx] * x + GRAD3[idx + 1] * y + GRAD3[idx + 2] * z;
    }

    // --- Fade: 6t^5 - 15t^4 + 10t^3 ---
    function fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    // --- Linear interpolation ---
    function lerp(a, b, t) {
        return a + t * (b - a);
    }

    // --- Periodic modulo (handles negatives) ---
    function pmod(n, p) {
        return ((n % p) + p) % p;
    }

    // ============================================================
    // Periodic 3D Perlin Noise
    //
    // Grid coordinates are wrapped via modulo before hashing,
    // guaranteeing exact periodicity in all 3 axes.
    //
    // @param x, y, z    — sample coordinates
    // @param px, py, pz — period in each axis (positive integers)
    // @param perm       — 512-entry permutation table
    // @returns          — noise value in approximately [-1, 1]
    // ============================================================
    function pnoise3d(x, y, z, px, py, pz, perm) {
        // Integer part
        var xi = Math.floor(x);
        var yi = Math.floor(y);
        var zi = Math.floor(z);

        // Fractional part
        var xf = x - xi;
        var yf = y - yi;
        var zf = z - zi;

        // Wrap integer coords to period
        var xi0 = pmod(xi, px);
        var yi0 = pmod(yi, py);
        var zi0 = pmod(zi, pz);
        var xi1 = (xi0 + 1) % px;
        var yi1 = (yi0 + 1) % py;
        var zi1 = (zi0 + 1) % pz;

        // Fade curves
        var u = fade(xf);
        var v = fade(yf);
        var w = fade(zf);

        // Hash 8 corners — chained permutation lookup
        // Apply & 255 to all coordinates before indexing to keep within
        // the 256-entry base table (doubled to 512). This prevents
        // out-of-bounds access when period > 256 at high octaves.
        // Periodicity is preserved because pmod already wraps coords.
        var h000 = perm[(perm[(perm[xi0 & 255] + yi0) & 255] + zi0) & 255] % 12;
        var h100 = perm[(perm[(perm[xi1 & 255] + yi0) & 255] + zi0) & 255] % 12;
        var h010 = perm[(perm[(perm[xi0 & 255] + yi1) & 255] + zi0) & 255] % 12;
        var h110 = perm[(perm[(perm[xi1 & 255] + yi1) & 255] + zi0) & 255] % 12;
        var h001 = perm[(perm[(perm[xi0 & 255] + yi0) & 255] + zi1) & 255] % 12;
        var h101 = perm[(perm[(perm[xi1 & 255] + yi0) & 255] + zi1) & 255] % 12;
        var h011 = perm[(perm[(perm[xi0 & 255] + yi1) & 255] + zi1) & 255] % 12;
        var h111 = perm[(perm[(perm[xi1 & 255] + yi1) & 255] + zi1) & 255] % 12;

        // Gradient dot products
        var n000 = grad3dot(h000, xf, yf, zf);
        var n100 = grad3dot(h100, xf - 1, yf, zf);
        var n010 = grad3dot(h010, xf, yf - 1, zf);
        var n110 = grad3dot(h110, xf - 1, yf - 1, zf);
        var n001 = grad3dot(h001, xf, yf, zf - 1);
        var n101 = grad3dot(h101, xf - 1, yf, zf - 1);
        var n011 = grad3dot(h011, xf, yf - 1, zf - 1);
        var n111 = grad3dot(h111, xf - 1, yf - 1, zf - 1);

        // Trilinear interpolation
        var nx00 = lerp(n000, n100, u);
        var nx10 = lerp(n010, n110, u);
        var nx01 = lerp(n001, n101, u);
        var nx11 = lerp(n011, n111, u);
        var nxy0 = lerp(nx00, nx10, v);
        var nxy1 = lerp(nx01, nx11, v);
        return lerp(nxy0, nxy1, w);
    }

    // ============================================================
    // fBm (Fractal Brownian Motion) — periodic
    //
    // @param x, y, z — normalized coords in [0, 1)
    // @param params  — { frequency, octaves, lacunarity, gain, perm }
    // @returns       — noise value normalized to approx [-1, 1]
    // ============================================================
    function fbm3d(x, y, z, params) {
        var frequency = params.frequency;
        var octaves = params.octaves;
        var lacunarity = params.lacunarity;
        var gain = params.gain;
        var perm = params.perm;

        var value = 0;
        var amplitude = 1;
        var freq = frequency;
        var maxAmplitude = 0;

        for (var i = 0; i < octaves; i++) {
            // Period at this octave = freq (integer) to ensure tiling
            var period = Math.round(freq);
            if (period < 1) period = 1;

            value += amplitude * pnoise3d(
                x * freq, y * freq, z * freq,
                period, period, period,
                perm
            );

            maxAmplitude += amplitude;
            amplitude *= gain;
            freq *= lacunarity;
        }

        return value / maxAmplitude;
    }

    // ============================================================
    // Domain Warp — displaces coordinates via offset noise
    //
    // Note: breaks strict tileability. Use with caution.
    //
    // @param x, y, z       — normalized coords [0, 1)
    // @param warpStrength   — displacement magnitude (0 = off)
    // @param params         — fBm params (with separate warp seed offset)
    // @returns              — { x, y, z } warped coordinates
    // ============================================================
    function domainWarp(x, y, z, warpStrength, params) {
        if (warpStrength === 0) return { x: x, y: y, z: z };

        // Use large offsets to decorrelate warp noise from main noise
        var ox = 5.2, oy = 1.3, oz = 9.7;

        var wx = fbm3d(x + ox, y + ox, z + ox, params);
        var wy = fbm3d(x + oy, y + oy, z + oy, params);
        var wz = fbm3d(x + oz, y + oz, z + oz, params);

        return {
            x: x + wx * warpStrength,
            y: y + wy * warpStrength,
            z: z + wz * warpStrength
        };
    }

    // --- Export ---
    var NoiseModule = {
        mulberry32: mulberry32,
        buildPermTable: buildPermTable,
        pnoise3d: pnoise3d,
        fbm3d: fbm3d,
        domainWarp: domainWarp
    };

    if (typeof self !== 'undefined') {
        self.NoiseModule = NoiseModule;
    }
})();
