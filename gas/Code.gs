/* =========================================================
   JualanKu (Teras Laut Cirebon) — Backend Google Apps Script
   =========================================================
   CARA PAKAI (sekali saja, oleh Bos):

   1. Buka https://sheets.google.com → buat spreadsheet kosong
      → beri nama "JualanKu" (atau nama bebas lain).
   2. Menu Ekstensi (Extensions) → Apps Script.
   3. Hapus semua isi editor, tempel SELURUH file ini, klik Simpan.
   4. Di atas editor, pilih fungsi "setup" lalu klik Run/Jalankan.
      - Pertama kali akan minta izin: pilih akun Google Anda →
        Advanced/Lanjutan → "Go to ... (unsafe)" → Allow/Izinkan.
   5. Lihat log (View → Logs / Ctrl+Enter): di situ ada APP_KEY
      yang dibuat otomatis (juga tersimpan di tab "Config").
   6. Klik Deploy → New deployment → ikon roda gigi → pilih
      "Web app":
        - Description      : bebas, misal "JualanKu v1"
        - Execute as       : Me
        - Who has access   : Anyone
      Klik Deploy, lalu SALIN "Web app URL" (berakhiran /exec).
   7. Susun string konfigurasi untuk HP karyawan:
        URL_WEB_APP|APP_KEY
      contoh:
        https://script.google.com/.../exec|a1b2c3d4-...
      Bagikan string ini ke karyawan (misal lewat WhatsApp).

   Setiap mengubah kode ini, ulangi langkah 6 (New deployment)
   agar perubahan aktif.
   ========================================================= */

var HEADERS = {
  Config:    ["key", "value"],
  Users:     ["nama", "pin_hash", "peran"],
  Barang:    ["id", "nama", "harga_belanja", "harga_jual", "stok"],
  Transaksi: ["id", "waktu", "jenis", "barang_id", "nama_barang", "jumlah", "harga_jual", "harga_belanja", "admin", "pembeli", "no_hp"],
  Pelanggan: ["nama", "no_hp", "jumlah_transaksi", "total_belanja", "terakhir_beli"],
  Pengeluaran: ["id", "waktu", "jenis", "keterangan", "jumlah", "oleh"]
};

/* ---------------- Util sheet ---------------- */
function sheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  if (s.getLastRow() === 0) s.appendRow(HEADERS[name]);
  return s;
}
function rows(name) {
  var v = sheet(name).getDataRange().getValues();
  return v.slice(1);
}
// Migrasi ringan: sheet Transaksi lama mungkin belum punya kolom "pembeli"/"no_hp".
function migrasiTransaksi() {
  var s = sheet("Transaksi");
  if (String(s.getRange(1, 10).getValue() || "") === "") s.getRange(1, 10).setValue("pembeli");
  if (String(s.getRange(1, 11).getValue() || "") === "") s.getRange(1, 11).setValue("no_hp");
}
function sha256(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out.push((b < 16 ? "0" : "") + b.toString(16));
  }
  return out.join("");
}
function getConfig(key) {
  var r = rows("Config");
  for (var i = 0; i < r.length; i++) if (String(r[i][0]) === key) return String(r[i][1]);
  return "";
}
function setConfig(key, value) {
  var s = sheet("Config");
  var v = s.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) === key) { s.getRange(i + 1, 2).setValue(value); return; }
  }
  s.appendRow([key, value]);
}

/* ---------------- Setup awal (jalankan sekali) ---------------- */
function setup() {
  var names = ["Config", "Users", "Barang", "Transaksi", "Pelanggan", "Pengeluaran"];
  for (var i = 0; i < names.length; i++) sheet(names[i]);

  var key = getConfig("APP_KEY");
  if (!key) {
    key = Utilities.getUuid();
    setConfig("APP_KEY", key);
    Logger.log("APP_KEY baru dibuat: " + key);
    Logger.log("(APP_KEY juga tersimpan di tab Config, baris APP_KEY)");
  } else {
    Logger.log("APP_KEY sudah ada: " + key);
  }

  var ada = {};
  var u = rows("Users");
  for (var j = 0; j < u.length; j++) ada[String(u[j][0])] = true;
  var us = sheet("Users");
  if (!ada["Bos"]) us.appendRow(["Bos", sha256("1234"), "bos"]);
  if (!ada["Budi"]) us.appendRow(["Budi", sha256("5678"), "admin"]);

  Logger.log("Setup selesai. Akun bawaan: Bos PIN 1234 (bos), Budi PIN 5678 (admin).");
  Logger.log("SEGERA ganti PIN lewat menu Pengaturan di aplikasi setelah login pertama.");
  Logger.log("Opsional — Bot Telegram: isi TELEGRAM_TOKEN dan TELEGRAM_CHAT_ID di tab Config,");
  Logger.log("lalu pasang pemicu waktu untuk fungsi telegramPolling (menu ⏰ → + Add Trigger → Every minute).");
  Logger.log("JANGAN menulis token Telegram di kode ini — repo bersifat publik.");
  Logger.log("Lanjutkan: Deploy → New deployment → Web app → Execute as Me → Access Anyone.");
}

/* ---------------- HTTP ---------------- */
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  return handle(e && e.parameter ? e.parameter : {});
}
function doPost(e) {
  var p = {};
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: "Format permintaan tidak valid." });
  }
  // Webhook Telegram punya field "message"/"edited_message", bukan "action"
  if (p.message || p.edited_message) {
    handleTelegram(p);
    return ContentService.createTextOutput("{}")
      .setMimeType(ContentService.MimeType.JSON);
  }
  return handle(p);
}

/* ---------------- Autentikasi ---------------- */
function findUser(nama) {
  var r = rows("Users");
  for (var i = 0; i < r.length; i++) {
    if (String(r[i][0]).toLowerCase() === String(nama || "").toLowerCase()) {
      return { row: i + 2, nama: String(r[i][0]), pin_hash: String(r[i][1]), peran: String(r[i][2]) };
    }
  }
  return null;
}
function auth(p) {
  if (String(p.key || "") !== getConfig("APP_KEY")) return { error: "Kunci aplikasi (APP_KEY) salah." };
  var u = findUser(p.nama);
  if (!u || u.pin_hash !== sha256(String(p.pin || ""))) return { error: "Nama atau PIN salah." };
  return { user: u };
}
function needBos(user) {
  if (user.peran !== "bos") return { ok: false, error: "Akses ditolak: khusus Bos." };
  return null;
}

