// ============================================================
// ui.js — UI Controller, Preview, Download Logic
// ============================================================

(function () {
    'use strict';

    var worker = null;
    var currentResult = null;
    var tileMode = false; // false = single, true = 3x3 tile

    // --- Read all parameters from UI ---
    function readConfig() {
        return {
            resolution: parseInt(document.getElementById('resolution').value, 10),
            seed: parseInt(document.getElementById('seed').value, 10),
            frequency: parseInt(document.getElementById('frequency').value, 10),
            octaves: parseInt(document.getElementById('octaves').value, 10),
            lacunarity: parseInt(document.getElementById('lacunarity').value, 10),
            gain: parseFloat(document.getElementById('gain').value),
            warpStrength: parseFloat(document.getElementById('warpStrength').value),
            gamma: parseFloat(document.getElementById('gamma').value),
            brightness: parseFloat(document.getElementById('brightness').value),
            contrast: parseFloat(document.getElementById('contrast').value),
            threshold: parseFloat(document.getElementById('threshold').value)
        };
    }

    // --- Validate config ---
    function validateConfig(config) {
        if (config.resolution < 16 || config.resolution > 256) {
            alert('Resolution must be between 16 and 256.');
            return false;
        }
        if (config.frequency < 1 || config.frequency > 32) {
            alert('Frequency must be between 1 and 32.');
            return false;
        }
        if (config.octaves < 1 || config.octaves > 8) {
            alert('Octaves must be between 1 and 8.');
            return false;
        }
        return true;
    }

    // --- UI busy state ---
    function setUIBusy(busy) {
        document.getElementById('btn-generate').disabled = busy;
        document.getElementById('progress-container').style.display = busy ? 'block' : 'none';
        if (busy) {
            document.getElementById('progress-bar').style.width = '0%';
            document.getElementById('progress-text').textContent = '0%';
        }
    }

    function enableDownloads(enabled) {
        document.getElementById('btn-png').disabled = !enabled;
        document.getElementById('btn-raw').disabled = !enabled;
        document.getElementById('btn-json').disabled = !enabled;
    }

    // --- Progress update ---
    function updateProgress(percent) {
        var p = Math.round(percent);
        document.getElementById('progress-bar').style.width = p + '%';
        document.getElementById('progress-text').textContent = p + '%';
    }

    // --- Build ImageData for a single Z slice ---
    function buildSliceImageData(z) {
        var N = currentResult.resolution;
        var volume = currentResult.volume;
        var imageData = new ImageData(N, N);
        var pixels = imageData.data;

        for (var y = 0; y < N; y++) {
            for (var x = 0; x < N; x++) {
                var density = volume[z * N * N + y * N + x];
                var val8 = (density * 255 + 0.5) | 0;
                if (val8 > 255) val8 = 255;
                var idx = (y * N + x) * 4;
                pixels[idx] = val8;
                pixels[idx + 1] = val8;
                pixels[idx + 2] = val8;
                pixels[idx + 3] = 255;
            }
        }
        return imageData;
    }

    // --- Single slice preview ---
    function updateSlicePreview(z) {
        if (!currentResult) return;

        var N = currentResult.resolution;
        var singleCanvas = document.getElementById('preview-canvas');
        var ctx = singleCanvas.getContext('2d');
        singleCanvas.width = N;
        singleCanvas.height = N;

        var imageData = buildSliceImageData(z);
        ctx.putImageData(imageData, 0, 0);

        document.getElementById('z-label').textContent = z;

        // Update tile canvas too if in tile mode
        if (tileMode) {
            updateTilePreview(z);
        }
    }

    // --- 3x3 tile preview ---
    function updateTilePreview(z) {
        if (!currentResult) return;

        var N = currentResult.resolution;
        var tileCanvas = document.getElementById('tile-canvas');
        var ctx = tileCanvas.getContext('2d');
        var tileCount = 3;
        tileCanvas.width = N * tileCount;
        tileCanvas.height = N * tileCount;

        var imageData = buildSliceImageData(z);

        // Create a temp canvas for the single tile
        var tmp = document.createElement('canvas');
        tmp.width = N;
        tmp.height = N;
        tmp.getContext('2d').putImageData(imageData, 0, 0);

        // Draw 3x3 grid
        for (var ty = 0; ty < tileCount; ty++) {
            for (var tx = 0; tx < tileCount; tx++) {
                ctx.drawImage(tmp, tx * N, ty * N);
            }
        }
    }

    // --- Toggle preview mode ---
    function setTileMode(enabled) {
        tileMode = enabled;
        var singleCanvas = document.getElementById('preview-canvas');
        var tileCanvas = document.getElementById('tile-canvas');
        var btnSingle = document.getElementById('btn-single');
        var btnTile = document.getElementById('btn-tile');

        if (enabled) {
            singleCanvas.style.display = 'none';
            tileCanvas.style.display = 'block';
            btnSingle.classList.remove('active');
            btnTile.classList.add('active');
            // Render tile view
            var z = parseInt(document.getElementById('z-slider').value, 10);
            updateTilePreview(z);
        } else {
            singleCanvas.style.display = 'block';
            tileCanvas.style.display = 'none';
            btnSingle.classList.add('active');
            btnTile.classList.remove('active');
        }
    }

    // --- Handle worker result ---
    function handleResult(data) {
        currentResult = {
            volume: new Float32Array(data.volume),
            atlasBuffer: data.atlasBuffer,
            layout: data.layout,
            metadata: data.metadata,
            verification: data.verification,
            resolution: data.resolution
        };

        setUIBusy(false);
        enableDownloads(true);

        // Show preview
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('slice-preview').style.display = 'block';

        var N = currentResult.resolution;
        var slider = document.getElementById('z-slider');
        slider.max = N - 1;
        slider.value = 0;
        updateSlicePreview(0);

        // Verification
        displayVerification(data.verification, data.metadata.noiseParams.warpStrength);

        // Layout info
        var layout = data.layout;
        document.getElementById('layout-info').innerHTML =
            'Atlas: ' + layout.atlasWidth + ' x ' + layout.atlasHeight + 'px' +
            ' | Tiles: ' + layout.tilesX + ' x ' + layout.tilesY +
            ' | Slices: ' + N;
    }

    // --- Verification display ---
    function displayVerification(result, warpStrength) {
        var el = document.getElementById('verification-status');
        el.style.display = 'block';
        if (warpStrength > 0) {
            el.textContent = 'Tileability: APPROXIMATE (domain warp active, max error: ' +
                result.maxError.toExponential(2) + ')';
            el.className = 'status-warn';
        } else if (result.tileable) {
            el.textContent = 'Tileability: PASS (max boundary error: ' +
                result.maxError.toExponential(2) + ')';
            el.className = 'status-pass';
        } else {
            el.textContent = 'Tileability: FAIL (max boundary error: ' +
                result.maxError.toExponential(2) + ')';
            el.className = 'status-fail';
        }
    }

    // --- Download helpers ---
    function triggerDownload(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // ============================================================
    // Minimal 16-bit grayscale PNG encoder using pako for zlib
    // PNG spec: signature + IHDR + IDAT(s) + IEND
    // ============================================================
    function encodePNG16Gray(data, width, height) {
        // data: Uint8Array of big-endian 16-bit grayscale (2 bytes/pixel)
        var bytesPerPixel = 2; // 16-bit grayscale

        // Build raw scanlines: filter_byte(0) + row data for each row
        var rowBytes = width * bytesPerPixel;
        var rawSize = height * (1 + rowBytes);
        var raw = new Uint8Array(rawSize);
        var offset = 0;
        for (var y = 0; y < height; y++) {
            raw[offset++] = 0; // filter: None
            var srcOffset = y * rowBytes;
            for (var i = 0; i < rowBytes; i++) {
                raw[offset++] = data[srcOffset + i];
            }
        }

        // Compress with pako (zlib deflate)
        var compressed = pako.deflate(raw);

        // --- Build PNG file ---
        // Helper: write 4-byte big-endian uint32
        function writeU32(arr, pos, val) {
            arr[pos]     = (val >>> 24) & 0xFF;
            arr[pos + 1] = (val >>> 16) & 0xFF;
            arr[pos + 2] = (val >>> 8) & 0xFF;
            arr[pos + 3] = val & 0xFF;
        }

        // CRC32 table (standard PNG CRC)
        var crcTable = null;
        function makeCRCTable() {
            crcTable = new Uint32Array(256);
            for (var n = 0; n < 256; n++) {
                var c = n;
                for (var k = 0; k < 8; k++) {
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                }
                crcTable[n] = c;
            }
        }
        function crc32(buf, start, len) {
            if (!crcTable) makeCRCTable();
            var crc = 0xFFFFFFFF;
            for (var i = start; i < start + len; i++) {
                crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
            }
            return (crc ^ 0xFFFFFFFF) >>> 0;
        }

        // PNG signature: 8 bytes
        var signature = [137, 80, 78, 71, 13, 10, 26, 10];

        // IHDR chunk: 13 bytes data
        var ihdrData = new Uint8Array(13);
        writeU32(ihdrData, 0, width);
        writeU32(ihdrData, 4, height);
        ihdrData[8]  = 16; // bit depth
        ihdrData[9]  = 0;  // color type: grayscale
        ihdrData[10] = 0;  // compression: deflate
        ihdrData[11] = 0;  // filter: adaptive
        ihdrData[12] = 0;  // interlace: none

        // Build chunk: length(4) + type(4) + data + crc(4)
        function buildChunk(type, chunkData) {
            var len = chunkData.length;
            var chunk = new Uint8Array(4 + 4 + len + 4);
            writeU32(chunk, 0, len);
            chunk[4] = type.charCodeAt(0);
            chunk[5] = type.charCodeAt(1);
            chunk[6] = type.charCodeAt(2);
            chunk[7] = type.charCodeAt(3);
            chunk.set(chunkData, 8);
            var crcVal = crc32(chunk, 4, 4 + len);
            writeU32(chunk, 8 + len, crcVal);
            return chunk;
        }

        var ihdrChunk = buildChunk('IHDR', ihdrData);
        var idatChunk = buildChunk('IDAT', compressed);
        var iendChunk = buildChunk('IEND', new Uint8Array(0));

        // Assemble full PNG
        var totalSize = 8 + ihdrChunk.length + idatChunk.length + iendChunk.length;
        var png = new Uint8Array(totalSize);
        var pos = 0;
        for (var s = 0; s < 8; s++) png[pos++] = signature[s];
        png.set(ihdrChunk, pos); pos += ihdrChunk.length;
        png.set(idatChunk, pos); pos += idatChunk.length;
        png.set(iendChunk, pos);

        return png;
    }

    function downloadPNG() {
        if (!currentResult) return;
        var layout = currentResult.layout;

        // atlasBuffer is already big-endian 16-bit grayscale
        var data = new Uint8Array(currentResult.atlasBuffer);
        var pngData = encodePNG16Gray(data, layout.atlasWidth, layout.atlasHeight);

        var blob = new Blob([pngData], { type: 'image/png' });
        var N = currentResult.resolution;
        triggerDownload(blob, 'noise3d_' + N + '.png');
    }

    function downloadRAW() {
        if (!currentResult) return;
        var N = currentResult.resolution;

        // Generate RAW from volume data
        var rawBuffer = GeneratorModule.volumeToRAW16(currentResult.volume, N);
        var blob = new Blob([rawBuffer], { type: 'application/octet-stream' });
        triggerDownload(blob, 'noise3d_' + N + '.raw');
    }

    function downloadJSON() {
        if (!currentResult) return;
        var json = JSON.stringify(currentResult.metadata, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        triggerDownload(blob, 'noise3d_' + currentResult.resolution + '.json');
    }

    // --- Generate button ---
    function onGenerate() {
        var config = readConfig();
        if (!validateConfig(config)) return;

        setUIBusy(true);
        enableDownloads(false);
        currentResult = null;

        worker.postMessage({
            command: 'generate',
            config: config
        });
    }

    // --- Range input live display ---
    function bindRange(id) {
        var input = document.getElementById(id);
        var display = document.getElementById(id + '-val');
        if (!input || !display) return;
        function update() {
            var v = parseFloat(input.value);
            display.textContent = Number.isInteger(v) ? v : v.toFixed(2);
        }
        input.addEventListener('input', update);
        update();
    }

    // --- Warp warning ---
    function updateWarpWarning() {
        var val = parseFloat(document.getElementById('warpStrength').value);
        document.getElementById('warp-warning').style.display = val > 0 ? 'block' : 'none';
    }

    // --- Init ---
    function init() {
        // Create worker
        worker = new Worker('js/worker.js');

        worker.onmessage = function (e) {
            var data = e.data;
            switch (data.type) {
                case 'progress':
                    updateProgress(data.percent);
                    break;
                case 'result':
                    handleResult(data);
                    break;
                case 'verification':
                    displayVerification(data.result, 0);
                    break;
            }
        };

        worker.onerror = function (e) {
            setUIBusy(false);
            alert('Worker error: ' + e.message);
            console.error('Worker error:', e);
        };

        // Bind buttons
        document.getElementById('btn-generate').addEventListener('click', onGenerate);
        document.getElementById('btn-png').addEventListener('click', downloadPNG);
        document.getElementById('btn-raw').addEventListener('click', downloadRAW);
        document.getElementById('btn-json').addEventListener('click', downloadJSON);

        // Bind preview mode toggle
        document.getElementById('btn-single').addEventListener('click', function () {
            setTileMode(false);
        });
        document.getElementById('btn-tile').addEventListener('click', function () {
            setTileMode(true);
        });

        // Bind Z slider
        document.getElementById('z-slider').addEventListener('input', function () {
            updateSlicePreview(parseInt(this.value, 10));
        });

        // Bind range displays
        bindRange('octaves');
        bindRange('warpStrength');

        // Warp warning
        document.getElementById('warpStrength').addEventListener('input', updateWarpWarning);
        updateWarpWarning();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
