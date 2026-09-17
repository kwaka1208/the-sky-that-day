import { writeFile } from 'node:fs/promises';

const endpoint = 'https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync';
const query = 'select ra,dec,vmag,bv_color from bsc5p where vmag > 3.45 and vmag <= 6.5';
const url = new URL(endpoint);
url.searchParams.set('REQUEST', 'doQuery');
url.searchParams.set('LANG', 'ADQL');
url.searchParams.set('QUERY', query);

console.log('NASA HEASARC BSC5Pから星表を取得しています…');
const response = await fetch(url);
if (!response.ok) throw new Error(`HEASARC request failed: ${response.status}`);
const xml = await response.text();
if (!xml.includes('name="QUERY_STATUS" value="OK"')) {
  throw new Error('HEASARC returned an unsuccessful query response.');
}
const stream = xml.match(/<STREAM encoding="base64">([\s\S]*?)<\/STREAM>/)?.[1];
if (!stream) throw new Error('VOTable binary stream was not found.');

const binary = Buffer.from(stream.replace(/\s/g, ''), 'base64');
const rowSize = 24; // two float64 values followed by two float32 values
if (binary.length % rowSize !== 0) throw new Error('Unexpected BSC5P binary row layout.');

const rows = [];
for (let offset = 0; offset < binary.length; offset += rowSize) {
  const ra = binary.readDoubleBE(offset);
  const dec = binary.readDoubleBE(offset + 8);
  const magnitude = binary.readFloatBE(offset + 16);
  const bv = binary.readFloatBE(offset + 20);
  if (![ra, dec, magnitude].every(Number.isFinite)) continue;
  rows.push([
    Number(ra.toFixed(6)),
    Number(dec.toFixed(6)),
    Number(magnitude.toFixed(2)),
    Number.isFinite(bv) ? Number(bv.toFixed(2)) : null,
  ]);
}

const output = `// Generated from NASA HEASARC Bright Star Catalog (BSC5P).\n// Source: https://heasarc.gsfc.nasa.gov/W3Browse/all/bsc5p.html\n// Query: ${query}\n// Do not edit manually. Run: npm run data:stars\n\nexport type NasaStarTuple = readonly [\n  raDegrees: number,\n  decDegrees: number,\n  magnitude: number,\n  bvColor: number | null,\n];\n\nexport const NASA_BRIGHT_STARS: readonly NasaStarTuple[] = ${JSON.stringify(rows)};\n`;

const outputUrl = new URL('../src/data/nasaBrightStars.ts', import.meta.url);
await writeFile(outputUrl, output, 'utf8');
console.log(`${rows.length.toLocaleString()} stars written to src/data/nasaBrightStars.ts`);