/* ---------------- Router aksi ---------------- */
function handle(p) {
  try {
    var action = String(p.action || "");
    if (action === "ping") {
      if (String(p.key || "") !== getConfig("APP_KEY")) return out({ ok: false, error: "Kunci aplikasi (APP_KEY) salah." });
      return out({ ok: true });
    }
    if (action === "etalase") {
      if (String(p.key || "") !== getConfig("APP_KEY")) return out({ ok: false, error: "Kunci aplikasi (APP_KEY) salah." });
      return out(etalaseList());
    }
    var a = auth(p);
    if (a.error) return out({ ok: false, error: a.error });
    var user = a.user;

    switch (action) {
      case "login":           return out({ ok: true, peran: user.peran });
      case "barang_list":     return out(barangList(user));
      case "jual":            return withLock(function () { return doJual(user, p); });
      case "jual_multi":      return withLock(function () { return doJualMulti(user, p); });
      case "mati":            return withLock(function () { return doMati(user, p); });
      case "barang_add":      return withLock(function () { return doBarangAdd(user, p); });
      case "barang_update":   return withLock(function () { return doBarangUpdate(user, p); });
      case "admin_add":       return withLock(function () { return doAdminAdd(user, p); });
      case "admin_delete":    return withLock(function () { return doAdminDelete(user, p); });
      case "admin_list":      return out(doAdminList(user));
      case "user_pin_change": return withLock(function () { return doPinChange(user, p); });
      case "riwayat":         return out(doRiwayat(user));
      case "laporan":         return out(doLaporan(user, p));
      case "pelanggan_list":  return out(doPelangganList(user));
      case "transaksi_edit":  return withLock(function () { return doTransaksiEdit(user, p); });
      case "transaksi_hapus": return withLock(function () { return doTransaksiHapus(user, p); });
      case "stok_masuk":      return withLock(function () { return doStokMasuk(user, p); });
      case "barang_hapus":    return withLock(function () { return doBarangHapus(user, p); });
      case "pelanggan_hapus": return withLock(function () { return doPelangganHapus(user, p); });
      case "pengeluaran_add":    return withLock(function () { return doPengeluaranAdd(user, p); });
      case "pengeluaran_list":   return out(doPengeluaranList(user));
      case "pengeluaran_hapus":  return withLock(function () { return doPengeluaranHapus(user, p); });
      case "config_set":         return withLock(function () { return doConfigSet(user, p); });
      default:                return out({ ok: false, error: "Aksi tidak dikenal: " + action });
    }
  } catch (err) {
    return out({ ok: false, error: "Kesalahan server: " + err.message });
  }
}
function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return out({ ok: false, error: "Server sibuk, coba beberapa detik lagi." });
  try {
    return out(fn());
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- Barang ---------------- */
function barangRows() {
  var v = sheet("Barang").getDataRange().getValues();
  var list = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    list.push({
      row: i + 1,
      id: String(v[i][0]),
      nama: String(v[i][1]),
      harga_belanja: Number(v[i][2]) || 0,
      harga_jual: Number(v[i][3]) || 0,
      stok: Number(v[i][4]) || 0
    });
  }
  return list;
}
function findBarang(id) {
  var list = barangRows();
  for (var i = 0; i < list.length; i++) if (list[i].id === String(id || "")) return list[i];
  return null;
}
function barangList(user) {
  // PENTING: admin tidak pernah menerima harga_belanja
  var list = barangRows().map(function (b) {
    if (user.peran === "bos") {
      return { id: b.id, nama: b.nama, harga_belanja: b.harga_belanja, harga_jual: b.harga_jual, stok: b.stok };
    }
    return { id: b.id, nama: b.nama, harga_jual: b.harga_jual, stok: b.stok };
  });
  return { ok: true, barang: list };
}

/* Etalase publik untuk website toko — cukup APP_KEY, tanpa PIN.
   Hanya mengirim nama, harga jual, dan stok. Harga belanja TIDAK pernah keluar. */
function etalaseList() {
  var list = barangRows().map(function (b) {
    return { id: b.id, nama: b.nama, harga_jual: b.harga_jual, stok: b.stok };
  });
  return { ok: true, barang: list };
}
function validAngkaBarang(p) {
  var nama = String(p.barang_nama || "").trim();
  var belanja = Number(p.harga_belanja);
  var jual = Number(p.harga_jual);
  var stok = Math.floor(Number(p.stok));
  if (!nama) return { error: "Nama barang wajib diisi." };
  if (isNaN(belanja) || isNaN(jual) || isNaN(stok) || belanja < 0 || jual < 0 || stok < 0) {
    return { error: "Harga dan stok harus angka nol atau lebih." };
  }
  return { nama: nama, belanja: belanja, jual: jual, stok: stok };
}
function doBarangAdd(user, p) {
  // Admin boleh menambah barang BARU (biasanya barang yang mereka kulak sendiri).
  // Edit & hapus tetap khusus Bos. Respons tidak membawa harga sama sekali.
  var v = validAngkaBarang(p);
  if (v.error) return { ok: false, error: v.error };
  // Tolak duplikat nama (abaikan huruf besar/kecil, spasi tepi & spasi ganda)
  var norm = v.nama.replace(/\s+/g, " ").trim().toLowerCase();
  var ada = barangRows();
  for (var i = 0; i < ada.length; i++) {
    if (ada[i].nama.replace(/\s+/g, " ").trim().toLowerCase() === norm) {
      return { ok: false, error: "Barang \"" + v.nama + "\" sudah ada (" + ada[i].id + "). Gunakan Stok Masuk untuk menambah stoknya." };
    }
  }
  var id = String(p.barang_id || "").trim();
  if (id) {
    if (findBarang(id)) return { ok: false, error: "ID barang sudah dipakai: " + id };
  } else {
    id = Utilities.getUuid();
  }
  sheet("Barang").appendRow([id, v.nama, v.belanja, v.jual, v.stok]);
  // Stok awal bernilai modal — catat otomatis sebagai pengeluaran kulakan
  if (v.stok > 0 && v.belanja > 0) {
    catatPengeluaran(user, "kulakan", "Stok awal: " + v.nama + " ×" + v.stok, v.stok * v.belanja);
  }
  return { ok: true, id: id };
}
function doBarangUpdate(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var b = findBarang(p.id || p.barang_id);
  if (!b) return { ok: false, error: "Barang tidak ditemukan." };
  var v = validAngkaBarang(p);
  if (v.error) return { ok: false, error: v.error };
  // Perubahan di sini adalah koreksi data — TIDAK dicatat sebagai pengeluaran.
  // Penambahan stok (kulakan) wajib lewat aksi stok_masuk agar kas tercatat.
  sheet("Barang").getRange(b.row, 1, 1, 5).setValues([[b.id, v.nama, v.belanja, v.jual, v.stok]]);
  return { ok: true };
}
function doBarangHapus(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var b = findBarang(p.id || p.barang_id);
  if (!b) return { ok: false, error: "Barang tidak ditemukan." };
  // Hanya baris Barang yang dihapus — Transaksi TIDAK disentuh: laporan
  // memakai snapshot nama_barang per baris, jadi riwayat tetap utuh.
  sheet("Barang").deleteRow(b.row);
  return { ok: true };
}

