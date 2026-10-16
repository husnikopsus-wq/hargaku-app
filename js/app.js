/* =========================================================
   HargaKu Online — Frontend
   Terhubung ke Google Sheet milik Bos lewat Apps Script.
   Role: BOS (lihat modal & untung) | ADMIN (jual & catat kematian)
   Toleran offline: daftar barang dicache, transaksi antre di outbox.
   ========================================================= */

const CFG_KEY = "hargaku_cfg_v2";
const SES_KEY = "hargaku_ses_v2";
const CACHE_KEY = "hargaku_cache_v2";
const OUTBOX_KEY = "hargaku_outbox_v2";

/* ---------------- Util ---------------- */
const rp = (n) =>
  "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(Number(n) || 0));
const num = (n) => new Intl.NumberFormat("id-ID").format(Number(n) || 0);
const pct = (n) =>
  (Math.round(Number(n) * 10) / 10).toFixed(1).replace(".", ",") + "%";
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
};

/* ---------------- Penyimpanan lokal ---------------- */
function getCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY)); } catch { return null; } }
function setCfg(c) { c ? localStorage.setItem(CFG_KEY, JSON.stringify(c)) : localStorage.removeItem(CFG_KEY); }
function getSes() { try { return JSON.parse(localStorage.getItem(SES_KEY)); } catch { return null; } }
function setSes(s) { s ? localStorage.setItem(SES_KEY, JSON.stringify(s)) : localStorage.removeItem(SES_KEY); }
function getCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch { return []; } }
function setCache(b) { BARANG = b; localStorage.setItem(CACHE_KEY, JSON.stringify(b)); }
function getOutbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch { return []; } }
function setOutbox(o) { localStorage.setItem(OUTBOX_KEY, JSON.stringify(o)); updatePill(); }

let BARANG = getCache();

/* ---------------- Panggil server (Google Apps Script) ---------------- */
async function api(action, params) {
  const cfg = getCfg(), ses = getSes();
  const body = Object.assign(
    { action, key: cfg ? cfg.key : "", nama: ses ? ses.nama : "", pin: ses ? ses.pin : "" },
    params || {}
  );
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error("Balasan server tidak valid. Periksa URL web app di Pengaturan.");
  }
  if (!json.ok) throw new Error(json.error || "Permintaan gagal.");
  return json;
}
async function pingCfg(cfg) {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "ping", key: cfg.key }),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error("Balasan server tidak valid — pastikan URL berakhiran /exec.");
  }
  if (!json.ok) throw new Error(json.error || "Konfigurasi tidak valid.");
  return true;
}
// Error jaringan (offline) berupa TypeError dari fetch — dipakai untuk bedakan
// "server menolak" vs "tidak ada koneksi".
const isNetError = (e) => e instanceof TypeError;

/* ---------------- Segarkan data & antrean offline ---------------- */
let lastRefresh = 0;
let refreshing = false;
async function refreshBarang(force) {
  if (!navigator.onLine || refreshing) return;
  if (!force && Date.now() - lastRefresh < 15000) return;
  refreshing = true;
  lastRefresh = Date.now();
  try {
    const j = await api("barang_list");
    setCache(j.barang || []);
    route();
  } catch (e) { /* pakai cache lokal */ }
  refreshing = false;
}
let flushing = false;
async function flushOutbox() {
  if (flushing || !navigator.onLine || !getSes()) return;
  if (getOutbox().length === 0) return;
  flushing = true;
  updatePill();
  try {
    while (getOutbox().length > 0) {
      const item = getOutbox()[0];
      try {
        await api(item.action, item.params);
        setOutbox(getOutbox().slice(1));
      } catch (e) {
        if (isNetError(e)) break; // masih offline — coba lagi nanti
        // Server menolak permanen (misal stok habis) — buang agar tidak nyangkut
        setOutbox(getOutbox().slice(1));
        toast("Satu catatan antrean gagal dikirim: " + e.message, true);
      }
    }
  } finally {
    flushing = false;
    lastRefresh = 0;
    await refreshBarang(true);
    updatePill();
  }
}
function queueMutation(action, params, barangId, jumlah) {
  const q = getOutbox();
  q.push({ action, params, at: Date.now() });
  setOutbox(q);
  // Kurangi stok di cache secara optimis supaya layar langsung masuk akal
  const b = BARANG.find((x) => x.id === barangId);
  if (b) { b.stok = Math.max(0, (Number(b.stok) || 0) - jumlah); setCache(BARANG.slice()); }
  toast("Koneksi terputus — catatan disimpan, menunggu sinkronisasi.");
}

/* ---------------- Toast & pil status ---------------- */
let toastTimer = null;
function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  el.classList.toggle("error", isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}
function updatePill() {
  const el = document.getElementById("pill");
  if (!el) return;
  if (!getSes() || !getCfg()) { el.className = "pill hidden"; return; }
  const n = getOutbox().length;
  if (!navigator.onLine) {
    el.className = "pill offline";
    el.innerHTML = "🔴 Offline" + (n > 0 ? ` · ${n} menunggu` : "");
  } else if (n > 0) {
    el.className = "pill pending";
    el.innerHTML = `🟡 ${n} menunggu sinkronisasi <button onclick="flushOutbox()">Sinkronkan</button>`;
  } else {
    el.className = "pill online";
    el.textContent = "🟢 Online";
  }
}
window.addEventListener("online", () => { updatePill(); flushOutbox(); });
window.addEventListener("offline", updatePill);

