// api/prix-ad.js
export default async function handler(req, res) {
  const { carburant } = req.query;

  try {
    // Interrogation d'une API de flux direct (format JSON)
    const response = await fetch('https://prix-carburants-frontieres.com/api/andorra.json', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'CarburantFrontalier/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Erreur réseau (${response.status})`);
    }

    const data = await response.json();
    const fuelKey = carburant === 'e10' ? 'sp95' : carburant;
    const prix = data[fuelKey] || data['gazole'];

    if (!prix || isNaN(prix)) {
      throw new Error('Format de prix invalide');
    }

    return res.status(200).json({
      ok: true,
      cheapest: parseFloat(prix),
      station: 'Pas de la Case (Andorre)'
    });

  } catch (error) {
    // Si l'API JSON échoue, tentative via un proxy CORS
    try {
      const proxyUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent('https://www.prix-carburant.com/andorre/');
      const proxyRes = await fetch(proxyUrl);
      const proxyData = await proxyRes.json();
      
      const patterns = {
        gazole: /Gazole[^0-9]*([1-2][.,][0-9]{2,3})/i,
        sp95: /SP95[^0-9]*([1-2][.,][0-9]{2,3})/i,
        sp98: /SP98[^0-9]*([1-2][.,][0-9]{2,3})/i,
        e10: /SP95[^0-9]*([1-2][.,][0-9]{2,3})/i
      };

      const match = proxyData.contents.match(patterns[carburant] || patterns['gazole']);
      if (match && match[1]) {
        return res.status(200).json({
          ok: true,
          cheapest: parseFloat(match[1].replace(',', '.')),
          station: 'Pas de la Case (Andorre)'
        });
      }
    } catch (e) {
      // Ignorer et laisser l'erreur principale
    }

    return res.status(500).json({ ok: false, error: error.message });
  }
}
