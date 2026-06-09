// ══════════════════════════════════════════════════════════════
//  PERSISTENCIA
// ══════════════════════════════════════════════════════════════
const LS_KEYS = {
  albums:    'nadia_albums',
  favorites: 'nadia_favorites',
  uploaded:  'nadia_uploaded',
  albumMeta: 'nadia_album_meta',
  volume:    'nadia_volume',
};

const getLS = (key, fallback = null) => {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
};
const setLS = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch(e) { console.warn('LS lleno:', e); }
};

// ══════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════
let state = {
  albums:          {},
  albumMeta:       {},
  uploadedSongs:   [],
  favorites:       new Set(),
  currentView:     '',
  currentTrackIdx: 0,
  activeTrackData: {},
  activeTrackAlbum:'',
  isPlaying:       false,
  shuffle:         false,
  repeat:          false,
  searchQuery:     '',
  durations:       {},
};

const audio = new Audio();
audio.volume = getLS(LS_KEYS.volume, 0.75);
audio.preload = 'metadata';

// ══════════════════════════════════════════════════════════════
//  DOM REFS
// ══════════════════════════════════════════════════════════════
const DOM = {
  disc:           document.getElementById('disc'),
  discGlow:       document.getElementById('discGlow'),
  discCoverBg:    document.getElementById('discCoverBg'),
  tonearm:        document.getElementById('tonearm'),
  labelBg:        document.getElementById('labelBg'),
  labelImg:       document.getElementById('labelImg'),
  labelEmoji:     document.getElementById('labelEmoji'),
  trackTitle:     document.getElementById('trackTitle'),
  trackArtist:    document.getElementById('trackArtist'),
  trackAlbum:     document.getElementById('trackAlbum'),
  progressFill:   document.getElementById('progressFill'),
  progressBar:    document.getElementById('progressBar'),
  timeNow:        document.getElementById('timeNow'),
  timeTotal:      document.getElementById('timeTotal'),
  btnPlay:        document.getElementById('btnPlay'),
  iconPlay:       document.getElementById('iconPlay'),
  iconPause:      document.getElementById('iconPause'),
  btnShuffle:     document.getElementById('btnShuffle'),
  btnRepeat:      document.getElementById('btnRepeat'),
  btnPrev:        document.getElementById('btnPrev'),
  btnNext:        document.getElementById('btnNext'),
  btnFavCurrent:  document.getElementById('btnFavCurrent'),
  volSlider:      document.getElementById('volSlider'),
  tracklist:      document.getElementById('tracklist'),
  albumSelect:    document.getElementById('albumSelect'),
  searchInput:    document.getElementById('searchInput'),
  btnEditAlbum:   document.getElementById('btnEditAlbum'),
  toast:          document.getElementById('toast'),
  // Modals
  modalEditAlbum: document.getElementById('modalEditAlbum'),
  modalUpload:    document.getElementById('modalUpload'),
  // Upload
  uploadZone:         document.getElementById('uploadZone'),
  uploadFileInput:    document.getElementById('uploadFileInput'),
  uploadList:         document.getElementById('uploadList'),
  uploadAlbumAssign:  document.getElementById('uploadAlbumAssign'),
  uploadAlbumSelect:  document.getElementById('uploadAlbumSelect'),
  btnOpenUpload:      document.getElementById('btnOpenUpload'),
  btnUploadClose:     document.getElementById('btnUploadClose'),
  // YouTube
  ytUrlInput:         document.getElementById('ytUrlInput'),
  btnYtFetch:         document.getElementById('btnYtFetch'),
  ytResultContainer:  document.getElementById('ytResultContainer'),
  ytThumbnail:        document.getElementById('ytThumbnail'),
  ytTitle:            document.getElementById('ytTitle'),
  ytChannel:          document.getElementById('ytChannel'),
  btnYtCopyTitle:     document.getElementById('btnYtCopyTitle'),
  // iTunes / portadas
  apiSearchContainer: document.getElementById('apiSearchContainer'),
  apiSearchInput:     document.getElementById('apiSearchInput'),
  btnApiSearch:       document.getElementById('btnApiSearch'),
  apiResultsGrid:     document.getElementById('apiResultsGrid'),
};

