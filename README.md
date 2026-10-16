# HargaKu Online 🐔

Aplikasi mobile (PWA) untuk mencatat **penjualan** dan **kematian ternak/unggas**, dengan pembagian peran:

| Peran | Yang bisa dilakukan |
|---|---|
| 👑 **Bos** | Lihat harga belanja/modal, kelola barang & stok, catat jual & kematian, kelola admin, lihat laporan omset–kerugian–untung |
| 🙋 **Admin** | Catat penjualan (harga bisa diubah per transaksi) dan kematian, lihat stok & riwayatnya sendiri — **tanpa bisa melihat harga belanja** |

## Apa yang berubah dibanding versi lama?

- **Sekarang online**: semua data tersimpan di **Google Sheet milik Bos**, bukan di HP masing-masing.
- **Semua HP karyawan sinkron** — jualan yang diinput Admin langsung terlihat di laporan Bos.
- Ada fitur baru **pencatatan kematian** unggas beserta perhitungan kerugiannya.
- Kalau internet putus, catatan jual/mati **antre dulu di HP** dan terkirim otomatis begitu online lagi.

---

## 🛠️ Panduan Setup Sekali Saja (oleh Bos)

Kerjakan langkah ini satu kali di komputer/HP Bos. Tidak perlu bisa programming.

### a. Buat Google Sheet

1. Buka **https://sheets.google.com** dan masuk dengan akun Google Anda.
2. Klik **+ Kosong** untuk membuat spreadsheet baru.
3. Klik judul di kiri atas, ganti namanya menjadi **"HargaKu"**.

### b. Tempel kode Apps Script

1. Di spreadsheet itu, buka menu **Ekstensi (Extensions) → Apps Script**.
2. Terbuka tab baru berisi editor kode. **Hapus seluruh isi editor** (blok semua, tekan Delete).
3. Buka file **`gas/Code.gs`** dari folder aplikasi ini (klik kanan → Open with → Notepad), **salin seluruh isinya**, lalu **tempel ke editor Apps Script**.
4. Klik ikon **💾 Simpan**.

### c. Jalankan setup sekali

1. Di bagian atas editor ada dropdown fungsi — pilih **`setup`**.
2. Klik tombol **▶ Run / Jalankan**.
3. Google akan minta izin (pertama kali saja):
   - Pilih akun Google Anda.
   - Muncul peringatan "Google hasn't verified this app" → klik **Advanced / Lanjutan** → klik **Go to ... (unsafe)** → klik **Allow / Izinkan**.
   - Ini normal karena skripnya buatan sendiri, bukan dari toko aplikasi.
4. Setelah selesai, buka menu **View → Logs** (atau tekan Ctrl+Enter). Di situ tertera **APP_KEY** yang dibuat otomatis, misal: `a1b2c3d4-....`
   - APP_KEY juga bisa dilihat kapan saja di tab **Config** pada spreadsheet Anda.
5. Di spreadsheet sekarang ada 4 tab baru: **Config**, **Users**, **Barang**, **Transaksi**. Akun bawaan sudah dibuat: **Bos** (PIN `1234`) dan **Budi** (PIN `5678`).

### d. Deploy sebagai Web App

1. Di editor Apps Script, klik tombol biru **Deploy → New deployment**.
2. Klik ikon **⚙️ roda gigi** di samping "Select type" → pilih **Web app**.
3. Isi:
   - **Description**: bebas, misal `HargaKu v1`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
4. Klik **Deploy**. Izinkan lagi bila diminta.
5. **Salin "Web app URL"** — bentuknya panjang dan berakhiran **`/exec`**.

> ⚠️ Setiap kali Anda mengubah kode di editor, ulangi langkah d ini (**Deploy → New deployment**) supaya perubahannya aktif.

### e. Susun & bagikan string konfigurasi

Susun string dengan format **`URL|APP_KEY`** (dipisah tanda garis tegak `|`), contoh:

