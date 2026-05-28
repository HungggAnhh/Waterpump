const { Client } = require('pg');
require('dotenv').config({ path: './.env' });
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
client.connect().then(() => {
  return client.query(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      id           SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role         VARCHAR(50) DEFAULT 'member',
      joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_workspace_user UNIQUE (workspace_id, user_id)
    );
  `);
}).then(() => {
  console.log('Table workspace_members created.');
  client.end();
}).catch(err => {
  console.error(err);
  client.end();
});
