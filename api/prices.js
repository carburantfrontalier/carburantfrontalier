// Fonction serverless Vercel : prix carburants réels en France autour d'un point,
// via l'API officielle data.economie.gouv.fr (flux instantané, MAJ toutes les 10 min).
// Zéro donnée en dur : tout vient de l'API, filtré et trié.
// Appelée via /api/prix-fr?lat=...&lon=...&rayon=20&carburant=gazole

export default async function handler(req, res) {
  const latitude = parseFloat(req.query.lat);
  const longitude = parseFloat(req.query.lon);
  const rayon = parseFloat(req.query.rayon) || 20;
  const carburant = (req.query.carburant || 'gazole').toLowerCase(); // gazole | sp95 | sp98 | e10 | gplc

  if (isNaN(latitude) || isNaN(longitude)) {
    res.status(200).json({ ok: false, error: 'missing_coordinates' });
    return;
  }

  const champPrix = carburant + '_prix';
  const where = encodeURIComponent(
    `within_distance(geom, GEOM'POINT(${longitude} ${latitude})', ${rayon}km) AND ${champPrix} IS NOT NULL`
  );
  const orderBy = encodeURIComponent(`${champPrix} asc`);
  const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?where=${where}&order_by=${orderBy}&limit=50`;

  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('upstream_' + r.status);
    const data = await r.json();
    const results = data.results || [];

    const valides = results.filter(rec => {
      const p = parseFloat(rec[champPrix]);
      return !isNaN(p) && p >= 1.00 && p <= 2.30;
    });

    if (valides.length === 0) {
      res.status(200).json({ ok: false, error: 'no_data' });
      return;
    }

    const prix = valides.map(rec => parseFloat(rec[champPrix]));
    const moyenne = +(prix.reduce((a, b) => a + b, 0) / prix.length).toFixed(3);

    const top3 = valides.slice(0, 3).map(rec => ({
      prix: parseFloat(rec[champPrix]),
      adresse: rec.adresse || rec.Adresse || '',
      ville: rec.ville || rec.Ville || rec.com_ncc || '',
      cp: rec.cp || rec.Code_postal || ''
    }));

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.status(200).json({
      ok: true,
      carburant,
      moyenne,
      stationsCount: valides.length,
      top3,
      rayon,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: 'fetch_failed' });
  }
}
