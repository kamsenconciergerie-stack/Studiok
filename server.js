const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'studiokay_secret_2025';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── PostgreSQL ──
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('📦 PostgreSQL activé');
}

// ── Nodemailer ──
let transporter = null;
if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });
  console.log('📧 Email activé');
}

// ── HELPERS ──
const DB_PATH = path.join(__dirname, 'data', 'studios.json');
const RES_PATH = path.join(__dirname, 'data', 'reservations.json');
const USR_PATH = path.join(__dirname, 'data', 'users.json');

function readFile(p) {
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return []; }
}
function writeFile(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ── MIDDLEWARE AUTH ──
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'Non autorisé' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Token invalide' });
  }
}

// ── EMAIL TEMPLATES ──
async function sendConfirmationEmail(to, data) {
  if (!transporter) return;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0F0D0B;color:#F5EFE6;padding:40px;border-radius:12px;">
      <h1 style="color:#C8732A;font-size:28px;margin-bottom:4px;">StudioKay</h1>
      <p style="color:#8A7B6E;margin-top:0;">Là où la créativité bat son plein</p>
      <hr style="border:1px solid #2C2015;margin:24px 0;">
      <h2 style="color:#D4A843;">✅ Réservation confirmée !</h2>
      <p>Bonjour <strong>${data.nom}</strong>,</p>
      <p>Votre réservation a bien été enregistrée. Voici le récapitulatif :</p>
      <div style="background:#1A1713;border-radius:8px;padding:20px;margin:20px 0;">
        <p><strong>🎬 Studio :</strong> ${data.studio}</p>
        <p><strong>📅 Date :</strong> ${data.date_debut}</p>
        <p><strong>⏱️ Durée :</strong> ${data.nb_heures}h</p>
        <p><strong>💰 Montant total :</strong> ${data.montant.toLocaleString()} XOF</p>
        <p><strong>🔖 Référence :</strong> ${data.ref}</p>
      </div>
      <p style="color:#8A7B6E;font-size:13px;">L'hôte vous contactera pour confirmer les détails d'accès.</p>
      <hr style="border:1px solid #2C2015;margin:24px 0;">
      <p style="color:#8A7B6E;font-size:12px;text-align:center;">Un produit de Yaqin · Dakar, Sénégal 🇸🇳</p>
    </div>`;
  await transporter.sendMail({
    from: `"StudioKay" <${process.env.GMAIL_USER}>`,
    to,
    subject: `✅ Réservation confirmée — ${data.studio}`,
    html
  });
}

async function sendUnavailableEmail(to, data) {
  if (!transporter) return;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0F0D0B;color:#F5EFE6;padding:40px;border-radius:12px;">
      <h1 style="color:#C8732A;">StudioKay</h1>
      <h2 style="color:#E05050;">❌ Créneau non disponible</h2>
      <p>Bonjour <strong>${data.nom}</strong>,</p>
      <p>Le studio <strong>${data.studio}</strong> n'est malheureusement pas disponible aux dates sélectionnées :</p>
      <div style="background:#1A1713;border-radius:8px;padding:20px;margin:20px 0;">
        <p><strong>📅 Date demandée :</strong> ${data.date_debut}</p>
        <p><strong>⏱️ Durée :</strong> ${data.nb_heures}h</p>
      </div>
      <p>Consultez les disponibilités du studio et choisissez un autre créneau.</p>
      <a href="${process.env.APP_URL || 'https://studiokay.up.railway.app'}" style="background:#C8732A;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:16px;">Voir les disponibilités</a>
      <p style="color:#8A7B6E;font-size:12px;text-align:center;margin-top:32px;">Un produit de Yaqin · Dakar, Sénégal 🇸🇳</p>
    </div>`;
  await transporter.sendMail({
    from: `"StudioKay" <${process.env.GMAIL_USER}>`,
    to,
    subject: `❌ Créneau non disponible — ${data.studio}`,
    html
  });
}

