const RAPID_API_URL = 'https://youtube-mp36.p.rapidapi.com/dl?id={VIDEO_ID}';
const RAPID_API_KEY = 'dc0265c45bmsh066240b5cdd1110p1779afjsncd6830a92a10';
const RAPID_FETCH_OPTS = { headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': 'youtube-mp36.p.rapidapi.com' } };

let rapidInfo = null;

const DB_NAME = 'nadia_files';
const DB_VER = 1;
const DB_STORE = 'files';

const openFileDB = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, DB_VER);
  r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

let fileDB = null;
const getFileDB = async () => { if (!fileDB) fileDB = await openFileDB(); return fileDB; };

const saveBlob = async (blob) => {
  const db = await getFileDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const r = tx.objectStore(DB_STORE).add({ blob, created: Date.now() });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
};

const loadBlob = async (id) => {
  const db = await getFileDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const r = tx.objectStore(DB_STORE).get(id);
    r.onsuccess = () => res(r.result ? r.result.blob : null);
    r.onerror = () => rej(r.error);
  });
};

const deleteBlob = async (id) => {
  const db = await getFileDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const r = tx.objectStore(DB_STORE).delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
};

const LS_KEYS = {
  albums:      'nadia_albums',
  favorites:   'nadia_favorites',
  uploaded:    'nadia_uploaded',
  albumExtras: 'nadia_album_extras',
  albumMeta:   'nadia_album_meta',
  volume:      'nadia_volume',
  currentView: 'nadia_current_view',
  customBg:    'nadia_custom_bg',
  customBgList:'nadia_custom_bg_list',
  effects:     'nadia_effects',
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

let state = {
  albums:          {},
  albumExtras:     {},
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
  customBg:        { bg: '', opacity: 0.25 },
  customBgUrls:    [],
  effects:         { bt21: true, discSpin: true, marquee: true, antonio: true },
};

const audio = new Audio();
audio.volume = getLS(LS_KEYS.volume, 0.75);
audio.preload = 'metadata';

const createdBlobUrls = new Set();
window.addEventListener('beforeunload', () => {
  createdBlobUrls.forEach(url => URL.revokeObjectURL(url));
  createdBlobUrls.clear();
});

const DOM = {
  disc:               document.getElementById('disc'),
  discGlow:           document.getElementById('discGlow'),
  discCoverBg:        document.getElementById('discCoverBg'),
  tonearm:            document.getElementById('tonearm'),
  labelBg:            document.getElementById('labelBg'),
  labelImg:           document.getElementById('labelImg'),
  labelEmoji:         document.getElementById('labelEmoji'),
  trackTitle:         document.getElementById('trackTitle'),
  trackArtist:        document.getElementById('trackArtist'),
  trackAlbum:         document.getElementById('trackAlbum'),
  progressFill:       document.getElementById('progressFill'),
  progressBar:        document.getElementById('progressBar'),
  timeNow:            document.getElementById('timeNow'),
  timeTotal:          document.getElementById('timeTotal'),
  btnPlay:            document.getElementById('btnPlay'),
  iconPlay:           document.getElementById('iconPlay'),
  iconPause:          document.getElementById('iconPause'),
  btnShuffle:         document.getElementById('btnShuffle'),
  btnRepeat:          document.getElementById('btnRepeat'),
  btnPrev:            document.getElementById('btnPrev'),
  btnNext:            document.getElementById('btnNext'),
  volSlider:          document.getElementById('volSlider'),
  tracklist:          document.getElementById('tracklist'),
  albumSelect:        document.getElementById('albumSelect'),
  searchInput:        document.getElementById('searchInput'),
  btnEditAlbum:       document.getElementById('btnEditAlbum'),
  toast:              document.getElementById('toast'),
  sidebar:            document.getElementById('sidebar'),
  sidebarOverlay:     document.getElementById('sidebarOverlay'),
  btnSidebarClose:    document.getElementById('btnSidebarClose'),
  sbOptUpload:        document.getElementById('sbOptUpload'),
  sbOptYt:            document.getElementById('sbOptYt'),
  sbOptCustomize:     document.getElementById('sbOptCustomize'),
  modalEditAlbum:     document.getElementById('modalEditAlbum'),
  modalUpload:        document.getElementById('modalUpload'),
  modalYt:            document.getElementById('modalYt'),
  uploadZone:         document.getElementById('uploadZone'),
  uploadFileInput:    document.getElementById('uploadFileInput'),
  uploadList:         document.getElementById('uploadList'),
  uploadAlbumAssign:  document.getElementById('uploadAlbumAssign'),
  uploadAlbumSelect:  document.getElementById('uploadAlbumSelect'),
  btnOpenUpload:      document.getElementById('btnOpenUpload'),
  btnUploadClose:     document.getElementById('btnUploadClose'),
  ytUrlInput:         document.getElementById('ytUrlInput'),
  ytSpinner:          document.getElementById('ytSpinner'),
  ytResultContainer:  document.getElementById('ytResultContainer'),
  ytThumbnail:        document.getElementById('ytThumbnail'),
  ytTitle:            document.getElementById('ytTitle'),
  ytChannel:          document.getElementById('ytChannel'),
  btnYtCopyTitle:     document.getElementById('btnYtCopyTitle'),
  ytOptions:          document.getElementById('ytOptions'),
  btnYtUpload:        document.getElementById('btnYtUpload'),
  btnYtClose:         document.getElementById('btnYtClose'),
  apiSearchContainer: document.getElementById('apiSearchContainer'),
  apiSearchInput:     document.getElementById('apiSearchInput'),
  btnApiSearch:       document.getElementById('btnApiSearch'),
  apiResultsGrid:     document.getElementById('apiResultsGrid'),
  modalCustomize:     document.getElementById('modalCustomize'),
  btnCustomClose:     document.getElementById('btnCustomClose'),
  customBgGrid:       document.getElementById('customBgGrid'),
  customBgFileInput:  document.getElementById('customBgFileInput'),
  customBgAdd:        document.getElementById('customBgAdd'),
  customOpacitySlider:document.getElementById('customOpacitySlider'),
  customOpacityVal:   document.getElementById('customOpacityVal'),
  bt21Overlay:        document.getElementById('bt21Overlay'),
  
  // -- Elementos agregados para Efectos --
  sbOptEffects:       document.getElementById('sbOptEffects'),
  modalEffects:       document.getElementById('modalEffects'),
  btnEffectsClose:    document.getElementById('btnEffectsClose'),
  toggleBt21:         document.getElementById('toggleBt21'),
  toggleDiscSpin:     document.getElementById('toggleDiscSpin'),
  toggleMarquee:      document.getElementById('toggleMarquee'),
  toggleAntonio:      document.getElementById('toggleAntonio'),
  idleTrackName:      document.getElementById('idleTrackName'),
  idleTrackArtist:    document.getElementById('idleTrackArtist'),
  antonioImg:         document.getElementById('antonioImg'),
  antonioDialogue:    document.getElementById('antonioDialogue'),
  antonioWrap:        document.getElementById('antonioWrap')
};

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

const getTrackId = (t) => t.fileId || t.src;
const isFav = (t) => state.favorites.has(getTrackId(t));

const toggleFav = (track) => {
  if (!track || !track.src) return;
  const id = getTrackId(track);
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
    showToast('Eliminado de favoritos');
    ANTONIO.onFavToggle(false);
  } else {
    state.favorites.add(id);
    showToast('Agregado a favoritos ♥', 'success');
    ANTONIO.onFavToggle(true);
  }
  setLS(LS_KEYS.favorites, [...state.favorites]);
  updateTrackList();
  refreshAlbumSelector();
};
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

