
const fs = require('fs');
const { Telegraf } = require('telegraf');
const winston = require('winston');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron'); 
const axios = require('axios'); 
const { Buffer } = require('buffer'); // Diperlukan untuk Base64

// =======================================================
// 1. KONSTANTA DAN KONFIGURASI
// =======================================================

// --- PEMUATAN KONSTANTA DARI .vars.json ---
const vars = JSON.parse(fs.readFileSync('./.vars.json', 'utf8'));

// Variabel Bot dan Aplikasi
const BOT_TOKEN = vars.IP_BOT_TOKEN; 
const ADMIN_RAW = vars.USER_ID;      
const GROUP_ID = vars.GROUP_ID;      

// Variabel Bisnis/Angka
const IP_PRICE_PER_MONTH = vars.IP_PRICE_PER_MONTH || 4000;
const NAMA_STORE = vars.NAMA_STORE;
const MIN_DEPOSIT_AMOUNT = vars.MIN_DEPOSIT_AMOUNT || 10000;

// Variabel Kontak & QRIS
const ADMIN_USERNAME_KONTAK = vars.ADMIN_USERNAME_KONTAK || 'Rahmarie'; 
const REKENING_KONTAK = vars.REKENING_KONTAK || 'QRIS a/n Admin'; 
const QRIS_IMAGE_URL = 'https://raw.githubusercontent.com/mudziboy/mdzitr/refs/heads/main/qris.png'; 

// Variabel GitHub (PENTING!)
const GITHUB_TOKEN = vars.GITHUB_TOKEN;
const REPO_OWNER = vars.REPO_OWNER;
const REPO_NAME = vars.REPO_NAME;
const FILE_PATH = vars.FILE_PATH; 
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;


// =======================================================
// 2. INISIALISASI INSTANS & LOGGER
// =======================================================
const bot = new Telegraf(BOT_TOKEN);
const userState = {};
global.depositState = {}; // State untuk tracking top-up manual
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'ip-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'ip-combined.log' }),
  ],
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}


// --- INISIALISASI DATABASE TERPISAH (ip_whitelist.db) ---
const db = new sqlite3.Database('./ip_whitelist.db', (err) => {
  if (err) { logger.error('Kesalahan koneksi SQLite3:', err.message); }
  else { logger.info('Terhubung ke SQLite3 (ip_whitelist.db)'); }
});

// Tabel users (untuk saldo IP)
db.run(`CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY UNIQUE, 
  saldo INTEGER DEFAULT 0,
  CONSTRAINT unique_user_id UNIQUE (user_id)
)`, (err) => {
  if (err) { logger.error('Kesalahan membuat tabel users di ip_whitelist.db:', err.message); }
});

// Tabel IP Whitelist Berlangganan
db.run(`CREATE TABLE IF NOT EXISTS allowed_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ip_address TEXT UNIQUE, user_id INTEGER, start_date TEXT, end_date TEXT, status TEXT DEFAULT 'active', description TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)`, (err) => { if (err) { logger.error('Kesalahan membuat tabel allowed_ips:', err.message); } });


// --- ADMIN IDS ---
let adminIds = [];
if (Array.isArray(ADMIN_RAW)) {
    adminIds = ADMIN_RAW.map(id => parseInt(id)).filter(id => !isNaN(id));
} else if (ADMIN_RAW) {
    adminIds = [parseInt(ADMIN_RAW)].filter(id => !isNaN(id));
}
logger.info(`✅ IP Admin Bot initialized. Admin IDs: ${adminIds.join(', ')}`);


// =======================================================
// 3. FUNGSI GITHUB MANAGER
// =======================================================