/* ---------------- Router ---------------- */
function route() {
  const hash = location.hash || "";
  const cfg = getCfg();
  if (!cfg) {
    if (hash !== "#/setup") { location.hash = "#/setup"; return; }
    return renderSetup();
  }
  const ses = getSes();
  if (!ses) {
    if (hash !== "#/login") { location.hash = "#/login"; return; }
    return renderLogin();
  }
  if (hash === "#/setup" || hash === "#/login" || hash === "") {
    location.hash = ses.peran === "bos" ? "#/bos" : "#/jual";
    return;
  }
  updatePill();
  refreshBarang(false);
  flushOutbox();
  if (ses.peran === "bos") renderBos(hash, ses);
  else renderAdmin(hash, ses);
}
window.addEventListener("hashchange", () => { lastNotaTx = null; route(); });

/* ---------------- Template bantu ---------------- */
const screen = () => document.getElementById("screen");
function setHTML(html) {
  screen().innerHTML = html;
  window.scrollTo(0, 0);
}
function headerHTML(title, sub) {
  return `
    <div class="header">
      <div class="row">
        <div>
          <h1>${esc(title)}</h1>
          <div class="sub">${esc(sub)}</div>
        </div>
      </div>
    </div>`;
}
function bottomNav(items, active) {
  return `
    <nav class="bottomnav">
      ${items.map((i) => `
        <button class="${i.hash === active ? "active" : ""}" onclick="location.hash='${i.hash}'">
          <span class="ic">${i.ic}</span>${i.label}
        </button>`).join("")}
    </nav>`;
}
function emptyState(ic, msg) {
  return `<div class="empty-state"><div class="big">${ic}</div>${esc(msg)}</div>`;
}
const BOS_NAV = [
  { hash: "#/bos", ic: "🏠", label: "Beranda" },
  { hash: "#/bos/barang", ic: "📦", label: "Barang" },
  { hash: "#/jual", ic: "🛒", label: "Jual" },
  { hash: "#/bos/laporan", ic: "📊", label: "Laporan" },
  { hash: "#/pengaturan", ic: "⚙️", label: "Atur" },
];
const ADMIN_NAV = [
  { hash: "#/jual", ic: "🛒", label: "Jual" },
  { hash: "#/mati", ic: "🐔", label: "Kematian" },
  { hash: "#/admin/stok", ic: "📦", label: "Stok" },
  { hash: "#/riwayat", ic: "🧾", label: "Riwayat" },
  { hash: "#/pengaturan", ic: "⚙️", label: "Atur" },
];
const navFor = (ses) => (ses.peran === "bos" ? BOS_NAV : ADMIN_NAV);
function logout() {
  const n = getOutbox().length;
  if (n > 0 && !confirm(`Masih ada ${n} catatan yang belum tersinkron. Keluar sekarang?`)) return;
  setSes(null);
  location.hash = "#/login";
}

/* =========================================================
   SETUP AWAL — tempel string konfigurasi URL|APP_KEY
   ========================================================= */
function renderSetup() {
  setHTML(`
    <div class="login-wrap">
      <div class="logo">
        <img src="img/logo-192.png" alt="Logo Teras Laut Cirebon" class="logo-img">
        <h1>JualanKu</h1>
        <p><b>Teras Laut Cirebon</b> — hubungkan aplikasi ini ke Google Sheet Bos Anda</p>
      </div>
      <div class="card">
        <h3>Konfigurasi pertama kali</h3>
        <p class="muted" style="margin-bottom:10px">
          Minta string konfigurasi ke Bos (bentuknya <b>URL|KUNCI</b>, biasanya dikirim lewat WhatsApp),
          lalu tempel di bawah ini.
        </p>
        <form onsubmit="saveSetup();return false">
        <div class="field">
          <label>String konfigurasi</label>
          <input id="cfg-string" placeholder="https://script.google.com/.../exec|kunci-rahasia" autocomplete="off">
        </div>
        <button class="btn" type="submit">Hubungkan</button>
        </form>
      </div>
      <p class="muted" style="text-align:center;font-size:.75rem">
        Bos: panduan lengkap ada di README.md bagian "Panduan Setup Sekali Saja".
      </p>
    </div>
  `);
}
async function saveSetup() {
  const raw = document.getElementById("cfg-string").value.trim();
  const parts = raw.split("|");
  if (parts.length !== 2 || !parts[0].startsWith("http") || !parts[1]) {
    toast("Format salah. Harus berbentuk URL|KUNCI.", true);
    return;
  }
  const cfg = { url: parts[0].trim(), key: parts[1].trim() };
  toast("Memeriksa koneksi...");
  try {
    await pingCfg(cfg);
  } catch (e) {
    if (isNetError(e)) toast("Tidak ada koneksi internet. Coba lagi.", true);
    else toast("Konfigurasi ditolak: " + e.message, true);
    return;
  }
  setCfg(cfg);
  toast("Tersambung! Silakan masuk.");
  location.hash = "#/login";
}

/* =========================================================
   LOGIN
   ========================================================= */
