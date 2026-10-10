import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Tell PDF.js where to find the worker file
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

//Check Memory for existing results on page load
document.addEventListener('DOMContentLoaded', async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    // Use the PDF's URL as the save key
    const storageKey = 'pdf_scan_' + tab.url;

    chrome.storage.session.get([storageKey], (data) => {
        if (data[storageKey]) {
            // We found saved results! Hide the scan button and display them immediately.
            document.getElementById('scan-btn').style.display = 'none';
            // Pass the saved data into our display function
            renderResults(data[storageKey].colorPages, data[storageKey].bwPages, data[storageKey].numPages);
        }
    });
});

// Main scan button logic
document.getElementById('scan-btn').addEventListener('click', async () => {
    const scanBtn = document.getElementById('scan-btn');
    const statusDiv = document.getElementById('status');
    const resultsDiv = document.getElementById('results');

    // Reset UI state
    scanBtn.disabled = true;
    resultsDiv.style.display = 'none';
    statusDiv.innerText = "Checking active tab...";

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        let targetUrl = tab.url
        let isPdfStream = false

        if (targetUrl.startsWith('file://')) {
            // Check if Chrome allows file access
            const hasFileAccess = await new Promise(resolve => {
                chrome.extension.isAllowedFileSchemeAccess(resolve);
            });
            if (!hasFileAccess) {
                statusDiv.innerHTML = `
                    <span style="color: red;">Local file access denied.</span><br>
                    Please enable <b>"Allow access to file URLs"</b> in the extension settings to scan this file.
                `;
                return;
            }
        }

        if (targetUrl.includes('googleusercontent.com') && targetUrl.includes('/pdf/')) {
            isPdfStream = true;
            statusDiv.innerText = "Downloading PDF...";
        }
        
        // Ensure the URL exists and is a PDF
        else if (tab && targetUrl && targetUrl.split('?')[0].toLowerCase().endsWith('.pdf')) {
            isPdfStream = true
        }

        if(isPdfStream){
            await analyzePDF(targetUrl);
        } else {
            statusDiv.innerText = "Error: The active tab does not appear to be a PDF file.";
        }
    } catch (error) {
        statusDiv.innerText = "An error occurred: " + error.message;
        console.error(error);
    } finally {
        scanBtn.disabled = false;
    }
});

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

async function analyzePDF(url) {
    const statusDiv = document.getElementById('status');
    let pool;

    try {
        const response = await fetch(url, {
            credentials: 'include',
            headers: {
                'Accept': 'application/pdf'
            }
        });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();
        const pdfData = new Uint8Array(arrayBuffer);
        statusDiv.innerText = "Parsing PDF structure...";

        const loadingTask = getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;

        let colorPages = [];
        let bwPages = [];
        
        const scanPromises = [];
        pool = createWorkerPool();

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            statusDiv.innerText = `Scanning page ${pageNum} of ${pdf.numPages}...`;

            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 0.2 });

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

            const promise = checkColorWithWorker(pool, imageData, canvas.width, canvas.height)
                .then(isColor => ({
                    pageNum: pageNum,
                    isColor: isColor
                }));

            scanPromises.push(promise);

            await new Promise(resolve => setTimeout(resolve, 0));
            page.cleanup();
            context.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Wait for all workers to finish their math
        const results = await Promise.all(scanPromises);
        
        for (const result of results) {
            if (result.isColor) {
                colorPages.push(result.pageNum);
            } else {
                bwPages.push(result.pageNum);
            }
        }

        const storageKey = 'pdf_scan_' + url;
        await chrome.storage.session.set({
            [storageKey]: {
                colorPages: colorPages,
                bwPages: bwPages,
                numPages: pdf.numPages
            }
        });

        document.getElementById('scan-btn').style.display = 'none';
        renderResults(colorPages, bwPages, pdf.numPages);

    } catch (error) {
        statusDiv.innerText = "Failed to load/scan PDF. It may be blocked by strict server policies or requires a login.";
        console.error("PDF Scan Error:", error);
    } finally {
        if (pool) pool.workers.forEach(w => w.terminate());
    }
}

function renderResults(colorPages, bwPages, numPages) {
    const statusDiv = document.getElementById('status');
    const resultsDiv = document.getElementById('results');
    const copyBtnColor = document.getElementById('copy-btn-color');
    const copyBtnBW = document.getElementById('copy-btn-bw');

    statusDiv.innerText = "Scan Complete!";

    // Format both lists using the helper function
    const colorString = formatPageRanges(colorPages);
    const bwString = formatPageRanges(bwPages);

    let outputHTML = "";
    let clipboardTextColor = "";
    let clipboardTextBW = "";

    copyBtnColor.style.display = 'block';
    copyBtnBW.style.display = 'block';

    // Handle edge cases (All B&W or All Color)
    if (colorPages.length === 0) {
        outputHTML = `<strong>Result:</strong> Entire document (${numPages} pages) is Black & White.`;
        clipboardTextBW = `1-${numPages}`;
        copyBtnColor.style.display = 'none';
    } else if (bwPages.length === 0) {
        outputHTML = `<strong>Result:</strong> Entire document (${numPages} pages) is in Color.`;
        clipboardTextColor = `1-${numPages}`;
        copyBtnBW.style.display = 'none';
    } else {
        // Document has a mix of both
        outputHTML = `
                <strong>Color Pages (${colorPages.length}):</strong><br>${colorString}
                <br><br>
                <strong>B&W Pages (${bwPages.length}):</strong><br>${bwString}
            `;
        clipboardTextColor = colorString;
        clipboardTextBW = bwString;
    }

    resultsDiv.innerHTML = outputHTML;
    resultsDiv.style.display = 'block';


    copyBtnColor.onclick = () => {
        navigator.clipboard.writeText(clipboardTextColor).then(() => {
            copyBtnColor.innerText = "Copied!";
            copyBtnColor.classList.add('active');
            setTimeout(() => {
                copyBtnColor.innerText = "Copy Color Page Numbers"
                copyBtnColor.classList.remove('active');
            }, 2000);
        }).catch(err => {
            console.error("Failed to copy text: ", err);
        });
    };

    copyBtnBW.onclick = () => {
        navigator.clipboard.writeText(clipboardTextBW).then(() => {
            copyBtnBW.innerText = "Copied!";
            copyBtnBW.classList.add('active');
            setTimeout(() => {
                copyBtnBW.innerText = "Copy B&W Page Numbers"
                copyBtnBW.classList.remove('active');
            }, 2000);
        }).catch(err => {
            console.error("Failed to copy text: ", err);
        });
    };

}

function formatPageRanges(pages) {
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
