import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, constants } from 'node:zlib';
import { inspectRaster } from './profile-media-raster.js';
// Real 2x2 RGB images encoded by Pillow, not signature-only synthetic images.
const fixtures = {
  'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGOsMIpiYGBgYgADAAx4AQiDH4q8AAAAAElFTkSuQmCC',
  'image/jpeg': '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDiqKKK3PcP/9k=',
  'image/webp': 'UklGRjQAAABXRUJQVlA4ICgAAABwAQCdASoCAAIAAUAmJZgCdAFAAAD+82mNaTSLz/8Q5/W3/cpmAAAA'
};
const bytes = mime => Buffer.from(fixtures[mime], 'base64');
const reject = (b, mime) => assert.throws(() => inspectRaster(b, mime), /Invalid profile cover raster/);
function crc32(b) {
  let c = 0xffffffff;
  for (const byte of b) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, payload = Buffer.alloc(0)) {
  const out = Buffer.alloc(payload.length + 12); out.writeUInt32BE(payload.length); out.write(type, 4); payload.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4); return out;
}
function pngHeader(width, height) {
  const b = bytes('image/png'); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); b.writeUInt32BE(crc32(b.subarray(12, 29)), 29); return b;
}
for (const mime of Object.keys(fixtures)) {
  test(`${mime}: authentic image accepted with exact dimensions`, () => assert.deepEqual(inspectRaster(bytes(mime), mime), { width: 2, height: 2 }));
  test(`${mime}: every truncated prefix is rejected`, () => {
    const b = bytes(mime); for (let n = 0; n < b.length; n++) reject(b.subarray(0, n), mime);
  });
  test(`${mime}: concatenation, trailing bytes and MIME confusion rejected`, () => {
    const b = bytes(mime); reject(Buffer.concat([b, b]), mime); reject(Buffer.concat([b, Buffer.from([0])]), mime);
    for (const other of Object.keys(fixtures)) if (other !== mime) reject(b, other);
  });
}
test('strict size, type and MIME bounds', () => {
  reject(new Uint8Array(1024 * 1024 + 1), 'image/png'); reject([], 'image/png'); reject(null, 'image/png');
  for (const mime of ['image/gif', 'image/svg+xml', 'IMAGE/PNG', 'image/png; charset=utf-8', 'multipart/mixed']) reject(bytes('image/png'), mime);
});
test('PNG dimensions, CRC, method and header structure', () => {
  for (const [w, h] of [[0,2],[2,0],[3841,2],[2,1281],[0xffffffff,2]]) reject(pngHeader(w, h), 'image/png');
  const b = bytes('image/png'); b[45] ^= 1; reject(b, 'image/png');
  for (const [offset, value] of [[24,3],[25,1],[26,1],[27,1],[28,2]]) {
    const c = bytes('image/png'); c[offset] = value; c.writeUInt32BE(crc32(c.subarray(12,29)),29); reject(c, 'image/png');
  }
});
test('PNG animation, extra image, missing data, unknown or text chunks rejected', () => {
  const b = bytes('image/png');
  for (const type of ['acTL','fcTL','fdAT','tEXt','iTXt','zzZZ','IHDR']) reject(Buffer.concat([b.subarray(0,33),pngChunk(type),b.subarray(33)]), 'image/png');
  reject(Buffer.concat([b.subarray(0,33),b.subarray(-12)]), 'image/png');
  const c = Buffer.from(b); c.writeUInt32BE(0xffffffff,33); reject(c,'image/png');
});
test('JPEG malformed framing, duplicate frame and invalid dimensions rejected', () => {
  const b = bytes('image/jpeg'), frame = b.indexOf(Buffer.from([255,192]));
  for (const [offset, value] of [[frame+5,0],[frame+7,0]]) { const c=Buffer.from(b); c.writeUInt16BE(value,offset); reject(c,'image/jpeg'); }
  const huge=Buffer.from(b); huge.writeUInt16BE(3841,frame+7); reject(huge,'image/jpeg');
  const hugeHeight=Buffer.from(b); hugeHeight.writeUInt16BE(1281,frame+5); reject(hugeHeight,'image/jpeg');
  const badLength=Buffer.from(b); badLength.writeUInt16BE(1,4); reject(badLength,'image/jpeg');
  reject(Buffer.concat([b.subarray(0,frame),b.subarray(frame,frame+19),b.subarray(frame)]),'image/jpeg');
  const noFrame=Buffer.concat([b.subarray(0,frame),b.subarray(frame+19)]); reject(noFrame,'image/jpeg');
  reject(Buffer.from([255,216,255,217]),'image/jpeg');
});
test('JPEG rejects absent tables, empty scan, unsupported metadata and restart misuse', () => {
  const b=bytes('image/jpeg'), scan=b.indexOf(Buffer.from([255,218])), end=scan+2+b.readUInt16BE(scan+2);
  reject(Buffer.concat([b.subarray(0,end),b.subarray(-2)]),'image/jpeg');
  const restart=Buffer.concat([b.subarray(0,end+1),Buffer.from([255,208]),b.subarray(end+1)]); reject(restart,'image/jpeg');
  const noTables=Buffer.from(b); noTables[scan+6]=0x33; reject(noTables,'image/jpeg');
  const metadata=Buffer.from(b); metadata[3]=225; reject(metadata,'image/jpeg');
  const huff=b.indexOf(Buffer.from([255,196])), invalidTree=Buffer.from(b); invalidTree[huff+5]=255; reject(invalidTree,'image/jpeg');
});
test('WebP dimensions, RIFF size, partitions, flags and extra chunks rejected', () => {
  for (const [offset,value] of [[4,0],[16,0xffffffff],[20,1],[23,0],[26,0],[28,1281]]) {
    const b=bytes('image/webp');
    if(offset===4||offset===16)b.writeUInt32LE(value,offset); else if(offset===26||offset===28)b.writeUInt16LE(value,offset); else b[offset]=value;
    reject(b,'image/webp');
  }
  const huge=bytes('image/webp'); huge.writeUInt16LE(3841,26); reject(huge,'image/webp');
  const junk=Buffer.concat([bytes('image/webp'),Buffer.from('ANIM\x02\0\0\0\0\0','binary')]); junk.writeUInt32LE(junk.length-8,4); reject(junk,'image/webp');
  const duplicate=Buffer.concat([bytes('image/webp'),bytes('image/webp').subarray(12)]); duplicate.writeUInt32LE(duplicate.length-8,4); reject(duplicate,'image/webp');
});

