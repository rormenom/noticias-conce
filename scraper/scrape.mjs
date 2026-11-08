// Lector de noticias del Gran Concepción
// Node 20+ · sin dependencias · genera ../noticias.json
// Lo ejecuta GitHub Actions cada 10 minutos (ver .github/workflows/actualizar.yml)

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = new URL('../noticias.json', import.meta.url);
const UA = 'NoticiasConceBot/1.0 (agregador personal; +https://github.com/rormenom/noticias-conce)';
const MAX_NUEVAS_POR_CORRIDA = 70;   // artículos nuevos a leer por ejecución
const MAX_POR_CATEGORIA = 80;
const DIAS = { podcasts: 14, otros: 5 }; // antigüedad máxima que se conserva

// Solo Región del Biobío: estas son las únicas secciones que se guardan
export const CATS = ['regional', 'politica', 'deportes', 'cultura', 'tecnologia'];

// Palabras que indican que la noticia es "de la zona" (se usan sobre todo en deportes y cultura)
const LOCAL_RE = new RegExp('(?<!\\p{L})(' + [
  'concepci[oó]n', 'conce', 'penquist[ao]s?', 'gran concepci[oó]n', 'b[ií]o ?-?b[ií]o', 'biob[ií]o',
  'talcahuano', 'hualp[eé]n', 'san pedro de la paz', 'chiguayante', 'coronel', 'lota', 'penco', 'tomé',
  'hualqui', 'santa juana', 'arauco', 'curanilahue', 'lebu', 'cañete', 'los [aá]ngeles', 'mulch[eé]n',
  'cabrero', 'yumbel', 'chill[aá]n', 'ñuble', 'ñublense', 'udec', 'ucsc', 'ubb', 'huachipato',
  'fern[aá]ndez vial', 'naval', 'lota schwager', 'deportes concepci[oó]n', 'universidad de concepci[oó]n',
  'teatro biob[ií]o', 'teatro udec', 'lenga', 'festival rec', 'caleta tumbes', 'quiriquina'
].join('|') + ')(?!\\p{L})', 'iu');

// Detección de temas para medios locales sin sección propia
const CULTURA_RE = /(?<!\p{L})(teatro|concierto|festival|cine|microcine|cineteca|película|libro|orquesta|sinfónica|danza|artesan\p{L}*|museo|pinacoteca|recital|exposición|galería|escritor|poeta|cantante|banda)(?!\p{L})/iu;
const POLITICA_RE = /(?<!\p{L})(gobernador\p{L}*|gobierno regional|gore|consejo regional|consejer[oa]s? regional\p{L}*|core|delegad[oa] presidencial|delegación presidencial|seremi|intendente|alcalde\p{L}*|alcaldía|concejo municipal|concejal\p{L}*|municipio|diputad[oa]s?|senador\p{L}*|parlamentari\p{L}*|ministr[oa]s?|subsecretari[oa]|candidat\p{L}*|elecci\p{L}*|electoral|votaci\p{L}*|partidos? políticos?|presupuesto|contralor\p{L}*|acusación constitucional|gobierno|la moneda|kast)(?!\p{L})/iu;
const TECNO_RE = /(?<!\p{L})(ciencia|científic\p{L}*|tecnolog\p{L}*|innovaci\p{L}*|investigador\p{L}*|robótica|inteligencia artificial|startups?|emprendimiento|laboratorio|satélite|astronom\p{L}*|software|patente|hidrógeno verde|biotecnolog\p{L}*)(?!\p{L})/iu;
const DEPORTE_RE = /(?<!\p{L})(fútbol|futbol|básquet\p{L}*|basquet\p{L}*|hockey|tenis|atletismo|triatlón|maratón|campeonato|torneo|liguilla|penales|estadio|hinchas|clásico|huachipato|deportes concepción|fernández vial|ñublense|goles?|club deportivo)(?!\p{L})/iu;

