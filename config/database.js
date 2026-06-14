const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[DB] ERREUR : DATABASE_URL manquant en production.');
    process.exit(1);
  }
  console.warn('[DB] DATABASE_URL absent — mode développement sans base de données.');
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : null;

if (pool) {
  pool.connect()
    .then(client => {
      client.release();
      console.log('[DB] PostgreSQL connecté');
    })
    .catch(err => {
      console.error('[DB] Connexion échouée :', err.message);
      if (process.env.NODE_ENV === 'production') process.exit(1);
    });
}

module.exports = pool;
