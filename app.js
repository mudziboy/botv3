// =======================================================
// 1. MODUL BAWAAN (NATIVE MODULES)
// =======================================================
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// =======================================================
// 2. MODUL PIHAK KETIGA (THIRD-PARTY MODULES)
// =======================================================
const express = require('express');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const winston = require('winston');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const { PakasirClient } = require('pakasir-client');

// =======================================================
// 3. KONSTANTA DAN KONFIGURASI
// =======================================================

// --- PEMUATAN KONSTANTA DARI .vars.json ---
const vars = JSON.parse(fs.readFileSync('./.vars.json', 'utf8'));

// Variabel Bot dan Aplikasi
const BOT_TOKEN = vars.BOT_TOKEN;
const port = vars.PORT || 50123;
const ADMIN_RAW = vars.USER_ID;
const GROUP_ID = vars.GROUP_ID;
const CHANNEL_USERNAME = vars.CHANNEL_USERNAME;
const ADMIN_USERNAME_TEMBAK_PAKET = vars.ADMIN_USERNAME_TEMBAK_PAKET || '@dorinajabot';

// Variabel Pakasir
const PAKASIR_API_KEY = vars.PAKASIR_API_KEY;
const PAKASIR_PROJECT_SLUG = vars.PAKASIR_PROJECT_SLUG;
const PAKASIR_WEBHOOK_URL = vars.PAKASIR_WEBHOOK_URL;

// Variabel Bisnis/Angka
const NAMA_STORE = vars.NAMA_STORE;
const MIN_DEPOSIT_AMOUNT = vars.MIN_DEPOSIT_AMOUNT || 10000;
const RESELLER_PRICE = vars.RESELLER_PRICE || 30000;
const RESELLER_DISCOUNT_PERCENT = vars.RESELLER_DISCOUNT_PERCENT || 40;

// Variabel Batasan (Limit)
const TRIAL_EXPIRY_HOURS = vars.TRIAL_EXPIRY_HOURS || 1;
const MEMBER_TRIAL_LIMIT = vars.MEMBER_TRIAL_LIMIT || 3;
const RESELLER_TRIAL_LIMIT = vars.RESELLER_TRIAL_LIMIT || 10;


// =======================================================
// 4. INISIALISASI INSTANS
// =======================================================
const app = express();
const pakasir = new PakasirClient({
  project: PAKASIR_PROJECT_SLUG,
  apiKey: PAKASIR_API_KEY
});
const bot = new Telegraf(BOT_TOKEN);

// --- LOGGER & CONFIGURATION ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'bot-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'bot-combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

// Modul CREATE (Asumsi file .js berada di './modules/')
const { createssh } = require('./modules/createssh');
const { createvmess } = require('./modules/createvmess');
const { createvless } = require('./modules/createvless');
const { createtrojan } = require('./modules/createtrojan');
const { createshadowshocks } = require('./modules/createshadowsocks');
// Modul RENEW
const { renewssh } = require('./modules/renewssh');
const { renewvmess } = require('./modules/renewvmess');
const { renewvless } = require('./modules/renewvless');
const { renewtrojan } = require('./modules/renewtrojan');
const { renewshadowshocks } = require('./modules/renewSHADOWSOCKS'); 

// --- FIX AKHIR: Mengkonversi ID Admin ke Integer Array dengan aman ---
let adminIds = [];
if (Array.isArray(ADMIN_RAW)) {
    adminIds = ADMIN_RAW.map(id => parseInt(id)).filter(id => !isNaN(id));
} else if (ADMIN_RAW) {
    adminIds = [parseInt(ADMIN_RAW)].filter(id => !isNaN(id));
}
if (adminIds.length === 0) {
    logger.error("⚠️ PERINGATAN! Admin ID tidak terdeteksi atau tidak valid di .vars.json.");
}
logger.info(`✅ Bot initialized. Admin IDs: ${adminIds.join(', ')}`);


const db = new sqlite3.Database('./sellvpn.db', (err) => {
  if (err) { logger.error('Kesalahan koneksi SQLite3:', err.message); }
  else { logger.info('Terhubung ke SQLite3'); }
});

const userState = {};
global.processedTransactions = new Set();
logger.info('User state initialized');

// --- INICIALISASI TABEL DATABASE ---
db.run(`CREATE TABLE IF NOT EXISTS Server (
  id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, auth TEXT, harga INTEGER, nama_server TEXT, quota INTEGER, iplimit INTEGER,
  batas_create_akun INTEGER, total_create_akun INTEGER
)`, (err) => { if (err) { logger.error('Kesalahan membuat tabel Server:', err.message); } });

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, saldo INTEGER DEFAULT 0, role TEXT DEFAULT 'member',
  daily_trial_count INTEGER DEFAULT 0,
  last_trial_date TEXT DEFAULT '',
  CONSTRAINT unique_user_id UNIQUE (user_id)
)`, (err) => {
  if (err) { logger.error('Kesalahan membuat tabel users:', err.message); return; }
  db.all("PRAGMA table_info(users)", (err, rows) => {
    if (err || !rows) return;
    if (!rows.some(row => row.name === 'role')) {
      db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member'", (err) => { if (!err) logger.info('Kolom role berhasil ditambahkan'); });
    }
    if (!rows.some(row => row.name === 'daily_trial_count')) {
      db.run("ALTER TABLE users ADD COLUMN daily_trial_count INTEGER DEFAULT 0", (err) => { if (!err) logger.info('Kolom daily_trial_count berhasil ditambahkan'); });
    }
    if (!rows.some(row => row.name === 'last_trial_date')) {
      db.run("ALTER TABLE users ADD COLUMN last_trial_date TEXT DEFAULT ''", (err) => { if (!err) logger.info('Kolom last_trial_date berhasil ditambahkan'); });
    }
  });
});


db.run(`CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, type TEXT, reference_id TEXT, timestamp INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)`, (err) => { if (err) { logger.error('Kesalahan membuat tabel transactions:', err.message); } });

// --- TABEL BARU UNTUK PAKASIR ---
db.run(`CREATE TABLE IF NOT EXISTS pending_deposits_pakasir (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, order_id TEXT UNIQUE, amount INTEGER, status TEXT DEFAULT 'pending',
  payment_method TEXT, payment_data TEXT, expired_at TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`, (err) => { if (err) { logger.error('Kesalahan membuat tabel pending_deposits_pakasir:', err.message); } });

// --- FUNGSI UTILITY ---
async function getUserDetails(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT saldo, role, daily_trial_count, last_trial_date FROM users WHERE user_id = ?', [userId], (err, row) => {
      if (err) { reject(err); }
      else { resolve(row || { saldo: 0, role: 'member', daily_trial_count: 0, last_trial_date: '' }); }
    });
  });
}

// --- FUNGSI UTILITY CHANNEL ---
async function isUserJoinedChannel(userId) {
  if (!CHANNEL_USERNAME) return true; 
  try {
    const chatMember = await bot.telegram.getChatMember(CHANNEL_USERNAME, userId);
    return ['member', 'administrator', 'creator', 'restricted'].includes(chatMember.status);
  } catch (error) {
    logger.error(`Error checking channel membership for ${userId} in ${CHANNEL_USERNAME}:`, error.message);
    if (error.response && error.response.error_code === 400) {
        return false; 
    }
    return false; 
  }
}


function calculatePrice(basePrice, role) {
  if (role === 'reseller') {
    const discount = basePrice * (RESELLER_DISCOUNT_PERCENT / 100);
    return Math.max(0, basePrice - discount);
  }
  return basePrice;
}

async function updateUserBalance(userId, amount) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, userId], function (err) {
      if (err) { logger.error('⚠️ Kesalahan saat menambahkan saldo user:', err.message); reject(err); }
      else { resolve(); }
    });
  });
}

async function updateServerField(serverId, value, query) {
  return new Promise((resolve, reject) => {
    db.run(query, [value, serverId], function (err) {
      if (err) { logger.error(`⚠️ Kesalahan saat mengupdate server field:`, err.message); reject(err); }
      else { resolve(); }
    });
  });
}

async function recordAccountTransaction(userId, type) {
  return new Promise((resolve, reject) => {
    const referenceId = `account-${type}-${userId}-${Date.now()}`;
    db.run('INSERT INTO transactions (user_id, type, reference_id, timestamp) VALUES (?, ?, ?, ?)',
      [userId, type, referenceId, Date.now()], (err) => {
        if (err) { logger.error('Error recording account transaction:', err.message); reject(err); }
        else { resolve(); }
      }
    );
  });
}

function executeScript(scriptType, username) {
    return new Promise((resolve) => {
        const scriptName = `trial${scriptType}.sh`;
        const fullPath = `./scripts/${scriptName}`;
        const command = `bash ${fullPath}`;
        logger.info(`Executing script: ${command}`);
        exec(command, (error, stdout, stderr) => {
            if (error) {
                logger.error(`Script execution error for ${scriptName}: ${error.message}, Stderr: ${stderr}`);
                return resolve(`❌ GAGAL! Terjadi kesalahan pada sistem saat membuat akun trial. (Cek log server, error: ${error.message.substring(0, 100)})`);
            }
            if (stderr) {
                logger.warn(`Script stderr for ${scriptName}: ${stderr}`);
            }
            
            // Asumsi stdout berisi JSON atau pesan sukses dari skrip
            let msg = stdout.trim();
            
            // Coba parse JSON jika skrip Anda menghasilkan JSON (seperti Vless/Vmess)
            try {
                const data = JSON.parse(msg);
                
                // Format output pesan yang indah berdasarkan data JSON
                if (data.status === 'success') {
                    // Membuat pesan yang lebih rapi dari JSON (Contoh VLESS/VMESS)
                    let formattedMsg = `
🌐 *TRIAL AKUN ${data.protocol ? data.protocol.toUpperCase() : scriptType.toUpperCase()} (1 Jam)*
┌─────────────────────
│👤 Username : \`${data.username || data.user}\`
│🔑 UUID     : \`${data.uuid || data.password}\`
│🌐 Domain    : \`${data.domain}\`
│📍 IP/City   : \`${data.ip} / ${data.city}\`
└─────────────────────

🔗 *Link Konfigurasi*
${data.link_tls ? `➡️ TLS/WS    : \`${data.link_tls}\`` : ''}
${data.link_ntls ? `➡️ NTLS/WS   : \`${data.link_ntls}\`` : ''}
${data.link_grpc ? `➡️ GRPC      : \`${data.link_grpc}\`` : ''}
${data.link_ws ? `➡️ WS        : \`${data.link_ws}\`` : ''}

