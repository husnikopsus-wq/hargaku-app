/* =========================================================
   JualanKu — Printer Bluetooth thermal (ESC/POS 58mm)
   Dimuat setelah app.js. Semua fungsi aman dipanggil walau
   browser tidak mendukung Web Bluetooth (misal bukan Chrome
   Android) — pencetakan jatuh ke jendela cetak biasa.
   ========================================================= */

const PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000ae00-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "battery_service",
  "device_information",
];
// Karakteristik tulis khas printer thermal murah (ff02/ff01/ae01/ffe1)
const PRINTER_CHAR_PREF = ["0000ff02", "0000ff01", "0000ae01", "0000ffe1"];

let printerDevice = null;
let printerChar = null;

function printerTersedia() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}
function printerStatus() {
  return {
    tersedia: printerTersedia(),
    terhubung: !!(printerDevice && printerDevice.gatt && printerDevice.gatt.connected && printerChar),
    nama: printerDevice ? printerDevice.name || "printer" : "",
  };
}
async function printerConnect() {
  if (!printerTersedia()) {
    throw new Error("Bluetooth tidak tersedia di browser ini — gunakan Chrome di Android.");
  }
  // Coba sambung ulang perangkat yang pernah diizinkan, tanpa membuka picker
  if (!printerDevice && navigator.bluetooth.getDevices) {
    try {
      const known = await navigator.bluetooth.getDevices();
      if (known.length > 0) printerDevice = known[0];
    } catch (e) { /* abaikan — lanjut buka picker */ }
  }
  if (!printerDevice) {
    try {
      printerDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICES,
      });
    } catch (e) {
      throw new Error("Printer tidak ditemukan / tidak mendukung.");
    }
  }
  printerDevice.ongattserverdisconnected = () => { printerChar = null; };
  try {
    const server = await printerDevice.gatt.connect();
    const services = await server.getPrimaryServices();
    let chosen = null, fallback = null;
    outer:
    for (const svc of services) {
      let chars;
      try { chars = await svc.getCharacteristics(); } catch (e) { continue; }
      for (const ch of chars) {
        if (!ch.properties.write && !ch.properties.writeWithoutResponse) continue;
        if (!fallback) fallback = ch;
        if (PRINTER_CHAR_PREF.some((pf) => ch.uuid.toLowerCase().indexOf(pf) === 0)) {
          chosen = ch;
          break outer;
        }
      }
    }
    printerChar = chosen || fallback;
    if (!printerChar) throw new Error("Printer tidak ditemukan / tidak mendukung.");
  } catch (e) {
    if (e && e.message && e.message.indexOf("Printer") === 0) throw e;
    throw new Error("Gagal menyambung ke printer — pastikan printer nyala dan tidak dipakai aplikasi lain.");
  }
  return printerStatus();
}

/* ---------------- Susun byte ESC/POS ---------------- */
const ENC = new TextEncoder();
const NOTA_WIDTH = 31; // kolom aman — sebagian printer 58mm tidak memakai 32 kolom penuh