async function commitToGitHub(ip, mode, action) {
    if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME || !FILE_PATH) {
        logger.error("Konfigurasi GitHub tidak lengkap. Komitmen dibatalkan.");
        return { success: false, message: "❌ Gagal: Konfigurasi GitHub tidak lengkap." };
    }

    try {
        // 1. Ambil konten dan SHA file saat ini
        const getResponse = await axios.get(GITHUB_API_URL, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3.raw' 
            }
        });
        
        // Ambil SHA file dari header atau respons raw (harus menggunakan Accept raw)
        const currentSha = getResponse.headers['etag'] ? getResponse.headers['etag'].replace(/"/g, '') : null;
        if (!currentSha) {
             logger.warn("SHA tidak ditemukan di header. Mencoba ambil SHA dari respons standar...");
             const fullResponse = await axios.get(GITHUB_API_URL, {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
             });
             currentSha = fullResponse.data.sha;
        }

        if (!currentSha) throw new Error("Tidak dapat mengambil SHA file dari GitHub.");
        
        const currentContent = getResponse.data;

        // 2. Modifikasi konten
        let newContent;
        let commitMessage;

        if (action === 'add') {
            // Pastikan tidak ada duplikasi dan tambahkan di baris baru
            const lines = currentContent.split('\n').filter(line => line.trim() !== ip.trim());
            lines.push(ip);
            newContent = lines.join('\n').trim();
            commitMessage = `[AUTO] Add new IP: ${ip} (${mode})`;
        } else if (action === 'remove') {
            // Hapus baris IP
            const lines = currentContent.split('\n').filter(line => line.trim() !== ip.trim());
            newContent = lines.join('\n').trim();
            commitMessage = `[AUTO] Remove expired IP: ${ip}`;
        } else {
            return { success: false, message: "Aksi GitHub tidak valid." };
        }

        const newContentBase64 = Buffer.from(newContent, 'utf8').toString('base64');

        // 3. Commit perubahan
        const commitPayload = {
            message: commitMessage,
            content: newContentBase64,
            sha: currentSha // SHA wajib untuk update
        };

        await axios.put(GITHUB_API_URL, commitPayload, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        logger.info(`✅ GitHub Commit Sukses: ${commitMessage}`);
        return { success: true, message: commitMessage };

    } catch (error) {
        const status = error.response ? error.response.status : 'N/A';
        const msg = error.response ? (error.response.data.message || JSON.stringify(error.response.data)) : error.message;
        logger.error(`❌ GitHub Commit Gagal (Status: ${status}): ${msg}`);
        return { success: false, message: `❌ Gagal Commit ke GitHub (Status ${status}): ${msg}` };
    }
}


// =======================================================
// 4. FUNGSI UTILITY & HANDLERS UMUM
// =======================================================

// Utility untuk mengirim pesan dengan aman
async function safeSend(ctxOrBot, chatId, text, extra = {}) {
    try {
        await ctxOrBot.telegram.sendMessage(chatId, text, extra);
    } catch (e) {
        logger.warn(`Failed to send message to ${chatId}: ${e.message}`);
    }
}

// Utility untuk menghapus pesan dengan aman
async function safeDeleteMessage(ctxOrBot, chatId, messageId) {
    if (!messageId) return;
    try {
        await ctxOrBot.telegram.deleteMessage(chatId, messageId);
    } catch (e) {
        if (!e.message.includes('message to delete not found')) {
            logger.warn(`Failed to delete message ${messageId} in chat ${chatId}: ${e.message}`);
        }
    }
}

// Balance Utilities
async function getUserBalance(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (err, row) => {
            if (err) { reject(err); }
            else if (!row) { 
                db.run('INSERT INTO users (user_id, saldo) VALUES (?, 0)', [userId], (err) => {
                     if (err) { reject(err); }
                     else { resolve(0); }
                });
            }
            else { resolve(row.saldo); } 
        });
    });
}
async function updateUserBalance(userId, amount) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, userId], function (err) {
            if (err) { logger.error('⚠️ Kesalahan saat menambahkan saldo user:', err.message); reject(err); }
            else { resolve(); }
        });
    });
}