📅 *Expired:* \`${data.expiration}\`
✨ By : *SAGI TUNNEL*! ✨
`.trim();
                    return resolve(formattedMsg);
                } else {
                    // Jika skrip menghasilkan JSON tapi status gagal
                    return resolve(`❌ GAGAL! Skrip Trial mengembalikan status gagal.`);
                }
            } catch (e) {
                // Jika skrip menghasilkan SSH/OpenVPN style text, kirimkan langsung
                logger.warn(`Trial script output is not JSON. Sending raw output. Error: ${e.message}`);
                return resolve(`✅ *Trial Akun Berhasil Dibuat!* (1 Jam)\n\n${msg}`);
            }
        });
    });
}

// Keyboard functions 
function keyboard_nomor() {
  const alphabet = '1234567890'; const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({ text: char, callback_data: char }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]); return buttons;
}
function keyboard_abc() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'; const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({ text: char, callback_data: char }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]); return buttons;
}
function keyboard_full() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'; const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({ text: char, callback_data: char }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]); return buttons;
}

// --- FUNGSI PAKASIR ---
async function generatePakasirPayment(userId, amount) {
    const orderId = `PKS-${userId}-${Date.now()}`;
    const redirectUrl = PAKASIR_WEBHOOK_URL.replace('/webhook/pakasir', '/topup-success');
    
    const paymentUrl = pakasir.generatePaymentUrl({
        orderId: orderId, amount: amount, redirect: redirectUrl, qrisOnly: true
    });

    await new Promise((resolve, reject) => {
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        db.run(`INSERT INTO pending_deposits_pakasir (user_id, order_id, amount, status, payment_method, payment_data, expired_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, orderId, amount, 'pending', 'qris', paymentUrl, expiresAt],
            (err) => {
                if (err) { logger.error('Error saving pending deposit:', err.message); return reject(err); }
                resolve();
            }
        );
    });
    return { orderId, paymentUrl, amount };
}
// --- WEBHOOK HANDLER PAKASIR (Dengan Notifikasi Grup) ---

async function handlePakasirWebhook(payload, botInstance) {
    const { order_id, amount, status, project } = payload;
    
    if (status !== 'completed' || project !== PAKASIR_PROJECT_SLUG) {
        logger.warn(`Webhook received but status is not completed or project mismatch. Order ID: ${order_id}, Status: ${status}`);
        return;
    }

    if (global.processedTransactions.has(order_id)) {
        logger.warn(`Webhook received but transaction already processed: ${order_id}`);
        return;
    }
    global.processedTransactions.add(order_id);

    db.get('SELECT user_id, status FROM pending_deposits_pakasir WHERE order_id = ? AND status = ?', [order_id, 'pending'], async (err, row) => {
        if (err) { logger.error(`Error querying pending_deposits for webhook ${order_id}: ${err.message}`); return; }
        if (!row) { logger.warn(`Pending deposit not found or already completed for Order ID: ${order_id}`); return; }
        
        const userId = row.user_id;
        
        db.run('BEGIN TRANSACTION');
        db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, userId], (err) => {
            if (err) { db.run('ROLLBACK'); logger.error(`Error updating user balance for webhook ${order_id}: ${err.message}`); return; }

            db.run('UPDATE pending_deposits_pakasir SET status = ? WHERE order_id = ?', ['completed', order_id], (err) => {
                if (err) { db.run('ROLLBACK'); logger.error(`Error updating pending_deposits status for webhook ${order_id}: ${err.message}`); return; }
                
                db.run('COMMIT');
                logger.info(`✅ Saldo user ${userId} berhasil ditambahkan via Pakasir Webhook. Amount: ${amount}`);

                const messageText = 
                    `🎉 <b>TOP UP SALDO BERHASIL (OTOMATIS)</b> 🎉\n\n` +
                    `Invoice: <code>${order_id}</code>\n` +
                    `Jumlah ditambahkan: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n` +
                    `Metode: ${payload.payment_method || 'QRIS'}\n\n` +
                    `Saldo Anda telah diupdate. Terima kasih!`;
                
                botInstance.telegram.sendMessage(userId, messageText, { parse_mode: 'HTML' }).catch(e => logger.error(`Failed to notify user ${userId}: ${e.message}`));
                
                // NOTIFIKASI KE GRUP
                botInstance.telegram.sendMessage(GROUP_ID, 
                    `📢 <b>NOTIFIKASI TOP UP PAKASIR</b>\n\n` +
                    `✅ *Top Up Berhasil*\n` +
                    `User ID: <code>${userId}</code>\n` +
                    `Order ID: <code>${order_id}</code>\n` +
                    `Jumlah: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n` +
                    `Metode: ${payload.payment_method || 'QRIS'}`,
                    { parse_mode: 'HTML' }
                ).catch(e => logger.error(`Failed to notify admin group: ${e.message}`));
            });
        });
    });
}

// Continuation of Part 1 (omitted for brevity)

// Pasang endpoint webhook di Express
app.post('/webhook/pakasir', (req, res) => {
    const payload = req.body;
    logger.info(`Webhook received. Payload: ${JSON.stringify(payload)}`);

    if (payload && payload.order_id && payload.amount && payload.status) {
        handlePakasirWebhook(payload, bot);
        res.json({ received: true });
    } else {
        res.status(400).json({ error: 'Invalid webhook payload structure.' });
    }
});

// Endpoint dummy untuk redirect sukses
app.get('/topup-success', (req, res) => {
    res.send('Pembayaran Anda sedang diverifikasi. Silakan kembali ke Telegram bot untuk melihat saldo.');
});

bot.command(['start', 'menu'], async (ctx) => {
  if (ctx.chat.type !== 'private') {
      logger.info(`Command /start ignored in chat type: ${ctx.chat.type}`);
      return;
  }
  logger.info('Start or Menu command received');
  const userId = ctx.from.id;

  // *** BARU: Cek Keanggotaan Channel ***
  const isJoined = await isUserJoinedChannel(userId);
  if (!isJoined) {
    const channelLink = `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`;
    const message = 
      '⚠️ *WAJIB JOIN CHANNEL*\n\n' +
      `Karena bot sering terkena suspend, Anda wajib gabung untuk informasi.\n\n` +
      `Silakan klik tombol di bawah, bergabung, lalu klik \`✅ Saya Sudah Bergabung\`.`;
      
    const keyboard = [[{ text: '➡️ Join Channel Sekarang', url: channelLink }],
                      [{ text: '✅ Saya Sudah Bergabung', callback_data: 'check_force_subscribe' }]];
                      
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    
    // Simpan user di DB sebagai member (jika belum ada)
    db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
      if (err) { logger.error('Kesalahan saat memeriksa user_id:', err.message); return; }
      if (!row) { db.run('INSERT INTO users (user_id, role) VALUES (?, ?)', [userId, 'member'], (err) => { if (!err) logger.info(`User ID ${userId} berhasil disimpan sebagai member`); }); }
    });
    return;
  }
  // Jika sudah join, pastikan user terdaftar di DB
  db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err) { logger.error('Kesalahan saat memeriksa user_id:', err.message); return; }
    if (!row) { db.run('INSERT INTO users (user_id, role) VALUES (?, ?)', [userId, 'member'], (err) => { if (!err) logger.info(`User ID ${userId} berhasil disimpan sebagai member`); }); }
  });
  await sendMainMenu(ctx);
}); 

bot.command('admin', async (ctx) => {
  logger.info('Admin menu requested');
  if (!adminIds.includes(ctx.from.id)) { await ctx.reply('🚫 Anda tidak memiliki izin untuk mengakses menu admin.'); return; }
  await sendAdminMenu(ctx);
});