// ══════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════
let toastTimer;
const showToast = (msg, type = '', ms = 2500) => {
  DOM.toast.textContent = msg;
  DOM.toast.className = `toast show${type ? ' ' + type : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    DOM.toast.classList.remove('show', 'success', 'error');
  }, ms);
};

const formatTime = (s) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
};

const getTrackId = (t) => t.src;
const isFav = (t) => state.favorites.has(getTrackId(t));

const toggleFav = (track) => {
  if (!track || !track.src) return;
  const id = getTrackId(track);
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
    showToast('Eliminado de favoritos');
  } else {
    state.favorites.add(id);
    showToast('Agregado a favoritos ♥', 'success');
  }
  setLS(LS_KEYS.favorites, [...state.favorites]);
  DOM.btnFavCurrent.classList.toggle('active', isFav(state.activeTrackData));
  updateTrackList();
  refreshAlbumSelector();
};

// ══════════════════════════════════════════════════════════════
//  LÓGICA DE TRACKS
// ══════════════════════════════════════════════════════════════
const getFilteredTracks = () => {
  let pool = [];
  const q = state.searchQuery.trim().toLowerCase();

  if (q) {
    Object.entries(state.albums).forEach(([key, tracks]) => {
      tracks.forEach(t => {
        if (
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          key.toLowerCase().includes(q)
        ) pool.push({ ...t, albumOrigin: key });
      });
    });
    state.uploadedSongs.forEach(t => {
      if (t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
        pool.push({ ...t, albumOrigin: '__UPLOADED__' });
    });
    return pool;
  }

  switch (state.currentView) {
    case '__ALL__':
      Object.entries(state.albums).forEach(([key, tracks]) =>
        tracks.forEach(t => pool.push({ ...t, albumOrigin: key }))
      );
      state.uploadedSongs.forEach(t => pool.push({ ...t, albumOrigin: '__UPLOADED__' }));
      break;
    case '__FAV__':
      Object.entries(state.albums).forEach(([key, tracks]) =>
        tracks.forEach(t => { if (isFav(t)) pool.push({ ...t, albumOrigin: key }); })
      );
      state.uploadedSongs.forEach(t => { if (isFav(t)) pool.push({ ...t, albumOrigin: '__UPLOADED__' }); });
      break;
    case '__UPLOADED__':
      pool = state.uploadedSongs.map(t => ({ ...t, albumOrigin: '__UPLOADED__' }));
      break;
    default:
      pool = (state.albums[state.currentView] || []).map(t => ({ ...t, albumOrigin: state.currentView }));
  }
  return pool;
};

// ══════════════════════════════════════════════════════════════
//  REPRODUCTOR
// ══════════════════════════════════════════════════════════════
const loadTrack = (idx) => {
  const filtered = getFilteredTracks();
  if (!filtered.length) {
    DOM.trackTitle.textContent = 'Sin pistas en esta vista';
    DOM.trackArtist.textContent = '---';
    DOM.trackAlbum.textContent = '---';
    return;
  }

  // Wrap index
  idx = ((idx % filtered.length) + filtered.length) % filtered.length;
  state.currentTrackIdx    = idx;
  state.activeTrackData    = filtered[idx];
  state.activeTrackAlbum   = filtered[idx].albumOrigin;

  audio.src = state.activeTrackData.src;

  const meta        = state.albumMeta[state.activeTrackAlbum] || {};
  const displayAlbum = meta.name || state.activeTrackAlbum;
  const displayCover = meta.cover || state.activeTrackData.cover || '';

  DOM.trackTitle.textContent  = state.activeTrackData.title  || 'Sin título';
  DOM.trackArtist.textContent = state.activeTrackData.artist || meta.artist || '---';
  DOM.trackAlbum.textContent  = displayAlbum !== '__UPLOADED__' ? displayAlbum : 'Archivos locales';
  DOM.timeNow.textContent     = '0:00';
  DOM.progressFill.style.width = '0%';
  DOM.progressBar.style.setProperty('--thumb-x', '0%');

  const cacheKey = getTrackId(state.activeTrackData);
  DOM.timeTotal.textContent = state.durations[cacheKey] ? formatTime(state.durations[cacheKey]) : '--:--';

  if (displayCover) {
    DOM.discCoverBg.style.backgroundImage = `url('${displayCover}')`;
    DOM.discCoverBg.classList.add('visible');
    DOM.labelImg.src = displayCover;
    DOM.labelImg.style.display = 'block';
    DOM.labelEmoji.style.display = 'none';
    DOM.labelBg.style.background = 'transparent';
  } else {
    DOM.discCoverBg.style.backgroundImage = '';
    DOM.discCoverBg.classList.remove('visible');
    DOM.labelImg.style.display = 'none';
    DOM.labelEmoji.style.display = 'flex';
    DOM.labelBg.style.background = state.activeTrackData.bg || 'var(--s3)';
  }

  DOM.btnFavCurrent.classList.toggle('active', isFav(state.activeTrackData));
  updateTrackList();
  updateMediaSession();

  if (state.isPlaying) audio.play().catch(() => {});
};

const togglePlayback = (forceState) => {
  state.isPlaying = typeof forceState === 'boolean' ? forceState : !state.isPlaying;
  DOM.disc.classList.toggle('playing', state.isPlaying);
  DOM.discGlow.classList.toggle('active', state.isPlaying);
  DOM.tonearm.classList.toggle('on-disc', state.isPlaying);
  DOM.iconPlay.style.display  = state.isPlaying ? 'none'  : 'block';
  DOM.iconPause.style.display = state.isPlaying ? 'block' : 'none';
  document.querySelectorAll('.t-eq-bar').forEach(b => b.classList.toggle('paused', !state.isPlaying));

  if (state.isPlaying) {
    if (!audio.src || audio.src === window.location.href) audio.src = state.activeTrackData.src;
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
};

const nextTrack = () => {
  const filtered = getFilteredTracks();
  if (!filtered.length) return;
  let next = state.shuffle
    ? Math.floor(Math.random() * filtered.length)
    : state.currentTrackIdx + 1;
  loadTrack(next);
  if (!state.isPlaying) togglePlayback(true);
};

const prevTrack = () => {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  loadTrack(state.currentTrackIdx - 1);
};

// ══════════════════════════════════════════════════════════════
//  RENDER UI
// ══════════════════════════════════════════════════════════════
const refreshAlbumSelector = () => {
  const prev = DOM.albumSelect.value;
  DOM.albumSelect.innerHTML = '';

  const totalSongs = Object.values(state.albums).reduce((a, c) => a + c.length, 0) + state.uploadedSongs.length;
  DOM.albumSelect.add(new Option(`Colección completa (${totalSongs})`, '__ALL__'));
  DOM.albumSelect.add(new Option(`Favoritos (${state.favorites.size})`, '__FAV__'));
  DOM.albumSelect.add(new Option(`Archivos locales (${state.uploadedSongs.length})`, '__UPLOADED__'));

  const sep = new Option('──────────────', '');
  sep.disabled = true;
  DOM.albumSelect.add(sep);

  Object.keys(state.albums).forEach(key => {
    const meta = state.albumMeta[key] || {};
    DOM.albumSelect.add(new Option(`${meta.name || key} (${state.albums[key].length})`, key));
  });

  const exists = Array.from(DOM.albumSelect.options).some(o => o.value === prev);
  DOM.albumSelect.value = exists ? prev : '__ALL__';
  state.currentView = DOM.albumSelect.value;

  // Actualizar selector del modal de upload
  populateUploadAlbumSelect();
};

const populateUploadAlbumSelect = () => {
  if (!DOM.uploadAlbumSelect) return;
  DOM.uploadAlbumSelect.innerHTML = '<option value="">-- Seleccionar álbum --</option>';
  Object.keys(state.albums).forEach(key => {
    const meta = state.albumMeta[key] || {};
    DOM.uploadAlbumSelect.add(new Option(meta.name || key, key));
  });
};

const updateTrackList = () => {
  DOM.tracklist.innerHTML = '';
  const filtered = getFilteredTracks();

  if (!filtered.length) {
    const msg = state.currentView === '__FAV__'
      ? 'No tenés pistas marcadas como favoritas todavía.'
      : state.currentView === '__UPLOADED__'
      ? 'No hay archivos locales. Subí tus MP3 con el botón de la barra superior.'
      : 'No se encontraron pistas en esta vista.';
    DOM.tracklist.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  filtered.forEach((t, idx) => {
    const isCurrent = t.src === state.activeTrackData.src && t.albumOrigin === state.activeTrackAlbum;
    const dur       = state.durations[getTrackId(t)] ? formatTime(state.durations[getTrackId(t)]) : '–:––';
    const coverUrl  = (state.albumMeta[t.albumOrigin] || {}).cover || t.cover || '';

    const row = document.createElement('div');
    row.className = `track-row${isCurrent ? ' current' : ''}`;
    row.setAttribute('role', 'listitem');

    const coverHTML = coverUrl
      ? `<div class="t-cover"><img src="${coverUrl}" alt="" loading="lazy"></div>`
      : `<div class="t-cover"><svg width="14" height="14" fill="var(--muted)" viewBox="0 0 16 16"><path d="M9 13c0 1.105-1.12 2-2.5 2S4 14.105 4 13s1.12-2 2.5-2 2.5.895 2.5 2z"/><path fill-rule="evenodd" d="M9 3v10H8V3h1z"/><path d="M8 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 13 2.22V4L8 5V2.82z"/></svg></div>`;

    const eqClass = state.isPlaying ? '' : ' paused';
    row.innerHTML = `
      <div class="t-num">${idx + 1}</div>
      <div class="t-eq">
        <div class="t-eq-bar${eqClass}"></div>
        <div class="t-eq-bar${eqClass}"></div>
        <div class="t-eq-bar${eqClass}"></div>
      </div>
      ${coverHTML}
      <div class="t-info">
        <div class="t-name" title="${t.title}">${t.title}</div>
        <div class="t-art">${t.artist || '---'}</div>
      </div>
      <div class="t-dur">${dur}</div>
      <button class="t-fav-btn${isFav(t) ? ' active' : ''}" aria-label="Favorito">
        <svg width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/></svg>
      </button>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.t-fav-btn')) return;
      if (isCurrent) togglePlayback();
      else { loadTrack(idx); togglePlayback(true); }
    });

    row.querySelector('.t-fav-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(t);
    });

    fragment.appendChild(row);
  });

  DOM.tracklist.appendChild(fragment);
};

