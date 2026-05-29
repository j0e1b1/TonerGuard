**TonerGuard: PDF Color Detector 🖨️ 🎨**  
**Stop wasting expensive color toner on black-and-white pages.** TonerGuard is a blazing-fast, privacy-first browser extension that instantly scans PDFs and detects exactly which pages contain color. It automatically groups the page numbers (e.g., 1-5, 8, 12-20) so you can easily route the Black & White pages to a cheaper monochrome printer.  
**✨ Features**  
- **Multi-Threaded Scanning:** Utilizes a Web Worker pool mapped to your CPU cores to scan massive documents in seconds without freezing the browser.  
- **Smart Number Grouping:** Automatically formats page numbers for your print dialog.  
- **Intelligent Memory Cache:** Accidentally closed the popup? TonerGuard caches your results in chrome.storage.session so you don't have to wait twice.  
- **100% Private & Local:** All pixel processing happens directly inside your browser using Mozilla's pdf.js. Your documents  **never** leave your computer and are never uploaded to the cloud.  
**🚀 Installation (Developer Mode)**  
To install this extension directly from the source code:  
1. Download or clone this repository to your computer.  
2. Open Google Chrome (or Edge/Brave) and navigate to chrome://extensions/.  
3. Toggle **Developer mode** ON in the top right corner.  
4. Click the **Load unpacked** button in the top left.  
5. Select the folder containing this repository.  
6. Pin the extension to your toolbar for easy access!  
*Note: To scan local files (* *file:///C:/...* *), click "Details" on the extension card and toggle "Allow access to file URLs" ON.*  
**💡 How to Use**  
1. Open any PDF in your browser.  
2. Click the **TonerGuard** extension icon in your toolbar.  
3. Click **Scan Active PDF**.  
4. Once complete, click the "Copy" buttons to grab your specific page ranges and paste them into your Printer Dialog!  
**🏗️ Architecture & Performance**  
TonerGuard is built with Vanilla JavaScript (ES Modules) and Manifest V3, focusing heavily on performance and memory management:  
- **Worker Pool Concurrency:** The main thread dynamically spawns a pool of scannerWorker.js instances based on navigator.hardwareConcurrency. Pages are rendered asynchronously and distributed across available CPU cores.  
- **Optimized Pixel Skipping:** The background algorithm uses a highly tuned pixel-skipping threshold that ignores transparent watermarks and compression artifacts to eliminate false positives.  
<img width="1920" height="1048" alt="Screenshot From 2026-05-24 14-53-39" src="https://github.com/user-attachments/assets/359fb9e4-c857-41c1-912c-1a3dc5cbe2aa" />
<img width="1920" height="1048" alt="Screenshot From 2026-05-24 14-53-50" src="https://github.com/user-attachments/assets/f68434a6-cb20-4955-8384-ef533d6e0bcb" />
<img width="1920" height="1048" alt="Screenshot From 2026-05-29 23-54-38" src="https://github.com/user-attachments/assets/33deb6b0-c48a-4ef9-a522-fb658db3f704" />