async function sendMainMenu(ctx) {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || '-';
  let user;
  try { user = await getUserDetails(userId); }
  catch (e) { user = { saldo: 0, role: 'member' }; }
  const saldo = user.saldo;
  const role = user.role;
  const roleText = role === 'reseller' ? '💰 RESELLER' : '👤 MEMBER';

  // --- STATISTIK ---
  const latency = (Math.random() * 0.1 + 0.01).toFixed(2);
  let jumlahPengguna = 0;
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS count FROM users', (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    jumlahPengguna = row.count;
  } catch (e) {
    logger.error('Error fetching total user count:', e.message);
    jumlahPengguna = 0;
  }


  // Statistik user
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let userToday = 0, userWeek = 0, userMonth = 0;
  let globalToday = 0, globalWeek = 0, globalMonth = 0;
  try {
    userToday = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [userId, todayStart], (err, row) => resolve(row ? row.count : 0));
    });
    userWeek = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [userId, weekStart], (err, row) => resolve(row ? row.count : 0));
    });
    userMonth = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [userId, monthStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalToday = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [todayStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalWeek = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [weekStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalMonth = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [monthStart], (err, row) => resolve(row ? row.count : 0));
    });
  } catch (e) {}

  const messageText = `
╭─ <b>⚡ WELCOME DI ${NAMA_STORE} ⚡</b>
├ Bot VPN Premium dengan sistem otomatis!
├ Kami Menjaga Kualitas daripada Kuantitas!
└ Dapatkan harga diskon 40% dengan menjadi Reseller!

<b>Hai, <code>${userName}</code>!</b>
ID: <code>${userId}</code>
Status: <b>${roleText}</b>
Saldo: <code>Rp ${saldo.toLocaleString('id-ID')}</code>

<blockquote> <b>Statistik Anda</b>
✨ Hari Ini    : ${userToday} akun
✨ Minggu Ini  : ${userWeek} akun
✨ Bulan Ini   : ${userMonth} akun

<b>Statistik Global</b>
📈 Hari Ini    : ${globalToday} akun
📈 Minggu Ini  : ${globalWeek} akun
📈 Bulan Ini   : ${globalMonth} akun
</blockquote>

👥 Pengguna BOT: ${jumlahPengguna}
⏱️ Latency: ${latency} ms
───────────────────────────`;

  let resellerButton = (role === 'reseller')
    ? { text: '👑 Anda Sudah Reseller (Diskon 40% Aktif)', callback_data: 'role_active_placeholder' }
    : { text: `👑 Upgrade Reseller (Rp${RESELLER_PRICE.toLocaleString('id-ID')})`, callback_data: 'upgrade_reseller_confirm' };

  const keyboard = [
    // Trial dipindah ke samping Create
    [{ text: '➕ Create Akun', callback_data: 'service_create' }, { text: '🆓 Trial Akun', callback_data: 'trial_account' }], 
    [{ text: '💰 Top Up Saldo', callback_data: 'topup_saldo' }, { text: '♻️ Renew Akun', callback_data: 'service_renew' }],
    [{ text: '🚀 Tembak Dor', url: `https://t.me/${ADMIN_USERNAME_TEMBAK_PAKET.replace('@', '')}` }],
    [resellerButton]
  ];

  if (adminIds.includes(userId)) { keyboard.unshift([{ text: '🛠️ Menu Admin', callback_data: 'admin_menu' }]); }

  try {
    const options = { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
    if (ctx.updateType === 'callback_query') { await ctx.editMessageText(messageText, options); }
    else { await ctx.reply(messageText, options); }
  } catch (error) { logger.error('Error saat mengirim/mengedit menu utama:', error); }
}

// --- KODE KE MENU RAHMARIE --- 
bot.action('send_main_menu', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await sendMainMenu(ctx);
        // Hapus state setelah kembali ke menu utama
        delete userState[ctx.chat.id]; 
    } catch (e) {
        logger.error('Error saat kembali ke menu utama:', e.message);
        // Jika editMessageText gagal (karena sudah terlalu lama), kirim pesan baru
        await ctx.reply('Kembali ke Menu Utama.');
        delete userState[ctx.chat.id];
    }
});

// --- ACTION HANDLER FORCE SUBSCRIBE ---
// Continuation of Part 1 (omitted for brevity)
// ...

// --- ACTION HANDLER FORCE SUBSCRIBE ---
bot.action('check_force_subscribe', async (ctx) => {
    // 1. Jawab Callback Query (Wajib)
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    // Gunakan fungsi yang sudah diperbaiki (dengan 'restricted')
    const isJoined = await isUserJoinedChannel(userId); 

    if (isJoined) {
        // Jika sudah join, kirim pesan sukses
        try {
           await ctx.editMessageText('✅ Terima kasih sudah bergabung! Anda sekarang dapat menggunakan bot.\n Haram hukumnya report bot karena iri dengki', {
               reply_markup: { inline_keyboard: [[{ text: '➡️ Ke Menu Utama', callback_data: 'send_main_menu' }]] }
           });
        } catch (e) {
           // Jika edit gagal (sudah lama/terhapus), kirim pesan baru
           // Error message is not modified tidak akan terjadi di sini karena kita mengedit pesan yang berhasil dicek.
           await ctx.reply('✅ Terima kasih sudah bergabung! Anda sekarang dapat menggunakan bot.\n Haram hukumnya report bot karena iri dengki');
        }
        // Lanjutkan ke menu utama
        await sendMainMenu(ctx);
    } else {
        // Jika belum join, bot akan menampilkan pesan paksa gabung lagi.
        const channelLink = `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`;
        const message = 
          '❌ *Anda belum bergabung!*\n\n' +
          `Karena bot sering terkena suspend, harap gabung dulu ke channel ini untuk informasi ya!: [${CHANNEL_USERNAME}](${channelLink}).\n\n` +
          `Jika sudah bergabung, coba klik \`✅ Saya Sudah Bergabung\` lagi.`;

        const keyboard = [[{ text: '➡️ Join Channel Sekarang', url: channelLink }],
                          [{ text: '✅ Saya Sudah Bergabung', callback_data: 'check_force_subscribe' }]];
                          
        try {
            // Coba edit pesan
            await ctx.editMessageText(message, { 
                parse_mode: 'Markdown', 
                reply_markup: { inline_keyboard: keyboard } 
            });
        } catch (e) {
             // Tangani error "message is not modified"
             if (e.message && !e.message.includes('message is not modified')) {
                 logger.error('Error saat mengedit pesan force subscribe:', e);
             }
             // Jika errornya adalah "message is not modified", bot akan mengabaikannya 
             // dan menghindari crash yang menyebalkan di log.
        }
    }
});

// --- LOGIKA UPGRADE RESELLER (TEKS VALIDASI DIBUAT KONSTAN & RINGKAS) ---
bot.action('upgrade_reseller_confirm', async (ctx) => {
    const userId = ctx.from.id; await ctx.answerCbQuery();
    
    // Teks validasi yang diminta
    const validationText = 
      `Apakah kamu yakin ingin menjadi reseller? Saldo akan terpotong sekitar <b>Rp${RESELLER_PRICE.toLocaleString('id-ID')}</b>.\n\n` +
      '<b>Manfaat menjadi reseller:</b>\n' +
      `• Harga pembelian layanan diskon <b>${RESELLER_DISCOUNT_PERCENT}%</b>.\n` +
      `• Batas akun Trial harian menjadi <b>${RESELLER_TRIAL_LIMIT}</b> kali (Normal: ${MEMBER_TRIAL_LIMIT}).\n\n` +
      'Lanjutkan?';
      
    await ctx.editMessageText(
        '⚠️ <b>VALIDASI UPGRADE RESELLER</b>\n\n' + validationText,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
            [{ text: '✅ Ya, Saya Yakin', callback_data: 'upgrade_reseller_execute' }],
            [{ text: '❌ Tidak, Kembali', callback_data: 'send_main_menu' }]
        ] }}
    );
});

bot.action('upgrade_reseller_execute', async (ctx) => {
    const userId = ctx.from.id; await ctx.answerCbQuery();
    let user; try { user = await getUserDetails(userId); } catch (e) { return ctx.reply('❌ GAGAL: Terjadi kesalahan saat mengambil detail akun Anda.', { parse_mode: 'Markdown' }); }

    if (user.role === 'reseller') { return ctx.reply('⚠️ Anda sudah menjadi Reseller! Tidak perlu upgrade lagi.', { parse_mode: 'Markdown' }); }
    if (user.saldo < RESELLER_PRICE) { return ctx.reply(`❌ GAGAL: Saldo Anda tidak mencukupi. Saldo saat ini: Rp${user.saldo.toLocaleString('id-ID')}. Diperlukan: Rp${RESELLER_PRICE.toLocaleString('id-ID')}.`, { parse_mode: 'Markdown' }); }

    db.run('BEGIN TRANSACTION');
    db.run('UPDATE users SET saldo = saldo - ?, role = ? WHERE user_id = ?', [RESELLER_PRICE, 'reseller', userId], async function (err) {
        if (err) { db.run('ROLLBACK'); return ctx.reply('❌ GAGAL: Terjadi kesalahan saat memproses upgrade Reseller. Saldo tidak terpotong.', { parse_mode: 'Markdown' }); }
        db.run('COMMIT');
        
        await ctx.reply('🎉 <b>SELAMAT! Anda telah berhasil menjadi Reseller!</b>\n\n' + `Saldo Anda terpotong sebesar <b>Rp${RESELLER_PRICE.toLocaleString('id-ID')}</b>.\n` + `Nikmati harga layanan yang lebih murah (Diskon ${RESELLER_DISCOUNT_PERCENT}%) dan batas Trial lebih besar.`, { parse_mode: 'HTML' });

        const userInfo = await bot.telegram.getChat(userId).catch(() => ({ first_name: 'Unknown User' }));
        const username = userInfo.username ? `@${userInfo.username}` : (userInfo.first_name || userId);
        
        // NOTIFIKASI UPGRADE RESELLER KE GRUP
        await bot.telegram.sendMessage(GROUP_ID, 
            `<blockquote>👑 <b>UPGRADE RESELLER BERHASIL</b>\n👤 User: <b>${username}</b>\nID: <code>${userId}</code>\nNominal Terpotong: <b>Rp${RESELLER_PRICE.toLocaleString('id-ID')}</b>\nSelamat datang Reseller baru!</blockquote>`, 
            { parse_mode: 'HTML' }
        );

        await sendMainMenu(ctx);
    });
});

