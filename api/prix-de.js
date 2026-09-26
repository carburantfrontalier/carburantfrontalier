// api/prix-de.js
export default async function handler(req, res) {
  const { lat, lon, carburant } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ ok: false, error: 'Coordonnées manquantes' });
  }

  const apiKey = process.env.TANKERKOENIG_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'Clé API non configurée' });
  }

  // Tankerkönig accepte uniquement : diesel, e5, e10
  let typeFuel = 'diesel';
  if (carburant === 'sp98' || carburant === 'sp95') {
    typeFuel = 'e5';
  } else if (carburant === 'e10') {
    typeFuel = 'e10';
  }

  try {
    const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lon}&rad=15&sort=price&type=${typeFuel}&apikey=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok || !data.stations || data.stations.length === 0) {
      return res.status(404).json({ ok: false, error: 'Aucune station trouvée' });
    }

    // Filtrer les stations ouvertes avec un prix valide
    const validStations = data.stations.filter(s => s.isOpen && s.price > 0);

    if (validStations.length === 0) {
      return res.status(404).json({ ok: false, error: 'Aucune station ouverte dans la zone' });
    }

    // Prendre le prix le moins cher (la liste est déjà triée par prix par l'API)
    const cheapestPrice = parseFloat(validStations[0].price);

    return res.status(200).json({
      ok: true,
      cheapest: cheapestPrice,
      station: validStations[0].name || 'Kehl (Allemagne)'
    });

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
