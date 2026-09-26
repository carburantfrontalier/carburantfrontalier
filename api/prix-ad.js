// api/prix-ad.js
export default async function handler(req, res) {
  const { carburant } = req.query;

  try {
    // 1. Tentative de scraping sur la source principale
    const response = await fetch('https://www.carburandorre.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
      }
    });

    if (response.ok) {
      const html = await response.text();

      const patterns = {
        gazole: /(?:gazole|diesel)[^0-9]*([1-2][.,][0-9]{2,3})/i,
        sp95: /(?:sp95|sans plomb 95)[^0-9]*([1-2][.,][0-9]{2,3})/i,
        sp98: /(?:sp98|sans plomb 98)[^0-9]*([1-2][.,][0-9]{2,3})/i,
        e10: /(?:sp95|e10)[^0-9]*([1-2][.,][0-9]{2,3})/i
      };

      const pattern = patterns[carburant] || patterns['gazole'];
      const match = html.match(pattern);

      if (match && match[1]) {
        const prixScrape = parseFloat(match[1].replace(',', '.'));
        if (prixScrape > 0.8 && prixScrape < 2.5) {
          return res.status(200).json({
            ok: true,
            cheapest: prixScrape,
            station: 'Pas de la Case (Andorre)'
          });
        }
      }
    }

    // 2. Fallback de secours sur une API miroir si le scraping échoue
    const fallbackResponse = await fetch('https://api.carburants-andorre.fr/latest');
    if (fallbackResponse.ok) {
      const data = await fallbackResponse.json();
      const fuelKey = carburant === 'e10' ? 'sp95' : carburant;
      if (data && data[fuelKey]) {
        return res.status(200).json({
          ok: true,
          cheapest: parseFloat(data[fuelKey]),
          station: 'Pas de la Case (Andorre)'
        });
      }
    }

    throw new Error('Aucune source n\'a pu fournir les prix');

  } catch (error) {
    // En cas d'échec total des requêtes réseau
    return res.status(500).json({ ok: false, error: error.message });
  }
}
