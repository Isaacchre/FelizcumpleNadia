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
    tx.onerror = () => rej(tx.error || new Error('Transaction failed'));
    tx.onabort = () => rej(new Error('Transaction aborted'));
  });
};

const loadBlob = async (id) => {
  const db = await getFileDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const r = tx.objectStore(DB_STORE).get(id);
    r.onsuccess = () => res(r.result ? r.result.blob : null);
    r.onerror = () => rej(r.error);
    tx.onerror = () => rej(tx.error || new Error('Transaction failed'));
    tx.onabort = () => rej(new Error('Transaction aborted'));
  });
};

const deleteBlob = async (id) => {
  const db = await getFileDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const r = tx.objectStore(DB_STORE).delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
    tx.onerror = () => rej(tx.error || new Error('Transaction failed'));
    tx.onabort = () => rej(new Error('Transaction aborted'));
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
  btnConfig:   'nadia_btn_config',
  customAlbums:'nadia_custom_albums',
  shuffle:     'nadia_shuffle',
  repeat:      'nadia_repeat',
};

const YT_API_KEY   = 'dc0265c45bmsh066240b5cdd1110p1779afjsncd6830a92a10';
const YT_API_HOST  = 'yt-api.p.rapidapi.com';

const getLS = (key, fallback = null) => {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
};
const setLS = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch(e) { console.warn('LS lleno:', e); return false; }
};

const compressImage = (dataUrl, maxDim = 400, quality = 0.8) => new Promise(res => {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(img, 0, 0, width, height);
    res(c.toDataURL('image/jpeg', quality));
  };
  img.onerror = () => res(dataUrl);
  img.src = dataUrl;
});

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
  btnConfig: { seekBtns: false, seekBack: 10, seekFwd: 10, favBtn: true, duration: true, trackCover: true, volume: true, editBtn: true, trackNav: false },
  customAlbums: [],
  ytTrack: false,
};

const audio = new Audio();
audio.volume = getLS(LS_KEYS.volume, 0.75);
audio.preload = 'metadata';

// Android: keep audio context alive for background playback
let audioCtx = null;
const ensureAudioCtx = () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended' && state.isPlaying) audioCtx.resume();
};
const suspendAudioCtx = () => {
  if (audioCtx && audioCtx.state === 'running' && !state.isPlaying) audioCtx.suspend();
};
document.addEventListener('click', ensureAudioCtx, { once: true });

// Wake Lock: prevent Android from killing audio when screen off
let wakeLockSentinel = null;
const acquireWakeLock = async () => {
  if (!navigator.wakeLock || state.ytTrack) return;
  try {
    if (wakeLockSentinel) wakeLockSentinel.release();
    wakeLockSentinel = await navigator.wakeLock.request('screen');
  } catch {}
};
const releaseWakeLock = () => {
  if (wakeLockSentinel) { wakeLockSentinel.release(); wakeLockSentinel = null; }
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !wakeLockSentinel && state.isPlaying && !state.ytTrack) acquireWakeLock();
});

const createdBlobUrls = new Set();
window.addEventListener('beforeunload', () => {
  if (ytPollInterval) { clearInterval(ytPollInterval); ytPollInterval = null; }
  createdBlobUrls.forEach(url => URL.revokeObjectURL(url));
  createdBlobUrls.clear();
});

// Android: resume YT playback when coming back from lock screen / another app
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.isPlaying && state.ytTrack && ytPlayer && ytPlayer.getPlayerState) {
    if (ytPlayer.getPlayerState() === ytStatePaused) ytPlay();
  }
});

// ─── Acceso seguro al DOM ──────────────────────────────────
// Si algún elemento no existe en el HTML (por ejemplo, por una
// versión desactualizada de index.html), en vez de devolver `null`
// (lo que rompe TODO el script con "Cannot read properties of null"),
// devolvemos un elemento "fantasma" desconectado que acepta
// addEventListener, classList, style, etc. sin hacer nada.
// Así el reproductor sigue funcionando aunque falte algún elemento.
const $id = (id) => {
  const el = document.getElementById(id);
  if (el) return el;
  console.warn(`[DOM] Elemento #${id} no encontrado — se usa un nodo vacío de respaldo.`);
  return document.createElement('div');
};

const DOM = {
  disc:               $id('disc'),
  discGlow:           $id('discGlow'),
  discCoverBg:        $id('discCoverBg'),
  tonearm:            $id('tonearm'),
  labelBg:            $id('labelBg'),
  labelImg:           $id('labelImg'),
  labelEmoji:         $id('labelEmoji'),
  trackTitle:         $id('trackTitle'),
  trackArtist:        $id('trackArtist'),
  trackAlbum:         $id('trackAlbum'),
  progressFill:       $id('progressFill'),
  progressBar:        $id('progressBar'),
  timeNow:            $id('timeNow'),
  timeTotal:          $id('timeTotal'),
  btnPlay:            $id('btnPlay'),
  iconPlay:           $id('iconPlay'),
  iconPause:          $id('iconPause'),
  btnShuffle:         $id('btnShuffle'),
  btnRepeat:          $id('btnRepeat'),
  volSlider:          $id('volSlider'),
  tracklist:          $id('tracklist'),
  albumSelect:        $id('albumSelect'),
  searchInput:        $id('searchInput'),
  btnEditAlbum:       $id('btnEditAlbum'),
  toast:              $id('toast'),
  sidebar:            $id('sidebar'),
  sidebarOverlay:     $id('sidebarOverlay'),
  btnSidebarClose:    $id('btnSidebarClose'),
  sbOptUpload:        $id('sbOptUpload'),
  sbOptYt:            $id('sbOptYt'),
  sbOptCustomize:     $id('sbOptCustomize'),
  modalEditAlbum:     $id('modalEditAlbum'),
  modalUpload:        $id('modalUpload'),
  modalYt:            $id('modalYt'),
  uploadZone:         $id('uploadZone'),
  uploadFileInput:    $id('uploadFileInput'),
  uploadList:         $id('uploadList'),
  uploadAlbumAssign:  $id('uploadAlbumAssign'),
  uploadAlbumSelect:  $id('uploadAlbumSelect'),
  btnOpenUpload:      $id('btnOpenUpload'),
  albumBrowser:       $id('albumBrowser'),
  btnAlbumBrowserBack:$id('btnAlbumBrowserBack'),
  abGrid:             $id('abGrid'),
  abBody:             $id('abBody'),
  abSearchInput:      $id('abSearchInput'),
  abNowPlaying:       $id('abNowPlaying'),
  abNpCover:          $id('abNpCover'),
  abNpTitle:          $id('abNpTitle'),
  abNpArtist:         $id('abNpArtist'),
  abNpPlay:           $id('abNpPlay'),
  abNpPrev:           $id('abNpPrev'),
  abNpNext:           $id('abNpNext'),
  abIconPlay:         $id('abIconPlay'),
  abIconPause:        $id('abIconPause'),
  currentAlbumLabel:  $id('currentAlbumLabel'),
  btnUploadClose:     $id('btnUploadClose'),
  ytUrlInput:         $id('ytUrlInput'),
  ytSpinner:          $id('ytSpinner'),
  ytResultContainer:  $id('ytResultContainer'),
  ytThumbnail:        $id('ytThumbnail'),
  ytTitle:            $id('ytTitle'),
  ytChannel:          $id('ytChannel'),
  btnYtCopyTitle:     $id('btnYtCopyTitle'),
  ytOptions:          $id('ytOptions'),
  btnYtUpload:        $id('btnYtUpload'),
  btnYtClose:         $id('btnYtClose'),
  apiSearchContainer: $id('apiSearchContainer'),
  apiSearchInput:     $id('apiSearchInput'),
  btnApiSearch:       $id('btnApiSearch'),
  apiResultsGrid:     $id('apiResultsGrid'),
  modalCustomize:     $id('modalCustomize'),
  btnCustomClose:     $id('btnCustomClose'),
  customBgGrid:       $id('customBgGrid'),
  customBgFileInput:  $id('customBgFileInput'),
  customBgAdd:        $id('customBgAdd'),
  customOpacitySlider:$id('customOpacitySlider'),
  customOpacityVal:   $id('customOpacityVal'),
  bt21Overlay:        $id('bt21Overlay'),

  // -- Elementos agregados para Efectos --
  sbOptEffects:       $id('sbOptEffects'),
  sbOptClearCache:    $id('sbOptClearCache'),
  modalEffects:       $id('modalEffects'),
  btnEffectsClose:    $id('btnEffectsClose'),
  toggleBt21:         $id('toggleBt21'),
  toggleDiscSpin:     $id('toggleDiscSpin'),
  toggleMarquee:      $id('toggleMarquee'),
  toggleAntonio:      $id('toggleAntonio'),
  idleTrackName:      $id('idleTrackName'),
  idleTrackArtist:    $id('idleTrackArtist'),
  antonioImg:         $id('antonioImg'),
  antonioDialogue:    $id('antonioDialogue'),
  antonioWrap:        $id('antonioWrap'),

  // -- Elementos: Personalizar botones --
  sbOptButtons:       $id('sbOptButtons'),
  modalButtons:       $id('modalButtons'),
  btnButtonsClose:    $id('btnButtonsClose'),
  toggleSeekBtns:     $id('toggleSeekBtns'),
  toggleTrackNav:     $id('toggleTrackNav'),
  seekCfgSection:     $id('seekCfgSection'),
  seekBackVal:        $id('seekBackVal'),
  seekFwdVal:         $id('seekFwdVal'),
  btnBackMinus:       $id('btnBackMinus'),
  btnBackPlus:        $id('btnBackPlus'),
  btnFwdMinus:        $id('btnFwdMinus'),
  btnFwdPlus:         $id('btnFwdPlus'),
  toggleFavBtn:       $id('toggleFavBtn'),
  toggleDuration:     $id('toggleDuration'),
  toggleTrackCover:   $id('toggleTrackCover'),
  toggleVolume:       $id('toggleVolume'),
  toggleEditBtn:      $id('toggleEditBtn'),
  volumeRow:          $id('volumeRow'),
  controlsNav:        $id('controlsNav'),
  btnOpenAlbumsBar:   $id('btnOpenAlbumsBar'),
  modalAddAlbum:      $id('modalAddAlbum'),
  addAlbumName:       $id('addAlbumName'),
  addCoverInput:      $id('addCoverInput'),
  addCoverImg:        $id('addCoverImg'),
  addCoverPlaceholder:$id('addCoverPlaceholder'),
  addCoverPreview:    $id('addCoverPreview'),
  addPlaylistUrl:     $id('addPlaylistUrl'),
  btnAddAlbumCancel:  $id('btnAddAlbumCancel'),
  btnAddAlbumSave:    $id('btnAddAlbumSave'),
  // — Download progress modal —
  modalDownload:      $id('modalDownload'),
  dlStatus:           $id('dlStatus'),
  dlBarFill:          $id('dlBarFill'),
  dlCounter:          $id('dlCounter'),
  dlCurrent:          $id('dlCurrent'),
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
  if (!s || !isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
};

const getTrackId = (t) => t?.fileId || t?.src || '';

const isLocalSong = (t) => {
  if (!t) return false;
  return t.albumOrigin === '__UPLOADED__' || (t.src && (t.src.startsWith('music/') || !t.src.startsWith('http')));
};
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
    showToast('Agregado a favoritos', 'success');
    ANTONIO.onFavToggle(true);
  }
  setLS(LS_KEYS.favorites, [...state.favorites]);
  updateTrackList();
  refreshAlbumSelector();
};
const getFilteredTracks = () => {
  let pool = [];
  const q = state.searchQuery.trim().toLowerCase();
  const qNorm = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (q) {
    Object.entries(state.albums).forEach(([key, tracks]) =>
      tracks.forEach(t => {
        if (
          t.title.toLowerCase().includes(q) ||
          t.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(qNorm) ||
          t.artist.toLowerCase().includes(q) ||
          t.artist.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(qNorm) ||
          key.toLowerCase().includes(q)
        ) pool.push({ ...t, albumOrigin: key });
      })
    );
    state.uploadedSongs.forEach(t => {
      if (t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) ||
          t.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(qNorm) ||
          t.artist.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(qNorm))
        pool.push({ ...t, albumOrigin: '__UPLOADED__' });
    });
    state.customAlbums.forEach(a => (a.tracks || []).forEach(t => {
      const tt = (t.title || '').toLowerCase();
      const ta = (t.artist || '').toLowerCase();
      const an = (a.name || '').toLowerCase();
      const ttN = tt.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const taN = ta.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const anN = an.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (tt.includes(q) || ta.includes(q) || an.includes(q) ||
          ttN.includes(qNorm) || taN.includes(qNorm) || anN.includes(qNorm))
        pool.push({ ...t, albumOrigin: a.key });
    }));
    return pool;
  }

  switch (state.currentView) {
    case '__ALL__':
      Object.entries(state.albums).forEach(([key, tracks]) =>
        tracks.forEach(t => pool.push({ ...t, albumOrigin: key }))
      );
      state.uploadedSongs.forEach(t => pool.push({ ...t, albumOrigin: '__UPLOADED__' }));
      state.customAlbums.forEach(a => (a.tracks || []).forEach(t => pool.push({ ...t, albumOrigin: a.key })));
      break;
    case '__FAV__':
      Object.entries(state.albums).forEach(([key, tracks]) =>
        tracks.forEach(t => { if (isFav(t)) pool.push({ ...t, albumOrigin: key }); })
      );
      state.uploadedSongs.forEach(t => { if (isFav(t)) pool.push({ ...t, albumOrigin: '__UPLOADED__' }); });
      state.customAlbums.forEach(a => (a.tracks || []).forEach(t => {
        if (isFav(t)) pool.push({ ...t, albumOrigin: a.key });
      }));
      break;
    case '__UPLOADED__':
      pool = state.uploadedSongs.map(t => ({ ...t, albumOrigin: '__UPLOADED__' }));
      break;
    default:
      const customAlbum = state.customAlbums.find(a => a.key === state.currentView);
      if (customAlbum && customAlbum.tracks) {
        pool = customAlbum.tracks.map(t => ({ ...t, albumOrigin: state.currentView }));
      } else {
        pool = (state.albums[state.currentView] || []).map(t => ({ ...t, albumOrigin: state.currentView }));
      }
  }
  return pool;
};