/* ---------------- Transaksi (jual / mati) ---------------- */
// Nomor HP opsional: hanya angka 9-15 digit (spasi/strip/plus diabaikan).
function validNoHp(raw) {
  var hp = String(raw || "").replace(/[\s\-+]/g, "");
  if (!hp) return { hp: "" };
  if (!/^\d{9,15}$/.test(hp)) return { error: "Nomor HP tidak valid." };
  return { hp: hp };
}
// Upsert database pelanggan — cocokkan no_hp (jika diisi), kalau tidak ada cocokkan nama.
function catatPelanggan(nama, noHp, totalBelanja, waktuStr) {
  nama = String(nama || "").trim();
  noHp = String(noHp || "").trim();
  if (!nama && !noHp) return;
  var s = sheet("Pelanggan");
  var v = s.getDataRange().getValues();
  var rowIdx = -1;
  for (var i = 1; i < v.length; i++) {
    if (noHp) {
      if (String(v[i][1] || "").toLowerCase() === noHp.toLowerCase()) { rowIdx = i + 1; break; }
    } else if (String(v[i][0] || "").toLowerCase() === nama.toLowerCase()) { rowIdx = i + 1; break; }
  }
  if (rowIdx > 0) {
    var cur = v[rowIdx - 1];
    // Isi nama/no_hp yang dulu kosong bila sekarang diberikan
    var hpSimpan = String(cur[1] || "") || noHp;
    s.getRange(rowIdx, 1, 1, 5).setValues([[
      String(cur[0] || "") || nama,
      hpSimpan ? "'" + hpSimpan : "",
      (Number(cur[2]) || 0) + 1,
      (Number(cur[3]) || 0) + totalBelanja,
      "'" + waktuStr
    ]]);
  } else {
    s.appendRow([nama, noHp ? "'" + noHp : "", 1, totalBelanja, "'" + waktuStr]);
  }
}
function catatTransaksi(user, p, jenis) {
  var b = findBarang(p.barang_id);
  if (!b) return { ok: false, error: "Barang tidak ditemukan." };
  var jumlah = Math.floor(Number(p.jumlah));
  if (!jumlah || jumlah <= 0) return { ok: false, error: "Jumlah harus angka lebih dari nol." };
  if (jumlah > b.stok) return { ok: false, error: "Stok tidak cukup (sisa " + b.stok + ")." };

  var hargaJual = 0;
  if (jenis === "jual") {
    hargaJual = (p.harga_jual !== undefined && p.harga_jual !== null && String(p.harga_jual) !== "")
      ? Number(p.harga_jual) : b.harga_jual;
    if (isNaN(hargaJual) || hargaJual < 0) return { ok: false, error: "Harga jual tidak valid." };
  }
  var hv = validNoHp(p.no_hp);
  if (hv.error) return { ok: false, error: hv.error };

  var stokBaru = b.stok - jumlah;
  sheet("Barang").getRange(b.row, 5).setValue(stokBaru);
  // harga_belanja & harga_jual disimpan sebagai snapshot saat transaksi
  migrasiTransaksi();
  var pembeli = String(p.pembeli || "").trim();
  var id = Utilities.getUuid();
  var waktu = new Date();
  var waktuStr = Utilities.formatDate(waktu, "Asia/Jakarta", "dd/MM/yyyy HH:mm");
  sheet("Transaksi").appendRow([
    id, waktu, jenis, b.id, b.nama, jumlah, hargaJual, b.harga_belanja, user.nama, pembeli, hv.hp ? "'" + hv.hp : ""
  ]);
  if (jenis === "jual") catatPelanggan(pembeli, hv.hp, jumlah * hargaJual, waktuStr);
  var tx = {
    id: id,
    waktu: waktuStr,
    jenis: jenis,
    nama_barang: b.nama,
    jumlah: jumlah,
    harga_jual: hargaJual,
    admin: user.nama,
    pembeli: pembeli
  };
  // PENTING: admin tidak pernah menerima harga_belanja
  if (user.peran === "bos") tx.harga_belanja = b.harga_belanja;
  return { ok: true, stok: stokBaru, transaksi: tx };
}
function doJual(user, p) { return catatTransaksi(user, p, "jual"); }
function doMati(user, p) { return catatTransaksi(user, p, "mati"); }

// Penjualan keranjang (multi item). Semua validasi & cek stok dilakukan
// SEBELUM menulis apa pun — gagal satu, tidak ada yang tersimpan.
function doJualMulti(user, p) {
  var items = p.items;
  if (!items || typeof items.length !== "number" || items.length === 0) {
    return { ok: false, error: "Keranjang kosong — tambahkan barang dulu." };
  }
  var pembeli = String(p.pembeli || "").trim();
  var hv = validNoHp(p.no_hp);
  if (hv.error) return { ok: false, error: hv.error };
  // Validasi per item + gabungkan barang_id yang sama
  var agg = {};
  var order = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var b = findBarang(it.barang_id);
    if (!b) return { ok: false, error: "Ada barang yang tidak ditemukan. Muat ulang daftar barang." };
    var jumlah = Math.floor(Number(it.jumlah));
    if (!jumlah || jumlah <= 0) return { ok: false, error: "Jumlah " + b.nama + " harus angka lebih dari nol." };
    var harga = (it.harga_jual !== undefined && it.harga_jual !== null && String(it.harga_jual) !== "")
      ? Number(it.harga_jual) : b.harga_jual;
    if (isNaN(harga) || harga < 0) return { ok: false, error: "Harga jual " + b.nama + " tidak valid." };
    if (!agg[b.id]) { agg[b.id] = { b: b, jumlah: 0, entries: [] }; order.push(b.id); }
    agg[b.id].jumlah += jumlah;
    agg[b.id].entries.push({ jumlah: jumlah, harga: harga });
  }
  // Cek stok untuk SEMUA barang dulu
  for (var k = 0; k < order.length; k++) {
    var g = agg[order[k]];
    if (g.jumlah > g.b.stok) {
      return { ok: false, error: "Stok " + g.b.nama + " tidak cukup (sisa " + g.b.stok + ")." };
    }
  }
  migrasiTransaksi();
  var waktu = new Date();
  var waktuStr = Utilities.formatDate(waktu, "Asia/Jakarta", "dd/MM/yyyy HH:mm");
  var notaItems = [];
  var total = 0;
  var ts = sheet("Transaksi");
  var bs = sheet("Barang");
  for (var m = 0; m < order.length; m++) {
    var g2 = agg[order[m]];
    bs.getRange(g2.b.row, 5).setValue(g2.b.stok - g2.jumlah);
    for (var n = 0; n < g2.entries.length; n++) {
      var e = g2.entries[n];
      var subtotal = e.jumlah * e.harga;
      total += subtotal;
      // harga_belanja disimpan sebagai snapshot — tidak pernah masuk nota
      ts.appendRow([Utilities.getUuid(), waktu, "jual", g2.b.id, g2.b.nama, e.jumlah, e.harga, g2.b.harga_belanja, user.nama, pembeli, hv.hp ? "'" + hv.hp : ""]);
      notaItems.push({ nama_barang: g2.b.nama, jumlah: e.jumlah, harga_jual: e.harga, subtotal: subtotal });
    }
  }
  catatPelanggan(pembeli, hv.hp, total, waktuStr);
  // no_hp sengaja TIDAK masuk nota — nota dicetak untuk pelanggan
  return { ok: true, nota: { pembeli: pembeli, waktu: waktuStr, admin: user.nama, items: notaItems, total: total } };
}