const loadTrack = (idx) => {
  const filtered = getFilteredTracks();
  if (!filtered.length) {
    state.activeTrackData = {};
    DOM.trackTitle.textContent = 'Sin pistas en esta vista';
    DOM.trackArtist.textContent = '---';
    DOM.trackAlbum.textContent = '---';
    DOM.idleTrackName.textContent = '';
    DOM.idleTrackArtist.textContent = '';
    return;
  }

  idx = ((idx % filtered.length) + filtered.length) % filtered.length;
  state.currentTrackIdx    = idx;
  state.activeTrackData    = filtered[idx];
  state.activeTrackAlbum   = filtered[idx].albumOrigin;

  audio.src = state.activeTrackData.src || '';

  const meta        = state.albumMeta[state.activeTrackAlbum] || {};
  const displayAlbum = meta.name || state.activeTrackAlbum;
  const displayCover = meta.cover || state.activeTrackData.cover || '';

  DOM.trackTitle.textContent   = state.activeTrackData.title  || 'Sin título';
  DOM.trackArtist.textContent  = state.activeTrackData.artist || meta.artist || '---';
  DOM.trackAlbum.textContent   = displayAlbum !== '__UPLOADED__' ? displayAlbum : 'Archivos locales';
  DOM.idleTrackName.textContent   = DOM.trackTitle.textContent;
  DOM.idleTrackArtist.textContent = DOM.trackArtist.textContent;
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

  setTimeout(() => ANTONIO.onSongChange(), 600);

  updateTrackList();
  updateMediaSession();

  if (state.isPlaying) {
    audio.play().catch(err => {
      if (err && err.name === 'AbortError') return; // interrumpido por un cambio de pista rápido, no es un error real
      showToast('Error al reproducir', 'error');
    });
  }
};

const togglePlayback = (forceState) => {
  const wasPlaying = state.isPlaying;
  state.isPlaying = typeof forceState === 'boolean' ? forceState : !state.isPlaying;
  DOM.disc.classList.toggle('playing', state.isPlaying && state.effects.discSpin);
  DOM.discGlow.classList.toggle('active', state.isPlaying && state.effects.discSpin);
  DOM.tonearm.classList.toggle('on-disc', state.isPlaying);
  DOM.iconPlay.style.display  = state.isPlaying ? 'none'  : 'block';
  DOM.iconPause.style.display = state.isPlaying ? 'block' : 'none';
  document.querySelectorAll('.t-eq-bar').forEach(b => b.classList.toggle('paused', !state.isPlaying));

  if (state.isPlaying && !wasPlaying) ANTONIO.onPlay();
  else if (!state.isPlaying && wasPlaying) ANTONIO.onPause();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
  }

  // Idle timer: solo cuando hay reproducción activa
  if (state.isPlaying) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(enterIdle, IDLE_MS);
  } else {
    leaveIdle();
    clearTimeout(idleTimer);
  }

  if (state.isPlaying) {
    if (!state.activeTrackData || !state.activeTrackData.src) {
      showToast('No hay pista seleccionada', 'error');
      togglePlayback(false);
      return;
    }
    if (!audio.src || audio.src === window.location.href) audio.src = state.activeTrackData.src;
    audio.play().catch(err => {
      if (err && err.name === 'AbortError') return;
      showToast('Error al reproducir', 'error');
    });
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

    const numDiv = document.createElement('div');
    numDiv.className = 't-num';
    numDiv.textContent = String(idx + 1);
    row.appendChild(numDiv);

    const eqDiv = document.createElement('div');
    eqDiv.className = 't-eq';
    if (isCurrent) {
      const pClass = state.isPlaying ? '' : ' paused';
      for (let b = 0; b < 3; b++) {
        const bar = document.createElement('div');
        bar.className = 't-eq-bar' + pClass;
        eqDiv.appendChild(bar);
      }
    }
    row.appendChild(eqDiv);

    const coverDiv = document.createElement('div');
    coverDiv.className = 't-cover';
    if (coverUrl) {
      const img = document.createElement('img');
      img.src = coverUrl;
      img.alt = '';
      img.loading = 'lazy';
      coverDiv.appendChild(img);
    } else {
      coverDiv.innerHTML = '<svg width="14" height="14" fill="var(--muted)" viewBox="0 0 16 16"><path d="M9 13c0 1.105-1.12 2-2.5 2S4 14.105 4 13s1.12-2 2.5-2 2.5.895 2.5 2z"/><path fill-rule="evenodd" d="M9 3v10H8V3h1z"/><path d="M8 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 13 2.22V4L8 5V2.82z"/></svg>';
    }
    row.appendChild(coverDiv);

    const infoDiv = document.createElement('div');
    infoDiv.className = 't-info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 't-name';
    nameDiv.textContent = t.title;
    nameDiv.title = t.title;
    infoDiv.appendChild(nameDiv);
    const artDiv = document.createElement('div');
    artDiv.className = 't-art';
    artDiv.textContent = t.artist || '---';
    infoDiv.appendChild(artDiv);
    row.appendChild(infoDiv);

    const durDiv = document.createElement('div');
    durDiv.className = 't-dur';
    durDiv.textContent = dur;
    row.appendChild(durDiv);

    const favBtn = document.createElement('button');
    favBtn.className = 't-fav-btn' + (isFav(t) ? ' active' : '');
    favBtn.setAttribute('aria-label', 'Favorito');
    favBtn.innerHTML = '<svg width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/></svg>';
    row.appendChild(favBtn);

    const isUploaded = t.albumOrigin === '__UPLOADED__';
    const isAlbumExtra = !!t._extra;
    if (isUploaded || isAlbumExtra) {
      const delBtn = document.createElement('button');
      delBtn.className = 't-del-btn';
      delBtn.setAttribute('aria-label', 'Eliminar');
      delBtn.innerHTML = '<svg width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1z"/></svg>';
      row.appendChild(delBtn);
    }

    row.addEventListener('click', (e) => {
      if (e.target.closest('.t-fav-btn')) return;
      if (e.target.closest('.t-del-btn')) return;
      if (isCurrent) togglePlayback();
      else { loadTrack(idx); togglePlayback(true); }
    });

    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(t);
    });

    if (isUploaded) {
      const delBtn = row.querySelector('.t-del-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (t.fileId) { try { await deleteBlob(t.fileId); } catch (_) {} }
        state.uploadedSongs = state.uploadedSongs.filter(s => s.fileId ? s.fileId !== t.fileId : s.src !== t.src);
        setLS(LS_KEYS.uploaded, state.uploadedSongs.filter(t => t.src && (t.fileId || !t.src.startsWith('blob:'))));
        refreshAlbumSelector();
        updateTrackList();
        showToast('Archivo eliminado de la biblioteca');
      });
    } else if (isAlbumExtra) {
      const delBtn = row.querySelector('.t-del-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (t.fileId) { try { await deleteBlob(t.fileId); } catch (_) {} }
        const key = t._albumKey;
        if (state.albums[key]) {
          state.albums[key] = state.albums[key].filter(s => s.fileId ? s.fileId !== t.fileId : s.src !== t.src);
        }
        if (state.albumExtras[key]) {
          state.albumExtras[key] = state.albumExtras[key].filter(s => s.fileId ? s.fileId !== t.fileId : s.src !== t.src);
          if (!state.albumExtras[key].length) delete state.albumExtras[key];
        }
        saveAlbumExtras();
        refreshAlbumSelector();
        updateTrackList();
        showToast('Archivo eliminado del álbum');
      });
    }

    fragment.appendChild(row);
  });

  DOM.tracklist.appendChild(fragment);
};

const restoreView = (view) => {
  if (view && Array.from(DOM.albumSelect.options).some(o => o.value === view)) {
    DOM.albumSelect.value = view;
    state.currentView = view;
  }
};
const saveAlbumExtras = () => {
  const clean = {};
  Object.entries(state.albumExtras).forEach(([key, tracks]) => {
    const filtered = tracks.filter(t => t.src && (t.fileId || !t.src.startsWith('blob:')));
    if (filtered.length) clean[key] = filtered;
  });
  setLS(LS_KEYS.albumExtras, clean);
};

const mergeAlbumExtras = () => {
  Object.entries(state.albumExtras).forEach(([key, tracks]) => {
    if (!tracks || !tracks.length) return;
    if (!state.albums[key]) state.albums[key] = [];
    state.albums[key] = state.albums[key].concat(tracks);
  });
};