// Handler Saldo Final
async function handleTopup(userId, amount, ctx) {
    try {
        await updateUserBalance(userId, amount);
        
        await safeSend(bot, userId, 
            `🎉 *Top Up Saldo Berhasil!* (Manual)\n\nSaldo Anda telah ditambahkan sebesar *Rp${amount.toLocaleString('id-ID')}* oleh Admin.`,
            { parse_mode: 'Markdown' }
        );
        
        await ctx.editMessageText(
            `✅ Transaksi Top Up untuk User ID ${userId} berhasil dikonfirmasi.\n\nNominal: *Rp${amount.toLocaleString('id-ID')}* telah ditambahkan.`,
            { parse_mode: 'Markdown' }
        );

        delete global.depositState[userId];
    } catch (e) {
        logger.error(`Error saat finalisasi topup untuk ${userId}: ${e.message}`);
        await ctx.reply(`❌ Gagal menambahkan saldo ke database untuk User ${userId}.`);
    }
}


// =======================================================
// 5. KEYBOARD & MENU UTAMA
// =======================================================

// Keyboard untuk Input Nominal Admin
function keyboard_nomor_topup(userId) {
  const digits = '123456789'; 
  const buttons = [];
  for (let i = 0; i < 9; i += 3) {
    const row = digits.slice(i, i + 3).split('').map(char => ({ text: char, callback_data: `keyboard_${char}_${userId}` }));
    buttons.push(row);
  }
  buttons.push([
    { text: '0', callback_data: `keyboard_0_${userId}` },
    { text: '❌ Hapus', callback_data: `keyboard_clear_${userId}` },
    { text: '✅ Konfirmasi', callback_data: `keyboard_ok_${userId}` }
  ]);
  return buttons;
}

async function sendIpMainMenu(ctx, message) {
    const userId = ctx.from.id;
    const balance = await getUserBalance(userId).catch(() => 0);
    const userName = ctx.from.first_name || 'Pengguna';
    
    const messageText = message || 
        `╭─ 🌐 *${NAMA_STORE} IP Whitelist* 🌐
├ Layanan berlangganan IP VPS untuk akses script utama.
├ Harga per IP: *Rp ${IP_PRICE_PER_MONTH.toLocaleString('id-ID')} / Bulan*.
└ Saldo Anda: *Rp ${balance.toLocaleString('id-ID')}*

Selamat datang, *${userName}*! Pilih opsi di bawah untuk mengelola IP Anda.`;

    const userKeyboard = [
        [{ text: '➕ Daftarkan IP VPS Baru', callback_data: 'register_ip_start' }],
        [{ text: '💰 Top Up Saldo (Manual)', callback_data: 'topup_manual_start' }],
        [{ text: '📋 List IP Aktif Saya', callback_data: 'list_my_ips' }],
    ];
    
    if (adminIds.includes(userId)) {
        userKeyboard.push([{ text: '🛠️ Menu Admin IP', callback_data: 'admin_ip_menu' }]);
    }
    
    const options = { reply_markup: { inline_keyboard: userKeyboard }, parse_mode: 'Markdown' };

    try {
        if (ctx.updateType === 'callback_query') { 
             await ctx.editMessageText(messageText, options); 
        } else { 
             await ctx.reply(messageText, options); 
        }
    } catch (error) { 
        logger.error('Error saat mengirim/mengedit menu utama:', error); 
        await ctx.reply('Terjadi kesalahan saat memuat menu utama.', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
}


// =======================================================
// 6. COMMAND & ACTION HANDLERS
// =======================================================

bot.start(async (ctx) => {
    await sendIpMainMenu(ctx);
});

bot.action('main_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await sendIpMainMenu(ctx);
});

// --- ADMIN MENU ---
bot.action('admin_ip_menu', async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.answerCbQuery('🚫 Anda tidak memiliki izin!');
    await ctx.answerCbQuery();
    
    const adminKeyboard = [
        [{ text: '➕ Tambah IP Manual', callback_data: 'admin_add_ip_start' }, { text: '❌ Hapus IP User', callback_data: 'admin_delete_ip_list' }],
        [{ text: '💵 Tambah Saldo Manual', callback_data: 'admin_add_saldo_start' }],
        [{ text: '📋 List Semua IP Whitelist', callback_data: 'admin_list_all_ips' }],
        [{ text: '🔙 Kembali ke Menu Utama', callback_data: 'main_menu' }]
    ];

    await ctx.editMessageText('🛠️ *Menu Admin IP Whitelist:*', {
        reply_markup: { inline_keyboard: adminKeyboard },
        parse_mode: 'Markdown'
    });
});