function notaLine(txt) { return ENC.encode(String(txt) + "\n"); }
function notaGabung(parts) {
  let n = 0;
  parts.forEach((p) => { n += p.length; });
  const out = new Uint8Array(n);
  let o = 0;
  parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
}
// Baris "kiri … kanan" dengan kanan berakhir TEPAT di kolom NOTA_WIDTH.
// Bila tidak muat, nominal turun ke baris sendiri yang rata kanan.
function notaBarisNilai(kiri, kanan) {
  const l = String(kiri), r = String(kanan);
  const lines = [];
  const sp = NOTA_WIDTH - l.length - r.length;
  if (sp >= 1) {
    lines.push(l + " ".repeat(sp) + r);
  } else {
    lines.push(l.slice(0, NOTA_WIDTH));
    lines.push(r.length >= NOTA_WIDTH ? r.slice(r.length - NOTA_WIDTH) : " ".repeat(NOTA_WIDTH - r.length) + r);
  }
  return lines;
}
// Label meta rata: "Waktu   : ", "Kasir   : ", "Pembeli : " — titik dua sejajar
function notaMeta(label, val) {
  return (String(label) + "        ").slice(0, 8) + ": " + val;
}
function notaWaktu(w) {
  const s = String(w || "");
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s; // sudah "dd/MM/yyyy HH:mm" dari server
  const d = s ? new Date(s) : new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  if (isNaN(d)) return s;
  return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear() +
    " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
}
// Terima dua bentuk: transaksi tunggal {nama_barang, jumlah, harga_jual, ...}
// atau nota multi-item {pembeli, waktu, admin, items:[...], total}
function notaNormal(tx) {
  if (tx && Array.isArray(tx.items)) {
    const items = tx.items.map((it) => ({
      nama_barang: it.nama_barang,
      jumlah: Number(it.jumlah) || 0,
      harga_jual: Number(it.harga_jual) || 0,
      subtotal: it.subtotal !== undefined ? Number(it.subtotal) : (Number(it.jumlah) || 0) * (Number(it.harga_jual) || 0),
    }));
    return {
      items: items,
      total: tx.total !== undefined ? Number(tx.total) : items.reduce((a, x) => a + x.subtotal, 0),
      admin: tx.admin, waktu: tx.waktu, pembeli: tx.pembeli,
    };
  }
  const jml = Number(tx.jumlah) || 0;
  const hrg = Number(tx.harga_jual) || 0;
  return {
    items: [{ nama_barang: tx.nama_barang, jumlah: jml, harga_jual: hrg, subtotal: jml * hrg }],
    total: jml * hrg,
    admin: tx.admin, waktu: tx.waktu, pembeli: tx.pembeli,
  };
}
function notaBytes(tx) {
  const ESC = 0x1b, GS = 0x1d;
  const n = notaNormal(tx);
  const dash = "-".repeat(NOTA_WIDTH);
  const parts = [
    new Uint8Array([ESC, 0x40]),                          // init
    new Uint8Array([ESC, 0x61, 0x01]),                    // rata tengah
    new Uint8Array([GS, 0x21, 0x11, ESC, 0x45, 0x01]),    // ukuran ganda + tebal
    // Nama toko 2 baris — ukuran ganda = maks 15 karakter per baris (width 31)
    notaLine("TERAS LAUT"),
    notaLine("CIREBON"),
    new Uint8Array([GS, 0x21, 0x00, ESC, 0x45, 0x00]),    // ukuran normal
    notaLine("Nota Penjualan"),
    new Uint8Array([ESC, 0x61, 0x00]),                    // rata kiri
    notaLine(dash),
    notaLine(notaMeta("Waktu", notaWaktu(n.waktu))),
    notaLine(notaMeta("Kasir", n.admin || "-")),
  ];
  if (n.pembeli) parts.push(notaLine(notaMeta("Pembeli", n.pembeli)));
  parts.push(notaLine(dash));
  n.items.forEach((it) => {
    parts.push(notaLine(String(it.nama_barang || "-").slice(0, NOTA_WIDTH)));
    notaBarisNilai(it.jumlah + " x " + rp(it.harga_jual), rp(it.subtotal))
      .forEach((l) => parts.push(notaLine(l)));
  });
  parts.push(notaLine(dash));
  // TOTAL satu baris ukuran ganda bila muat (15 karakter × 2 = 30 kolom);
  // nominal raksasa jatuh ke ukuran normal rata kanan.
  const totalStr = "TOTAL " + rp(n.total);
  if (totalStr.length <= 15) {
    parts.push(
      new Uint8Array([ESC, 0x61, 0x01, GS, 0x21, 0x10, ESC, 0x45, 0x01]), // tengah + tinggi ganda + tebal
      notaLine(totalStr),
      new Uint8Array([GS, 0x21, 0x00, ESC, 0x45, 0x00, ESC, 0x61, 0x00])
    );
  } else {
    notaBarisNilai("TOTAL", rp(n.total)).forEach((l) => parts.push(notaLine(l)));
  }
  parts.push(
    notaLine(dash),
    new Uint8Array([ESC, 0x61, 0x01]),
    notaLine("Terima kasih!"),
    new Uint8Array([ESC, 0x64, 0x03]),                    // feed 3 baris
    new Uint8Array([GS, 0x56, 0x01])                      // potong sebagian
  );
  return notaGabung(parts);
}