```
https://script.google.com/macros/s/AKfycb.../exec|a1b2c3d4-e5f6-...
```

Bagikan string ini ke HP karyawan (misal lewat WhatsApp). Di HP masing-masing, saat pertama buka aplikasi, cukup **tempel string ini sekali** — selesai.

### f. Melihat data langsung di Google Sheet

Semua data bisa dipantau langsung dari spreadsheet "HargaKu":

| Tab | Isi |
|---|---|
| **Config** | APP_KEY aplikasi |
| **Users** | Daftar pengguna (nama, PIN ter-hash, peran) |
| **Barang** | Daftar barang/unggas: harga belanja, harga jual, stok |
| **Transaksi** | Semua catatan jual & kematian, lengkap dengan waktu dan siapa yang menginput |

---

## ▶️ Cara menjalankan aplikasi

Aplikasi ini file web statis — tidak perlu install apa pun.

### 1. Coba di komputer (paling cepat)

Klik dua kali `jalankan.bat`, lalu buka **http://localhost:8931** di browser.
Biarkan jendela PowerShell tetap terbuka selama memakai aplikasi.

### 2. Dipakai banyak HP (disarankan)

**Opsi A — hosting statis (paling praktis):**
Unggah seluruh isi folder `harga-app` ke hosting statis gratis (Netlify, Vercel, GitHub Pages) atau cPanel, lalu bagikan URL-nya ke semua HP. Setiap HP tinggal tempel string konfigurasi sekali.

**Opsi B — lewat Wi-Fi satu jaringan:**
1. Pastikan HP dan komputer terhubung ke **Wi-Fi yang sama**.
2. Jalankan `jalankan.bat` di komputer.
3. Di HP, buka browser → ketik `http://<IP-komputer>:8931`
   (IP komputer bisa dilihat dengan perintah `ipconfig`, contoh: `192.168.1.10:8931`).

Di kedua opsi, browser HP akan menawarkan **"Tambahkan ke layar utama"** — terima, dan HargaKu jadi aplikasi standalone seperti aplikasi native.

---

## 📱 Cara pakai per peran

### Akun bawaan

- **Bos**: nama `Bos`, PIN `1234`
- **Admin contoh**: nama `Budi`, PIN `5678`

> ⚠️ **Segera ganti PIN** lewat menu **Pengaturan → Ganti PIN saya** setelah login pertama. Bos juga bisa mengganti PIN siapa pun lewat menu **Kelola Admin**.

### 👑 Bos

1. **Barang** → tambah barang/unggas: nama, harga belanja (rahasia), harga jual, stok.
2. **Kelola Admin** → tambah admin satu per satu (nama + PIN) dan ganti PIN pengguna.
3. **Jual / Kematian** → Bos juga bisa mencatat penjualan dan kematian.
4. **Beranda** → ringkasan Omset, Kerugian (kematian), dan Total Untung.
5. **Laporan** → tabel per produk: terjual, mati, % mati, omset, kerugian, profit, dan footer **Total Untung**.
6. **Riwayat** → semua transaksi, termasuk siapa yang menginput.
7. **Pengaturan** → ganti PIN sendiri, lihat/ubah konfigurasi koneksi, keluar.

### 🙋 Admin

1. **Jual** → pilih barang, ubah harga jual bila perlu, isi jumlah → **Simpan**. Stok berkurang otomatis.
2. **Kematian** → pilih barang, isi jumlah ekor yang mati → **Simpan**. Stok berkurang otomatis.
3. **Stok** → daftar barang dan harga jualnya (**tanpa harga belanja**).
4. **Riwayat** → hanya transaksi yang dia input sendiri.
5. **Pengaturan** → ganti PIN sendiri, keluar.

### Kalau internet putus