// ─── YouTube IFrame Player ───────────────────────────
let ytPlayer = null;
let ytApiReady = false;
let ytScriptLoaded = false;
let ytPendingVideo = null;
let ytLastLoadedVid = null;
let ytPollInterval = null;
let fromUserGesture = false;
const ytStateEnded = 0;
const ytStatePlaying = 1;
const ytStatePaused = 2;

const ytPlay = () => {
  const vid = state.activeTrackData?.videoId;
  if (!vid) return;
  if (ytPlayer && ytPlayer.playVideo) {
    if (vid !== ytLastLoadedVid) {
      if (!ytPlayer.isMuted()) ytPlayer.mute();
      ytLoadVideo(vid);
    } else {
      ytPlayer.playVideo();
    }
    ytStartKeepAlive();
    return;
  }
  loadYtApi();
  if (!ytLoadVideo(vid)) ytPendingVideo = vid;
};

const ytPause = () => {
  ytStopKeepAlive();
  if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
};

// Keep YT player alive when screen locks on Android
let ytKeepAlive = null;
const ytStartKeepAlive = () => {
  if (!/android/i.test(navigator.userAgent)) return;
  clearInterval(ytKeepAlive);
  ytKeepAlive = setInterval(() => {
    if (!state.isPlaying || !state.ytTrack || !ytPlayer) { clearInterval(ytKeepAlive); ytKeepAlive = null; return; }
    if (document.hidden && ytPlayer.getPlayerState && ytPlayer.getPlayerState() === ytStatePlaying) {
      ytPlayer.getCurrentTime();
    }
  }, 10000);
};
const ytStopKeepAlive = () => { clearInterval(ytKeepAlive); ytKeepAlive = null; };

const ytSeekTo = (time) => {
  if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(time, true);
};

const ytLoadVideo = (videoId) => {
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(videoId);
    ytLastLoadedVid = videoId;
    return true;
  }
  return false;
};

const onYtApiReady = () => {
  if (ytApiReady) return;
  ytApiReady = true;
  const isAndroid = /android/i.test(navigator.userAgent);
  ytPlayer = new YT.Player('ytPlayer', {
    height: 200, width: 200,
    playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, playsinline: 1 },
    events: {
      onReady: () => {
        ytPlayer.mute();
        if (ytPendingVideo) {
          ytLoadVideo(ytPendingVideo);
          ytPendingVideo = false;
        }
      },
      onError: () => {},
      onStateChange: (e) => {
        if (e.data === ytStateEnded) {
          if (state.repeat) { ytSeekTo(0); ytPlay(); }
          else nextTrack();
        } else if (e.data === ytStatePlaying) {
          ytPlayer.unMute();
          if (isAndroid && state.isPlaying && !fromUserGesture) {
            ytPlayer.mute();
            setTimeout(() => { if (state.isPlaying && !ytPlayer.isMuted()) ytPlayer.unMute(); }, 500);
          }
          fromUserGesture = false;
          if (!state.isPlaying) togglePlayback(true);
        } else if (e.data === ytStatePaused && state.isPlaying) {
          togglePlayback(false);
        }
      },
    },
  });
  if (!ytPollInterval) {
    ytPollInterval = setInterval(() => {
      if (!state.ytTrack || !ytPlayer || !ytPlayer.getCurrentTime) return;
      if (!state.isPlaying) return;
      const ct = ytPlayer.getCurrentTime();
      const dur = ytPlayer.getDuration();
      if (dur) {
        DOM.timeNow.textContent = formatTime(ct);
        DOM.timeTotal.textContent = formatTime(dur);
        const ratio = ct / dur;
        DOM.progressFill.style.width = `${ratio * 100}%`;
        DOM.progressBar.style.setProperty('--thumb-x', `${ratio * 100}%`);
        updateMediaPositionState();
      }
    }, 250);
  }
};

const loadYtApi = () => {
  if (ytScriptLoaded) return;
  ytScriptLoaded = true;
  if (window.YT && YT.loaded) { onYtApiReady(); return; }
  window.onYouTubeIframeAPIReady = onYtApiReady;
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
};

const isYtTrack = (t) => t && t.videoId;

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

  // Stop previous YouTube playback
  state.ytTrack = false;
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  if (ytPollInterval) { clearInterval(ytPollInterval); ytPollInterval = null; }

  if (isYtTrack(state.activeTrackData)) {
    state.ytTrack = true;
    loadYtApi();
    const vid = state.activeTrackData.videoId;
    if (!ytLoadVideo(vid)) ytPendingVideo = vid;
  } else {
    if (!navigator.onLine && !isLocalSong(state.activeTrackData)) {
      showToast('Sin conexión 🎵 esta pista no está disponible localmente', 'error');
      state.isPlaying = false;
      updateTrackList();
      updateMediaPositionState();
      return;
    }
    if (state.activeTrackData.src) {
      audio.src = state.activeTrackData.src;
    } else {
      showToast('Pista sin fuente de audio', 'error');
      return;
    }
  }

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
  updateCurrentAlbumLabel();
  updateAbNowPlaying();

  if (state.isPlaying) {
    if (state.ytTrack) ytPlay();
    else audio.play().catch(err => {
      if (err && err.name === 'AbortError') return;
      showToast('Error al reproducir', 'error');
    });
  }
};

