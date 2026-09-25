// Fonction serverless Vercel : prix carburants réels en Italie pour une commune
// donnée, via les fichiers CSV officiels quotidiens du MIMIT (Ministero delle
// Imprese e del Made in Italy) : anagrafica des stations + prix du jour.
// Zéro donnée en dur : tout vient des fichiers officiels, filtré et trié.
// Appelée via /api/prix-it?comune=Ventimiglia&carburant=gazole

export default async function handler(req, res) {
  const comune = (req.query.comune || 'Ventimiglia').toLowerCase();
  const carburant = (req.query.carburant || 'gazole').toLowerCase();

  const carburantMap = {
    gazole: 'gasolio',
    sp95: 'benzina',
    gplc: 'gpl'
  };
  const descCible = carburantMap[carburant];
  if (!descCible) {
    res.status(200).json({ ok: false, error: 'carburant_non_disponible' });
    return;
  }

  function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const header = lines[0].split('|').map(h => h.trim());
    const idx = {};
    header.forEach((h, i) => { idx[h.toLowerCase()] = i; });
    const rows = lines.slice(1).map(l => l.split('|'));
    return { idx, rows };
  }

  try {
    const [rAna, rPrezzo] = await Promise.all([
      fetch('https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv'),
      fetch('https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv')
    ]);
    if (!rAna.ok || !rPrezzo.ok) throw new Error('upstream_error');

    const anaText = await rAna.text();
    const prezzoText = await rPrezzo.text();

    const ana = parseCSV(anaText);
    const iId = ana.idx['idimpianto'];
    const iComune = ana.idx['comune'];
    const iIndirizzo = ana.idx['indirizzo'];

    const idsRetenus = new Map();
    ana.rows.forEach(r => {
      const c = (r[iComune] || '').trim().toLowerCase();
      if (c.includes(comune)) {
        idsRetenus.set((r[iId] || '').trim(), { comune: r[iComune], indirizzo: r[iIndirizzo] });
      }
    });

    if (idsRetenus.size === 0) {
      res.status(200).json({ ok: false, error: 'commune_inconnue' });
      return;
    }

    const prz = parseCSV(prezzoText);
    const pId = prz.idx['idimpianto'];
    const pDesc = prz.idx['desccarburante'];
    const pPrezzo = prz.idx['prezzo'];

    const valides = [];
    prz.rows.forEach(r => {
      const id = (r[pId] || '').trim();
      if (!idsRetenus.has(id)) return;
      const desc = (r[pDesc] || '').trim().toLowerCase();
      if (desc !== descCible) return;
      const prixNum = parseFloat((r[pPrezzo] || '').replace(',', '.'));
      if (isNaN(prixNum) || prixNum < 1.00 || prixNum > 2.30) return;
      const info = idsRetenus.get(id);
      valides.push({ prix: prixNum, comune: info.comune, indirizzo: info.indirizzo });
    });

    if (valides.length === 0) {
      res.status(200).json({ ok: false, error: 'no_data' });
      return;
    }

    valides.sort((a, b) => a.prix - b.prix);
    const moyenne = +(valides.reduce((a, b) => a + b.prix, 0) / valides.length).toFixed(3);

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      ok: true,
      comune,
      carburant,
      moyenne,
      cheapest: valides[0].prix,
      stationsCount: valides.length,
      top3: valides.slice(0, 3),
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: 'fetch_failed' });
  }
}
