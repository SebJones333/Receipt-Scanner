const video = document.getElementById('video');
const snap = document.getElementById('snap');
const status = document.getElementById('status');
const resultArea = document.getElementById('result-area');
const editStore = document.getElementById('editStore');
const editDate = document.getElementById('editDate');
const editTotal = document.getElementById('editTotal');
const badgeDefaulted = document.getElementById('badge-defaulted');
const badgeToday = document.getElementById('badge-today');
const badgeStoreMatch = document.getElementById('badge-store-match');
const canvas = document.getElementById('canvas');
const useFlashCheckbox = document.getElementById('useFlash');

let currentPhoto = null; 
let videoTrack = null;
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx3BhcNWXYfWsdoDN_hWaEl1cDaha3gp2jWGTCQ2lMy4cUMutAW1Ahi2-d5pf5hKjLd/exec';

// --- STORE FINGERPRINT DATA ---
const BRAND_DATA = {
    "Meijer": { instant: ["MEIJER"], level1: ["MPERKS", "26"], level2: ["1005 E 13 MILE", "MADISON HEIGHTS", "48071", "307-4900"] },
    "Kroger": { instant: ["KROGER"], level1: ["PLUS CUSTOMER", "FUEL POINTS", "LOW PRICES", "PLUS CARD"], level2: ["2200 E 12 MILE", "2483971520"] },
    "Costco": { instant: ["COSTCO"], level1: ["WHOLESALE", "MEMBER"], level2: ["393", "30550 STEPHENSON", "48071"] },
    "Target": { instant: ["TARGET"], level1: ["CIRCLE", "REDCARD"], level2: ["614-9792", "1301 COOLIDGE", "49084"] },
    "Home Depot": { instant: ["HOME DEPOT", "DEPOT"], level1: ["DOERS", "GET MORE DONE"], level2: ["1177 COOLIDGE", "48084", "816-8001"] },
    "Trader Joes": { instant: ["TRADER JOES", "TRADERJOES"], level1: ["JOE'S", "9:00AM", "9:00PM"], level2: ["27880 WOODWARD", "48067", "582-9002"] },
    "Ace": { instant: ["ACE HARDWARE", "GREAT LAKES ACE"], level1: ["HARDWARE"], level2: ["18086", "541-4904", "515 E. 4TH"] }
};

// --- FUZZY MATCHING LOGIC ---
function similarity(s1, s2) {
    let longer = s1; let shorter = s2;
    if (s1.length < s2.length) { longer = s2; shorter = s1; }
    let longerLength = longer.length;
    if (longerLength === 0) return 1.0;
    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

function editDistance(s1, s2) {
    s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
    let costs = new Array();
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i == 0) costs[j] = j;
            else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) != s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                costs[j - 1] = lastValue; lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

function autoDetectStore(rawText) {
    const upperFull = rawText.toUpperCase();
    const words = upperFull.split(/\s+/);
    let bestMatch = "Other";
    let highestScore = 0;
    const fuzzyThreshold = 0.7; // <-- Handle 1 or 2 character OCR errors

    for (const [brand, criteria] of Object.entries(BRAND_DATA)) {
        if (criteria.instant.some(term => upperFull.includes(term))) {
            badgeStoreMatch.style.display = "inline";
            return brand;
        }
        let score = 0;
        criteria.level1.forEach(anchor => {
            if (upperFull.includes(anchor)) score += 2;
            else {
                words.forEach(word => { if (similarity(word, anchor) >= fuzzyThreshold) score += 2; });
            }
        });
        criteria.level2.forEach(term => { if (upperFull.includes(term)) score += 1; });
        if (score > highestScore) { highestScore = score; bestMatch = brand; }
    }
    badgeStoreMatch.style.display = (bestMatch !== "Other") ? "inline" : "none";
    return bestMatch;
}

// --- UI & INPUT HELPERS ---
[editDate, editTotal].forEach(el => el.addEventListener('click', function() { this.setSelectionRange(0, this.value.length); }));

function toggleCustomStore() { document.getElementById('customStoreGroup').style.display = (editStore.value === 'Other') ? 'block' : 'none'; }

function formatToShortDate(dateObj) {
    let mm = dateObj.getMonth() + 1; let dd = dateObj.getDate(); let yy = dateObj.getFullYear().toString().substring(2);
    return (mm < 10 ? '0' : '') + mm + '/' + (dd < 10 ? '0' : '') + dd + '/' + yy;
}

editDate.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (v.length >= 4) v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4);
    else if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2);
    e.target.value = v; badgeDefaulted.style.display = "none"; badgeToday.style.display = "none";
});

