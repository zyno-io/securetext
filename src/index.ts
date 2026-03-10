import { start } from './server.js';

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