bot.action('trial_account', async (ctx) => { await handleTrialMenu(ctx); });

async function handleTrialMenu(ctx) {
    await ctx.answerCbQuery();
    const keyboard = [
      [{ text: 'Trial SSH', callback_data: 'trial_ssh' }],
      [{ text: 'Trial Vmess', callback_data: 'trial_vmess' }, { text: 'Trial Vless', callback_data: 'trial_vless' }],
      [{ text: 'Trial Trojan', callback_data: 'trial_trojan' }, { text: 'Trial Shadowsocks', callback_data: 'trial_shadowsocks' }],
      [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]
    ];
    // Diubah deskripsi masa aktif menjadi 1 Jam (Sesuai skrip SH Anda)
    await ctx.editMessageText('🆓 *Pilih jenis Trial Akun (Masa Aktif 1 Jam):*', {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown'
    });
}

// --- FUNGSI TAMPILAN SERVER (CREATE/RENEW) ---
async function startSelectServer(ctx, action, type, page = 0) {
  try {
    const userId = ctx.from.id;
    const user = await getUserDetails(userId);
    const userRole = user.role;

    db.all('SELECT * FROM Server', [], (err, servers) => {
      if (err) { return ctx.reply('⚠️ <b>PERHATIAN!</b> Tidak ada server yang tersedia saat ini. Coba lagi nanti!', { parse_mode: 'HTML' }); }
      if (servers.length === 0) { return ctx.reply('⚠️ <b>PERHATIAN!</b> Tidak ada server yang tersedia saat ini. Coba lagi nanti!', { parse_mode: 'HTML' }); }

      const serversPerPage = 6;
      const totalPages = Math.ceil(servers.length / serversPerPage);
      const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
      const start = currentPage * serversPerPage;
      const end = start + serversPerPage;
      const currentServers = servers.slice(start, end);

      const keyboard = [];
      for (let i = 0; i < currentServers.length; i += 2) {
        const row = [];
        const server1 = currentServers[i];
        const server2 = currentServers[i + 1];
        row.push({ text: server1.nama_server, callback_data: `${action}_username_${type}_${server1.id}` });
        if (server2) { row.push({ text: server2.nama_server, callback_data: `${action}_username_${type}_${server2.id}` }); }
        keyboard.push(row);
      }

      const navButtons = [];
      if (totalPages > 1) { 
        if (currentPage > 0) { navButtons.push({ text: '⬅️ Back', callback_data: `Maps_${action}_${type}_${currentPage - 1}` }); }
        if (currentPage < totalPages - 1) { navButtons.push({ text: '➡️ Next', callback_data: `Maps_${action}_${type}_${currentPage + 1}` }); }
      }
      if (navButtons.length > 0) { keyboard.push(navButtons); }
      keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);

      const serverList = currentServers.map(server => {
        const normalPrice = server.harga;
        const pricePerDay = calculatePrice(normalPrice, userRole);
        const pricePer30Days = pricePerDay * 30;
        const isFull = server.total_create_akun >= server.batas_create_akun;
        
        let priceText = `💰 Harga per hari: Rp${pricePerDay.toLocaleString('id-ID')}\n`;
        priceText += `📅 Harga per 30 hari: Rp${pricePer30Days.toLocaleString('id-ID')}\n`;
        if (userRole === 'reseller') { priceText += `(Harga Normal: Rp${normalPrice.toLocaleString('id-ID')}/hari)`; }

        return `🌐 *${server.nama_server}* (${server.domain})\n` + priceText + 
               `\n📊 Quota: ${server.quota}GB\n` + `🔢 Limit IP: ${server.iplimit} IP\n` +
               (isFull ? `⚠️ *Server Penuh*` : `👥 Total Create Akun: ${server.total_create_akun}/${server.batas_create_akun}`);
      }).join('\n\n');

      const options = { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' };
      if (ctx.updateType === 'callback_query') { ctx.editMessageText(`📋 *List Server (Halaman ${currentPage + 1} dari ${totalPages}):*\n\n${serverList}`, options); } 
      else { ctx.reply(`📋 *List Server (Halaman ${currentPage + 1} dari ${totalPages}):*\n\n${serverList}`, options); }
      userState[ctx.chat.id] = { step: `${action}_username_${type}`, page: currentPage };
    });
  } catch (error) { logger.error(`❌ Error saat memulai proses ${action} untuk ${type}:`, error); await ctx.reply(`❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.`, { parse_mode: 'Markdown' }); }
}

