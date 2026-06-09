import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

const envFile = path.resolve(__dirname, '../.env.test');
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
}

process.env.JWT_RESET_SECRET ??= 'test-reset-secret-at-least-32-chars!!';

// R2 / object-storage config is required at app boot (storage.config.ts).
// Integration tests never call R2, so throwaway values are enough to satisfy
// the config factory and let the Nest app instantiate.
process.env.R2_ACCOUNT_ID ??= 'test-account';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-key';
process.env.R2_BUCKET ??= 'test-bucket';