// ══════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════
const initPlayer = async () => {
  state.favorites    = new Set(getLS(LS_KEYS.favorites, []));
  state.albumMeta    = getLS(LS_KEYS.albumMeta, {});
  state.uploadedSongs = getLS(LS_KEYS.uploaded, []).filter(t => t.src && !t.src.startsWith('blob:'));
  DOM.volSlider.value = Math.round(audio.volume * 100);

  try {
    const res = await fetch('songs.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.albums = await res.json();
    refreshAlbumSelector();
    loadTrack(0);
  } catch (err) {
    console.error('Error cargando songs.json:', err);
    refreshAlbumSelector();
    if (state.uploadedSongs.length) loadTrack(0);
    else DOM.trackTitle.textContent = 'Sin biblioteca disponible';
  }
};

// ══════════════════════════════════════════════════════════════
//  EVENTOS AUDIO
// ══════════════════════════════════════════════════════════════
audio.addEventListener('loadedmetadata', () => {
  const key = getTrackId(state.activeTrackData);
  state.durations[key] = Math.floor(audio.duration);
  DOM.timeTotal.textContent = formatTime(audio.duration);
  updateTrackList();
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  DOM.timeNow.textContent = formatTime(audio.currentTime);
  const ratio = audio.currentTime / audio.duration;
  DOM.progressFill.style.width = `${ratio * 100}%`;
  DOM.progressBar.style.setProperty('--thumb-x', `${ratio * 100}%`);
});

audio.addEventListener('ended', () => {
  if (state.repeat) { audio.currentTime = 0; audio.play(); }
  else nextTrack();
});
audio.addEventListener('play',  () => togglePlayback(true));
audio.addEventListener('pause', () => togglePlayback(false));
audio.addEventListener('error', () => {
  showToast('Error al cargar el audio', 'error');
  setTimeout(nextTrack, 1500);
});

// ══════════════════════════════════════════════════════════════
//  EVENTOS CONTROLES
// ══════════════════════════════════════════════════════════════
DOM.btnPlay.addEventListener('click', () => togglePlayback());
DOM.btnPrev.addEventListener('click', prevTrack);
DOM.btnNext.addEventListener('click', nextTrack);

DOM.btnShuffle.addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  DOM.btnShuffle.classList.toggle('active', state.shuffle);
  showToast(state.shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado');
});