const togglePlayback = (forceState, fromEvent) => {
  const wasPlaying = state.isPlaying;
  const newState = typeof forceState === 'boolean' ? forceState : !state.isPlaying;
  if (newState === wasPlaying && fromEvent) return;

  state.isPlaying = newState;

  // Validate BEFORE touching UI to avoid flicker
  if (state.isPlaying && wasPlaying !== true) {
    if (!state.activeTrackData.src && !state.ytTrack && !state.activeTrackData.videoId) {
      state.isPlaying = false;
      showToast('No hay pista seleccionada', 'error');
      return;
    }
  }

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

  // Sync album browser mini player (solo si está abierto)
  if (DOM.albumBrowser.classList.contains('open')) updateAbNowPlaying();

  // Idle timer: solo cuando hay reproducción activa
  if (state.isPlaying) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(enterIdle, IDLE_MS);
  } else {
    leaveIdle();
    clearTimeout(idleTimer);
  }

  if (state.isPlaying && !fromEvent) {
    fromUserGesture = true;
    ensureAudioCtx();
    if (state.ytTrack) { ytPlay(); } else { acquireWakeLock();
      if (state.activeTrackData.src) {
        if (!audio.src || audio.src === window.location.href) audio.src = state.activeTrackData.src;
        audio.play().catch(err => {
          if (err && err.name === 'AbortError') return;
          showToast('Error al reproducir', 'error');
        });
      } else {
        state.isPlaying = false;
        DOM.iconPlay.style.display = 'block';
        DOM.iconPause.style.display = 'none';
        showToast('No hay fuente de audio disponible', 'error');
      }
    }
  } else if (!state.isPlaying && !fromEvent) {
    suspendAudioCtx();
    releaseWakeLock();
    if (state.ytTrack) ytPause(); else audio.pause();
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
  const filtered = getFilteredTracks();
  if (!filtered.length) return;
  const ct = state.ytTrack && ytPlayer && ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : (state.ytTrack ? 0 : audio.currentTime);
  if (ct > 3) {
    if (state.ytTrack && ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(0);
    else audio.currentTime = 0;
    return;
  }
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

  if (state.customAlbums.length) {
    const sep2 = new Option('──────────────', '');
    sep2.disabled = true;
    DOM.albumSelect.add(sep2);
    state.customAlbums.forEach(album => {
      DOM.albumSelect.add(new Option(album.name, album.key));
    });
  }

  const exists = Array.from(DOM.albumSelect.options).some(o => o.value === prev);
  DOM.albumSelect.value = exists ? prev : '__ALL__';
  state.currentView = DOM.albumSelect.value;

  populateUploadAlbumSelect();
  updateCurrentAlbumLabel();
};

// ═══════════════════════════════════════════════════
// ALBUM BROWSER
// ═══════════════════════════════════════════════════

const openAlbumBrowser = () => {
  renderAlbumBrowser();
  DOM.albumBrowser.classList.add('open');
  lockBody();
  updateAbNowPlaying();
};

const closeAlbumBrowser = () => {
  DOM.albumBrowser.classList.remove('open');
  unlockBody();
  if (DOM.abSearchInput) { DOM.abSearchInput.value = ''; renderAlbumBrowser(''); }
};

let addAlbumCoverDataUrl = '';

const openAddAlbumModal = () => {
  addAlbumCoverDataUrl = '';
  DOM.addAlbumName.value = '';
  DOM.addPlaylistUrl.value = '';
  DOM.addCoverImg.style.display = 'none';
  DOM.addCoverPlaceholder.style.display = 'flex';
  DOM.modalAddAlbum.classList.add('open');
  lockBody();
};

const closeAddAlbumModal = () => {
  DOM.modalAddAlbum.classList.remove('open');
  unlockBody();
  DOM.addAlbumName.value = '';
  DOM.addPlaylistUrl.value = '';
  DOM.addCoverInput.value = '';
  addAlbumCoverDataUrl = '';
  DOM.addCoverImg.style.display = 'none';
  DOM.addCoverPlaceholder.style.display = 'flex';
};

const extractPlaylistId = (url) => {
  const m = url.match(/[&?]list=([^&]+)/);
  return m ? m[1] : null;
};

const dlOpen = () => { DOM.modalDownload.classList.add('open'); lockBody(); };
const dlClose = () => { DOM.modalDownload.classList.remove('open'); unlockBody(); };
const dlUpdate = (status, current, count, total) => {
  DOM.dlStatus.textContent = status;
  DOM.dlCurrent.textContent = current || '—';
  DOM.dlCounter.textContent = `${count} / ${total}`;
  DOM.dlBarFill.style.width = total > 0 ? `${Math.min(100, (count / total) * 100)}%` : '0%';
};

const fetchPage = async (id, continuation) => {
  const params = new URLSearchParams({ id });
  if (continuation) params.set('continuation', continuation);
  const res = await fetch(`https://${YT_API_HOST}/playlist?${params}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': YT_API_HOST,
      'x-rapidapi-key': YT_API_KEY,
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
};

const fetchPlaylist = async (playlistId, onProgress) => {
  let allData = [];
  let continuation = null;
  let totalEstimate = 0;
  let page = 0;

  do {
    const json = await fetchPage(playlistId, continuation);
    const items = json.data || [];
    continuation = json.continuation || null;

    // First page: get total estimate
    if (page === 0) {
      totalEstimate = json.videoCount || items.length || 0;
    }

    for (const item of items) {
      if (!item.videoId) continue;
      allData.push({
        videoId: item.videoId,
        title: item.title || 'Sin título',
        artist: json.owner?.title || item.channelTitle || 'YouTube',
        duration: parseInt(item.lengthSeconds, 10) || 0,
        thumbnail: item.thumbnail?.at(-1)?.url || item.thumbnail?.[0]?.url || '',
      });
      if (onProgress) onProgress(allData.length, Math.max(totalEstimate, allData.length));
    }
    page++;
  } while (continuation);

  return { items: allData, playlistTitle: '' };
};

const saveCustomAlbum = async () => {
  const name = DOM.addAlbumName.value.trim();
  const url = DOM.addPlaylistUrl.value.trim();
  if (!name) { showToast('Ingresá un nombre para el álbum', 'error'); return; }
  if (!url) { showToast('Ingresá una URL de playlist de YouTube', 'error'); return; }
  if (!/youtube\.com|youtu\.be/.test(url)) { showToast('La URL no es de YouTube', 'error'); return; }
  if (state.customAlbums.some(a => a.name.toLowerCase() === name.toLowerCase())) {
    showToast('Ya existe un álbum con ese nombre', 'error');
    return;
  }

  const playlistId = extractPlaylistId(url);
  if (!playlistId) { showToast('No se pudo extraer el ID de la playlist', 'error'); return; }

  closeAddAlbumModal();
  dlOpen();
  dlUpdate('Obteniendo lista de videos...', '', 0, 0);

  try {
    const result = await fetchPlaylist(playlistId, (count, total) => {
      dlUpdate(`Obteniendo lista...`, '', count, total);
    });

    if (!result.items.length) {
      dlClose();
      showToast('La playlist está vacía o no se encontraron videos', 'error');
      return;
    }

    const albumKey = '__CUSTOM__' + Date.now();
    const tracks = result.items.map(t => ({
      title: t.title,
      artist: t.artist,
      videoId: t.videoId,
      duration: t.duration,
      cover: t.thumbnail || addAlbumCoverDataUrl || '',
      src: `https://www.youtube.com/watch?v=${t.videoId}`,
      fileId: null,
      bg: 'var(--s3)',
    }));

    state.customAlbums.push({
      key: albumKey,
      name,
      playlistUrl: url,
      cover: addAlbumCoverDataUrl || '',
      tracks,
    });
    state.albumMeta[albumKey] = { name, cover: addAlbumCoverDataUrl || '' };

    dlClose();
    if (setLS(LS_KEYS.customAlbums, state.customAlbums) && setLS(LS_KEYS.albumMeta, state.albumMeta)) {
      showToast(`Álbum "${name}" guardado (${tracks.length} canciones) — Solo streaming, sin conexión`, 'success');
    } else {
      showToast('Error al guardar: espacio en localStorage agotado', 'error');
    }
    refreshAlbumSelector();
    if (DOM.albumBrowser.classList.contains('open')) renderAlbumBrowser('');
  } catch (e) {
    dlClose();
    showToast(`Error: ${e.message}`, 'error');
  }
};

const deleteCustomAlbum = (key) => {
  state.customAlbums = state.customAlbums.filter(a => a.key !== key);
  delete state.albumMeta[key];
  setLS(LS_KEYS.customAlbums, state.customAlbums);
  setLS(LS_KEYS.albumMeta, state.albumMeta);
};

const selectViewFromBrowser = (view) => {
  if (view === '__ADD_ALBUM__') {
    closeAlbumBrowser();
    openAddAlbumModal();
    return;
  }
  const prevTrackSrc = state.activeTrackData?.src || '';

  state.currentView = view;
  DOM.albumSelect.value = view;
  setLS(LS_KEYS.currentView, state.currentView);
  state.searchQuery = '';
  DOM.searchInput.value = '';

  if (isSpecialView(view) && state.shuffle) {
    state.shuffle = false;
    DOM.btnShuffle.classList.remove('active');
  }
  DOM.btnEditAlbum.style.display = (!isSpecialView(view) && state.btnConfig.editBtn) ? 'flex' : 'none';
  updateCurrentAlbumLabel();
  if (view === '__FAV__') ANTONIO.onFavView();

  // Buscar si la canción activa aparece en la nueva vista para marcarla como "current"
  const newFiltered = getFilteredTracks();
  const activeInNewView = prevTrackSrc
    ? newFiltered.findIndex(t => t.src === prevTrackSrc)
    : -1;

  // Siempre actualizar el índice sin tocar el audio:
  // · Si la canción está en la lista → marcarla como seleccionada
  // · Si no está → apuntar al índice 0 para que la próxima vez que el
  //   usuario presione "siguiente" arranque desde el principio de esta vista,
  //   pero SIN cambiar lo que está sonando ahora mismo.
  state.currentTrackIdx = activeInNewView !== -1 ? activeInNewView : 0;

  // Solo actualizar la lista visual, nunca interrumpir el audio
  updateTrackList();
  updateCurrentAlbumLabel();

  closeAlbumBrowser();
};

const isSpecialView = (v) => ['__ALL__','__FAV__','__UPLOADED__'].includes(v);