// ══════════════════════════════════════
// ── ROUTES AUTH ──
// ══════════════════════════════════════

// Inscription
app.post('/api/auth/register', async (req, res) => {
  try {
    const { nom, email, password, telephone, role } = req.body;
    if (!nom || !email || !password)
      return res.status(400).json({ success: false, message: 'nom, email et password requis' });

    const hash = await bcrypt.hash(password, 10);

    if (pool) {
      const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
      if (exists.rowCount > 0)
        return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
      const result = await pool.query(
        'INSERT INTO users (nom,email,password_hash,telephone,role) VALUES ($1,$2,$3,$4,$5) RETURNING id,nom,email,role',
        [nom, email, hash, telephone || null, role || 'createur']
      );
      const user = result.rows[0];
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      return res.status(201).json({ success: true, token, user });
    }

    // fallback JSON
    const users = readFile(USR_PATH);
    if (users.find(u => u.email === email))
      return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
    const newUser = { id: Date.now().toString(), nom, email, password_hash: hash, telephone: telephone || null, role: role || 'createur', created_at: new Date().toISOString() };
    users.push(newUser);
    writeFile(USR_PATH, users);
    const token = jwt.sign({ id: newUser.id, email: newUser.email, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, token, user: { id: newUser.id, nom, email, role: newUser.role } });

  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Connexion
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'email et password requis' });

    let user;
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
      if (result.rowCount === 0) return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
      user = result.rows[0];
    } else {
      user = readFile(USR_PATH).find(u => u.email === email);
      if (!user) return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, nom: user.nom }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, nom: user.nom, email: user.email, role: user.role } });

  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Profil
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query('SELECT id,nom,email,role,telephone,created_at FROM users WHERE id=$1', [req.user.id]);
      if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
      return res.json({ success: true, user: result.rows[0] });
    }
    const user = readFile(USR_PATH).find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    const { password_hash, ...safe } = user;
    res.json({ success: true, user: safe });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ══════════════════════════════════════
// ── ROUTES STUDIOS ──
// ══════════════════════════════════════