function renderLogin() {
  setHTML(`
    <div class="login-wrap">
      <div class="logo">
        <img src="img/logo-192.png" alt="Logo Teras Laut Cirebon" class="logo-img">
        <h1>JualanKu</h1>
        <p><b>Teras Laut Cirebon</b> — catat penjualan &amp; kematian, data langsung tersinkron</p>
      </div>
      <div class="card">
        <form onsubmit="doLogin();return false">
        <div class="field">
          <label>Nama</label>
          <input id="l-nama" placeholder="cth: Budi" autocomplete="username">
        </div>
        <div class="field">
          <label>PIN</label>
          <input id="l-pin" type="password" inputmode="numeric" maxlength="8"
            placeholder="Masukkan PIN" autocomplete="current-password">
        </div>
        <button class="btn" type="submit">Masuk</button>
        </form>
      </div>
      <p class="muted" style="text-align:center;font-size:.75rem">
        Salah HP? <a href="#" onclick="setCfg(null);setSes(null);location.hash='#/setup';return false;">Ganti konfigurasi</a>
      </p>
    </div>
  `);
}
async function doLogin() {
  const nama = document.getElementById("l-nama").value.trim();
  const pin = document.getElementById("l-pin").value.trim();
  if (!nama || !pin) { toast("Nama dan PIN wajib diisi.", true); return; }
  setSes({ nama, pin, peran: "" }); // sementara, untuk ditandatangani ke server
  try {
    const j = await api("login");
    setSes({ nama, pin, peran: j.peran });
    toast("Selamat datang, " + nama + "!");
    location.hash = j.peran === "bos" ? "#/bos" : "#/jual";
  } catch (e) {
    setSes(null);
    toast(isNetError(e) ? "Tidak ada koneksi internet. Login butuh koneksi." : e.message, true);
  }
}

/* =========================================================
   LAYAR BERSAMA: JUAL & KEMATIAN (Bos & Admin)
   ========================================================= */
let sellProductId = null;
let deathProductId = null;
let lastNotaTx = null; // transaksi terakhir berhasil — untuk tombol Cetak Nota

function renderJual(ses) {
  const available = BARANG.filter((p) => Number(p.stok) > 0);
  const p = available.find((x) => x.id === sellProductId) || null;
  setHTML(`
    ${headerHTML("Input Penjualan", "Stok berkurang otomatis setelah tersimpan")}
    <div class="content">
      ${lastNotaTx ? `
      <div class="card" style="border:1px solid var(--accent)">
        <div class="row-between">
          <div>
            <b>✅ Penjualan tersimpan</b><br>
            <span class="muted">${esc(lastNotaTx.nama_barang)} × ${num(lastNotaTx.jumlah)} — ${rp(lastNotaTx.jumlah * lastNotaTx.harga_jual)}</span>
          </div>
          <button class="btn" style="width:auto" onclick="cetakNotaTerakhir()">🖨️ Cetak Nota</button>
        </div>
      </div>` : ""}
      <div class="card">
        <form onsubmit="submitJual();return false">
        <div class="field">
          <label>Pilih barang / unggas</label>
          <select id="s-product" onchange="sellProductId=this.value;renderJual(getSes())">
            <option value="">— pilih barang —</option>
            ${available.map((x) => `<option value="${x.id}" ${x.id === sellProductId ? "selected" : ""}>${esc(x.nama)} (stok ${num(x.stok)})</option>`).join("")}
          </select>
          ${available.length === 0 ? `<div class="hint">Tidak ada barang berstok. Minta Bos menambah barang.</div>` : ""}
        </div>
        ${p ? `
          <div class="field">
            <label>Harga jual satuan</label>
            <input id="s-price" type="number" min="0" inputmode="numeric" value="${Number(p.harga_jual) || 0}"
              oninput="updateSellTotal()">
            <div class="hint">Boleh diubah per transaksi, misal untuk diskon.</div>
          </div>
          <div class="field">
            <label>Jumlah terjual</label>
            <input id="s-qty" type="number" min="1" max="${p.stok}" inputmode="numeric" value="1"
              oninput="updateSellTotal()">
          </div>
          <div class="card" style="background:var(--card2);margin-bottom:14px">
            <div class="row-between">
              <span class="muted">Total</span>
              <b id="s-total" style="font-size:1.1rem">${rp(p.harga_jual)}</b>
            </div>
          </div>
          <button class="btn" type="submit">✅ Simpan Penjualan</button>
        ` : ""}
        </form>
      </div>
      <button class="btn secondary" onclick="location.hash='#/mati'">🐔 Catat Kematian</button>
    </div>
    ${bottomNav(navFor(ses), "#/jual")}
  `);
}
function updateSellTotal() {
  const p = BARANG.find((x) => x.id === sellProductId);
  if (!p) return;
  const qty = Number(document.getElementById("s-qty").value) || 0;
  const price = Number(document.getElementById("s-price").value) || 0;
  const el = document.getElementById("s-total");
  if (el) el.textContent = rp(qty * price);
}
async function submitJual() {
  const p = BARANG.find((x) => x.id === sellProductId);
  if (!p) { toast("Pilih barang dulu.", true); return; }
  const jumlah = Number(document.getElementById("s-qty").value);
  const harga = Number(document.getElementById("s-price").value);
  if (!jumlah || jumlah <= 0) { toast("Jumlah terjual tidak valid.", true); return; }
  if (jumlah > p.stok) { toast("Stok tidak cukup (sisa " + num(p.stok) + ").", true); return; }
  if (isNaN(harga) || harga < 0) { toast("Harga jual tidak valid.", true); return; }
  const params = { barang_id: p.id, jumlah, harga_jual: harga };
  if (navigator.onLine) {
    try {
      const j = await api("jual", params);
      const b = BARANG.find((x) => x.id === p.id);
      if (b) b.stok = j.stok;
      setCache(BARANG.slice());
      lastNotaTx = j.transaksi || {
        nama_barang: p.nama, jumlah, harga_jual: harga,
        admin: (getSes() || {}).nama || "", waktu: "",
      };
      toast("Penjualan " + p.nama + " × " + jumlah + " tersimpan!");
      sellProductId = null;
      route();
      return;
    } catch (e) {
      if (!isNetError(e)) { toast(e.message, true); return; }
    }
  }
  queueMutation("jual", params, p.id, jumlah);
  sellProductId = null;
  route();
}
async function cetakNotaTerakhir() {
  if (!lastNotaTx) return;
  try {
    await printNota(lastNotaTx);
    toast("Nota dikirim ke printer.");
  } catch (e) {
    toast(e.message, true);
  }
}