/* ---------------- Pengguna ---------------- */
function doAdminAdd(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var nama = String(p.admin_nama || "").trim();
  var pin = String(p.admin_pin || "").trim();
  if (!nama || !pin) return { ok: false, error: "Nama dan PIN admin wajib diisi." };
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: "PIN harus 4-8 digit angka." };
  if (findUser(nama)) return { ok: false, error: "Nama sudah dipakai pengguna lain." };
  sheet("Users").appendRow([nama, sha256(pin), "admin"]);
  return { ok: true };
}
function doAdminDelete(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var nama = String(p.target_nama || "").trim();
  if (!nama) return { ok: false, error: "Nama admin yang dihapus wajib diisi." };
  var t = findUser(nama);
  if (!t) return { ok: false, error: "Pengguna tidak ditemukan." };
  if (t.peran === "bos") return { ok: false, error: "Akun Bos tidak bisa dihapus." };
  if (t.nama.toLowerCase() === String(user.nama).toLowerCase()) {
    return { ok: false, error: "Anda tidak bisa menghapus akun sendiri." };
  }
  sheet("Users").deleteRow(t.row);
  return { ok: true };
}
function doAdminList(user) {
  var deny = needBos(user); if (deny) return deny;
  var list = rows("Users").map(function (r) {
    return { nama: String(r[0]), peran: String(r[2]) };
  });
  return { ok: true, users: list };
}
function doPinChange(user, p) {
  var target = String(p.target_nama || "").trim();
  var pin = String(p.new_pin || "").trim();
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: "PIN harus 4-8 digit angka." };
  var t;
  if (target) {
    if (user.peran !== "bos") return { ok: false, error: "Hanya Bos yang bisa mengganti PIN orang lain." };
    t = findUser(target);
  } else {
    t = findUser(user.nama);
  }
  if (!t) return { ok: false, error: "Pengguna tidak ditemukan." };
  sheet("Users").getRange(t.row, 2).setValue(sha256(pin));
  return { ok: true };
}

/* ---------------- Riwayat ---------------- */
function doRiwayat(user) {
  var r = rows("Transaksi");
  var list = [];
  for (var i = 0; i < r.length; i++) {
    if (!r[i][0]) continue;
    var adminNama = String(r[i][8] || "");
    if (user.peran !== "bos" && adminNama !== user.nama) continue;
    var row = {
      id: String(r[i][0]),
      waktu: new Date(r[i][1]).toISOString(),
      jenis: String(r[i][2]),
      barang_id: String(r[i][3]),
      nama_barang: String(r[i][4]),
      jumlah: Number(r[i][5]) || 0,
      harga_jual: Number(r[i][6]) || 0,
      pembeli: String(r[i][9] || ""),
      no_hp: String(r[i][10] || "")
    };
    // PENTING: admin tidak pernah menerima harga_belanja
    if (user.peran === "bos") {
      row.harga_belanja = Number(r[i][7]) || 0;
      row.admin = adminNama;
    }
    list.push(row);
  }
  list.reverse(); // terbaru di atas
  if (list.length > 200) list = list.slice(0, 200); // batasi 200 transaksi terakhir
  return { ok: true, riwayat: list };
}

/* ---------------- Revisi transaksi (khusus Bos) ---------------- */
function findTransaksi(id) {
  var v = sheet("Transaksi").getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) === String(id || "")) {
      return {
        row: i + 1,
        id: String(v[i][0]),
        jenis: String(v[i][2]),
        barang_id: String(v[i][3]),
        jumlah: Number(v[i][5]) || 0,
        harga_jual: Number(v[i][6]) || 0
      };
    }
  }
  return null;
}
function doTransaksiEdit(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var t = findTransaksi(p.id);
  if (!t) return { ok: false, error: "Transaksi tidak ditemukan." };
  var adaJumlah = p.jumlah !== undefined && p.jumlah !== null && String(p.jumlah) !== "";
  var adaHarga = p.harga_jual !== undefined && p.harga_jual !== null && String(p.harga_jual) !== "";
  if (!adaJumlah && !adaHarga) return { ok: false, error: "Tidak ada perubahan." };
  var s = sheet("Transaksi");
  if (adaJumlah) {
    var jumlahBaru = Math.floor(Number(p.jumlah));
    if (!jumlahBaru || jumlahBaru <= 0) return { ok: false, error: "Jumlah harus angka lebih dari nol." };
    if (jumlahBaru !== t.jumlah) {
      var b = findBarang(t.barang_id);
      if (!b) return { ok: false, error: "Barang sudah tidak ada, hanya harga yang bisa diubah." };
      var delta = t.jumlah - jumlahBaru; // positif = stok kembali, negatif = stok berkurang lagi
      if (delta < 0 && b.stok < -delta) {
        return { ok: false, error: "Stok tidak cukup untuk revisi ini." };
      }
      sheet("Barang").getRange(b.row, 5).setValue(b.stok + delta);
      s.getRange(t.row, 6).setValue(jumlahBaru);
    }
  }
  if (adaHarga && t.jenis === "jual") {
    var hargaBaru = Number(p.harga_jual);
    if (isNaN(hargaBaru) || hargaBaru < 0) return { ok: false, error: "Harga jual tidak valid." };
    s.getRange(t.row, 7).setValue(hargaBaru);
  }
  return { ok: true };
}
function doTransaksiHapus(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var t = findTransaksi(p.id);
  if (!t) return { ok: false, error: "Transaksi tidak ditemukan." };
  // Kembalikan stok (jual & mati sama-sama mengurangi stok saat dicatat)
  var b = findBarang(t.barang_id);
  if (b) sheet("Barang").getRange(b.row, 5).setValue(b.stok + t.jumlah);
  sheet("Transaksi").deleteRow(t.row);
  return { ok: true };
}

/* ---------------- Pelanggan (khusus Bos) ---------------- */
function doPelangganList(user) {
  var deny = needBos(user); if (deny) return deny;
  var r = rows("Pelanggan");
  var list = [];
  for (var i = 0; i < r.length; i++) {
    if (!r[i][0] && !r[i][1]) continue;
    list.push({
      nama: String(r[i][0] || ""),
      no_hp: String(r[i][1] || ""),
      jumlah_transaksi: Number(r[i][2]) || 0,
      total_belanja: Number(r[i][3]) || 0,
      terakhir_beli: String(r[i][4] || "")
    });
  }
  list.sort(function (a, b) { return b.total_belanja - a.total_belanja; });
  return { ok: true, pelanggan: list };
}
function doPelangganHapus(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var nama = String(p.target_nama || "");
  var noHp = String(p.no_hp || "");
  var s = sheet("Pelanggan");
  var v = s.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0] || "").toLowerCase() === nama.toLowerCase() &&
        String(v[i][1] || "").toLowerCase() === noHp.toLowerCase()) {
      s.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "Pelanggan tidak ditemukan." };
}

