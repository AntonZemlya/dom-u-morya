// Pass the owner-approved PNG as the only argument. The release ships the JPEG.
const path = require('node:path');
const sharp = require('sharp');

async function generate(source) {
  if (!source) throw new Error('Usage: node scripts/generate-seo-media.cjs <approved-card.png>');
  const metadata = await sharp(source).metadata();
  if (metadata.format !== 'png' || metadata.width !== 1731 || metadata.height !== 909) {
    throw new Error('Expected the approved 1731 × 909 PNG');
  }
  // At the target width the full frame rounds to exactly 630 pixels high.
  await sharp(source)
    .resize({ width: 1200 })
    .jpeg({ quality: 93, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(path.resolve(__dirname, '../assets/og-project.jpg'));
}

generate(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
