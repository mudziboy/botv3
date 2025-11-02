# ⚡ SAGI TUNNEL BOT VPN TELEGRAM 🤖

Bot Telegram penjual layanan VPN (SSH, Vmess, Vless, Trojan, Shadowsocks) premium dengan sistem otomatis penuh (Auto Top-up, Auto Create, Auto Renew, Auto Delete). Dibangun menggunakan Node.js, Telegraf, dan SQLite3, dengan integrasi pembayaran melalui Pakasir.

<p align="center">
  <img src="https://via.placeholder.com/800x300.png?text=Demo+Bot+Sagi+Tunnel" alt="Demo Bot Sagi Tunnel" />
</p>

## ✨ Fitur Utama

| Kategori | Fitur | Status |
| :--- | :--- | :--- |
| **Layanan Akun** | SSH, Vmess, Vless, Trojan, Shadowsocks | ✅ Tersedia |
| **Sistem Transaksi** | Auto Create, Auto Renew, Auto Trial (Limit Harian) | ✅ Tersedia |
| **Pembayaran** | Otomatis via **Pakasir** (QRIS, E-Wallet, Bank Transfer) | ✅ Tersedia |
| **Manajemen User** | Role Member & Reseller (Harga Diskon) | ✅ Tersedia |
| **Administrasi** | Panel Admin CRUD Server, Tambah Saldo, Broadcast | ✅ Tersedia |
| **Keamanan** | Force Subscribe Channel, Rate Limit Anti-Spam, Daily DB Backup | ✅ Tersedia |

---

## 🚀 Tumpukan Teknologi (Tech Stack)



[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Telegraf](https://img.shields.io/badge/Telegraf-007FFF?style=for-the-badge&logo=telegram&logoColor=white)](https://telegraf.js.org/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/index.html)
[![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Pakasir](https://img.shields.io/badge/Pakasir-38B2AC?style=for-the-badge&logoColor=white)](https://pakasir.id)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

---

## 🛠️ Instalasi & Konfigurasi

### Prasyarat

* Server Linux (Ubuntu/Debian)
* Node.js & NPM
* Akun Bot Telegram (dari BotFather)
* Akun dan API Key **Pakasir**
* Server API VPN (contoh: V2Ray/Xray/Shadowsocks yang terintegrasi dengan skrip `.sh`)

### Langkah Cepat

1.  **Clone Repositori:**
    ```bash
    git clone [https://github.com/mudziboy/botv3.git](https://github.com/mudziboy/botv3.git) /root/Botv3
    cd /root/Botv3
    ```
2.  **Jalankan Skrip Instalasi:**
    Gunakan skrip `start` yang akan menginstal dependensi (Node.js, PM2, UFW) dan meminta konfigurasi esensial.
    ```bash
    bash start sellvpn
    ```
3.  **Lengkapi `.vars.json`:**
    Skrip `start` akan meminta input untuk `BOT_TOKEN`, `USER_ID` (Admin), `PAKASIR_API_KEY`, dan lainnya.
4.  **Atur Webhook Pakasir:**
    Pastikan Webhook URL di Pakasir mengarah ke `https://<DOMAIN_ATAU_IP_ANDA>:<PORT_BOT>/webhook/pakasir`.
5.  **Akses Bot:**
    Setelah instalasi selesai, kirim `/start` ke bot Anda di Telegram.

---

## 💰 Penawaran Spesial (Script For Sale!)

**Script bot VPN ini adalah properti premium dan tidak tersedia secara publik.**

Jika Anda tertarik untuk memiliki skrip dengan fungsionalitas otomatis penuh, manajemen server, integrasi Pakasir, dan sistem Reseller/Trial yang *reliable*, Anda dapat membelinya dengan lisensi penuh. Script ini terintegrasi dengan file utama, dan bot tembak paket.

**Hubungi kontak di bawah untuk informasi harga dan pembelian:**

| Kontak | Keterangan |
| :--- | :--- |
| **Telegram (Fast Respond)** | [![Rahmarie](https://img.shields.io/badge/Telegram-@rahmarie-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/rahmarie) |
| **Username** | `t.me/rahmarie` |

---

## 📄 Lisensi

© 2024 Sagi Tunnel | Hak cipta dilindungi undang-undang. Skrip ini adalah produk komersial.