const initPlayer = async () => {
  state.favorites    = new Set(getLS(LS_KEYS.favorites, []));
  state.albumMeta    = getLS(LS_KEYS.albumMeta, {});
  state.uploadedSongs = getLS(LS_KEYS.uploaded, []).filter(t => t.src && (t.fileId || !t.src.startsWith('blob:')));

  // rehydrate blob URLs from IndexedDB
  for (const song of state.uploadedSongs) {
    if (song.fileId) {
      try {
        const blob = await loadBlob(song.fileId);
        if (blob) {
          const url = URL.createObjectURL(blob);
          createdBlobUrls.add(url);
          song.src = url;
        } else {
          song.src = '';
        }
      } catch (e) {
        song.src = '';
      }
    }
  }
  state.uploadedSongs = state.uploadedSongs.filter(t => t.src);

  // -- Pistas subidas y asignadas a álbumes existentes: rehidratar igual que uploadedSongs --
  state.albumExtras = getLS(LS_KEYS.albumExtras, {});
  for (const key of Object.keys(state.albumExtras)) {
    const list = state.albumExtras[key].filter(t => t.src && (t.fileId || !t.src.startsWith('blob:')));
    for (const song of list) {
      if (song.fileId) {
        try {
          const blob = await loadBlob(song.fileId);
          if (blob) {
            const url = URL.createObjectURL(blob);
            createdBlobUrls.add(url);
            song.src = url;
          } else {
            song.src = '';
          }
        } catch (e) {
          song.src = '';
        }
      }
    }
    state.albumExtras[key] = list.filter(t => t.src);
    if (!state.albumExtras[key].length) delete state.albumExtras[key];
  }

  state.customBg    = getLS(LS_KEYS.customBg, { bg: '', opacity: 0.25 });
  state.customBgUrls = getLS(LS_KEYS.customBgList, []);
  state.effects     = getLS(LS_KEYS.effects, { bt21: true, discSpin: true, marquee: true, antonio: true });
  if (!('antonio' in state.effects)) state.effects.antonio = true;
  DOM.volSlider.value = Math.round(audio.volume * 100);
  applyCustomBg(state.customBg);
  renderCustomBgUrls();
  DOM.toggleBt21.checked = state.effects.bt21;
  DOM.toggleDiscSpin.checked = state.effects.discSpin;
  DOM.toggleMarquee.checked = state.effects.marquee;
  DOM.toggleAntonio.checked = state.effects.antonio;
  if (!state.effects.antonio) ANTONIO.disable();

  const savedView = getLS(LS_KEYS.currentView, '__ALL__');

  try {
    const res = await fetch('songs.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.albums = await res.json();
    mergeAlbumExtras();
    refreshAlbumSelector();
    restoreView(savedView);
    loadTrack(0);
  } catch (err) {
    console.error('Error cargando songs.json:', err);
    mergeAlbumExtras();
    refreshAlbumSelector();
    restoreView(savedView);
    if (state.uploadedSongs.length) loadTrack(0);
    else DOM.trackTitle.textContent = 'Sin biblioteca disponible';
  }

  if (state.effects.bt21) setTimeout(showBt21Mosaic, 400);
};

audio.addEventListener('loadedmetadata', () => {
  const key = getTrackId(state.activeTrackData);
  state.durations[key] = Math.floor(audio.duration);
  DOM.timeTotal.textContent = formatTime(audio.duration);
  // Solo actualizamos el texto de duración de la fila actual, sin reconstruir toda la lista
  const currentDur = DOM.tracklist.querySelector('.track-row.current .t-dur');
  if (currentDur) currentDur.textContent = formatTime(audio.duration);
  updateMediaPositionState();
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  DOM.timeNow.textContent = formatTime(audio.currentTime);
  const ratio = audio.currentTime / audio.duration;
  DOM.progressFill.style.width = `${ratio * 100}%`;
  DOM.progressBar.style.setProperty('--thumb-x', `${ratio * 100}%`);
});

audio.addEventListener('seeked', () => updateMediaPositionState());

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

DOM.btnPlay.addEventListener('click', () => togglePlayback());
DOM.btnPrev.addEventListener('click', () => { prevTrack(); ANTONIO.onPrev(); });
DOM.btnNext.addEventListener('click', () => { nextTrack(); ANTONIO.onNext(); });

DOM.btnShuffle.addEventListener('click', () => {
  if (['__ALL__','__FAV__','__UPLOADED__'].includes(state.currentView)) {
    showToast('Aleatorio solo disponible en un álbum', 'error');
    return;
  }
  state.shuffle = !state.shuffle;
  if (state.shuffle && state.repeat) {
    state.repeat = false;
    DOM.btnRepeat.classList.remove('active');
  }
  DOM.btnShuffle.classList.toggle('active', state.shuffle);
  showToast(state.shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado');
  ANTONIO.onShuffleToggle(state.shuffle);
});

DOM.btnRepeat.addEventListener('click', () => {
  state.repeat = !state.repeat;
  if (state.repeat && state.shuffle) {
    state.shuffle = false;
    DOM.btnShuffle.classList.remove('active');
  }
  DOM.btnRepeat.classList.toggle('active', state.repeat);
  showToast(state.repeat ? 'Repetición activada' : 'Repetición desactivada');
  ANTONIO.onRepeatToggle(state.repeat);
});

DOM.volSlider.addEventListener('input', (e) => {
  audio.volume = e.target.value / 100;
  setLS(LS_KEYS.volume, audio.volume);
  ANTONIO.onVolumeChange(audio.volume);
});

DOM.albumSelect.addEventListener('change', (e) => {
  state.currentView  = e.target.value;
  setLS(LS_KEYS.currentView, state.currentView);
  state.searchQuery  = '';
  DOM.searchInput.value = '';
  const isSpecial = ['__ALL__','__FAV__','__UPLOADED__'].includes(state.currentView);
  if (isSpecial && state.shuffle) {
    state.shuffle = false;
    DOM.btnShuffle.classList.remove('active');
  }
  DOM.btnEditAlbum.style.display = isSpecial ? 'none' : 'flex';
  if (state.currentView === '__FAV__') ANTONIO.onFavView();
  loadTrack(0);
});

let searchDebounceTimer = null;
DOM.searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(updateTrackList, 180);
  ANTONIO.onSearch(state.searchQuery);
});

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
let seekRafPending = false;
DOM.progressBar.addEventListener('touchmove', e => {
  const x = e.touches[0].clientX;
  if (seekRafPending) return;
  seekRafPending = true;
  requestAnimationFrame(() => {
    seekTo(x);
    seekRafPending = false;
  });
}, { passive: true });
DOM.progressBar.addEventListener('touchend',   () => DOM.progressBar.classList.remove('dragging'), { passive: true });

// Detecta el tipo MIME de una portada (cover) para que iOS/Android
// muestren correctamente la carátula en los controles del sistema.
const guessImageType = (url) => {
  if (!url) return 'image/jpeg';
  if (url.startsWith('data:')) {
    const m = url.match(/^data:([^;]+);/);
    return m ? m[1] : 'image/jpeg';
  }
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  if (ext === 'png')  return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif')  return 'image/gif';
  return 'image/jpeg';
};

// Actualiza la posición/duración reportada a los controles nativos
// (lock screen / notificación) de Android e iOS.
const updateMediaPositionState = () => {
  if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
  if (!isFinite(audio.duration) || audio.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration:     audio.duration,
      playbackRate: audio.playbackRate || 1,
      position:     Math.min(audio.currentTime, audio.duration),
    });
  } catch { /* algunos navegadores pueden lanzar si el estado es inválido */ }
};

const updateMediaSession = () => {
  if (!('mediaSession' in navigator)) return;
  const meta     = state.albumMeta[state.activeTrackAlbum] || {};
  const coverUrl = meta.cover || state.activeTrackData.cover || '';
  const artType  = guessImageType(coverUrl);

  navigator.mediaSession.metadata = new MediaMetadata({
    title:   state.activeTrackData.title  || '',
    artist:  state.activeTrackData.artist || meta.artist || '',
    album:   meta.name || state.activeTrackAlbum || '',
    artwork: coverUrl ? [
      { src: coverUrl, sizes: '96x96',   type: artType },
      { src: coverUrl, sizes: '128x128', type: artType },
      { src: coverUrl, sizes: '192x192', type: artType },
      { src: coverUrl, sizes: '256x256', type: artType },
      { src: coverUrl, sizes: '384x384', type: artType },
      { src: coverUrl, sizes: '512x512', type: artType },
    ] : [],
  });

  navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';

  // Acciones básicas, soportadas casi en todas partes
  navigator.mediaSession.setActionHandler('play', () => togglePlayback(true));
  navigator.mediaSession.setActionHandler('pause', () => togglePlayback(false));
  navigator.mediaSession.setActionHandler('previoustrack', () => { prevTrack(); ANTONIO.onPrev(); });
  navigator.mediaSession.setActionHandler('nexttrack',     () => { nextTrack(); ANTONIO.onNext(); });

  // Acciones extra: algunos navegadores antiguos lanzan error si no las
  // reconocen, así que cada una se registra de forma segura.
  const setOptionalHandler = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); }
    catch { /* acción no soportada en este navegador */ }
  };

  setOptionalHandler('stop', () => {
    togglePlayback(false);
    audio.currentTime = 0;
    updateMediaPositionState();
  });

  // Saltos +/-10s desde la pantalla de bloqueo / widget (Android e iOS)
  setOptionalHandler('seekbackward', (details) => {
    const skip = details?.seekOffset || 10;
    audio.currentTime = Math.max(0, audio.currentTime - skip);
    updateMediaPositionState();
  });
  setOptionalHandler('seekforward', (details) => {
    const skip = details?.seekOffset || 10;
    audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + skip);
    updateMediaPositionState();
  });
  // Arrastrar la barra de progreso desde los controles nativos
  setOptionalHandler('seekto', (details) => {
    if (details?.fastSeek && 'fastSeek' in audio) {
      audio.fastSeek(details.seekTime);
    } else if (typeof details?.seekTime === 'number') {
      audio.currentTime = details.seekTime;
    }
    updateMediaPositionState();
  });

  updateMediaPositionState();
};