/* ---------------- Pengeluaran & stok masuk (khusus Bos) ---------------- */
function catatPengeluaran(user, jenis, keterangan, jumlah) {
  sheet("Pengeluaran").appendRow([
    Utilities.getUuid(), new Date(), jenis, String(keterangan || ""), Number(jumlah) || 0, user.nama
  ]);
}
function doStokMasuk(user, p) {
  // Admin boleh mencatat kulakan (mereka yang membayar), tapi harga modal
  // TIDAK PERNAH dikembalikan ke admin — bos saja yang menerima harga_belanja.
  var b = findBarang(p.barang_id);
  if (!b) return { ok: false, error: "Barang tidak ditemukan." };
  var jumlah = Math.floor(Number(p.jumlah));
  if (!jumlah || jumlah <= 0) return { ok: false, error: "Jumlah masuk harus angka lebih dari nol." };
  var hargaBeli = Number(p.harga_beli);
  if (isNaN(hargaBeli) || hargaBeli < 0) return { ok: false, error: "Harga beli tidak valid." };
  var stokBaru = b.stok + jumlah;
  // Harga modal mengikuti harga kulakan terbaru (kolom 3 = harga_belanja, kolom 5 = stok)
  sheet("Barang").getRange(b.row, 3).setValue(hargaBeli);
  sheet("Barang").getRange(b.row, 5).setValue(stokBaru);
  catatPengeluaran(user, "kulakan", "Kulakan: " + b.nama + " ×" + jumlah, jumlah * hargaBeli);
  if (user.peran === "bos") return { ok: true, stok: stokBaru, harga_belanja: hargaBeli };
  return { ok: true, stok: stokBaru };
}
function doPengeluaranAdd(user, p) {
  // Admin juga boleh mencatat pengeluaran — 'oleh' tetap mencatat siapa penginputnya
  var ket = String(p.keterangan || "").trim();
  var jumlah = Number(p.jumlah);
  if (!ket) return { ok: false, error: "Keterangan pengeluaran wajib diisi." };
  if (isNaN(jumlah) || jumlah <= 0) return { ok: false, error: "Nominal pengeluaran harus angka lebih dari nol." };
  catatPengeluaran(user, "manual", ket, jumlah);
  return { ok: true };
}
function doPengeluaranList(user) {
  var deny = needBos(user); if (deny) return deny;
  var r = rows("Pengeluaran");
  var list = [];
  for (var i = 0; i < r.length; i++) {
    if (!r[i][0]) continue;
    list.push({
      id: String(r[i][0]),
      waktu: r[i][1] ? Utilities.formatDate(new Date(r[i][1]), "Asia/Jakarta", "dd/MM/yyyy HH:mm") : "",
      jenis: String(r[i][2]),
      keterangan: String(r[i][3]),
      jumlah: Number(r[i][4]) || 0,
      oleh: String(r[i][5] || "")
    });
  }
  list.reverse(); // terbaru di atas
  return { ok: true, pengeluaran: list };
}
function doPengeluaranHapus(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var s = sheet("Pengeluaran");
  var v = s.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) === String(p.id || "")) {
      // Menghapus catatan pengeluaran (manual maupun kulakan) hanya menghapus
      // catatan kas — stok barang TIDAK pernah berubah karena ini.
      s.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "Catatan pengeluaran tidak ditemukan." };
}

/* ---------------- Config jarak jauh (khusus Bos) ---------------- */
// Hanya kunci telegram yang boleh diubah lewat API — sisanya tetap manual.
function doConfigSet(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var kunci = String(p.kunci || "").trim();
  var boleh = ["TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_OFFSET"];
  if (boleh.indexOf(kunci) < 0) return { ok: false, error: "Kunci konfigurasi tidak diizinkan." };
  setConfig(kunci, String(p.nilai || "").trim());
  return { ok: true };
}

/* ---------------- Laporan (khusus Bos) ---------------- */
// Predikat tanggal per periode, semua berbasis Asia/Jakarta — tanpa matematika
// timezone manual: bandingkan string "yyyy/MM/dd" hasil formatDate.
function filterPeriode(periode) {
  var tz = "Asia/Jakarta";
  if (periode === "hari") {
    var today = Utilities.formatDate(new Date(), tz, "yyyy/MM/dd");
    return function (w) { return Utilities.formatDate(new Date(w), tz, "yyyy/MM/dd") === today; };
  }
  if (periode === "minggu") {
    var set = {};
    for (var n = 0; n < 7; n++) {
      set[Utilities.formatDate(new Date(Date.now() - n * 86400000), tz, "yyyy/MM/dd")] = true;
    }
    return function (w) { return !!set[Utilities.formatDate(new Date(w), tz, "yyyy/MM/dd")]; };
  }
  if (periode === "bulan") {
    var ym = Utilities.formatDate(new Date(), tz, "yyyy/MM");
    return function (w) { return Utilities.formatDate(new Date(w), tz, "yyyy/MM") === ym; };
  }
  return function () { return true; }; // "semua" — tanpa filter (perilaku lama)
}
function doLaporan(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var periode = String((p && p.periode) || "semua");
  var cocok = filterPeriode(periode);
  var r = rows("Transaksi");
  var agg = {};
  var order = [];
  for (var i = 0; i < r.length; i++) {
    if (!r[i][0]) continue;
    if (!cocok(r[i][1])) continue; // saring periode berdasarkan kolom waktu
    var bid = String(r[i][3]);
    if (!agg[bid]) {
      agg[bid] = { nama: String(r[i][4]), terjual: 0, mati: 0, omset: 0, kerugian: 0, modal_terjual: 0 };
      order.push(bid);
    }
    var g = agg[bid];
    var jumlah = Number(r[i][5]) || 0;
    var hj = Number(r[i][6]) || 0;
    var hb = Number(r[i][7]) || 0;
    if (String(r[i][2]) === "jual") {
      g.terjual += jumlah;
      g.omset += jumlah * hj;
      g.modal_terjual += jumlah * hb;
    } else if (String(r[i][2]) === "mati") {
      g.mati += jumlah;
      g.kerugian += jumlah * hb;
    }
  }
  var items = [];
  var totalUntung = 0;
  for (var k = 0; k < order.length; k++) {
    var g2 = agg[order[k]];
    var profit = g2.omset - g2.modal_terjual - g2.kerugian;
    var denom = g2.terjual + g2.mati;
    totalUntung += profit;
    items.push({
      barang_id: order[k],
      nama: g2.nama,
      terjual: g2.terjual,
      mati: g2.mati,
      omset: g2.omset,
      kerugian: g2.kerugian,
      profit: profit,
      persen_mati: denom > 0 ? (g2.mati / denom) * 100 : 0
    });
  }
  return { ok: true, periode: periode, items: items, total_untung: totalUntung, keuangan: hitungKeuangan(items, totalUntung, cocok) };
}
// Ringkasan keuangan (khusus Bos): kas = omset − pengeluaran per periode yang sama;
// nilai_stok SELALU snapshot saat ini (aset, bukan angka periode).
function hitungKeuangan(items, totalUntung, cocok) {
  var omset = 0;
  for (var i = 0; i < items.length; i++) omset += items[i].omset;
  var kulakan = 0, manual = 0;
  var pr = rows("Pengeluaran");
  for (var k = 0; k < pr.length; k++) {
    if (!pr[k][0]) continue;
    if (cocok && !cocok(pr[k][1])) continue; // pengeluaran ikut disaring periode
    if (String(pr[k][2]) === "kulakan") kulakan += Number(pr[k][4]) || 0;
    else if (String(pr[k][2]) === "manual") manual += Number(pr[k][4]) || 0;
  }
  var nilaiStok = 0;
  var br = barangRows();
  for (var m = 0; m < br.length; m++) nilaiStok += br[m].stok * br[m].harga_belanja;
  return {
    omset: omset,
    pengeluaran_kulakan: kulakan,
    pengeluaran_manual: manual,
    total_pengeluaran: kulakan + manual,
    sisa_kas: omset - kulakan - manual,
    nilai_stok: nilaiStok,
    laba_penjualan: totalUntung
  };
}