// ---------- Fuentes ----------
const SOURCES = [
  {
    id: 'conquistador', nombre: 'El Conquistador', home: 'https://www.elconquistadorconcepcion.cl/',
    type: 'wp', base: 'https://www.elconquistadorconcepcion.cl',
    mapCat(slug) {
      if (/podcast|programa|mesa-de-noticias|nuevo-dia|pasado-meridiano/.test(slug)) return 'podcasts';
      return { regional: 'regional', nacional: 'nacional', internacional: 'internacional', deportes: 'deportes', politica: 'politica',
               cultura: 'cultura', tecnologia: 'tecnologia', tendencias: 'tendencias' }[slug];
    },
    // Las emisiones de sus programas vienen con títulos tipo "MESA DE NOTICIAS 04 DE NOVIEMBRE DE 2026"
    esPrograma: t => t === t.toUpperCase() && /\d{1,2} DE [A-ZÁÉÍÓÚ]+ (DE )?\d{4}/.test(t),
  },
  {
    id: 'radioudec', nombre: 'Radio UdeC', home: 'https://www.radioudec.cl/',
    type: 'wp', base: 'https://www.radioudec.cl',
    mapCat(slug) {
      if (slug.includes('podcast')) return 'podcasts';
      return { regional: 'regional', udec: 'regional', politica: 'politica', nacional: 'nacional', internacional: 'internacional',
               deportes: 'deportes', cultura: 'cultura', 'musica-clasica': 'cultura', ciencia: 'tecnologia',
               tecnologia: 'tecnologia', innovacion: 'tecnologia', salud: 'tendencias' }[slug];
    },
    local: true,
  },
  {
    id: 'diarioconcepcion', nombre: 'Diario Concepción', home: 'https://www.diarioconcepcion.cl/',
    type: 'html', local: true,
    pages: ['/', '/ciudad/', '/politica/', '/economia/', '/deportes/', '/cultura/', '/ciencia-y-sociedad']
      .map(p => ({ url: 'https://www.diarioconcepcion.cl' + p })),
    linkRe: /^https:\/\/www\.diarioconcepcion\.cl\/[a-z-]+\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.html$/,
    classify(u) {
      const s = new URL(u).pathname.split('/')[1];
      return { ciudad: ['regional'], politica: ['politica'], economia: ['regional'], deportes: ['deportes'],
               cultura: ['cultura'], 'ciencia-y-sociedad': ['tecnologia'] }[s] || 'skip';
    },
    descGenerica: ['Noticias de Concepción y la Región del Bío Bío'],
  },
  {
    id: 'tvu', nombre: 'TVU', home: 'https://www.tvu.cl/',
    type: 'html', local: true, autoTemas: true,
    pages: [
      { url: 'https://www.tvu.cl/' },
      { url: 'https://www.tvu.cl/prensa' },
      { url: 'https://www.tvu.cl/search?tag=ciudad' },
      { url: 'https://www.tvu.cl/search?tag=cultura', cat: 'cultura' },
      { url: 'https://www.tvu.cl/siempre-juntos' },
    ],
    linkRe: /^https:\/\/www\.tvu\.cl\/(?:prensa|programas)\/(?:[a-z0-9-]+\/)*\d{4}\/\d{2}\/\d{2}\/[^/]+\.html$/,
    classify(u) {
      const p = new URL(u).pathname;
      if (/^\/(prensa\/tvu-noticias|programas)\//.test(p)) return 'skip';
      if (/^\/prensa\//.test(p)) return ['regional'];
      return 'skip';
    },
    descGenerica: ['Televisión de la Universidad de Concepción'],
  },
  {
    id: 'biobiochile', nombre: 'BioBioChile', home: 'https://www.biobiochile.cl/',
    type: 'html', scanRaw: true,
    pages: ['/lista/categorias/region-del-bio-bio', '/noticias/nacional/region-del-bio-bio', '/portada/deportes', '/lista/categorias/ciencia-y-tecnologia',
            '/lista/categorias/artes-y-cultura']
      .map(p => ({ url: 'https://www.biobiochile.cl' + p })),
    linkRe: /^https:\/\/www\.biobiochile\.cl\/(?:noticias|especial)\/(?:[a-z0-9-]+\/)*\d{4}\/\d{2}\/\d{2}\/[^/]+\.shtml$/,
    classify(u) {
      const p = new URL(u).pathname;
      if (/podcast/.test(p)) return ['podcasts'];
      if (/\/region-del-bio-bio\//.test(p)) return ['regional'];
      if (/^\/noticias\/deportes\//.test(p)) return ['deportes'];
      if (/^\/noticias\/internacional\//.test(p)) return ['internacional'];
      if (/\/artes-y-cultura\//.test(p)) return ['cultura'];
      if (/\/ciencia-y-tecnologia\//.test(p)) return ['tecnologia'];
      if (/\/(espectaculos-y-tv|sociedad|vida-actual|salud-y-bienestar|tendencias|turismo-y-viajes|dopamina)\//.test(p)) return ['tendencias'];
      if (/^\/noticias\/(nacional|economia)\//.test(p) || /^\/especial\/bbcl-investiga\//.test(p)) return ['nacional'];
      return 'skip';
    },
  },
  {
    id: 'canal9', nombre: 'Canal 9', home: 'https://www.canal9.cl/',
    type: 'html', autoTemas: true,
    pages: [
      { url: 'https://www.canal9.cl/secciones/gran-concepcion', cat: 'regional', local: true },
      { url: 'https://www.canal9.cl/secciones/region-biobio', cat: 'regional', local: true },
      { url: 'https://www.canal9.cl/secciones/deportes', cat: 'deportes' },
    ].map(p => ({ ...p, cutFrom: '/episodios/', cutAt: ['Cargar más noticias', 'Te recomendamos', 'Lo más visto'] })),
    linkRe: /^https:\/\/www\.canal9\.cl\/episodios\/(?:[a-z][a-z0-9-]*\/)?\d{4}\/\d{2}\/\d{2}\/[^/]+$/,
    classify(u) {
      if (/^\/episodios\/[a-z][a-z0-9-]*\/\d{4}\//.test(new URL(u).pathname)) return 'skip'; // capítulos de programas
      return null; // usa la categoría de la página donde apareció
    },
    descGenerica: ['Te ve mejor'],
  },
];

// ---------- Utilidades ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, { accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', timeout = 12000 } = {}) {
  for (let intento = 0; intento < 2; intento++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'es-CL,es;q=0.9' },
        signal: ctl.signal, redirect: 'follow',
      });
      if ([401, 403, 404, 410].includes(r.status)) throw Object.assign(new Error('HTTP ' + r.status), { final: true });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { text: await r.text(), url: r.url };
    } catch (e) {
      if (e.final || intento === 1) throw e;
      await sleep(1500);
    } finally { clearTimeout(t); }
  }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', aacute: 'á', eacute: 'é', iacute: 'í',
  oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Ntilde: 'Ñ', uuml: 'ü', iexcl: '¡', iquest: '¿', deg: '°' };

export function decode(s = '') {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? m;
  });
}
export function clean(html = '') {
  return decode(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
export function cut(s = '', n = 260) {
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
}
export function meta(html, names) {
  for (const name of names) {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const val = `content\\s*=\\s*(?:"([^"]*)"|'([^']*)')`;
    const key = `(?:property|name|itemprop)\\s*=\\s*["']${n}["']`;
    const m = html.match(new RegExp(`<meta[^>]*${key}[^>]*${val}`, 'i')) ||
              html.match(new RegExp(`<meta[^>]*${val}[^>]*${key}`, 'i'));
    const v = m && (m[1] ?? m[2] ?? '').trim();
    if (v) return decode(v);
  }
  return '';
}
export function extractLinks(html, pageUrl, re) {
  const out = new Map();
  const rx = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html))) {
    const href = (m[1] ?? m[2] ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    let u;
    try { u = new URL(decode(href), pageUrl); } catch { continue; }
    u.hash = ''; u.search = '';
    const s = u.href.replace(/^http:/, 'https:');
    if (!re.test(s)) continue;
    const text = clean(m[3]);
    const im = m[3].match(/<img\b[^>]*?(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/i);
    let img = '';
    if (im && !/^data:/.test(im[1])) { try { img = new URL(decode(im[1]), pageUrl).href; } catch {} }
    const prev = out.get(s) || { text: '', img: '' };
    out.set(s, { text: text.length > prev.text.length ? text : prev.text, img: prev.img || img });
  }
  return out;
}
export function urlDate(u) {
  const m = u.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const dias = iso => (Date.now() - new Date(iso).getTime()) / 864e5;
const maxDias = cats => (cats.length && cats.every(c => c === 'podcasts')) ? DIAS.podcasts : DIAS.otros;

// ---------- robots.txt ----------
export function parseRobots(txt) {
  const groups = []; let cur = null; let prevUA = false;
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/#.*/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(); const v = line.slice(i + 1).trim();
    if (k === 'user-agent') {
      if (!prevUA) { cur = { agents: [], allow: [], disallow: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); prevUA = true; continue;
    }
    prevUA = false;
    if (!cur) continue;
    if (k === 'disallow' && v) cur.disallow.push(v);
    if (k === 'allow' && v) cur.allow.push(v);
  }
  const mine = groups.filter(g => g.agents.some(a => a.startsWith('noticiasconcebot')));
  const use = mine.length ? mine : groups.filter(g => g.agents.includes('*'));
  return { allow: use.flatMap(g => g.allow), disallow: use.flatMap(g => g.disallow) };
}
function ruleRe(rule) {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  return new RegExp('^' + body.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
}
export function allowed(rules, url) {
  const u = new URL(url); const path = u.pathname + u.search;
  let len = -1; let ok = true;
  for (const r of rules.disallow) if (ruleRe(r).test(path) && r.length > len) { len = r.length; ok = false; }
  for (const r of rules.allow) if (ruleRe(r).test(path) && r.length >= len) { len = r.length; ok = true; }
  return ok;
}
const robotsCache = new Map();
async function permitido(url) {
  const origin = new URL(url).origin;
  if (!robotsCache.has(origin)) {
    let rules = { allow: [], disallow: [] };
    try { rules = parseRobots((await get(origin + '/robots.txt', { accept: 'text/plain' })).text); } catch { /* sin robots.txt */ }
    robotsCache.set(origin, rules);
  }
  return allowed(robotsCache.get(origin), url);
}

// ---------- Lectores ----------
const diag = Object.fromEntries(SOURCES.map(s => [s.id, { paginas: 0, enlaces: 0, leidas: 0, errores: 0, robots: 0 }]));

async function leerWP(src) {
  // Pedido liviano: 30 notas y solo foto + secciones (El Conquistador se demoraba con el pedido completo)
  const url = `${src.base}/wp-json/wp/v2/posts?per_page=30&_embed=wp:featuredmedia,wp:term&_fields=link,title,excerpt,date,date_gmt,_links,_embedded`;
  if (!(await permitido(url))) throw new Error('robots.txt no permite leer la API');
  const posts = JSON.parse((await get(url, { accept: 'application/json', timeout: 45000 })).text);
  if (!Array.isArray(posts)) throw new Error('respuesta inesperada de la API');
  const items = [];
  for (const p of posts) {
    const terms = (p._embedded?.['wp:term'] || []).flat().filter(t => t && t.taxonomy === 'category');
    const titulo = clean(p.title?.rendered);
    let cats = [...new Set(terms.map(t => src.mapCat(t.slug)).filter(Boolean))];
    if (cats.includes('podcasts') || src.esPrograma?.(titulo)) cats = ['podcasts'];
    if (!cats.length || !titulo) continue;
    const media = p._embedded?.['wp:featuredmedia']?.[0];
    const sz = media?.media_details?.sizes || {};
    items.push({
      url: p.link, titulo,
      resumen: cut(clean(p.excerpt?.rendered)),
      imagen: sz.medium_large?.source_url || sz.large?.source_url || sz.medium?.source_url || media?.source_url || '',
      fecha: p.date_gmt ? new Date(p.date_gmt + 'Z').toISOString() : new Date(p.date).toISOString(),
      cats, local: cats.includes('regional') || !!src.local && cats.includes('cultura'),
    });
  }
  return items;
}

async function leerListados(src) {
  const found = new Map();
  let leidas = 0;
  for (const pg of src.pages) {
    if (!(await permitido(pg.url))) { console.log(`  · ${pg.url}: bloqueado por robots.txt`); continue; }
    let html;
    try { html = (await get(pg.url)).text; leidas++; } catch (e) { console.log(`  · ${pg.url}: ${e.message}`); continue; }
    if (pg.cutAt) {
      const ini = Math.max(0, html.indexOf(pg.cutFrom || ''));
      const cortes = pg.cutAt.map(c => html.indexOf(c, ini)).filter(i => i > ini);
      if (cortes.length) html = html.slice(0, Math.min(...cortes));
    }
    const links = extractLinks(html, pg.url, src.linkRe);
    if (src.scanRaw) for (const m of html.replace(/\\\//g, '/').matchAll(/https?:\/\/[^\s"'<>\\]+/g)) {
      const s = m[0].replace(/^http:/, 'https:').split(/[?#]/)[0];
      if (src.linkRe.test(s) && !links.has(s)) links.set(s, { text: '', img: '' });
    }
    diag[src.id].paginas++;
    for (const [u, { text, img }] of links) {
      const cls = src.classify ? src.classify(u) : null;
      if (cls === 'skip') continue;
      const cats = new Set(Array.isArray(cls) ? cls : []);
      if (pg.cat && !(Array.isArray(cls) && cls.includes('podcasts'))) cats.add(pg.cat);
      if (!cats.size) continue;
      const e = found.get(u) || { text: '', img: '', cats: new Set(), local: false };
      if (text.length > e.text.length) e.text = text;
      if (!e.img && img && !/logo/i.test(img)) e.img = img;
      cats.forEach(c => e.cats.add(c));
      e.local ||= !!(pg.local || src.local);
      found.set(u, e);
    }
  }
  diag[src.id].enlaces = found.size;
  if (!leidas) throw new Error('no se pudo leer ninguna página');
  return found;
}

async function leerArticulo(u, e, src) {
  if (!(await permitido(u))) return null;
  const head = (await get(u)).text.slice(0, 250000);
  let titulo = meta(head, ['og:title', 'twitter:title']) ||
    clean((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '') || e.text;
  titulo = titulo.replace(/\s*[|–-]\s*(BioBioChile|TVU|Diario Concepción|Canal 9[^|]*)$/i, '').trim();
  let resumen = meta(head, ['og:description', 'description', 'twitter:description']);
  if (!resumen || resumen === titulo || (src.descGenerica || []).includes(resumen)) resumen = '';
  let imagen = meta(head, ['og:image', 'twitter:image', 'twitter:image:src']);
  try { imagen = imagen ? new URL(imagen, u).href : ''; } catch { imagen = ''; }
  if (/logo/i.test(imagen)) imagen = '';
  if (!imagen) imagen = e.img || '';
  const pub = meta(head, ['article:published_time', 'og:article:published_time', 'datePublished', 'pubdate', 'date']);
  const t = pub && !isNaN(new Date(pub)) ? new Date(pub).toISOString() : null;
  return { url: u, titulo, resumen: cut(resumen), imagen, fecha: t, cats: [...e.cats], local: e.local };
}

async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const x = list[i++]; try { await fn(x); } catch (err) { console.log(`  · ${x.u}: ${err.message}`); } }
  }));
}

// ---------- Principal ----------
async function main() {
  let prev = { items: [], fuentes: [] };
  try { prev = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* primera vez */ }
  const prevMap = new Map((prev.items || []).map(i => [i.url, i]));
  const ahora = new Date().toISOString();
  const items = new Map();
  const fuentes = [];
  const pendientes = [];

  const agregar = (it, src) => {
    const old = prevMap.get(it.url) || items.get(it.url);
    const cats = [...new Set([...(old?.cats || []), ...it.cats])].filter(c => CATS.includes(c));
    let local = cats.includes('regional') || !!(it.local || old?.local) || LOCAL_RE.test(`${it.titulo} ${it.resumen}`);
    if (local) {
      if (CULTURA_RE.test(it.titulo) && !cats.includes('cultura')) cats.push('cultura');
      if (DEPORTE_RE.test(it.titulo) && !cats.includes('deportes')) cats.push('deportes');
      if (TECNO_RE.test(it.titulo) && !cats.includes('tecnologia')) cats.push('tecnologia');
      if (POLITICA_RE.test(it.titulo) && !cats.includes('politica')) cats.push('politica');
    }
    const visto = old?.visto || ahora;
    let fecha = it.fecha || old?.fecha;
    if (!fecha) { // sin hora de publicación: usa la fecha de la URL y la hora en que se vio por primera vez
      const d = urlDate(it.url);
      fecha = d && visto.slice(0, 10) !== d ? `${d}T15:00:00.000Z` : visto;
    }
    items.set(it.url, { url: it.url, titulo: it.titulo, resumen: it.resumen || '', imagen: it.imagen || '',
      fuente: src.nombre, fuenteId: src.id, fecha, visto, cats, local });
  };

  for (const src of SOURCES) {
    console.log(`→ ${src.nombre}`);
    try {
      if (src.type === 'wp') {
        const list = await leerWP(src);
        list.forEach(it => agregar(it, src));
        fuentes.push({ id: src.id, nombre: src.nombre, url: src.home, ok: true });
        console.log(`  ${list.length} notas`);
      } else {
        const found = await leerListados(src);
        let conocidas = 0;
        for (const [u, e] of found) {
          const d = urlDate(u);
          if (d && dias(d) > maxDias([...e.cats]) + 1) continue;
          const old = prevMap.get(u);
          if (old) { agregar({ ...old, imagen: old.imagen || e.img || '', cats: [...e.cats], local: e.local || old.local }, src); conocidas++; }
          else pendientes.push({ u, e, src, d: d || '' });
        }
        fuentes.push({ id: src.id, nombre: src.nombre, url: src.home, ok: true });
        console.log(`  ${found.size} enlaces · ${conocidas} ya conocidos`);
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      fuentes.push({ id: src.id, nombre: src.nombre, url: src.home, ok: false, error: err.message });
    }
  }

  pendientes.sort((a, b) => b.d.localeCompare(a.d));
  const lote = pendientes.slice(0, MAX_NUEVAS_POR_CORRIDA);
  console.log(`→ Leyendo ${lote.length} artículos nuevos (de ${pendientes.length} pendientes)`);
  await pool(lote, 3, async p => {
    const d = diag[p.src.id];
    let it = null;
    try {
      it = await leerArticulo(p.u, p.e, p.src);
      if (it === null) { d.robots++; return; }
      d.leidas++;
    } catch (err) {
      d.errores++; d.ultimoError = `${err.message} (${p.u})`;
      // Respaldo: si la nota no se deja abrir, se usa el titular del listado
      if (p.e.text.length > 15) it = { url: p.u, titulo: p.e.text, resumen: '', imagen: p.e.img || '', fecha: null, cats: [...p.e.cats], local: p.e.local };
    }
    if (it && it.titulo) agregar(it, p.src);
  });
  for (const f of fuentes) if (diag[f.id]) f.diag = diag[f.id];

  // Conserva noticias anteriores que ya salieron de las portadas pero siguen vigentes
  for (const it of prev.items || []) if (!items.has(it.url)) items.set(it.url, { ...it, cats: (it.cats || []).filter(c => CATS.includes(c)) });

  // Limpieza: vigencia, orden y tope por categoría
  let lista = [...items.values()]
    .filter(it => it.titulo && it.local && it.cats.length && dias(it.fecha) <= maxDias(it.cats) && dias(it.fecha) > -1)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const cuenta = Object.fromEntries(CATS.map(c => [c, 0]));
  lista = lista.filter(it => {
    let keep = false;
    for (const c of it.cats) if (cuenta[c] < MAX_POR_CATEGORIA) { cuenta[c]++; keep = true; }
    return keep;
  });

  const firma = o => JSON.stringify({ i: o.items, f: (o.fuentes || []).map(f => [f.id, f.ok]) });
  const nuevo = { generado: ahora, fuentes, items: lista };
  if (prev.items?.length && firma(prev) === firma(nuevo)) { console.log('Sin cambios.'); return; }
  await fs.writeFile(OUT, JSON.stringify(nuevo, null, 1));
  console.log(`Listo: ${lista.length} noticias · ` + CATS.map(c => `${c} ${cuenta[c]}`).join(', '));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
