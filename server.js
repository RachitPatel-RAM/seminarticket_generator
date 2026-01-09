const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Firebase Imports
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, push, get, child, set } = require("firebase/database");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyAWYjDwTHNKMGjthA0LX2azQa9rS9VoSmA",
    authDomain: "seminarticket.firebaseapp.com",
    projectId: "seminarticket",
    storageBucket: "seminarticket.firebasestorage.app",
    messagingSenderId: "817760101906",
    appId: "1:817760101906:web:40e9561bd180566e4d5acb",
    measurementId: "G-CLE9EE1794",
    databaseURL: "https://seminarticket-default-rtdb.firebaseio.com/"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// --- Cloudinary Config ---
const cloudinary = require('cloudinary').v2;
cloudinary.config({
    cloud_name: 'dpv1ulroy',
    api_key: '753843896383315',
    api_secret: 'MSmNF__TeFRS97eghntdWZksArE'
});

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Handle form data

// Set Security Headers (CSP)
app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self' * data: blob: 'unsafe-inline' 'unsafe-eval'; " +
        "script-src 'self' * 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline' *; " +
        "font-src 'self' * data:; " +
        "img-src 'self' * data: blob:; " +
        "connect-src 'self' *;"
    );
    next();
});

// Serve Static Files
// Use process.cwd() for Vercel path resolution
app.use(express.static(path.join(process.cwd())));

// Explicitly serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'index.html'));
});

// Explicitly serve QR Code
app.get('/qr_code.png', (req, res) => {
    const imagePath = path.join(process.cwd(), 'qr_code.png');
    if (fs.existsSync(imagePath)) {
        res.sendFile(imagePath);
    } else {
        res.status(404).send('QR Code not found');
    }
});

// Handle favicon.ico to prevent 404s
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Ensure uploads directory exists (for temporary storage)
const isVercel = process.env.VERCEL === '1';
const uploadDir = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
    } catch (err) {
        console.error("Error creating upload dir:", err);
    }
}

// --- Multer Config ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
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
            cb(new Error('Only .png, .jpg and .jpeg format allowed!'));
        }
    }
});

// --- Helper Functions ---

async function uploadToCloudinary(filePath) {
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            folder: 'seminar_uploads'
        });
        return result.secure_url;
    } catch (error) {
        console.error('Cloudinary Upload Error:', error);
        throw new Error('Cloudinary Upload Failed: ' + (error.message || JSON.stringify(error)));
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

        // 1. Get current count for Ticket Series
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, 'registrations'));
        let series = 1;

        if (snapshot.exists()) {
            series = snapshot.size + 1;
        }

        const formattedSeries = String(series).padStart(4, '0');

        // 2. Extract Components
        const fn = name ? name.substring(0, 2).toUpperCase() : 'XX';
        const em = email ? email.split('@')[0].substring(0, 2).toUpperCase() : 'XX';
        const year = new Date().getFullYear();
        const pn = phone ? phone.slice(-2) : '00';

        // 3. Construct ID: {FN}{EM}{YEAR}{PN}{SERIES}
        const ticketId = `${fn}${em}${year}${pn}${formattedSeries}`;

        // 4. Upload to Cloudinary
        const screenshotUrl = await uploadToCloudinary(filePath);

        // 5. Save to Firebase Realtime Database
        const newRegRef = push(child(dbRef, 'registrations'));
        await set(newRegRef, {
            ticketId,
            name,
            email,
            phone,
            screenshotUrl,
            timestamp: new Date().toISOString()
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
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        }

        res.status(500).json({ success: false, message: error.message || 'Server error during registration.' });
    }
});

// 2. Admin Login & Download Page
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
                    Download CSV Data
                </button>
            </form>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// 3. Handle Download
app.post('/admin', async (req, res) => {
    const { password } = req.body;
    if (password === 'admin@123') {
        try {
            const dbRef = ref(db);
            const snapshot = await get(child(dbRef, 'registrations'));

            if (snapshot.exists()) {
                const data = snapshot.val();
                let csvContent = 'Sr No,Ticket ID,Full Name,Email,Phone,Payment Screenshot,Timestamp\n';
                let srNo = 1;

                // Iterate over objects
                Object.values(data).forEach(reg => {
                    const safeName = `"${(reg.name || '').replace(/"/g, '""')}"`;
                    const safeEmail = `"${(reg.email || '').replace(/"/g, '""')}"`;
                    const safePhone = `"${(reg.phone || '').replace(/"/g, '""')}"`;
                    const time = reg.timestamp ? new Date(reg.timestamp).toLocaleString() : '';

                    csvContent += `${srNo},${reg.ticketId},${safeName},${safeEmail},${safePhone},${reg.screenshotUrl},${time}\n`;
                    srNo++;
                });

                res.header('Content-Type', 'text/csv');
                res.attachment('registrations.csv');
                return res.send(csvContent);
            } else {
                return res.status(404).send('No registrations found yet.');
            }
        } catch (error) {
            console.error('Admin Fetch Error:', error);
            res.status(500).send('Error fetching data from database.');
        }
    } else {
        res.status(401).send('<h1 style="color:red;text-align:center;margin-top:20%">Incorrect Password! <a href="/admin">Try Again</a></h1>');
    }
});

// Need to export app for Vercel
module.exports = app;

// Only listen if run directly (local development)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
