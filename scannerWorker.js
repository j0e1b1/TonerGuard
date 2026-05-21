self.onmessage = function (event) {
    const { buffer, messageId } = event.data;
    const data = new Uint8ClampedArray(buffer);

    const threshold = 15;
    const pixelSkip = 10;
    const step = pixelSkip * 4;

    let colorCount = 0;
    let total = 0;

    const earlyExitRatio = 0.01;
    const estimatedSamples = data.length / step;
    const requiredColorPixels = estimatedSamples * earlyExitRatio;

    for (let i = 0; i < data.length; i += step) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        if (data[i + 3] < 10) continue;

        let max = r;
        let min = r;

        if (g > max) max = g;
        if (b > max) max = b;

        if (g < min) min = g;
        if (b < min) min = b;

        const diff = max - min;

        if (diff < 3) continue;
        if (min > 245) continue;

        total++;

        if (diff > threshold) {
            colorCount++;

            if (colorCount >= requiredColorPixels) {
                return self.postMessage({ isColor: true, messageId: messageId });
            }
        }
    }

    const finalResult = total > 0 && (colorCount / total) > earlyExitRatio;
    self.postMessage({ isColor: finalResult, messageId: messageId });
}