- Pil status di atas layar menunjukkan 🟢 Online / 🔴 Offline / 🟡 antrean menunggu.
- Catatan **Jual/Kematian** tetap bisa diinput saat offline — masuk antrean **"Menunggu sinkronisasi"** dan terkirim otomatis saat online lagi, atau tekan tombol **Sinkronkan** pada pil status.
- **Tambah/ubah barang** (Bos) juga bisa saat offline — barang baru langsung tampil di daftar dengan lencana **⏳ menunggu**, dan nota penjualan offline tetap bisa dicetak (Bluetooth tidak butuh internet).
- Daftar barang & stok tetap terlihat dari cache terakhir.

#### Catatan keterbatasan mode offline

- Barang yang dibuat saat offline belum bisa dijual sebelum sempat sinkron — server belum mengenal ID-nya (antrean dikirim berurutan, jadi biasanya aman setelah online).
- Penjualan offline bisa **ditolak server** saat sinkronisasi bila stok bentrok (misal barang yang sama dijual admin lain duluan). Antrean yang gagal dibuang dan diberi tahu lewat toast — koreksi lewat tombol ✏️/🗑️ di Riwayat.
- Selama masih ada antrean, daftar barang menampilkan data optimis lokal; data server baru menggantikannya setelah semua antrean terkirim.

---

## 🧮 Rumus laporan

Untuk setiap produk:

- **Omset** = jumlah dari (terjual × harga jual per transaksi)
- **Kerugian** = jumlah mati × harga belanja (harga modal saat kematian dicatat)
- **Profit** = Omset − modal barang yang terjual − modal barang yang mati
- **% Mati** = mati ÷ (terjual + mati) × 100%
- **Total Untung** = jumlah Profit semua produk
- **Sisa stok BUKAN kerugian** — barang yang belum terjual dan tidak mati tetap dihitung sebagai stok.

**Contoh:** beli 10 ekor @ Rp 10.000 (modal Rp 100.000), harga jual Rp 15.000.
Terjual 5 ekor, mati 2 ekor, sisa 3 ekor.

- Omset = 5 × 15.000 = **Rp 75.000**
- Kerugian = 2 × 10.000 = **Rp 20.000**
- Profit = 75.000 − (5 × 10.000) − (2 × 10.000) = **Rp 5.000**
- Sisa 3 ekor **tetap stok**, bukan kerugian.

---

## 🔒 Catatan keamanan (dibaca dengan jujur)

- **Siapa pun yang memegang string konfigurasi (URL|APP_KEY) bisa mencoba login dengan menebak PIN.** PIN 4 digit hanya pembatas akses kasual, **bukan pengamanan tingkat bank**.
- Jangan bagikan string konfigurasi ke orang di luar karyawan.
- PIN **tidak** disimpan sebagai teks asli di Google Sheet — yang tersimpan hanya hash-nya. Tapi PIN dikirim ke server setiap transaksi, jadi jangan pakai PIN yang sama dengan PIN ATM/aplikasi lain.
- **Kalau string konfigurasi bocor**: ganti APP_KEY dengan mengetik nilai baru di tab **Config** (baris `APP_KEY`) pada Google Sheet, lalu di tiap HP buka **Pengaturan → Konfigurasi koneksi** dan tempel string baru.
- Harga belanja, kerugian, dan profit **tidak pernah dikirim server ke akun Admin** — diproteksi di sisi server, bukan hanya disembunyikan di layar.

---

## 📁 Struktur file

```
harga-app/
├── index.html      # kerangka aplikasi
├── css/style.css   # tampilan mobile
├── js/app.js       # seluruh logika frontend (tanpa dependensi)
├── gas/Code.gs     # backend Google Apps Script (ditempel ke Google Sheet)
├── manifest.json   # pengaturan PWA
├── sw.js           # service worker (cache shell aplikasi)
├── icon.svg        # ikon aplikasi
├── jalankan.bat    # pintasan menjalankan server lokal
└── server.ps1      # server lokal (PowerShell, port 8931)
```