DOM.btnRepeat.addEventListener('click', () => {
  state.repeat = !state.repeat;
  DOM.btnRepeat.classList.toggle('active', state.repeat);
  showToast(state.repeat ? 'Repetición activada' : 'Repetición desactivada');
});

DOM.btnFavCurrent.addEventListener('click', () => toggleFav(state.activeTrackData));

DOM.volSlider.addEventListener('input', (e) => {
  audio.volume = e.target.value / 100;
  setLS(LS_KEYS.volume, audio.volume);
});

DOM.albumSelect.addEventListener('change', (e) => {
  state.currentView  = e.target.value;
  state.searchQuery  = '';
  DOM.searchInput.value = '';
  const isSpecial = ['__ALL__','__FAV__','__UPLOADED__'].includes(state.currentView);
  DOM.btnEditAlbum.style.display = isSpecial ? 'none' : 'flex';
  loadTrack(0);
});

DOM.searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  updateTrackList();
});

// ══════════════════════════════════════════════════════════════
//  BARRA DE PROGRESO / SEEKER
// ══════════════════════════════════════════════════════════════
const seekTo = (clientX) => {
  if (!audio.duration) return;
  const rect  = DOM.progressBar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  audio.currentTime = ratio * audio.duration;
};

DOM.progressBar.addEventListener('mousedown', e => {
  DOM.progressBar.classList.add('dragging');
  seekTo(e.clientX);
  const move = ev => seekTo(ev.clientX);
  const up   = () => {
    DOM.progressBar.classList.remove('dragging');
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
});
DOM.progressBar.addEventListener('touchstart', e => {
  DOM.progressBar.classList.add('dragging');
  seekTo(e.touches[0].clientX);
}, { passive: true });
DOM.progressBar.addEventListener('touchmove',  e => seekTo(e.touches[0].clientX), { passive: true });
DOM.progressBar.addEventListener('touchend',   () => DOM.progressBar.classList.remove('dragging'), { passive: true });

// ══════════════════════════════════════════════════════════════
//  MEDIA SESSION API
// ══════════════════════════════════════════════════════════════
const updateMediaSession = () => {
  if (!('mediaSession' in navigator)) return;
  const meta     = state.albumMeta[state.activeTrackAlbum] || {};
  const coverUrl = meta.cover || state.activeTrackData.cover || '';
  navigator.mediaSession.metadata = new MediaMetadata({
    title:   state.activeTrackData.title  || '',
    artist:  state.activeTrackData.artist || meta.artist || '',
    album:   meta.name || state.activeTrackAlbum || '',
    artwork: coverUrl ? [{ src: coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
  navigator.mediaSession.setActionHandler('play',          () => togglePlayback(true));
  navigator.mediaSession.setActionHandler('pause',         () => togglePlayback(false));
  navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
  navigator.mediaSession.setActionHandler('nexttrack',     nextTrack);
};

// ══════════════════════════════════════════════════════════════
//  MODAL UPLOAD — APERTURA / CIERRE
// ══════════════════════════════════════════════════════════════
DOM.btnOpenUpload.addEventListener('click', () => DOM.modalUpload.classList.add('open'));
DOM.btnUploadClose.addEventListener('click', () => DOM.modalUpload.classList.remove('open'));
DOM.modalUpload.addEventListener('click', (e) => {
  if (e.target === DOM.modalUpload) DOM.modalUpload.classList.remove('open');
});

// ══════════════════════════════════════════════════════════════
//  UPLOAD DE ARCHIVOS MP3
// ══════════════════════════════════════════════════════════════
let pendingFiles = [];

const renderUploadList = () => {
  DOM.uploadList.innerHTML = '';
  DOM.uploadAlbumAssign.style.display = pendingFiles.length ? 'block' : 'none';

  pendingFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.innerHTML = `
      <span class="u-name" title="${f.name}">${f.name}</span>
      <span class="u-status">Listo</span>
      <button class="u-remove" aria-label="Eliminar">
        <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
          <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
        </svg>
      </button>
    `;
    item.querySelector('.u-remove').addEventListener('click', () => {
      pendingFiles.splice(i, 1);
      renderUploadList();
    });
    DOM.uploadList.appendChild(item);
  });

  // Botón de confirmar si hay archivos
  if (pendingFiles.length > 0 && !document.getElementById('btnConfirmUpload')) {
    const btn = document.createElement('button');
    btn.className = 'btn-action primary';
    btn.id = 'btnConfirmUpload';
    btn.style.cssText = 'width:100%;margin-top:10px;';
    btn.textContent = `Agregar ${pendingFiles.length} archivo(s) a la biblioteca`;
    btn.addEventListener('click', confirmUpload);
    DOM.uploadList.appendChild(btn);
  }
};

const confirmUpload = () => {
  if (!pendingFiles.length) return;
  const albumTarget = DOM.uploadAlbumSelect.value;

  pendingFiles.forEach(file => {
    const blobUrl = URL.createObjectURL(file);
    const baseName = file.name.replace(/\.mp3$/i, '');
    const newTrack = {
      src:    blobUrl,
      title:  baseName,
      artist: 'Archivo local',
      cover:  '',
      bg:     'var(--s3)',
    };

    if (albumTarget && state.albums[albumTarget]) {
      // Agregar al álbum existente
      state.albums[albumTarget].push(newTrack);
      showToast(`"${baseName}" agregada a ${albumTarget}`, 'success');
    } else {
      state.uploadedSongs.push(newTrack);
    }
  });

  // Persistir solo los que no son blob (blob no sobrevive recarga)
  setLS(LS_KEYS.uploaded, state.uploadedSongs.filter(t => !t.src.startsWith('blob:')));

  pendingFiles = [];
  renderUploadList();
  refreshAlbumSelector();
  updateTrackList();
  showToast('Archivos agregados correctamente', 'success');
};

// Zona de clic
DOM.uploadZone.addEventListener('click', () => DOM.uploadFileInput.click());
DOM.uploadFileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  pendingFiles = [...pendingFiles, ...files];
  renderUploadList();
  e.target.value = ''; // reset
});

// Drag & Drop
DOM.uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  DOM.uploadZone.classList.add('drag-over');
});
DOM.uploadZone.addEventListener('dragleave', () => DOM.uploadZone.classList.remove('drag-over'));
DOM.uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  DOM.uploadZone.classList.remove('drag-over');
  const mp3s = Array.from(e.dataTransfer.files).filter(f => f.type === 'audio/mpeg' || f.name.endsWith('.mp3'));
  if (!mp3s.length) { showToast('Solo se aceptan archivos MP3', 'error'); return; }
  pendingFiles = [...pendingFiles, ...mp3s];
  renderUploadList();
});