let lockCount = 0;
const lockBody = () => {
  lockCount++;
  if (lockCount === 1) {
    document.addEventListener('touchmove', preventTouchMove, { passive: false });
  }
};
const unlockBody = () => {
  lockCount = Math.max(0, lockCount - 1);
  if (!lockCount) {
    document.removeEventListener('touchmove', preventTouchMove);
  }
};
const preventTouchMove = (e) => {
  if (!e.target.closest('.modal-sheet, .sidebar-body, .sidebar, .tracklist, .upload-list, .effects-list')) {
    e.preventDefault();
  }
};

// Reinicia posición de la vista al tocar 5 veces
let tapCount = 0; let tapTimer = null;
document.addEventListener('touchstart', () => {
  if (document.querySelector('.modal-overlay.open, .sidebar.open')) return;
  tapCount++;
  if (tapCount >= 5) {
    tapCount = 0; clearTimeout(tapTimer);
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  } else {
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, 2000);
  }
}, { passive: true });

// Evita que el teclado móvil mueva la vista
if (window.visualViewport) {
  let vpHeight = window.visualViewport.height;
  window.visualViewport.addEventListener('resize', () => {
    const diff = vpHeight - window.visualViewport.height;
    if (Math.abs(diff) > 50) {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      vpHeight = window.visualViewport.height;
    }
  });
}

const openSidebar = () => {
  DOM.sidebar.classList.add('open');
  DOM.sidebarOverlay.classList.add('open');
  lockBody();
  ANTONIO.onOpen();
};
const closeSidebar = () => {
  DOM.sidebar.classList.remove('open');
  DOM.sidebarOverlay.classList.remove('open');
  unlockBody();
  ANTONIO.onClose();
};
DOM.btnOpenUpload.addEventListener('click', openSidebar);
DOM.btnSidebarClose.addEventListener('click', closeSidebar);
DOM.sidebarOverlay.addEventListener('click', closeSidebar);

DOM.sbOptUpload.addEventListener('click', () => {
  closeSidebar();
  DOM.modalUpload.classList.add('open'); lockBody();
});
DOM.sbOptYt.addEventListener('click', () => {
  closeSidebar();
  DOM.modalYt.classList.add('open'); lockBody();
});
DOM.sbOptCustomize.addEventListener('click', () => {
  closeSidebar();
  DOM.modalCustomize.classList.add('open'); lockBody();
});

// -- NUEVO: Evento para abrir Efectos --
DOM.sbOptEffects.addEventListener('click', () => {
  closeSidebar();
  DOM.modalEffects.classList.add('open'); lockBody();
});

// -- NUEVO: Eventos para cerrar Efectos --
DOM.btnEffectsClose.addEventListener('click', () => { DOM.modalEffects.classList.remove('open'); unlockBody(); });
DOM.modalEffects.addEventListener('click', (e) => {
  if (e.target === DOM.modalEffects) { DOM.modalEffects.classList.remove('open'); unlockBody(); }
});

// Toggle handlers
DOM.toggleBt21.addEventListener('change', () => {
  state.effects.bt21 = DOM.toggleBt21.checked;
  setLS(LS_KEYS.effects, state.effects);
});
DOM.toggleDiscSpin.addEventListener('change', () => {
  state.effects.discSpin = DOM.toggleDiscSpin.checked;
  setLS(LS_KEYS.effects, state.effects);
  DOM.disc.classList.toggle('playing', state.effects.discSpin && state.isPlaying);
  DOM.discGlow.classList.toggle('active', state.effects.discSpin && state.isPlaying);
});
DOM.toggleMarquee.addEventListener('change', () => {
  state.effects.marquee = DOM.toggleMarquee.checked;
  setLS(LS_KEYS.effects, state.effects);
});
DOM.toggleAntonio.addEventListener('change', () => {
  state.effects.antonio = DOM.toggleAntonio.checked;
  setLS(LS_KEYS.effects, state.effects);
  if (!state.effects.antonio) {
    ANTONIO.disable();
  } else {
    ANTONIO.enable();
  }
});

DOM.btnUploadClose.addEventListener('click', () => { DOM.modalUpload.classList.remove('open'); unlockBody(); });
DOM.modalUpload.addEventListener('click', (e) => {
  if (e.target === DOM.modalUpload) { DOM.modalUpload.classList.remove('open'); unlockBody(); }
});

DOM.btnYtClose.addEventListener('click', () => { DOM.modalYt.classList.remove('open'); unlockBody(); });
DOM.modalYt.addEventListener('click', (e) => {
  if (e.target === DOM.modalYt) { DOM.modalYt.classList.remove('open'); unlockBody(); }
});

DOM.btnCustomClose.addEventListener('click', () => { DOM.modalCustomize.classList.remove('open'); unlockBody(); });
DOM.modalCustomize.addEventListener('click', (e) => {
  if (e.target === DOM.modalCustomize) { DOM.modalCustomize.classList.remove('open'); unlockBody(); }
});

const applyCustomBg = (bgState) => {
  if (!bgState) bgState = state.customBg;
  const full = document.getElementById('customBgFull');
  const p = document.querySelector('.player');
  if (!full || !p) return;
  if (bgState.bg) {
    full.style.backgroundImage = `url('${bgState.bg}')`;
    full.style.opacity = String(bgState.opacity);
    p.classList.add('has-custom-bg');
  } else {
    full.style.backgroundImage = '';
    full.style.opacity = '0';
    p.classList.remove('has-custom-bg');
  }
};

const selectBgOption = (value) => {
  DOM.customBgGrid.querySelectorAll('.custom-bg-opt').forEach(el => {
    el.classList.toggle('active', el.dataset.bg === value);
  });
};

const renderCustomBgUrls = () => {
  DOM.customBgGrid.querySelectorAll('.custom-bg-opt[data-custom]').forEach(el => el.remove());
  state.customBgUrls.forEach((url, i) => {
    const div = document.createElement('div');
    div.className = 'custom-bg-opt';
    div.dataset.bg = url;
    div.dataset.custom = '1';
    div.innerHTML = `<img src="${url}" alt="personalizado ${i+1}" loading="lazy">
      <button class="custom-bg-remove" data-idx="${i}" aria-label="Eliminar">✕</button>`;
    DOM.customBgGrid.insertBefore(div, DOM.customBgAdd);
  });
};

DOM.customBgFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('La imagen es muy grande (máx 2 MB)', 'error');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    state.customBgUrls.push(ev.target.result);
    setLS(LS_KEYS.customBgList, state.customBgUrls);
    renderCustomBgUrls();
    state.customBg.bg = ev.target.result;
    applyCustomBg();
    selectBgOption(state.customBg.bg);
    setLS(LS_KEYS.customBg, state.customBg);
    showToast('Fondo personalizado agregado', 'success');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

DOM.customBgAdd.addEventListener('click', () => DOM.customBgFileInput.click());

DOM.customBgGrid.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.custom-bg-remove');
  if (removeBtn) {
    const idx = parseInt(removeBtn.dataset.idx);
    state.customBgUrls.splice(idx, 1);
    setLS(LS_KEYS.customBgList, state.customBgUrls);
    renderCustomBgUrls();
    if (!state.customBgUrls.includes(state.customBg.bg)) {
      state.customBg.bg = '';
      applyCustomBg();
      selectBgOption('');
      setLS(LS_KEYS.customBg, state.customBg);
    }
    return;
  }
  const opt = e.target.closest('.custom-bg-opt');
  if (!opt || opt === DOM.customBgAdd) return;
  state.customBg.bg = opt.dataset.bg;
  applyCustomBg();
  selectBgOption(state.customBg.bg);
  setLS(LS_KEYS.customBg, state.customBg);
});