/* ---------------- Kirim ke printer ---------------- */
async function printerKirim(data) {
  const CHUNK = 100;
  for (let i = 0; i < data.length; i += CHUNK) {
    const bagian = data.slice(i, i + CHUNK);
    if (printerChar.properties.writeWithoutResponse) {
      await printerChar.writeValueWithoutResponse(bagian);
    } else {
      await printerChar.writeValue(bagian);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
}

/* ---------------- Cetak nota ---------------- */
async function printNota(tx) {
  if (!printerTersedia()) { printNotaFallback(tx); return; }
  try {
    if (!printerStatus().terhubung) await printerConnect();
    await printerKirim(notaBytes(tx));
  } catch (e) {
    throw new Error(e && e.message ? e.message : "Gagal mencetak nota.");
  }
}
// Cadangan: jendela cetak biasa — aplikasi pencetak OS (RawBT dsb.) bisa mengambil alih
function printNotaFallback(tx) {
  const n = notaNormal(tx);
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) throw new Error("Bluetooth tidak tersedia dan jendela cetak diblokir browser.");
  const totalStr = "TOTAL " + rp(n.total);
  const totalBesar = totalStr.length <= 15; // cerminkan aturan ukuran ganda ESC/POS
  w.document.write(`<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><title>Nota Penjualan</title>
<style>
  body { width: 58mm; margin: 0; padding: 4mm; font-family: monospace; font-size: 12px; }
  .tengah { text-align: center; }
  .toko { font-size: 18px; font-weight: bold; }
  .total { font-size: 15px; font-weight: bold; }
  .row { display: flex; justify-content: space-between; }
  hr { border: none; border-top: 1px dashed #000; }
</style></head><body>
  <div class="tengah toko">TERAS LAUT<br>CIREBON</div>
  <div class="tengah">Nota Penjualan</div>
  <hr>
  <div>${esc(notaMeta("Waktu", notaWaktu(n.waktu)))}</div>
  <div>${esc(notaMeta("Kasir", n.admin || "-"))}</div>
  ${n.pembeli ? `<div>${esc(notaMeta("Pembeli", n.pembeli))}</div>` : ""}
  <hr>
  ${n.items.map((it) => `
  <div>${esc(String(it.nama_barang || "-").slice(0, NOTA_WIDTH))}</div>
  <div class="row"><span>${num(it.jumlah)} x ${rp(it.harga_jual)}</span><span>${rp(it.subtotal)}</span></div>`).join("")}
  <hr>
  ${totalBesar
    ? `<div class="tengah total">${esc(totalStr)}</div>`
    : `<div class="row total"><span>TOTAL</span><span>${rp(n.total)}</span></div>`}
  <hr>
  <div class="tengah">Terima kasih!</div>
</body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* biarkan user cetak manual */ } }, 300);
}

/* ---------------- Tes printer ---------------- */
// Slip uji kecil dengan aturan layout yang sama seperti nota (31 kolom).
// Hanya ASCII polos — printer thermal tidak bisa mencetak emoji.
function tesPrinterBytes() {
  const ESC = 0x1b, GS = 0x1d;
  const dash = "-".repeat(NOTA_WIDTH);
  return notaGabung([
    new Uint8Array([ESC, 0x40]),                          // init
    new Uint8Array([ESC, 0x61, 0x01]),                    // rata tengah
    new Uint8Array([GS, 0x21, 0x11, ESC, 0x45, 0x01]),    // ukuran ganda + tebal
    notaLine("TERAS LAUT"),
    notaLine("CIREBON"),
    new Uint8Array([GS, 0x21, 0x00, ESC, 0x45, 0x00]),    // ukuran normal
    notaLine(dash),
    notaLine("TES PRINTER"),
    new Uint8Array([ESC, 0x45, 0x01]),                    // tebal
    notaLine("PRINTER TERHUBUNG"),
    new Uint8Array([ESC, 0x45, 0x00]),
    new Uint8Array([ESC, 0x61, 0x00]),                    // rata kiri
    notaLine(notaMeta("Waktu", notaWaktu(""))),
    notaLine(dash),
    new Uint8Array([ESC, 0x64, 0x03]),                    // feed 3 baris
    new Uint8Array([GS, 0x56, 0x01])                      // potong sebagian
  ]);
}
async function tesPrinter() {
  if (!printerTersedia()) { tesPrinterFallback(); return; }
  if (!printerStatus().terhubung) await printerConnect();
  await printerKirim(tesPrinterBytes());
}
function tesPrinterFallback() {
  const w = window.open("", "_blank", "width=380,height=400");
  if (!w) throw new Error("Bluetooth tidak tersedia dan jendela cetak diblokir browser.");
  w.document.write(`<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><title>Tes Printer</title>
<style>
  body { width: 58mm; margin: 0; padding: 4mm; font-family: monospace; font-size: 12px; }
  .tengah { text-align: center; }
  .toko { font-size: 18px; font-weight: bold; }
  hr { border: none; border-top: 1px dashed #000; }
</style></head><body>
  <div class="tengah toko">TERAS LAUT<br>CIREBON</div>
  <hr>
  <div class="tengah">TES PRINTER</div>
  <div class="tengah"><b>PRINTER TERHUBUNG</b></div>
  <hr>
  <div>${esc(notaMeta("Waktu", notaWaktu("")))}</div>
  <hr>
</body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* biarkan user cetak manual */ } }, 300);
}

// app.js bisa merender layar Pengaturan sebelum file ini selesai termuat —
// segarkan status printer bila elemennya sudah ada di layar.
if (typeof printerStatusHTML === "function") {
  const elStatusAwal = document.getElementById("printer-status");
  if (elStatusAwal) elStatusAwal.textContent = printerStatusHTML();
}