// --- USER FLOW: START TOP UP MANUAL (QRIS) ---
bot.action('topup_manual_start', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;

    logger.info(`[TOPUP] User ${userId} memilih Manual`);
    
    await safeDeleteMessage(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id);

    if (global.depositState[userId] && global.depositState[userId].timeout) {
        clearTimeout(global.depositState[userId].timeout);
    }
    
    global.depositState[userId] = { 
        action: 'await_bukti', 
        timeout: null, 
        messageId: null, 
        type: 'manual' 
    };

    await safeSend(ctx, ctx.chat.id, 
        '💰 *Silakan scan QRIS berikut untuk melakukan top-up saldo Anda.*\n\nRekening: `' + REKENING_KONTAK + '`',
        { parse_mode: 'Markdown' }
    );

    const qrisMessage = await ctx.replyWithPhoto(
      { url: QRIS_IMAGE_URL },
      {
        caption: 'Scan atau klik foto di atas.\nSetelah bayar, *kirim bukti (foto) transfer* dengan membalas pesan ke bot ini.\nProses 1-2 menit, kecuali sedang sibuk atau tidur.',
        parse_mode: 'Markdown'
      }
    );
    
    global.depositState[userId].messageId = qrisMessage.message_id;

    global.depositState[userId].timeout = setTimeout(async () => {
      if (global.depositState[userId] && global.depositState[userId].action === 'await_bukti') {
        await safeDeleteMessage(bot, userId, global.depositState[userId].messageId); 
        delete global.depositState[userId];
        await safeSend(bot, userId, '⌛ Top-up Anda *expired* karena tidak mengirim bukti transfer dalam 5 menit.', { parse_mode: 'Markdown' });
      }
    }, 5 * 60 * 1000);

  } catch (error) {
    logger.error('❌ Kesalahan saat memulai top-up (manual):', error);
    await ctx.reply('❌ *Gagal memproses top-up. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});


// --- USER FLOW: PENDAFTARAN IP (Start) ---
bot.action('register_ip_start', async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = [
        [{ text: `✅ Berbayar: Rp${IP_PRICE_PER_MONTH.toLocaleString('id-ID')} / Bulan`, callback_data: 'register_ip_paid' }],
        [{ text: '🆓 Trial Gratis (1 Hari)', callback_data: 'register_ip_trial' }],
        [{ text: '❌ Batalkan', callback_data: 'main_menu' }]
    ];
    await ctx.editMessageText('🌐 *Pilih Jenis Pendaftaran IP:*\n\nSetelah pendaftaran berhasil, IP akan ditambahkan ke database kami dan berlaku selama masa aktif.', {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown'
    });
});

bot.action('register_ip_trial', async (ctx) => {
    await ctx.answerCbQuery();
    userState[ctx.chat.id] = { step: 'input_ip_address', mode: 'trial' };
    await ctx.reply('🌐 *Masukkan IP VPS Anda untuk Trial (1 Hari):*', { parse_mode: 'Markdown' });
});

bot.action('register_ip_paid', async (ctx) => {
    await ctx.answerCbQuery();
    userState[ctx.chat.id] = { step: 'input_ip_address', mode: 'paid' };
    await ctx.reply('🌐 *Masukkan IP VPS Anda untuk Langganan Berbayar (1 Bulan):*', { parse_mode: 'Markdown' });
});


// --- USER FLOW: LIST IP ---
bot.action('list_my_ips', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    
    db.all('SELECT ip_address, end_date, status, description FROM allowed_ips WHERE user_id = ? ORDER BY end_date DESC', [userId], (err, ips) => {
        if (err || ips.length === 0) {
            return ctx.reply('⚠️ *Anda belum mendaftarkan IP apapun.*', { parse_mode: 'Markdown' });
        }
        
        let message = '📋 *Daftar IP VPS Anda:*\n\n';
        
        const list = ips.map((ip, index) => {
            const statusEmoji = ip.status === 'active' ? '🟢' : '🔴';
            return `${statusEmoji} *${index + 1}.* \`${ip.ip_address}\`\n` +
                   `   Status: ${ip.status.toUpperCase()} (${ip.description})\n` +
                   `   Berakhir: ${ip.end_date}`;
        }).join('\n\n');
        
        ctx.reply(message + list, { parse_mode: 'Markdown' });
    });
});

