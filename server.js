const express = require('express');
const path    = require('path');
const fs      = require('fs');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── BASE DE DONNÉES ──
// Si DATABASE_URL est défini (PostgreSQL), on l'utilise.
// Sinon, on tombe sur le fichier JSON local (parfait pour Replit sans DB).
let pool = null;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('📦 Mode PostgreSQL activé');
} else {
  console.log('📂 Mode fichier JSON (pas de DATABASE_URL trouvée)');
}

// ── HELPERS JSON FALLBACK ──
const DB_PATH = path.join(__dirname, 'data', 'studios.json');

function readJSON() {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeJSON(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── INIT TABLE PostgreSQL ──
async function initDB() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS studios (
      id          SERIAL PRIMARY KEY,
      nom         VARCHAR(255) NOT NULL,
      ville       VARCHAR(100) NOT NULL,
      type        VARCHAR(100) NOT NULL,
      prix_heure  INTEGER NOT NULL,
      description TEXT,
      equipements TEXT[],
      note        DECIMAL(3,2) DEFAULT 0,
      disponible  BOOLEAN DEFAULT true,
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ Table studios prête');
}

// ── PAGE PRINCIPALE ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── GET tous les studios ──
app.get('/api/studios', async (req, res) => {
  try {
    const { ville, type, budget_max } = req.query;

    if (pool) {
      let query  = 'SELECT * FROM studios WHERE 1=1';
      const vals = [];
      if (ville)      { vals.push(`%${ville}%`);       query += ` AND ville ILIKE $${vals.length}`; }
      if (type)       { vals.push(`%${type}%`);        query += ` AND type  ILIKE $${vals.length}`; }
      if (budget_max) { vals.push(parseInt(budget_max)); query += ` AND prix_heure <= $${vals.length}`; }
      query += ' ORDER BY created_at DESC';
      const result = await pool.query(query, vals);
      return res.json({ success: true, count: result.rowCount, data: result.rows });
    }

    // fallback JSON
    let data = readJSON();
    if (ville)      data = data.filter(s => s.ville.toLowerCase().includes(ville.toLowerCase()));
    if (type)       data = data.filter(s => s.type.toLowerCase().includes(type.toLowerCase()));
    if (budget_max) data = data.filter(s => s.prix_heure <= parseInt(budget_max));
    res.json({ success: true, count: data.length, data });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET un studio ──
app.get('/api/studios/:id', async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query('SELECT * FROM studios WHERE id = $1', [req.params.id]);
      if (result.rowCount === 0)
        return res.status(404).json({ success: false, message: 'Studio introuvable' });
      return res.json({ success: true, data: result.rows[0] });
    }
    const studio = readJSON().find(s => s.id === req.params.id);
    if (!studio) return res.status(404).json({ success: false, message: 'Studio introuvable' });
    res.json({ success: true, data: studio });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST créer un studio ──
app.post('/api/studios', async (req, res) => {
  try {
    const { nom, ville, type, prix_heure, description, equipements, note } = req.body;
    if (!nom || !ville || !type || !prix_heure)
      return res.status(400).json({ success: false, message: 'Champs requis : nom, ville, type, prix_heure' });

    if (pool) {
      const result = await pool.query(
        `INSERT INTO studios (nom, ville, type, prix_heure, description, equipements, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [nom, ville, type, prix_heure, description || '', equipements || [], note || 0]
      );
      return res.status(201).json({ success: true, data: result.rows[0] });
    }

    const studios = readJSON();
    const newStudio = {
      id: Date.now().toString(), nom, ville, type,
      prix_heure: parseInt(prix_heure),
      description: description || '',
      equipements: equipements || [],
      note: note || 0,
      disponible: true,
      created_at: new Date().toISOString()
    };
    studios.push(newStudio);
    writeJSON(studios);
    res.status(201).json({ success: true, data: newStudio });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT modifier un studio ──
app.put('/api/studios/:id', async (req, res) => {
  try {
    const { nom, ville, type, prix_heure, description, equipements, note, disponible } = req.body;

    if (pool) {
      const result = await pool.query(
        `UPDATE studios SET nom=$1, ville=$2, type=$3, prix_heure=$4,
         description=$5, equipements=$6, note=$7, disponible=$8, updated_at=NOW()
         WHERE id=$9 RETURNING *`,
        [nom, ville, type, prix_heure, description, equipements, note, disponible, req.params.id]
      );
      if (result.rowCount === 0)
        return res.status(404).json({ success: false, message: 'Studio introuvable' });
      return res.json({ success: true, data: result.rows[0] });
    }

    const studios = readJSON();
    const idx = studios.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Studio introuvable' });
    studios[idx] = { ...studios[idx], ...req.body, id: studios[idx].id, updated_at: new Date().toISOString() };
    writeJSON(studios);
    res.json({ success: true, data: studios[idx] });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE supprimer un studio ──
app.delete('/api/studios/:id', async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query('DELETE FROM studios WHERE id=$1 RETURNING *', [req.params.id]);
      if (result.rowCount === 0)
        return res.status(404).json({ success: false, message: 'Studio introuvable' });
      return res.json({ success: true, message: `Studio "${result.rows[0].nom}" supprimé` });
    }

    const studios = readJSON();
    const idx = studios.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Studio introuvable' });
    const deleted = studios.splice(idx, 1)[0];
    writeJSON(studios);
    res.json({ success: true, message: `Studio "${deleted.nom}" supprimé` });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DÉMARRAGE ──
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ StudioKay en ligne → http://localhost:${PORT}`);
    console.log(`📦 API → http://localhost:${PORT}/api/studios`);
  });
});