app.get('/api/studios', async (req, res) => {
  try {
    const { ville, type, budget_max, disponible } = req.query;
    if (pool) {
      let query = 'SELECT * FROM studios WHERE 1=1';
      const vals = [];
      if (ville)       { vals.push(`%${ville}%`);         query += ` AND ville ILIKE $${vals.length}`; }
      if (type)        { vals.push(`%${type}%`);          query += ` AND type  ILIKE $${vals.length}`; }
      if (budget_max)  { vals.push(parseInt(budget_max)); query += ` AND prix_heure <= $${vals.length}`; }
      if (disponible)  { vals.push(disponible === 'true'); query += ` AND disponible = $${vals.length}`; }
      query += ' ORDER BY note DESC, nb_avis DESC';
      const result = await pool.query(query, vals);
      return res.json({ success: true, count: result.rowCount, data: result.rows });
    }
    let data = readFile(DB_PATH);
    if (ville)      data = data.filter(s => s.ville.toLowerCase().includes(ville.toLowerCase()));
    if (type)       data = data.filter(s => s.type.toLowerCase().includes(type.toLowerCase()));
    if (budget_max) data = data.filter(s => s.prix_heure <= parseInt(budget_max));
    res.json({ success: true, count: data.length, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/studios/:id', async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query('SELECT * FROM studios WHERE id=$1', [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Studio introuvable' });
      return res.json({ success: true, data: result.rows[0] });
    }
    const studio = readFile(DB_PATH).find(s => String(s.id) === req.params.id);
    if (!studio) return res.status(404).json({ success: false, message: 'Studio introuvable' });
    res.json({ success: true, data: studio });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/studios', authMiddleware, async (req, res) => {
  try {
    const { nom, ville, quartier, type, prix_heure, description, equipements } = req.body;
    if (!nom || !ville || !type || !prix_heure)
      return res.status(400).json({ success: false, message: 'Champs requis manquants' });
    if (pool) {
      const result = await pool.query(
        'INSERT INTO studios (hote_id,nom,ville,quartier,type,prix_heure,description,equipements) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [req.user.id, nom, ville, quartier||null, type, prix_heure, description||'', equipements||[]]
      );
      return res.status(201).json({ success: true, data: result.rows[0] });
    }
    const studios = readFile(DB_PATH);
    const s = { id: Date.now().toString(), hote_id: req.user.id, nom, ville, quartier: quartier||null, type, prix_heure: parseInt(prix_heure), description: description||'', equipements: equipements||[], note: 0, nb_avis: 0, disponible: true, created_at: new Date().toISOString() };
    studios.push(s);
    writeFile(DB_PATH, studios);
    res.status(201).json({ success: true, data: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ══════════════════════════════════════
// ── ROUTES DISPONIBILITÉS ──
// ══════════════════════════════════════

// Créneaux occupés d'un studio pour un mois donné
app.get('/api/studios/:id/disponibilites', async (req, res) => {
  try {
    const { mois, annee } = req.query; // ex: mois=6&annee=2025
    const studioId = req.params.id;

    if (pool) {
      const result = await pool.query(
        `SELECT date_debut, date_fin FROM reservations
         WHERE studio_id=$1 AND statut != 'annulee'
         AND EXTRACT(MONTH FROM date_debut) = $2
         AND EXTRACT(YEAR  FROM date_debut) = $3`,
        [studioId, mois || new Date().getMonth()+1, annee || new Date().getFullYear()]
      );
      return res.json({ success: true, occupes: result.rows });
    }

    const reservations = readFile(RES_PATH).filter(r =>
      String(r.studio_id) === studioId && r.statut !== 'annulee'
    );
    res.json({ success: true, occupes: reservations.map(r => ({ date_debut: r.date_debut, date_fin: r.date_fin })) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Vérifier si un créneau est disponible
app.post('/api/studios/:id/verifier', async (req, res) => {
  try {
    const { date_debut, date_fin } = req.body;
    if (!date_debut || !date_fin)
      return res.status(400).json({ success: false, message: 'date_debut et date_fin requis' });

    if (pool) {
      const result = await pool.query(
        `SELECT id FROM reservations
         WHERE studio_id=$1 AND statut != 'annulee'
         AND tsrange(date_debut, date_fin) && tsrange($2::timestamp, $3::timestamp)`,
        [req.params.id, date_debut, date_fin]
      );
      return res.json({ success: true, disponible: result.rowCount === 0 });
    }

    const reservations = readFile(RES_PATH).filter(r =>
      String(r.studio_id) === req.params.id && r.statut !== 'annulee'
    );
    const debut = new Date(date_debut);
    const fin   = new Date(date_fin);
    const conflit = reservations.some(r => {
      const d = new Date(r.date_debut);
      const f = new Date(r.date_fin);
      return debut < f && fin > d;
    });
    res.json({ success: true, disponible: !conflit });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ══════════════════════════════════════
// ── ROUTES RÉSERVATIONS ──
// ══════════════════════════════════════

app.post('/api/reservations', authMiddleware, async (req, res) => {
  try {
    const { studio_id, date_debut, date_fin, nb_heures, message } = req.body;
    if (!studio_id || !date_debut || !date_fin || !nb_heures)
      return res.status(400).json({ success: false, message: 'Champs requis manquants' });

    // Récupérer le studio
    let studio;
    if (pool) {
      const sr = await pool.query('SELECT * FROM studios WHERE id=$1', [studio_id]);
      if (sr.rowCount === 0) return res.status(404).json({ success: false, message: 'Studio introuvable' });
      studio = sr.rows[0];
    } else {
      studio = readFile(DB_PATH).find(s => String(s.id) === String(studio_id));
      if (!studio) return res.status(404).json({ success: false, message: 'Studio introuvable' });
    }

    // ── VÉRIFICATION DISPONIBILITÉ ──
    let disponible = true;
    if (pool) {
      const check = await pool.query(
        `SELECT id FROM reservations WHERE studio_id=$1 AND statut != 'annulee'
         AND tsrange(date_debut, date_fin) && tsrange($2::timestamp, $3::timestamp)`,
        [studio_id, date_debut, date_fin]
      );
      disponible = check.rowCount === 0;
    } else {
      const reservations = readFile(RES_PATH).filter(r =>
        String(r.studio_id) === String(studio_id) && r.statut !== 'annulee'
      );
      const debut = new Date(date_debut);
      const fin   = new Date(date_fin);
      disponible = !reservations.some(r => {
        const d = new Date(r.date_debut);
        const f = new Date(r.date_fin);
        return debut < f && fin > d;
      });
    }

    // ── CAS : NON DISPONIBLE ──
    if (!disponible) {
      // Envoyer email d'indisponibilité
      let userEmail, userName;
      if (pool) {
        const ur = await pool.query('SELECT nom, email FROM users WHERE id=$1', [req.user.id]);
        userEmail = ur.rows[0]?.email;
        userName  = ur.rows[0]?.nom;
      } else {
        const u = readFile(USR_PATH).find(u => u.id === req.user.id);
        userEmail = u?.email;
        userName  = u?.nom;
      }
      await sendUnavailableEmail(userEmail, {
        nom: userName,
        studio: studio.nom,
        date_debut: new Date(date_debut).toLocaleString('fr-FR'),
        nb_heures
      });
      return res.status(409).json({
        success: false,
        disponible: false,
        message: 'Ce créneau est déjà réservé. Veuillez choisir une autre date.'
      });
    }

    // ── CAS : DISPONIBLE → CRÉER LA RÉSERVATION ──
    const montant_total = studio.prix_heure * parseInt(nb_heures);
    let reservation;

    if (pool) {
      const result = await pool.query(
        `INSERT INTO reservations (studio_id, user_id, date_debut, date_fin, nb_heures, montant_total, statut, message)
         VALUES ($1,$2,$3,$4,$5,$6,'confirmee',$7) RETURNING *`,
        [studio_id, req.user.id, date_debut, date_fin, nb_heures, montant_total, message||null]
      );
      reservation = result.rows[0];
    } else {
      const reservations = readFile(RES_PATH);
      reservation = {
        id: Date.now().toString(), studio_id, user_id: req.user.id,
        date_debut, date_fin, nb_heures: parseInt(nb_heures),
        montant_total, statut: 'confirmee', message: message||null,
        created_at: new Date().toISOString()
      };
      reservations.push(reservation);
      writeFile(RES_PATH, reservations);
    }

    // ── ENVOYER EMAIL DE CONFIRMATION ──
    let userEmail, userName;
    if (pool) {
      const ur = await pool.query('SELECT nom, email FROM users WHERE id=$1', [req.user.id]);
      userEmail = ur.rows[0]?.email;
      userName  = ur.rows[0]?.nom;
    } else {
      const u = readFile(USR_PATH).find(u => u.id === req.user.id);
      userEmail = u?.email;
      userName  = u?.nom;
    }

    await sendConfirmationEmail(userEmail, {
      nom: userName,
      studio: studio.nom,
      date_debut: new Date(date_debut).toLocaleString('fr-FR'),
      nb_heures,
      montant: montant_total,
      ref: reservation.id
    });

    res.status(201).json({
      success: true,
      disponible: true,
      message: 'Réservation confirmée ! Un email de confirmation vous a été envoyé.',
      data: reservation
    });

  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Mes réservations
app.get('/api/reservations/mes', authMiddleware, async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query(
        `SELECT r.*, s.nom as studio_nom, s.ville, s.type, s.prix_heure
         FROM reservations r JOIN studios s ON r.studio_id = s.id
         WHERE r.user_id=$1 ORDER BY r.created_at DESC`,
        [req.user.id]
      );
      return res.json({ success: true, data: result.rows });
    }
    const reservations = readFile(RES_PATH).filter(r => r.user_id === req.user.id);
    res.json({ success: true, data: reservations });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Annuler une réservation
app.patch('/api/reservations/:id/annuler', authMiddleware, async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query(
        `UPDATE reservations SET statut='annulee' WHERE id=$1 AND user_id=$2 RETURNING *`,
        [req.params.id, req.user.id]
      );
      if (result.rowCount === 0)
        return res.status(404).json({ success: false, message: 'Réservation introuvable' });
      return res.json({ success: true, data: result.rows[0] });
    }
    const reservations = readFile(RES_PATH);
    const idx = reservations.findIndex(r => r.id === req.params.id && r.user_id === req.user.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Réservation introuvable' });
    reservations[idx].statut = 'annulee';
    writeFile(RES_PATH, reservations);
    res.json({ success: true, data: reservations[idx] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PAGE PRINCIPALE ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── INIT DB ──
async function initDB() {
  if (!pool) return;
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      nom VARCHAR(100) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) DEFAULT 'createur',
      telephone VARCHAR(20), created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS studios (
      id SERIAL PRIMARY KEY, hote_id UUID,
      nom VARCHAR(255) NOT NULL, ville VARCHAR(100) NOT NULL,
      quartier VARCHAR(100), type VARCHAR(100) NOT NULL,
      prix_heure INTEGER NOT NULL, description TEXT,
      equipements TEXT[], photos TEXT[], note DECIMAL(3,2) DEFAULT 0,
      nb_avis INTEGER DEFAULT 0, disponible BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS reservations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      studio_id INTEGER, user_id UUID,
      date_debut TIMESTAMP NOT NULL, date_fin TIMESTAMP NOT NULL,
      nb_heures INTEGER NOT NULL, montant_total INTEGER NOT NULL,
      statut VARCHAR(20) DEFAULT 'confirmee',
      message TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    // Insérer données de démo si vide
    const count = await pool.query('SELECT COUNT(*) FROM studios');
    if (parseInt(count.rows[0].count) === 0) {
      await pool.query(`INSERT INTO studios (nom,ville,quartier,type,prix_heure,description,equipements,note,nb_avis) VALUES
        ('Studio Lumière','Dakar','Almadies','Photo & Vidéo',15000,'Studio photo pro avec cyclorama blanc.',ARRAY['Cyclorama blanc','Flash Godox x3','Loge privée'],4.97,83),
        ('SoundBox Podcast','Dakar','Plateau','Podcast',20000,'Studio podcast insonorisé.',ARRAY['Insonorisé','Micro Shure SM7B','Interface Focusrite'],5.0,41),
        ('Créa Palace','Dakar','Mermoz','Clip & Tournage',35000,'Grand studio tournage.',ARRAY['Décors modulables','Caméra Sony 4K','Éclairage cinéma'],4.9,127),
        ('Atelier Teranga','Dakar','Fann','Atelier Créatif',8000,'Atelier artistique lumineux.',ARRAY['Lumière naturelle','Toiles & chevalets','Rooftop'],4.85,58),
        ('BeatRoom Studio','Dakar','Grand-Yoff','Musique',25000,'Studio enregistrement pro.',ARRAY['Console SSL','Cabine isolée','Pro Tools'],4.93,74),
        ('Le Salon Content','Dakar','Ouakam','Lifestyle',18000,'Studio lifestyle vue mer.',ARRAY['Vue mer','Décors lifestyle','Prop room'],4.88,92)`);
    }
    console.log('✅ DB initialisée');
  } catch (err) { console.error('DB init error:', err.message); }
}

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ StudioKay → http://localhost:${PORT}`);
  });
});
