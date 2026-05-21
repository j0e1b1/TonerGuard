self.onmessage = function (event) {
    const { buffer, width, height} = event.data;
    const data = new Uint8ClampedArray(buffer);

    const threshold = 15;
    const pixelSkip = 10;
    const step = pixelSkip * 4;

    let colorCount = 0;
    let total = 0;

    // Early-exit threshold: if enough color pixels are found, stop scanning immediately
    const earlyExitRatio = 0.01;

    // Approximate total sampled pixels
    const estimatedSamples = data.length / step;
    const requiredColorPixels = estimatedSamples * earlyExitRatio;

    for (let i = 0; i < data.length; i += step) {

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Skip transparent pixels
        if (data[i + 3] < 10) continue;

        let max = r;
        let min = r;

        if (g > max) max = g;
        if (b > max) max = b;

        if (g < min) min = g;
        if (b < min) min = b;

        const diff = max - min;

        // Fast rejection of grayscale pixels
        if (diff < 3) continue;

        // Skip near-white pixels
        if (min > 245) continue;

        total++;

        // Color detection
        if (diff > threshold) {
            colorCount++;

            // Early exit for obvious color pages
            if (colorCount >= requiredColorPixels) {
                return self.postMessage(true);
            }
        }
    }

    // Final ratio check
    const finalResult = total > 0 && (colorCount / total) > earlyExitRatio;
    self.postMessage(finalResult);
}