// --- CAMERA SETUP ---
async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1920 } }, 
            audio: false 
        });
        video.srcObject = stream;
        videoTrack = stream.getVideoTracks()[0];
    } catch (err) { status.innerText = "Error: Camera access denied."; }
}

// --- CAPTURE & SCAN ---
snap.addEventListener('click', async () => {
    const shouldFlash = useFlashCheckbox.checked;
    const capabilities = videoTrack ? videoTrack.getCapabilities() : {};
    const canFlash = capabilities.torch && shouldFlash;

    try {
        if (canFlash) {
            status.innerText = "Stabilizing Light & Focus (1.6s)...";
            await videoTrack.applyConstraints({ advanced: [{ torch: true }] });
            // Wait 1.5s for the sensor to balance exposure
            await new Promise(resolve => setTimeout(resolve, 1600));
        } else {
            status.innerText = "Capturing...";
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        // High-contrast preprocessing for better OCR
        ctx.filter = 'contrast(1.5) brightness(1.0) grayscale(1)';
        ctx.drawImage(video, 0, 0);
        
        currentPhoto = canvas.toDataURL('image/jpeg', 1.0);

        // Turn flash off immediately after capture
        if (canFlash) {
            await videoTrack.applyConstraints({ advanced: [{ torch: false }] });
        }

        status.innerText = "Scanning Text...";
        const { data: { text } } = await Tesseract.recognize(currentPhoto, 'eng');
        processSummary(text);

    } catch (error) {
        if (canFlash) await videoTrack.applyConstraints({ advanced: [{ torch: false }] });
        status.innerText = "Error: Capture failed.";
        console.error(error);
    }
});

function processSummary(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    
    // 1. STORE DETECTION
    editStore.value = autoDetectStore(rawText);
    toggleCustomStore();

    // 2. DATE LOGIC
    const dateMatch = rawText.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
    const todayStr = formatToShortDate(new Date());
    let finalDate = todayStr;
    badgeDefaulted.style.display = "none"; badgeToday.style.display = "none";
    
    if (dateMatch) {
        const d = new Date(dateMatch[0]);
        if (!isNaN(d.getTime())) { 
            finalDate = formatToShortDate(d); 
            if (finalDate === todayStr) badgeToday.style.display = "inline"; 
        } else { badgeDefaulted.style.display = "inline"; }
    } else { badgeDefaulted.style.display = "inline"; }

    // 3. CONSENSUS TOTAL LOGIC (Frequency + Magnitude)
    let priceCounts = {};
    let candidates = [];

    lines.forEach((line, index) => {
        const upper = line.toUpperCase();
        const isSavings = ["SAVINGS","SAVED","POINTS","YOU","COUPON","DISCOUNT"].some(word => upper.includes(word));
        const priceMatch = line.match(/(\d+[\.,]\d{2})[^\d]*$/);
        
        if (priceMatch && !isSavings) {
            const val = parseFloat(priceMatch[1].replace(',', '.'));
            priceCounts[val] = (priceCounts[val] || 0) + 1;

            let score = 0;
            if (["BALANCE","TOTAL","DUE"].some(word => upper.includes(word))) score += 20;
            if (["MASTERCARD","VISA","DEBIT","TENDER","BC AMT"].some(word => upper.includes(word))) score += 30;
            if (index > lines.length * 0.7) score += 5;
            
            candidates.push({ val, score, index });
        }
    });

    let duplicates = Object.keys(priceCounts).filter(p => priceCounts[p] >= 2).map(p => parseFloat(p));
    let finalTotalValue = 0;

    if (duplicates.length > 0) {
        finalTotalValue = Math.max(...duplicates); // Larger of the frequency matches
    } else {
        candidates.sort((a, b) => (b.score - a.score) || (b.index - a.index));
        finalTotalValue = candidates.length > 0 ? candidates[0].val : 0;
    }

    editDate.value = finalDate;
    editTotal.value = finalTotalValue.toFixed(2);
    resultArea.style.display = "block"; 
    status.innerText = "Verify and Save.";
}

async function uploadToCloud() {
    const btn = document.getElementById('saveBtn'); btn.disabled = true; status.innerText = "Saving...";
    const storeName = (editStore.value === 'Other') ? document.getElementById('customStoreName').value : editStore.value;
    const payload = { store: storeName || "Unknown", date: editDate.value, total: editTotal.value, photo: currentPhoto };
    try {
        await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        status.innerText = "Success!"; resultArea.style.display = "none"; btn.disabled = false;
    } catch (e) { status.innerText = "Upload Failed."; btn.disabled = false; }
}

setupCamera();



