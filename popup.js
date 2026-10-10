import { scanPdf, formatPageRanges } from './scanner.js';

const viewerUrl = chrome.runtime.getURL('viewer.html');

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
            // We found saved results! Hide the scan button and display them immediately.
            document.getElementById('scan-btn').style.display = 'none';
            // Pass the saved data into our display function
            renderResults(data[storageKey].colorPages, data[storageKey].bwPages, data[storageKey].numPages);
        }
    });
});

// Mirror the viewer tab's scan state (progress, then results) and keep it live while the popup is open
async function showViewerState(tabId) {
    const stateKey = 'viewer_state_' + tabId;
    document.getElementById('scan-btn').style.display = 'none';

    const apply = (state) => {
        const statusDiv = document.getElementById('status');
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
        statusDiv.innerText = "Parsing PDF structure...";

        const { colorPages, bwPages, numPages } = await scanPdf(pdfData, (pageNum, total) => {
            statusDiv.innerText = `Scanning page ${pageNum} of ${total}...`;
        });

        const storageKey = 'pdf_scan_' + url;
        await chrome.storage.session.set({
            [storageKey]: { colorPages, bwPages, numPages }
        });

        document.getElementById('scan-btn').style.display = 'none';
        renderResults(colorPages, bwPages, numPages);

    } catch (error) {
        statusDiv.innerText = "Failed to load/scan PDF. It may be blocked by strict server policies or requires a login.";
        console.error("PDF Scan Error:", error);
    }
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
