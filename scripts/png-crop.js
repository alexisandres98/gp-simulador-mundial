#!/usr/bin/env node
'use strict';
// scripts/png-crop.js — recorta un PNG a un alto exacto (Node puro, sin dependencias).
//
// POR QUÉ EXISTE. Chrome headless en este contenedor da un viewport ~85 px MÁS BAJO que el `--window-size`
// que se le pide, y todo lo que cae por debajo de ese viewport sale sin pintar (el pie de las piezas salía
// en negro). El remedio es renderizar con la ventana más alta de lo necesario —así todo el lienzo entra en
// el viewport— y recortar después al alto real de la pieza. Esto hace el recorte.
//
//   node scripts/png-crop.js <entrada.png> <alto> [salida.png]
//   node scripts/png-crop.js pieza.png 675            (recorta en el sitio)
//
// Solo PNG de 8 bits sin entrelazar, que es lo que escribe Chrome (RGBA o RGB).
const fs = require('fs');
const zlib = require('zlib');

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body), 0);
  return Buffer.concat([len, body, crc]);
}

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

function crop(file, newH, out) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('no es un PNG');
  let p = 8, ihdr = null; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr) throw new Error('sin IHDR');
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  const depth = ihdr[8], color = ihdr[9], interlace = ihdr[12];
  if (depth !== 8 || interlace !== 0) throw new Error(`solo 8 bits sin entrelazar (depth ${depth}, interlace ${interlace})`);
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (!bpp) throw new Error('tipo de color no soportado: ' + color);
  if (newH > h) throw new Error(`el alto pedido (${newH}) supera el del PNG (${h})`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  // deshacer los filtros fila a fila (solo hasta newH: lo de abajo se tira)
  const px = Buffer.alloc(newH * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < newH; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.slice(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      cur[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 0xFF;
    }
    prev = cur;
  }
  // re-filtrar con Paeth (comprime bien en degradados) y re-empaquetar
  const filtered = Buffer.alloc(newH * (stride + 1));
  prev = Buffer.alloc(stride);
  for (let y = 0; y < newH; y++) {
    const cur = px.slice(y * stride, (y + 1) * stride);
    filtered[y * (stride + 1)] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      filtered[y * (stride + 1) + 1 + i] = (cur[i] - paeth(a, b, c)) & 0xFF;
    }
    prev = cur;
  }
  const nh = Buffer.from(ihdr); nh.writeUInt32BE(newH, 4);
  const png = Buffer.concat([
    buf.slice(0, 8), chunk('IHDR', nh),
    chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(out || file, png);
  return { w, from: h, to: newH, bytes: png.length };
}

if (require.main === module) {
  const [f, hh, o] = process.argv.slice(2);
  if (!f || !hh) { console.error('uso: node scripts/png-crop.js <entrada.png> <alto> [salida.png]'); process.exit(1); }
  const r = crop(f, +hh, o);
  console.log(`recortado ${r.w}x${r.from} → ${r.w}x${r.to} · ${(r.bytes / 1024).toFixed(0)} kB`);
}
module.exports = { crop };
