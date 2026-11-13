// Image + data fixtures (run by make-fixtures.sh).
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
const out = process.argv[2];
const p = (f) => path.join(out, f);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#5b5bd6"/><stop offset="1" stop-color="#22c3a6"/></linearGradient></defs>
  <rect width="320" height="200" rx="24" fill="url(#g)"/><circle cx="90" cy="100" r="50" fill="#fff" fill-opacity=".85"/>
  <text x="160" y="112" font-family="DejaVu Sans" font-size="28" fill="#fff">Fileverse</text></svg>`;
await fs.writeFile(p('sample.svg'), svg);
// Transparent PNG
await sharp(Buffer.from(svg)).png().toFile(p('sample.png'));
// JPG with EXIF orientation 6 (needs rotation to display upright)
await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toFile(p('sample.jpg'));
await sharp(Buffer.from(svg)).webp({ quality: 90 }).toFile(p('sample.webp'));
await sharp(Buffer.from(svg)).avif({ quality: 70 }).toFile(p('sample.avif'));
// 16-bit TIFF
await sharp(Buffer.from(svg)).toColourspace('rgb16').tiff({ compression: 'lzw' }).toFile(p('sample.tiff'));
// Animated GIF (3 frames)
const frames = await Promise.all(['#e5484d', '#30a46c', '#0090ff'].map((c) => sharp({ create: { width: 120, height: 80, channels: 4, background: c } }).png().toBuffer()));
const raw = await Promise.all(frames.map((f) => sharp(f).raw().toBuffer()));
await sharp(Buffer.concat(raw), { raw: { width: 120, height: 240, channels: 4, pageHeight: 80 } }).gif({ delay: [300, 300, 300], loop: 0 }).toFile(p('sample.gif'));
// Data
const records = [{ id: 1, name: 'Ada', email: 'ada@example.com', active: true, zip: '007', address: { city: 'London' } }, { id: 2, name: 'Linus, Jr.', email: 'linus@example.com', active: false, zip: '012', address: { city: 'Helsinki' } }];
await fs.writeFile(p('sample.json'), JSON.stringify({ users: records }, null, 2));
await fs.writeFile(p('sample.yaml'), 'users:\n  - id: 1\n    name: Ada\n    tags: [a, b]\n  - id: 2\n    name: "Linus, Jr."\n    tags: []\n');
await fs.writeFile(p('sample.xml'), '<?xml version="1.0"?>\n<catalog><book id="b1"><title>Dune</title><price>9.99</price></book><book id="b2"><title>Emma &amp; Co</title><price>5.00</price></book></catalog>\n');
await fs.writeFile(p('sample.toml'), 'title = "Fileverse"\n[owner]\nname = "Ada"\n[[servers]]\nname = "alpha"\nport = 8080\n[[servers]]\nname = "beta"\nport = 8081\n');
await fs.writeFile(p('sample.csv'), 'id,name,note,amount\n1,Ada,"Hello, world",007\n2,"Linus ""LT""","multi\nline",12.50\n');
await fs.writeFile(p('sample.tsv'), 'id\tname\tamount\n1\tAda\t3.5\n2\tLinus\t4\n');
console.log('images + data done');