/* ---------------- Bot Telegram (khusus Bos) ----------------
   KEAMANAN: token & chat id TIDAK boleh ditulis di file ini
   (repo publik). Keduanya dibaca dari tab Config:
   TELEGRAM_TOKEN dan TELEGRAM_CHAT_ID. Bila kosong → diam saja. */
// Escape untuk parse_mode HTML (nama ikan bisa mengandung & < >)
function escT(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function telegramKirim(chatId, text, useHtml) {
  var token = getConfig("TELEGRAM_TOKEN");
  if (!token) return;
  var body = { chat_id: chatId, text: String(text) };
  if (useHtml) body.parse_mode = "HTML";
  try {
    var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      // Jangan pernah diam — log penyebabnya, lalu coba lagi teks polos
      Logger.log("Telegram gagal (" + res.getResponseCode() + "): " + res.getContentText());
      if (useHtml) telegramKirimPolos(chatId, String(text).replace(/<[^>]*>/g, ""));
    }
  } catch (e) {
    Logger.log("telegramKirim error: " + e.message);
  }
}
// Jalur teks polos tanpa parse_mode — tidak bisa gagal karena markup
function telegramKirimPolos(chatId, text) {
  var token = getConfig("TELEGRAM_TOKEN");
  if (!token) return;
  try {
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId, text: String(text) }),
      muteHttpExceptions: true
    });
  } catch (e) { Logger.log("telegramKirimPolos error: " + e.message); }
}
function ribuan(n) {
  var s = String(Math.round(Number(n) || 0));
  var out = "";
  while (s.length > 3) { out = "." + s.slice(-3) + out; s = s.slice(0, -3); }
  return s + out;
}
function handleTelegram(update) {
  var msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return;
  var chatId = msg.chat.id;
  var text = String(msg.text || "").trim();
  if (!text) return;
  // Normalisasi perintah garis miring: "/stok@namabot bandeng" → "stok bandeng",
  // supaya bentuk bare ("stok bandeng") dan slash ("/stok bandeng") sama-sama cocok.
  if (text.charAt(0) === "/") {
    var sp = text.indexOf(" ");
    var kataPertama = (sp < 0 ? text : text.slice(0, sp)).toLowerCase();
    var at = kataPertama.indexOf("@");
    if (at >= 0) kataPertama = kataPertama.slice(0, at);
    text = kataPertama.slice(1) + (sp < 0 ? "" : text.slice(sp));
  }
  // Config belum diisi → diam saja, jangan bocorkan apa pun
  if (!getConfig("TELEGRAM_TOKEN") || !getConfig("TELEGRAM_CHAT_ID")) return;
  try {
    if (String(chatId) !== getConfig("TELEGRAM_CHAT_ID")) {
      telegramKirim(chatId, "Maaf, bot ini khusus Bos Teras Laut Cirebon.");
      return;
    }
    var low = text.toLowerCase();
    if (low === "start" || low === "/start" || low === "bantuan" || low === "help" || low === "?") {
      telegramKirim(chatId, "🐠 Bot Teras Laut Cirebon siap!\n\n" +
        "Tambah barang / kulakan — satu baris per barang:\n" +
        "nama, harga_beli, harga_jual, jumlah\n" +
        "contoh:\nAg Napoleon L, 18000, 25000, 20\n\n" +
        "• Nama yang sudah ada → stok & harga diperbarui (kulakan)\n" +
        "• Nama baru → barang baru dibuat\n" +
        "• jumlah boleh dikosongkan (dianggap 0)\n\n" +
        "Perintah lain:\n" +
        "stok <kata kunci> — cek stok barang\n" +
        "stokall — semua stok (dikirim beberapa pesan)\n" +
        "jual <nama>, <harga>, <jumlah> — catat penjualan (harga boleh dikosongkan; bisa banyak baris sekaligus)\n" +
        "mati <nama>, <jumlah> — catat kematian (jumlah boleh dikosongkan = 1; bisa banyak baris)\n" +
        "rekap — ringkasan hari ini");
      return;
    }
    if (low === "stok" || low.indexOf("stok ") === 0) {
      telegramKirim(chatId, telegramStok(text.slice(4).trim()));
      return;
    }
    if (low === "stokall") {
      telegramStokAll(chatId);
      return;
    }
    if (low === "jual" || low.indexOf("jual ") === 0) {
      telegramKirim(chatId, telegramJual(text.slice(4).trim()));
      return;
    }
    if (low === "mati" || low.indexOf("mati ") === 0) {
      telegramKirim(chatId, telegramMati(text.slice(4).trim()));
      return;
    }
    if (low === "rekap") {
      telegramKirim(chatId, telegramRekap());
      return;
    }
    telegramKirim(chatId, telegramInputBarang(text));
  } catch (err) {
    telegramKirim(chatId, "Terjadi kesalahan: " + err.message);
  }
}
function telegramCariBarang(kata) {
  var q = String(kata || "").toLowerCase();
  if (!q) return [];
  return barangRows().filter(function (b) {
    return (b.nama + " " + b.id).toLowerCase().indexOf(q) >= 0;
  });
}
function telegramStok(kata) {
  if (!kata) return "Tulis kata kuncinya, cth: stok bandeng";
  var cocok = telegramCariBarang(kata);
  if (!cocok.length) return "Tidak ketemu.";
  return cocok.slice(0, 10).map(function (b) {
    return b.nama + " (" + b.id + ") — stok: " + b.stok;
  }).join("\n");
}
// Semua stok yang tersedia, dikelompokkan per kategori (kata pertama nama),
// tanpa ID, nama ditebalkan — mode HTML. Telegram membatasi 4096 karakter per
// pesan; kirim bertahap per ~3500 karakter (flush hanya di antara baris).
function telegramStokAll(chatId) {
  var all = barangRows();
  var list = [];
  for (var j = 0; j < all.length; j++) if (all[j].stok > 0) list.push(all[j]);
  if (!list.length) { telegramKirim(chatId, "Semua barang stoknya kosong."); return; }
  var grup = {};
  var urut = [];
  for (var i = 0; i < list.length; i++) {
    var nama = list[i].nama.replace(/\s+/g, " ").trim();
    var kat = (nama.split(" ")[0] || "-").toUpperCase();
    if (!grup[kat]) { grup[kat] = []; urut.push(kat); }
    grup[kat].push({ nama: nama, stok: list[i].stok });
  }
  urut.sort();
  var lines = [];
  for (var k = 0; k < urut.length; k++) {
    var g = grup[urut[k]];
    g.sort(function (a, b) { return a.nama < b.nama ? -1 : a.nama > b.nama ? 1 : 0; });
    if (lines.length) lines.push(""); // baris kosong antar kategori
    lines.push("🐟 <b>" + escT(urut[k]) + "</b>");
    for (var m = 0; m < g.length; m++) {
      lines.push("• <b>" + escT(g[m].nama) + "</b> — " + g[m].stok);
    }
  }
  var chunk = "📦 <b>STOK TERSEDIA</b> (" + list.length + " jenis)";
  for (var n = 0; n < lines.length; n++) {
    if (chunk.length + lines[n].length + 1 > 3500) {
      telegramKirim(chatId, chunk, true);
      chunk = "…(lanjutan)";
    }
    chunk += "\n" + lines[n];
  }
  telegramKirim(chatId, chunk, true);
}
// "jual <nama>, <harga>, <jumlah>" — bisa BANYAK BARIS sekaligus:
// baris pertama memakai kata "jual", baris lanjutan cukup "nama, harga, jumlah"
// (awalan "jual " di baris lanjutan pun ditoleransi). Baris kosong dilewati.
// Tiap baris dicatat lewat catatTransaksi (jalur yang sama dengan aplikasi).
function telegramJual(isi) {
  var lines = isi.split("\n");
  var hasil = [], totalOk = 0, jumlahOk = 0;
  for (var i = 0; i < lines.length; i++) {
    var mentah = lines[i].trim();
    if (!mentah) continue; // baris kosong — lewati diam-diam
    if (mentah.toLowerCase().indexOf("jual ") === 0) mentah = mentah.slice(5).trim();
    if (!mentah) continue;
    var r = telegramJualBaris(mentah);
    hasil.push(r.pesan);
    if (r.ok) { totalOk += r.total; jumlahOk++; }
  }
  if (!hasil.length) {
    return "❌ Format: jual <nama barang>, <harga jual>, <jumlah>\n" +
      "contoh: jual bandeng, 35000, 2\n" +
      "(harga boleh dikosongkan: jual bandeng, 2 — pakai harga barang)\n" +
      "Bisa banyak baris sekaligus — satu barang per baris.";
  }
  var balas = hasil.join("\n");
  if (jumlahOk > 0) balas += "\n———\nTotal terjual: Rp " + ribuan(totalOk) + " (" + jumlahOk + " item)";
  return balas;
}
function telegramJualBaris(mentah) {
  var bagian = mentah.split(",");
  if (bagian.length < 2 || bagian.length > 3) {
    return { ok: false, pesan: "❌ " + mentah + " — format: nama, harga jual, jumlah (harga boleh dikosongkan)" };
  }
  var kata = bagian[0].trim();
  if (!kata) return { ok: false, pesan: "❌ " + mentah + " — nama barang kosong" };
  var harga, jumlah;
  if (bagian.length === 3) {
    harga = Number(String(bagian[1]).trim());
    jumlah = Math.floor(Number(String(bagian[2]).trim()));
    if (isNaN(harga) || harga < 0) return { ok: false, pesan: "❌ " + kata + " — harga jual harus angka nol atau lebih" };
  } else {
    jumlah = Math.floor(Number(String(bagian[1]).trim()));
  }
  if (!jumlah || jumlah <= 0) return { ok: false, pesan: "❌ " + kata + " — jumlah harus angka lebih dari nol" };
  var cocok = telegramCariBarang(kata);
  if (cocok.length === 0) return { ok: false, pesan: "❌ " + kata + " — tidak ketemu. Coba: stok " + kata };
  if (cocok.length > 1) {
    return { ok: false, pesan: "❌ " + kata + " — ambigu: " +
      cocok.slice(0, 5).map(function (b) { return b.nama; }).join(", ") };
  }
  var b = cocok[0];
  if (jumlah > b.stok) return { ok: false, pesan: "❌ " + b.nama + " — stok kurang (sisa " + b.stok + ")" };
  var p = { barang_id: b.id, jumlah: jumlah };
  if (harga !== undefined) p.harga_jual = harga;
  // Kunci per baris seperti jalur API (withLock) supaya tidak balapan dengan trigger lain
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, pesan: "❌ " + b.nama + " — server sibuk, coba lagi" };
  var r;
  try {
    r = catatTransaksi({ nama: "Telegram", peran: "bos" }, p, "jual");
  } finally {
    lock.releaseLock();
  }
  if (!r.ok) return { ok: false, pesan: "❌ " + b.nama + " — " + r.error };
  var hargaFinal = harga !== undefined ? harga : b.harga_jual;
  return { ok: true, total: jumlah * hargaFinal,
    pesan: "✅ " + b.nama + " ×" + jumlah + " — Rp " + ribuan(jumlah * hargaFinal) + " (sisa " + r.stok + ")" };
}

