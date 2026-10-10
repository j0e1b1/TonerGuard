import { scanPdf } from './scanner.js';

const embed = document.getElementById('pdf-embed');
const picker = document.getElementById('picker');
const fileInput = document.getElementById('file-input');
let currentBlobUrl = null;
let tabId = null;

// The popup reads this tab's scan state to show progress and results
const tabReady = chrome.tabs.getCurrent().then(tab => { tabId = tab.id; });

async function publish(state, badge) {
    await tabReady;
    if (tabId == null) return;
    await chrome.storage.session.set({ ['viewer_state_' + tabId]: state });
    await chrome.action.setBadgeText({ tabId, text: badge });
}

chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });

document.getElementById('browse-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) loadAndScan(file);
    fileInput.value = '';  // allow re-picking the same file
});

// Drag and drop anywhere on the page
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file) loadAndScan(file);
});

window.addEventListener('beforeunload', () => {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
});

async function loadAndScan(file) {
    document.title = `TonerGuard - ${file.name}`;

    const bytes = new Uint8Array(await file.arrayBuffer());

    // Show the PDF in the native viewer using a blob URL owned by this page
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    embed.src = currentBlobUrl;
    embed.hidden = false;
    picker.hidden = true;

    // Cache by file identity so rescanning the same file is instant
    const cacheKey = `pdf_scan_local_${file.name}_${file.size}_${file.lastModified}`;
    const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
    if (cached) {
        await publish({ fileName: file.name, status: 'done', ...cached }, String(cached.colorPages.length));
        return;
    }

    try {
        await publish({ fileName: file.name, status: 'scanning', message: 'Parsing PDF structure...' }, '...');
        // pdf.js may transfer the buffer to its worker, so give it a copy
        const result = await scanPdf(bytes.slice(), (pageNum, total) => {
            publish({ fileName: file.name, status: 'scanning', message: `Scanning page ${pageNum} of ${total}...` }, '...');
        });
        await chrome.storage.session.set({ [cacheKey]: result });
        await publish({ fileName: file.name, status: 'done', ...result }, String(result.colorPages.length));
    } catch (error) {
        console.error("PDF Scan Error:", error);
        await publish({
            fileName: file.name,
            status: 'error',
            message: "Failed to scan PDF. The file may be corrupt, encrypted, or not a PDF."
        }, '!');
    }
}
