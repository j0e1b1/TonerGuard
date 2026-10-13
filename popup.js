import { scanPdf, formatPageRanges } from './scanner.js';

const viewerUrl = chrome.runtime.getURL('viewer.html');
let viewerTabId = null;  // set when the popup is opened over our viewer tab

// Show the right state for the active tab when the popup opens
document.addEventListener('DOMContentLoaded', async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    // Our own viewer tab: show the scan state that the viewer publishes
    if (tab.url.startsWith(viewerUrl)) {
        showViewerState(tab.id);
        return;
    }

    // Use the PDF's URL as the save key
    const storageKey = 'pdf_scan_' + tab.url;

    chrome.storage.session.get([storageKey], (data) => {
        if (data[storageKey]) {
            // We found saved results! Display them immediately and offer a re-scan.
            document.getElementById('scan-btn').innerText = "Re-scan PDF";
            // Pass the saved data into our display function
            renderResults(data[storageKey].colorPages, data[storageKey].bwPages, data[storageKey].numPages);
        }
    });
});

// Mirror the viewer tab's scan state (progress, then results) and keep it live while the popup is open
async function showViewerState(tabId) {
    const stateKey = 'viewer_state_' + tabId;
    const scanBtn = document.getElementById('scan-btn');
    viewerTabId = tabId;
    scanBtn.innerText = "Re-scan PDF";

    const apply = (state) => {
        const statusDiv = document.getElementById('status');
        // Re-scan needs a file in the viewer, and is locked while a scan runs
        scanBtn.style.display = state ? '' : 'none';
        scanBtn.disabled = state?.status === 'scanning';
        if (!state) {
            statusDiv.innerText = "Choose a PDF in this tab to scan it.";
        } else if (state.status === 'done') {
            renderResults(state.colorPages, state.bwPages, state.numPages);
        } else {
            statusDiv.innerText = state.message;
        }
    };

    apply((await chrome.storage.session.get(stateKey))[stateKey]);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session' && changes[stateKey]) apply(changes[stateKey].newValue);
    });
}

// Main scan button logic
document.getElementById('scan-btn').addEventListener('click', async () => {
    const scanBtn = document.getElementById('scan-btn');
    const statusDiv = document.getElementById('status');
    const resultsDiv = document.getElementById('results');

    // Reset UI state
    scanBtn.disabled = true;
    resultsDiv.style.display = 'none';
    document.getElementById('copy-btn-color').style.display = 'none';
    document.getElementById('copy-btn-bw').style.display = 'none';

    // The viewer tab holds the file, so ask it to re-scan; its state updates drive the UI from here
    if (viewerTabId !== null) {
        statusDiv.innerText = "Re-scanning...";
        const response = await chrome.runtime.sendMessage({ type: 'rescan', tabId: viewerTabId }).catch(() => null);
        if (!response?.ok) {
            statusDiv.innerText = "Choose the PDF again in this tab to re-scan it.";
            scanBtn.style.display = 'none';
        }
        return;
    }

    statusDiv.innerText = "Checking active tab...";

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        let targetUrl = tab.url

        // Only fetchable pages can be PDFs; chrome://, about: etc. never are
        if (!targetUrl || !/^(https?|file):/i.test(targetUrl)) {
            statusDiv.innerText = "Error: The active tab does not appear to be a PDF file.";
            return;
        }

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

        // Many PDFs are served from URLs like /download?id=123, so let the file's contents decide
        statusDiv.innerText = "Downloading PDF...";
        await analyzePDF(targetUrl);
    } catch (error) {
        statusDiv.innerText = "An error occurred: " + error.message;
        console.error(error);
    } finally {
        scanBtn.disabled = false;
    }
});

async function analyzePDF(url) {
    const statusDiv = document.getElementById('status');

    try {
        const response = await fetch(url, {
            credentials: 'include',
            headers: {
                'Accept': 'application/pdf'
            }
        });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const pdfData = new Uint8Array(await response.arrayBuffer());
        if (!hasPdfHeader(pdfData)) {
            // Being redirected to a web page usually means a sign-in page or an expired link
            statusDiv.innerText = response.redirected
                ? "The site sent a web page instead of the PDF. You may have been signed out. Reload the PDF tab and try again."
                : "Error: The active tab does not appear to be a PDF file.";
            return;
        }
        statusDiv.innerText = "Parsing PDF structure...";

        const { colorPages, bwPages, numPages } = await scanPdf(pdfData, (pageNum, total) => {
            statusDiv.innerText = `Scanning page ${pageNum} of ${total}...`;
        });

        const storageKey = 'pdf_scan_' + url;
        await chrome.storage.session.set({
            [storageKey]: { colorPages, bwPages, numPages }
        });

        document.getElementById('scan-btn').innerText = "Re-scan PDF";
        renderResults(colorPages, bwPages, numPages);

    } catch (error) {
        statusDiv.innerText = "Failed to load/scan PDF. It may be blocked by strict server policies or requires a login.";
        console.error("PDF Scan Error:", error);
    }
}

// A PDF starts with "%PDF-", which the spec allows anywhere in the first 1024 bytes.
// Content-Type isn't trusted because servers often send application/octet-stream.
function hasPdfHeader(bytes) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
    return head.includes('%PDF-');
}

// The popup closes as soon as a file dialog takes focus, so the picker lives in the viewer tab
document.getElementById('browse-btn').addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html'), active: true });
    window.close();
});

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
