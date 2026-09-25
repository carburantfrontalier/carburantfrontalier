// Fonction serverless Vercel : prix carburants réels en Espagne pour une localité
// donnée, via l'API officielle du Ministerio para la Transición Ecológica.
// Zéro donnée en dur : tout vient de l'API, filtré et trié.
// Appelée via /api/prix-es?municipio=Jonquera&carburant=gazole

export default async function handler(req, res) {
  const municipio = (req.query.municipio || 'Jonquera').toLowerCase();
  const carburant = (req.query.carburant || 'gazole').toLowerCase(); // gazole | sp95 uniquement dispo

  const champMap = {
    gazole: 'Precio Gasoleo A',
    sp95: 'Precio Gasolina 95 E5'
  };
  const champ = champMap[carburant];
  if (!champ) {
    res.status(200).json({ ok: false, error: 'carburant_non_disponible' });
    return;
  }

  try {
    const r = await fetch(
      'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/',
      { headers: { 'Accept': 'application/json' } }
    );
    if (!r.ok) throw new Error('upstream_' + r.status);
    const data = await r.json();
    const todas = data.ListaEESSPrecio || [];
    const stations = todas.filter(s => (s.Municipio || '').toLowerCase().includes(municipio));

    function parsePrix(v) {
      if (!v) return NaN;
      return parseFloat(String(v).replace(',', '.'));
    }

    const valides = stations
      .map(s => ({
        prix: parsePrix(s[champ]),
        rotulo: s['Rótulo'] || s.Rotulo || '',
        direccion: s['Dirección'] || s.Direccion || ''
      }))
      .filter(s => !isNaN(s.prix) && s.prix >= 1.00 && s.prix <= 2.30)
      .sort((a, b) => a.prix - b.prix);

    if (valides.length === 0) {
      res.status(200).json({ ok: false, error: 'no_data' });
      return;
    }

    const moyenne = +(valides.reduce((a, b) => a + b.prix, 0) / valides.length).toFixed(3);

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.status(200).json({
      ok: true,
      municipio,
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
