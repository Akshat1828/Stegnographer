let currentEncodeUrl = null;
let currentDecodeUrl = null;

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'circle-info';
    if (type === 'success') icon = 'circle-check';
    if (type === 'error') icon = 'circle-xmark';

    toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('main').forEach(main => main.classList.remove('active-section'));

    event.target.classList.add('active');
    document.getElementById(`${tabId}-section`).classList.add('active-section');
}

// Format bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function setupDropZone(zoneId, inputId, previewId, imgId, isEncode) {
    const dropZone = document.getElementById(zoneId);
    const inputElement = document.getElementById(inputId);
    const previewElement = document.getElementById(previewId);
    const imgElement = document.getElementById(imgId);

    dropZone.addEventListener('click', () => inputElement.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            inputElement.files = e.dataTransfer.files;
            handleFileSelect(inputElement.files[0], previewElement, imgElement, isEncode);
        }
    });

    inputElement.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0], previewElement, imgElement, isEncode);
        }
    });
}

function handleFileSelect(file, previewElement, imgElement, isEncode) {
    const containerId = previewElement.id.replace('-name', '-container');
    const container = document.getElementById(containerId);
    const isImage = file.type.startsWith('image/');

    previewElement.innerText = file.name;
    container.style.display = 'flex';

    // File icon for non-images
    const fileIconId = previewElement.id.replace('-name', '-icon').replace('-preview', '-file');
    const fileIconEl = document.getElementById(fileIconId);
    const viewBtnId = previewElement.id.replace('-preview-name', '-view-btn');
    const viewBtnEl = document.getElementById(viewBtnId);

    if (isImage) {
        const reader = new FileReader();
        reader.onload = (e) => {
            imgElement.src = e.target.result;
            imgElement.style.display = 'block';
        };
        reader.readAsDataURL(file);
        if (fileIconEl) fileIconEl.style.display = 'none';
        if (viewBtnEl) viewBtnEl.style.display = 'flex';
    } else {
        imgElement.style.display = 'none';
        imgElement.src = '';
        if (fileIconEl) fileIconEl.style.display = 'block';
        if (viewBtnEl) viewBtnEl.style.display = 'none';
    }

    // Hide results if we changed files
    if (isEncode) document.getElementById('encode-result').style.display = 'none';
    else document.getElementById('decode-result').style.display = 'none';

    if (isEncode) {
        checkStats();
    }
}

function removeFile(event, inputId, containerId, imgId, isEncode) {
    event.stopPropagation();

    const input = document.getElementById(inputId);
    const container = document.getElementById(containerId);
    const imgElement = document.getElementById(imgId);

    input.value = "";
    container.style.display = 'none';
    imgElement.src = '';

    if (isEncode) {
        document.getElementById('encode-result').style.display = 'none';
        const coverFile = document.getElementById('cover-input').files[0];
        const inputId2 = inputId; // check which was removed
        if (inputId2 === 'secret-input') {
            unlockLsbOptions();
            document.getElementById('secret-view-text-btn').style.display = 'none';
            window._currentSecretText = null;
        }
        if (!coverFile) {
            document.getElementById('stats-panel').style.display = 'none';
        } else {
            checkStats();
        }
    } else {
        document.getElementById('decode-result').style.display = 'none';
    }
}

setupDropZone('cover-drop-zone', 'cover-input', 'cover-preview-name', 'cover-preview-img', true);
setupDropZone('secret-drop-zone', 'secret-input', 'secret-preview-name', 'secret-preview-img', true);
setupDropZone('stego-drop-zone', 'stego-input', 'stego-preview-name', 'stego-preview-img', false);

