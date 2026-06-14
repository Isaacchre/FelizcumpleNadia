"""
tagger.py
─────────────────────────────────────────────────────────────────
1. Lee cada .mp3 en la carpeta music/
2. Si le faltan tags (artista/álbum), busca en iTunes por nombre de archivo
3. Escribe los tags ID3 directamente en el MP3 (título, artista, álbum, portada)
4. Genera songs.json listo para el reproductor

Requisitos:
    pip install mutagen Pillow

Uso:
    python tagger.py
"""

import sys, subprocess

# ── Auto-instalar con el Python correcto ───────────────────────────────────────
for pkg in ("mutagen", "PIL"):
    try:
        __import__(pkg)
    except ImportError:
        real = "Pillow" if pkg == "PIL" else pkg
        print(f"📦 Instalando {real}...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", real, "-q"])

import os, re, json, time, difflib
import urllib.parse, urllib.request
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TALB, APIC, ID3NoHeaderError
from PIL import Image
from io import BytesIO

# ── Configuración ──────────────────────────────────────────────────────────────
MUSIC_DIR   = "music"
COVERS_DIR  = "covers"
OUTPUT_FILE = "songs.json"
COVER_SIZE  = (300, 300)
TARGET_ARTIST = "BTS"

# ── FILTRO AMPLIADO: Nombres del grupo, miembros y alias (incluye colaboraciones) ──
# Usamos \b para asegurar que "V" sea una palabra sola y no coincida con "Avril", por ejemplo.
_BTS_MEMBERS = re.compile(r'\b(bts|rm|jin|suga|agust d|j-hope|jhope|jimin|v|jung kook|jungkook)\b', re.IGNORECASE)

GRADIENTS = [
    "linear-gradient(135deg,#1a0030,#003040)",
    "linear-gradient(135deg,#001a30,#002a1a)",
    "linear-gradient(135deg,#301000,#200030)",
    "linear-gradient(135deg,#0a1628,#162840)",
    "linear-gradient(135deg,#1e0a2e,#0a1e2e)",
    "linear-gradient(135deg,#002010,#001a30)",
    "linear-gradient(135deg,#200010,#100030)",
]

# ── Limpieza del nombre de archivo → query de búsqueda ────────────────────────
_CLEAN = re.compile(r'[_\-]+')
_FEAT  = re.compile(r'\(?feat\.?\s*', re.I)
_EXTRA = re.compile(r'\s*[\(\[](official|mv|video|audio|lyrics?|hd|hq|color.coded)[\)\]]', re.I)
_YTID  = re.compile(r'\s*\[[A-Za-z0-9_\-]{11}\]\s*$')

def filename_to_query(filename: str) -> str:
    name = os.path.splitext(filename)[0]
    name = _YTID.sub('', name)
    name = _EXTRA.sub('', name)
    name = name.replace('-', ' ')
    name = _CLEAN.sub(' ', name)
    name = _FEAT.sub('feat ', name)
    return name.strip()

# ── Buscar en iTunes con Validación de Similitud y Filtro de Miembros ──────────
def search_itunes(query: str) -> dict:
    try:
        enc = urllib.parse.quote(query[:80])
        url = f"https://itunes.apple.com/search?term={enc}&media=music&limit=10&entity=song"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        })
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.loads(r.read())

        results = data.get('results', [])
        if not results:
            return {}

        best_match = None
        highest_ratio = 0.0
        query_lower = query.lower()

        for item in results:
            track = item.get('trackName', '')
            artist = item.get('artistName', '')
            
            # ── FILTRO ESTRICTO PERO INCLUSIVO ──
            # Si el artista no contiene "BTS" ni el nombre de ningún miembro, lo saltamos.
            if not _BTS_MEMBERS.search(artist):
                continue
            
            itunes_str_1 = f"{artist} {track}".lower()
            itunes_str_2 = f"{track} {artist}".lower()
            
            ratio_1 = difflib.SequenceMatcher(None, query_lower, itunes_str_1).ratio()
            ratio_2 = difflib.SequenceMatcher(None, query_lower, itunes_str_2).ratio()
            
            best_local_ratio = max(ratio_1, ratio_2)

            if best_local_ratio > highest_ratio:
                highest_ratio = best_local_ratio
                best_match = item

        # Requerimos un 35% de similitud para ser un poco más permisivos con nombres coreanos/ingleses
        if best_match and highest_ratio > 0.35:
            return {
                'title'      : best_match.get('trackName', ''),
                'artist'     : best_match.get('artistName', ''),
                'album'      : best_match.get('collectionName', ''),
                'artwork_url': best_match.get('artworkUrl100', '').replace('100x100bb', '600x600bb'),
            }
        
        return {}
        
    except Exception as e:
        print(f"    ⚠️  Error en API: {e}")
        return {}