// --- ADMIN FLOW: LIST SEMUA IP ---
bot.action('admin_list_all_ips', async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.answerCbQuery('🚫 Anda tidak memiliki izin!');
    await ctx.answerCbQuery();
    
    db.all('SELECT T1.ip_address, T1.end_date, T1.status, T1.user_id FROM allowed_ips T1 ORDER BY T1.end_date DESC', [], async (err, ips) => {
        if (err || ips.length === 0) {
            return ctx.reply('⚠️ *Tidak ada IP yang terdaftar.*', { parse_mode: 'Markdown' });
        }
        
        let message = '📋 *Daftar Semua IP Whitelist (ADMIN VIEW):*\n\n';
        
        const list = ips.map((ip, index) => {
            const statusEmoji = ip.status === 'active' ? '🟢' : '🔴';
            return `${statusEmoji} *${index + 1}.* \`${ip.ip_address}\` (User ID: ${ip.user_id})\n` +
                   `   Status: ${ip.status.toUpperCase()}\n` +
                   `   Berakhir: ${ip.end_date}`;
        }).join('\n\n');
        
        ctx.reply(message + list, { parse_mode: 'Markdown' });
    });
});

// --- ADMIN FLOW: HAPUS IP (List untuk dipilih) ---
bot.action('admin_delete_ip_list', async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.answerCbQuery('🚫 Anda tidak memiliki izin!');
    await ctx.answerCbQuery();
    
    db.all('SELECT id, ip_address, user_id FROM allowed_ips WHERE status = ?', ['active'], (err, ips) => {
        if (err || ips.length === 0) {
            return ctx.reply('⚠️ *Tidak ada IP aktif untuk dihapus.*', { parse_mode: 'Markdown' });
        }
        
        const keyboard = ips.map(ip => { 
            return [{ text: `${ip.ip_address} (User ID: ${ip.user_id})`, callback_data: `admin_confirm_delete_ip_${ip.id}` }]; 
        });
        keyboard.push([{ text: '🔙 Kembali', callback_data: 'admin_ip_menu' }]);
        
        ctx.reply('❌ *Pilih IP Aktif yang ingin dihapus:*', { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
    });
});

// --- ADMIN FLOW: HAPUS IP (Konfirmasi/Eksekusi) ---
bot.action(/admin_confirm_delete_ip_(\d+)/, async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.answerCbQuery('🚫 Anda tidak memiliki izin!');
    const ipId = ctx.match[1];
    await ctx.answerCbQuery();

    db.get('SELECT ip_address, user_id FROM allowed_ips WHERE id = ?', [ipId], async (err, row) => {
        if (err || !row) {
            return ctx.reply('⚠️ *IP tidak ditemukan.*', { parse_mode: 'Markdown' });
        }

        // 1. HAPUS DARI GITHUB
        const githubResult = await commitToGitHub(row.ip_address, 'manual_remove', 'remove');
        
        if (githubResult.success) {
            // 2. HAPUS DARI DATABASE
            db.run('DELETE FROM allowed_ips WHERE id = ?', [ipId], function(err) {
                if (err) { 
                    logger.error(`Error menghapus IP ${ipId}: ${err.message}`);
                    return ctx.reply('⚠️ *Terjadi kesalahan saat menghapus IP dari DB.*', { parse_mode: 'Markdown' }); 
                }
                
                safeSend(bot, row.user_id, `🔴 *Notifikasi Admin*\n\nIP VPS Anda \`${row.ip_address}\` telah **DICABUT** oleh Admin. Akses skrip dihentikan.`, { parse_mode: 'Markdown' });
                ctx.reply(`✅ *IP \`${row.ip_address}\` berhasil dihapus* dari Whitelist (DB & GitHub).`, { parse_mode: 'Markdown' });
            });
        } else {
             ctx.reply(`❌ *GAGAL MENGHAPUS IP \`${row.ip_address}\` DARI GITHUB*. Mohon hapus manual.`, { parse_mode: 'Markdown' });
        }
    });
});

