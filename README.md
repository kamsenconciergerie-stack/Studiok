# 🎬 StudioKay
### *Là où la créativité bat son plein*
> Un produit de **Yaqin** · Dakar, Sénégal

Plateforme de réservation de studios créatifs au Sénégal — inspirée de Peerspace.

---

## 🚀 Déploiement sur Railway (5 minutes)

### 1. Connecte ton repo GitHub
- Va sur [railway.app](https://railway.app)
- Clique **New Project → Deploy from GitHub repo**
- Sélectionne le repo `studiokay`

### 2. Ajoute PostgreSQL
- Dans ton projet Railway → **+ New → Database → Add PostgreSQL**
- Railway crée la base et injecte `DATABASE_URL` automatiquement

### 3. Configure le port
- Dans ton service → **Settings → Environment**
- Ajoute la variable : `PORT` = `8080`

### 4. Déploie
- Railway build et démarre automatiquement
- Ton URL publique apparaît dans **Settings → Networking → Generate Domain**

```
https://studiokay-production.up.railway.app
```

---

## 📁 Structure du projet

```
studiokay/
├── server.js            → Serveur Express + API REST
├── package.json         → Dépendances Node.js
├── .env.example         → Modèle de variables d'environnement
├── README.md            → Ce fichier
├── data/
│   └── studios.json     → 6 studios de démo (fallback sans DB)
└── public/
    └── index.html       → Interface front-end complète
```

---

## 🗄️ Base de données

### Mode automatique — sans configuration
Si aucune `DATABASE_URL` n'est définie, l'app utilise `data/studios.json`.  
6 studios de démonstration sont inclus, zéro configuration requise.

### Mode PostgreSQL — Railway
Railway injecte `DATABASE_URL` automatiquement dès que tu ajoutes le plugin PostgreSQL.  
L'app détecte la variable et bascule sur PostgreSQL sans aucune modification de code.

La table `studios` est créée automatiquement au premier démarrage.

---

## 📡 API REST

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/studios` | Lister tous les studios |
| `GET` | `/api/studios?ville=Dakar` | Filtrer par ville |
| `GET` | `/api/studios?type=podcast` | Filtrer par type |
| `GET` | `/api/studios?budget_max=20000` | Filtrer par budget (XOF) |
| `GET` | `/api/studios/:id` | Détail d'un studio |
| `POST` | `/api/studios` | Créer un studio |
| `PUT` | `/api/studios/:id` | Modifier un studio |
| `DELETE` | `/api/studios/:id` | Supprimer un studio |

### Exemple — Créer un studio
```bash
curl -X POST https://TON-APP.up.railway.app/api/studios \
  -H "Content-Type: application/json" \
  -d '{
    "nom": "Studio Lumière",
    "ville": "Dakar",
    "type": "Photo & Vidéo",
    "prix_heure": 15000,
    "description": "Cyclorama blanc, éclairage pro",
    "equipements": ["Cyclorama", "Flash Godox x3"],
    "note": 4.9
  }'
```

---

## 🔒 Variables d'environnement

| Variable | Description | Requis |
|----------|-------------|--------|
| `PORT` | Port d'écoute (Railway utilise 8080) | ✅ |
| `DATABASE_URL` | URL PostgreSQL (injectée par Railway auto) | ✅ |
| `NODE_ENV` | `production` en déploiement | Optionnel |

---

## 🛠️ Développement local

```bash
# Installer les dépendances
npm install

# Copier le fichier d'environnement
cp .env.example .env

# Démarrer le serveur
npm start
# → http://localhost:3000
```

---

## 🌍 Migration vers Google Cloud (production avancée)

```bash
# Build l'image Docker
gcloud builds submit --tag gcr.io/TON_PROJET/studiokay

# Déployer sur Cloud Run
gcloud run deploy studiokay \
  --image gcr.io/TON_PROJET/studiokay \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars DATABASE_URL=postgresql://...
```

---

*StudioKay — Un produit de Yaqin · Dakar, Sénégal 🇸🇳*
