#!/bin/bash

# =======================================================
# ip_installer.sh - Installer Khusus Bot IP Whitelist (Owner Only)
# Fungsi: Instalasi ip_admin_bot.js dan konfigurasi GitHub/Saldo Manual.
# =======================================================

# ========== Color Setup ==========
green="\e[38;5;87m"
red="\e[38;5;196m"
neutral="\e[0m"
yellow="\e[38;5;226m"
bold_white="\e[1;37m"
reset="\e[0m"

# Folder bot yang digunakan (Harus sama dengan start_jasa.sh)
BOT_DIR="/root/Botv3"
# Asumsi REPO_URL bot Anda (tempat app.js dan ip_admin_bot.js berada)
REPO_URL="https://github.com/mudziboy/mdzitr.git" 


# ========== Remove Previous Installations ==========
hapus_instalasi_lama() {
  echo -e "${yellow}──────────────────────────────────────────────${neutral}"
  echo -e "${yellow}Menghapus instalasi Bot IP Whitelist sebelumnya...${neutral}"
  
  if command -v pm2 &> /dev/null;
  then
    pm2 delete ip_whitelist_bot 2>/dev/null
    pm2 save 2>/dev/null
  fi

  # Hapus file database IP dan log (penting untuk memulai bersih)
  rm -f ${BOT_DIR}/ip_whitelist.db
  rm -f ${BOT_DIR}/ip-combined.log
  rm -f ${BOT_DIR}/ip-error.log

  echo -e "${green}Cleanup selesai.${neutral}"
  echo -e "${yellow}──────────────────────────────────────────────${neutral}"
}

# ========== Install Dependencies ==========
pasang_package() {
  echo -e "${green}Install/verifikasi dependensi sistem (Node.js, NPM, Git, SQLite3)...${reset}"

  apt update -y
  # PM2, Node.js, SQLite3, build-essential wajib
  apt install -y npm nodejs curl dos2unix jq git build-essential sqlite3 || {
    echo -e "${red}❌ Gagal menginstal dependensi sistem.${neutral}"
    exit 1
  }

  npm install -g pm2 || {
    echo -e "${red}❌ Gagal menginstal PM2 global.${neutral}"
    exit 1
  }
}

# ========== Setup Bot Environment ==========
setup_bot() {
  timedatectl set-timezone Asia/Jakarta

  # Hanya clone jika folder belum ada (asumsi sudah diclone saat setup.sh atau start_jasa.sh)
  if [ ! -d ${BOT_DIR} ]; then
      echo -e "${green}Cloning repository bot dari ${REPO_URL}...${reset}"
      git clone ${REPO_URL} ${BOT_DIR} || {
          echo -e "${red}❌ Gagal cloning repository.${neutral}"
          exit 1
      }
  fi
  
  cd ${BOT_DIR}

  echo -e "${yellow}Mengkonversi ip_admin_bot.js ke format Unix (LF)...${reset}"
  dos2unix ip_admin_bot.js 2>/dev/null

  echo -e "${yellow}Install NPM packages khusus Bot IP (telegraf, axios, node-cron)...${reset}"
  # Instal paket yang dibutuhkan HANYA oleh ip_admin_bot.js
  npm install telegraf axios winston sqlite3 node-cron || {
        echo -e "${red}❌ Gagal saat instalasi NPM packages.${neutral}"
  }
}