// "mati <nama>, <jumlah>" — bisa BANYAK BARIS (pola sama seperti /jual):
// baris lanjutan cukup "nama, jumlah"; awalan "mati " ditoleransi;
// jumlah boleh dikosongkan (dianggap 1). Baris kosong dilewati diam-diam.
function telegramMati(isi) {
  var lines = isi.split("\n");
  var hasil = [], totalEkor = 0, totalRugi = 0, jumlahOk = 0;
  for (var i = 0; i < lines.length; i++) {
    var mentah = lines[i].trim();
    if (!mentah) continue;
    if (mentah.toLowerCase().indexOf("mati ") === 0) mentah = mentah.slice(5).trim();
    if (!mentah) continue;
    var r = telegramMatiBaris(mentah);
    hasil.push(r.pesan);
    if (r.ok) { totalEkor += r.jumlah; totalRugi += r.rugi; jumlahOk++; }
  }
  if (!hasil.length) {
    return "❌ Format: mati <nama barang>, <jumlah>\n" +
      "contoh: mati bandeng, 2\n" +
      "(jumlah boleh dikosongkan — dianggap 1)\n" +
      "Bisa banyak baris sekaligus — satu barang per baris.";
  }
  var balas = hasil.join("\n");
  if (jumlahOk > 0) balas += "\n———\nTotal kematian: " + totalEkor + " ekor — kerugian Rp " + ribuan(totalRugi);
  return balas;
}
function telegramMatiBaris(mentah) {
  var bagian = mentah.split(",");
  if (bagian.length > 2) {
    return { ok: false, pesan: "❌ " + mentah + " — format: nama, jumlah (jumlah boleh dikosongkan)" };
  }
  var kata = bagian[0].trim();
  if (!kata) return { ok: false, pesan: "❌ " + mentah + " — nama barang kosong" };
  var jumlah = bagian.length === 2 ? Math.floor(Number(String(bagian[1]).trim())) : 1;
  if (!jumlah || jumlah <= 0) return { ok: false, pesan: "❌ " + kata + " — jumlah harus angka lebih dari nol" };
  var cocok = telegramCariBarang(kata);
  if (cocok.length === 0) return { ok: false, pesan: "❌ " + kata + " — tidak ketemu. Coba: stok " + kata };
  if (cocok.length > 1) {
    return { ok: false, pesan: "❌ " + kata + " — ambigu: " +
      cocok.slice(0, 5).map(function (b) { return b.nama; }).join(", ") };
  }
  var b = cocok[0];
  if (jumlah > b.stok) return { ok: false, pesan: "❌ " + b.nama + " — stok kurang (sisa " + b.stok + ")" };
  // Kunci per baris seperti jalur /jual supaya tidak balapan dengan trigger lain
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, pesan: "❌ " + b.nama + " — server sibuk, coba lagi" };
  var r;
  try {
    r = catatTransaksi({ nama: "Telegram", peran: "bos" }, { barang_id: b.id, jumlah: jumlah }, "mati");
  } finally {
    lock.releaseLock();
  }
  if (!r.ok) return { ok: false, pesan: "❌ " + b.nama + " — " + r.error };
  // Kerugian dihitung dari harga_belanja SAAT INI (modal terakhir)
  var rugi = jumlah * (Number(b.harga_belanja) || 0);
  return { ok: true, jumlah: jumlah, rugi: rugi,
    pesan: "✅ " + b.nama + " ×" + jumlah + " mati — kerugian Rp " + ribuan(rugi) + " (sisa " + r.stok + ")" };
}
function telegramRekap() {
  var tz = "Asia/Jakarta";
  var today = Utilities.formatDate(new Date(), tz, "yyyy/MM/dd");
  var r = rows("Transaksi");
  var jual = 0, mati = 0, omset = 0;
  for (var i = 0; i < r.length; i++) {
    if (!r[i][0]) continue;
    if (Utilities.formatDate(new Date(r[i][1]), tz, "yyyy/MM/dd") !== today) continue;
    var jumlah = Number(r[i][5]) || 0;
    if (String(r[i][2]) === "jual") { jual++; omset += jumlah * (Number(r[i][6]) || 0); }
    else if (String(r[i][2]) === "mati") { mati++; }
  }
  return "📊 Rekap " + Utilities.formatDate(new Date(), tz, "dd/MM/yyyy") + ":\n" +
    "🛒 Penjualan: " + jual + " transaksi — Rp " + ribuan(omset) + "\n" +
    "💀 Kematian: " + mati + " catatan";
}
// Setiap baris: "nama, harga_beli, harga_jual, jumlah" (jumlah opsional, default 0)
// Baris valid diproses, baris rusak dilaporkan — batch tidak dibatalkan.
function telegramInputBarang(text) {
  var lines = text.split("\n");
  var ok = [], gagal = [];
  for (var i = 0; i < lines.length; i++) {
    var mentah = lines[i].trim();
    if (!mentah) continue;
    var hasil = telegramProsesBaris(mentah);
    if (hasil.error) gagal.push("Baris " + (i + 1) + ": " + hasil.error + " (" + mentah + ")");
    else ok.push(hasil.pesan);
  }
  if (!ok.length && !gagal.length) return "Pesan kosong. Ketik bantuan untuk panduan.";
  var balas = "";
  if (ok.length) balas += "✅ Ditambahkan/diupdate:\n" + ok.join("\n");
  if (gagal.length) balas += (balas ? "\n\n" : "") + "⚠️ Baris gagal:\n" + gagal.join("\n");
  return balas;
}
function telegramProsesBaris(mentah) {
  var bagian = mentah.split(",");
  if (bagian.length < 3 || bagian.length > 4) {
    return { error: "salah format — pisahkan dengan KOMA, contoh: Payunga, 15000, 30000, 3" };
  }
  var nama = bagian[0].trim();
  var beli = Number(String(bagian[1]).trim());
  var jual = Number(String(bagian[2]).trim());
  var jumlah = bagian[3] === undefined ? 0 : Math.floor(Number(String(bagian[3]).trim()));
  if (!nama) return { error: "nama kosong" };
  if (isNaN(beli) || beli < 0 || isNaN(jual) || jual < 0) return { error: "harga harus angka nol atau lebih" };
  if (isNaN(jumlah) || jumlah < 0) return { error: "jumlah harus angka nol atau lebih" };
  var list = barangRows();
  var b = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].nama.toLowerCase() === nama.toLowerCase() || list[i].id.toLowerCase() === nama.toLowerCase()) { b = list[i]; break; }
  }
  if (b) {
    // Restok: harga selalu diperbarui; stok bertambah bila jumlah > 0
    sheet("Barang").getRange(b.row, 3).setValue(beli);
    sheet("Barang").getRange(b.row, 4).setValue(jual);
    if (jumlah > 0) {
      sheet("Barang").getRange(b.row, 5).setValue(b.stok + jumlah);
      catatPengeluaran({ nama: "Telegram" }, "kulakan", "Kulakan via Telegram: " + b.nama + " ×" + jumlah, jumlah * beli);
      return { pesan: b.nama + " — stok +" + jumlah + " → " + (b.stok + jumlah) };
    }
    return { pesan: b.nama + " — harga diperbarui (stok tetap " + b.stok + ")" };
  }
  var id = Utilities.getUuid();
  sheet("Barang").appendRow([id, nama, beli, jual, jumlah]);
  if (jumlah > 0 && beli > 0) {
    catatPengeluaran({ nama: "Telegram" }, "kulakan", "Stok awal: " + nama + " ×" + jumlah, jumlah * beli);
  }
  return { pesan: nama + " — barang baru (stok " + jumlah + ")" };
}

