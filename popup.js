import * as pdfjsLib from './lib/pdf.mjs';

// Tell PDF.js where to find the worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.mjs';

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
            document.getElementById('status').innerText = "Results loaded from memory.";
            
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

        // Ensure the URL exists and is a PDF
        if (tab && tab.url && tab.url.split('?')[0].toLowerCase().endsWith('.pdf')) {
            statusDiv.innerText = "Downloading PDF...";
            await analyzePDF(tab.url);
        } else {
            statusDiv.innerText = "Error: The active tab does not appear to be a PDF file.";
        }
    } catch (error) {
        statusDiv.innerText = "An error occurred: " + error.message;
        console.error(error);
        scanBtn.disabled = false;
    } finally {
        scanBtn.disabled = false;
    }
});

async function analyzePDF(url) {
    const statusDiv = document.getElementById('status');
    const resultsDiv = document.getElementById('results');

    try {
        // 1. Fetch the PDF. <all_urls> in manifest allows this to bypass CORS.
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();
        const pdfData = new Uint8Array(arrayBuffer);
        statusDiv.innerText = "Parsing PDF structure...";

        // 2. Load into PDF.js
        const loadingTask = pdfjsLib.getDocument(
            {
                data: pdfData
            }
        );
        const pdf = await loadingTask.promise;

        let colorPages = [];
        let bwPages = [];

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });

        // 3. Loop through and render pages
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            statusDiv.innerText = `Scanning page ${pageNum} of ${pdf.numPages}...`;

            const page = await pdf.getPage(pageNum);

            // OPTIMIZATION: Render at 20% size for a massive performance boost
            const viewport = page.getViewport({ scale: 0.2 });

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            // 4. Check the canvas for color pixels
            if (checkForColor(context, canvas.width, canvas.height)) {
                colorPages.push(pageNum);
            }
            else {
                bwPages.push(pageNum);
            }

            //Prevenet UI freezing by yielding back to the event loop after each page
            await new Promise(resolve => setTimeout(resolve, 0));
            page.cleanup();
            canvas.width = 0;
            canvas.height = 0;
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
    }
}

function renderResults(colorPages, bwPages, numPages) {
    const statusDiv = document.getElementById('status');
    const resultsDiv = document.getElementById('results');
    const copyBtnColor = document.getElementById('copy-btn-color');
    const copyBtnBW = document.getElementById('copy-btn-bw');

    statusDiv.innerText = "Scan Complete!";

    // Format both lists using the helper function we made earlier
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

function checkForColor(context, width, height) {
    const data = context.getImageData(0, 0, width, height).data;

    const threshold = 15;
    const pixelSkip = 10;
    const step = pixelSkip * 4;

    let colorCount = 0;
    let total = 0;

    // Early-exit threshold:
    // if enough color pixels are found,
    // stop scanning immediately
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

        // Fast max/min calculation (faster than Math.max/min)
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
                return true;
            }
        }
    }

    // Final ratio check
    return total > 0 && (colorCount / total) > earlyExitRatio;
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