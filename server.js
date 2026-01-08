const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = 3000;

// Cloudinary Config
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: 'dpv1ulroy',
    api_key: '753843896383315',
    api_secret: 'MSmNF__TeFRS97eghntdWZksArE'
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Handle form data
app.use(express.static(__dirname)); // Serve static files from root

// Ensure uploads directory exists (for temporary storage)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Multer Config for Temporary Image Storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'temp-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype == "image/png" || file.mimetype == "image/jpg" || file.mimetype == "image/jpeg") {
            cb(null, true);
        } else {
            cb(null, false);
            return cb(new Error('Only .png, .jpg and .jpeg format allowed!'));
        }
    }
});

// CSV Initialization
const CSV_FILE = path.join(__dirname, 'registrations.csv');

async function appendToExcel(data) {
    console.log(`[CSV] Starting append process for ${data.name} (${data.ticketId})`);

    const headers = 'Sr No,Ticket ID,Full Name,Email,Phone,Payment Screenshot,Timestamp\n';

    // Check if file exists to determine if we need a header
    let fileExists = fs.existsSync(CSV_FILE);
    let srNo = 1;

    if (!fileExists) {
        console.log('[CSV] Creating new file with header...');
        fs.writeFileSync(CSV_FILE, headers);
    } else {
        // Calculate Sr No by counting lines
        try {
            const content = fs.readFileSync(CSV_FILE, 'utf8');
            const lines = content.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            if (lines.length > 1) {
                // Try to get SrNo from last line
                const lastSrNo = parseInt(lastLine.split(',')[0]);
                if (!isNaN(lastSrNo)) {
                    srNo = lastSrNo + 1;
                }
            }
        } catch (err) {
            console.error('[CSV] Error reading row count:', err);
        }
    }

    // Escape fields that might contain commas
    const safeName = `"${data.name.replace(/"/g, '""')}"`;
    const safeEmail = `"${data.email.replace(/"/g, '""')}"`;
    const safePhone = `"${data.phone.replace(/"/g, '""')}"`;

    const row = `${srNo},${data.ticketId},${safeName},${safeEmail},${safePhone},${data.screenshotUrl},${new Date().toLocaleString()}\n`;

    try {
        fs.appendFileSync(CSV_FILE, row);
        console.log(`[CSV] Successfully wrote row ${srNo} to ${CSV_FILE}`);
    } catch (writeErr) {
        console.error('[CSV] Write Error:', writeErr);
        throw writeErr;
    }
}

// Upload to Cloudinary Function
async function uploadToCloudinary(filePath) {
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            folder: 'seminar_uploads' // Optional: organize in a folder
        });
        return result.secure_url;
    } catch (error) {
        console.error('Cloudinary Upload Error:', error);
        const errorMsg = error.message || JSON.stringify(error);
        fs.writeFileSync('error.log', `[${new Date().toISOString()}] Cloudinary Error: ${errorMsg}\n`, { flag: 'a' });
        throw new Error('Cloudinary Upload Failed: ' + errorMsg);
    }
}

// --- ROUTES ---

// 1. Register Endpoint
app.post('/api/register', upload.single('paymentProof'), async (req, res) => {
    let filePath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Payment screenshot is required.' });
        }

        filePath = req.file.path;
        const { name, email, phone } = req.body;

        // 1. Calculate Series
        let series = 1;
        if (fs.existsSync(CSV_FILE)) {
            const content = fs.readFileSync(CSV_FILE, 'utf8');
            // Check non-empty lines
            const lines = content.trim().split('\n');
            // If only header, series=1. If header+1row, series=2.
            // Series = number of actual data rows + 1
            if (lines.length > 1) {
                series = lines.length;
            }
        }
        const formattedSeries = String(series).padStart(4, '0'); // 4 Digits

        // 2. Extract Components
        const fn = name ? name.substring(0, 2).toUpperCase() : 'XX';
        const em = email ? email.split('@')[0].substring(0, 2).toUpperCase() : 'XX';
        const year = new Date().getFullYear();
        const pn = phone ? phone.slice(-2) : '00';

        // 3. Construct ID: {FN}{EM}{YEAR}{PN}{SERIES}
        const ticketId = `${fn}${em}${year}${pn}${formattedSeries}`;

        // Upload to Cloudinary
        const screenshotUrl = await uploadToCloudinary(filePath);

        // Save to Excel
        await appendToExcel({
            ticketId,
            name,
            email,
            phone,
            screenshotUrl
        });

        // Delete local temp file
        fs.unlink(filePath, (err) => {
            if (err) console.error("Failed to delete temp file:", err);
        });

        res.json({ success: true, ticketId, message: 'Registration successful!' });

    } catch (error) {
        console.error('Registration Error:', error);

        // Attempt cleanup if error occurred
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // Return the specific error message to the frontend for better debugging
        const errorMessage = error.message || 'Server error during registration.';
        res.status(500).json({ success: false, message: errorMessage });
    }
});

// 2. Admin Login
// 2. Admin Login (Removed)

// 4. Secure Admin Download Route
app.get('/admin', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Access</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
    </head>
    <body class="bg-gray-50 flex items-center justify-center h-screen font-['DM_Sans']">
        <div class="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
            <h2 class="text-2xl font-bold mb-6 text-gray-800 text-center">Admin Download</h2>
            <form action="/admin" method="POST" class="space-y-4">
                <div>
                    <input type="password" name="password" placeholder="Enter Admin Password" required 
                        class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all" autofocus>
                </div>
                <button type="submit" 
                    class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98]">
                    Download Data
                </button>
            </form>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

app.post('/admin', (req, res) => {
    const { password } = req.body;
    if (password === 'admin@123') {
        if (fs.existsSync(CSV_FILE)) {
            res.download(CSV_FILE, 'registrations.csv');
        } else {
            res.status(404).send('No data found yet.');
        }
    } else {
        res.status(401).send('<h1 style="color:red;text-align:center;margin-top:20%">Incorrect Password! <a href="/admin">Try Again</a></h1>');
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