function renderMati(ses) {
  const available = BARANG.filter((p) => Number(p.stok) > 0);
  const p = available.find((x) => x.id === deathProductId) || null;
  setHTML(`
    ${headerHTML("Catat Kematian", "Unggas yang mati mengurangi stok")}
    <div class="content">
      <div class="card">
        <form onsubmit="submitMati();return false">
        <div class="field">
          <label>Pilih barang / unggas</label>
          <select id="m-product" onchange="deathProductId=this.value;renderMati(getSes())">
            <option value="">— pilih barang —</option>
            ${available.map((x) => `<option value="${x.id}" ${x.id === deathProductId ? "selected" : ""}>${esc(x.nama)} (stok ${num(x.stok)})</option>`).join("")}
          </select>
          ${available.length === 0 ? `<div class="hint">Tidak ada barang berstok.</div>` : ""}
        </div>
        ${p ? `
          <div class="field">
            <label>Jumlah mati (ekor)</label>
            <input id="m-qty" type="number" min="1" max="${p.stok}" inputmode="numeric" value="1">
          </div>
          <button class="btn danger" type="submit">💀 Simpan Catatan Kematian</button>
        ` : ""}
        </form>
      </div>
    </div>
    ${bottomNav(navFor(ses), "#/mati")}
  `);
}
async function submitMati() {
  const p = BARANG.find((x) => x.id === deathProductId);
  if (!p) { toast("Pilih barang dulu.", true); return; }
  const jumlah = Number(document.getElementById("m-qty").value);
  if (!jumlah || jumlah <= 0) { toast("Jumlah mati tidak valid.", true); return; }
  if (jumlah > p.stok) { toast("Stok tidak cukup (sisa " + num(p.stok) + ").", true); return; }
  if (!confirm(`Catat ${jumlah} ekor ${p.nama} mati?`)) return;
  const params = { barang_id: p.id, jumlah };
  if (navigator.onLine) {
    try {
      const j = await api("mati", params);
      const b = BARANG.find((x) => x.id === p.id);
      if (b) b.stok = j.stok;
      setCache(BARANG.slice());
      toast("Kematian " + p.nama + " × " + jumlah + " tercatat.");
      deathProductId = null;
      route();
      return;
    } catch (e) {
      if (!isNetError(e)) { toast(e.message, true); return; }
    }
  }
  queueMutation("mati", params, p.id, jumlah);
  deathProductId = null;
  route();
}

/* =========================================================
   RIWAYAT (Bos: semua; Admin: miliknya sendiri)
   ========================================================= */
async function renderRiwayat(ses) {
  setHTML(`
    ${headerHTML("Riwayat Transaksi", ses.peran === "bos" ? "Semua penjualan & kematian" : "Hanya transaksi yang Anda input")}
    <div class="content"><div class="empty-state"><div class="big">⏳</div>Memuat riwayat...</div></div>
    ${bottomNav(navFor(ses), "#/riwayat")}
  `);
  let list = [];
  try {
    const j = await api("riwayat");
    list = j.riwayat || [];
  } catch (e) {
    screen().querySelector(".content").innerHTML =
      emptyState("📡", isNetError(e) ? "Butuh koneksi untuk memuat riwayat." : e.message);
    return;
  }
  const isBos = ses.peran === "bos";
  RIWAYAT_LAST = list;
  screen().querySelector(".content").innerHTML = list.length === 0
    ? emptyState("🧾", "Belum ada transaksi.")
    : `<div class="list">${list.map((t) => `
        <div class="item">
          <div class="info">
            <div class="name">
              ${esc(t.nama_barang)} <span class="badge">× ${num(t.jumlah)}</span>
              <span class="badge ${t.jenis === "mati" ? "danger" : ""}">${t.jenis === "mati" ? "💀 Mati" : "Terjual"}</span>
            </div>
            <div class="meta">
              ${fmtDate(t.waktu)}
              ${isBos && t.admin ? `<br>🙋 ${esc(t.admin)}` : ""}
              ${isBos && t.jenis === "mati" ? `<br>Kerugian ${rp(t.jumlah * (t.harga_belanja || 0))}` : ""}
            </div>
          </div>
          <div class="right">
            ${t.jenis === "jual"
              ? `<div class="price">${rp(t.jumlah * t.harga_jual)}</div><div class="meta">${rp(t.harga_jual)}/unit</div>
                 <button class="btn small secondary" style="margin-top:6px" onclick="cetakNotaRiwayat('${t.id}')">🖨️</button>`
              : `<div class="meta">—</div>`}
          </div>
        </div>`).join("")}
      </div>`;
}
let RIWAYAT_LAST = [];
async function cetakNotaRiwayat(id) {
  const t = RIWAYAT_LAST.find((x) => x.id === id);
  if (!t) return;
  try {
    await printNota({
      nama_barang: t.nama_barang,
      jumlah: t.jumlah,
      harga_jual: t.harga_jual,
      admin: t.admin || (getSes() || {}).nama || "",
      waktu: t.waktu,
    });
    toast("Nota dikirim ke printer.");
  } catch (e) {
    toast(e.message, true);
  }
}

