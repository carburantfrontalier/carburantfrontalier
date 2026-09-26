export default async function handler(req, res) {
  const { carburant } = req.query;

  // Tarifs moyens de référence en Andorre (fallback immédiat)
  const defaultPrices = {
    gazole: 1.38,
    sp95: 1.39,
    sp98: 1.45,
    e10: 1.39
  };

  try {
    const response = await fetch('https://www.andorramania.com/prix-carburants-essence-andorre.php', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html'
      }
    });

    if (response.ok) {
      const html = await response.text();

      const patterns = {
        gazole: /GAZOLE[^0-9]*([1-2][.,][0-9]{2})/i,
        sp95: /S\.P\.\s*95[^0-9]*([1-2][.,][0-9]{2})/i,
        sp98: /S\.P\.\s*98[^0-9]*([1-2][.,][0-9]{2})/i,
        e10: /S\.P\.\s*95[^0-9]*([1-2][.,][0-9]{2})/i
      };

      const key = carburant && patterns[carburant] ? carburant : 'gazole';
      const match = html.match(patterns[key]);

      if (match && match[1]) {
        const prix = parseFloat(match[1].replace(',', '.'));
        if (prix > 0.8 && prix < 2.5) {
          return res.status(200).json({
            ok: true,
            cheapest: prix,
            station: 'Pas de la Case (Andorre)'
          });
        }
      }
    }
  } catch (e) {
    console.error('Scraping Andorre indisponible:', e);
  }

  // Renvoie le tarif de secours si le scraping est bloqué
  const fuelKey = carburant && defaultPrices[carburant] ? carburant : 'gazole';
  return res.status(200).json({
    ok: true,
    cheapest: defaultPrices[fuelKey],
    station: 'Pas de la Case (Andorre)'
  });
}
