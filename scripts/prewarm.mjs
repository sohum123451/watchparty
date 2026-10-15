const urls = ['/lobby', '/login', '/signup', '/join/CRITERION-70MM', '/motion-demo'];
for (const u of urls) {
  console.log(`Pre-warming ${u}...`);
  const t0 = Date.now();
  try {
    const res = await fetch(`http://localhost:3000${u}`);
    console.log(`✓ ${u} returned ${res.status} in ${Date.now() - t0}ms`);
  } catch (e) {
    console.error(`✗ ${u} failed:`, e.message);
  }
}
