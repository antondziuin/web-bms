/* Byte-accurate JK / JBD frame builders shared by unit tests and the browser Bluetooth mock.
   Kept free of imports: the e2e suite inlines this file into the page (with `export` stripped). */

export function sum8(a, n){ let c = 0; for (let i = 0; i < n; i++) c = (c + a[i]) & 0xff; return c; }
export function jbdChk(a, o, n){ let s = 0; for (let i = 0; i < n; i++) s = (s - a[o + i]) & 0xffff; return s; }
export function be16(v){ return [(v >> 8) & 0xff, v & 0xff]; }
export function le16(v){ return [v & 0xff, (v >> 8) & 0xff]; }
export function le32(v){ return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]; }
export function chunks(bytes, size = 20){ const out = []; for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size)); return out; }

/* ---------- JBD ---------- */
export function jbdFrame(cmd, data, status = 0){
  const f = [0xdd, cmd, status, data.length, ...data];
  const c = jbdChk(f, 2, 2 + data.length);
  return [...f, c >> 8, c & 0xff, 0x77];
}
/* Basic info (0x03). Values in BMS units: 10 mV, 10 mA, 10 mAh; temps in °C. */
export function jbdHwInfo({ v = 5320, i = -1234, rem = 8000, full = 10000, cycles = 42, bal = 1, prot = 0, soc = 80, cellCount = 16, temps = [25, 26] } = {}){
  const d = [...be16(v), ...be16(i & 0xffff), ...be16(rem), ...be16(full), ...be16(cycles), ...be16(0),
    ...be16(bal & 0xffff), ...be16(bal >>> 16), ...be16(prot), 0x10, soc, 3, cellCount, temps.length];
  for (const tc of temps) d.push(...be16(Math.round(tc * 10 + 2731)));
  return jbdFrame(0x03, d);
}
/* Cell voltages (0x04) in mV. */
export function jbdCells(mv){ const d = []; for (const v of mv) d.push(...be16(v)); return jbdFrame(0x04, d); }
export function jbdVersion(text){ return jbdFrame(0x05, [...text].map(c => c.charCodeAt(0))); }
/* Protection counters (0xAA): u16 big-endian each; status 0x80 = rejected (not in factory mode). */
export function jbdCounters(counts, status = 0){ const d = []; for (const n of counts) d.push(...be16(n)); return jbdFrame(0xAA, status ? [] : d, status); }
/* Acknowledge of a register write (DD reg 00 00 crc 77). */
export function jbdWriteAck(reg){ return jbdFrame(reg, []); }

/* ---------- JK ---------- */
export function jkHeader(type, size = 300){ const f = new Array(size).fill(0); f.splice(0, 6, 0x55, 0xaa, 0xeb, 0x90, type, 0x01); return f; }
export function jkSeal(f){ f[f.length - 1] = sum8(f, f.length - 1); return f; }
/* JK02 cell-info frame (type 0x02). layout: 24 (cells up to 24) or 32 (JK02_32S, offset +32). mV / mA / mAh. */
export function jk02({ layout = 24, cells = [3300, 3301, 3302, 3303], totalMv, currentMa = -5000, t1 = 250, t2 = 260, tmos = 300,
  errMask = 0, balancing = 1, soc = 77, remMah = 76000, fullMah = 100000, cycles = 12, fillGarbage = true } = {}){
  const off = layout === 32 ? 32 : 0;
  const f = jkHeader(0x02);
  cells.forEach((mv, i) => f.splice(6 + i * 2, 2, ...le16(mv)));
  if (fillGarbage && !off){
    // why: настоящие кадры содержат маску ячеек, среднее, дельту и сопротивления сразу за 24 ячейками
    f.splice(54, 4, ...le32((1 << cells.length) - 1));
    f.splice(58, 2, ...le16(Math.round(cells.reduce((a, b) => a + b, 0) / cells.length)));
    f.splice(60, 2, ...le16(Math.max(...cells) - Math.min(...cells))); f[62] = 3; f[63] = 0;
    cells.forEach((_, i) => f.splice(64 + i * 2, 2, ...le16(50)));
  }
  const total = totalMv ?? cells.reduce((a, b) => a + b, 0);
  f.splice(118 + off, 4, ...le32(total));
  f.splice(126 + off, 4, ...le32(currentMa >>> 0));
  f.splice(130 + off, 2, ...le16(t1 & 0xffff)); f.splice(132 + off, 2, ...le16(t2 & 0xffff));
  if (off){ f.splice(112 + off, 2, ...le16(tmos & 0xffff)); f[134 + off] = errMask >> 8; f[135 + off] = errMask & 0xff; }
  else { f.splice(134, 2, ...le16(tmos & 0xffff)); f[136] = errMask >> 8; f[137] = errMask & 0xff; }
  f[140 + off] = balancing; f[141 + off] = soc;
  f.splice(142 + off, 4, ...le32(remMah)); f.splice(146 + off, 4, ...le32(fullMah)); f.splice(150 + off, 4, ...le32(cycles));
  return jkSeal(f);
}
/* JK02 settings frame (type 0x01), mV. */
export function jkSettings({ uvp = 2800, ovp = 3650, soc100 = 3450, soc0 = 2900 } = {}){
  const f = jkHeader(0x01);
  f.splice(10, 4, ...le32(uvp)); f.splice(18, 4, ...le32(ovp)); f.splice(30, 4, ...le32(soc100)); f.splice(34, 4, ...le32(soc0));
  return jkSeal(f);
}
/* JK device-info frame (type 0x03). */
export function jkDeviceInfo({ model = 'JK_B2A8S20P', hw = '11.XW', sw = '11.26', uptime = 0, powerOnCount = 0 } = {}){
  const f = jkHeader(0x03);
  const put = (pos, s, n) => [...s].slice(0, n).forEach((c, i) => { f[pos + i] = c.charCodeAt(0); });
  put(6, model, 16); put(22, hw, 8); put(30, sw, 8);
  f.splice(38, 4, ...le32(uptime)); f.splice(42, 4, ...le32(powerOnCount));
  return jkSeal(f);
}
/* JK logbook (type 0x05): count at 6, entries {ts (s of run time), code} of 5 bytes from 11, max 50. */
export function jkLogbook(entries, count = entries.length){
  const f = jkHeader(0x05);
  f.splice(6, 4, ...le32(count));
  entries.slice(0, 50).forEach((e, i) => { f.splice(11 + i * 5, 4, ...le32(e.ts)); f[15 + i * 5] = e.code; });
  return jkSeal(f);
}