const updateCurrentAlbumLabel = () => {
  const v = state.currentView;
  let label = 'Coleccion completa';
  if (v === '__FAV__') label = 'Favoritos';
  else if (v === '__UPLOADED__') label = 'Archivos locales';
  else if (v && v.startsWith('__CUSTOM__')) {
    const found = state.customAlbums.find(a => a.key === v);
    label = found ? found.name : 'Álbum personalizado';
  }
  else if (v && state.albumMeta[v] && state.albumMeta[v].name) label = state.albumMeta[v].name;
  else if (v && v !== '__ALL__') label = v;
  if (DOM.currentAlbumLabel) DOM.currentAlbumLabel.textContent = label;
};

const renderAlbumBrowser = (filterQuery) => {
  const qRaw = (filterQuery || (DOM.abSearchInput ? DOM.abSearchInput.value : '') || '').trim();
  const q = qRaw.toLowerCase();
  const qNorm = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nfc = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const totalSongs = Object.values(state.albums).reduce((a,c)=>a+c.length,0) + state.uploadedSongs.length;

  if (!DOM.abGrid) return;
  DOM.abGrid.innerHTML = '';

  const fragment = document.createDocumentFragment();

  // Helper to build a grid card
  const addCard = (coverContent, name, subtitle, view) => {
    const card = document.createElement('button');
    card.className = 'ab-album-card';
    card.dataset.view = view;

    const wrap = document.createElement('div');
    wrap.className = 'ab-cover-wrap';
    wrap.appendChild(coverContent);
    card.appendChild(wrap);

    const nameEl = document.createElement('div');
    nameEl.className = 'ab-album-name';
    nameEl.textContent = name;
    card.appendChild(nameEl);

    if (subtitle) {
      const subEl = document.createElement('div');
      subEl.className = 'ab-album-artist';
      subEl.textContent = subtitle;
      card.appendChild(subEl);
    }

    return card;
  };

  // Only show special cards when not filtering
  if (!q) {
    // Special: Archivos locales
    if (state.uploadedSongs.length) {
      const cover = document.createElement('div');
      cover.className = 'ab-cover-placeholder ab-cover-local';
      cover.innerHTML = '<svg width="30" height="30" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/></svg>';
      fragment.appendChild(addCard(cover, 'Archivos locales', `${state.uploadedSongs.length} canciones`, '__UPLOADED__'));
    }

    // Special: Favoritos
    if (state.favorites.size) {
      const cover = document.createElement('div');
      cover.className = 'ab-cover-placeholder ab-cover-fav';
      cover.innerHTML = '<svg width="30" height="30" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/></svg>';
      fragment.appendChild(addCard(cover, 'Favoritos', `${state.favorites.size} canciones`, '__FAV__'));
    }

    // Special: Toda la colección
    {
      const cover = document.createElement('div');
      cover.className = 'ab-cover-placeholder ab-cover-all';
      cover.innerHTML = '<svg width="30" height="30" fill="currentColor" viewBox="0 0 16 16"><path d="M9 13c0 1.105-1.12 2-2.5 2S4 14.105 4 13s1.12-2 2.5-2 2.5.895 2.5 2z"/><path fill-rule="evenodd" d="M9 3v10H8V3h1z"/><path d="M8 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 13 2.22V4L8 5V2.82z"/></svg>';
      fragment.appendChild(addCard(cover, 'Toda la colección', `${totalSongs} canciones`, '__ALL__'));
    }
  }

  // Add album button (only when not filtering)
  if (!q) {
    const cover = document.createElement('div');
    cover.className = 'ab-cover-placeholder';
    cover.style.cssText = 'background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.12);border-radius:8px;color:rgba(255,255,255,.3);';
    cover.innerHTML = '<svg width="28" height="28" fill="currentColor" viewBox="0 0 16 16"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>';
    fragment.appendChild(addCard(cover, 'Agregar álbum', 'Playlist de YouTube', '__ADD_ALBUM__'));
  }

  // Custom albums (from YouTube playlists)
  state.customAlbums.forEach(album => {
    if (q && !album.name.toLowerCase().includes(q) && !nfc(album.name).includes(qNorm)) return;
    const cover = document.createElement('div');
    if (album.cover) {
      cover.innerHTML = `<img src="${album.cover}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      cover.className = 'ab-cover-placeholder';
      cover.style.cssText = 'background:linear-gradient(145deg,#1a1a2e,#16213e 60%,#0f3460);color:rgba(255,255,255,.4);';
      cover.innerHTML = '<svg width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M8.051 1.999h.089c.822.003 4.987.033 6.11.335a2.01 2.01 0 0 1 1.415 1.42c.101.38.172.883.22 1.402l.01.104.022.26.008.104c.065.914.073 1.77.074 1.957v.075c-.001.194-.01 1.108-.082 2.06l-.008.105-.009.104c-.05.572-.124 1.14-.235 1.558a2.007 2.007 0 0 1-1.415 1.42c-1.16.312-5.569.334-6.18.335h-.142c-.309 0-1.587-.006-2.927-.052l-.17-.006-.087-.004-.171-.007-.171-.007c-1.11-.049-2.167-.128-2.654-.26a2.007 2.007 0 0 1-1.415-1.419c-.111-.417-.185-.986-.235-1.558l.008-.104.002-.052.008-.104.022-.26.01-.104c.048-.519.119-1.023.22-1.402a2.007 2.007 0 0 1 1.415-1.42c.487-.13 1.544-.21 2.654-.26l.17-.007.172-.006.086-.003.171-.007A99.788 99.788 0 0 1 7.858 2h.193zM6.4 5.209v4.818l4.157-2.408L6.4 5.209z"/></svg>';
    }
    fragment.appendChild(addCard(cover, album.name, 'Playlist de YouTube', album.key));
  });

  // Albums (filtered if q)
  const albumKeys = Object.keys(state.albums);
  for (let ai = 0; ai < albumKeys.length; ai++) {
    const key = albumKeys[ai];
    const meta = state.albumMeta[key] || {};
    const tracks = state.albums[key] || [];
    const cover = meta.cover || (tracks[0] && tracks[0].cover) || '';
    const name = meta.name || key;
    const artist = meta.artist || (tracks[0] && tracks[0].artist) || '';
    const isActive = state.currentView === key;
    const isPlaying = isActive && state.isPlaying;
    const count = tracks.length;

    if (q && !name.toLowerCase().includes(q) && !artist.toLowerCase().includes(q) && !nfc(name).includes(qNorm) && !nfc(artist).includes(qNorm)) continue;

    const card = document.createElement('button');
    card.className = `ab-album-card${isActive ? ' active' : ''}${isPlaying ? ' playing' : ''}`;
    card.dataset.view = key;

    const wrap = document.createElement('div');
    wrap.className = 'ab-cover-wrap';

    if (cover) {
      const img = document.createElement('img');
      img.src = cover; img.alt = '';
      img.loading = 'lazy'; img.decoding = 'async';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = '<div class="ab-cover-placeholder"><svg width="28" height="28" fill="currentColor" viewBox="0 0 16 16"><path d="M9 13c0 1.105-1.12 2-2.5 2S4 14.105 4 13s1.12-2 2.5-2 2.5.895 2.5 2z"/><path fill-rule="evenodd" d="M9 3v10H8V3h1z"/><path d="M8 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 13 2.22V4L8 5V2.82z"/></svg></div>';
    }

    const eq = document.createElement('div');
    eq.className = 'ab-cover-eq';
    const pClass = !state.isPlaying ? ' paused' : '';
    eq.innerHTML = `<div class="ab-cover-eq-bar${pClass}"></div><div class="ab-cover-eq-bar${pClass}"></div><div class="ab-cover-eq-bar${pClass}"></div>`;
    wrap.appendChild(eq);

    card.appendChild(wrap);

    const nameEl = document.createElement('div');
    nameEl.className = 'ab-album-name';
    nameEl.textContent = name;
    card.appendChild(nameEl);

    const artistEl = document.createElement('div');
    artistEl.className = 'ab-album-artist';
    artistEl.textContent = artist;
    card.appendChild(artistEl);

    const countEl = document.createElement('div');
    countEl.className = 'ab-album-count';
    countEl.textContent = `${count} cancion${count !== 1 ? 'es' : ''}`;
    card.appendChild(countEl);

    fragment.appendChild(card);
  }

  DOM.abGrid.appendChild(fragment);
  if (DOM.abBody) DOM.abBody.scrollTop = 0;
};


const updateAbNowPlaying = () => {
  if (!DOM.abNowPlaying) return;
  const track = state.activeTrackData;

  if (!track || !track.src) {
    DOM.abNowPlaying.classList.remove('visible');
    return;
  }
  DOM.abNowPlaying.classList.add('visible');

  const meta = state.albumMeta[state.activeTrackAlbum] || {};
  const cover = meta.cover || track.cover || '';
  DOM.abNpCover.style.backgroundImage = cover ? `url('${cover}')` : '';
  if (DOM.abNpTitle) DOM.abNpTitle.textContent = track.title || 'Sin titulo';
  if (DOM.abNpArtist) DOM.abNpArtist.textContent = track.artist || meta.artist || '---';
  if (DOM.abIconPlay) DOM.abIconPlay.style.display  = state.isPlaying ? 'none' : 'block';
  if (DOM.abIconPause) DOM.abIconPause.style.display = state.isPlaying ? 'block' : 'none';
};

const populateUploadAlbumSelect = () => {
  if (!DOM.uploadAlbumSelect) return;
  DOM.uploadAlbumSelect.innerHTML = '<option value="">-- Seleccionar album --</option>';
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

  const cfg = state.btnConfig;
  const activeId = state.activeTrackData.src;
  const activeOrigin = state.activeTrackAlbum;
  const online = navigator.onLine;
  const favHtml = '<svg width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/></svg>';
  const coverFallback = '<svg width="14" height="14" fill="var(--muted)" viewBox="0 0 16 16"><path d="M9 13c0 1.105-1.12 2-2.5 2S4 14.105 4 13s1.12-2 2.5-2 2.5.895 2.5 2z"/><path fill-rule="evenodd" d="M9 3v10H8V3h1z"/><path d="M8 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 13 2.22V4L8 5V2.82z"/></svg>';

  const fragment = document.createDocumentFragment();

  filtered.forEach((t, idx) => {
    const isCurrent = t.src === activeId && t.albumOrigin === activeOrigin;
    const dur = state.durations[getTrackId(t)];
    const durText = dur ? formatTime(dur) : '–:––';
    const coverUrl = (state.albumMeta[t.albumOrigin] || {}).cover || t.cover || '';
    const isOff = !online && !isLocalSong(t);

    const row = document.createElement('div');
    row.className = `track-row${isCurrent ? ' current' : ''}${isOff ? ' offline-unavailable' : ''}`;
    row.setAttribute('role', 'listitem');

    // Num
    const numDiv = document.createElement('div');
    numDiv.className = 't-num';
    numDiv.textContent = String(idx + 1);
    row.appendChild(numDiv);

    // EQ bars
    const eqDiv = document.createElement('div');
    eqDiv.className = 't-eq';
    if (isCurrent) {
      const pClass = state.isPlaying ? '' : ' paused';
      eqDiv.innerHTML = `<div class="t-eq-bar${pClass}"></div><div class="t-eq-bar${pClass}"></div><div class="t-eq-bar${pClass}"></div>`;
    }
    row.appendChild(eqDiv);

    // Cover
    const coverDiv = document.createElement('div');
    coverDiv.className = 't-cover';
    coverDiv.style.display = cfg.trackCover ? '' : 'none';
    coverDiv.innerHTML = coverUrl
      ? `<img src="${coverUrl}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;">`
      : coverFallback;
    row.appendChild(coverDiv);

    // Info
    const infoDiv = document.createElement('div');
    infoDiv.className = 't-info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 't-name';
    nameDiv.textContent = t.title;
    if (isOff) {
      const mark = document.createElement('span');
      mark.className = 'offline-marker';
      mark.textContent = '!';
      nameDiv.appendChild(mark);
    }
    nameDiv.title = t.title;
    infoDiv.appendChild(nameDiv);
    const artDiv = document.createElement('div');
    artDiv.className = 't-art';
    artDiv.textContent = t.artist || '---';
    infoDiv.appendChild(artDiv);
    row.appendChild(infoDiv);

    // Duration
    const durDiv = document.createElement('div');
    durDiv.className = 't-dur';
    durDiv.textContent = durText;
    durDiv.style.display = cfg.duration ? '' : 'none';
    row.appendChild(durDiv);

    // Fav
    const favBtn = document.createElement('button');
    favBtn.className = `t-fav-btn${isFav(t) ? ' active' : ''}`;
    favBtn.setAttribute('aria-label', 'Favorito');
    favBtn.innerHTML = favHtml;
    favBtn.style.display = cfg.favBtn ? '' : 'none';
    row.appendChild(favBtn);

    row.addEventListener('click', (e) => {
      if (e.target.closest('.t-fav-btn')) return;
      if (isCurrent) togglePlayback();
      else { loadTrack(idx); togglePlayback(true); }
    });
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(t);
    });

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

const cleanFavorites = () => {
  const valid = new Set();
  Object.values(state.albums).forEach(tracks => tracks.forEach(t => valid.add(getTrackId(t))));
  state.uploadedSongs.forEach(t => valid.add(getTrackId(t)));
  state.customAlbums.forEach(a => (a.tracks || []).forEach(t => valid.add(getTrackId(t))));
  let changed = false;
  state.favorites.forEach(id => { if (!valid.has(id)) { state.favorites.delete(id); changed = true; } });
  if (changed) setLS(LS_KEYS.favorites, [...state.favorites]);
};

const initPlayer = async () => {
  state.favorites    = new Set(getLS(LS_KEYS.favorites, []));
  state.albumMeta    = getLS(LS_KEYS.albumMeta, {});
  state.uploadedSongs = getLS(LS_KEYS.uploaded, []).filter(t => t.src && (t.fileId || !t.src.startsWith('blob:')));
  state.customAlbums = getLS(LS_KEYS.customAlbums, []);

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
  state.btnConfig   = getLS(LS_KEYS.btnConfig, { seekBtns: false, seekBack: 10, seekFwd: 10, favBtn: true, duration: true, trackCover: true, volume: true, editBtn: true, trackNav: false });
  // Garantizar campos que podrían faltar en saves anteriores
  if (!('favBtn'    in state.btnConfig)) state.btnConfig.favBtn    = true;
  if (!('duration'  in state.btnConfig)) state.btnConfig.duration  = true;
  if (!('trackCover'in state.btnConfig)) state.btnConfig.trackCover= true;
  if (!('seekBack'   in state.btnConfig)) state.btnConfig.seekBack   = 10;
  if (!('seekFwd'    in state.btnConfig)) state.btnConfig.seekFwd    = 10;
  state.shuffle = getLS(LS_KEYS.shuffle, false);
  state.repeat  = getLS(LS_KEYS.repeat, false);
  if (!('seekPosition'in state.btnConfig)) state.btnConfig.seekPosition = 'row';
  if (!('volume'     in state.btnConfig)) state.btnConfig.volume     = true;
  if (!('editBtn'    in state.btnConfig)) state.btnConfig.editBtn    = true;

  DOM.volSlider.value = Math.round(audio.volume * 100);
  applyCustomBg(state.customBg);
  renderCustomBgUrls();
  DOM.toggleBt21.checked = state.effects.bt21;
  DOM.toggleDiscSpin.checked = state.effects.discSpin;
  DOM.toggleMarquee.checked = state.effects.marquee;
  DOM.toggleAntonio.checked = state.effects.antonio;
  if (!state.effects.antonio) ANTONIO.disable();
  applyBtnConfig();

  const savedView = getLS(LS_KEYS.currentView, '__ALL__');

  try {
    const res = await fetch('songs.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.albums = await res.json();
    mergeAlbumExtras();
    cleanFavorites();
    refreshAlbumSelector();
    restoreView(savedView);
    loadTrack(0);
  } catch (err) {
    console.error('Error cargando songs.json:', err);
    mergeAlbumExtras();
    cleanFavorites();
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
  if (state.ytTrack || !audio.duration) return;
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
audio.addEventListener('play',  () => togglePlayback(true, true));
audio.addEventListener('pause', () => togglePlayback(false, true));
audio.addEventListener('error', () => {
  if (!state.activeTrackData.src && !state.ytTrack) return;
  showToast('Error al cargar el audio', 'error');
  setTimeout(nextTrack, 1500);
});

DOM.volSlider.addEventListener('input', (e) => {
  audio.volume = e.target.value / 100;
  setLS(LS_KEYS.volume, audio.volume);
  ANTONIO.onVolumeChange(audio.volume);
});

DOM.albumSelect.addEventListener('change', (e) => {
  const prevTrackSrc = state.activeTrackData?.src || '';
  state.currentView  = e.target.value;
  setLS(LS_KEYS.currentView, state.currentView);
  state.searchQuery  = '';
  DOM.searchInput.value = '';
  if (isSpecialView(state.currentView) && state.shuffle) {
    state.shuffle = false;
    DOM.btnShuffle.classList.remove('active');
  }
  DOM.btnEditAlbum.style.display = (!isSpecialView(state.currentView) && state.btnConfig.editBtn) ? 'flex' : 'none';
  updateCurrentAlbumLabel();
  if (state.currentView === '__FAV__') ANTONIO.onFavView();

  // Igual que en selectViewFromBrowser: solo actualizar la lista, nunca el audio
  const newFiltered = getFilteredTracks();
  const activeInNewView = prevTrackSrc
    ? newFiltered.findIndex(t => t.src === prevTrackSrc)
    : -1;
  state.currentTrackIdx = activeInNewView !== -1 ? activeInNewView : 0;
  updateTrackList();
});

let searchDebounceTimer = null;
DOM.searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(updateTrackList, 180);
  ANTONIO.onSearch(state.searchQuery);
});

const seekTo = (clientX) => {
  const rect  = DOM.progressBar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  if (state.ytTrack && ytPlayer && ytPlayer.getDuration && ytPlayer.seekTo) {
    const dur = ytPlayer.getDuration();
    if (dur) ytPlayer.seekTo(ratio * dur);
  } else {
    if (!audio.duration) return;
    audio.currentTime = ratio * audio.duration;
  }
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
  const dur = state.ytTrack && ytPlayer && ytPlayer.getDuration ? ytPlayer.getDuration() : audio.duration;
  const pos = state.ytTrack && ytPlayer && ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : audio.currentTime;
  if (!isFinite(dur) || dur <= 0) return;
  const safePos = isFinite(pos) ? Math.min(Math.max(pos, 0), dur) : 0;
  try {
    navigator.mediaSession.setPositionState({
      duration:     dur,
      playbackRate: 1,
      position:     safePos,
    });
  } catch { }
};

const toAbsUrl = (url) => {
  if (!url || url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://')) return url;
  try { return new URL(url, window.location.href).href; } catch { return url; }
};

let lastArtworkUrl = '';
let lastArtworkBlob = null;
const dataUrlToBlob = (dataUrl) => {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  if (lastArtworkUrl === dataUrl && lastArtworkBlob) return lastArtworkBlob;
  try {
    const res = fetch(dataUrl).then(r => r.blob()).then(blob => {
      lastArtworkUrl = dataUrl;
      lastArtworkBlob = URL.createObjectURL(blob);
      return lastArtworkBlob;
    }).catch(() => dataUrl);
    return res;
  } catch { return dataUrl; }
};

const updateMediaSession = () => {
  if (!('mediaSession' in navigator)) return;
  const meta     = state.albumMeta[state.activeTrackAlbum] || {};
  let coverUrl = toAbsUrl(meta.cover || state.activeTrackData.cover || '');
  const artType  = guessImageType(coverUrl);

  // Android lock screen can't use data: URIs; convert to blob URL
  if (coverUrl && coverUrl.startsWith('data:')) {
    coverUrl = dataUrlToBlob(coverUrl) || coverUrl;
  }

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
    if (state.ytTrack && ytPlayer && ytPlayer.getCurrentTime && ytPlayer.seekTo) ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() - skip));
    else audio.currentTime = Math.max(0, audio.currentTime - skip);
    updateMediaPositionState();
  });
  setOptionalHandler('seekforward', (details) => {
    const skip = details?.seekOffset || 10;
    if (state.ytTrack && ytPlayer && ytPlayer.getCurrentTime && ytPlayer.seekTo) ytPlayer.seekTo(ytPlayer.getCurrentTime() + skip);
    else audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + skip);
    updateMediaPositionState();
  });
  // Arrastrar la barra de progreso desde los controles nativos
  setOptionalHandler('seekto', (details) => {
    if (state.ytTrack && ytPlayer && typeof details?.seekTime === 'number' && ytPlayer.seekTo) {
      ytPlayer.seekTo(details.seekTime);
    } else if (details?.fastSeek && 'fastSeek' in audio) {
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
  if (!e.target.closest('.modal-sheet, .sidebar-body, .sidebar, .tracklist, .upload-list, .effects-list, .ab-body')) {
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

const clearCache = async () => {
  if (!confirm('¿Borrar toda la caché?\n\nSe eliminarán:\n• Canciones descargadas\n• Fondos personalizados\n• Archivos subidos a álbumes')) return;
  try {
    // Limpiar IndexedDB
    const db = await openFileDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    await new Promise((res, rej) => {
      const req = tx.objectStore(DB_STORE).clear();
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
  } catch (_) {}

  // Revocar todos los blob URLs
  for (const url of createdBlobUrls) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
  createdBlobUrls.clear();

  // Limpiar estado
  audio.pause();
  audio.src = '';
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  if (ytPollInterval) { clearInterval(ytPollInterval); ytPollInterval = null; }
  ytPendingVideo = null;
  ytLastLoadedVid = null;
  state.isPlaying = false;
  state.activeTrackData = {};
  state.activeTrackAlbum = '';
  state.currentTrackIdx = 0;
  state.currentView = '__ALL__';
  state.ytTrack = false;
  state.favorites = new Set();
  state.durations = {};
  state.shuffle = false;
  state.repeat = false;
  state.searchQuery = '';
  state.uploadedSongs = [];
  state.albumExtras = {};
  state.customBg = { bg: '', opacity: 0.25 };
  state.customBgUrls = [];
  state.customAlbums = [];

  // Limpiar localStorage
  setLS(LS_KEYS.uploaded, []);
  setLS(LS_KEYS.albumExtras, {});
  setLS(LS_KEYS.customBg, state.customBg);
  setLS(LS_KEYS.customBgList, []);
  setLS(LS_KEYS.customAlbums, []);

  // Limpiar albumMeta de los custom albums
  for (const key of Object.keys(state.albumMeta)) {
    if (key.startsWith('__CUSTOM__')) delete state.albumMeta[key];
  }
  setLS(LS_KEYS.albumMeta, state.albumMeta);

  // Resetear UI
  DOM.timeNow.textContent = '0:00';
  DOM.timeTotal.textContent = '--:--';
  DOM.progressFill.style.width = '0%';
  DOM.trackTitle.textContent = '';
  DOM.trackArtist.textContent = '';
  DOM.trackAlbum.textContent = '';
  DOM.disc.style.backgroundImage = '';
  DOM.discCoverBg.style.backgroundImage = '';
  DOM.labelImg.style.display = 'none';
  DOM.labelEmoji.style.display = '';
  DOM.labelEmoji.textContent = '🎵';
  DOM.albumSelect.value = '__ALL__';
  applyCustomBg();
  refreshAlbumSelector();
  updateTrackList();
  if (DOM.customBgGrid) renderCustomBgUrls();

  showToast('Caché limpiada correctamente', 'success');
};

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

// Album browser
if (DOM.btnOpenAlbumsBar) DOM.btnOpenAlbumsBar.addEventListener('click', openAlbumBrowser);
if (DOM.btnAlbumBrowserBack) DOM.btnAlbumBrowserBack.addEventListener('click', closeAlbumBrowser);
if (DOM.abGrid) DOM.abGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.ab-album-card');
  if (card && card.dataset.view) selectViewFromBrowser(card.dataset.view);
});

// Album browser search (debounced)
let abSearchTimer = null;
if (DOM.abSearchInput) {
  DOM.abSearchInput.addEventListener('input', () => {
    clearTimeout(abSearchTimer);
    abSearchTimer = setTimeout(() => renderAlbumBrowser(DOM.abSearchInput.value), 180);
  });
}

// Mini now-playing controls in album browser
if (DOM.abNpPlay) {
  DOM.abNpPlay.addEventListener('click', () => {
    togglePlayback();
  });
}
if (DOM.abNpPrev) {
  DOM.abNpPrev.addEventListener('click', () => {
    prevTrack(); ANTONIO.onPrev(); updateAbNowPlaying();
  });
}
if (DOM.abNpNext) {
  DOM.abNpNext.addEventListener('click', () => {
    nextTrack(); ANTONIO.onNext(); updateAbNowPlaying();
  });
}

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

DOM.sbOptClearCache.addEventListener('click', () => {
  closeSidebar();
  clearCache();
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

DOM.customBgFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('La imagen es muy grande (máx 2 MB)', 'error');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const compressed = await compressImage(ev.target.result);
    state.customBgUrls.push(compressed);
    setLS(LS_KEYS.customBgList, state.customBgUrls);
    renderCustomBgUrls();
    state.customBg.bg = compressed;
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
let idleEnterTimer = null;
const IDLE_MS = 12000;

const enterIdle = () => {
  if (!state.isPlaying) return;
  const anyModalOpen = [DOM.modalEditAlbum, DOM.modalUpload, DOM.modalYt, DOM.modalCustomize, DOM.modalEffects]
    .some(m => m.classList.contains('open'));
  if (anyModalOpen) return;
  const p = document.querySelector('.player');
  if (!p) return;
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

  idleEnterTimer = setTimeout(() => {
    p.classList.add('idle');
    idleEnterTimer = null;
  }, 420);
};
const leaveIdle = () => {
  const p = document.querySelector('.player');
  if (!p) return;
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
  clearTimeout(idleEnterTimer);
  idleEnterTimer = null;
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
    const sb = document.querySelector('.sidebar');
    if (sb) sb.classList.add('no-antonio');
  },

  enable() {
    this.enabled = true;
    this.wrap.style.display = '';
    const sb = document.querySelector('.sidebar');
    if (sb) sb.classList.remove('no-antonio');
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

DOM.uploadZone.addEventListener('click', (e) => {
  if (e.target.closest('.upload-list') || e.target.closest('#btnConfirmUpload')) return;
  DOM.uploadFileInput.click();
});
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
  if (!vid) { DOM.ytSpinner.classList.remove('active'); showToast('No se pudo extraer el ID del video', 'error'); return; }

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
        const editImg = $id('editCoverImg');
        editImg.src = editingCoverDataUrl;
        editImg.style.display = 'block';
        $id('editCoverPlaceholder').style.display = 'none';
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

  $id('editAlbumNameDisplay').textContent = meta.name || editingAlbumKey;
  $id('editAlbumName').value   = meta.name || editingAlbumKey;
  $id('editAlbumArtist').value = meta.artist || firstTrack.artist || '';
  $id('editAlbumDate').value   = meta.date || '';
  $id('editAlbumDesc').value   = meta.desc || '';

  const coverUrl = meta.cover || firstTrack.cover || '';
  const editImg  = $id('editCoverImg');
  const editPh   = $id('editCoverPlaceholder');

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

$id('btnEditCancel').addEventListener('click', () => {
  DOM.modalEditAlbum.classList.remove('open'); unlockBody();
});

DOM.modalEditAlbum.addEventListener('click', (e) => {
  if (e.target === DOM.modalEditAlbum) { DOM.modalEditAlbum.classList.remove('open'); unlockBody(); }
});

$id('btnCoverClear').addEventListener('click', () => {
  editingCoverDataUrl = '__CLEAR__';
  $id('editCoverImg').style.display = 'none';
  $id('editCoverPlaceholder').style.display = 'block';
  toggleApiSearchUI(true);
  showToast('Portada eliminada (guardá para confirmar)');
});

$id('editCoverInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    editingCoverDataUrl = await compressImage(ev.target.result);
    const editImg = $id('editCoverImg');
    editImg.src = editingCoverDataUrl;
    editImg.style.display = 'block';
    $id('editCoverPlaceholder').style.display = 'none';
    toggleApiSearchUI(false);
    showToast('Imagen cargada — guardá para aplicar');
  };
  reader.readAsDataURL(file);
});

$id('btnEditSave').addEventListener('click', () => {
  const meta      = state.albumMeta[editingAlbumKey] || {};
  meta.name   = $id('editAlbumName').value.trim()   || editingAlbumKey;
  meta.artist = $id('editAlbumArtist').value.trim();
  meta.date   = $id('editAlbumDate').value;
  meta.desc   = $id('editAlbumDesc').value.trim();

  if (editingCoverDataUrl === '__CLEAR__') delete meta.cover;
  else if (editingCoverDataUrl)            meta.cover = editingCoverDataUrl;

  state.albumMeta[editingAlbumKey] = meta;

  DOM.modalEditAlbum.classList.remove('open'); unlockBody();
  if (setLS(LS_KEYS.albumMeta, state.albumMeta)) {
    refreshAlbumSelector();
    updateTrackList();
    if (state.activeTrackAlbum === editingAlbumKey) loadTrack(state.currentTrackIdx);
    showToast('Álbum actualizado correctamente', 'success');
  } else {
    showToast('Error al guardar: espacio en localStorage agotado', 'error');
  }
});

$id('btnDeleteAlbum').addEventListener('click', () => {
  if (!confirm(`¿Eliminar el registro de "${editingAlbumKey}" de la biblioteca?\nEsto no borra los archivos de audio.`)) return;
  delete state.albumMeta[editingAlbumKey];
  if (editingAlbumKey && editingAlbumKey.startsWith && editingAlbumKey.startsWith('__CUSTOM__')) {
    state.customAlbums = state.customAlbums.filter(a => a.key !== editingAlbumKey);
    setLS(LS_KEYS.customAlbums, state.customAlbums);
    if (state.currentView === editingAlbumKey) {
      state.currentView = '__ALL__';
      DOM.albumSelect.value = '__ALL__';
      setLS(LS_KEYS.currentView, '__ALL__');
    }
    if (state.activeTrackAlbum === editingAlbumKey) {
      loadTrack(0);
    }
  }
  DOM.modalEditAlbum.classList.remove('open'); unlockBody();
  if (setLS(LS_KEYS.albumMeta, state.albumMeta)) {
    refreshAlbumSelector();
    updateTrackList();
    if (DOM.albumBrowser.classList.contains('open')) renderAlbumBrowser('');
    showToast('Registro eliminado de la biblioteca');
  } else {
    showToast('Error al guardar: espacio en localStorage agotado', 'error');
  }
});

const MODAL_SELECTORS = ['modalEditAlbum','modalUpload','modalYt','modalCustomize','modalEffects','modalButtons','modalAddAlbum'];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    for (const id of MODAL_SELECTORS) {
      const el = DOM[id];
      if (el && el.classList.contains('open')) {
        el.classList.remove('open');
        unlockBody();
        break;
      }
    }
  }
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
// ═══════════════════════════════════════════════════
// PERSONALIZAR BOTONES
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// PERSONALIZAR BOTONES — buildControlsRow + applyBtnConfig
// ═══════════════════════════════════════════════════

// SVGs reutilizables
const SVG = {
  shuffle: `<svg width="17" height="17" fill="currentColor" viewBox="0 0 16 16"><path d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.624 9.624 0 0 0 7.556 8a9.624 9.624 0 0 0 1.318 1.918C9.827 10.99 11.202 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.595 10.595 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.624 9.624 0 0 0 6.444 8a9.624 9.624 0 0 0-1.318-1.918C4.173 5.01 2.798 4 1 4H.5a.5.5 0 0 1-.5-.5z"/><path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192zm0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192z"/></svg>`,
  prev:    `<svg width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M4 4a.5.5 0 0 1 1 0v3.248l6.267-3.656A.5.5 0 0 1 12 4v8a.5.5 0 0 1-.733.44L5 8.752V12a.5.5 0 0 1-1 0V4z"/></svg>`,
  next:    `<svg width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M12.5 4a.5.5 0 0 0-1 0v3.248L5.233 3.592A.5.5 0 0 0 4.5 4v8a.5.5 0 0 0 .733.44L11.5 8.752V12a.5.5 0 0 0 1 0V4z"/></svg>`,
  repeat:  `<svg width="17" height="17" fill="currentColor" viewBox="0 0 16 16"><path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192zm3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67z"/></svg>`,
  play:    `<svg id="iconPlay" width="22" height="22" fill="currentColor" viewBox="0 0 16 16" style="margin-left:2px;"><path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/></svg><svg id="iconPause" width="22" height="22" fill="currentColor" viewBox="0 0 16 16" style="display:none;"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/></svg>`,
  seekBack: (s) => `<svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 1 .908-.417A4 4 0 1 0 8 3v2.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V1.5a.5.5 0 0 1 .5-.5h3.5a.5.5 0 0 1 0 1H5.236A5 5 0 0 1 8 3z"/></svg><span class="seek-label">${s}s</span>`,
  seekFwd:  (s) => `<span class="seek-label">+${s}s</span><svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 0-.908-.417A4 4 0 1 1 8 3v2.5a.5.5 0 0 0 .5.5H12a.5.5 0 0 0 .5-.5V1.5a.5.5 0 0 0-.5-.5H8.5a.5.5 0 0 0 0 1h2.264A5 5 0 0 0 8 3z"/></svg>`,
  seekBackIcon: `<svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M7,17.29A8,8,0,1,0,5.06,11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><polyline points="3 6 5 11 10 9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`,
  seekFwdIcon: `<svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M17,17.29A8,8,0,1,1,18.94,11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><polyline points="21 6 19 11 14 9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`,
};

// Crea y adjunta los listeners en un botón de la fila de controles
const attachCtrlListeners = (el) => {
  const id = el.id;
  if (id === 'btnPlay')    el.addEventListener('click', () => togglePlayback());
  if (id === 'btnPrev')    el.addEventListener('click', () => { prevTrack(); ANTONIO.onPrev(); });
  if (id === 'btnNext')    el.addEventListener('click', () => { nextTrack(); ANTONIO.onNext(); });
  if (id === 'btnShuffle') el.addEventListener('click', () => {
    if (['__ALL__','__FAV__','__UPLOADED__'].includes(state.currentView)) { showToast('Aleatorio solo disponible en un álbum', 'error'); return; }
    state.shuffle = !state.shuffle;
    if (state.shuffle && state.repeat) { state.repeat = false; document.getElementById('btnRepeat')?.classList.remove('active'); setLS(LS_KEYS.repeat, false); }
    el.classList.toggle('active', state.shuffle);
    setLS(LS_KEYS.shuffle, state.shuffle);
    showToast(state.shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado');
    ANTONIO.onShuffleToggle(state.shuffle);
  });
  if (id === 'btnRepeat') el.addEventListener('click', () => {
    state.repeat = !state.repeat;
    if (state.repeat && state.shuffle) { state.shuffle = false; document.getElementById('btnShuffle')?.classList.remove('active'); setLS(LS_KEYS.shuffle, false); }
    el.classList.toggle('active', state.repeat);
    setLS(LS_KEYS.repeat, state.repeat);
    showToast(state.repeat ? 'Repetición activada' : 'Repetición desactivada');
    ANTONIO.onRepeatToggle(state.repeat);
  });
  if (id === 'btnSeekBack') el.addEventListener('click', () => {
    if (state.ytTrack && ytPlayer && ytPlayer.getCurrentTime && ytPlayer.seekTo) {
      ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() - state.btnConfig.seekBack));
    } else {
      if (!audio.duration) return;
      audio.currentTime = Math.max(0, audio.currentTime - state.btnConfig.seekBack);
    }
    updateMediaPositionState();
    showToast(`-${state.btnConfig.seekBack}s`);
    const svg = el.querySelector('svg');
    if (svg) {
      svg.classList.remove('spin-active');
      void svg.offsetWidth;
      svg.classList.add('spin-active');
      setTimeout(() => svg.classList.remove('spin-active'), 500);
    }
  });
  if (id === 'btnSeekFwd') el.addEventListener('click', () => {
    if (state.ytTrack && ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getDuration && ytPlayer.seekTo) {
      const dur = ytPlayer.getDuration();
      const skip = state.btnConfig.seekFwd;
      ytPlayer.seekTo(dur ? Math.min(dur, ytPlayer.getCurrentTime() + skip) : ytPlayer.getCurrentTime() + skip);
    } else {
      if (!audio.duration) return;
      audio.currentTime = Math.min(audio.duration, audio.currentTime + state.btnConfig.seekFwd);
    }
    updateMediaPositionState();
    showToast(`+${state.btnConfig.seekFwd}s`);
    const svg = el.querySelector('svg');
    if (svg) {
      svg.classList.remove('spin-active');
      void svg.offsetWidth;
      svg.classList.add('spin-active');
      setTimeout(() => svg.classList.remove('spin-active'), 500);
    }
  });
};

// Reconstruye toda la nav de controles según la config actual
const buildControlsRow = () => {
  const nav = DOM.controlsNav;
  if (!nav) return;
  nav.innerHTML = '';
  const cfg = state.btnConfig;
  const sb = cfg.seekBack, sf = cfg.seekFwd;

  // ── Fila principal (Sencilla y limpia) ──────────────────────
  const row = document.createElement('div');
  row.className = 'controls-row';

  const makeCtrl = (id, cls, label, html) => {
    const b = document.createElement('button');
    b.id = id; b.className = cls; b.setAttribute('aria-label', label);
    b.innerHTML = html;
    attachCtrlListeners(b);
    if (id === 'btnShuffle' && state.shuffle) b.classList.add('active');
    if (id === 'btnRepeat'  && state.repeat)  b.classList.add('active');
    if (id === 'btnPlay') {
      b.querySelector('#iconPlay').style.display  = state.isPlaying ? 'none'  : 'block';
      b.querySelector('#iconPause').style.display = state.isPlaying ? 'block' : 'none';
    }
    return b;
  };

  row.appendChild(makeCtrl('btnShuffle', 'ctrl', 'Modo Aleatorio', SVG.shuffle));
  if (cfg.trackNav) row.appendChild(makeCtrl('btnPrev', 'ctrl', 'Anterior', SVG.prev));
  if (cfg.seekBtns) {
    row.appendChild(makeCtrl('btnSeekBack', 'ctrl seek-btn-inline', `Retroceder ${sb}s`, SVG.seekBackIcon));
  }
  row.appendChild(makeCtrl('btnPlay', 'play-btn', 'Reproducir/Pausar', SVG.play));
  if (cfg.seekBtns) {
    row.appendChild(makeCtrl('btnSeekFwd', 'ctrl seek-btn-inline', `Adelantar ${sf}s`, SVG.seekFwdIcon));
  }
  if (cfg.trackNav) row.appendChild(makeCtrl('btnNext', 'ctrl', 'Siguiente', SVG.next));
  row.appendChild(makeCtrl('btnRepeat', 'ctrl', 'Repetir pista', SVG.repeat));
  nav.appendChild(row);

  // Re-exponer DOM.btnPlay etc. para compatibilidad
  DOM.btnPlay    = document.getElementById('btnPlay')    || document.createElement('button');
  DOM.iconPlay   = document.getElementById('iconPlay')   || document.createElement('span');
  DOM.iconPause  = document.getElementById('iconPause')  || document.createElement('span');
  if (cfg.trackNav) {
    DOM.btnPrev = document.getElementById('btnPrev') || document.createElement('button');
    DOM.btnNext = document.getElementById('btnNext') || document.createElement('button');
  }
  DOM.btnShuffle = document.getElementById('btnShuffle') || document.createElement('button');
  DOM.btnRepeat  = document.getElementById('btnRepeat')  || document.createElement('button');
};

const applyBtnConfig = () => {
  const cfg = state.btnConfig;

  // Reconstruir fila de controles
  buildControlsRow();

  // Labels internos del modal
  if (DOM.seekBackVal)    DOM.seekBackVal.textContent    = cfg.seekBack;
  if (DOM.seekFwdVal)     DOM.seekFwdVal.textContent     = cfg.seekFwd;
  if (DOM.toggleSeekBtns) DOM.toggleSeekBtns.checked    = cfg.seekBtns;
  if (DOM.seekCfgSection)  DOM.seekCfgSection.style.display = cfg.seekBtns ? 'block' : 'none';
  if (DOM.toggleTrackNav) DOM.toggleTrackNav.checked     = cfg.trackNav;

  // Volumen
  if (DOM.volumeRow)    DOM.volumeRow.style.display    = cfg.volume   ? '' : 'none';
  if (DOM.toggleVolume) DOM.toggleVolume.checked        = cfg.volume;

  // Botón editar álbum: respeta la regla de solo mostrarlo cuando hay álbum seleccionado
  const isSpecial = ['__ALL__','__FAV__','__UPLOADED__'].includes(state.currentView);
  if (DOM.btnEditAlbum) {
    DOM.btnEditAlbum.style.display = (!isSpecial && cfg.editBtn) ? 'flex' : 'none';
  }
  if (DOM.toggleEditBtn) DOM.toggleEditBtn.checked = cfg.editBtn;

  // Toggles tracklist
  if (DOM.toggleFavBtn)     DOM.toggleFavBtn.checked     = cfg.favBtn;
  if (DOM.toggleDuration)   DOM.toggleDuration.checked   = cfg.duration;
  if (DOM.toggleTrackCover) DOM.toggleTrackCover.checked = cfg.trackCover;
};

const saveBtnConfig = () => setLS(LS_KEYS.btnConfig, state.btnConfig);

// ─── Abrir/cerrar modal de botones ───────────────────────
if (DOM.sbOptButtons) {
  DOM.sbOptButtons.addEventListener('click', () => {
    closeSidebar();
    applyBtnConfig();
    DOM.modalButtons.classList.add('open');
    lockBody();
  });
}
if (DOM.btnButtonsClose) {
  DOM.btnButtonsClose.addEventListener('click', () => {
    DOM.modalButtons.classList.remove('open');
    unlockBody();
  });
}
if (DOM.modalButtons) {
  DOM.modalButtons.addEventListener('click', (e) => {
    if (e.target === DOM.modalButtons) { DOM.modalButtons.classList.remove('open'); unlockBody(); }
  });
}

// ─── Add album modal ─────────────────────────────────
DOM.btnAddAlbumCancel.addEventListener('click', closeAddAlbumModal);
DOM.btnAddAlbumSave.addEventListener('click', saveCustomAlbum);
DOM.modalAddAlbum.addEventListener('click', (e) => {
  if (e.target === DOM.modalAddAlbum) closeAddAlbumModal();
});
DOM.addCoverInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    addAlbumCoverDataUrl = await compressImage(ev.target.result);
    DOM.addCoverImg.src = addAlbumCoverDataUrl;
    DOM.addCoverImg.style.display = 'block';
    DOM.addCoverPlaceholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// ─── Toggle seek buttons ─────────────────────────────────
if (DOM.toggleSeekBtns) {
  DOM.toggleSeekBtns.addEventListener('change', () => {
    state.btnConfig.seekBtns = DOM.toggleSeekBtns.checked;
    if (DOM.seekCfgSection) DOM.seekCfgSection.style.display = state.btnConfig.seekBtns ? 'block' : 'none';
    buildControlsRow(); saveBtnConfig();
  });
}

// ─── Toggle track nav ─────────────────────────────────────
if (DOM.toggleTrackNav) {
  DOM.toggleTrackNav.addEventListener('change', () => {
    state.btnConfig.trackNav = DOM.toggleTrackNav.checked;
    buildControlsRow(); saveBtnConfig();
  });
}

// ─── Steppers de segundos ─────────────────────────────────
const clampSeek = (v) => Math.min(60, Math.max(5, Math.round(v / 5) * 5));
if (DOM.btnBackMinus) DOM.btnBackMinus.addEventListener('click', () => { state.btnConfig.seekBack = clampSeek(state.btnConfig.seekBack - 5); if (DOM.seekBackVal) DOM.seekBackVal.textContent = state.btnConfig.seekBack; buildControlsRow(); saveBtnConfig(); });
if (DOM.btnBackPlus)  DOM.btnBackPlus.addEventListener('click',  () => { state.btnConfig.seekBack = clampSeek(state.btnConfig.seekBack + 5); if (DOM.seekBackVal) DOM.seekBackVal.textContent = state.btnConfig.seekBack; buildControlsRow(); saveBtnConfig(); });
if (DOM.btnFwdMinus)  DOM.btnFwdMinus.addEventListener('click',  () => { state.btnConfig.seekFwd  = clampSeek(state.btnConfig.seekFwd  - 5); if (DOM.seekFwdVal)  DOM.seekFwdVal.textContent  = state.btnConfig.seekFwd;  buildControlsRow(); saveBtnConfig(); });
if (DOM.btnFwdPlus)   DOM.btnFwdPlus.addEventListener('click',   () => { state.btnConfig.seekFwd  = clampSeek(state.btnConfig.seekFwd  + 5); if (DOM.seekFwdVal)  DOM.seekFwdVal.textContent  = state.btnConfig.seekFwd;  buildControlsRow(); saveBtnConfig(); });

// ─── Toggle volumen ───────────────────────────────────────
if (DOM.toggleVolume) {
  DOM.toggleVolume.addEventListener('change', () => {
    state.btnConfig.volume = DOM.toggleVolume.checked;
    if (DOM.volumeRow) DOM.volumeRow.style.display = state.btnConfig.volume ? '' : 'none';
    saveBtnConfig();
  });
}

// ─── Toggle botón editar ──────────────────────────────────
if (DOM.toggleEditBtn) {
  DOM.toggleEditBtn.addEventListener('change', () => {
    state.btnConfig.editBtn = DOM.toggleEditBtn.checked;
    const isSpecial = ['__ALL__','__FAV__','__UPLOADED__'].includes(state.currentView);
    if (DOM.btnEditAlbum) DOM.btnEditAlbum.style.display = (!isSpecial && state.btnConfig.editBtn) ? 'flex' : 'none';
    saveBtnConfig();
  });
}

// ─── Toggle favorito en tracklist ────────────────────────
if (DOM.toggleFavBtn) {
  DOM.toggleFavBtn.addEventListener('change', () => {
    state.btnConfig.favBtn = DOM.toggleFavBtn.checked;
    saveBtnConfig(); updateTrackList();
  });
}

// ─── Toggle duración ─────────────────────────────────────
if (DOM.toggleDuration) {
  DOM.toggleDuration.addEventListener('change', () => {
    state.btnConfig.duration = DOM.toggleDuration.checked;
    saveBtnConfig();
    DOM.tracklist.querySelectorAll('.t-dur').forEach(el => { el.style.display = state.btnConfig.duration ? '' : 'none'; });
  });
}

// ─── Toggle portada en tracklist ─────────────────────────
if (DOM.toggleTrackCover) {
  DOM.toggleTrackCover.addEventListener('change', () => {
    state.btnConfig.trackCover = DOM.toggleTrackCover.checked;
    saveBtnConfig();
    DOM.tracklist.querySelectorAll('.t-cover').forEach(el => { el.style.display = state.btnConfig.trackCover ? '' : 'none'; });
  });
}

// ─── Gestos de deslizamiento en el área del disco (Swipe left/right) ───
const discArea = document.querySelector('.disc-area');
if (discArea) {
  let startX = 0;
  let startY = 0;
  let isSwiping = false;

  discArea.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isSwiping = true;
  }, { passive: true });

  discArea.addEventListener('touchmove', (e) => {
    if (!isSwiping || e.touches.length !== 1) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX;
    const diffY = currentY - startY;

    if (Math.abs(diffX) > Math.abs(diffY)) {
      if (e.cancelable) e.preventDefault();
    }
  }, { passive: false });

  discArea.addEventListener('touchend', (e) => {
    if (!isSwiping) return;
    isSwiping = false;
    if (e.changedTouches.length !== 1) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = endX - startX;
    const diffY = endY - startY;

    const threshold = 50;
    const restraint = 100;

    if (Math.abs(diffX) >= threshold && Math.abs(diffY) <= restraint) {
      if (diffX < 0) {
        nextTrack();
        ANTONIO.onNext();
        showToast('Siguiente canción ⏭️');
      } else {
        prevTrack();
        ANTONIO.onPrev();
        showToast('Canción anterior ⏮️');
      }
    }
  }, { passive: true });
}

