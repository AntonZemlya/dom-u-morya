import {PREVIEW_FILES} from './preview-files.mjs';
import {CONTENT_FILES} from './content-files.mjs';
// Publication is explicit: add resources here when changing asset filenames.
export const RELEASE_FILES = Object.freeze([
  'privacy.html', 'consent-personal-data.html', 'index.html', 'styles.css', 'script.js', 'content-model.js', 'favicon.png',
  ...CONTENT_FILES, ...PREVIEW_FILES,
  'assets/og-project.jpg', 'assets/architecture.webp', 'assets/cta.webp',
  'assets/hero-desktop.webp', 'assets/hero-mobile.webp', 'assets/hero-tablet.webp',
  'assets/location.webp', 'assets/logo-cropped.webp',
  'assets/fonts/fonts.css',
  'assets/fonts/font-1.ttf', 'assets/fonts/font-2.ttf', 'assets/fonts/font-3.ttf',
  'assets/fonts/font-4.ttf', 'assets/fonts/font-5.ttf', 'assets/fonts/font-6.ttf',
  'assets/fonts/font-7.ttf', 'assets/fonts/font-8.ttf', 'assets/fonts/font-9.ttf',
  'assets/fonts/Newsreader.OFL.txt', 'assets/fonts/Sora.OFL.txt',
  'assets/vendor/html2canvas.min.js', 'assets/vendor/jspdf.umd.min.js',
  'assets/vendor/html2canvas.LICENSE', 'assets/vendor/jspdf.LICENSE',
]);
