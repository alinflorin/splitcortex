import { bootstrapGarage } from './bootstrap';

// Run by the Helm hook Job `garage-bootstrap` (post-install/post-upgrade). Garage is part of the release but may still be
// settling, so retry; the steps themselves are idempotent.
const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};
const settings = {
  adminUrl: env('GARAGE_ADMIN_URL'),
  adminToken: env('GARAGE_ADMIN_TOKEN'),
  accessKeyId: env('S3_ACCESS_KEY_ID'),
  secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
  bucket: env('S3_BUCKET'),
  zone: process.env.GARAGE_ZONE ?? 'dc1',
  capacityBytes: Number(process.env.GARAGE_CAPACITY_BYTES ?? 20 * 1024 ** 3),
};

for (let attempt = 1; ; attempt++) {
  try {
    await bootstrapGarage(settings);
    break;
  } catch (err) {
    if (attempt >= 30) {
      console.error('garage bootstrap failed:', String(err));
      process.exit(1);
    }
    console.error(`garage not ready (${String(err)}), attempt ${attempt}, retrying in 2s`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
console.log('garage bootstrapped (layout, key, bucket)');
