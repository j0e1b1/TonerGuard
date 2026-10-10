import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Tell PDF.js where to find the worker file
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function createWorkerPool() {
    const cpuCount = navigator.hardwareConcurrency || 4;
    const workerCount = Math.min(Math.max(2, Math.floor(cpuCount / 2)), 6);
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        workers.push(
            new Worker(new URL('./scannerWorker.js', import.meta.url), { type: 'module' })
        );
    }
    return { workers, next: 0 };
}

function checkColorWithWorker(pool, imageData, width, height) {
    return new Promise((resolve, reject) => {
        // Round-robin across the shared pool
        const worker = pool.workers[pool.next];
        pool.next = (pool.next + 1) % pool.workers.length;

        // Generate a unique ID for this specific page scan
        const messageId = Math.random().toString(36).substring(2, 15);

        const handleMessage = (event) => {
            // Only resolve if this worker message belongs to this specific promise
            if (event.data.messageId === messageId) {
                worker.removeEventListener('message', handleMessage);
                resolve(event.data.isColor);
            }
        };

        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', reject, { once: true });
        worker.postMessage({
            buffer: imageData.data.buffer,
            width: width,
            height: height,
            messageId: messageId
        }, [imageData.data.buffer]);
    });
}

/**
 * Scans a PDF for color pages.
 * @param {Uint8Array} pdfData raw PDF bytes
 * @param {(pageNum: number, numPages: number) => void} [onProgress]
 * @returns {Promise<{colorPages: number[], bwPages: number[], numPages: number}>}
 */
export async function scanPdf(pdfData, onProgress) {
    let pool;
    let loadingTask;

    try {
        loadingTask = getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;

        const colorPages = [];
        const bwPages = [];
        const scanPromises = [];
        pool = createWorkerPool();

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            if (onProgress) onProgress(pageNum, pdf.numPages);

            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 0.2 });

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

            scanPromises.push(
                checkColorWithWorker(pool, imageData, canvas.width, canvas.height)
                    .then(isColor => ({ pageNum, isColor }))
            );

            await new Promise(resolve => setTimeout(resolve, 0));
            page.cleanup();
            context.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Wait for all workers to finish their math
        const results = await Promise.all(scanPromises);
        for (const result of results) {
            (result.isColor ? colorPages : bwPages).push(result.pageNum);
        }

        return { colorPages, bwPages, numPages: pdf.numPages };
    } finally {
        if (pool) pool.workers.forEach(w => w.terminate());
        if (loadingTask) loadingTask.destroy();
    }
}

export function formatPageRanges(pages) {
    if (pages.length === 0) return "";

    let ranges = [];
    let start = pages[0];
    let end = pages[0];

    for (let i = 1; i < pages.length; i++) {
        if (pages[i] === end + 1) {
            // The number is consecutive, extend the current range
            end = pages[i];
        } else {
            // The sequence broke. Push the previous range and start a new one.
            ranges.push(start === end ? `${start}` : `${start}-${end}`);
            start = pages[i];
            end = pages[i];
        }
    }
    // Push the very last range after the loop finishes
    ranges.push(start === end ? `${start}` : `${start}-${end}`);

    return ranges.join(', ');
}