DOM.customOpacitySlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  state.customBg.opacity = val;
  DOM.customOpacityVal.textContent = val.toFixed(2);
  applyCustomBg();
  setLS(LS_KEYS.customBg, state.customBg);
});

const customOpenObserver = new MutationObserver(() => {
  if (DOM.modalCustomize.classList.contains('open')) {
    DOM.customOpacitySlider.value = state.customBg.opacity;
    DOM.customOpacityVal.textContent = state.customBg.opacity.toFixed(2);
    selectBgOption(state.customBg.bg);
    renderCustomBgUrls();
  }
});
customOpenObserver.observe(DOM.modalCustomize, { attributes: true, attributeFilter: ['class'] });

let idleTimer = null;
const IDLE_MS = 12000;

const enterIdle = () => {
  if (!state.isPlaying) return;
  const anyModalOpen = [DOM.modalEditAlbum, DOM.modalUpload, DOM.modalYt, DOM.modalCustomize, DOM.modalEffects]
    .some(m => m.classList.contains('open'));
  if (anyModalOpen) return;
  const p = document.querySelector('.player');
  p.classList.add('idle-fading');

  if (state.effects.marquee) {
    const members = ['RM','Jin','Suga','J-Hope','Jimin','V','Jungkook'];
    const memberColors = ['#ff6b8a','#ff9f6b','#ffe66b','#6bff8a','#6bc9ff','#c96bff','#ff6bd9'];
    const overlay = document.createElement('div');
    overlay.className = 'idle-marquee';
    overlay.id = 'idleMarquee';

    // Más filas, repartidas en toda la pantalla; las animaciones CSS son GPU
    const rowCount = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ? 8 : 12;

    for (let row = 0; row < rowCount; row++) {
      const strip = document.createElement('div');
      strip.className = 'idle-marquee-strip';

      const words = [];
      const wordCount = 10 + Math.floor(Math.random() * 8);
      for (let i = 0; i < wordCount; i++) {
        if (i > 0 && i % 9 === 0) {
          words.push(`<span class="nadia-gold">BTS</span>`);
        } else {
          const m = members[Math.floor(Math.random() * members.length)];
          const c = memberColors[Math.floor(Math.random() * memberColors.length)];
          words.push(`<span style="color:${c}">${m}</span>`);
        }
      }
      strip.innerHTML = words.join('&nbsp;&nbsp;&nbsp;&nbsp;');

      const dir = row % 2 === 0 ? 'scrollRL' : 'scrollLR';
      const dur = 35 + Math.random() * 40;
      const topPos = 2 + row * (96 / (rowCount - 1)) + (Math.random() - 0.5) * 1.5;
      const fontSize = 26 + Math.random() * 28;
      const opacity = 0.10 + Math.random() * 0.18;
      strip.style.cssText = `top:${topPos}%;font-size:${fontSize}px;opacity:${opacity};animation:${dir} ${dur}s linear infinite;animation-delay:${(Math.random() * -30).toFixed(1)}s`;
      overlay.appendChild(strip);
    }

    document.body.appendChild(overlay);
    overlay.offsetHeight;
    overlay.classList.add('visible');
  }

  setTimeout(() => p.classList.add('idle'), 420);
};
const leaveIdle = () => {
  const p = document.querySelector('.player');
  if (!p.classList.contains('idle') && !p.classList.contains('idle-fading')) return;
  p.classList.remove('idle');
  requestAnimationFrame(() => p.classList.remove('idle-fading'));

  const marquee = document.getElementById('idleMarquee');
  if (marquee) marquee.remove();
};
let resetIdleThrottle = false;
const resetIdle = () => {
  leaveIdle();
  clearTimeout(idleTimer);
  if (state.isPlaying) idleTimer = setTimeout(enterIdle, IDLE_MS);
};
// Para eventos de alta frecuencia (mousemove/wheel) limitamos a 1 llamada cada 300ms
const resetIdleThrottled = () => {
  if (resetIdleThrottle) return;
  resetIdleThrottle = true;
  resetIdle();
  setTimeout(() => { resetIdleThrottle = false; }, 300);
};

const idleEventsImmediate = ['click', 'touchstart', 'keydown'];
const idleEventsThrottled = ['mousemove', 'wheel'];
idleEventsImmediate.forEach(ev => {
  document.addEventListener(ev, resetIdle, { passive: true });
});
idleEventsThrottled.forEach(ev => {
  document.addEventListener(ev, resetIdleThrottled, { passive: true });
});

