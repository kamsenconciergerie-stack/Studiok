
// ── FIX BOUTONS NAV ET CARTES ──
function fixButtons() {
  // Bouton Se connecter
  document.querySelectorAll('.nav-cta, #btnSeConnecter').forEach(btn => {
    btn.onclick = (e) => { e.preventDefault(); openModal('modalLogin'); };
  });
  // Boutons Réserver sur cartes
  document.querySelectorAll('.card-btn').forEach(btn => {
    const card = btn.closest('.studio-card');
    if (card) {
      const onclick = card.getAttribute('onclick');
      if (onclick) {
        btn.onclick = (e) => { e.stopPropagation(); eval(onclick); };
      }
    }
  });
  // Bouton Proposer mon espace
  document.querySelectorAll('.btn-white').forEach(btn => {
    btn.onclick = (e) => { e.preventDefault(); openModal('modalRegister'); };
  });
  // Bouton comment ça marche
  document.querySelectorAll('a[href="#comment"]').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); document.getElementById('comment')?.scrollIntoView({behavior:'smooth'}); };
  });
}

// ══════════════════════════════════════════
// STUDIOKAY — SYSTÈME INTERACTIF v2.0
// ══════════════════════════════════════════

const API = '';
let currentUser = null;
let currentStudio = null;
let calendarState = { year: new Date().getFullYear(), month: new Date().getMonth(), selectedDate: null, occupiedSlots: [] };
let selectedHeure = null;
let studiosData = [];

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  fixButtons();
  const token = localStorage.getItem('sk_token');
  if (token) {
    fetchUser(token);
  }
  loadStudios();
  initSearchBar();
});

// ── AUTH ──
async function fetchUser(token) {
  try {
    const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    const d = await r.json();
    if (d.success) {
      currentUser = d.user;
      updateNavAuth();
    } else {
      localStorage.removeItem('sk_token');
    }
  } catch {}
}