// ═══════════════════════════════════════════════════
// ONLINE / OFFLINE DETECTION
// ═══════════════════════════════════════════════════
const offlineOverlay = document.getElementById('offlineOverlay');
const offlineBadge   = document.getElementById('offlineBadge');
const offlineClose   = document.getElementById('offlineClose');
let isOffline = false;

const enterOffline = () => {
  if (isOffline) return;
  isOffline = true;
  if (offlineOverlay) offlineOverlay.classList.add('visible');
  if (offlineBadge) offlineBadge.classList.add('show');
  showToast('Sin conexión — modo offline activado', 'error', 3000);
};

const leaveOffline = () => {
  if (!isOffline) return;
  isOffline = false;
  if (offlineOverlay) offlineOverlay.classList.remove('visible');
  if (offlineBadge) offlineBadge.classList.remove('show');
  showToast('Conexión restablecida', 'success');
};

if (offlineClose) {
  offlineClose.addEventListener('click', () => {
    if (offlineOverlay) offlineOverlay.classList.remove('visible');
  });
}

if (offlineOverlay) {
  offlineOverlay.addEventListener('click', (e) => {
    if (e.target === offlineOverlay) offlineOverlay.classList.remove('visible');
  });
}

const updateOnlineStatus = () => {
  if (navigator.onLine) {
    leaveOffline();
  } else {
    enterOffline();
  }
};

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Estado inicial
if (!navigator.onLine) {
  // Esperar a que el player se inicialice antes de mostrar
  setTimeout(enterOffline, 1000);
}

initPlayer().catch(e => console.error('init error:', e));