// --- ACTION UNTUK MEMULAI CREATE/RENEW ---
bot.action('service_create', async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = [[{ text: 'Buat SSH', callback_data: 'create_ssh' }],
      [{ text: 'Buat Vmess', callback_data: 'create_vmess' }, { text: 'Buat Vless', callback_data: 'create_vless' }],
      [{ text: 'Buat Trojan', callback_data: 'create_trojan' }, { text: 'Buat Shadowsocks', callback_data: 'create_shadowsocks' }],
      [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]];
    await ctx.editMessageText('➕ *Pilih jenis akun yang ingin Anda buat:*', { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
});
bot.action('service_renew', async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = [[{ text: 'Perpanjang SSH', callback_data: 'renew_ssh' }],
      [{ text: 'Perpanjang Vmess', callback_data: 'renew_vmess' }, { text: 'Perpanjang Vless', callback_data: 'renew_vless' }],
      [{ text: 'Perpanjang Trojan', callback_data: 'renew_trojan' }, { text: 'Perpanjang Shadowsocks', callback_data: 'renew_shadowsocks' }],
      [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]];
    await ctx.editMessageText('♻️ *Pilih jenis akun yang ingin Anda perpanjang:*', { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
});

bot.action(/Maps_(\w+)_(\w+)_(\d+)/, async (ctx) => {
  const [, action, type, page] = ctx.match;
  await ctx.answerCbQuery();
  await startSelectServer(ctx, action, type, parseInt(page, 10));
});
bot.action(/(create|renew)_(vmess|vless|trojan|shadowsocks|ssh)/, async (ctx) => {
    const action = ctx.match[1]; const type = ctx.match[2]; await startSelectServer(ctx, action, type, 0);
});
bot.action(/(create|renew)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const action = ctx.match[1]; const type = ctx.match[2]; const serverId = ctx.match[3];
  userState[ctx.chat.id] = { step: `username_${action}_${type}`, serverId, type, action };

  db.get('SELECT batas_create_akun, total_create_akun FROM Server WHERE id = ?', [serverId], async (err, server) => {
    if (err) { return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' }); }
    if (!server) { return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' }); }
    if (server.total_create_akun >= server.batas_create_akun) { return ctx.reply('❌ *Server penuh. Tidak dapat membuat akun baru di server ini.*', { parse_mode: 'Markdown' }); }
    await ctx.reply('👤 *Masukkan username:*', { parse_mode: 'Markdown' });
  });
});

// --- ACTION UNTUK MEMULAI TRIAL (DENGAN LOGIKA LIMIT) ---
bot.action(/(trial)_(vmess|vless|trojan|shadowsocks|ssh)/, async (ctx) => {
    const action = ctx.match[1]; const type = ctx.match[2];
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    
    let user;
    try {
        user = await getUserDetails(userId);
    } catch(e) {
        return ctx.reply('❌ GAGAL: Terjadi kesalahan saat memproses detail akun Anda.', { parse_mode: 'Markdown' });
    }

    const today = new Date().toISOString().split('T')[0];
    const isNewDay = user.last_trial_date !== today;
    
    // Reset counter jika hari baru
    if (isNewDay) {
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET daily_trial_count = 0, last_trial_date = ? WHERE user_id = ?', [today, userId], (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
        user.daily_trial_count = 0;
    }

    const maxLimit = user.role === 'reseller' ? RESELLER_TRIAL_LIMIT : MEMBER_TRIAL_LIMIT;

    if (user.daily_trial_count >= maxLimit) {
        return ctx.reply(`❌ *Batas Akun Trial Harian Tercapai!* Anda telah menggunakan ${user.daily_trial_count} dari ${maxLimit} batas trial harian. Batas akan direset besok.`, { parse_mode: 'Markdown' });
    }
    
    // Lanjutkan ke langkah input username
    userState[ctx.chat.id] = { step: `username_${action}_${type}`, action, type };
    await ctx.reply('👤 *Masukkan username untuk akun Trial:*', { parse_mode: 'Markdown' });
});

// --- ACTION UNTUK TOP UP SALDO BARU ---
bot.action('topup_saldo', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        userState[ctx.chat.id] = { step: 'request_pakasir_amount', amount: '' };
        await ctx.editMessageText(
            `💰 *TOP UP SALDO (OTOMATIS)*\n\n` +
            `Silakan masukkan jumlah nominal saldo (hanya angka) yang Anda ingin tambahkan ke akun Anda.\n` +
            `Minimal Top Up adalah *Rp ${MIN_DEPOSIT_AMOUNT.toLocaleString('id-ID')}*.\n\n` +
            `_Contoh: 50000_`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        logger.error('❌ Kesalahan saat memulai proses top-up saldo otomatis:', error);
        await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
    }
});

// --- TEXT HANDLER UTAMA ---
bot.on('text', async (ctx) => {
  const state = userState[ctx.chat.id];
  if (!state) return;

  const text = ctx.message.text.trim();

  // --- 1. FLOW CREATE/RENEW ---
  if (state.step.startsWith('username_') && state.action !== 'trial') {
    state.username = text;

    if (
      !state.username ||
      state.username.length < 3 ||
      state.username.length > 20 ||
      /[A-Z]/.test(state.username) ||
      /[^a-z0-9]/.test(state.username)
    ) {
      return ctx.reply(
        '❌ *Username tidak valid. Gunakan 3-20 karakter, huruf kecil, dan angka saja.*',
        { parse_mode: 'Markdown' }
      );
    }

    const { type, action } = state;

    if (action === 'create' && type === 'ssh') {
      state.step = `password_${state.action}_${state.type}`;
      await ctx.reply('🔑 *Masukkan password:*', { parse_mode: 'Markdown' });
    } else {
      state.step = `exp_${state.action}_${state.type}`;
      await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
    }
  }

  // --- 2. FLOW PASSWORD ---
  else if (state.step.startsWith('password_')) {
    state.password = text;

    if (
      !state.password ||
      state.password.length < 6 ||
      /[^a-zA-Z0-9]/.test(state.password)
    ) {
      return ctx.reply(
        '❌ *Password tidak valid. Gunakan minimal 6 karakter (huruf/angka).*',
        { parse_mode: 'Markdown' }
      );
    }

    state.step = `exp_${state.action}_${state.type}`;
    await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
  }

  // --- 3. FLOW INPUT MASA AKTIF ---
  else if (state.step.startsWith('exp_')) {
    const exp = parseInt(text, 10);
    if (isNaN(exp) || exp <= 0 || exp > 365) {
      return ctx.reply(
        '❌ *Masa aktif tidak valid. Masukkan angka yang valid (1–365 hari).*',
        { parse_mode: 'Markdown' }
      );
    }

    state.exp = exp;

    db.get(
      'SELECT quota, iplimit, harga, nama_server FROM Server WHERE id = ?',
      [state.serverId],
      async (err, server) => {
        if (err || !server) {
          return ctx.reply(
            '❌ *Terjadi kesalahan saat mengambil detail server.*',
            { parse_mode: 'Markdown' }
          );
        }

        state.quota = server.quota;
        state.iplimit = server.iplimit;

        const user = await getUserDetails(ctx.from.id);
        const pricePerDay = calculatePrice(server.harga, user.role);
        const totalHarga = pricePerDay * state.exp;

        if (user.saldo < totalHarga) {
          return ctx.reply(
            `❌ *Saldo Anda tidak mencukupi. Harga total: Rp${totalHarga.toLocaleString('id-ID')}.*`,
            { parse_mode: 'Markdown' }
          );
        }

        let msg;
        const { username, password, exp, quota, iplimit, serverId, type, action } = state;

        // --- PEMBUATAN AKUN ---
        if (action === 'create') {
          if (type === 'vmess') msg = await createvmess(username, exp, quota, iplimit, serverId);
          else if (type === 'vless') msg = await createvless(username, exp, quota, iplimit, serverId);
          else if (type === 'trojan') msg = await createtrojan(username, exp, quota, iplimit, serverId);
          else if (type === 'shadowsocks') msg = await createshadowshocks(username, exp, quota, iplimit, serverId);
          else if (type === 'ssh') msg = await createssh(username, password, exp, iplimit, serverId);
          
          // Penambahan total_create_akun hanya saat CREATE
          db.run(
            'UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?',
            [serverId],
            (err) => {
              if (err) {
                logger.error('Error saat menambah total_create_akun:', err.message);
                // Lanjutkan proses meskipun update server gagal (prioritas transaksi)
              }
            }
          );
        }

        // --- PERPANJANG AKUN ---
        else if (action === 'renew') {
          if (type === 'vmess') msg = await renewvmess(username, exp, quota, iplimit, serverId);
          else if (type === 'vless') msg = await renewvless(username, exp, quota, iplimit, serverId);
          else if (type === 'trojan') msg = await renewtrojan(username, exp, quota, iplimit, serverId);
          else if (type === 'shadowsocks') msg = await renewshadowshocks(username, exp, quota, iplimit, serverId);
          else if (type === 'ssh') msg = await renewssh(username, exp, iplimit, serverId);
        }

        // Catat transaksi
        await recordAccountTransaction(ctx.from.id, type);
        logger.info(`Account ${action} transaction recorded for user ${ctx.from.id}, type: ${type}`);

        // Kurangi saldo
        db.run('BEGIN TRANSACTION');
        db.run(
          'UPDATE users SET saldo = saldo - ? WHERE user_id = ?',
          [totalHarga, ctx.from.id],
          (err) => {
            if (err) {
              db.run('ROLLBACK');
              return ctx.reply(
                '❌ *Terjadi kesalahan saat mengurangi saldo pengguna. Transaksi dibatalkan.*',
                { parse_mode: 'Markdown' }
              );
            }

            db.run('COMMIT');
            ctx.reply(
              `✅ *Transaksi Berhasil!* Saldo terpotong: Rp${totalHarga.toLocaleString('id-ID')}.\n\n${msg}`,
              { parse_mode: 'Markdown' }
            );

            delete userState[ctx.chat.id];
          }
        );
      }
    );
  }

  // --- 4. FLOW TRIAL ---
  else if (state.step.startsWith('username_') && state.action === 'trial') {
    state.username = text;

    if (
      !state.username ||
      state.username.length < 3 ||
      state.username.length > 20 ||
      /[A-Z]/.test(state.username) ||
      /[^a-z0-9]/.test(state.username)
    ) {
      return ctx.reply(
        '❌ *Username Trial tidak valid. Gunakan 3-20 karakter, huruf kecil, dan angka saja.*',
        { parse_mode: 'Markdown' }
      );
    }

    const { username, type } = state;
    const userId = ctx.from.id;

    const msg = await executeScript(type, username);

    if (msg.startsWith('❌')) {
      ctx.reply(msg, { parse_mode: 'Markdown' });
    } else {
      const today = new Date().toISOString().split('T')[0];
      db.run(
        'UPDATE users SET daily_trial_count = daily_trial_count + 1, last_trial_date = ? WHERE user_id = ?',
        [today, userId],
        (err) => {
          if (err) logger.error('Error updating trial count:', err.message);
        }
      );
      ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    delete userState[ctx.chat.id];
  }

  // --- 5. FLOW TOP UP PAKASIR ---
  else if (state.step === 'request_pakasir_amount') {
    const amount = parseInt(text, 10);
    if (isNaN(amount) || amount < MIN_DEPOSIT_AMOUNT) {
      return ctx.reply(
        `❌ *Nominal tidak valid.* Masukkan angka yang valid (minimal Rp${MIN_DEPOSIT_AMOUNT.toLocaleString('id-ID')}).`,
        { parse_mode: 'Markdown' }
      );
    }

    await ctx.reply(
      `📝 *Konfirmasi Top Up Saldo Otomatis:*\n\n💰 Jumlah Nominal: *Rp ${amount.toLocaleString('id-ID')}*\n\nTekan tombol di bawah untuk membuat tautan pembayaran QRIS Pakasir.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `💳 Buat Pembayaran Rp ${amount.toLocaleString('id-ID')}`, callback_data: `create_pakasir_payment_${amount}` }],
            [{ text: '❌ Batalkan', callback_data: 'send_main_menu' }]
          ]
        },
        parse_mode: 'Markdown'
      }
    );

    delete userState[ctx.chat.id];
  }

  // --- 6. FLOW ADMIN ADD SERVER ---
  else if (state.step === 'addserver' || state.step.startsWith('addserver_')) {
    if (state.step === 'addserver') {
      const domain = text;
      if (!domain) return ctx.reply('⚠️ *Domain tidak boleh kosong.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_auth';
      state.domain = domain;
      await ctx.reply('🔑 *Masukkan auth server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_auth') {
      const auth = text;
      if (!auth) return ctx.reply('⚠️ *Auth tidak boleh kosong.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_nama_server';
      state.auth = auth;
      await ctx.reply('🏷️ *Masukkan nama server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_nama_server') {
      const nama_server = text;
      if (!nama_server) return ctx.reply('⚠️ *Nama server tidak boleh kosong.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_quota';
      state.nama_server = nama_server;
      await ctx.reply('📊 *Masukkan quota server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_quota') {
      const quota = parseInt(text, 10);
      if (isNaN(quota)) return ctx.reply('⚠️ *Quota tidak valid.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_iplimit';
      state.quota = quota;
      await ctx.reply('🔢 *Masukkan limit IP server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_iplimit') {
      const iplimit = parseInt(text, 10);
      if (isNaN(iplimit)) return ctx.reply('⚠️ *Limit IP tidak valid.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_batas_create_akun';
      state.iplimit = iplimit;
      await ctx.reply('🔢 *Masukkan batas create akun server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_batas_create_akun') {
      const batas_create_akun = parseInt(text, 10);
      if (isNaN(batas_create_akun)) return ctx.reply('⚠️ *Batas create akun tidak valid.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_harga';
      state.batas_create_akun = batas_create_akun;
      await ctx.reply('💰 *Masukkan harga server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_harga') {
      const harga = parseFloat(text);
      if (isNaN(harga) || harga <= 0)
        return ctx.reply('⚠️ *Harga tidak valid.*', { parse_mode: 'Markdown' });

      const { domain, auth, nama_server, quota, iplimit, batas_create_akun } = state;
      try {
        db.run(
          'INSERT INTO Server (domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, 0],
          function (err) {
            if (err) {
              logger.error('Error saat menambahkan server:', err.message);
              ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
            } else {
              ctx.reply(
                `✅ *Server baru dengan domain ${domain} berhasil ditambahkan.*\n\n📄 *Detail:*\n- Domain: ${domain}\n- Auth: ${auth}\n- Nama: ${nama_server}\n- Quota: ${quota}\n- Limit IP: ${iplimit}\n- Batas Create: ${batas_create_akun}\n- Harga: Rp ${harga.toLocaleString('id-ID')}`,
                { parse_mode: 'Markdown' }
              );
            }
          }
        );
      } catch (error) {
        logger.error('Error saat menambahkan server:', error);
        await ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
      }

      delete userState[ctx.chat.id];
    }
  }
}); // ✅ Menutup bot.on('text', async (ctx) => { ... )

// --- ACTION HANDLERS PAKASIR ---
bot.action(/create_pakasir_payment_(\d+)/, async (ctx) => {
    const amount = parseInt(ctx.match[1], 10);
    const userId = ctx.from.id;
    await ctx.answerCbQuery('Membuat tautan pembayaran Pakasir...');

    try {
        const { orderId, paymentUrl } = await generatePakasirPayment(userId, amount);

        const expiryDate = new Date(Date.now() + 60 * 60 * 1000);
        const expiryText = expiryDate.toLocaleTimeString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const message =
            `✅ *TAUTAN PEMBAYARAN TERSEDIA*\n\n` +
            `Invoice ID: \`${orderId}\`\n` +
            `Nominal: *Rp ${amount.toLocaleString('id-ID')}*\n` +
            `Metode: *QRIS*\n` +
            `Kadaluarsa: ${expiryText} WIB\n\n` +
            `Klik tombol di bawah untuk membayar menggunakan QRIS. Saldo akan ditambahkan otomatis setelah pembayaran berhasil dikonfirmasi Pakasir (via Webhook).\n\n` +
            ``;

        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💳 Klik Untuk Bayar (QRIS)', url: paymentUrl }],
                    [{ text: '🔄 Cek Status Transaksi', callback_data: `check_pakasir_status_${orderId}` }],
                    [{ text: '❌ Batalkan', callback_data: 'send_main_menu' }]
                ]
            }
        });
    } catch (error) {
        logger.error('❌ Error creating Pakasir payment:', error.message);
        await ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat membuat tautan pembayaran. Coba lagi nanti.', { parse_mode: 'Markdown' });
    }
});

