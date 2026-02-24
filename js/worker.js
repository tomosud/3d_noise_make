// ============================================================
// worker.js — WebWorker for background noise generation
// ============================================================

importScripts('noise.js', 'generator.js');

self.onmessage = function (e) {
    var data = e.data;
    var command = data.command;
    var config = data.config;

    switch (command) {
        case 'generate':
            handleGenerate(config);
            break;
        case 'verify':
            handleVerify(config);
            break;
    }
};

function handleGenerate(config) {
    // Step 1: Generate volume
    var volume = GeneratorModule.generateVolume(config, function (percent) {
        self.postMessage({ type: 'progress', percent: percent });
    });

    // Step 2: Verify tileability
    var verification = GeneratorModule.verifyTileabilityBySampling(config);

    // Step 3: Build atlas (16-bit big-endian for PNG)
    var atlasResult = GeneratorModule.volumeToAtlas16(volume, config.resolution);

    // Step 4: Generate metadata
    var metadata = GeneratorModule.generateMetadata(config, atlasResult.layout);

    // Step 5: Transfer results to main thread
    self.postMessage({
        type: 'result',
        volume: volume.buffer,
        atlasBuffer: atlasResult.buffer,
        layout: atlasResult.layout,
        metadata: metadata,
        verification: verification,
        resolution: config.resolution
    }, [volume.buffer, atlasResult.buffer]);
}

function handleVerify(config) {
    var result = GeneratorModule.verifyTileabilityBySampling(config);
    self.postMessage({ type: 'verification', result: result });
}
