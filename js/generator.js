// ============================================================
// generator.js — 3D Volume Generation, Atlas Layout, 16-bit Encoding
// ============================================================

(function () {
    'use strict';

    // ---- Density Remapping ----
    function applyRemap(d, config) {
        // Threshold
        if (d < config.threshold) d = 0;

        // Contrast (around 0.5 midpoint)
        d = (d - 0.5) * config.contrast + 0.5;

        // Brightness
        d += config.brightness;

        // Gamma
        d = Math.max(0, d);
        if (config.gamma !== 1.0) {
            d = Math.pow(d, config.gamma);
        }

        // Clamp [0, 1]
        if (d < 0) d = 0;
        if (d > 1) d = 1;
        return d;
    }

    // ============================================================
    // Generate 3D noise volume
    //
    // @param config      — all generation parameters
    // @param onProgress  — callback(percent) for progress reporting
    // @returns Float32Array of N*N*N density values in [0, 1]
    //          Layout: volume[z * N * N + y * N + x]
    // ============================================================
    function generateVolume(config, onProgress) {
        var N = config.resolution;
        var perm = NoiseModule.buildPermTable(config.seed);
        var noiseParams = {
            frequency: config.frequency,
            octaves: config.octaves,
            lacunarity: config.lacunarity,
            gain: config.gain,
            perm: perm
        };

        var volume = new Float32Array(N * N * N);
        var invN = 1.0 / N;
        var useWarp = config.warpStrength > 0;

        for (var z = 0; z < N; z++) {
            var tz = z * invN;
            for (var y = 0; y < N; y++) {
                var ty = y * invN;
                for (var x = 0; x < N; x++) {
                    var tx = x * invN;

                    var sx = tx, sy = ty, sz = tz;
                    if (useWarp) {
                        var warped = NoiseModule.domainWarp(tx, ty, tz, config.warpStrength, noiseParams);
                        sx = warped.x;
                        sy = warped.y;
                        sz = warped.z;
                    }

                    // fBm noise: coords in [0,1), scaled by frequency inside fbm3d
                    var density = NoiseModule.fbm3d(sx, sy, sz, noiseParams);

                    // Map [-1, 1] -> [0, 1]
                    density = density * 0.5 + 0.5;

                    // Apply density remap
                    density = applyRemap(density, config);

                    volume[z * N * N + y * N + x] = density;
                }
            }
            if (onProgress) onProgress(((z + 1) / N) * 100);
        }

        return volume;
    }

    // ---- Atlas Layout ----
    // Finds the largest factor of N that is <= sqrt(N), ensuring exact fit (no gaps).
    // e.g. N=64 -> 8x8, N=128 -> 16x8
    function computeAtlasLayout(N) {
        var sqrtN = Math.sqrt(N);
        var tilesY = 1;
        for (var i = Math.floor(sqrtN); i >= 1; i--) {
            if (N % i === 0) {
                tilesY = i;
                break;
            }
        }
        var tilesX = N / tilesY;
        return {
            tilesX: tilesX,
            tilesY: tilesY,
            atlasWidth: tilesX * N,
            atlasHeight: tilesY * N,
            totalTiles: tilesX * tilesY
        };
    }

    // ============================================================
    // Convert volume to 16-bit big-endian grayscale atlas buffer
    // (suitable for UPNG.encodeLL)
    //
    // @param volume — Float32Array (N^3 values in [0,1])
    // @param N      — volume resolution
    // @returns { buffer: ArrayBuffer, layout: Object }
    // ============================================================
    function volumeToAtlas16(volume, N) {
        var layout = computeAtlasLayout(N);
        var w = layout.atlasWidth;
        var h = layout.atlasHeight;

        // 2 bytes per pixel (16-bit grayscale, big-endian for PNG)
        var buffer = new Uint8Array(w * h * 2);
        // Initialized to 0 — unused tiles are already black

        for (var sliceZ = 0; sliceZ < N; sliceZ++) {
            var tileCol = sliceZ % layout.tilesX;
            var tileRow = (sliceZ / layout.tilesX) | 0;

            for (var y = 0; y < N; y++) {
                for (var x = 0; x < N; x++) {
                    var density = volume[sliceZ * N * N + y * N + x];
                    var val16 = (density * 65535 + 0.5) | 0;
                    if (val16 > 65535) val16 = 65535;

                    var atlasX = tileCol * N + x;
                    var atlasY = tileRow * N + y;
                    var idx = (atlasY * w + atlasX) * 2;

                    // Big-endian: high byte first
                    buffer[idx] = (val16 >> 8) & 0xFF;
                    buffer[idx + 1] = val16 & 0xFF;
                }
            }
        }

        return { buffer: buffer.buffer, layout: layout };
    }

    // ---- RAW 16-bit (little-endian, Uint16Array native) ----
    function volumeToRAW16(volume, N) {
        var raw = new Uint16Array(N * N * N);
        for (var i = 0; i < volume.length; i++) {
            var v = (volume[i] * 65535 + 0.5) | 0;
            if (v > 65535) v = 65535;
            raw[i] = v;
        }
        return raw.buffer;
    }

    // ---- JSON Metadata ----
    function generateMetadata(config, layout) {
        return {
            format: "3D Noise Atlas",
            version: "1.0",
            volumeResolution: config.resolution,
            atlasWidth: layout.atlasWidth,
            atlasHeight: layout.atlasHeight,
            tilesX: layout.tilesX,
            tilesY: layout.tilesY,
            sliceCount: config.resolution,
            sliceOrder: "row-major, Z=0 at top-left, Z increases left-to-right then top-to-bottom",
            bitDepth: 16,
            colorType: "grayscale",
            noiseParams: {
                seed: config.seed,
                frequency: config.frequency,
                octaves: config.octaves,
                lacunarity: config.lacunarity,
                gain: config.gain,
                warpStrength: config.warpStrength,
                gamma: config.gamma,
                brightness: config.brightness,
                contrast: config.contrast,
                threshold: config.threshold
            },
            unrealImport: {
                instructions: [
                    "1. Import the PNG atlas into UE Content Browser",
                    "2. Double-click the imported texture to open Texture Editor",
                    "3. In the Details panel, find 'Volume Texture' section",
                    "4. Set 'Tile Size X' = " + config.resolution,
                    "5. Set 'Tile Size Y' = " + config.resolution,
                    "6. Right-click the texture asset > Create Volume Texture",
                    "7. Set compression to VectorDisplacementmap (HDR) or Grayscale for best quality",
                    "8. The resulting Volume Texture will be " + config.resolution + "x" + config.resolution + "x" + config.resolution
                ]
            }
        };
    }

    // ============================================================
    // Tileability Verification
    //
    // Re-samples noise at boundary points and checks that
    // noise(coord=0) === noise(coord=1.0) for all 3 axes.
    // ============================================================
    function verifyTileabilityBySampling(config) {
        var N = config.resolution;
        var perm = NoiseModule.buildPermTable(config.seed);
        var params = {
            frequency: config.frequency,
            octaves: config.octaves,
            lacunarity: config.lacunarity,
            gain: config.gain,
            perm: perm
        };
        var maxErr = 0;

        // Test a grid of points on each boundary face
        var testRes = Math.min(N, 32);
        var invTest = 1.0 / testRes;

        for (var a = 0; a < testRes; a++) {
            var ta = a * invTest;
            for (var b = 0; b < testRes; b++) {
                var tb = b * invTest;

                // X boundary: x=0 vs x=1.0
                var nx0 = NoiseModule.fbm3d(0.0, ta, tb, params);
                var nx1 = NoiseModule.fbm3d(1.0, ta, tb, params);
                var err = Math.abs(nx0 - nx1);
                if (err > maxErr) maxErr = err;

                // Y boundary: y=0 vs y=1.0
                var ny0 = NoiseModule.fbm3d(ta, 0.0, tb, params);
                var ny1 = NoiseModule.fbm3d(ta, 1.0, tb, params);
                err = Math.abs(ny0 - ny1);
                if (err > maxErr) maxErr = err;

                // Z boundary: z=0 vs z=1.0
                var nz0 = NoiseModule.fbm3d(ta, tb, 0.0, params);
                var nz1 = NoiseModule.fbm3d(ta, tb, 1.0, params);
                err = Math.abs(nz0 - nz1);
                if (err > maxErr) maxErr = err;
            }
        }

        return { tileable: maxErr < 1e-10, maxError: maxErr };
    }

    // --- Export ---
    var GeneratorModule = {
        generateVolume: generateVolume,
        computeAtlasLayout: computeAtlasLayout,
        volumeToAtlas16: volumeToAtlas16,
        volumeToRAW16: volumeToRAW16,
        generateMetadata: generateMetadata,
        verifyTileabilityBySampling: verifyTileabilityBySampling,
        applyRemap: applyRemap
    };

    if (typeof self !== 'undefined') {
        self.GeneratorModule = GeneratorModule;
    }
})();