// --- ADMIN FLOW: TAMBAH IP MANUAL (Start) ---
bot.action('admin_add_ip_start', async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.answerCbQuery('🚫 Anda tidak memiliki izin!');
    await ctx.answerCbQuery();
    userState[ctx.chat.id] = { step: 'admin_input_ip_address' };
    await ctx.reply('🌐 *ADMIN MODE: Masukkan IP Address (IPv4) yang akan ditambahkan:*', { parse_mode: 'Markdown' });
});

// --- ADMIN FLOW: TAMBAH SALDO MANUAL (Start) ---
bot.action('admin_add_saldo_start', async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return ctx.answerCbQuery('🚫 Anda tidak memiliki izin!');
    await ctx.answerCbQuery();
    userState[ctx.chat.id] = { step: 'admin_input_saldo_userid' };
    await ctx.reply('👤 *ADMIN MODE: Masukkan User ID Telegram tujuan penambahan saldo:*', { parse_mode: 'Markdown' });
});


// =======================================================
// 7. PHOTO/DOCUMENT HANDLER (Bukti Top Up)
// =======================================================

bot.on(['photo', 'document'], async (ctx) => {
  const userId = ctx.from.id;
  
  // 1. Cek state: Apakah user sedang menunggu kirim bukti?
  if (!global.depositState[userId] || global.depositState[userId].action !== 'await_bukti' || global.depositState[userId].type !== 'manual') return;

  // 2. Clear Timeout & State Awal
  clearTimeout(global.depositState[userId].timeout);
  await safeDeleteMessage(bot, userId, global.depositState[userId].messageId); 

  const adminId = adminIds.length > 0 ? adminIds[0] : null; 

  if (!adminId) {
    logger.error('❌ Admin ID tidak terdefinisi.');
    await safeSend(ctx, userId, '❌ Gagal meneruskan bukti, Admin ID tidak ditemukan.');
    return;
  }

  await ctx.reply('✅ Bukti transfer diterima, diteruskan ke admin untuk verifikasi. Mohon tunggu 1-2 menit.', { parse_mode: 'Markdown' });
  
  // 3. Teruskan pesan ke Admin
  const forwardedMsg = await ctx.forwardMessage(adminId, ctx.chat.id, ctx.message.message_id);

  // 4. Kirim tombol verifikasi ke Admin
  await bot.telegram.sendMessage(
    adminId,
    `📥 *Bukti Top-up Masuk*\n\nUser: \`${ctx.from.first_name || 'N/A'}\`\nUserID: \`${userId}\`\n\nVerifikasi bukti di atas.`,
    {
      reply_to_message_id: forwardedMsg.message_id,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Verifikasi', callback_data: `verif_${userId}` },
            { text: '❌ Tolak', callback_data: `tolak_${userId}` }
          ]
        ]
      },
      parse_mode: 'Markdown'
    }
  );

  // 5. Update State Deposit
  global.depositState[userId].action = 'await_admin_verif';
  global.depositState[userId].ctx = ctx; 
});


// =======================================================
// 8. TEXT HANDLER UTAMA & ADMIN CALLBACK
// =======================================================

