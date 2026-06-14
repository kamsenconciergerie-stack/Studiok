require('dotenv').config();
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const pool       = require('./config/database');
const { uploadStudioPhotos, getPhotoVariants } = require('./config/cloudinary');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'studiokay_secret_2025';

// ── RATE LIMITING ──
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

// ── HEADERS SÉCURITÉ ──
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "img-src * data: blob:; " +
    "font-src * data:; " +
    "connect-src *; " +
    "style-src * 'unsafe-inline';"
  );
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

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
app.post('/api/auth/register', authLimiter, async (req, res) => {
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
app.post('/api/auth/login', authLimiter, async (req, res) => {
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

// ══════════════════════════════════════
// ── ROUTES PHOTOS STUDIOS ──
// ══════════════════════════════════════

// POST /api/studios/:id/photos — Upload photos d'un studio existant
app.post('/api/studios/:id/photos', authMiddleware, (req, res) => {
  uploadStudioPhotos(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message });
    }

    try {
      const studioId = parseInt(req.params.id);
      if (isNaN(studioId)) {
        return res.status(400).json({ success: false, message: 'ID studio invalide' });
      }

      // Vérifier que le studio existe et appartient à l'utilisateur (ou admin)
      if (pool) {
        const check = await pool.query(
          'SELECT id, hote_id FROM studios WHERE id = $1 AND deleted_at IS NULL',
          [studioId]
        );
        if (check.rowCount === 0) {
          return res.status(404).json({ success: false, message: 'Studio introuvable' });
        }
        const studio = check.rows[0];
        if (studio.hote_id && studio.hote_id !== req.user.id && req.user.role !== 'admin') {
          return res.status(403).json({ success: false, message: 'Non autorisé' });
        }
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'Aucune photo reçue' });
      }

      // Vérifier s'il y a déjà une photo de couverture
      let hasCover = false;
      let currentCount = 0;
      if (pool) {
        const countRes = await pool.query(
          'SELECT COUNT(*) as total, BOOL_OR(est_couverture) as has_cover FROM studio_photos WHERE studio_id = $1',
          [studioId]
        );
        hasCover = countRes.rows[0].has_cover || false;
        currentCount = parseInt(countRes.rows[0].total) || 0;
      }

      // Construire les entrées à insérer
      const photosToInsert = req.files.map((file, idx) => {
        const variants = getPhotoVariants(file.filename);
        return {
          studio_id:     studioId,
          url:           file.path,            // URL originale Cloudinary
          url_thumb:     variants.thumb,
          url_medium:    variants.medium,
          nom_fichier:   file.originalname,
          ordre:         currentCount + idx,
          est_couverture: !hasCover && idx === 0, // 1re photo = couverture si pas encore de couverture
        };
      });

      let savedPhotos = [];

      if (pool) {
        // Insertion en base avec une seule requête multi-valeurs
        const values = photosToInsert.map((p, i) => {
          const base = i * 7;
          return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7})`;
        }).join(', ');

        const params = photosToInsert.flatMap(p => [
          p.studio_id, p.url, p.url_thumb, p.url_medium,
          p.nom_fichier, p.ordre, p.est_couverture,
        ]);

        const result = await pool.query(
          `INSERT INTO studio_photos (studio_id, url, url_thumb, url_medium, nom_fichier, ordre, est_couverture)
           VALUES ${values}
           RETURNING *`,
          params
        );
        savedPhotos = result.rows;
      }

      res.status(201).json({
        success: true,
        message: `${req.files.length} photo(s) uploadée(s) avec succès`,
        data: savedPhotos.length > 0 ? savedPhotos : photosToInsert,
      });

    } catch (err) {
      console.error('Erreur upload photos:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });
});

// GET /api/studios/:id/photos — Lister les photos d'un studio
app.get('/api/studios/:id/photos', async (req, res) => {
  try {
    const studioId = parseInt(req.params.id);
    if (isNaN(studioId)) {
      return res.status(400).json({ success: false, message: 'ID studio invalide' });
    }

    if (pool) {
      const result = await pool.query(
        'SELECT * FROM studio_photos WHERE studio_id = $1 ORDER BY est_couverture DESC, ordre ASC',
        [studioId]
      );
      return res.json({ success: true, count: result.rowCount, data: result.rows });
    }

    res.json({ success: true, count: 0, data: [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/studios/:id/photos/:photoId — Supprimer une photo
app.delete('/api/studios/:id/photos/:photoId', authMiddleware, async (req, res) => {
  try {
    const studioId = parseInt(req.params.id);
    const photoId  = req.params.photoId;

    if (!pool) {
      return res.status(503).json({ success: false, message: 'Base de données non connectée' });
    }

    // Vérifier l'appartenance du studio
    const studioCheck = await pool.query(
      'SELECT hote_id FROM studios WHERE id = $1 AND deleted_at IS NULL',
      [studioId]
    );
    if (studioCheck.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Studio introuvable' });
    }
    const studio = studioCheck.rows[0];
    if (studio.hote_id && studio.hote_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Non autorisé' });
    }

    // Récupérer la photo avant suppression (pour supprimer sur Cloudinary)
    const photoRes = await pool.query(
      'SELECT * FROM studio_photos WHERE id = $1 AND studio_id = $2',
      [photoId, studioId]
    );
    if (photoRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Photo introuvable' });
    }
    const photo = photoRes.rows[0];

    // Supprimer de la base
    await pool.query('DELETE FROM studio_photos WHERE id = $1', [photoId]);

    // Si c'était la couverture, promouvoir la photo suivante
    if (photo.est_couverture) {
      await pool.query(
        `UPDATE studio_photos
         SET est_couverture = true
         WHERE studio_id = $1 AND id = (
           SELECT id FROM studio_photos WHERE studio_id = $1 ORDER BY ordre ASC LIMIT 1
         )`,
        [studioId]
      );
    }

    // Supprimer de Cloudinary (extraire le public_id depuis l'URL)
    try {
      const { cloudinary } = require('./config/cloudinary');
      // public_id = tout ce qui est entre le cloud_name et l'extension dans l'URL
      const urlParts = photo.url.split('/');
      const uploadIndex = urlParts.findIndex(p => p === 'upload');
      if (uploadIndex !== -1) {
        // Retirer la version (v1234567890) si présente
        const afterUpload = urlParts.slice(uploadIndex + 1);
        if (afterUpload[0].startsWith('v')) afterUpload.shift();
        const publicIdWithExt = afterUpload.join('/');
        const publicId = publicIdWithExt.replace(/\.[^/.]+$/, ''); // retirer l'extension
        await cloudinary.uploader.destroy(publicId);
      }
    } catch (cdnErr) {
      console.warn('Suppression Cloudinary échouée (non bloquant):', cdnErr.message);
    }

    res.json({ success: true, message: 'Photo supprimée' });
  } catch (err) {
    console.error('Erreur suppression photo:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/studios/:id/photos/:photoId/couverture — Définir comme photo de couverture
app.patch('/api/studios/:id/photos/:photoId/couverture', authMiddleware, async (req, res) => {
  try {
    const studioId = parseInt(req.params.id);
    const photoId  = req.params.photoId;

    if (!pool) {
      return res.status(503).json({ success: false, message: 'Base de données non connectée' });
    }

    const studioCheck = await pool.query(
      'SELECT hote_id FROM studios WHERE id = $1 AND deleted_at IS NULL',
      [studioId]
    );
    if (studioCheck.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Studio introuvable' });
    }
    const studio = studioCheck.rows[0];
    if (studio.hote_id && studio.hote_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Non autorisé' });
    }

    // Retirer l'ancienne couverture, définir la nouvelle
    await pool.query(
      'UPDATE studio_photos SET est_couverture = false WHERE studio_id = $1',
      [studioId]
    );
    const result = await pool.query(
      'UPDATE studio_photos SET est_couverture = true WHERE id = $1 AND studio_id = $2 RETURNING *',
      [photoId, studioId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Photo introuvable' });
    }

    res.json({ success: true, message: 'Photo de couverture mise à jour', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PAGE PRINCIPALE ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



// ══════════════════════════════════════
// ── ROUTES ADMIN ──
// ══════════════════════════════════════

// Middleware admin
function adminMiddleware(req, res, next) {
  // Pour l'instant on accepte tout token valide
  // En production: vérifier role === 'admin'
  const auth = req.headers.authorization;
  if (!auth) return next(); // accès libre pour démo
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    next();
  }
}

// Page admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// GET toutes les réservations (admin)
app.get('/api/admin/reservations', adminMiddleware, async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query(
        `SELECT r.*, s.nom as studio_nom, u.email as user_email, u.nom as user_nom
         FROM reservations r
         LEFT JOIN studios s ON r.studio_id = s.id
         LEFT JOIN users u ON r.user_id = u.id
         ORDER BY r.created_at DESC`
      );
      return res.json({ success: true, count: result.rowCount, data: result.rows });
    }
    const reservations = readFile(RES_PATH);
    res.json({ success: true, count: reservations.length, data: reservations });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET tous les utilisateurs (admin)
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query(
        'SELECT id, nom, email, role, telephone, created_at FROM users ORDER BY created_at DESC'
      );
      return res.json({ success: true, count: result.rowCount, data: result.rows });
    }
    const users = readFile(USR_PATH).map(({ password_hash, ...u }) => u);
    res.json({ success: true, count: users.length, data: users });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE utilisateur (admin)
app.delete('/api/admin/users/:id', adminMiddleware, async (req, res) => {
  try {
    if (pool) {
      await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
      return res.json({ success: true, message: 'Utilisateur supprimé' });
    }
    const users = readFile(USR_PATH).filter(u => u.id !== req.params.id);
    writeFile(USR_PATH, users);
    res.json({ success: true, message: 'Utilisateur supprimé' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT modifier statut réservation (admin)
app.put('/api/admin/reservations/:id', adminMiddleware, async (req, res) => {
  try {
    const { statut } = req.body;
    if (pool) {
      const result = await pool.query(
        'UPDATE reservations SET statut=$1 WHERE id=$2 RETURNING *',
        [statut, req.params.id]
      );
      return res.json({ success: true, data: result.rows[0] });
    }
    const reservations = readFile(RES_PATH);
    const idx = reservations.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Introuvable' });
    reservations[idx].statut = statut;
    writeFile(RES_PATH, reservations);
    res.json({ success: true, data: reservations[idx] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET stats dashboard admin
app.get('/api/admin/stats', adminMiddleware, async (req, res) => {
  try {
    if (pool) {
      const [studios, reservations, users, revenu] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM studios WHERE disponible=true'),
        pool.query("SELECT COUNT(*) FROM reservations WHERE statut='confirmee'"),
        pool.query('SELECT COUNT(*) FROM users'),
        pool.query("SELECT COALESCE(SUM(montant_total),0) as total FROM reservations WHERE statut='confirmee'")
      ]);
      return res.json({
        success: true,
        data: {
          studios: parseInt(studios.rows[0].count),
          reservations: parseInt(reservations.rows[0].count),
          users: parseInt(users.rows[0].count),
          revenu: parseInt(revenu.rows[0].total)
        }
      });
    }
    res.json({ success: true, data: { studios: 10, reservations: 0, users: 0, revenu: 0 } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PROPOSER UN STUDIO ──
app.post('/api/proposer-studio', async (req, res) => {
  try {
    const { nom, tel, email, studioNom, ville, type, prix, description } = req.body;
    if (!nom || !email || !studioNom)
      return res.status(400).json({ success: false, message: 'Champs requis manquants' });

    // Email à l'équipe StudioKay
    if (transporter) {
      await transporter.sendMail({
        from: `"StudioKay" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `🏠 Nouvelle demande de studio — ${studioNom}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0F0D0B;color:#F5EFE6;padding:40px;border-radius:12px;">
            <h1 style="color:#C8732A;">StudioKay</h1>
            <h2 style="color:#D4A843;">🏠 Nouvelle demande de studio</h2>
            <div style="background:#1A1713;border-radius:8px;padding:20px;margin:20px 0;">
              <p><strong>👤 Nom :</strong> ${nom}</p>
              <p><strong>📧 Email :</strong> ${email}</p>
              <p><strong>📱 Téléphone :</strong> ${tel}</p>
              <hr style="border:1px solid #2C2015;margin:16px 0;">
              <p><strong>🎬 Studio :</strong> ${studioNom}</p>
              <p><strong>📍 Ville :</strong> ${ville}</p>
              <p><strong>🎯 Type :</strong> ${type}</p>
              <p><strong>💰 Prix / heure :</strong> ${Number(prix).toLocaleString('fr-FR')} XOF</p>
              <p><strong>📝 Description :</strong> ${description || 'Non renseignée'}</p>
            </div>
            <p style="color:#8A7B6E;font-size:13px;">Reçu le ${new Date().toLocaleString('fr-FR')}</p>
            <p style="color:#8A7B6E;font-size:12px;text-align:center;margin-top:32px;">Un produit de Yaqin · Dakar, Sénégal 🇸🇳</p>
          </div>`
      });

      // Email de confirmation au demandeur
      await transporter.sendMail({
        from: `"StudioKay" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `✅ Demande reçue — ${studioNom}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0F0D0B;color:#F5EFE6;padding:40px;border-radius:12px;">
            <h1 style="color:#C8732A;">StudioKay</h1>
            <h2 style="color:#D4A843;">✅ Demande bien reçue !</h2>
            <p>Bonjour <strong>${nom}</strong>,</p>
            <p>Nous avons bien reçu votre demande pour <strong>${studioNom}</strong>.</p>
            <p>Notre équipe va examiner votre dossier et vous recontactera sous <strong>48h</strong> à l'adresse <strong>${email}</strong> ou au <strong>${tel}</strong>.</p>
            <div style="background:#1A1713;border-radius:8px;padding:20px;margin:20px 0;">
              <p><strong>🎬 Studio :</strong> ${studioNom}</p>
              <p><strong>📍 Ville :</strong> ${ville}</p>
              <p><strong>🎯 Type :</strong> ${type}</p>
              <p><strong>💰 Prix / heure :</strong> ${Number(prix).toLocaleString('fr-FR')} XOF</p>
            </div>
            <p style="color:#8A7B6E;font-size:12px;text-align:center;margin-top:32px;">Un produit de Yaqin · Dakar, Sénégal 🇸🇳</p>
          </div>`
      });
    }

    res.json({ success: true, message: 'Demande envoyée avec succès' });
  } catch (err) {
    console.error('Erreur proposer studio:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── RESET STUDIOS (admin) ──
app.get('/api/admin/reset-studios', async (req, res) => {
  if (!pool) return res.json({ success: false, message: 'PostgreSQL non connecté' });
  try {
    await pool.query('DELETE FROM studios');
    await pool.query(`INSERT INTO studios (nom,ville,quartier,type,prix_heure,description,equipements,note,nb_avis) VALUES
      ('Studio Lumière','Dakar','Almadies','Photo & Vidéo',15000,'Studio photo pro avec cyclorama blanc, éclairage Godox et loge privée.',ARRAY['Cyclorama blanc','Flash Godox x3','Loge privée','Climatisation'],4.97,83),
      ('SoundBox Podcast','Dakar','Plateau','Podcast',20000,'Studio podcast insonorisé. Micro Shure SM7B et interface Focusrite.',ARRAY['Insonorisé','Micro Shure SM7B','Interface Focusrite','Casques monitoring'],5.0,41),
      ('Oxygen Sound Studio','Dakar','Mermoz','Musique',25000,'Studio enregistrement pro avec console SSL et cabine isolée.',ARRAY['Console SSL','Cabine isolée','Pro Tools','Beatmaker dispo'],4.93,74),
      ('Le Studio Blanc','Dakar','Ouakam','Photo & Vidéo',18000,'Studio lifestyle vue mer avec prop room.',ARRAY['Vue mer','Décors lifestyle','Prop room','Ring light'],4.95,92),
      ('Reverse Stage','Dakar','Grand-Yoff','Clip & Tournage',35000,'Grand studio tournage avec décors modulables et caméra Sony 4K.',ARRAY['Décors modulables','Caméra Sony 4K','Éclairage cinéma','Staff technique'],4.9,127),
      ('Sart Space','Dakar','Fann','Atelier Créatif',8000,'Atelier artistique lumineux avec rooftop.',ARRAY['Lumière naturelle','Toiles & chevalets','Rooftop','Matériel photo'],4.85,58),
      ('Studio Jaaytaar','Dakar','Sacré-Cœur','Lifestyle',22000,'Studio lifestyle moderne pour créateurs de contenu.',ARRAY['Décors modulables','Éclairage naturel','Fonds colorés','Accessoires props'],4.93,67),
      ('Traart Sound','Dakar','Point E','Musique',30000,'Studio son haut de gamme pour artistes professionnels.',ARRAY['Console Neve','Cabine insonorisée','Pro Tools HDX','Moniteurs Genelec'],4.88,89),
      ('Studio Brun','Dakar','Liberté 6','Clip & Tournage',12000,'Studio vidéo polyvalent pour interviews et tournages.',ARRAY['Fond vert','Éclairage LED','Caméra mirrorless','Prompteur'],4.82,45),
      ('Le Studio Cosy','Dakar','Médina','Podcast',16000,'Studio podcast intimiste et chaleureux.',ARRAY['Insonorisé','Micros Rode','Interface audio','Décor chaleureux'],4.96,103)`);
    const count = await pool.query('SELECT COUNT(*) FROM studios');
    res.json({ success: true, message: `${count.rows[0].count} studios chargés en base !` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── FORMULAIRE PROPOSITION STUDIO (avec photos) ──
app.post('/api/proposer-studio-form', (req, res) => {
  uploadStudioPhotos(req, res, async (uploadErr) => {
  try {
    if (uploadErr) return res.status(400).json({ success: false, message: uploadErr.message });

    const { nom, tel, email, studioNom, ville, type, prix, description,
            equipements, jours, heureOuv, heureFerm, capacite, source, message } = req.body;

    if (!nom || !email || !studioNom)
      return res.status(400).json({ success: false, message: 'Champs requis manquants' });

    const photos = req.files || [];
    const equips = JSON.parse(equipements || '[]');
    const joursOuv = JSON.parse(jours || '[]');

    // URLs Cloudinary persistantes (plus de buffer mémoire)
    const photoUrls = photos.map(f => f.path);

    if (transporter) {
      // Pièces jointes remplacées par liens Cloudinary (plus légères pour l'email)
      const attachments = photoUrls.map((url, i) => ({
        filename: `studio_${i+1}.jpg`,
        path: url,
      }));

      // Email à l'équipe StudioKay
      await transporter.sendMail({
        from: `"StudioKay" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `🏠 Nouvelle demande studio — ${studioNom} (${ville})`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto;background:#0F0D0B;color:#F5EFE6;padding:40px;border-radius:12px;">
            <h1 style="color:#C8732A;margin-bottom:4px;">StudioKay</h1>
            <p style="color:#8A7B6E;margin-top:0;margin-bottom:24px;">Nouvelle demande de partenariat</p>
            <h2 style="color:#D4A843;border-bottom:1px solid #2C2015;padding-bottom:12px;">🏠 ${studioNom}</h2>

            <table style="width:100%;border-collapse:collapse;margin:20px 0;">
              <tr><td style="padding:8px 0;color:#8A7B6E;width:40%;">👤 Propriétaire</td><td style="color:#F5EFE6;font-weight:600;">${nom}</td></tr>
              <tr><td style="padding:8px 0;color:#8A7B6E;">📧 Email</td><td style="color:#F5EFE6;">${email}</td></tr>
              <tr><td style="padding:8px 0;color:#8A7B6E;">📱 Téléphone</td><td style="color:#F5EFE6;">${tel}</td></tr>
              <tr><td style="padding:8px 0;color:#8A7B6E;">📍 Ville</td><td style="color:#F5EFE6;">${ville}</td></tr>
              <tr><td style="padding:8px 0;color:#8A7B6E;">🎬 Type</td><td style="color:#F5EFE6;">${type}</td></tr>
              <tr><td style="padding:8px 0;color:#8A7B6E;">💰 Prix/heure</td><td style="color:#D4A843;font-weight:700;">${Number(prix).toLocaleString('fr-FR')} XOF</td></tr>
              <tr><td style="padding:8px 0;color:#8A7B6E;">👥 Capacité</td><td style="color:#F5EFE6;">${capacite} personnes</td></tr>
              <tr><td style="padding:8px 0;color:#8A7B6E;">📅 Jours</td><td style="color:#F5EFE6;">${joursOuv.join(', ') || 'Non précisé'}</td></tr>
              <tr><td style="padding:8px 0;color:#8A7B6E;">⏰ Horaires</td><td style="color:#F5EFE6;">${heureOuv} → ${heureFerm}</td></tr>
              <tr><td style="padding:8px 0;color:#8A7B6E;">📣 Source</td><td style="color:#F5EFE6;">${source || 'Non précisé'}</td></tr>
            </table>

            <div style="background:#1A1713;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="color:#8A7B6E;font-size:12px;margin:0 0 8px;">📝 Description</p>
              <p style="margin:0;line-height:1.6;">${description}</p>
            </div>

            ${equips.length ? `
            <div style="background:#1A1713;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="color:#8A7B6E;font-size:12px;margin:0 0 10px;">🔧 Équipements</p>
              <p style="margin:0;">${equips.join(' · ')}</p>
            </div>` : ''}

            ${message ? `
            <div style="background:#1A1713;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="color:#8A7B6E;font-size:12px;margin:0 0 8px;">💬 Message</p>
              <p style="margin:0;line-height:1.6;">${message}</p>
            </div>` : ''}

            <p style="color:#8A7B6E;font-size:12px;margin-top:24px;">
              📎 ${photos.length} photo(s) jointe(s) · Reçu le ${new Date().toLocaleString('fr-FR')}
            </p>
            <hr style="border:1px solid #2C2015;margin:20px 0;">
            <p style="color:#8A7B6E;font-size:11px;text-align:center;">Un produit de Yaqin · Dakar, Sénégal 🇸🇳</p>
          </div>`,
        attachments
      });

      // Email de confirmation au propriétaire
      await transporter.sendMail({
        from: `"StudioKay" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `✅ Demande reçue — ${studioNom}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0F0D0B;color:#F5EFE6;padding:40px;border-radius:12px;">
            <h1 style="color:#C8732A;">StudioKay</h1>
            <h2 style="color:#D4A843;">✅ Votre demande est bien reçue !</h2>
            <p>Bonjour <strong>${nom.split(' ')[0]}</strong>,</p>
            <p>Nous avons bien reçu votre demande pour <strong>${studioNom}</strong>. Merci de votre intérêt !</p>
            <div style="background:#1A1713;border-radius:8px;padding:20px;margin:20px 0;">
              <p><strong>🏠 Studio :</strong> ${studioNom}</p>
              <p><strong>📍 Ville :</strong> ${ville}</p>
              <p><strong>🎬 Type :</strong> ${type}</p>
              <p><strong>💰 Prix :</strong> ${Number(prix).toLocaleString('fr-FR')} XOF/h</p>
              <p><strong>📎 Photos reçues :</strong> ${photos.length}</p>
            </div>
            <p>Notre équipe examine votre dossier et vous recontacte sous <strong>48h ouvrées</strong>.</p>
            <div style="background:rgba(107,203,119,0.1);border:1px solid rgba(107,203,119,0.2);border-radius:8px;padding:16px;margin:20px 0;">
              <p style="color:#6BCB77;font-weight:600;margin:0;">🎁 Bonne nouvelle — Vous faites partie des studios pionniers !</p>
              <p style="color:#8A7B6E;font-size:13px;margin:8px 0 0;">Les 10 premiers studios bénéficient de 6 mois gratuits sur StudioKay.</p>
            </div>
            <p style="color:#8A7B6E;font-size:13px;">Des questions ? Répondez à cet email ou contactez-nous :</p>
            <p style="color:#8A7B6E;font-size:13px;">📱 +221 71 018 89 89 · 🌐 studiokay.sn</p>
            <hr style="border:1px solid #2C2015;margin:24px 0;">
            <p style="color:#8A7B6E;font-size:11px;text-align:center;">Un produit de Yaqin · Dakar, Sénégal 🇸🇳</p>
          </div>`
      });
    }

    res.json({ success: true, message: 'Demande envoyée avec succès', photos: photos.length });
  } catch (err) {
    console.error('Erreur formulaire studio:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
  }); // fin uploadStudioPhotos callback
});

