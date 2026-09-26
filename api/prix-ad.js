export default async function handler(req, res) {
  const { carburant } = req.query;

  try {
    const response = await fetch('https://www.carburani.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) throw new Error('Source indisponible');

    const html = await response.text();
    const patterns = {
      gazole: /Gazole[^0-9]*([0-9]+[.,][0-9]{2,3})/i,
      sp95: /SP95[^0-9]*([0-9]+[.,][0-9]{2,3})/i,
      sp98: /SP98[^0-9]*([0-9]+[.,][0-9]{2,3})/i,
      e10: /SP95[^0-9]*([0-9]+[.,][0-9]{2,3})/i
    };

    const targetPattern = patterns[carburant] || patterns['gazole'];
    const match = html.match(targetPattern);

    if (!match || !match[1]) {
      return res.status(404).json({ ok: false, error: 'Prix introuvable' });
    }

    return res.status(200).json({
      ok: true,
      cheapest: parseFloat(match[1].replace(',', '.'))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