// ─── Antonio ─────────────────────────────────────────────
const antonioSfx = new Audio();
antonioSfx.volume = 0.3;
const ANTONIO = {
  wrap:     DOM.antonioWrap,
  img:      DOM.antonioImg,
  bubble:   DOM.antonioDialogue,
  base:     'recursos/Character%20siderbar/',
  em:       'normal',
  dbTimer:  null,
  sleepTimer: null,
  _swapTimer: null,
  _msgToken: 0,
  sidebarOpen: false,
  lastInteraction: Date.now(),
  enabled: true,
  petCount: 0,
  petCooldown: false,

  faces: {
    normal:    'Antonio-normal.png',
    happy:     'Antonio-feliz.png',
    happy2:    'Antonio-feliz-2.png',
    dancing:   'antonio-baile.gif',
    sleeping:  'Antonio-dormido.png',
    excited:   'Antonio-emocionado.png',
    surprised: 'Antonio-sorprendido.png'
  },

  lines: {
    greeting: [
      'hola', 'qué tal', 'bonito día', '¡hey!', 'hola, ¿cómo estás?',
      '¡qué bueno verte!', 'te extrañaba un poquito', 'volviste',
      'aquí sigo, esperándote', '¿listo para escuchar algo?',
      'buenas, buenas', 'hola hola, ¿qué se cuenta?'
    ],
    general: [
      'odio la leche', 'me gusta la música', '¿ya comiste?', 'estoy feliz',
      'qué lindo día', 'me aburro', 'pensando en nada en particular',
      '¿sabías que los gatos duermen como 16 horas al día?',
      'tengo hambre otra vez', 'creo que necesito unas vacaciones',
      'esta sidebar es mi hogar', '¿qué hora es allá afuera?',
      'me preguntaba qué canción sigue', 'el silencio también es música a veces',
      'a veces solo quiero flotar por aquí', 'cero planes, mucha vibra'
    ],
    song: [
      'me encanta ♪', 'buena canción', '¡qué temazo!', 'esta me sé',
      'me llega al alma', 'esta la tengo en repeat mental',
      'subile un poquito a esta', 'esta me recuerda algo bonito',
      'qué buen gusto tenés', 'esto sí es música', 'esta me pone de buenas',
      'cantan bien estos chinitos'
    ],
    dance: [
      '¡a bailar!', 'suena bien', 'me encanta esta parte', 'sáca',
      'este ritmo me mueve solo', 'no puedo quedarme quieto',
      'siéntelo eh eh eh', 'esto pega fuerte', 'uno, dos, ¡y se mueve!',
      'mi cuerpo ya no deja de bailar', 'asi, es si'
    ],
    sleep: [
      'zzz...', 'estoy cansado pipipi...', 'qué descanso...', 'buenas noches...',
      '...', 'cinco minutitos más...', 'no me despierten, por favor...',
      'soñando con melodías... y galletas', 'shh... silencio...'
    ],
    heat: [
      'hace mucho calor', 'qué calor... derritiéndome',
      'necesito un ventilador y baso de agua', 'siento que me derrito poco a poco',
      'alguien abra una ventana, por favor', '¿no tenés un abanico por ahí? o sopla pues'
    ],
    excited: [
      '¡wow!', '¡increíble!', 'me encanta', '¡qué bien!',
      '¡esto es genial!', '¡no me lo esperaba!', '¡siiii!',
      '¡qué emoción!'
    ],
    surprised: [
      '¿qué fue eso?', 'oh', '¡Nadia???? Nadia???!', '¿escuchaste eso?',
      'me asustaste un poco', '¡eh! eso no me lo esperaba',
      '¿pasó algo?'
    ],
    pet: [
      '¡jeje, eso me gusta!', '¿me estás acariciando? qué lindo',
      'otra vez, otra vez', 'aaah, qué divertido', 'deberias ir a tocarlo a el', '¡hola, hola!',
      'eso me hace cosquillas', '¡me encanta la atención!',
      '¿somos amigos ahora?', 'ronroneo internamente',
      '¡sigue así!', 'esto es lo mejor de mi día','si, La estrella de la pagina,ya lo se'
    ],
    petTired: [
      'ya, ya, suficiente por hoy jeje', 'necesito un descansito de cariños',
      'jaja vale, vale, ya entendí que me querés', 'dame un segundo para procesarlo',
      'demasiado amor de una sola vez','tu novio tenia razon, si le sabes al cardio ufff...'
    ],
    favAdd: [
      '¡a la lista de favoritos va!', 'buena elección, esa me gusta',
      '♥ guardada para siempre', 'esta sí merece estar ahí',
      '¡excelente gusto musical!'
    ],
    favRemove: [
      'okey, fuera de favoritos', '¿ya no te gusta tanto?',
      'bueno, espacio libre para otra', 'entendido, la dejamos ir'
    ],
    shuffleOn: [
      '¡aleatorio activado, qué emoción!', 'sorpréndeme con la próxima',
      'no sé qué viene, ¡me encanta!', 'modo aletorio activado, a ver que sale'
    ],
    shuffleOff: [
      'orden otra vez, todo en su lugar', 'volvimos al orden normal',
      'sin sorpresas por ahora'
    ],
    repeatOn: [
      'repetir, repetir, repetir', 'esta canción no se va a ninguna parte',
      'modo bucle activado, me parece perfecto es que esa es buena'
    ],
    repeatOff: [
      'seguimos avanzando entonces', 'pasamos a la siguiente cuando toque'
    ],
    volumeUp: [
      '¡más fuerte así me gusta!', 'subile, subile',
      'ahora sí se escucha'
    ],
    volumeDown: [
      'ah, más tranquilo, qué bien', 'bajar el volumen también tiene su encanto',
      'no le bajes, no hace falta'
    ],
    volumeMute: [
      'eh... ¿se apagó el sonido?', 'silencio total por aquí',
      '¿solo viendo el disco girar ahora?'
    ],
    search: [
      'buscando, buscando...', '¿qué estamos buscando hoy?',
      'a ver qué encontramos'
    ],
    upload: [
      '¡música nueva! qué emoción', 'bienvenida la nueva canción',
      'la biblioteca crece', '¡otra más para la colección!'
    ],
    favView: [
      'tus favoritas, qué buena selección', 'esta es la zona especial',
      'lo mejor de lo mejor está aquí'
    ],
    next: [
      'a ver qué sigue', 'siguiente pista, vamos',
      'cambio de canción, ¡aquí vamos!'
    ],
    prev: [
      'volvimos un poco atrás', 'esa me gustó, repitamos',
      'otra vez esta, buena decisión','esa parte hay que volver a escucharla'
    ],
    click: [
      '¡hola!', '¿sí?', 'dime', '¿necesitás algo?',
      '¡aquí estoy!', '¿qué onda?', '¡wasaaaaa!',
    ]
  },

  setEmotion(em, img) {
    if (!this.enabled) return;
    this.em = em;
    this.img.src = img || (this.base + this.faces[em] || this.faces.normal);
    this.img.classList.toggle('dancing', em === 'dancing');
  },

  // Muestra un texto en el globo de diálogo evitando que dos mensajes se
  // superpongan: si ya hay uno visible, primero se desvanece y luego
  // aparece el nuevo (crossfade). Cada llamada tiene un "token" propio
  // para que los timers antiguos no oculten o pisen un mensaje más nuevo.
  say(list, duration) {
    if (!this.enabled || !this.sidebarOpen) return;
    const text = list[Math.floor(Math.random() * list.length)];
    let final = text;
    if (list === this.lines.song && state.activeTrackData?.title) {
      final = text + ' ' + state.activeTrackData.title;
    }
    this._queueMessage(final, duration || 6000);
  },

  // Encola/aplica el mensaje, gestionando el crossfade y el token de validez.
  _queueMessage(text, duration) {
    clearTimeout(this.dbTimer);
    clearTimeout(this._swapTimer);
    const token = ++this._msgToken;

    const apply = () => {
      if (token !== this._msgToken) return; // un mensaje más nuevo ya tomó el control
      this.bubble.textContent = text;
      this.bubble.classList.add('show');
      this.dbTimer = setTimeout(() => {
        if (token !== this._msgToken) return;
        this.bubble.classList.remove('show');
      }, duration);
    };

    if (this.bubble.classList.contains('show')) {
      // Hay un mensaje visible: lo desvanecemos antes de mostrar el nuevo
      this.bubble.classList.remove('show');
      this._swapTimer = setTimeout(apply, 220);
    } else {
      apply();
    }
  },

  scheduleNext(delay) {
    clearTimeout(this._nextTimer);
    const d = delay ?? (6000 + Math.random() * 10000);
    this._nextTimer = setTimeout(() => {
      if (!this.sidebarOpen) return;
      const r = Math.random();
      if (state.isPlaying && r < 0.3) {
        this.say(this.lines.dance);
      } else if (r < 0.55) {
        this.say(this.lines.general);
      } else if (r < 0.7) {
        this.say(this.lines.heat);
      } else if (r < 0.8) {
        this.onSurprise();
        this.scheduleNext();
        return;
      } else {
        this.say(this.lines.greeting);
      }
      this.scheduleNext();
    }, d);
  },

  onOpen() {
    this.sidebarOpen = true;
    if (!this.enabled) return;
    this.lastInteraction = Date.now();
    clearTimeout(this.sleepTimer);
    clearTimeout(this._nextTimer);
    const firstDelay = 1200 + Math.random() * 1000;
    this._nextTimer = setTimeout(() => {
      if (!this.sidebarOpen) return;
      if (state.isPlaying) {
        this.setEmotion('dancing');
        this.say(this.lines.dance);
      } else {
        this.setEmotion('normal');
        this.say(this.lines.greeting);
      }
      this.scheduleSleep();
      this.scheduleNext(8000 + Math.random() * 7000);
    }, firstDelay);
  },

  onClose() {
    this.sidebarOpen = false;
    if (!this.enabled) return;
    clearTimeout(this.dbTimer);
    clearTimeout(this.sleepTimer);
    clearTimeout(this._swapTimer);
    this._msgToken++;
    this.bubble.classList.remove('show');
  },

  onPlay() {
    if (!this.enabled) return;
    this.lastInteraction = Date.now();
    this.setEmotion('dancing');
    this.say(this.lines.dance);
    if (this.sidebarOpen) {
      clearTimeout(this.sleepTimer);
      this.scheduleSleep();
      clearTimeout(this._nextTimer);
      this.scheduleNext(8000 + Math.random() * 7000);
    }
  },

  onPause() {
    if (!this.enabled) return;
    if (!this.sidebarOpen) return;
    this.setEmotion('normal');
    this.bubble.classList.remove('show');
    clearTimeout(this.sleepTimer);
    this.scheduleSleep();
    clearTimeout(this._nextTimer);
    this.scheduleNext(6000 + Math.random() * 6000);
  },

  onSongChange() {
    if (!this.enabled || !this.sidebarOpen) return;
    this.setEmotion('excited');
    this.say(this.lines.song);
    this.lastInteraction = Date.now();
    clearTimeout(this.sleepTimer);
    this.scheduleSleep();
    clearTimeout(this._nextTimer);
    this.scheduleNext(8000 + Math.random() * 7000);
    clearTimeout(this._emRevert);
    this._emRevert = setTimeout(() => {
      if (!this.sidebarOpen) return;
      this.setEmotion(state.isPlaying ? 'dancing' : 'normal');
    }, 5000);
  },

  scheduleSleep() {
    clearTimeout(this.sleepTimer);
    const ms = state.isPlaying ? 60000 : 30000;
    this.sleepTimer = setTimeout(() => {
      if (!this.sidebarOpen) return;
      this.setEmotion('sleeping');
      this.say(this.lines.sleep, 5000);
    }, ms);
  },

  onHeat() {
    if (!this.enabled || !this.sidebarOpen) return;
    this.setEmotion('normal');
    this.say(this.lines.heat);
  },

  onSurprise() {
    if (!this.sidebarOpen) return;
    this.setEmotion('surprised');
    this.say(this.lines.surprised);
    setTimeout(() => {
      if (this.sidebarOpen) this.setEmotion('normal');
    }, 4000);
  },

  // ─── Reacciones a interacciones del usuario ───────────────
  react(list, emotion, duration) {
    if (!this.enabled || !this.sidebarOpen) return;
    this.lastInteraction = Date.now();
    clearTimeout(this.sleepTimer);
    if (emotion) this.setEmotion(emotion);
    this.say(list, duration);
    clearTimeout(this._emRevert);
    this._emRevert = setTimeout(() => {
      if (!this.sidebarOpen) return;
      this.setEmotion(state.isPlaying ? 'dancing' : 'normal');
    }, 3500);
    this.scheduleSleep();
  },

  onFavToggle(added) {
    this.react(added ? this.lines.favAdd : this.lines.favRemove, added ? 'happy' : 'normal');
  },

  onShuffleToggle(on) {
    this.react(on ? this.lines.shuffleOn : this.lines.shuffleOff, on ? 'surprised' : 'normal');
  },

  onRepeatToggle(on) {
    this.react(on ? this.lines.repeatOn : this.lines.repeatOff, 'happy');
  },

  onVolumeChange(level) {
    if (!this.enabled || !this.sidebarOpen) return;
    // Evitar espamear mensajes mientras se arrastra el slider
    clearTimeout(this._volTimer);
    this._volTimer = setTimeout(() => {
      if (level <= 0) this.react(this.lines.volumeMute, 'surprised');
      else if (level >= 0.85) this.react(this.lines.volumeUp, 'excited');
      else if (level <= 0.15) this.react(this.lines.volumeDown, 'normal');
    }, 350);
  },

  onSearch(query) {
    if (!query || !query.trim()) return;
    this.react(this.lines.search, 'normal', 2200);
  },

  onUpload() {
    this.react(this.lines.upload, 'excited');
  },

  onFavView() {
    this.react(this.lines.favView, 'happy2');
  },

  onNext() {
    this.react(this.lines.next, 'happy', 2000);
  },

  onPrev() {
    this.react(this.lines.prev, 'happy2', 2000);
  },

  // ─── Mecánica de "acariciar"/clic en Antonio ──────────────
  onPet() {
    if (!this.enabled || !this.sidebarOpen) return;
    this.lastInteraction = Date.now();
    clearTimeout(this.sleepTimer);

    // Sonido aleatorio al hacer clic (sin afectar la música)
    antonioSfx.src = 'recursos/sonidos/click_00' + (1 + Math.floor(Math.random() * 5)) + '.ogg';
    antonioSfx.play().catch(() => {});

    // Pequeña animación de "bounce" al hacer clic
    this.img.classList.remove('antonio-pet-bounce');
    // forzar reflow para reiniciar la animación
    void this.img.offsetWidth;
    this.img.classList.add('antonio-pet-bounce');

    this.spawnHeart();

    this.petCount++;
    if (this.petCount >= 5 && !this.petCooldown) {
      this.petCooldown = true;
      this.setEmotion('happy2');
      this.say(this.lines.petTired, 3000);
      setTimeout(() => {
        this.petCooldown = false;
        this.petCount = 0;
        if (this.sidebarOpen) this.setEmotion(state.isPlaying ? 'dancing' : 'normal');
      }, 8000);
      return;
    }

    if (!this.petCooldown) {
      const emo = (state.isPlaying && Math.random() < 0.4) ? 'dancing' : 'happy';
      this.setEmotion(emo);
      this.say(this.lines.pet, 2200);
      clearTimeout(this._emRevert);
      this._emRevert = setTimeout(() => {
        if (!this.sidebarOpen) return;
        this.setEmotion(state.isPlaying ? 'dancing' : 'normal');
      }, 2400);
    }

    this.scheduleSleep();
  },

  spawnHeart() {
    const heart = document.createElement('span');
    heart.className = 'antonio-heart';
    heart.textContent = ['♥','♪','✨','♡','★'][Math.floor(Math.random() * 5)];
    heart.style.left = (40 + Math.random() * 20) + '%';
    this.wrap.appendChild(heart);
    setTimeout(() => heart.remove(), 1200);
  },

  disable() {
    this.enabled = false;
    clearTimeout(this.dbTimer);
    clearTimeout(this.sleepTimer);
    clearTimeout(this._swapTimer);
    this._msgToken++;
    this.bubble.classList.remove('show');
    this.wrap.style.display = 'none';
    document.querySelector('.sidebar').classList.add('no-antonio');
  },

  enable() {
    this.enabled = true;
    this.wrap.style.display = '';
    document.querySelector('.sidebar').classList.remove('no-antonio');
    if (this.sidebarOpen) {
      this.onOpen();
    }
  }
};

