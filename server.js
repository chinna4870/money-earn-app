const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== DATABASE =====
const DB_FILE = './database.json';

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const defaultDB = { users: {}, ads: [], withdrawals: [], totalPaid: 0, totalAdsShown: 0 };
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB));
        return defaultDB;
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'moneyearn-secret-key-2024',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ===== API: రిజిస్టర్ =====
app.post('/api/register', async (req, res) => {
    const db = loadDB();
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: 'యూజర్‌నేమ్ మరియు పాస్వర్డ్ అవసరం' });
    if (db.users[username]) return res.json({ success: false, message: 'యూజర్ ఇప్పటికే ఉన్నాడు' });
    
    const hash = await bcrypt.hash(password, 10);
    db.users[username] = {
        username, password: hash, balance: 0, totalEarned: 0, totalWithdrawn: 0,
        adsWatched: 0, todayAds: 0,
        lastAdDate: new Date().toDateString(),
        referralCode: username + Math.random().toString(36).substring(2, 6).toUpperCase(),
        referredBy: '', referrals: [],
        createdAt: new Date().toISOString()
    };
    saveDB(db);
    res.json({ success: true, message: 'అకౌంట్ క్రియేట్ అయింది!' });
});

// ===== API: లాగిన్ =====
app.post('/api/login', async (req, res) => {
    const db = loadDB();
    const { username, password } = req.body;
    const user = db.users[username];
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.json({ success: false, message: 'తప్పుడు యూజర్‌నేమ్ లేదా పాస్వర్డ్' });
    }
    req.session.user = username;
    res.json({ success: true });
});

// ===== API: యూజర్ డేటా =====
app.get('/api/user', (req, res) => {
    if (!req.session.user) return res.json({ success: false, loggedIn: false });
    const db = loadDB();
    const user = db.users[req.session.user];
    if (!user) return res.json({ success: false });
    res.json({ success: true, loggedIn: true, username: user.username, balance: user.balance, totalEarned: user.totalEarned, totalWithdrawn: user.totalWithdrawn, adsWatched: user.adsWatched, todayAds: user.todayAds, referralCode: user.referralCode, referrals: user.referrals.length });
});

// ===== API: అడ్ వాచ్ (ప్రతి అడ్‌కి ₹0.50) =====
app.post('/api/watch-ad', (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: 'లాగిన్ చేయి' });
    const db = loadDB();
    const user = db.users[req.session.user];
    
    const today = new Date().toDateString();
    if (user.lastAdDate !== today) { user.todayAds = 0; user.lastAdDate = today; }
    if (user.todayAds >= 100) return res.json({ success: false, message: 'రోజుకు 100 అడ్స్ మాత్రమే' });
    
    const reward = 0.50;
    user.balance = (parseFloat(user.balance) + reward).toFixed(2);
    user.totalEarned = (parseFloat(user.totalEarned) + reward).toFixed(2);
    user.adsWatched++;
    user.todayAds++;
    db.totalAdsShown++;
    db.ads.push({ username: req.session.user, time: new Date().toISOString(), reward, ip: req.ip });
    
    saveDB(db);
    res.json({ success: true, reward, balance: user.balance, todayAds: user.todayAds });
});

// ===== API: రెఫరల్ =====
app.post('/api/referral', (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: 'లాగిన్ చేయి' });
    const db = loadDB();
    const user = db.users[req.session.user];
    const { code } = req.body;
    
    if (code === user.referralCode) return res.json({ success: false, message: 'నీ సొంత కోడ్ వేయలేవు' });
    if (user.referredBy) return res.json({ success: false, message: 'ఇప్పటికే రెఫరల్ యాడ్ చేశావ్' });
    
    const referrer = Object.values(db.users).find(u => u.referralCode === code);
    if (!referrer) return res.json({ success: false, message: 'తప్పుడు రెఫరల్ కోడ్' });
    
    user.referredBy = code;
    user.balance = (parseFloat(user.balance) + 2).toFixed(2);
    user.totalEarned = (parseFloat(user.totalEarned) + 2).toFixed(2);
    referrer.balance = (parseFloat(referrer.balance) + 1).toFixed(2);
    referrer.totalEarned = (parseFloat(referrer.totalEarned) + 1).toFixed(2);
    referrer.referrals.push(user.username);
    saveDB(db);
    res.json({ success: true, message: 'రెఫరల్ బోనస్ ₹2 వచ్చింది!' });
});

// ===== API: విత్‌డ్రా =====
app.post('/api/withdraw', (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: 'లాగిన్ చేయి' });
    const db = loadDB();
    const user = db.users[req.session.user];
    const { amount, upi, method } = req.body;
    
    const amt = parseFloat(amount);
    if (!amt || amt < 50) return res.json({ success: false, message: 'కనీసం ₹50 విత్‌డ్రా చేయండి' });
    if (amt > user.balance) return res.json({ success: false, message: 'బ్యాలెన్స్ సరిపోదు' });
    if (!upi) return res.json({ success: false, message: 'UPI ID నమోదు చేయండి' });
    
    user.balance = (user.balance - amt).toFixed(2);
    user.totalWithdrawn = (parseFloat(user.totalWithdrawn) + amt).toFixed(2);
    db.totalPaid = (parseFloat(db.totalPaid) + amt).toFixed(2);
    
    const wid = 'WD' + Date.now();
    db.withdrawals.push({ id: wid, username: req.session.user, amount: amt, upi, method: method || 'PhonePe', status: 'పెండింగ్', createdAt: new Date().toISOString() });
    
    saveDB(db);
    res.json({ success: true, message: 'విత్‌డ్రా సబ్మిట్ అయింది!', balance: user.balance });
});

// ===== API: హిస్టరీ =====
app.get('/api/history', (req, res) => {
    if (!req.session.user) return res.json({ success: false, loggedIn: false });
    const db = loadDB();
    const adHistory = db.ads.filter(a => a.username === req.session.user).slice(-50).reverse();
    const wdHistory = db.withdrawals.filter(w => w.username === req.session.user).slice(-50).reverse();
    res.json({ success: true, ads: adHistory, withdrawals: wdHistory });
});

// ===== API: లాగౌట్ =====
app.get('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// ===== అడ్మిన్ పేజీ =====
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

app.get('/api/admin/withdrawals', (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: 'లాగిన్ చేయి' });
    const db = loadDB();
    const pending = db.withdrawals.filter(w => w.status === 'పెండింగ్');
    const all = db.withdrawals.slice(-100).reverse();
    res.json({ success: true, pending, all });
});

app.post('/api/admin/approve', (req, res) => {
    if (!req.session.user) return res.json({ success: false, message: 'లాగిన్ చేయి' });
    const db = loadDB();
    const { id } = req.body;
    const wd = db.withdrawals.find(w => w.id === id);
    if (wd) { wd.status = 'అప్రూవ్ అయింది'; wd.approvedAt = new Date().toISOString(); saveDB(db); res.json({ success: true }); }
    else res.json({ success: false, message: 'కనుగొనబడలేదు' });
});

// ===== START =====
app.listen(PORT, () => { console.log(`🚀 Server running on http://localhost:${PORT}`); });
