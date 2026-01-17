
const video = document.getElementById('video');
const snap = document.getElementById('snap');
const status = document.getElementById('status');
const resultArea = document.getElementById('result-area');
const editStore = document.getElementById('editStore');
const editDate = document.getElementById('editDate');
const editTotal = document.getElementById('editTotal');
const canvas = document.getElementById('canvas');

let currentPhoto = null; 
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx3BhcNWXYfWsdoDN_hWaEl1cDaha3gp2jWGTCQ2lMy4cUMutAW1Ahi2-d5pf5hKjLd/exec';

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
    
    // 1. EXTRACT DATE
    const dateMatch = rawText.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
    const date = dateMatch ? dateMatch[0] : new Date().toLocaleDateString();

    // 2. EXTRACT TOTAL (The "Kroger-Safe" Logic)
    let candidates = [];
    
    lines.forEach((line, index) => {
        const upper = line.toUpperCase();
        
        // HARD BLOCK: If these words appear, we DO NOT want this number
        const isSavingsLine = upper.includes("SAVINGS") || 
                              upper.includes("SAVED") || 
                              upper.includes("POINTS") || 
                              upper.includes("YOU") ||
                              upper.includes("COUPON") ||
                              upper.includes("DISCOUNT");

        // Regex finds a price (e.g., 98.56) at the end of the line
        const priceMatch = line.match(/(\d+[\.,]\d{2})[^\d]*$/);
        
        if (priceMatch && !isSavingsLine) {
            const val = parseFloat(priceMatch[1].replace(',', '.'));
            
            let score = 0;
            // High Priority Keywords
            if (upper.includes("BALANCE") || upper.includes("TOTAL") || upper.includes("DUE")) score += 20;
            // Payment Keywords (Kroger often lists the Mastercard amount as the final total)
            if (upper.includes("MASTERCARD") || upper.includes("VISA") || upper.includes("DEBIT") || upper.includes("TENDER")) score += 15;
            // Position Weight (Numbers at the very bottom are more likely to be the total)
            if (index > lines.length * 0.8) score += 5;

            candidates.push({ val, score, index });
        }
    });

    // Sort: Best score first. If scores are equal, take the one lower down the receipt.
    candidates.sort((a, b) => (b.score - a.score) || (b.index - a.index));

    let finalTotal = "0.00";
    if (candidates.length > 0) {
        finalTotal = candidates[0].val.toFixed(2);
    }

    // 3. UPDATE UI
    document.getElementById('editDate').value = date;
    document.getElementById('editTotal').value = finalTotal;
    document.getElementById('result-area').style.display = "block";
    document.getElementById('status').innerText = "Double-check the Total & Date.";
}

async function uploadToCloud() {
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    status.innerText = "Saving to Google...";

    const payload = {
        store: editStore.value,
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
        status.innerText = "Success! Logged to " + editDate.value.split(/[\/-]/)[0]; 
        resultArea.style.display = "none";
        btn.disabled = false;
    } catch (e) {
        status.innerText = "Upload Failed.";
        btn.disabled = false;
    }
}

setupCamera();