# ========== Konfigurasi Bot IP Whitelist ==========
konfigurasi_dan_start() {
  clear
  echo -e "${green}──────────────────────────────────────────────${neutral}"
  echo -e "   ${bold_white}::: KONFIGURASI BOT IP WHITELIST :::${neutral}"
  echo -e "${green}──────────────────────────────────────────────${neutral}"
  echo -e "${yellow}Harap isi konfigurasi GitHub dan Top Up Manual Anda.${reset}"
 
  # --- INPUT DARI OWNER ---
  read -p "1.  Token Bot IP Whitelist (BARU)     : " iptoken
  read -p "2.  Admin ID (USER_ID Anda)             : " adminid
  read -p "3.  Username Admin Kontak (@username) : " adminusername
  read -p "4.  Info Rekening Top Up                : " rekeningkontak
  read -p "5.  ID Grup Notifikasi (GROUP_ID)       : " groupid
  read -p "6.  Nama Toko Anda (NAMA_STORE)         : " namastore
  read -p "7.  Harga Langganan IP (/Bulan, cth: 4000) : " ipprice
  read -p "8.  GitHub TOKEN (PAT - Izin Repo)      : " githubtoken
  read -p "9.  GitHub Owner (Contoh: mudziboy)     : " repoowner
  read -p "10. GitHub Repo Name (Contoh: regist)   : " reponame
  read -p "11. GitHub File Path (Contoh: izin)     : " filepath
  
  # Set default jika kosong
  : ${ipprice:=4000}
  : ${filepath:=izin} 

  # --- MEMBACA FILE .VARS.JSON LAMA DAN MENAMBAHKAN KONFIGURASI IP ---
  # Ini penting jika file .vars.json sudah dibuat oleh start_jasa.sh
  VARS_FILE="${BOT_DIR}/.vars.json"
  
  # Cek jika file vars sudah ada (dari instalasi bot utama)
  if [ -f "$VARS_FILE" ]; then
    echo -e "${yellow}File .vars.json Bot Utama terdeteksi. Menambahkan konfigurasi Bot IP...${reset}"
    
    # Baca variabel lama (token bot utama, port, dll.)
    OLD_VARS=$(cat "$VARS_FILE")
    
    # Buat JSON baru dengan menggabungkan dan menimpa/menambah variabel IP
    cat <<EOF > "$VARS_FILE"
{
  $(echo "$OLD_VARS" | jq 'del(.IP_BOT_TOKEN, .ADMIN_USERNAME_KONTAK, .REKENING_KONTAK, .GITHUB_TOKEN, .REPO_OWNER, .REPO_NAME, .FILE_PATH, .IP_PRICE_PER_MONTH)'),
  "IP_BOT_TOKEN": "$iptoken",
  "ADMIN_USERNAME_KONTAK": "$adminusername",
  "REKENING_KONTAK": "$rekeningkontak",
  "IP_PRICE_PER_MONTH": $ipprice,
  "GITHUB_TOKEN": "$githubtoken",
  "REPO_OWNER": "$repoowner",
  "REPO_NAME": "$reponame",
  "FILE_PATH": "$filepath"
}
EOF
  else
    # Buat file vars dari awal jika belum ada
    echo -e "${yellow}File .vars.json tidak ditemukan. Membuat konfigurasi Bot IP dari awal...${reset}"
    cat <<EOF > "$VARS_FILE"
{
  "BOT_TOKEN": "",
  "PORT": "50123",
  "USER_ID": "$adminid",
  "GROUP_ID": "$groupid",
  "NAMA_STORE": "$namastore",
  "MIN_DEPOSIT_AMOUNT": 10000,
  "IP_BOT_TOKEN": "$iptoken",
  "ADMIN_USERNAME_KONTAK": "$adminusername",
  "REKENING_KONTAK": "$rekeningkontak",
  "IP_PRICE_PER_MONTH": $ipprice,
  "GITHUB_TOKEN": "$githubtoken",
  "REPO_OWNER": "$repoowner",
  "REPO_NAME": "$reponame",
  "FILE_PATH": "$filepath"
}
EOF
  fi

  if ! jq empty "$VARS_FILE" 2>/dev/null; then
    echo -e "${red}❌ Gagal memproses file .vars.json dengan jq. Cek format JSON.${neutral}"
    exit 1
  fi
  
  echo -e "${green}✅ Konfigurasi file .vars.json berhasil diupdate.${neutral}"
  echo -e "${yellow}──────────────────────────────────────────────${neutral}"

  # 🚀 START BOT DENGAN PM2
  echo -e "${green}Menjalankan Bot IP Whitelist (ip_admin_bot.js)...${reset}"
  pm2 start ip_admin_bot.js --name ip_whitelist_bot --cwd ${BOT_DIR} --log /var/log/ip_whitelist_bot.log -- start
  
  pm2 save
  pm2 startup

  echo -e "${yellow}──────────────────────────────────────────────${neutral}"
  echo -e "   ${bold_white}::: BOT IP WHITELIST AKTIF :::${neutral}"
  echo -e "Bot IP sekarang berjalan sebagai: ${bold_white}ip_whitelist_bot${reset}"
  echo -e "Cek status dengan: ${bold_white}pm2 list${reset}"
  echo -e "${yellow}──────────────────────────────────────────────${neutral}"

  # 📩 Notifikasi awal ke Admin
  curl -s -X POST https://api.telegram.org/bot$iptoken/sendMessage \
    -d chat_id="$adminid" \
    -d text="✅ Hai Admin!\n\nBot IP Whitelist (ip_whitelist_bot) sudah aktif. Mode: Saldo Manual & GitHub Auto Commit." 2>/dev/null
}

# ========== EXECUTOR ==========
if [[ ${1} == "install_ip" ]];
then
  hapus_instalasi_lama
  pasang_package
  # CATATAN: setup_bot TIDAK akan meng-overwrite app.js atau start_jasa.sh
  setup_bot 
  konfigurasi_dan_start
else
  echo -e "${red}Gunakan perintah: ${yellow}bash ip_installer.sh install_ip${neutral}"
  exit 1
fi