/* =========================================================
   PENGATURAN (Bos & Admin)
   ========================================================= */
function renderPengaturan(ses) {
  const cfg = getCfg();
  setHTML(`
    ${headerHTML("Pengaturan", "Masuk sebagai " + ses.nama + " (" + (ses.peran === "bos" ? "Bos" : "Admin") + ")")}
    <div class="content">
      <div class="card">
        <h3>🔑 Ganti PIN saya</h3>
        <form onsubmit="gantiPinSendiri();return false">
        <div class="field">
          <label>PIN baru (4–8 digit)</label>
          <input id="p-pin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN baru">
        </div>
        <button class="btn" type="submit">Simpan PIN Baru</button>
        </form>
      </div>
      <div class="card">
        <h3>🔗 Konfigurasi koneksi</h3>
        <div class="field">
          <label>String konfigurasi (URL|KUNCI)</label>
          <input id="p-cfg" value="${esc(cfg.url + "|" + cfg.key)}" autocomplete="off">
          <div class="hint">Ubah hanya jika Bos meminta (misal APP_KEY diganti). Menyimpan akan memeriksa koneksi dulu.</div>
        </div>
        <button class="btn secondary" onclick="ubahKonfigurasi()">Simpan Konfigurasi</button>
      </div>
      <div class="card">
        <h3>🖨️ Printer Bluetooth</h3>
        <div class="muted" id="printer-status" style="margin-bottom:10px">${printerStatusHTML()}</div>
        <button class="btn secondary" onclick="hubungkanPrinter()">Hubungkan Printer</button>
        <div class="hint">Untuk printer thermal kasir 58mm. Membutuhkan Chrome di Android.</div>
      </div>
      ${ses.peran === "bos" ? `
      <div class="card">
        <h3>🙋 Manajemen</h3>
        <div class="btn-row">
          <button class="btn secondary" onclick="location.hash='#/bos/admin'">Kelola Admin</button>
          <button class="btn secondary" onclick="location.hash='#/riwayat'">Riwayat</button>
        </div>
      </div>` : ""}
      <button class="btn danger" onclick="logout()">Keluar</button>
    </div>
    ${bottomNav(navFor(ses), "#/pengaturan")}
  `);
}
async function gantiPinSendiri() {
  const pin = document.getElementById("p-pin").value.trim();
  if (!/^\d{4,8}$/.test(pin)) { toast("PIN harus 4–8 digit angka.", true); return; }
  try {
    await api("user_pin_change", { new_pin: pin });
    const ses = getSes();
    ses.pin = pin;
    setSes(ses);
    toast("PIN Anda berhasil diganti.");
    renderPengaturan(ses);
  } catch (e) {
    toast(isNetError(e) ? "Butuh koneksi untuk ganti PIN." : e.message, true);
  }
}
async function ubahKonfigurasi() {
  const raw = document.getElementById("p-cfg").value.trim();
  const parts = raw.split("|");
  if (parts.length !== 2 || !parts[0].startsWith("http") || !parts[1]) {
    toast("Format salah. Harus berbentuk URL|KUNCI.", true);
    return;
  }
  const cfg = { url: parts[0].trim(), key: parts[1].trim() };
  try {
    await pingCfg(cfg);
  } catch (e) {
    toast(isNetError(e) ? "Tidak ada koneksi internet." : "Konfigurasi ditolak: " + e.message, true);
    return;
  }
  setCfg(cfg);
  toast("Konfigurasi diperbarui.");
}
function printerStatusHTML() {
  if (typeof printerStatus !== "function") return "Modul printer belum termuat.";
  const st = printerStatus();
  if (!st.tersedia) return "Bluetooth tidak tersedia di browser ini.";
  return st.terhubung ? "Terhubung: " + esc(st.nama) : "Belum terhubung.";
}
async function hubungkanPrinter() {
  try {
    const st = await printerConnect();
    toast("Printer terhubung: " + (st.nama || "printer"));
  } catch (e) {
    toast(e.message, true);
  }
  const el = document.getElementById("printer-status");
  if (el) el.textContent = printerStatusHTML();
}

/* =========================================================
   BOS
   ========================================================= */
function renderBos(hash, ses) {
  if (hash === "#/bos") return bosHome(ses);
  if (hash === "#/bos/barang") return bosBarang(ses);
  if (hash.startsWith("#/bos/barang-form")) return bosBarangForm(ses, hash);
  if (hash === "#/jual") return renderJual(ses);
  if (hash === "#/mati") return renderMati(ses);
  if (hash === "#/bos/admin") return bosAdmin(ses);
  if (hash === "#/bos/laporan") return bosLaporan(ses);
  if (hash === "#/riwayat") return renderRiwayat(ses);
  if (hash === "#/pengaturan") return renderPengaturan(ses);
  location.hash = "#/bos";
}