// Antonio reacciona si le hacés clic/tap (acariciar)
DOM.antonioImg.addEventListener('click', () => ANTONIO.onPet());
DOM.antonioImg.style.cursor = 'pointer';
DOM.antonioImg.title = 'Antonio · tócalo para saludarlo';

let pendingFiles = [];

const renderUploadList = () => {
  DOM.uploadList.innerHTML = '';
  DOM.uploadAlbumAssign.style.display = pendingFiles.length ? 'block' : 'none';

  pendingFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'upload-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'u-name';
    nameSpan.textContent = f.name;
    nameSpan.title = f.name;
    item.appendChild(nameSpan);

    const statusSpan = document.createElement('span');
    statusSpan.className = 'u-status';
    statusSpan.textContent = 'Listo';
    item.appendChild(statusSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'u-remove';
    removeBtn.setAttribute('aria-label', 'Eliminar');
    removeBtn.innerHTML = '<svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>';
    removeBtn.addEventListener('click', () => {
      pendingFiles.splice(i, 1);
      renderUploadList();
    });
    item.appendChild(removeBtn);

    DOM.uploadList.appendChild(item);
  });

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

const confirmUpload = async () => {
  if (!pendingFiles.length) return;
  const albumTarget = DOM.uploadAlbumSelect.value;

  for (const file of pendingFiles) {
    const blobUrl = URL.createObjectURL(file);
    createdBlobUrls.add(blobUrl);
    const baseName = file.name.replace(/\.mp3$/i, '');
    let fileId = null;
    try { fileId = await saveBlob(file); } catch (_) {}
    const newTrack = {
      fileId,
      src:    blobUrl,
      title:  baseName,
      artist: 'Archivo local',
      cover:  '',
      bg:     'var(--s3)',
    };

    if (albumTarget && state.albums[albumTarget]) {
      newTrack._extra = true;
      newTrack._albumKey = albumTarget;
      state.albums[albumTarget].push(newTrack);
      if (!state.albumExtras[albumTarget]) state.albumExtras[albumTarget] = [];
      state.albumExtras[albumTarget].push(newTrack);
    } else {
      state.uploadedSongs.push(newTrack);
    }
  }

  setLS(LS_KEYS.uploaded, state.uploadedSongs.filter(t => t.fileId || !t.src.startsWith('blob:')));
  saveAlbumExtras();

  pendingFiles = [];
  renderUploadList();
  refreshAlbumSelector();
  updateTrackList();
  DOM.modalUpload.classList.remove('open'); unlockBody();
  showToast('Archivos agregados correctamente', 'success');
  ANTONIO.onUpload();
};

DOM.uploadZone.addEventListener('click', () => DOM.uploadFileInput.click());
DOM.uploadFileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  pendingFiles = [...pendingFiles, ...files];
  renderUploadList();
  e.target.value = ''; 
});

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