// ══════════════════════════════════════════════════════════════
//  API: YOUTUBE (oEmbed — sin autenticación)
// ══════════════════════════════════════════════════════════════
DOM.btnYtFetch.addEventListener('click', async () => {
  const url = DOM.ytUrlInput.value.trim();
  if (!url) { showToast('Ingresá una URL de YouTube', 'error'); return; }

  // Validación básica de URL de YouTube
  if (!/youtube\.com|youtu\.be/.test(url)) {
    showToast('URL no parece ser de YouTube', 'error');
    return;
  }

  DOM.btnYtFetch.disabled = true;
  DOM.btnYtFetch.textContent = '...';
  DOM.ytResultContainer.style.display = 'none';

  try {
    const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
    const res  = await fetch(endpoint);
    const data = await res.json();

    if (data.error || !data.title) throw new Error(data.error || 'Sin datos');

    DOM.ytThumbnail.src   = data.thumbnail_url || '';
    DOM.ytTitle.textContent   = data.title || '(sin título)';
    DOM.ytChannel.textContent = data.author_name ? `Canal: ${data.author_name}` : '';
    DOM.ytResultContainer.style.display = 'flex';
  } catch (err) {
    showToast('Error obteniendo metadatos de YouTube', 'error');
    console.error('[YT oEmbed]', err);
  } finally {
    DOM.btnYtFetch.disabled = false;
    DOM.btnYtFetch.textContent = 'Obtener';
  }
});