function bosHome(ses) {
  setHTML(`
    ${headerHTML("Dasbor Bos", "Halo, " + ses.nama + " — ringkasan seluruh usaha")}
    <div class="content">
      <div class="stats" id="home-stats">
        <div class="stat"><div class="label">Omset</div><div class="value teal">…</div></div>
        <div class="stat"><div class="label">Kerugian (kematian)</div><div class="value amber">…</div></div>
        <div class="stat"><div class="label">Total Untung</div><div class="value green">…</div></div>
        <div class="stat"><div class="label">Total barang</div><div class="value">${num(BARANG.length)}</div></div>
      </div>
      <div class="btn-row">
        <button class="btn" onclick="location.hash='#/jual'">🛒 Jual</button>
        <button class="btn danger" onclick="location.hash='#/mati'">🐔 Kematian</button>
      </div>
      <div class="btn-row">
        <button class="btn secondary" onclick="location.hash='#/bos/admin'">🙋 Kelola Admin</button>
        <button class="btn secondary" onclick="location.hash='#/riwayat'">🧾 Riwayat</button>
      </div>
      <div class="card" id="home-low">
        <h3>⚠️ Stok menipis (≤ 5)</h3>
        ${lowStockHTML()}
      </div>
    </div>
    ${bottomNav(BOS_NAV, "#/bos")}
  `);
  api("laporan").then((j) => {
    const el = document.getElementById("home-stats");
    if (!el) return;
    const omset = (j.items || []).reduce((a, x) => a + x.omset, 0);
    const kerugian = (j.items || []).reduce((a, x) => a + x.kerugian, 0);
    el.innerHTML = `
      <div class="stat"><div class="label">Omset</div><div class="value teal">${rp(omset)}</div></div>
      <div class="stat"><div class="label">Kerugian (kematian)</div><div class="value amber">${rp(kerugian)}</div></div>
      <div class="stat"><div class="label">Total Untung</div><div class="value green">${rp(j.total_untung || 0)}</div></div>
      <div class="stat"><div class="label">Total barang</div><div class="value">${num(BARANG.length)}</div></div>`;
  }).catch(() => {
    const el = document.getElementById("home-stats");
    if (el) el.innerHTML = `<div class="stat" style="grid-column:1/-1"><div class="label">Ringkasan</div><div class="value" style="font-size:.85rem">Butuh koneksi untuk memuat ringkasan.</div></div>`;
  });
}
function lowStockHTML() {
  const low = BARANG.filter((p) => Number(p.stok) <= 5);
  if (low.length === 0) return `<div class="muted">Semua stok aman. 👍</div>`;
  return `<div class="list">${low.map((p) => `
    <div class="item">
      <div class="info"><div class="name">${esc(p.nama)}</div></div>
      <div class="right"><div class="stock ${p.stok === 0 ? "empty" : "low"}">Sisa ${num(p.stok)}</div></div>
    </div>`).join("")}
  </div>`;
}