let ytFetchTimer = null;
let ytFetchSeq = 0;
const fetchYtMetadata = async (url) => {
  if (!url || !/youtube\.com|youtu\.be/.test(url)) return;
  const seq = ++ytFetchSeq;
  DOM.ytSpinner.classList.add('active');
  const vid = url.match(/(?:v=|youtu\.be\/)([\w-]+)/)?.[1];
  if (!vid) { DOM.ytSpinner.classList.remove('active'); return; }

  DOM.ytThumbnail.src = `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const res = await fetch(RAPID_API_URL.replace('{VIDEO_ID}', vid), { ...RAPID_FETCH_OPTS, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('Error del servidor');
    const data = await res.json();
    if (data.status !== 'ok' || !data.title) throw new Error(data.msg || 'Sin datos');

    // Si el usuario ya cambió la URL, descartamos esta respuesta para no mostrar datos viejos
    if (seq !== ytFetchSeq) return;

    DOM.ytTitle.textContent = data.title;
    DOM.ytChannel.textContent = data.channel ? `Canal: ${data.channel}` : '';
    DOM.ytResultContainer.style.display = 'flex';
    rapidInfo = { title: data.title, downloadLink: data.link || '', vid };
  } catch (err) {
    console.error('[YT] falló:', err);
  } finally {
    if (seq === ytFetchSeq) DOM.ytSpinner.classList.remove('active');
  }
};

DOM.ytUrlInput.addEventListener('input', () => {
  clearTimeout(ytFetchTimer);
  DOM.ytResultContainer.style.display = 'none';
  const url = DOM.ytUrlInput.value.trim();
  if (url && /youtube\.com|youtu\.be/.test(url)) {
    DOM.ytOptions.style.display = 'block';
    ytFetchTimer = setTimeout(() => fetchYtMetadata(url), 500);
  } else {
    DOM.ytOptions.style.display = 'none';
  }
});

document.querySelectorAll('.seg-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const parent = btn.closest('.segmented-control');
    parent.querySelectorAll('.seg-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

DOM.btnYtUpload.addEventListener('click', async () => {
  const url = DOM.ytUrlInput.value.trim();
  if (!url) { showToast('Ingresá una URL de YouTube', 'error'); return; }

  const vid = url.match(/(?:v=|youtu\.be\/)([\w-]+)/)?.[1];
  if (!vid) { showToast('ID de video no encontrado', 'error'); return; }

  DOM.btnYtUpload.disabled = true;
  DOM.btnYtUpload.innerHTML = '<span class="dl-progress-wrap"><span class="dl-progress-bar" style="width:0%"></span><span class="dl-progress-text">Descargando...</span></span>';

  try {
    let fileUrl = (rapidInfo?.vid === vid) ? rapidInfo?.downloadLink : null;
    if (!fileUrl) {
      const infoRes = await fetch(RAPID_API_URL.replace('{VIDEO_ID}', vid), RAPID_FETCH_OPTS);
      if (!infoRes.ok) throw new Error('Error al obtener enlace');
      const info = await infoRes.json();
      if (info.status !== 'ok' || !info.link) throw new Error(info.msg || 'Enlace no disponible');
      fileUrl = info.link;
      if (info.title) {
        DOM.ytTitle.textContent = info.title;
        DOM.ytChannel.textContent = info.channel ? `Canal: ${info.channel}` : '';
        DOM.ytResultContainer.style.display = 'flex';
        rapidInfo = { title: info.title, downloadLink: info.link, vid };
      }
    }

    const title = DOM.ytTitle.textContent || `Video_${vid}`;
    const channel = (DOM.ytChannel.textContent || '').replace('Canal: ', '') || 'YouTube';
    const cover = DOM.ytThumbnail.src || '';

    let blobUrl = null;
    let fileId = null;
    try {
      const res = await fetch(fileUrl);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size >= 102400) {
          blobUrl = URL.createObjectURL(blob);
          createdBlobUrls.add(blobUrl);
          fileId = await saveBlob(blob);
        }
      }
    } catch (_) {}

    const a = document.createElement('a');
    a.href = blobUrl || fileUrl;
    a.download = `${title}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    const entry = {
      fileId,
      src: blobUrl || fileUrl,
      title,
      artist: channel,
      cover,
      bg: 'var(--s3)',
    };
    state.uploadedSongs.push(entry);
        setLS(LS_KEYS.uploaded, state.uploadedSongs.filter(t => t.src && (t.fileId || !t.src.startsWith('blob:'))));
    refreshAlbumSelector();
    updateTrackList();
    setTimeout(() => {
      const lastRow = DOM.tracklist.querySelector('.track-row:last-child');
      if (lastRow) lastRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 100);
    showToast(`Descargado y agregado a la biblioteca${blobUrl ? '' : ' (sin CORS)'}`, 'success');
    ANTONIO.onUpload();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    DOM.btnYtUpload.disabled = false;
    DOM.btnYtUpload.innerHTML = `<svg width="15" height="15" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/></svg> Descargar MP3`;
  }
});

DOM.btnYtCopyTitle.addEventListener('click', () => {
  const title = DOM.ytTitle.textContent;
  if (!title) return;
  navigator.clipboard.writeText(title).then(() => {
    showToast('Título copiado al portapapeles', 'success');
  }).catch(() => showToast('No se pudo copiar', 'error'));
});

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
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=8&media=music`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res  = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();

    DOM.apiResultsGrid.innerHTML = '';

    if (!data.results || data.results.length === 0) {
      DOM.apiResultsGrid.innerHTML = '<span style="font-size:11px;color:var(--muted)">Sin resultados para esa búsqueda.</span>';
      return;
    }

    data.results.forEach(result => {
      // 300px es suficiente para la portada y pesa mucho menos que 600px en redes móviles
      const imgUrl = result.artworkUrl100
        ? result.artworkUrl100.replace('100x100bb', '300x300bb')
        : '';
      if (!imgUrl) return;

      const img = document.createElement('img');
      img.src = imgUrl;
      img.className = 'api-result-item';
      img.title = `${result.collectionName} — ${result.artistName}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('click', () => {
        DOM.apiResultsGrid.querySelectorAll('.api-result-item').forEach(i => i.classList.remove('selected'));
        img.classList.add('selected');

        // Para guardar usamos la versión en alta resolución
        editingCoverDataUrl = imgUrl.replace('300x300bb', '600x600bb');
        const editImg = document.getElementById('editCoverImg');
        editImg.src = editingCoverDataUrl;
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
    DOM.apiSearchInput.value = meta.artist || firstTrack.artist || editingAlbumKey;
  }

  DOM.modalEditAlbum.classList.add('open'); lockBody();
});

document.getElementById('btnEditCancel').addEventListener('click', () => {
  DOM.modalEditAlbum.classList.remove('open'); unlockBody();
});

DOM.modalEditAlbum.addEventListener('click', (e) => {
  if (e.target === DOM.modalEditAlbum) { DOM.modalEditAlbum.classList.remove('open'); unlockBody(); }
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

  DOM.modalEditAlbum.classList.remove('open'); unlockBody();
  refreshAlbumSelector();
  updateTrackList();

  if (state.activeTrackAlbum === editingAlbumKey) loadTrack(state.currentTrackIdx);

  showToast('Álbum actualizado correctamente', 'success');
});

document.getElementById('btnDeleteAlbum').addEventListener('click', () => {
  if (!confirm(`¿Eliminar el registro de "${editingAlbumKey}" de la biblioteca?\nEsto no borra los archivos de audio.`)) return;
  delete state.albumMeta[editingAlbumKey];
  setLS(LS_KEYS.albumMeta, state.albumMeta);
  DOM.modalEditAlbum.classList.remove('open'); unlockBody();
  refreshAlbumSelector();
  loadTrack(0);
  showToast('Registro eliminado de la biblioteca');
});

document.addEventListener('keydown', (e) => {
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

const BT21_ICONS = [
  'recursos/Effect/icons8-bt21-chimmy-50.svg',
  'recursos/Effect/icons8-bt21-cooky-50.svg',
  'recursos/Effect/icons8-bt21-koya-50.svg',
  'recursos/Effect/icons8-bt21-mang-50.svg',
  'recursos/Effect/icons8-bt21-rj-50.svg',
  'recursos/Effect/icons8-bt21-shooky-50.svg',
  'recursos/Effect/icons8-bt21-tata-50.svg',
  'recursos/Effect/icons8-bt21-van-50.svg',
];

// En dispositivos de gama baja, menos tiles = menos animaciones simultáneas (GPU)
const BT21_TILE_COUNT = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ? 24 : 40;

const showBt21Mosaic = (duration = 3500) => {
  if (!state.effects.bt21) return;
  const container = DOM.bt21Overlay;
  container.innerHTML = '';

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < BT21_TILE_COUNT; i++) {
    const tile = document.createElement('div');
    tile.className = 'bt21-tile';
    const img = document.createElement('img');
    img.src = BT21_ICONS[Math.floor(Math.random() * BT21_ICONS.length)];
    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'async';
    tile.appendChild(img);
    tile.style.left = (Math.random() * 95) + '%';
    tile.style.top = (Math.random() * 95) + '%';
    tile.style.animationDelay = (Math.random() * 2) + 's, ' + (Math.random() * 4) + 's';
    fragment.appendChild(tile);
  }
  container.appendChild(fragment);

  setTimeout(() => {
    const tiles = container.querySelectorAll('.bt21-tile');
    tiles.forEach(tile => {
      tile.style.animationDelay = (Math.random() * 800) + 'ms';
      tile.classList.add('fading');
    });
    setTimeout(() => { container.innerHTML = ''; }, 1800);
  }, duration);
};
initPlayer().catch(e => console.error('init error:', e));