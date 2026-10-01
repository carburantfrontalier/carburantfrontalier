// /api/station-frontiere.js
// Trouve, depuis n'importe quelle adresse, la station étrangère (ES ou IT)
// la plus proche par la route. Aucune ville/frontière en dur : on utilise
// les coordonnées GPS de TOUTES les stations des sources officielles.
//
// Appel : /api/station-frontiere?lat=43.49&lon=-1.47&carburant=gazole
// carburant : gazole | sp95 | sp95e10 | sp98 | gpl

const MAX_RAYON_KM = 250;      // au-delà : on dit honnêtement "rien trouvé"
const NB_CANDIDATES = 8;       // stations testées par OSRM (1 seul appel)
const PRIX_MIN = 1.0, PRIX_MAX = 2.3; // filtre anti-aberrations
const CACHE_MS = 3 * 60 * 60 * 1000;  // 3 h

const ES_URL =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
const IT_PRIX = 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';
const IT_STATIONS = 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';

const ES_CHAMP = {
  gazole: 'Precio Gasoleo A',
  sp95: 'Precio Gasolina 95 E5',
  sp95e10: 'Precio Gasolina 95 E10',
  sp98: 'Precio Gasolina 98 E5',
  gpl: 'Precio Gases licuados del petróleo',
};
const IT_CHAMP = {
  gazole: 'Gasolio',
  sp95: 'Benzina',
  sp95e10: 'Benzina',
  gpl: 'GPL',
  // sp98 : pas de source fiable côté IT -> non disponible
};

let cache = { es: null, it: null };

