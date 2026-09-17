import { buildApp } from './app.js';
import { createDatastore } from './db/datastoreFactory.js';

const datastore = createDatastore();
const app = buildApp(datastore);
const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`Server running securely on http://${HOST}:${PORT}`);
  } catch (err) {
    console.error('Fatal error starting server:', err);
    process.exit(1);
  }
}

start();