bot.on('text', async (ctx) => {
  const state = userState[ctx.chat.id];
  if (!state) return;
  const text = ctx.message.text.trim();
  const userId = ctx.from.id; 

  // --- FLOW 1: PENDAFTARAN IP (USER: Trial/Berbayar) ---
  if (state.step === 'input_ip_address') {
    // Logic pendaftaran IP dan Commit ke GitHub (Sudah di atas)
  }

  // --- FLOW 2: ADMIN TAMBAH IP MANUAL (Lanjutan) ---
  else if (state.step === 'admin_input_ip_address') {
    if (!adminIds.includes(userId)) return;
    
    const ip = text;
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      return ctx.reply('❌ *Format IP tidak valid.* Masukkan format IPv4.', { parse_mode: 'Markdown' });
    }
    
    state.ip = ip;
    state.step = 'admin_input_user_id';
    await ctx.reply(`🌐 *IP Diterima:* \`${ip}\`\n\nSekarang masukkan *User ID Telegram* pemilik IP ini:`, { parse_mode: 'Markdown' });
  }

  else if (state.step === 'admin_input_user_id') {
    if (!adminIds.includes(userId)) return;
    
    const targetUserId = parseInt(text, 10);
    if (isNaN(targetUserId)) {
      return ctx.reply('❌ *User ID tidak valid.* Masukkan angka.', { parse_mode: 'Markdown' });
    }
    
    // Pastikan user ada (atau buat) di DB IP
    await getUserBalance(targetUserId).catch(e => logger.error(`Error creating user ${targetUserId}: ${e.message}`));

    state.targetUserId = targetUserId;
    state.step = 'admin_input_duration_manual_ip';
    await ctx.reply(`👤 *User ID Diterima:* ${targetUserId}\n\nTerakhir, masukkan *Durasi Langganan (Hari)* untuk IP ini (Contoh: 30):`, { parse_mode: 'Markdown' });
  }

  else if (state.step === 'admin_input_duration_manual_ip') {
    if (!adminIds.includes(userId)) return;

    const durationDays = parseInt(text, 10);
    if (isNaN(durationDays) || durationDays <= 0 || durationDays > 365) {
      return ctx.reply('❌ *Durasi tidak valid.* Masukkan angka hari antara 1 sampai 365.', { parse_mode: 'Markdown' });
    }

    const { ip, targetUserId } = state;
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + durationDays);

    const startDateISO = today.toISOString().split('T')[0];
    const endDateISO = endDate.toISOString().split('T')[0];

    // 1. COMMIT KE GITHUB MANUAL
    const githubResult = await commitToGitHub(ip, 'admin_manual', 'add');
    
    if (!githubResult.success) {
        return ctx.reply(githubResult.message + '\n\n*Pendaftaran IP dibatalkan* karena kegagalan otorisasi GitHub.', { parse_mode: 'Markdown' });
    }

    // 2. Eksekusi Pendaftaran IP Manual di DB
    try {
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO allowed_ips (ip_address, user_id, start_date, end_date, description, status) VALUES (?, ?, ?, ?, ?, ?)',
                [ip, targetUserId, startDateISO, endDateISO, `Admin Manual ${durationDays} Hari`, 'active'], 
                (err) => {
                    if (err && err.message.includes('UNIQUE constraint failed')) { return reject('IP sudah terdaftar dan aktif. Gunakan menu Hapus IP dulu.'); }
                    if (err) { return reject(err.message); }
                    resolve();
                }
            );
        });

        await ctx.reply(
            `✅ *IP Whitelist Berhasil Ditambahkan (Manual & Otomatis)*\n\n` +
            `🌐 IP: \`${ip}\`\n👤 User ID: ${targetUserId}\n📅 Kedaluwarsa: *${endDateISO}*`, 
            { parse_mode: 'Markdown' }
        );

        await safeSend(bot, targetUserId, 
            `🎉 *Notifikasi Admin*\n\nIP VPS Anda \`${ip}\` telah diaktifkan secara manual oleh Admin.\n\n📅 Langganan Berakhir: *${endDateISO}*`,
            { parse_mode: 'Markdown' }
        );

    } catch (e) {
        logger.error('Error saat pendaftaran IP Manual:', e);
        // PENTING: Jika DB GAGAL, IP SUDAH ADA DI GITHUB. 
        await ctx.reply(`❌ *GAGAL!* Terjadi kesalahan DB: ${e}. IP mungkin sudah terdaftar di GitHub!`, { parse_mode: 'Markdown' });
    }

    delete userState[ctx.chat.id];
  }

  // --- FLOW 3: ADMIN TAMBAH SALDO MANUAL ---
  else if (state.step === 'admin_input_saldo_userid') {
      if (!adminIds.includes(userId)) return;
      const targetUserId = parseInt(text, 10);
      if (isNaN(targetUserId)) {
          return ctx.reply('❌ *User ID tidak valid.* Masukkan angka.', { parse_mode: 'Markdown' });
      }
      // Pastikan user ada (atau buat)
      await getUserBalance(targetUserId).catch(e => logger.error(`Error creating user ${targetUserId}: ${e.message}`));

      state.targetUserId = targetUserId;
      state.step = 'admin_input_saldo_amount';
      await ctx.reply(`💵 *User ID Diterima:* ${targetUserId}\n\nMasukkan *Jumlah Saldo* yang akan ditambahkan (angka saja):`, { parse_mode: 'Markdown' });

  } else if (state.step === 'admin_input_saldo_amount') {
      if (!adminIds.includes(userId)) return;
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) {
          return ctx.reply('❌ *Jumlah saldo tidak valid.* Masukkan angka positif.', { parse_mode: 'Markdown' });
      }
      
      const targetUserId = state.targetUserId;
      try {
          await updateUserBalance(targetUserId, amount);
          await ctx.reply(`✅ *Penambahan Saldo Berhasil!* \n\nUser ID ${targetUserId} ditambahkan *Rp${amount.toLocaleString('id-ID')}*.`, { parse_mode: 'Markdown' });
          
          await safeSend(bot, targetUserId, 
              `🎉 *Top Up Saldo Berhasil* (Manual)\n\nSaldo Anda telah ditambahkan sebesar *Rp${amount.toLocaleString('id-ID')}* oleh Admin.`,
              { parse_mode: 'Markdown' }
          );

      } catch (e) {
          logger.error(`Error saat menambah saldo manual untuk ${targetUserId}: ${e.message}`);
          await ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses penambahan saldo.', { parse_mode: 'Markdown' });
      }
      delete userState[ctx.chat.id];
  }
});