const num = (s) => {
  if (s == null || s === '') return NaN;
  return parseFloat(String(s).replace(',', '.'));
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- Espagne ----------
async function chargerES() {
  if (cache.es && Date.now() - cache.es.t < CACHE_MS) return cache.es.data;
  const r = await fetch(ES_URL, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Source Espagne indisponible (' + r.status + ')');
  const j = await r.json();
  const data = (j.ListaEESSPrecio || []).map((s) => ({
    pays: 'ES',
    nom: s['Rótulo'] || 'Station',
    lieu: s['Municipio'] || s['Localidad'] || '',
    adresse: [s['Dirección'], s['C.P.'], s['Municipio']].filter(Boolean).join(', '),
    lat: num(s['Latitud']),
    lon: num(s['Longitud (WGS84)']),
    prix: Object.fromEntries(
      Object.entries(ES_CHAMP).map(([k, champ]) => [k, num(s[champ])])
    ),
  }));
  cache.es = { t: Date.now(), data };
  return data;
}

// ---------- Italie ----------
function parseCsvIT(texte) {
  const lignes = texte.split(/\r?\n/);
  // la 1re ligne est "Estrazione del ..." : on cherche l'en-tête réel
  const iHeader = lignes.findIndex((l) => /idImpianto/i.test(l));
  if (iHeader < 0) return [];
  const cols = lignes[iHeader].split(';').map((c) => c.trim());
  return lignes.slice(iHeader + 1).filter(Boolean).map((l) => {
    const v = l.split(';');
    const o = {};
    cols.forEach((c, i) => (o[c] = (v[i] || '').trim()));
    return o;
  });
}

async function chargerIT() {
  if (cache.it && Date.now() - cache.it.t < CACHE_MS) return cache.it.data;
  const [rp, rs] = await Promise.all([fetch(IT_PRIX), fetch(IT_STATIONS)]);
  if (!rp.ok || !rs.ok) throw new Error('Source Italie indisponible');
  const prix = parseCsvIT(await rp.text());
  const stations = parseCsvIT(await rs.text());

  // meilleur prix "self" sinon "servito", par station et par carburant
  const parStation = {};
  for (const p of prix) {
    const id = p['idImpianto'];
    const val = num(p['prezzo']);
    if (!id || isNaN(val)) continue;
    (parStation[id] = parStation[id] || []).push({
      carb: p['descCarburante'],
      val,
      self: p['isSelf'] === '1',
    });
  }
  const data = stations.map((s) => {
    const liste = parStation[s['idImpianto']] || [];
    const prixSt = {};
    for (const [k, champ] of Object.entries(IT_CHAMP)) {
      const c = liste.filter((x) => x.carb === champ);
      const self = c.filter((x) => x.self);
      const pool = self.length ? self : c;
      prixSt[k] = pool.length ? Math.min(...pool.map((x) => x.val)) : NaN;
    }
    return {
      pays: 'IT',
      nom: s['Bandiera'] || s['Nome Impianto'] || 'Stazione',
      lieu: s['Comune'] || '',
      adresse: [s['Indirizzo'], s['Comune']].filter(Boolean).join(', '),
      lat: num(s['Latitudine']),
      lon: num(s['Longitudine']),
      prix: prixSt,
    };
  });
  cache.it = { t: Date.now(), data };
  return data;
}

// ---------- Handler ----------
module.exports = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const carburant = String(req.query.carburant || 'gazole').toLowerCase();
    if (isNaN(lat) || isNaN(lon) || !ES_CHAMP[carburant]) {
      return res.status(400).json({ erreur: 'Paramètres invalides (lat, lon, carburant)' });
    }

    // On charge chaque pays séparément : si l'un échoue, on le dit.
    const sources = await Promise.allSettled([chargerES(), chargerIT()]);
    const erreurs = [];
    let stations = [];
    ['Espagne', 'Italie'].forEach((nom, i) => {
      if (sources[i].status === 'fulfilled') stations = stations.concat(sources[i].value);
      else erreurs.push(nom + ' : ' + sources[i].reason.message);
    });

    // 1) Stations valides (coordonnées + prix plausible), dans le rayon max
    const proches = stations
      .filter((s) => {
        const p = s.prix[carburant];
        return (
          !isNaN(s.lat) && !isNaN(s.lon) && !isNaN(p) && p >= PRIX_MIN && p <= PRIX_MAX
        );
      })
      .map((s) => ({ ...s, vol: haversineKm(lat, lon, s.lat, s.lon) }))
      .filter((s) => s.vol <= MAX_RAYON_KM)
      .sort((a, b) => a.vol - b.vol)
      .slice(0, NB_CANDIDATES);

    if (!proches.length) {
      return res.status(200).json({
        trouve: false,
        message: 'Aucune station étrangère avec prix trouvée à moins de ' + MAX_RAYON_KM + ' km.',
        erreurs,
      });
    }

    // 2) Distance routière réelle vers les candidats (1 seul appel OSRM)
    //    -> évite le piège "proche à vol d'oiseau mais de l'autre côté d'une montagne"
    let best = null;
    try {
      const coords = [[lon, lat], ...proches.map((s) => [s.lon, s.lat])]
        .map((c) => c.join(','))
        .join(';');
      const url =
        'https://router.project-osrm.org/table/v1/driving/' +
        coords +
        '?sources=0&annotations=distance,duration';
      const r = await fetch(url);
      const j = await r.json();
      if (j.code === 'Ok') {
        proches.forEach((s, i) => {
          s.routeKm = j.distances[0][i + 1] / 1000;
          s.routeMin = j.durations[0][i + 1] / 60;
        });
        best = proches
          .filter((s) => s.routeKm != null && !isNaN(s.routeKm))
          .sort((a, b) => a.routeKm - b.routeKm)[0];
      }
    } catch (e) {
      erreurs.push('OSRM : ' + e.message);
    }
    if (!best) {
      // repli explicite : on ne triche pas, on le signale
      best = proches[0];
      best.routeKm = null;
      erreurs.push('Distance routière indisponible : station choisie à vol d\'oiseau.');
    }

    // Les 3 stations les moins chères dans un rayon de 10 km autour de la station retenue
    const top3 = stations
      .filter((s) => {
        const p = s.prix[carburant];
        return (
          s.pays === best.pays && !isNaN(s.lat) && !isNaN(s.lon) &&
          !isNaN(p) && p >= PRIX_MIN && p <= PRIX_MAX &&
          haversineKm(best.lat, best.lon, s.lat, s.lon) <= 10
        );
      })
      .sort((a, b) => a.prix[carburant] - b.prix[carburant])
      .slice(0, 3)
      .map((s) => ({ nom: s.nom, adresse: s.adresse, prix: s.prix[carburant] }));

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    return res.status(200).json({
      trouve: true,
      carburant,
      station: {
        pays: best.pays,
        nom: best.nom,
        lieu: best.lieu,
        adresse: best.adresse,
        lat: best.lat,
        lon: best.lon,
        prixLitre: best.prix[carburant],
      },
      trajet: {
        aSimpleKm: best.routeKm != null ? Math.round(best.routeKm * 10) / 10 : null,
        allerRetourKm: best.routeKm != null ? Math.round(best.routeKm * 2 * 10) / 10 : null,
        dureeSimpleMin: best.routeMin != null ? Math.round(best.routeMin) : null,
        volOiseauKm: Math.round(best.vol * 10) / 10,
      },
      top3,
      erreurs,
    });
  } catch (e) {
    return res.status(500).json({ erreur: e.message });
  }
};
