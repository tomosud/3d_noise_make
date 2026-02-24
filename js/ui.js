// ============================================================
// ui.js — UI Controller, Preview, Download Logic
// ============================================================

(function () {
    'use strict';

    var worker = null;
    var currentResult = null;

    // --- Read all parameters from UI ---
    function readConfig() {
        return {
            resolution: parseInt(document.getElementById('resolution').value, 10),
            seed: parseInt(document.getElementById('seed').value, 10),
            frequency: parseInt(document.getElementById('frequency').value, 10),
            octaves: parseInt(document.getElementById('octaves').value, 10),
            lacunarity: parseFloat(document.getElementById('lacunarity').value),
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

    // --- Slice preview ---
    function updateSlicePreview(z) {
        if (!currentResult) return;

        var canvas = document.getElementById('preview-canvas');
        var ctx = canvas.getContext('2d');
        var N = currentResult.resolution;
        var volume = currentResult.volume;

        canvas.width = N;
        canvas.height = N;

        var imageData = ctx.createImageData(N, N);
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

        ctx.putImageData(imageData, 0, 0);

        document.getElementById('z-label').textContent = z;
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

    function downloadPNG() {
        if (!currentResult) return;
        var layout = currentResult.layout;

        // UPNG.encodeLL: encode 16-bit grayscale PNG
        var pngData = UPNG.encodeLL(
            [currentResult.atlasBuffer],
            layout.atlasWidth,
            layout.atlasHeight,
            1,    // 1 channel (grayscale)
            0,    // no alpha
            16    // 16-bit depth
        );

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