function updateNavAuth() {
  const navCta = document.querySelector('.nav-cta');
  if (!navCta) return;
  if (currentUser) {
    navCta.outerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="nav-user" onclick="openModal('modalMesResa');loadMesResa()">
          <div>
            <div class="nav-user-name">${currentUser.nom.split(' ')[0]}</div>
            <div class="nav-user-role">${currentUser.role}</div>
          </div>
        </div>
        <button class="nav-logout" onclick="logout()">Déconnexion</button>
      </div>`;
  }
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  if (!email || !password) { showError(err, 'Email et mot de passe requis'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span>Connexion...';
  try {
    const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
    const d = await r.json();
    if (d.success) {
      localStorage.setItem('sk_token', d.token);
      currentUser = d.user;
      closeModal('modalLogin');
      updateNavAuth();
      showToast('success', 'Connexion réussie', `Bienvenue ${d.user.nom.split(' ')[0]} ! 👋`);
    } else {
      showError(err, d.message);
    }
  } catch { showError(err, 'Erreur de connexion. Réessayez.'); }
  btn.disabled = false;
  btn.innerHTML = 'Se connecter';
}

async function handleRegister() {
  const nom = document.getElementById('regNom').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const telephone = document.getElementById('regTel').value.trim();
  const role = document.getElementById('regRole').value;
  const btn = document.getElementById('registerBtn');
  const err = document.getElementById('regError');
  if (!nom || !email || !password) { showError(err, 'Tous les champs sont requis'); return; }
  if (password.length < 6) { showError(err, 'Mot de passe trop court (min. 6 caractères)'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span>Création...';
  try {
    const r = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ nom, email, password, telephone, role }) });
    const d = await r.json();
    if (d.success) {
      localStorage.setItem('sk_token', d.token);
      currentUser = d.user;
      closeModal('modalRegister');
      updateNavAuth();
      showToast('success', 'Compte créé !', `Bienvenue sur StudioKay ${nom.split(' ')[0]} ! 🎉`);
    } else {
      showError(err, d.message);
    }
  } catch { showError(err, 'Erreur. Réessayez.'); }
  btn.disabled = false;
  btn.innerHTML = 'Créer mon compte';
}

function logout() {
  localStorage.removeItem('sk_token');
  currentUser = null;
  location.reload();
}

// ── STUDIOS ──
async function loadStudios(filters = {}) {
  try {
    const params = new URLSearchParams(filters).toString();
    const r = await fetch('/api/studios' + (params ? '?' + params : ''));
    const d = await r.json();
    if (d.success) {
      studiosData = d.data;
      renderStudioCards(d.data);
    }
  } catch { console.error('Erreur chargement studios'); }
}

function renderStudioCards(studios) {
  const grid = document.querySelector('.studios-grid');
  if (!grid) return;

  const gradients = ['g1','g2','g3','g4','g5','g6'];
  const icons = { 'Photo & Vidéo':'📸', 'Podcast':'🎙️', 'Clip & Tournage':'🎬', 'Atelier Créatif':'🎨', 'Musique':'🎵', 'Lifestyle':'✨' };
  const badges = ['⚡ Disponible aujourd\'hui','🌟 Top noté','🔥 Populaire','🌿 Espace naturel','🎶 Son premium','💫 Lifestyle'];

  grid.innerHTML = studios.map((s, i) => `
    <div class="studio-card" onclick="openStudioDetail(${s.id})">
      <div class="card-image ${gradients[i % 6]}">
        <div class="img-placeholder">${icons[s.type] || '🎬'}</div>
        <div class="card-badge">${badges[i % 6]}</div>
        <div class="card-fav" onclick="event.stopPropagation();this.textContent=this.textContent==='🤍'?'❤️':'🤍'">🤍</div>
      </div>
      <div class="card-body">
        <div class="card-meta">
          <div class="card-rating">★ ${s.note || '—'} <span class="card-reviews">(${s.nb_avis || 0} avis)</span></div>
        </div>
        <h3 class="card-title">${s.nom}</h3>
        <div class="card-location">📍 ${s.quartier ? s.quartier + ', ' : ''}${s.ville}</div>
        <div class="card-tags">
          ${(s.equipements || []).slice(0,3).map(e => `<span class="tag">${e}</span>`).join('')}
        </div>
        <div class="card-footer">
          <div class="card-price">
            <strong>${Number(s.prix_heure).toLocaleString('fr-FR')}</strong>
            <span>XOF / heure</span>
          </div>
          <button class="card-btn" onclick="event.stopPropagation();openStudioDetail(${s.id})">Réserver</button>
        </div>
      </div>
    </div>`).join('');

  fixButtons(); // Réactiver animations
  document.querySelectorAll('.studio-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; }, 50);
  });
}

// ── DÉTAIL STUDIO + CALENDRIER ──
async function openStudioDetail(id) {
  openModal('modalStudio');
  const body = document.getElementById('studioDetailBody');
  body.innerHTML = '<div style="text-align:center;padding:40px;color:#8A7B6E;">Chargement...</div>';

  try {
    const [studioRes, dispoRes] = await Promise.all([
      fetch('/api/studios/' + id),
      fetch('/api/studios/' + id + '/disponibilites?mois=' + (new Date().getMonth()+1) + '&annee=' + new Date().getFullYear())
    ]);
    const studioData = await studioRes.json();
    const dispoData  = await dispoRes.json();

    if (!studioData.success) { body.innerHTML = '<p>Studio introuvable</p>'; return; }

    currentStudio = studioData.data;
    calendarState.occupiedSlots = dispoData.occupes || [];
    calendarState.selectedDate = null;
    selectedHeure = null;

    renderStudioDetail();
  } catch { body.innerHTML = '<p style="color:#E05050;">Erreur de chargement</p>'; }
}

function renderStudioDetail() {
  const s = currentStudio;
  const icons = { 'Photo & Vidéo':'📸', 'Podcast':'🎙️', 'Clip & Tournage':'🎬', 'Atelier Créatif':'🎨', 'Musique':'🎵', 'Lifestyle':'✨' };

  document.getElementById('studioDetailBody').innerHTML = `
    <div class="studio-header">
      <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:#C8732A;margin-bottom:8px;">${icons[s.type]||'🎬'} ${s.type}</div>
      <h2>${s.nom}</h2>
      <div class="studio-rating">★ ${s.note || '—'} <span style="color:#8A7B6E;">(${s.nb_avis||0} avis)</span></div>
      <div class="studio-location">📍 ${s.quartier ? s.quartier+', ':''} ${s.ville}</div>
    </div>

    <p style="color:#8A7B6E;font-size:0.9rem;line-height:1.7;margin-bottom:16px;">${s.description||''}</p>

    <div class="equipements-grid">
      ${(s.equipements||[]).map(e => `<span class="equip-tag">✓ ${e}</span>`).join('')}
    </div>

    <div style="display:flex;align-items:baseline;gap:8px;margin:12px 0 20px;">
      <div class="studio-price-big">${Number(s.prix_heure).toLocaleString('fr-FR')} XOF <span>/ heure</span></div>
    </div>

    <hr class="divider">

    <div class="calendar-section">
      <h3>📅 Choisir une date</h3>
      <div id="calendarWidget"></div>
    </div>

    <div class="heure-selector" id="heureSelector" style="display:none">
      <h3 style="font-size:1rem;font-weight:600;color:#D4A843;margin-bottom:10px;">⏰ Choisir l\'heure de début</h3>
      <div class="heure-btns" id="heureBtns"></div>
    </div>

    <div id="resaRecap" style="display:none"></div>
    <div id="resaStatus"></div>

    <button class="btn-full" id="btnReserver" style="display:none" onclick="submitReservation()">
      Confirmer la réservation
    </button>`;

  renderCalendar();
}

// ── CALENDRIER ──
function renderCalendar() {
  const { year, month, selectedDate, occupiedSlots } = calendarState;
  const today = new Date();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const dayNames = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

  // Jours occupés (toute la journée)
  const occupiedDays = new Set();
  occupiedSlots.forEach(slot => {
    const d = new Date(slot.date_debut);
    occupiedDays.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  });

  let html = `
    <div class="calendar-nav">
      <button onclick="changeMonth(-1)">‹</button>
      <span>${monthNames[month]} ${year}</span>
      <button onclick="changeMonth(1)">›</button>
    </div>
    <div class="calendar-grid">
      ${dayNames.map(d => `<div class="cal-day-label">${d}</div>`).join('')}
      ${Array(firstDay === 0 ? 6 : firstDay - 1).fill('<div class="cal-day empty"></div>').join('')}`;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const key = `${year}-${month}-${day}`;
    const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isOccupied = occupiedDays.has(key);
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const isSelected = selectedDate && day === selectedDate.getDate() && month === selectedDate.getMonth() && year === selectedDate.getFullYear();

    let cls = 'cal-day';
    if (isPast) cls += ' past';
    else if (isOccupied) cls += ' occupied';
    else if (isSelected) cls += ' selected';
    else if (isToday) cls += ' today';

    const clickable = !isPast && !isOccupied;
    html += `<div class="${cls}" ${clickable ? `onclick="selectDate(${year},${month},${day})"` : ''}>${day}</div>`;
  }

  html += '</div>';
  document.getElementById('calendarWidget').innerHTML = html;
}

function changeMonth(delta) {
  calendarState.month += delta;
  if (calendarState.month > 11) { calendarState.month = 0; calendarState.year++; }
  if (calendarState.month < 0)  { calendarState.month = 11; calendarState.year--; }

  // Recharger les dispos pour ce mois
  fetch('/api/studios/' + currentStudio.id + '/disponibilites?mois=' + (calendarState.month+1) + '&annee=' + calendarState.year)
    .then(r => r.json())
    .then(d => {
      calendarState.occupiedSlots = d.occupes || [];
      renderCalendar();
    });
}

function selectDate(year, month, day) {
  calendarState.selectedDate = new Date(year, month, day);
  calendarState.year = year;
  calendarState.month = month;
  selectedHeure = null;
  renderCalendar();
  renderHeureSelector();
  document.getElementById('resaRecap').style.display = 'none';
  document.getElementById('btnReserver').style.display = 'none';
}

// ── SÉLECTEUR D'HEURE ──
function renderHeureSelector() {
  const sel = document.getElementById('heureSelector');
  const btns = document.getElementById('heureBtns');
  sel.style.display = 'block';

  // Créneaux occupés pour ce jour
  const date = calendarState.selectedDate;
  const occupiedHours = new Set();
  calendarState.occupiedSlots.forEach(slot => {
    const d = new Date(slot.date_debut);
    const f = new Date(slot.date_fin);
    if (d.getDate() === date.getDate() && d.getMonth() === date.getMonth()) {
      for (let h = d.getHours(); h < f.getHours(); h++) occupiedHours.add(h);
    }
  });

  const heures = [8,9,10,11,12,13,14,15,16,17,18,19,20];
  btns.innerHTML = heures.map(h => {
    const isOcc = occupiedHours.has(h);
    const isSel = selectedHeure === h;
    return `<button class="heure-btn ${isOcc?'occupied':''} ${isSel?'selected':''}"
      ${isOcc ? 'disabled' : `onclick="selectHeure(${h})"`}>
      ${String(h).padStart(2,'0')}:00
    </button>`;
  }).join('');
}

function selectHeure(h) {
  selectedHeure = h;
  renderHeureSelector();
  renderResaRecap();
}

// ── RÉCAP ──
function renderResaRecap() {
  const recap = document.getElementById('resaRecap');
  if (!calendarState.selectedDate || selectedHeure === null) return;

  const date = calendarState.selectedDate;
  const dateStr = date.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const heureDebut = String(selectedHeure).padStart(2,'0') + ':00';
  const heureFin   = String(selectedHeure + 1).padStart(2,'0') + ':00';
  const montant    = currentStudio.prix_heure;

  recap.style.display = 'block';
  recap.innerHTML = `
    <div class="resa-recap">
      <div class="resa-recap-row"><span>📅 Date</span><span>${dateStr}</span></div>
      <div class="resa-recap-row"><span>⏰ Créneau</span><span>${heureDebut} → ${heureFin}</span></div>
      <div class="resa-recap-row"><span>⏱️ Durée</span><span>1 heure</span></div>
      <div class="resa-recap-row total"><span>💰 Total</span><span class="price">${Number(montant).toLocaleString('fr-FR')} XOF</span></div>
    </div>`;

  document.getElementById('btnReserver').style.display = 'block';
}

// ── SOUMETTRE RÉSERVATION ──
async function submitReservation() {
  if (!currentUser) {
    closeModal('modalStudio');
    openModal('modalLogin');
    showToast('info', 'Connexion requise', 'Connectez-vous pour réserver un studio.');
    return;
  }

  const date = calendarState.selectedDate;
  if (!date || selectedHeure === null) {
    showToast('error', 'Incomplet', 'Choisissez une date et une heure.');
    return;
  }

  const dateDebut = new Date(date.getFullYear(), date.getMonth(), date.getDate(), selectedHeure, 0, 0);
  const dateFin   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), selectedHeure + 1, 0, 0);

  const btn = document.getElementById('btnReserver');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span>Vérification...';

  const statusDiv = document.getElementById('resaStatus');

  try {
    const r = await fetch('/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('sk_token')
      },
      body: JSON.stringify({
        studio_id: currentStudio.id,
        date_debut: dateDebut.toISOString(),
        date_fin:   dateFin.toISOString(),
        nb_heures:  1,
        montant_total: currentStudio.prix_heure
      })
    });
    const d = await r.json();

    if (d.success && d.disponible) {
      // ✅ CONFIRMÉ
      statusDiv.innerHTML = `
        <div class="dispo-badge dispo-ok" style="margin-bottom:12px;">✅ Réservation confirmée !</div>
        <p style="font-size:0.88rem;color:#8A7B6E;">Un email de confirmation a été envoyé à <strong>${currentUser.email}</strong>. Référence : <code style="color:#D4A843;">${d.data.id}</code></p>`;
      btn.style.display = 'none';
      showToast('success', 'Réservation confirmée !', `Email envoyé à ${currentUser.email} 📧`);
      // Rafraîchir les dispos
      calendarState.selectedDate = null;
      selectedHeure = null;
      changeMonth(0);

    } else {
      // ❌ NON DISPONIBLE
      statusDiv.innerHTML = `
        <div class="dispo-badge dispo-non" style="margin-bottom:12px;">❌ Créneau non disponible</div>
        <p style="font-size:0.88rem;color:#8A7B6E;">${d.message} Un email vous a été envoyé avec les alternatives.</p>`;
      showToast('error', 'Créneau indisponible', 'Ce créneau est déjà réservé. Choisissez une autre heure.');
      btn.innerHTML = 'Choisir un autre créneau';
      btn.disabled = false;
      btn.onclick = () => { statusDiv.innerHTML = ''; renderCalendar(); document.getElementById('heureSelector').style.display='none'; document.getElementById('resaRecap').style.display='none'; btn.style.display='none'; };
    }

  } catch (err) {
    showToast('error', 'Erreur', 'Problème de connexion. Réessayez.');
    btn.disabled = false;
    btn.innerHTML = 'Confirmer la réservation';
  }
}

// ── MES RÉSERVATIONS ──
async function loadMesResa() {
  const body = document.getElementById('mesResaBody');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#8A7B6E;">Chargement...</div>';
  try {
    const r = await fetch('/api/reservations/mes', { headers: { Authorization: 'Bearer ' + localStorage.getItem('sk_token') } });
    const d = await r.json();
    if (!d.success || d.data.length === 0) {
      body.innerHTML = '<p style="color:#8A7B6E;text-align:center;padding:20px;">Aucune r&eacute;servation pour l&apos;instant.</p>';
      return;
    }
    body.innerHTML = d.data.map(r => `
      <div class="resa-card">
        <div class="resa-card-header">
          <strong>${r.studio_nom || 'Studio #' + r.studio_id}</strong>
          <span class="resa-status status-${r.statut}">${r.statut}</span>
        </div>
        <div style="font-size:0.85rem;color:#8A7B6E;">
          <div>📅 ${new Date(r.date_debut).toLocaleString('fr-FR')}</div>
          <div>⏱️ ${r.nb_heures}h · 💰 ${Number(r.montant_total).toLocaleString('fr-FR')} XOF</div>
        </div>
        ${r.statut === 'confirmee' ? `<button onclick="annulerResa('${r.id}')" style="margin-top:10px;background:none;border:1px solid rgba(224,80,80,0.3);color:#E05050;padding:6px 14px;border-radius:6px;font-size:0.78rem;cursor:pointer;">Annuler</button>` : ''}
      </div>`).join('');
  } catch { body.innerHTML = '<p style="color:#E05050;">Erreur de chargement</p>'; }
}

async function annulerResa(id) {
  if (!confirm('Confirmer l\'annulation ?')) return;
  try {
    const r = await fetch('/api/reservations/' + id + '/annuler', { method:'PATCH', headers:{ Authorization: 'Bearer ' + localStorage.getItem('sk_token') } });
    const d = await r.json();
    if (d.success) { showToast('info','Réservation annulée','Votre réservation a été annulée.'); loadMesResa(); }
  } catch {}
}

// ── RECHERCHE ──
function initSearchBar() {
  const searchBtn = document.querySelector('.search-btn');
  if (searchBtn) {
    searchBtn.onclick = () => {
      const ville      = document.querySelector('.search-field select:nth-child(1)')?.value;
      const type       = document.querySelector('.search-field select:nth-child(2)')?.value;
      const budget_max = document.querySelector('.search-field select:last-of-type')?.value;
      const filters = {};
      if (ville && ville !== 'Toutes les villes') filters.ville = ville;
      if (type  && type  !== 'Tous les types')    filters.type  = type;
      if (budget_max && budget_max !== 'Tous les budgets') {
        const match = budget_max.match(/(\d+)\s*XOF/g);
        if (match && match.length > 0) filters.budget_max = match[match.length-1].replace(/\D/g,'');
      }
      loadStudios(filters);
      document.getElementById('studios')?.scrollIntoView({ behavior: 'smooth' });
      showToast('info', 'Recherche en cours', 'Filtrage des studios...');
    };
  }

  // Cat pills
  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', function() {
      document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      const type = this.textContent.replace(/^[^\w]+/,'').trim();
      if (type === 'Tout voir') loadStudios();
      else loadStudios({ type });
    });
  });

  // Bouton connexion dans la nav
  const navCta = document.querySelector('.nav-cta');
  if (navCta) navCta.addEventListener('click', () => openModal('modalLogin'));

  // Bouton "Découvrir les studios"
  document.querySelectorAll('a[href="#studios"]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); document.getElementById('studios')?.scrollIntoView({ behavior:'smooth' }); });
  });
}

// ── MODAL HELPERS ──
function openModal(id) { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }
function switchModal(from, to) { closeModal(from); openModal(to); }

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});

// ── TOAST ──
function showToast(type, title, msg) {
  const icons = { success:'✅', error:'❌', info:'💡' };
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="toast-icon">${icons[type]}</div><div class="toast-msg"><div class="toast-title">${title}</div>${msg}</div>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(100px)'; t.style.transition='all 0.3s'; setTimeout(()=>t.remove(),300); }, 4000);
}

function showError(el, msg) { el.textContent = msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'), 4000); }