/* ---------- Barang (Bos) ---------- */
let barangSearch = "";
function bosBarang(ses) {
  setHTML(`
    ${headerHTML("Data Barang", "Harga belanja hanya terlihat oleh Bos")}
    <div class="content">
      <input class="search-input" placeholder="🔍 Cari barang..." value="${esc(barangSearch)}"
        oninput="barangSearch=this.value;refreshBarangList()">
      <button class="btn" onclick="location.hash='#/bos/barang-form'">＋ Tambah Barang</button>
      <div id="barang-list">${barangListHTML()}</div>
    </div>
    ${bottomNav(BOS_NAV, "#/bos/barang")}
  `);
}
function refreshBarangList() {
  const el = document.getElementById("barang-list");
  if (el) el.innerHTML = barangListHTML();
}
function barangListHTML() {
  const q = barangSearch.toLowerCase();
  const list = BARANG.filter((p) => p.nama.toLowerCase().includes(q));
  if (list.length === 0) return emptyState("📦", "Belum ada barang. Tambahkan barang pertama Anda!");
  return `<div class="list">${list.map((p) => `
    <div class="item">
      <div class="info">
        <div class="name">${esc(p.nama)}</div>
        <div class="meta">
          Modal ${rp(p.harga_belanja)} • Jual ${rp(p.harga_jual)}<br>
          Untung/unit ${rp(p.harga_jual - p.harga_belanja)}
        </div>
      </div>
      <div class="right">
        <div class="stock ${p.stok === 0 ? "empty" : p.stok <= 5 ? "low" : ""}">Stok ${num(p.stok)}</div>
        <div style="margin-top:6px">
          <button class="btn small secondary" onclick="location.hash='#/bos/barang-form?id=${p.id}'">Edit</button>
        </div>
      </div>
    </div>`).join("")}
  </div>`;
}
function bosBarangForm(ses, hash) {
  const id = new URLSearchParams(hash.split("?")[1] || "").get("id");
  const p = id ? BARANG.find((x) => x.id === id) : null;
  setHTML(`
    ${headerHTML(p ? "Edit Barang" : "Tambah Barang", "Lengkapi harga modal & harga jual")}
    <div class="content">
      <div class="card">
        <form onsubmit="simpanBarang('${p ? p.id : ""}');return false">
        <div class="field">
          <label>Nama barang</label>
          <input id="f-nama" value="${esc(p ? p.nama : "")}" placeholder="cth: Ayam Broiler">
        </div>
        <div class="field">
          <label>Harga belanja (modal) — rahasia, hanya Bos</label>
          <input id="f-belanja" type="number" min="0" inputmode="numeric"
            value="${p ? Number(p.harga_belanja) : ""}" placeholder="cth: 25000">
        </div>
        <div class="field">
          <label>Harga jual</label>
          <input id="f-jual" type="number" min="0" inputmode="numeric"
            value="${p ? Number(p.harga_jual) : ""}" placeholder="cth: 35000">
        </div>
        <div class="field">
          <label>Stok</label>
          <input id="f-stok" type="number" min="0" inputmode="numeric"
            value="${p ? Number(p.stok) : ""}" placeholder="cth: 100">
        </div>
        <div class="btn-row">
          <button class="btn secondary" type="button" onclick="history.back()">Batal</button>
          <button class="btn" type="submit">Simpan</button>
        </div>
        </form>
      </div>
    </div>
  `);
}
async function simpanBarang(id) {
  const params = {
    barang_nama: document.getElementById("f-nama").value.trim(),
    harga_belanja: Number(document.getElementById("f-belanja").value),
    harga_jual: Number(document.getElementById("f-jual").value),
    stok: Number(document.getElementById("f-stok").value),
  };
  if (!params.barang_nama) { toast("Nama barang wajib diisi.", true); return; }
  if (isNaN(params.harga_belanja) || isNaN(params.harga_jual) || isNaN(params.stok)) {
    toast("Harga & stok harus angka.", true); return;
  }
  if (!navigator.onLine) { toast("Kelola barang butuh koneksi internet.", true); return; }
  try {
    if (id) await api("barang_update", Object.assign({ id }, params));
    else await api("barang_add", params);
    toast(id ? "Barang diperbarui." : "Barang ditambahkan.");
    lastRefresh = 0;
    await refreshBarang(true);
    location.hash = "#/bos/barang";
  } catch (e) {
    toast(isNetError(e) ? "Tidak ada koneksi internet." : e.message, true);
  }
}

/* ---------- Kelola Admin (Bos) ---------- */
async function bosAdmin(ses) {
  setHTML(`
    ${headerHTML("Kelola Admin", "Admin bisa input penjualan & kematian, tanpa lihat modal")}
    <div class="content">
      <div class="card">
        <h3>＋ Tambah Admin</h3>
        <form onsubmit="tambahAdmin();return false">
        <div class="field">
          <label>Nama admin</label>
          <input id="a-nama" placeholder="cth: Budi">
        </div>
        <div class="field">
          <label>PIN (4–8 digit)</label>
          <input id="a-pin" type="password" inputmode="numeric" maxlength="8" placeholder="cth: 5678">
        </div>
        <button class="btn" type="submit">Simpan Admin</button>
        </form>
      </div>
      <div class="card" id="admin-list-card">
        <h3>Daftar pengguna</h3>
        <div class="muted">Memuat...</div>
      </div>
    </div>
    ${bottomNav(BOS_NAV, "#/bos")}
  `);
  try {
    const j = await api("admin_list");
    const el = document.getElementById("admin-list-card");
    if (!el) return;
    el.innerHTML = `
      <h3>Daftar pengguna</h3>
      <div class="list">${(j.users || []).map((u) => `
        <div class="item">
          <div class="info">
            <div class="name">${u.peran === "bos" ? "👑" : "🙋"} ${esc(u.nama)}</div>
            <div class="meta">${u.peran === "bos" ? "Bos — akses penuh" : "Admin — input jual & kematian"}</div>
          </div>
          <div class="right">
            <button class="btn small secondary" onclick="gantiPinUser('${esc(u.nama)}')">Ganti PIN</button>
            ${u.peran !== "bos" ? `
            <button class="btn small danger" style="margin-top:6px" onclick="hapusAdmin('${esc(u.nama)}')">Hapus</button>` : ""}
          </div>
        </div>`).join("")}
      </div>`;
  } catch (e) {
    const el = document.getElementById("admin-list-card");
    if (el) el.innerHTML = `<h3>Daftar pengguna</h3><div class="muted">${esc(isNetError(e) ? "Butuh koneksi untuk memuat." : e.message)}</div>`;
  }
}
async function tambahAdmin() {
  const nama = document.getElementById("a-nama").value.trim();
  const pin = document.getElementById("a-pin").value.trim();
  if (!nama) { toast("Nama admin wajib diisi.", true); return; }
  if (!/^\d{4,8}$/.test(pin)) { toast("PIN harus 4–8 digit angka.", true); return; }
  if (!navigator.onLine) { toast("Tambah admin butuh koneksi internet.", true); return; }
  try {
    await api("admin_add", { admin_nama: nama, admin_pin: pin });
    toast("Admin " + nama + " ditambahkan.");
    bosAdmin(getSes());
  } catch (e) {
    toast(isNetError(e) ? "Tidak ada koneksi internet." : e.message, true);
  }
}
async function hapusAdmin(nama) {
  if (!navigator.onLine) { toast("Hapus admin butuh koneksi internet.", true); return; }
  if (!confirm("Hapus admin " + nama + "? Riwayat transaksinya tetap tersimpan.")) return;
  try {
    await api("admin_delete", { target_nama: nama });
    toast("Admin " + nama + " dihapus.");
    bosAdmin(getSes());
  } catch (e) {
    toast(isNetError(e) ? "Tidak ada koneksi internet." : e.message, true);
  }
}
async function gantiPinUser(nama) {
  const pin = prompt("PIN baru untuk " + nama + " (4–8 digit angka):");
  if (pin === null) return;
  if (!/^\d{4,8}$/.test(pin.trim())) { toast("PIN harus 4–8 digit angka.", true); return; }
  try {
    await api("user_pin_change", { target_nama: nama, new_pin: pin.trim() });
    toast("PIN " + nama + " diganti.");
  } catch (e) {
    toast(isNetError(e) ? "Butuh koneksi untuk ganti PIN." : e.message, true);
  }
}