# ── Descargar imagen desde URL ─────────────────────────────────────────────────
def download_image(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    })
    with urllib.request.urlopen(req, timeout=12) as r:
        return r.read()

# ── Procesar imagen (recorte cuadrado + resize) ────────────────────────────────
def process_image(raw: bytes) -> bytes:
    img = Image.open(BytesIO(raw))
    if img.mode != 'RGB':
        img = img.convert('RGB')
    w, h = img.size
    side = min(w, h)
    img  = img.crop(((w-side)//2, (h-side)//2, (w+side)//2, (h+side)//2))
    img  = img.resize(COVER_SIZE, Image.Resampling.LANCZOS)
    buf  = BytesIO()
    img.save(buf, 'JPEG', quality=85, optimize=True)
    return buf.getvalue()

# ── Guardar imagen en disco ────────────────────────────────────────────────────
def save_cover(img_bytes: bytes, safe_name: str) -> str:
    path = os.path.join(COVERS_DIR, safe_name)
    with open(path, 'wb') as f:
        f.write(img_bytes)
    return f"covers/{safe_name}"

# ── Escribir tags ID3 en el MP3 ────────────────────────────────────────────────
def write_tags(filepath: str, title: str, artist: str, album: str, cover_bytes: bytes = None):
    try:
        try:
            tags = ID3(filepath)
        except ID3NoHeaderError:
            tags = ID3()

        tags['TIT2'] = TIT2(encoding=3, text=title)
        tags['TPE1'] = TPE1(encoding=3, text=artist)
        tags['TALB'] = TALB(encoding=3, text=album)

        if cover_bytes:
            tags['APIC:Album cover'] = APIC(
                encoding=3,
                mime='image/jpeg',
                type=3,
                desc='Album cover',
                data=cover_bytes,
            )

        tags.save(filepath, v2_version=3)
        return True
    except Exception as e:
        print(f"    ⚠️  No se pudo escribir tags: {e}")
        return False

# ── Leer tags existentes ───────────────────────────────────────────────────────
def read_tags(filepath: str) -> dict:
    result = {}
    try:
        audio = MP3(filepath, ID3=ID3)
        if not audio.tags:
            return result
        if 'TIT2' in audio.tags: result['title']  = str(audio.tags['TIT2']).strip()
        if 'TPE1' in audio.tags: result['artist'] = str(audio.tags['TPE1']).strip()
        if 'TALB' in audio.tags: result['album']  = str(audio.tags['TALB']).strip()
        for key in audio.tags.keys():
            if key.startswith('APIC'):
                result['apic'] = audio.tags[key].data
                break
    except:
        pass
    return result

# ── Main ───────────────────────────────────────────────────────────────────────
def run():
    if not os.path.exists(MUSIC_DIR):
        print(f"\n❌  No existe la carpeta '{MUSIC_DIR}'.")
        return

    os.makedirs(COVERS_DIR, exist_ok=True)

    mp3_files = sorted(f for f in os.listdir(MUSIC_DIR) if f.lower().endswith('.mp3'))
    if not mp3_files:
        print(f"\n❌  No hay .mp3 en '{MUSIC_DIR}'.")
        return

    total = len(mp3_files)
    print(f"\n🎵  {total} canciones encontradas")
    print(f"🐍  Python: {sys.executable}\n")

    database    : dict[str, list] = {}
    album_cover : dict[str, str]  = {}
    tagged = 0
    skipped = 0

    for idx, filename in enumerate(mp3_files):
        filepath = os.path.join(MUSIC_DIR, filename)
        tags     = read_tags(filepath)

        has_title  = bool(tags.get('title'))
        has_artist = bool(tags.get('artist'))
        has_album  = bool(tags.get('album'))
        has_cover  = bool(tags.get('apic'))
        needs_info = not (has_title and has_artist and has_album)
        needs_cover = not has_cover

        prefix = f"[{idx+1}/{total}]"

        itunes     = {}
        cover_raw  = None

        if needs_info or needs_cover:
            # Añadimos sutilmente la etiqueta BTS a la búsqueda para priorizar el K-Pop en los resultados
            base_query = filename_to_query(filename)
            search_query = f"{TARGET_ARTIST} {base_query}"
            
            print(f"  🔍 {prefix} Buscando: {search_query[:50]}...")
            itunes = search_itunes(search_query)
            time.sleep(0.4)

            if itunes:
                if needs_cover and itunes.get('artwork_url'):
                    try:
                        raw      = download_image(itunes['artwork_url'])
                        cover_raw = process_image(raw)
                    except:
                        cover_raw = None
            else:
                print(f"       ⬜ No se encontró coincidencia (o no es de BTS/Miembros)")

        # ── Decidir valores finales ──
        title  = tags.get('title')  or itunes.get('title')  or filename_to_query(filename)
        artist = tags.get('artist') or itunes.get('artist') or TARGET_ARTIST
        album  = tags.get('album')  or itunes.get('album')  or "Unknown Album"

        cover_bytes = tags.get('apic') or cover_raw

        if needs_info or (needs_cover and cover_raw):
            ok = write_tags(filepath, title, artist, album, cover_raw if needs_cover else None)
            if ok:
                status = "✅" if itunes else "📝"
                src = "iTunes" if itunes else "fallback"
                print(f"       {status} Tags escritos ({src}): {artist} — {album}")
                tagged += 1
        else:
            print(f"  ✅ {prefix} {title[:45]} → tags OK")
            skipped += 1

        if album not in album_cover:
            safe = re.sub(r'[^a-z0-9]', '_', album.lower())[:40] + ".jpg"

            if cover_bytes:
                try:
                    processed = process_image(cover_bytes) if not cover_raw else cover_bytes
                    album_cover[album] = save_cover(processed, safe)
                except:
                    album_cover[album] = ""
            else:
                album_cover[album] = ""

        cover_url = album_cover[album]

        track = {
            "src"    : f"music/{urllib.parse.quote(filename)}",
            "title"  : title,
            "artist" : artist,
            "cover"  : cover_url,
            "bg"     : GRADIENTS[idx % len(GRADIENTS)],
        }

        if album not in database:
            database[album] = []
        database[album].append(track)

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(database, f, indent=2, ensure_ascii=False)

    total_songs  = sum(len(v) for v in database.values())
    total_covers = sum(1 for v in album_cover.values() if v)

    print(f"\n{'─'*55}")
    print(f"✅  {total_songs} canciones  •  {len(database)} álbumes  •  {total_covers} portadas válidas")
    print(f"✏️   {tagged} MP3 con tags nuevos  •  {skipped} ya tenían tags")
    print(f"📄  {OUTPUT_FILE}  +  {COVERS_DIR}/")
    print(f"{'─'*55}")
    for alb, tracks in sorted(database.items(), key=lambda x: -len(x[1])):
        icon = "✅" if album_cover.get(alb) else "⬜"
        print(f"  {icon}  {alb:<42} {len(tracks):>4} canciones")
    print()

if __name__ == "__main__":
    run()