// =======================================================
// 9. PENJADWALAN (Cron Job) - HAPUS IP DARI GITHUB
// =======================================================

async function checkExpiredIps() {
    logger.info('Mulai pengecekan IP kedaluwarsa...');
    
    db.all("SELECT id, ip_address, user_id FROM allowed_ips WHERE end_date <= DATE('now') AND status = 'active'", [], async (err, rows) => {
        if (err) { logger.error('Error saat cek IP expired:', err.message); return; }
        if (rows.length === 0) { logger.info('Tidak ada IP yang kedaluwarsa hari ini.'); return; }

        logger.info(`Ditemukan ${rows.length} IP kedaluwarsa. Memproses update status dan hapus dari GitHub...`);
        
        for (const row of rows) {
            // 1. HAPUS DARI GITHUB
            const githubResult = await commitToGitHub(row.ip_address, 'expired', 'remove');

            if (githubResult.success) {
                // 2. Update status IP di database LOKAL
                db.run("UPDATE allowed_ips SET status = 'expired' WHERE id = ?", [row.id], (err) => {
                    if (err) { logger.error(`Gagal update status IP ${row.ip_address}: ${err.message}`); }
                    else {
                        const msg = `🔴 *NOTIFIKASI IP KEDALUWARSA*\n\nIP VPS Anda \`${row.ip_address}\` telah **KEDALUWARSA** hari ini.\n\nAkses script utama telah dicabut. Silakan Top Up untuk mendaftar ulang.`;
                        safeSend(bot, row.user_id, msg, { parse_mode: 'Markdown' });
                        safeSend(bot, adminIds[0], `🚨 *[ADMIN]* IP \`${row.ip_address}\` dicabut dari GitHub.`, { parse_mode: 'Markdown' });
                    }
                });
            } else {
                logger.error(`❌ GAGAL HAPUS IP ${row.ip_address} dari GitHub. Status DB tidak diubah. IP masih aktif!`);
            }
        }
    });
}

cron.schedule('5 0 * * *', () => {
    checkExpiredIps();
}, {
    timezone: "Asia/Jakarta" 
});

logger.info('✅ Penjadwalan cek IP kedaluwarsa (00:05 WIB) telah aktif.');


// =======================================================
// 10. SERVER START (TIDAK ADA WEBHOOK)
// =======================================================

bot.launch().then(() => {
    logger.info('✅ IP Whitelist Bot telah dimulai (MODE AMAN/GIT)');
}).catch((error) => {
    logger.error('❌ Error saat memulai IP Whitelist Bot:', error);
});