function togglePassword(inputId, icon) {
    const input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = "password";
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// --- LSB locking helpers ---
function setLsbOption(val, label) {
    const wrapper = document.getElementById('custom-encode-lsb');
    wrapper.setAttribute('data-value', val);
    wrapper.querySelector('.select-selected').innerText = label;
}

function lockLsbOptions(minDepth) {
    const items = document.querySelectorAll('#custom-encode-lsb .select-items div');
    const labels = { 1: 'Level 1 (Highest Quality)', 2: 'Level 2 (Medium Capacity)', 3: 'Level 3 (Max Capacity)' };
    items.forEach(item => {
        const val = parseInt(item.getAttribute('data-val'));
        if (val < minDepth) {
            item.classList.add('locked');
            item.setAttribute('title', `Insufficient capacity — requires at least Level ${minDepth}`);
        } else {
            item.classList.remove('locked');
            item.removeAttribute('title');
        }
    });
    // Auto-select min depth if current selection is too low (only when a valid level exists)
    const currentDepth = parseInt(document.getElementById('custom-encode-lsb').getAttribute('data-value'));
    if (labels[minDepth] && currentDepth < minDepth) {
        setLsbOption(minDepth, labels[minDepth]);
        checkStats();
    }
}

function unlockLsbOptions() {
    document.querySelectorAll('#custom-encode-lsb .select-items div').forEach(item => {
        item.classList.remove('locked');
        item.removeAttribute('title');
    });
    const btn = document.getElementById('encode-btn');
    if (btn) btn.disabled = false;
}

// --- PSNR Quality Calculation ---
// When n LSBs are replaced with random data, expected MSE per channel = (2^(2n) - 1) / 6
// Actual PSNR depends on what fraction of pixels are actually modified (compressed payload / total pixels)
function calcPSNR(compressedBytes, totalPixels, lsbVal) {
    const HEADER_OVERHEAD = 10; // 1 ext_len + ~5 ext chars + 4 data_len bytes
    const payloadBytes = compressedBytes + HEADER_OVERHEAD;
    const bitsNeeded = payloadBytes * 8;
    const pixelsNeeded = Math.ceil(bitsNeeded / (lsbVal * 3)); // 3 channels per pixel
    const fractionModified = Math.min(pixelsNeeded / totalPixels, 1.0);
    const msePerModified = (Math.pow(4, lsbVal) - 1) / 6; // (2^2n - 1) / 6
    const actualMSE = fractionModified * msePerModified;
    if (actualMSE < 1e-9) return Infinity;
    return 10 * Math.log10((255 * 255) / actualMSE);
}

function psnrLabel(psnr) {
    if (!isFinite(psnr) || psnr > 65) return { text: 'Perfect (imperceptible)', color: 'var(--success)' };
    if (psnr >= 50) return { text: `Excellent — ${psnr.toFixed(1)} dB`, color: 'var(--success)' };
    if (psnr >= 44) return { text: `Very Good — ${psnr.toFixed(1)} dB`, color: 'var(--success)' };
    if (psnr >= 38) return { text: `Good — ${psnr.toFixed(1)} dB`, color: '#eab308' };
    if (psnr >= 32) return { text: `Fair — ${psnr.toFixed(1)} dB`, color: '#eab308' };
    return { text: `Poor — ${psnr.toFixed(1)} dB`, color: 'var(--error)' };
}

async function checkStats() {
    const coverFile = document.getElementById('cover-input').files[0];
    const secretFile = document.getElementById('secret-input').files[0];

    if (!coverFile) return;

    const formData = new FormData();
    formData.append('cover_image', coverFile);
    if (secretFile) formData.append('secret_file', secretFile);
    const lsbCount = document.getElementById('custom-encode-lsb').getAttribute('data-value');
    formData.append('lsb_count', lsbCount);

    try {
        const response = await fetch('/api/stats', { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok) { showToast('Error fetching stats: ' + data.error, 'error'); return; }

        document.getElementById('stats-panel').style.display = 'block';
        document.getElementById('stat-res').innerText = `${data.width} × ${data.height}`;
        document.getElementById('stat-pixels').innerText = data.pixels.toLocaleString();
        document.getElementById('stat-cap').innerText = formatBytes(data.capacity_bytes);

        const lsbVal = parseInt(lsbCount);
        const msgBox = document.getElementById('status-message');
        msgBox.className = 'status-message';

        if (secretFile && data.compressed_size_bytes !== undefined) {
            // Show raw size and compressed size side-by-side
            document.getElementById('secret-size-box').style.display = 'flex';
            document.getElementById('compressed-size-box').style.display = 'flex';
            document.getElementById('stat-sec-size').innerText = formatBytes(data.secret_size_bytes);
            // Use the absolute perfect AES-encrypted size sent from the backend
            const actualEmbedded = data.encrypted_size_bytes || data.compressed_size_bytes;
            
            let modStr;
            if (actualEmbedded < data.secret_size_bytes) {
                const savedPct = ((1 - actualEmbedded / data.secret_size_bytes) * 100).toFixed(1);
                modStr = ` (−${savedPct}%)`;
            } else {
                let diff = actualEmbedded - data.secret_size_bytes;
                modStr = ` (+${diff} bytes AES padded)`;
            }
            
            document.getElementById('stat-comp-size').innerText = formatBytes(actualEmbedded) + modStr;

            // Quality based on what actually gets embedded
            const psnr = calcPSNR(actualEmbedded, data.pixels, lsbVal);
            const q = psnrLabel(psnr);
            document.getElementById('stat-quality').innerText = q.text;
            document.getElementById('stat-quality').style.color = q.color;

            // Lock levels based on what actually gets embedded (min of raw vs compressed)
            const cap1 = data.capacity_bytes / lsbVal;
            const cap2 = cap1 * 2;
            const cap3 = cap1 * 3;
            const embeddedSize = actualEmbedded;

            let minDepth = null;
            if (embeddedSize <= cap1) minDepth = 1;
            else if (embeddedSize <= cap2) minDepth = 2;
            else if (embeddedSize <= cap3) minDepth = 3;

            if (minDepth !== null) {
                lockLsbOptions(minDepth);
                document.getElementById('encode-btn').disabled = false;
                if (minDepth === 1) {
                    msgBox.classList.add('status-success');
                    msgBox.innerText = 'Great! Fits at Level 1 — no quality impact.';
                } else {
                    msgBox.classList.add('status-error');
                    msgBox.innerText = `⚠️ File needs Level ${minDepth}+ — image quality will be reduced. Auto-selected.`;
                    if (minDepth === 2) showToast('Switched to Level 2 — slight image noise expected.', 'info');
                    else showToast('Switched to Level 3 — some image quality reduction expected.', 'error');
                }
            } else {
                lockLsbOptions(4);
                document.getElementById('encode-btn').disabled = true;
                msgBox.classList.add('status-error');
                msgBox.innerText = '❌ File is too large even at Level 3. Please choose a larger cover image or a smaller file.';
                showToast('File too large for any level! Use a bigger cover image.', 'error');
            }
        } else {
            // No secret file — show worst-case PSNR (assumes full image is filled)
            const psnrWorstCase = calcPSNR(data.capacity_bytes, data.pixels, lsbVal);
            const q = psnrLabel(psnrWorstCase);
            document.getElementById('stat-quality').innerText = q.text + ' (worst case)';
            document.getElementById('stat-quality').style.color = q.color;

            unlockLsbOptions();
            document.getElementById('secret-size-box').style.display = 'none';
            document.getElementById('compressed-size-box').style.display = 'none';
            msgBox.style.display = 'none';
        }
    } catch (err) {
        console.error('Stats Error:', err);
    }
}


async function startEncoding() {
    const coverFile = document.getElementById('cover-input').files[0];
    const secretFile = document.getElementById('secret-input').files[0];
    const password = document.getElementById('encode-password').value;
    const lsbCount = document.getElementById('custom-encode-lsb').getAttribute('data-value');


    if (!coverFile || !secretFile || !password) {
        showToast("Please provide the Cover Image, Secret File, and Password.", "error");
        return;
    }

    document.getElementById('encode-loader').style.display = 'block';
    document.getElementById('encode-result').style.display = 'none';

    const progressEl = document.getElementById('encode-progress');
    const stepTextEl = document.getElementById('encode-step-text');
    progressEl.style.width = '3%';
    stepTextEl.innerText = 'Starting...';

    const formData = new FormData();
    formData.append('cover_image', coverFile);
    formData.append('secret_file', secretFile);
    formData.append('password', password);
    formData.append('lsb_count', lsbCount);

    let taskId;
    try {
        const resp = await fetch('/api/encode', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) {
            showToast("Snucking failed: " + data.error, "error");
            document.getElementById('encode-loader').style.display = 'none';
            return;
        }
        taskId = data.task_id;
    } catch (err) {
        showToast("Network error starting snucking.", "error");
        document.getElementById('encode-loader').style.display = 'none';
        return;
    }

    // Poll for real progress
    await pollProgress(taskId, progressEl, stepTextEl, async () => {
        const blobResp = await fetch(`/api/result/${taskId}`);
        const blob = await blobResp.blob();
        currentEncodeUrl = window.URL.createObjectURL(blob);
        document.getElementById('encode-result-img').src = currentEncodeUrl;
        const fullName = coverFile.name;
        const dotIdx = fullName.lastIndexOf('.');
        const stem = dotIdx > -1 ? fullName.slice(0, dotIdx) : fullName;
        const ext = '.png'; // always PNG — lossless, preserves hidden data
        document.getElementById('encode-stem').value = stem;
        document.getElementById('encode-ext').value = ext;
        document.getElementById('encode-ext-label').innerText = ext;
        setTimeout(() => {
            document.getElementById('encode-result').style.display = 'block';
            document.getElementById('encode-loader').style.display = 'none';
        }, 300);
        showToast('Successfully encrypted and hidden data!', 'success');
    }, () => {
        document.getElementById('encode-loader').style.display = 'none';
    });
}

async function startDecoding() {
    const stegoFile = document.getElementById('stego-input').files[0];
    const password = document.getElementById('decode-password').value;

    if (!stegoFile || !password) {
        showToast("Please provide the Steganographic Image and Password.", "error");
        return;
    }

    document.getElementById('decode-loader').style.display = 'block';
    document.getElementById('decode-result').style.display = 'none';

    const progressEl = document.getElementById('decode-progress');
    const stepTextEl = document.getElementById('decode-step-text');
    progressEl.style.width = '3%';
    stepTextEl.innerText = 'Starting...';

    const formData = new FormData();
    formData.append('stego_image', stegoFile);
    formData.append('password', password);

    let taskId;
    try {
        const resp = await fetch('/api/decode', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) {
            showToast("Extraction failed: " + data.error, "error");
            document.getElementById('decode-loader').style.display = 'none';
            return;
        }
        taskId = data.task_id;
    } catch (err) {
        showToast("Network error starting extraction.", "error");
        document.getElementById('decode-loader').style.display = 'none';
        return;
    }

    await pollProgress(taskId, progressEl, stepTextEl, async (progressData) => {
        const blobResp = await fetch(`/api/result/${taskId}`);
        const blob = await blobResp.blob();
        currentDecodeUrl = window.URL.createObjectURL(blob);
        const ext = progressData.ext || '';
        const filename = 'secret_data' + ext;
        const decExt = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
        document.getElementById('decode-ext').value = decExt;
        document.getElementById('decode-ext-label').innerText = decExt;
        document.getElementById('decode-stem').value = filename.replace(/\.[^.]+$/, '');
        if (filename.match(/\.(jpeg|jpg|png|gif|webp)$/i)) {
            document.getElementById('decode-result-img').src = currentDecodeUrl;
            document.getElementById('decode-result-img').style.display = 'inline-block';
        } else {
            document.getElementById('decode-result-img').style.display = 'none';
        }
        setTimeout(() => {
            document.getElementById('decode-result').style.display = 'block';
            document.getElementById('decode-loader').style.display = 'none';
        }, 300);
        showToast("Successfully extracted secret file!", "success");
    }, () => {
        document.getElementById('decode-loader').style.display = 'none';
    });
}

async function pollProgress(taskId, progressEl, stepTextEl, onDone, onError) {
    const stepNames = ["", "Step 1/3", "Step 2/3", "Step 3/3"];
    const stepEmoji = ["", "📦", "🔒", "🥷"];
    let dotCycle = 0;
    while (true) {
        await new Promise(r => setTimeout(r, 400));
        dotCycle = (dotCycle % 3) + 1; // Cycle: 1, 2, 3
        const dots = ".".repeat(dotCycle);
        
        let data;
        try {
            const r = await fetch(`/api/progress/${taskId}`);
            data = await r.json();
        } catch { break; }
        
        const emoji = stepEmoji[data.step] || '';
        const label = stepNames[data.step] || '';
        stepTextEl.innerText = `${label}: ${emoji} ${data.step_name}${dots}`;
        progressEl.style.width = Math.min(data.percent, 99) + '%';
        if (data.status === 'done') {
            progressEl.style.width = '100%';
            stepTextEl.innerText = 'Done! 🎉';
            await onDone(data);
            return;
        }
        if (data.status === 'error') {
            showToast('Error: ' + data.error, 'error');
            onError();
            return;
        }
    }
}

function setupCustomSelect() {
    const selElmnt = document.getElementById("custom-encode-lsb");
    if (!selElmnt) return;

    const selectedText = selElmnt.querySelector(".select-selected");
    const itemsContainer = selElmnt.querySelector(".select-items");

    selectedText.addEventListener("click", function (e) {
        e.stopPropagation();
        itemsContainer.classList.toggle("select-hide");
    });

    Array.from(itemsContainer.children).forEach(item => {
        item.addEventListener("click", function (e) {
            e.stopPropagation();
            if (this.classList.contains('locked')) return; // ignore locked options
            selectedText.innerText = this.innerText;
            selElmnt.setAttribute("data-value", this.getAttribute("data-val"));
            itemsContainer.classList.add("select-hide");
            checkStats();
        });
    });

    document.addEventListener("click", function (e) {
        itemsContainer.classList.add("select-hide");
    });
}
document.addEventListener("DOMContentLoaded", setupCustomSelect);


function downloadFile(type) {
    const a = document.createElement('a');
    if (type === 'encode') {
        a.href = currentEncodeUrl;
        const stem = document.getElementById('encode-stem').value || 'encoded';
        const ext = document.getElementById('encode-ext').value || '.png';
        a.download = stem + ext;
    } else {
        a.href = currentDecodeUrl;
        const stem = document.getElementById('decode-stem').value || 'secret';
        const ext = document.getElementById('decode-ext').value || '';
        a.download = stem + ext;
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// Text modal logic
let textBlob = null;
function openTextModal(evt) {
    if (evt) evt.stopPropagation();
    document.getElementById('text-modal').style.display = 'block';
    setTimeout(() => document.getElementById('text-modal-input').focus(), 100);
}
function closeTextModal() {
    document.getElementById('text-modal').style.display = 'none';
}
function applyTextInput() {
    const text = document.getElementById('text-modal-input').value;
    if (!text.trim()) {
        showToast("Please enter some text.", "error");
        return;
    }
    const blob = new Blob([text], { type: 'text/plain' });
    const fakeFile = new File([blob], 'secret_message.txt', { type: 'text/plain' });

    const dt = new DataTransfer();
    dt.items.add(fakeFile);
    const secretInput = document.getElementById('secret-input');
    secretInput.files = dt.files;

    const previewName = document.getElementById('secret-preview-name');
    const imgEl = document.getElementById('secret-preview-img');
    handleFileSelect(fakeFile, previewName, imgEl, true);

    document.getElementById('secret-view-text-btn').style.display = 'flex';
    window._currentSecretText = text;

    // Reset button label for next fresh open
    document.querySelector('#text-modal .primary-btn').innerText = '✅ Use Text';

    closeTextModal();
    showToast("Text ready to encode!", "success");
}

function viewTextContent(evt) {
    if (evt) evt.stopPropagation();
    const text = window._currentSecretText || '';
    const textarea = document.getElementById('text-modal-input');
    const applyBtn = document.querySelector('#text-modal .primary-btn');
    textarea.value = text;
    textarea.readOnly = false;
    applyBtn.style.display = '';
    applyBtn.innerText = '💾 Save Changes';
    document.getElementById('text-modal').style.display = 'block';
}

// Modal functions
function openModal(evt, imgId) {
    if (evt) evt.stopPropagation();
    const imgEl = document.getElementById(imgId);
    if (!imgEl || !imgEl.src || imgEl.style.display === 'none') {
        showToast("No image available to view.", "error");
        return;
    }
    document.getElementById('modal-img').src = imgEl.src;
    document.getElementById('image-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('image-modal').style.display = 'none';
}