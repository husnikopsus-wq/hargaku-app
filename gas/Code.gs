/* =========================================================
   HargaKu Online — Backend Google Apps Script
   =========================================================
   CARA PAKAI (sekali saja, oleh Bos):

   1. Buka https://sheets.google.com → buat spreadsheet kosong
      → beri nama "HargaKu".
   2. Menu Ekstensi (Extensions) → Apps Script.
   3. Hapus semua isi editor, tempel SELURUH file ini, klik Simpan.
   4. Di atas editor, pilih fungsi "setup" lalu klik Run/Jalankan.
      - Pertama kali akan minta izin: pilih akun Google Anda →
        Advanced/Lanjutan → "Go to ... (unsafe)" → Allow/Izinkan.
   5. Lihat log (View → Logs / Ctrl+Enter): di situ ada APP_KEY
      yang dibuat otomatis (juga tersimpan di tab "Config").
   6. Klik Deploy → New deployment → ikon roda gigi → pilih
      "Web app":
        - Description      : bebas, misal "HargaKu v1"
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
  Transaksi: ["id", "waktu", "jenis", "barang_id", "nama_barang", "jumlah", "harga_jual", "harga_belanja", "admin"]
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
  var names = ["Config", "Users", "Barang", "Transaksi"];
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
    var a = auth(p);
    if (a.error) return out({ ok: false, error: a.error });
    var user = a.user;

    switch (action) {
      case "login":           return out({ ok: true, peran: user.peran });
      case "barang_list":     return out(barangList(user));
      case "jual":            return withLock(function () { return doJual(user, p); });
      case "mati":            return withLock(function () { return doMati(user, p); });
      case "barang_add":      return withLock(function () { return doBarangAdd(user, p); });
      case "barang_update":   return withLock(function () { return doBarangUpdate(user, p); });
      case "admin_add":       return withLock(function () { return doAdminAdd(user, p); });
      case "admin_delete":    return withLock(function () { return doAdminDelete(user, p); });
      case "admin_list":      return out(doAdminList(user));
      case "user_pin_change": return withLock(function () { return doPinChange(user, p); });
      case "riwayat":         return out(doRiwayat(user));
      case "laporan":         return out(doLaporan(user));
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
  var deny = needBos(user); if (deny) return deny;
  var v = validAngkaBarang(p);
  if (v.error) return { ok: false, error: v.error };
  var id = String(p.barang_id || "").trim();
  if (id) {
    if (findBarang(id)) return { ok: false, error: "ID barang sudah dipakai: " + id };
  } else {
    id = Utilities.getUuid();
  }
  sheet("Barang").appendRow([id, v.nama, v.belanja, v.jual, v.stok]);
  return { ok: true, id: id };
}
function doBarangUpdate(user, p) {
  var deny = needBos(user); if (deny) return deny;
  var b = findBarang(p.id || p.barang_id);
  if (!b) return { ok: false, error: "Barang tidak ditemukan." };
  var v = validAngkaBarang(p);
  if (v.error) return { ok: false, error: v.error };
  sheet("Barang").getRange(b.row, 1, 1, 5).setValues([[b.id, v.nama, v.belanja, v.jual, v.stok]]);
  return { ok: true };
}

/* ---------------- Transaksi (jual / mati) ---------------- */
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

  var stokBaru = b.stok - jumlah;
  sheet("Barang").getRange(b.row, 5).setValue(stokBaru);
  // harga_belanja & harga_jual disimpan sebagai snapshot saat transaksi
  var id = Utilities.getUuid();
  var waktu = new Date();
  sheet("Transaksi").appendRow([
    id, waktu, jenis, b.id, b.nama, jumlah, hargaJual, b.harga_belanja, user.nama
  ]);
  var tx = {
    id: id,
    waktu: Utilities.formatDate(waktu, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"),
    jenis: jenis,
    nama_barang: b.nama,
    jumlah: jumlah,
    harga_jual: hargaJual,
    admin: user.nama
  };
  // PENTING: admin tidak pernah menerima harga_belanja
  if (user.peran === "bos") tx.harga_belanja = b.harga_belanja;
  return { ok: true, stok: stokBaru, transaksi: tx };
}
function doJual(user, p) { return catatTransaksi(user, p, "jual"); }
function doMati(user, p) { return catatTransaksi(user, p, "mati"); }

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
      harga_jual: Number(r[i][6]) || 0
    };
    // PENTING: admin tidak pernah menerima harga_belanja
    if (user.peran === "bos") {
      row.harga_belanja = Number(r[i][7]) || 0;
      row.admin = adminNama;
    }
    list.push(row);
  }
  list.reverse(); // terbaru di atas
  return { ok: true, riwayat: list };
}

/* ---------------- Laporan (khusus Bos) ---------------- */
function doLaporan(user) {
  var deny = needBos(user); if (deny) return deny;
  var r = rows("Transaksi");
  var agg = {};
  var order = [];
  for (var i = 0; i < r.length; i++) {
    if (!r[i][0]) continue;
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
  return { ok: true, items: items, total_untung: totalUntung };
}
