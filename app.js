const video = document.getElementById('video');
const snap = document.getElementById('snap');
const status = document.getElementById('status');
const resultArea = document.getElementById('result-area');
const editStore = document.getElementById('editStore');
const editDate = document.getElementById('editDate');
const editTotal = document.getElementById('editTotal');
const badgeDefaulted = document.getElementById('badge-defaulted');
const badgeToday = document.getElementById('badge-today');
const canvas = document.getElementById('canvas');

let currentPhoto = null; 
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx3BhcNWXYfWsdoDN_hWaEl1cDaha3gp2jWGTCQ2lMy4cUMutAW1Ahi2-d5pf5hKjLd/exec';

// NEW: Highlight everything when clicking Date or Total
[editDate, editTotal].forEach(el => {
    el.addEventListener('click', function() {
        this.setSelectionRange(0, this.value.length);
    });
});

function toggleCustomStore() {
    const group = document.getElementById('customStoreGroup');
    group.style.display = (editStore.value === 'Other') ? 'block' : 'none';
}

function formatToShortDate(dateObj) {
    let mm = dateObj.getMonth() + 1;
    let dd = dateObj.getDate();
    let yy = dateObj.getFullYear().toString().substring(2);
    return (mm < 10 ? '0' : '') + mm + '/' + (dd < 10 ? '0' : '') + dd + '/' + yy;
}

editDate.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (v.length >= 4) v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4);
    else if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2);
    e.target.value = v;
    // Hide badges when manual typing starts
    badgeDefaulted.style.display = "none";
    badgeToday.style.display = "none";
});

async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1920 } }, 
            audio: false 
        });
        video.srcObject = stream;
    } catch (err) {
        status.innerText = "Error: Please allow camera access.";
    }
}

snap.addEventListener('click', async () => {
    status.innerText = "Capturing...";
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    currentPhoto = canvas.toDataURL('image/jpeg', 0.9);
    
    status.innerText = "Scanning for Date & Total...";
    try {
        const { data: { text } } = await Tesseract.recognize(currentPhoto, 'eng');
        processSummary(text);
    } catch (error) {
        status.innerText = "Error: Scan failed.";
    }
});

function processSummary(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    
    // 1. DATE LOGIC
    const dateMatch = rawText.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
    const todayStr = formatToShortDate(new Date());
    
    let finalDate = todayStr;
    badgeDefaulted.style.display = "none";
    badgeToday.style.display = "none";

    if (dateMatch) {
        const d = new Date(dateMatch[0]);
        if (!isNaN(d.getTime())) {
            finalDate = formatToShortDate(d);
            // If it matched a date AND that date is today
            if (finalDate === todayStr) {
                badgeToday.style.display = "inline";
            }
        } else {
            badgeDefaulted.style.display = "inline";
        }
    } else {
        badgeDefaulted.style.display = "inline";
    }

    // 2. TOTAL LOGIC
    let candidates = [];
    lines.forEach((line, index) => {
        const upper = line.toUpperCase();
        const isSavings = upper.includes("SAVINGS") || upper.includes("SAVED") || upper.includes("POINTS") || 
                           upper.includes("YOU") || upper.includes("COUPON") || upper.includes("DISCOUNT");

        const priceMatch = line.match(/(\d+[\.,]\d{2})[^\d]*$/);
        if (priceMatch && !isSavings) {
            const val = parseFloat(priceMatch[1].replace(',', '.'));
            let score = 0;
            if (upper.includes("BALANCE") || upper.includes("TOTAL") || upper.includes("DUE")) score += 20;
            if (upper.includes("MASTERCARD") || upper.includes("VISA") || upper.includes("DEBIT") || upper.includes("TENDER")) score += 15;
            if (index > lines.length * 0.8) score += 5;
            candidates.push({ val, score, index });
        }
    });

    candidates.sort((a, b) => (b.score - a.score) || (b.index - a.index));
    let finalTotal = candidates.length > 0 ? candidates[0].val.toFixed(2) : "0.00";

    editDate.value = finalDate;
    editTotal.value = finalTotal;
    resultArea.style.display = "block";
    status.innerText = "Verify and Save.";
}

async function uploadToCloud() {
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    status.innerText = "Saving...";

    const storeName = (editStore.value === 'Other') 
        ? document.getElementById('customStoreName').value 
        : editStore.value;

    const payload = {
        store: storeName || "Unknown",
        date: editDate.value,
        total: editTotal.value,
        photo: currentPhoto
    };

    try {
        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify(payload)
        });
        status.innerText = "Success!";
        resultArea.style.display = "none";
        btn.disabled = false;
    } catch (e) {
        status.innerText = "Upload Failed.";
        btn.disabled = false;
    }
}

setupCamera();