// Servir le formulaire
app.get('/proposer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'formulaire-studio.html'));
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
      await pool.query(`INSERT INTO studios (nom,ville,quartier,type,prix_heure,description,equipements,note,nb_avis,hote_id) VALUES
        ('Studio Lumière','Dakar','Almadies','Photo & Vidéo',15000,'Studio photo pro avec cyclorama blanc, éclairage Godox et loge privée. Idéal pour shootings mode, portraits et contenus réseaux sociaux.',ARRAY['Cyclorama blanc','Flash Godox x3','Loge privée','Climatisation','Vestiaire'],4.97,83,NULL),
        ('SoundBox Podcast','Dakar','Plateau','Podcast',20000,'Studio podcast entièrement insonorisé au coeur du Plateau. Micro Shure SM7B, interface Focusrite et mixage en direct.',ARRAY['Insonorisé','Micro Shure SM7B','Interface Focusrite','Casques monitoring','Écran retour'],5.0,41,NULL),
        ('Oxygen Sound Studio','Dakar','Mermoz','Musique',25000,'Studio enregistrement professionnel avec console SSL et cabine isolée. Beatmaker sur place disponible.',ARRAY['Console SSL','Cabine isolée','Pro Tools','Beatmaker dispo','Piano MIDI'],4.93,74,NULL),
        ('Le Studio Blanc','Dakar','Ouakam','Photo & Vidéo',18000,'Studio lifestyle avec vue mer et prop room. Décors soigneusement sélectionnés pour créateurs de contenu.',ARRAY['Vue mer','Décors lifestyle','Prop room','Ring light','Fond papier'],4.95,92,NULL),
        ('Reverse Stage','Dakar','Grand-Yoff','Clip & Tournage',35000,'Grand studio tournage avec décors modulables, caméra Sony 4K et staff technique sur demande.',ARRAY['Décors modulables','Caméra Sony 4K','Éclairage cinéma','Staff technique','Régie'],4.9,127,NULL),
        ('Sart Space','Dakar','Fann','Atelier Créatif',8000,'Atelier artistique lumineux avec lumière naturelle, rooftop et matériel pour prises de vue extérieur.',ARRAY['Lumière naturelle','Toiles & chevalets','Rooftop','Matériel photo','Espace détente'],4.85,58,NULL),
        ('Studio Jaaytaar','Dakar','Sacré-Cœur','Lifestyle',22000,'Studio lifestyle moderne et chaleureux. Parfait pour créateurs de contenu, influenceurs et shootings produits.',ARRAY['Décors modulables','Éclairage naturel','Fond colorés','Accessoires props','Climatisation'],4.93,67,NULL),
        ('Traart Sound','Dakar','Point E','Musique',30000,'Studio son haut de gamme avec équipements dernière génération. Référence pour artistes professionnels à Dakar.',ARRAY['Console Neve','Cabine insonorisée','Pro Tools HDX','Moniteurs Genelec','Micro Neumann'],4.88,89,NULL),
        ('Studio Brun','Dakar','Liberté 6','Clip & Tournage',12000,'Studio vidéo accessible et polyvalent. Idéal pour interviews, contenus YouTube et tournages créatifs.',ARRAY['Fond vert','Éclairage LED','Caméra mirrorless','Prompteur','Sono'],4.82,45,NULL),
        ('Le Studio Cosy','Dakar','Médina','Podcast',16000,'Studio podcast intimiste et cosy. Une atmosphère chaleureuse pour des échanges authentiques et des interviews de qualité.',ARRAY['Insonorisé','Micros Rode','Interface audio','Décor chaleureux','Lumière douce'],4.96,103,NULL)
        ON CONFLICT DO NOTHING`);
    }
    console.log('✅ DB initialisée');
  } catch (err) { console.error('DB init error:', err.message); }
}

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ StudioKay → http://localhost:${PORT}`);
  });
});