/* ---------------- Polling Telegram (webhook ditolak Google) ----------------
   Pasang lewat pemicu waktu: ⏰ Triggers → + Add Trigger → telegramPolling →
   Time-driven → Every minute. Offset disimpan di Config (TELEGRAM_OFFSET)
   supaya tidak ada pesan yang diproses dua kali. */
function telegramPolling() {
  try {
    var token = getConfig("TELEGRAM_TOKEN");
    if (!token || !getConfig("TELEGRAM_CHAT_ID")) return; // belum disetup → diam
    var offset = getConfig("TELEGRAM_OFFSET") || "0";
    var res = UrlFetchApp.fetch(
      "https://api.telegram.org/bot" + token + "/getUpdates?offset=" + encodeURIComponent(offset) + "&timeout=0&limit=20",
      { muteHttpExceptions: true }
    );
    var data;
    try {
      data = JSON.parse(res.getContentText());
    } catch (e) { return; }
    if (!data || !data.ok || !data.result) return;
    for (var i = 0; i < data.result.length; i++) {
      var upd = data.result[i];
      handleTelegram(upd); // bentuk update sama persis seperti webhook
      setConfig("TELEGRAM_OFFSET", String(upd.update_id + 1));
    }
  } catch (err) {
    // Fungsi ini jalan lewat trigger — cukup dicatat, jangan pernah melempar error
    Logger.log("telegramPolling gagal: " + err.message);
  }
}
