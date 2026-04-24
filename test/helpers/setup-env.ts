import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

const envFile = path.resolve(__dirname, '../.env.test');
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
}