bot.action(/check_pakasir_status_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery('Mengecek status pembayaran...');
    
    try {
        const pending = await new Promise((resolve, reject) => {
            db.get('SELECT amount FROM pending_deposits_pakasir WHERE order_id = ? AND status = ?', [orderId, 'pending'], (err, row) => { if (err) return reject(err); resolve(row); });
        });

        if (!pending) { return ctx.reply('✅ *Transaksi sudah selesai atau tidak ditemukan.* Silakan cek saldo Anda.', { parse_mode: 'Markdown' }); }

        const amount = pending.amount;
        // Asumsi checkTransactionStatus sudah tersedia di PakasirClient
        const statusResponse = await pakasir.checkTransactionStatus(orderId, amount); 
        const status = statusResponse.transaction.status;

        if (status === 'completed') {
            await handlePakasirWebhook({ order_id: orderId, amount: amount, project: PAKASIR_PROJECT_SLUG, status: 'completed', payment_method: 'qris' }, bot);
            return ctx.reply('✅ *Pembayaran berhasil dikonfirmasi!* Saldo Anda telah ditambahkan secara otomatis.', { parse_mode: 'Markdown' });
        } else if (status === 'pending') {
            return ctx.reply(`⏳ *Status Transaksi: Menunggu Pembayaran*\n\nInvoice: \`${orderId}\`\nNominal: *Rp ${amount.toLocaleString('id-ID')}*\n\nMohon selesaikan pembayaran sebelum batas waktu.`, { parse_mode: 'Markdown' });
        } else { 
            return ctx.reply(`❌ *Status Transaksi: ${status.toUpperCase()}*\n\nTransaksi ini sudah tidak valid. Silakan buat transaksi Top Up baru.`, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        logger.error('❌ Error checking Pakasir status:', error.message);
        await ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat mengecek status pembayaran. Coba lagi nanti.', { parse_mode: 'Markdown' });
    }
});

// --- ADMIN COMMANDS ---

async function sendAdminMenu(ctx) {
  const adminKeyboard = [
    [{ text: '➕ Tambah Server', callback_data: 'addserver' }, { text: '❌ Hapus Server', callback_data: 'deleteserver' }],
    [{ text: '💲 Edit Harga', callback_data: 'editserver_harga' }, { text: '📝 Edit Nama', callback_data: 'editserver_nama' }],
    [{ text: '🌐 Edit Domain', callback_data: 'editserver_domain' }, { text: '🔑 Edit Auth', callback_data: 'editserver_auth' }],
    [{ text: '📊 Edit Quota', callback_data: 'editserver_quota' }, { text: '📶 Edit Limit IP', callback_data: 'editserver_limit_ip' }],
    [{ text: '🔢 Edit Batas Create', callback_data: 'editserver_batas_create_akun' }, { text: '🔢 Edit Total Create', callback_data: 'editserver_total_create_akun' }],
    [{ text: '💵 Tambah Saldo', callback_data: 'addsaldo_user' }, { text: '📋 List Server', callback_data: 'listserver' }],
    [{ text: '♻️ Reset Server', callback_data: 'resetdb' }, { text: 'ℹ️ Detail Server', callback_data: 'detailserver' }],
    [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]
  ];
  try {
    const options = { reply_markup: { inline_keyboard: adminKeyboard } };
    if (ctx.updateType === 'callback_query') { await ctx.editMessageText('Menu Admin:', options); }
    else { await ctx.reply('Menu Admin:', options); }
  } catch (error) { logger.error('Error saat mengirim menu admin:', error); }
}

bot.command('addsaldo', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) { return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' }); }
  const args = ctx.message.text.split(' ');
  if (args.length !== 3) { return ctx.reply('⚠️ Format salah. Gunakan: `/addsaldo <user_id> <jumlah>`', { parse_mode: 'Markdown' }); }
  const targetUserId = parseInt(args[1]);
  const amount = parseInt(args[2]);
  if (isNaN(targetUserId) || isNaN(amount) || amount <= 0) { return ctx.reply('⚠️ `user_id` dan `jumlah` harus berupa angka positif.', { parse_mode: 'Markdown' }); }
  db.get("SELECT * FROM users WHERE user_id = ?", [targetUserId], (err, row) => {
      if (err) { return ctx.reply('⚠️ Kesalahan saat memeriksa `user_id`.', { parse_mode: 'Markdown' }); }
      if (!row) { return ctx.reply('⚠️ `user_id` tidak terdaftar.', { parse_mode: 'Markdown' }); }
      db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [amount, targetUserId], function(err) {
          if (err) { return ctx.reply('⚠️ Kesalahan saat menambahkan saldo.', { parse_mode: 'Markdown' }); }
          if (this.changes === 0) { return ctx.reply('⚠️ Pengguna tidak ditemukan.', { parse_mode: 'Markdown' }); }
          ctx.reply(`✅ Saldo sebesar \`${amount.toLocaleString('id-ID')}\` berhasil ditambahkan untuk \`user_id\` \`${targetUserId}\`.`, { parse_mode: 'Markdown' });
      });
  });
});

bot.command('hapuslog', async (ctx) => {
  if (!adminIds.includes(ctx.from.id)) return ctx.reply('Tidak ada izin!');
  try {
    if (fs.existsSync('bot-combined.log')) fs.unlinkSync('bot-combined.log');
    if (fs.existsSync('bot-error.log')) fs.unlinkSync('bot-error.log');
    ctx.reply('Log berhasil dihapus.');
  } catch (e) { ctx.reply('Gagal menghapus log: ' + e.message); }
});

bot.command('helpadmin', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) { return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' }); }
  const helpMessage = `*📋 Daftar Perintah Admin:*\n1. /addsaldo <user_id> <jumlah> - Menambahkan saldo secara manual.\n2. /admin - Membuka menu admin (CRUD Server).\n3. /hapuslog - Menghapus file log bot.\n4. /broadcast <pesan> - Mengirim pesan siaran ke semua pengguna.`; 
  ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

bot.command('broadcast', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) { return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' }); }
  const message = ctx.message.reply_to_message ? ctx.message.reply_to_message.text : ctx.message.text.split(' ').slice(1).join(' ');
  if (!message) { return ctx.reply('⚠️ Mohon berikan pesan untuk disiarkan.', { parse_mode: 'Markdown' }); }
  db.all("SELECT user_id FROM users", [], (err, rows) => {
      if (err) { return ctx.reply('⚠️ Kesalahan saat mengambil daftar pengguna.', { parse_mode: 'Markdown' }); }
      rows.forEach((row) => {
          const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
          axios.post(telegramUrl, { chat_id: row.user_id, text: message }).catch((error) => { logger.error(`⚠️ Kesalahan saat mengirim pesan siaran ke ${row.user_id}`, error.message); });
      });
      ctx.reply('✅ Pesan siaran berhasil dikirim.', { parse_mode: 'Markdown' });
  });
});

// --- ACTION HANDLERS ADMIN CRUD ---
bot.action('admin_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await sendAdminMenu(ctx);
});