test('authentic progressive JPEG', () => assert.deepEqual(inspectRaster(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAACBP/aAAwDAQACEAMQAAABiB3f/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD7/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=','base64'),'image/jpeg'),{width:2,height:2}));

test('authentic lossless WebP', () => assert.deepEqual(inspectRaster(Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAEAdQmeJVq2SBiOh/AAA=','base64'),'image/webp'),{width:2,height:2}));

test('authentic alpha WebP', () => assert.deepEqual(inspectRaster(Buffer.from('UklGRlQAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAZGRkZABWUDggKAAAAHABAJ0BKgIAAgABQCYlmAJ0AUAAAP7zaY1pNIvP/xDn9bf9ymYAAAA=','base64'),'image/webp'),{width:2,height:2}));
function pngWithData(raw, options = {}, width = 2, height = 2) {
  return Buffer.concat([pngHeader(width,height).subarray(0,33),pngChunk('IDAT',deflateSync(raw,options)),pngChunk('IEND')]);
}
test('PNG accepts zlib envelopes for stored, fixed and dynamic data, including split IDAT', () => {
  for (const options of [{level:0},{strategy:constants.Z_FIXED},{level:9}]) {
    const raw=Buffer.alloc(64*(1+64*3));
    for(let row=0;row<64;row++) for(let x=1;x<=64*3;x++) raw[row*193+x]=(row*17+x*3)%251;
    assert.deepEqual(inspectRaster(pngWithData(raw,options,64,64),'image/png'),{width:64,height:64});
  }
  const raw=Buffer.from([0,120,50,90,120,50,90,0,120,50,90,120,50,90]), z=deflateSync(raw);
  const b=Buffer.concat([bytes('image/png').subarray(0,33),pngChunk('IDAT',z.subarray(0,1)),pngChunk('IDAT',z.subarray(1)),pngChunk('IEND')]);
  assert.deepEqual(inspectRaster(b,'image/png'),{width:2,height:2});
});
test('PNG rejects invalid zlib envelope and reserved first block without inflating pixels', () => {
  const raw=Buffer.from([0,120,50,90,120,50,90,0,120,50,90,120,50,90]);
  const wrap=z=>Buffer.concat([bytes('image/png').subarray(0,33),pngChunk('IDAT',z),pngChunk('IEND')]);
  for(const at of [0,1]) { const z=deflateSync(raw);z[at]^=255;reject(wrap(z),'image/png'); }
  const reserved=deflateSync(raw); reserved[2]=(reserved[2]&~6)|6; reject(wrap(reserved),'image/png');
  // Deliberately document the trust boundary: checksum/entropy validity is a
  // decoder responsibility, as for JPEG/WebP. CRC protects container chunks.
  const undecoded=deflateSync(raw); undecoded[undecoded.length-1]^=255;
  assert.deepEqual(inspectRaster(wrap(undecoded),'image/png'),{width:2,height:2});
});
