/**
 * Exécute toutes les migrations dans l'ordre.
 * Usage : node migrations/run_migrations.js
 *
 * IMPORTANT : Faire un pg_dump AVANT d'exécuter ce script en production.
 *   pg_dump $DATABASE_URL > backup_pre_migration.sql
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant. Vérifie ton fichier .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const MIGRATIONS = [
  '001_extensions.sql',
  '002_users_evolution.sql',
  '003_studios_evolution.sql',
  '004_photos_migration.sql',
  '005_nouvelles_tables.sql',
];

async function run() {
  const client = await pool.connect();
  try {
    // Table de suivi des migrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    for (const filename of MIGRATIONS) {
      // Vérifier si déjà appliquée
      const { rowCount } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      );

      if (rowCount > 0) {
        console.log(`⏭  ${filename} — déjà appliquée, ignorée`);
        continue;
      }

      const filepath = path.join(__dirname, filename);
      if (!fs.existsSync(filepath)) {
        console.error(`❌ Fichier introuvable : ${filepath}`);
        process.exit(1);
      }

      const sql = fs.readFileSync(filepath, 'utf-8');

      console.log(`⏳ Application de ${filename}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
        console.log(`✅ ${filename} — appliquée`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Erreur dans ${filename} :`, err.message);
        console.error('   → Transaction annulée. Les migrations précédentes sont conservées.');
        process.exit(1);
      }
    }

    console.log('\n🎉 Toutes les migrations sont appliquées.\n');

    // Vérification finale
    const { rows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('Tables présentes en base :');
    rows.forEach(r => console.log(`  • ${r.table_name}`));

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