bot.action('addserver', async (ctx) => {
  try {
    await ctx.answerCbQuery('Memulai penambahan server...');
    await ctx.reply('🌐 *Silakan masukkan domain/ip server:*', { parse_mode: 'Markdown' });
    userState[ctx.chat.id] = { step: 'addserver' };
  }
  catch (error) { 
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
}); // <-- Penutup yang benar untuk bot.action('addserver')

bot.action('deleteserver', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    db.all('SELECT * FROM Server', [], (err, servers) => {
      if (err) { return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' }); }
      if (servers.length === 0) { return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' }); }
      const keyboard = servers.map(server => { return [{ text: server.nama_server, callback_data: `confirm_delete_server_${server.id}` }]; });
      keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);
      ctx.reply('🗑️ *Pilih server yang ingin dihapus:*', { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
    });
  } catch (error) { await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' }); }
});

bot.action(/confirm_delete_server_(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    db.run('DELETE FROM Server WHERE id = ?', [ctx.match[1]], function(err) {
      if (err) { return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat menghapus server.*', { parse_mode: 'Markdown' }); }
      if (this.changes === 0) { return ctx.reply('⚠️ *PERHATIAN! Server tidak ditemukan.*', { parse_mode: 'Markdown' }); }
      ctx.reply('✅ *Server berhasil dihapus.*', { parse_mode: 'Markdown' });
    });
  } catch (error) { await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' }); }
});

bot.action('resetdb', async (ctx) => {
  try { await ctx.answerCbQuery(); await ctx.reply('🚨 *PERHATIAN! Anda akan menghapus semua server yang tersedia. Apakah Anda yakin?*', { reply_markup: { inline_keyboard: [[{ text: '✅ Ya', callback_data: 'confirm_resetdb' }], [{ text: '❌ Tidak', callback_data: 'cancel_resetdb' }]] }, parse_mode: 'Markdown' }); }
  catch (error) { await ctx.reply(`❌ *Terjadi kesalahan.*`, { parse_mode: 'Markdown' }); }
});
bot.action('confirm_resetdb', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM Server', (err) => {
        if (err) { return reject('❗️ *PERHATIAN! Terjadi KESALAHAN SERIUS saat mereset database. Harap segera hubungi administrator!*'); }
        resolve();
      });
    });
    await ctx.reply('🚨 *PERHATIAN! Database telah DIRESET SEPENUHNYA. Semua server telah DIHAPUS TOTAL.*', { parse_mode: 'Markdown' });
  } catch (error) { await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' }); }
});
bot.action('cancel_resetdb', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply('❌ *Proses reset database dibatalkan.*', { parse_mode: 'Markdown' }); });

// --- CRUD EDIT ACTIONS (Mulai Input) ---
bot.action('editserver_harga', async (ctx) => { await showServerListForEdit(ctx, 'edit_harga'); });
bot.action('editserver_nama', async (ctx) => { await showServerListForEdit(ctx, 'edit_nama'); });
bot.action('editserver_domain', async (ctx) => { await showServerListForEdit(ctx, 'edit_domain'); });
bot.action('editserver_auth', async (ctx) => { await showServerListForEdit(ctx, 'edit_auth'); });
bot.action('editserver_quota', async (ctx) => { await showServerListForEdit(ctx, 'edit_quota'); });
bot.action('editserver_limit_ip', async (ctx) => { await showServerListForEdit(ctx, 'edit_limit_ip'); });
bot.action('editserver_batas_create_akun', async (ctx) => { await showServerListForEdit(ctx, 'edit_batas_create_akun'); });
bot.action('editserver_total_create_akun', async (ctx) => { await showServerListForEdit(ctx, 'edit_total_create_akun'); });

async function showServerListForEdit(ctx, editAction) {
    await ctx.answerCbQuery();
    db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err || servers.length === 0) {
            return ctx.reply('⚠️ *Tidak ada server untuk diedit.*', { parse_mode: 'Markdown' });
        }
        const keyboard = servers.map(server => {
            return [{ text: `${server.nama_server} (${server.domain})`, callback_data: `${editAction}_${server.id}` }];
        });
        keyboard.push([{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }]);
        ctx.editMessageText(`📝 *Pilih server yang ingin Anda edit ${editAction.replace('edit_', '').replace(/_/g, ' ')}:*`, 
            { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
    });
}

// Handler untuk detail server
bot.action('detailserver', async (ctx) => {
    await ctx.answerCbQuery();
    db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err || servers.length === 0) {
            return ctx.reply('⚠️ *Tidak ada server untuk ditampilkan.*', { parse_mode: 'Markdown' });
        }
        
        const details = servers.map(server => 
            `🌐 *${server.nama_server}* (ID: ${server.id})\n` +
            `Domain: ${server.domain}\n` +
            `Auth: ${server.auth.substring(0, 4)}...\n` +
            `Harga: Rp${server.harga.toLocaleString('id-ID')}\n` +
            `Quota: ${server.quota} GB\n` +
            `Limit IP: ${server.iplimit} IP\n` +
            `Batas/Total Akun: ${server.total_create_akun}/${server.batas_create_akun}`
        ).join('\n\n---\n\n');
        
        ctx.reply(`📋 *Detail Semua Server:*\n\n${details}`, { parse_mode: 'Markdown' });
    });
});
bot.action('listserver', async (ctx) => {
    await ctx.answerCbQuery();
    db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err || servers.length === 0) {
            return ctx.reply('⚠️ *Tidak ada server untuk ditampilkan.*', { parse_mode: 'Markdown' });
        }
        
        const list = servers.map(server => 
            `ID: ${server.id} | Nama: ${server.nama_server} | Domain: ${server.domain} | Akun: ${server.total_create_akun}/${server.batas_create_akun}`
        ).join('\n');
        
        ctx.reply(`📋 *List Server Singkat:*\n\n${list}`, { parse_mode: 'Markdown' });
    });
});


