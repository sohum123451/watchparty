const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const filesToPatch = [
  path.join(root, 'node_modules/next/dist/lib/recursive-delete.js'),
  path.join(root, 'node_modules/next/dist/esm/lib/recursive-delete.js'),
];

for (const file of filesToPatch) {
  try {
    if (fs.existsSync(file)) {
      let content = fs.readFileSync(file, 'utf8');
      if (!content.includes('isSymlink = false')) {
        content = content.replace(
          'const linkPath = await _fs.promises.readlink(absolutePath);',
          'let linkPath; try { linkPath = await _fs.promises.readlink(absolutePath); } catch { isSymlink = false; }'
        ).replace(
          'const linkPath = await promises.readlink(absolutePath);',
          'let linkPath; try { linkPath = await promises.readlink(absolutePath); } catch { isSymlink = false; }'
        );
        fs.writeFileSync(file, content, 'utf8');
        console.log(`[patch-next] Patched ${path.relative(root, file)}`);
      }
    }
  } catch (err) {
    // Non-fatal
  }
}

// Clean stale .next on Windows if present to avoid locked OneDrive reparse points
if (process.platform === 'win32') {
  const webNext = path.join(root, 'packages/web/.next');
  if (fs.existsSync(webNext)) {
    try {
      fs.rmSync(webNext, { recursive: true, force: true, maxRetries: 3 });
      console.log('[patch-next] Cleared packages/web/.next');
    } catch {}
  }
}
