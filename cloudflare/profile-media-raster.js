/** Strict static-image container validation. This is not an entropy/pixel decoder.
 * Uploads must also originate from the client's rasterizing canvas pipeline.
 * Unknown/unsupported structures fail closed; no MIME sniff fallback is used.
 */
const MAX_BYTES = 1024 * 1024;
function requireValid(ok) { if (!ok) throw new Error('Invalid profile cover raster'); }
function dimensions(width, height) {
  requireValid(width > 0 && height > 0 && width <= 3840 && height <= 1280);
  return { width, height };
}
const ascii = (b, p, n) => String.fromCharCode(...b.subarray(p, p + n));
const be16 = (b, p) => b[p] * 256 + b[p + 1];
const be32 = (b, p) => (b[p] * 0x1000000 + b[p + 1] * 65536 + b[p + 2] * 256 + b[p + 3]);
const le24 = (b, p) => b[p] + b[p + 1] * 256 + b[p + 2] * 65536;
const le32 = (b, p) => le24(b, p) + b[p + 3] * 0x1000000;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(b, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b[i]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
// Structural zlib envelope checks only. Do not inflate attacker-controlled pixels
// on the Worker hot path: a tiny compressed upload can expand to tens of MB.
// Pixel/entropy decoding and re-encoding belong to the client before upload;
// downloaded bytes must likewise pass the client's decoder before display.
function validatePngData(input) {
  requireValid(input.length >= 7);
  const cmf = input[0], flg = input[1];
  requireValid((cmf & 15) === 8 && (cmf >>> 4) <= 7 && (cmf * 256 + flg) % 31 === 0 && !(flg & 32));
  requireValid(((input[2] >>> 1) & 3) !== 3); // Reserved first DEFLATE block type.
}
function png(b) {
  requireValid(b.length >= 45 && [137,80,78,71,13,10,26,10].every((v, i) => b[i] === v));
  let p = 8, size, depth, color, palette = false, data = false, dataEnded = false, dataBytes = 0;
  const once = new Set();
  const dataChunks = []; let interlace;
  while (p < b.length) {
    requireValid(p + 12 <= b.length);
    const n = be32(b, p), type = ascii(b, p + 4, 4), start = p + 8, end = start + n;
    requireValid(end + 4 <= b.length && /^[A-Za-z]{4}$/.test(type) && type[2] === type[2].toUpperCase());
    requireValid(crc32(b, p + 4, end) === be32(b, end));
    requireValid(size || type === 'IHDR');
    if (type === 'IHDR') {
      requireValid(!size && p === 8 && n === 13);
      size = dimensions(be32(b, start), be32(b, start + 4));
      depth = b[start + 8]; color = b[start + 9]; interlace = b[start + 12];
      const depths = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
      requireValid(depths[color]?.includes(depth) && b[start + 10] === 0 && b[start + 11] === 0 && b[start + 12] <= 1);
    } else if (type === 'PLTE') {
      requireValid(!palette && !data && color !== 0 && color !== 4 && n > 0 && n % 3 === 0 && n <= 768);
      requireValid(color !== 3 || n / 3 <= 2 ** depth);
      palette = n / 3;
    } else if (type === 'IDAT') {
      requireValid(!dataEnded && (color !== 3 || palette));
      data = true; dataBytes += n;
      dataChunks.push(b.subarray(start, end));
    } else if (type === 'IEND') {
      requireValid(n === 0 && data && dataBytes >= 7 && end + 4 === b.length);
      const compressed = new Uint8Array(dataBytes); let at = 0;
      for (const chunk of dataChunks) { compressed.set(chunk, at); at += chunk.length; }
      validatePngData(compressed, size, depth, color, interlace);
      return size;
    } else {
      // Reject APNG, unknown chunks, and embedded text/profile payloads. Canvas
      // encoders need only the following bounded color/physical metadata.
      requireValid(['tRNS', 'sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(type) && !once.has(type));
      once.add(type);
      requireValid(!data);
      if (type === 'tRNS') requireValid((color === 0 && n === 2) || (color === 2 && n === 6) || (color === 3 && palette && n > 0 && n <= palette));
      if (type === 'sRGB') requireValid(n === 1 && b[start] <= 3 && !palette);
      if (type === 'gAMA') requireValid(n === 4 && be32(b, start) > 0 && !palette);
      if (type === 'cHRM') requireValid(n === 32 && !palette);
      if (type === 'pHYs') requireValid(n === 9 && b[start + 8] <= 1);
    }
    if (data && type !== 'IDAT') dataEnded = true;
    p = end + 4;
  }
  requireValid(false);
}
function jpeg(b) {
  requireValid(b.length >= 4 && b[0] === 255 && b[1] === 216);
  let p = 2, size, progressive = false, scans = 0, restartInterval = 0;
  const components = new Map(), quant = new Set(), dc = new Set(), ac = new Set();
  while (p < b.length) {
    requireValid(b[p++] === 255);
    while (b[p] === 255) p++;
    requireValid(p < b.length);
    const marker = b[p++];
    if (marker === 217) { requireValid(size && scans > 0 && p === b.length); return size; }
    requireValid(marker !== 0 && marker !== 216 && marker !== 1 && !(marker >= 208 && marker <= 215));
    requireValid(p + 2 <= b.length);
    const n = be16(b, p), start = p + 2, end = p + n;
    requireValid(n >= 2 && end <= b.length);
    if (marker === 192 || marker === 194) {
      requireValid(!size && !scans && n >= 11 && b[start] === 8);
      size = dimensions(be16(b, start + 3), be16(b, start + 1));
      progressive = marker === 194;
      const count = b[start + 5];
      requireValid([1,3].includes(count) && n === 8 + count * 3);
      let blocks = 0;
      for (let i = 0; i < count; i++) {
        const q = start + 6 + i * 3, id = b[q], h = b[q + 1] >>> 4, v = b[q + 1] & 15;
        requireValid(!components.has(id) && h >= 1 && h <= 4 && v >= 1 && v <= 4 && b[q + 2] <= 3);
        components.set(id, b[q + 2]); blocks += h * v;
      }
      requireValid(blocks <= 10);
    } else if (marker === 219) {
      let q = start;
      while (q < end) {
        const info = b[q++], precision = info >>> 4, id = info & 15;
        requireValid(precision <= 1 && id <= 3 && q + 64 * (precision + 1) <= end);
        for (let i = 0; i < 64; i++) {
          requireValid(precision ? be16(b, q) !== 0 : b[q] !== 0); q += precision + 1;
        }
        quant.add(id);
      }
      requireValid(q === end && n > 2);
    } else if (marker === 196) {
      let q = start;
      while (q < end) {
        requireValid(q + 17 <= end);
        const info = b[q++], kind = info >>> 4, id = info & 15;
        requireValid(kind <= 1 && id <= 3);
        let count = 0, available = 1;
        for (let i = 0; i < 16; i++) { available = available * 2 - b[q]; count += b[q++]; requireValid(available >= 0); }
        requireValid(count > 0 && count <= 256 && available > 0 && q + count <= end);
        const values = new Set();
        for (let i = 0; i < count; i++) {
          const value = b[q++]; requireValid(!values.has(value)); values.add(value);
          requireValid(kind ? ((value & 15) <= 10) : value <= 11);
        }
        (kind ? ac : dc).add(id);
      }
      requireValid(q === end && n > 2);
    } else if (marker === 221) {
      requireValid(n === 4); restartInterval = be16(b, start);
    } else if (marker === 218) {
      requireValid(size && n >= 8);
      const count = b[start], seen = new Set();
      requireValid(count >= 1 && count <= components.size && n === 6 + count * 2);
      const ss = b[end - 3], se = b[end - 2], ah = b[end - 1] >>> 4, al = b[end - 1] & 15;
      requireValid(progressive ? (ss <= se && se <= 63 && (ss === 0 ? se === 0 : count === 1) && ah <= 13 && al <= 13 && (ah === 0 || ah === al + 1)) : (ss === 0 && se === 63 && ah === 0 && al === 0));
      for (let i = 0; i < count; i++) {
        const id = b[start + 1 + i * 2], tables = b[start + 2 + i * 2];
        requireValid(components.has(id) && !seen.has(id) && quant.has(components.get(id)) && (tables >>> 4) <= 3 && (tables & 15) <= 3);
        if (!progressive || (ss === 0 && ah === 0)) requireValid(dc.has(tables >>> 4));
        if (!progressive || ss > 0) requireValid(ac.has(tables & 15));
        seen.add(id);
      }
      p = end; let entropy = 0, restart = 0;
      while (p < b.length) {
        if (b[p] !== 255) { entropy++; p++; continue; }
        const markerStart = p++;
        while (b[p] === 255) p++;
        requireValid(p < b.length);
        if (b[p] === 0) { requireValid(p === markerStart + 1); entropy++; p++; continue; }
        if (b[p] >= 208 && b[p] <= 215) {
          requireValid(restartInterval > 0 && b[p] === 208 + restart && entropy > 0);
          restart = (restart + 1) % 8; p++; continue;
        }
        p = markerStart; break;
      }
      requireValid(entropy > 0 && p < b.length); scans++; continue;
    } else if (marker >= 224 && marker <= 239) {
      // Browser-produced JPEG uses JFIF; disallow arbitrary EXIF/ICC/MPF payloads.
      requireValid(marker === 224 && scans === 0 && ascii(b, start, 5) === 'JFIF\0' && n >= 16);
      requireValid(b[start + 5] === 1 && b[start + 6] <= 2 && b[start + 7] <= 2 && n === 16 + 3 * b[start + 12] * b[start + 13]);
    } else requireValid(false);
    p = end;
  }
  requireValid(false);
}
function webp(b) {
  requireValid(b.length >= 20 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' && le32(b, 4) === b.length - 8);
  let p = 12, size, canvas, alpha = false, alphaFlag = false, losslessAlpha = false, count = 0;
  while (p < b.length) {
    requireValid(p + 8 <= b.length);
    const type = ascii(b, p, 4), n = le32(b, p + 4), start = p + 8, end = start + n;
    requireValid(n > 0 && end + (n & 1) <= b.length && (!(n & 1) || b[end] === 0));
    if (type === 'VP8X') {
      requireValid(p === 12 && n === 10 && (b[start] & ~16) === 0 && b[start + 1] === 0 && b[start + 2] === 0 && b[start + 3] === 0);
      alphaFlag = !!(b[start] & 16);
      canvas = dimensions(le24(b, start + 4) + 1, le24(b, start + 7) + 1);
    } else if (type === 'ALPH') {
      requireValid(canvas && alphaFlag && !alpha && !size && n >= 2 && (b[start] & 0xc0) === 0 && (b[start] & 3) <= 1 && ((b[start] >>> 4) & 3) <= 1);
      if ((b[start] & 3) === 0) requireValid(n === 1 + canvas.width * canvas.height);
      alpha = true;
    } else if (type === 'VP8 ') {
      requireValid(!size && n >= 11 && (b[start] & 1) === 0 && ((b[start] >>> 1) & 7) <= 3 && (b[start] & 16) !== 0 && ascii(b, start + 3, 3) === '\x9d\x01\x2a');
      const partition = le24(b, start) >>> 5;
      requireValid(partition > 0 && partition + 10 < n);
      const w = b[start + 6] + b[start + 7] * 256, h = b[start + 8] + b[start + 9] * 256;
      requireValid((w & 0xc000) === 0 && (h & 0xc000) === 0);
      size = dimensions(w, h); count++;
    } else if (type === 'VP8L') {
      requireValid(!size && !alpha && n >= 6 && b[start] === 47);
      const bits = le32(b, start + 1);
      requireValid((bits >>> 29) === 0);
      size = dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1);
      losslessAlpha = !!(bits & 0x10000000); count++;
    } else requireValid(false); // No animation, metadata or extra RIFF payloads.
    p = end + (n & 1);
  }
  requireValid(p === b.length && count === 1 && (!canvas || (canvas.width === size.width && canvas.height === size.height && alphaFlag === (alpha || losslessAlpha))));
  return size;
}
export function inspectRaster(bytes, mime) {
  requireValid(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX_BYTES);
  if (mime === 'image/png') return png(bytes);
  if (mime === 'image/jpeg') return jpeg(bytes);
  if (mime === 'image/webp') return webp(bytes);
  requireValid(false);
}
