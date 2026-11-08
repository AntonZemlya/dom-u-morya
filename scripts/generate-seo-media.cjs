// Compose the share card from the published project rendering and unmodified brand lockup.
const path = require('node:path');
const sharp = require('sharp');

const assets = path.resolve(__dirname, '../assets');
const width = 1200;
const height = 630;

const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="shade">
      <stop stop-color="#082c3a"/><stop offset=".47" stop-color="#092f40"/>
      <stop offset=".64" stop-color="#0d3545" stop-opacity=".94"/>
      <stop offset=".76" stop-color="#102f3d" stop-opacity=".35"/>
      <stop offset=".88" stop-color="#102f3d" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ribbon"><stop stop-color="#e4b673"/><stop offset=".55" stop-color="#f9ddb0"/><stop offset="1" stop-color="#e5b571"/></linearGradient>
    <linearGradient id="wave"><stop stop-color="#11616b"/><stop offset=".4" stop-color="#37919a"/><stop offset=".8" stop-color="#0c4758"/><stop offset="1" stop-color="#0c3344"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#shade)"/>
  <path d="M0 0H750C640 44 579 122 439 135C264 150 150 87 0 142Z" fill="#194658" opacity=".32"/>
  <path d="M43 31H313L301 112H43Z" fill="#faf6ed"/>
  <g font-family="Arial, DejaVu Sans, sans-serif" font-weight="bold">
    <text x="41" y="229" font-size="76" letter-spacing="-3.5" fill="#fffaf1">ЖК «Дом у моря»</text>
    <text x="42" y="312" font-size="80" letter-spacing="-3" fill="#f2c887">в Мариуполе</text>
    <path d="M59 350H643L625 401H41Z" fill="url(#ribbon)"/>
    <text x="72" y="385" font-size="31" fill="#0a3040">Квартиры · Планировки · Цены</text>
    <g fill="#fcf8ee" font-size="23">
      <text x="42" y="492">Первая<tspan x="42" dy="27">береговая линия</tspan></text>
      <text x="279" y="492">Чистовая<tspan x="279" dy="27">отделка</tspan></text>
      <text x="466" y="492">18 этажей,<tspan x="466" dy="27">один корпус</tspan></text>
    </g>
  </g>
  <g fill="none" stroke="#eac489" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M43 448q6 -6 12 0t12 0t12 0m-36 8q6 -6 12 0t12 0t12 0"/>
    <path d="M281 440h25v10h-25zm25 5h5v9l-14 3v6h-4v-9"/>
    <path d="M467 461h31m-27 -1v-18l17 -7v26m-11 -15 6 -2m-6 8 6 -2m5 -11 7 3v19"/>
  </g>
  <path d="M245 443v77m186 -77v77" stroke="#c6ae82" opacity=".56"/>
  <path d="M0 571C249 505 417 619 668 614S996 533 1200 553V630H0Z" fill="url(#wave)" stroke="#e6c38c" stroke-width="2"/>
  <path d="M0 601C241 535 446 643 676 627S1029 551 1200 561V630H0Z" fill="#082d3d"/>
</svg>`);

async function generate() {
  const tower = await sharp(path.join(assets, 'content/gallery/cac1215e0f091803-1920.webp'))
    .resize({ height: 820 })
    .extract({ left: 158, top: 111, width: 680, height })
    .png().toBuffer();
  const logo = await sharp(path.join(assets, 'logo-cropped.webp'))
    .resize({ width: 221 }).png().toBuffer();
  await sharp({ create: { width, height, channels: 3, background: '#092f40' } })
    .composite([
      { input: tower, left: width - 680, top: 0 },
      { input: overlay },
      { input: logo, left: 59, top: 42 },
    ])
    .jpeg({ quality: 91, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(path.join(assets, 'og-project.jpg'));
}

generate().catch(error => { console.error(error); process.exitCode = 1; });