DOM.btnYtCopyTitle.addEventListener('click', () => {
  const title = DOM.ytTitle.textContent;
  if (!title) return;
  navigator.clipboard.writeText(title).then(() => {
    showToast('Título copiado al portapapeles', 'success');
  }).catch(() => showToast('No se pudo copiar', 'error'));
});

// ══════════════════════════════════════════════════════════════
//  API: ITUNES — BÚSQUEDA DE PORTADAS
// ══════════════════════════════════════════════════════════════
let editingAlbumKey      = '';
let editingCoverDataUrl  = null;

const toggleApiSearchUI = (show) => {
  DOM.apiSearchContainer.style.display = show ? 'block' : 'none';
  if (!show) {
    DOM.apiResultsGrid.innerHTML = '';
    DOM.apiSearchInput.value = '';
  }
};

DOM.btnApiSearch.addEventListener('click', async () => {
  const query = DOM.apiSearchInput.value.trim();
  if (!query) { showToast('Ingresá un artista o álbum', 'error'); return; }

  DOM.btnApiSearch.disabled = true;
  DOM.btnApiSearch.textContent = '...';
  DOM.apiResultsGrid.innerHTML = '<span style="font-size:11px;color:var(--muted)">Buscando...</span>';

  try {
    // CORS proxy: la iTunes API tiene restricción de CORS en algunos navegadores;
    // usamos el parámetro callback=? para JSONP… pero como no podemos JSONP fácilmente,
    // intentamos direct fetch (funciona en la mayoría de navegadores modernos en HTTPS).
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=8&media=music`;
    const res  = await fetch(url);
    const data = await res.json();

    DOM.apiResultsGrid.innerHTML = '';

    if (!data.results || data.results.length === 0) {
      DOM.apiResultsGrid.innerHTML = '<span style="font-size:11px;color:var(--muted)">Sin resultados para esa búsqueda.</span>';
      return;
    }

    data.results.forEach(result => {
      const imgUrl = result.artworkUrl100
        ? result.artworkUrl100.replace('100x100bb', '600x600bb')
        : '';
      if (!imgUrl) return;

      const img = document.createElement('img');
      img.src = imgUrl;
      img.className = 'api-result-item';
      img.title = `${result.collectionName} — ${result.artistName}`;
      img.loading = 'lazy';
      img.addEventListener('click', () => {
        // Deselect previous
        DOM.apiResultsGrid.querySelectorAll('.api-result-item').forEach(i => i.classList.remove('selected'));
        img.classList.add('selected');

        editingCoverDataUrl = imgUrl;
        const editImg = document.getElementById('editCoverImg');
        editImg.src = imgUrl;
        editImg.style.display = 'block';
        document.getElementById('editCoverPlaceholder').style.display = 'none';
        showToast('Portada seleccionada — guardá para aplicar', 'success');
      });
      DOM.apiResultsGrid.appendChild(img);
    });
  } catch (err) {
    DOM.apiResultsGrid.innerHTML = '<span style="font-size:11px;color:var(--a2)">Error de red al buscar portadas.</span>';
    console.error('[iTunes API]', err);
  } finally {
    DOM.btnApiSearch.disabled = false;
    DOM.btnApiSearch.textContent = 'Buscar';
  }
});

// ══════════════════════════════════════════════════════════════
//  MODAL EDITAR ÁLBUM
// ══════════════════════════════════════════════════════════════
DOM.btnEditAlbum.addEventListener('click', () => {
  if (['__ALL__','__FAV__','__UPLOADED__'].includes(state.currentView)) return;

  editingAlbumKey     = state.currentView;
  editingCoverDataUrl = null;

  const meta      = state.albumMeta[editingAlbumKey] || {};
  const firstTrack = (state.albums[editingAlbumKey] || [])[0] || {};

  document.getElementById('editAlbumNameDisplay').textContent = meta.name || editingAlbumKey;
  document.getElementById('editAlbumName').value   = meta.name || editingAlbumKey;
  document.getElementById('editAlbumArtist').value = meta.artist || firstTrack.artist || '';
  document.getElementById('editAlbumDate').value   = meta.date || '';
  document.getElementById('editAlbumDesc').value   = meta.desc || '';

  const coverUrl = meta.cover || firstTrack.cover || '';
  const editImg  = document.getElementById('editCoverImg');
  const editPh   = document.getElementById('editCoverPlaceholder');

  if (coverUrl) {
    editImg.src = coverUrl;
    editImg.style.display = 'block';
    editPh.style.display  = 'none';
    toggleApiSearchUI(false);
  } else {
    editImg.style.display = 'none';
    editPh.style.display  = 'block';
    toggleApiSearchUI(true);
    // Pre-rellenar búsqueda con nombre del álbum
    DOM.apiSearchInput.value = meta.artist || firstTrack.artist || editingAlbumKey;
  }

  DOM.modalEditAlbum.classList.add('open');
});

document.getElementById('btnEditCancel').addEventListener('click', () => {
  DOM.modalEditAlbum.classList.remove('open');
});

DOM.modalEditAlbum.addEventListener('click', (e) => {
  if (e.target === DOM.modalEditAlbum) DOM.modalEditAlbum.classList.remove('open');
});

document.getElementById('btnCoverClear').addEventListener('click', () => {
  editingCoverDataUrl = '__CLEAR__';
  document.getElementById('editCoverImg').style.display = 'none';
  document.getElementById('editCoverPlaceholder').style.display = 'block';
  toggleApiSearchUI(true);
  showToast('Portada eliminada (guardá para confirmar)');
});

document.getElementById('editCoverInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    editingCoverDataUrl = ev.target.result;
    const editImg = document.getElementById('editCoverImg');
    editImg.src = editingCoverDataUrl;
    editImg.style.display = 'block';
    document.getElementById('editCoverPlaceholder').style.display = 'none';
    toggleApiSearchUI(false);
    showToast('Imagen cargada — guardá para aplicar');
  };
  reader.readAsDataURL(file);
});

document.getElementById('btnEditSave').addEventListener('click', () => {
  const meta      = state.albumMeta[editingAlbumKey] || {};
  meta.name   = document.getElementById('editAlbumName').value.trim()   || editingAlbumKey;
  meta.artist = document.getElementById('editAlbumArtist').value.trim();
  meta.date   = document.getElementById('editAlbumDate').value;
  meta.desc   = document.getElementById('editAlbumDesc').value.trim();

  if (editingCoverDataUrl === '__CLEAR__') delete meta.cover;
  else if (editingCoverDataUrl)            meta.cover = editingCoverDataUrl;

  state.albumMeta[editingAlbumKey] = meta;
  setLS(LS_KEYS.albumMeta, state.albumMeta);

  DOM.modalEditAlbum.classList.remove('open');
  refreshAlbumSelector();
  updateTrackList();

  // Si la pista activa es de este álbum, recargar UI
  if (state.activeTrackAlbum === editingAlbumKey) loadTrack(state.currentTrackIdx);

  showToast('Álbum actualizado correctamente', 'success');
});

document.getElementById('btnDeleteAlbum').addEventListener('click', () => {
  if (!confirm(`¿Eliminar el registro de "${editingAlbumKey}" de la biblioteca?\nEsto no borra los archivos de audio.`)) return;
  delete state.albumMeta[editingAlbumKey];
  setLS(LS_KEYS.albumMeta, state.albumMeta);
  DOM.modalEditAlbum.classList.remove('open');
  refreshAlbumSelector();
  loadTrack(0);
  showToast('Registro eliminado de la biblioteca');
});

// ══════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  // No disparar si hay un input enfocado
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  switch (e.code) {
    case 'Space':       e.preventDefault(); togglePlayback();    break;
    case 'ArrowRight':  e.preventDefault(); nextTrack();         break;
    case 'ArrowLeft':   e.preventDefault(); prevTrack();         break;
    case 'KeyS':        DOM.btnShuffle.click();                  break;
    case 'KeyR':        DOM.btnRepeat.click();                   break;
    case 'KeyF':        toggleFav(state.activeTrackData);        break;
    case 'ArrowUp':
      e.preventDefault();
      audio.volume = Math.min(1, audio.volume + 0.05);
      DOM.volSlider.value = Math.round(audio.volume * 100);
      setLS(LS_KEYS.volume, audio.volume);
      break;
    case 'ArrowDown':
      e.preventDefault();
      audio.volume = Math.max(0, audio.volume - 0.05);
      DOM.volSlider.value = Math.round(audio.volume * 100);
      setLS(LS_KEYS.volume, audio.volume);
      break;
  }
});

// ══════════════════════════════════════════════════════════════
//  ARRANQUE
// ══════════════════════════════════════════════════════════════
initPlayer();