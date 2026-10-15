import fs from 'node:fs';

const file = process.argv[2] || 'lighthouse_landing.json';
if (!fs.existsSync(file)) {
  console.log(`File not found: ${file}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const categories = data.categories;

console.log(`\n=== LIGHTHOUSE REPORT: ${data.finalDisplayedUrl} ===`);
for (const [key, cat] of Object.entries(categories)) {
  console.log(`- ${cat.title}: ${Math.round(cat.score * 100)}/100`);
}

console.log('\nTop Opportunities / Issues:');
const audits = data.audits;
for (const [key, audit] of Object.entries(audits)) {
  if (audit.score !== null && audit.score < 0.9 && audit.title) {
    console.log(`* [${audit.score}] ${audit.title}: ${audit.displayValue || ''}`);
  }
}