bot.action(/edit_harga_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_harga', serverId: serverId, amount: '' }; await ctx.reply('💰 *Silakan masukkan harga server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_nama_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_nama', serverId: serverId, name: '' }; await ctx.reply('🏷️ *Silakan masukkan nama server baru:*', { reply_markup: { inline_keyboard: keyboard_abc() }, parse_mode: 'Markdown' }); });
bot.action(/edit_domain_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_domain', serverId: serverId, domain: '' }; await ctx.reply('🌐 *Silakan masukkan domain server baru:*', { reply_markup: { inline_keyboard: keyboard_full() }, parse_mode: 'Markdown' }); });
bot.action(/edit_auth_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_auth', serverId: serverId, auth: '' }; await ctx.reply('🔑 *Silakan masukkan auth server baru:*', { reply_markup: { inline_keyboard: keyboard_full() }, parse_mode: 'Markdown' }); });
bot.action(/edit_quota_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_quota', serverId: serverId, quota: '' }; await ctx.reply('📊 *Silakan masukkan quota server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_limit_ip_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_limit_ip', serverId: serverId, iplimit: '' }; await ctx.reply('📶 *Silakan masukkan limit IP server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_batas_create_akun_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_batas_create_akun', serverId: serverId, batasCreateAkun: '' }; await ctx.reply('🔢 *Silakan masukkan batas create akun server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_total_create_akun_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_total_create_akun', serverId: serverId, totalCreateAkun: '' }; await ctx.reply('🔢 *Silakan masukkan total create akun server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action('addsaldo_user', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        userState[ctx.chat.id] = { step: 'request_user_id_for_add_saldo' };
        await ctx.editMessageText('👤 *Silakan masukkan User ID Telegram yang ingin ditambahkan saldonya (angka):*', { parse_mode: 'Markdown' });
    } catch (error) { await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda.*', { parse_mode: 'Markdown' }); }
});


// --- INPUT CALLBACK HANDLERS (Numeric and Text) ---

async function handleNumericInput(ctx, userStateData, data, field, fieldName, query, isAddSaldo = false) {
  let currentValue = userStateData[field] || ''; await ctx.answerCbQuery();
  if (data === 'delete') { currentValue = currentValue.slice(0, -1); }
  else if (data === 'confirm') {
    if (currentValue.length === 0 || isNaN(parseFloat(currentValue)) || parseFloat(currentValue) <= 0) { return ctx.reply(`❌ *${fieldName} tidak valid.* Masukkan angka yang valid.`, { parse_mode: 'Markdown' }); }
    const numericValue = parseFloat(currentValue);
    try {
      if (isAddSaldo) { 
        // Logic untuk konfirmasi penambahan saldo
        const targetUserId = userStateData.targetUserId;
        db.get("SELECT * FROM users WHERE user_id = ?", [targetUserId], (err, row) => {
            if (err) { return ctx.reply('⚠️ Kesalahan saat memeriksa `user_id` target.', { parse_mode: 'Markdown' }); }
            if (!row) { return ctx.reply('⚠️ `user_id` target tidak terdaftar. Buat akun baru (start) terlebih dahulu.', { parse_mode: 'Markdown' }); }
            db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [numericValue, targetUserId], function(err) {
                if (err) { return ctx.reply('❌ *Terjadi kesalahan saat menambahkan saldo.*', { parse_mode: 'Markdown' }); }
                ctx.reply(`✅ *Saldo berhasil ditambahkan.*\n\n📄 *Detail Saldo:*\n- User ID: ${targetUserId}\n- Jumlah Saldo: *Rp ${numericValue.toLocaleString('id-ID')}*`, { parse_mode: 'Markdown' });
            });
        });
      }
      else { 
        // Logic untuk update server
        await updateServerField(userStateData.serverId, numericValue, query); 
        ctx.reply(`✅ *${fieldName} server berhasil diupdate.*\n\n📄 *Detail Server:*\n- ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} Baru: *${isAddSaldo || fieldName === 'harga' ? 'Rp ' + numericValue.toLocaleString('id-ID') : numericValue}*`, { parse_mode: 'Markdown' }); 
      }
    } catch (err) { ctx.reply(`❌ *Terjadi kesalahan saat mengupdate ${fieldName} server.*`, { parse_mode: 'Markdown' }); }
    delete userState[ctx.chat.id]; return;
  } else if (!/^\d+$/.test(data)) { return; }
  else { if (currentValue.length < 12) { currentValue += data; } else { return ctx.reply('⚠️ *Jumlah maksimal adalah 12 digit!*', { parse_mode: 'Markdown' }); } }

  userStateData[field] = currentValue;
  const displayValue = isAddSaldo || fieldName === 'harga' ? `Rp ${numericValue.toLocaleString('id-ID')}` : currentValue;
  const newMessage = `💵 *Silakan masukkan ${fieldName} baru:*\n\n${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} saat ini: *${displayValue}*`;
  try { await ctx.editMessageText(newMessage, { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); } catch (error) { if (!error.message.includes('message is not modified')) logger.error('Error editing message during numeric input:', error); }
}

async function handleTextInput(ctx, userStateData, data, field, fieldName, query, keyboardFunc) {
  let currentValue = userStateData[field] || ''; await ctx.answerCbQuery();

  if (data === 'delete') { currentValue = currentValue.slice(0, -1); }
  else if (data === 'confirm') {
    if (currentValue.length === 0) { return ctx.reply(`❌ *${fieldName} tidak boleh kosong.*`, { parse_mode: 'Markdown' }); }
    try {
      await updateServerField(userStateData.serverId, currentValue, query);
      ctx.reply(`✅ *${fieldName} server berhasil diupdate.*\n\n📄 *Detail Server:*\n- ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} Baru: *${currentValue}*`, { parse_mode: 'Markdown' });
    } catch (err) { ctx.reply(`❌ *Terjadi kesalahan saat mengupdate ${fieldName} server.*`, { parse_mode: 'Markdown' }); }
    delete userState[ctx.chat.id]; return;
  } else if (!/^[a-zA-Z0-9.\-_@]+$/.test(data)) { return; }
  else { if (currentValue.length < 253) { currentValue += data; } else { return ctx.reply(`⚠️ *${fieldName} maksimal adalah 253 karakter!*`, { parse_mode: 'Markdown' }); } }

  userStateData[field] = currentValue;
  const newMessage = `📊 *Silakan masukkan ${fieldName} server baru:*\n\n${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} saat ini: *${currentValue}*`;
  try { await ctx.editMessageText(newMessage, { reply_markup: { inline_keyboard: keyboardFunc() }, parse_mode: 'Markdown' }); } catch (error) { if (!error.message.includes('message is not modified')) logger.error('Error editing message during text input:', error); }
}


bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userStateData = userState[ctx.chat.id];

  if (userStateData) {
    switch (userStateData.step) {
      case 'request_user_id_for_add_saldo': 
        // Logic untuk input user ID
        let userIdValue = userStateData.targetUserId || '';
        await ctx.answerCbQuery();
        if (data === 'delete') { userIdValue = userIdValue.slice(0, -1); }
        else if (data === 'confirm') {
            const targetUserId = parseInt(userIdValue, 10);
            if (isNaN(targetUserId) || targetUserId <= 0) { return ctx.reply('❌ *User ID tidak valid.*', { parse_mode: 'Markdown' }); }
            userStateData.targetUserId = targetUserId;
            userStateData.step = 'request_amount_for_add_saldo';
            userStateData.amount = '';
            await ctx.reply('💵 *Silakan masukkan jumlah saldo yang ingin ditambahkan (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' });
            return;
        } else if (/^\d+$/.test(data)) { userIdValue += data; }
        
        userStateData.targetUserId = userIdValue;
        const message = `👤 *Silakan masukkan User ID Telegram (angka):*\n\nUser ID saat ini: *${userIdValue}*`;
        try { await ctx.editMessageText(message, { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); } catch (error) { if (!error.message.includes('message is not modified')) logger.error('Error editing user ID input message:', error); }
        break;
      
      case 'request_amount_for_add_saldo': await handleNumericInput(ctx, userStateData, data, 'amount', 'jumlah saldo', 'N/A', true); break; // Add Saldo
      case 'edit_batas_create_akun': await handleNumericInput(ctx, userStateData, data, 'batasCreateAkun', 'batas create akun', 'UPDATE Server SET batas_create_akun = ? WHERE id = ?'); break;
      case 'edit_total_create_akun': await handleNumericInput(ctx, userStateData, data, 'totalCreateAkun', 'total create akun', 'UPDATE Server SET total_create_akun = ? WHERE id = ?'); break;
      case 'edit_limit_ip': await handleNumericInput(ctx, userStateData, data, 'iplimit', 'limit IP', 'UPDATE Server SET iplimit = ? WHERE id = ?'); break;
      case 'edit_quota': await handleNumericInput(ctx, userStateData, data, 'quota', 'quota', 'UPDATE Server SET quota = ? WHERE id = ?'); break;
      case 'edit_harga': await handleNumericInput(ctx, userStateData, data, 'amount', 'harga', 'UPDATE Server SET harga = ? WHERE id = ?'); break;
      case 'edit_auth': await handleTextInput(ctx, userStateData, data, 'auth', 'auth', 'UPDATE Server SET auth = ? WHERE id = ?', keyboard_full); break;
      case 'edit_domain': await handleTextInput(ctx, userStateData, data, 'domain', 'domain', 'UPDATE Server SET domain = ? WHERE id = ?', keyboard_full); break;
      case 'edit_nama': await handleTextInput(ctx, userStateData, data, 'name', 'nama server', 'UPDATE Server SET nama_server = ? WHERE id = ?', keyboard_abc); break;
      default: break;
    }
  }
});

// --- LOGIKA BACKUP DATABASE ---
// Menggunakan sqlite3-specific dump logic
function backupDatabase() {
    logger.info('Mulai proses backup database harian...');
    const today = new Date().toISOString().split('T')[0];
    const backupFileName = `sellvpn_backup_${today}.sql`;
    const backupPath = path.join(__dirname, backupFileName);
    
    // Command untuk membuat dump SQL dari SQLite3
    const dumpCommand = `.dump`;

    // Kita menggunakan child_process untuk menjalankan command sqlite3
    const { spawn } = require('child_process');

    try {
        const sqliteProcess = spawn('sqlite3', ['./sellvpn.db']);
        
        let dumpData = '';
        sqliteProcess.stdout.on('data', (data) => {
            dumpData += data.toString();
        });

        sqliteProcess.stderr.on('data', (data) => {
            logger.error(`SQLite Dump Error: ${data.toString()}`);
        });

        sqliteProcess.on('close', async (code) => {
            if (code === 0) {
                // Tulis hasil dump ke file .sql
                fs.writeFileSync(backupPath, dumpData);
                logger.info(`✅ Database dump berhasil dibuat di ${backupFileName}`);

                // Kirim file backup ke Admin ID utama
                try {
                    // Cek jika ADMIN adalah array, ambil ID pertama. Jika bukan array, gunakan ADMIN.
                    const adminRecipientId = Array.isArray(ADMIN_RAW) ? ADMIN_RAW[0] : ADMIN_RAW;
                    
                    await bot.telegram.sendDocument(adminRecipientId, { source: backupPath, filename: backupFileName }, {
                        caption: `🤖 *BACKUP OTOMATIS HARIAN*\n\nDatabase \`${backupFileName}\` berhasil dibuat dan dikirim.\n\nSimpan file ini untuk pemulihan (restore) data.`,
                        parse_mode: 'Markdown'
                    });
                    logger.info(`✅ File backup berhasil dikirim ke Admin ID: ${adminRecipientId}`);
                } catch (e) {
                    logger.error(`❌ Gagal mengirim file backup ke admin: ${e.message}`);
                } finally {
                    // Hapus file backup setelah dikirim untuk menghemat ruang
                    fs.unlinkSync(backupPath);
                    logger.info(`File backup ${backupFileName} telah dihapus dari server.`);
                }
            } else {
                logger.error(`❌ Proses SQLite dump gagal dengan kode ${code}`);
            }
        });

        // Kirim perintah .dump ke proses sqlite3
        sqliteProcess.stdin.write(dumpCommand + '\n');
        sqliteProcess.stdin.end();

    } catch (e) {
        logger.error(`❌ Gagal menjalankan proses backup (Pastikan paket 'sqlite3' terinstal di sistem Anda): ${e.message}`);
    }
}

// Jadwal Backup Harian (Misal, setiap jam 03:00 pagi)
cron.schedule('0 3 * * *', () => {
    backupDatabase();
}, {
    timezone: "Asia/Jakarta" // Gunakan zona waktu Indonesia (WIB)
});

logger.info('✅ Penjadwalan backup harian (03:00 WIB) telah aktif.');


// --- INISIALISASI SERVER ---
// Pastikan kurung kurawal di sini sudah BENAR (perbaikan dari diskusi sebelumnya)
app.listen(port, () => {
  bot.launch().then(() => {
      logger.info('Bot telah dimulai');
  }).catch((error) => {
      logger.error('Error saat memulai bot:', error);
  }); // <-- Penutup .catch() yang benar
  
  logger.info(`Server berjalan di port ${port}`);
}); // <-- Penutup app.listen callback yang benar