/* ---------- Laporan (Bos) ---------- */
async function bosLaporan(ses) {
  setHTML(`
    ${headerHTML("Laporan", "Omset, kematian, kerugian, dan untung per produk")}
    <div class="content"><div class="empty-state"><div class="big">⏳</div>Memuat laporan...</div></div>
    ${bottomNav(BOS_NAV, "#/bos/laporan")}
  `);
  let j;
  try {
    j = await api("laporan");
  } catch (e) {
    screen().querySelector(".content").innerHTML =
      emptyState("📡", isNetError(e) ? "Butuh koneksi untuk memuat laporan." : e.message);
    return;
  }
  const items = j.items || [];
  if (items.length === 0) {
    screen().querySelector(".content").innerHTML = emptyState("📊", "Belum ada transaksi sama sekali.");
    return;
  }
  const totalOmset = items.reduce((a, x) => a + x.omset, 0);
  const totalKerugian = items.reduce((a, x) => a + x.kerugian, 0);
  screen().querySelector(".content").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">Omset</div><div class="value teal">${rp(totalOmset)}</div></div>
      <div class="stat"><div class="label">Kerugian</div><div class="value amber">${rp(totalKerugian)}</div></div>
      <div class="stat" style="grid-column:1/-1"><div class="label">Total Untung</div><div class="value green">${rp(j.total_untung || 0)}</div></div>
    </div>
    <div class="card">
      <h3>Per produk</h3>
      <div class="table-wrap">
        <table class="report-table">
          <thead>
            <tr><th>Produk</th><th>Terjual</th><th>Mati</th><th>%Mati</th><th>Omset</th><th>Kerugian</th><th>Profit</th></tr>
          </thead>
          <tbody>
            ${items.map((x) => `
              <tr>
                <td>${esc(x.nama)}</td>
                <td>${num(x.terjual)}</td>
                <td>${num(x.mati)}</td>
                <td>${pct(x.persen_mati)}</td>
                <td>${rp(x.omset)}</td>
                <td>${rp(x.kerugian)}</td>
                <td class="${x.profit < 0 ? "profit-neg" : "profit-pos"}">${rp(x.profit)}</td>
              </tr>`).join("")}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="6"><b>Total Untung</b></td>
              <td class="${j.total_untung < 0 ? "profit-neg" : "profit-pos"}"><b>${rp(j.total_untung || 0)}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="hint" style="margin-top:8px">Profit = Omset − modal barang terjual − kerugian kematian. Sisa stok bukan kerugian.</div>
    </div>
  `;
}

/* =========================================================
   ADMIN
   ========================================================= */
function renderAdmin(hash, ses) {
  if (hash === "#/jual") return renderJual(ses);
  if (hash === "#/mati") return renderMati(ses);
  if (hash === "#/admin/stok") return adminStok(ses);
  if (hash === "#/riwayat") return renderRiwayat(ses);
  if (hash === "#/pengaturan") return renderPengaturan(ses);
  location.hash = "#/jual";
}
let stokSearch = "";
function adminStok(ses) {
  setHTML(`
    ${headerHTML("Stok Barang", "Harga jual & stok — tanpa harga modal")}
    <div class="content">
      <input class="search-input" placeholder="🔍 Cari barang..." value="${esc(stokSearch)}"
        oninput="stokSearch=this.value;refreshStokList()">
      <div id="stok-list">${stokListHTML()}</div>
    </div>
    ${bottomNav(ADMIN_NAV, "#/admin/stok")}
  `);
}
function refreshStokList() {
  const el = document.getElementById("stok-list");
  if (el) el.innerHTML = stokListHTML();
}
function stokListHTML() {
  const q = stokSearch.toLowerCase();
  const list = BARANG.filter((p) => p.nama.toLowerCase().includes(q));
  if (list.length === 0) return emptyState("📦", "Belum ada barang.");
  return `<div class="list">${list.map((p) => `
    <div class="item">
      <div class="info">
        <div class="name">${esc(p.nama)}</div>
        <div class="meta">Harga jual ${rp(p.harga_jual)}</div>
      </div>
      <div class="right">
        <div class="stock ${p.stok === 0 ? "empty" : p.stok <= 5 ? "low" : ""}">${p.stok === 0 ? "Habis" : "Stok " + num(p.stok)}</div>
      </div>
    </div>`).join("")}
  </div>`;
}

/* =========================================================
   PWA — service worker agar shell aplikasi tetap ter-cache
   ========================================================= */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ---------------- Start ---------------- */
updatePill();
route();
