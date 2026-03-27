/**
 * eBay Browse API プロキシ — Vercel Serverless Function
 * 商品検索と為替レート取得を提供する
 */

// キャッシュ
let tokenCache = { token: '', expiresAt: 0 };
let rateCache = { rate: 0, expiresAt: 0 };
let translateCache = {}; // 翻訳キャッシュ

/**
 * 日本語を含むか判定
 */
function containsJapanese(text) {
  return /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(text);
}

/**
 * 日本語→英語に翻訳（MyMemory Translation API、無料）
 */
async function translateToEnglish(text) {
  if (translateCache[text]) return translateCache[text];
  
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ja|en`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json();
      const translated = data.responseData?.translatedText || text;
      translateCache[text] = translated;
      return translated;
    }
  } catch (e) {
    console.error('翻訳失敗:', e.message);
  }
  return text; // 失敗時はそのまま
}

/**
 * eBay OAuth2.0 アクセストークンを取得
 */
async function getEbayToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 300000) {
    return tokenCache.token;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('eBay API認証情報が未設定');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth失敗 (${res.status}): ${err}`);
  }

  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

/**
 * USD/JPY為替レートを取得
 */
async function getExchangeRate() {
  if (rateCache.rate && Date.now() < rateCache.expiresAt) {
    return rateCache.rate;
  }

  try {
    // 無料APIで為替レート取得
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const rate = data.rates?.JPY || 150;
      rateCache = { rate, expiresAt: Date.now() + 3600000 }; // 1時間キャッシュ
      return rate;
    }
  } catch (e) {
    console.error('為替レート取得失敗:', e.message);
  }
  return rateCache.rate || 150; // フォールバック
}

/**
 * eBay Browse APIで商品検索
 */
async function searchEbay(keyword, options = {}) {
  const { limit = 30, sort = 'price', marketplace = 'EBAY_US', minPrice, maxPrice } = options;
  const token = await getEbayToken();

  const params = new URLSearchParams({ q: keyword, limit: String(Math.min(limit, 200)) });

  // フィルター構築
  const filters = ['buyingOptions:{FIXED_PRICE|AUCTION}'];
  if (minPrice) filters.push(`price:[${minPrice}..],priceCurrency:USD`);
  if (maxPrice) filters.push(`price:[..${maxPrice}],priceCurrency:USD`);
  if (filters.length) params.set('filter', filters.join(','));
  if (sort) params.set('sort', sort);

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`;

  let res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
    },
    signal: AbortSignal.timeout(15000),
  });

  // トークン期限切れ → 再取得してリトライ
  if (res.status === 401) {
    tokenCache = { token: '', expiresAt: 0 };
    const newToken = await getEbayToken();
    res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'X-EBAY-C-MARKETPLACE-ID': marketplace,
      },
      signal: AbortSignal.timeout(15000),
    });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`eBay検索失敗 (${res.status}): ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const items = (data.itemSummaries || []).map(item => {
    const price = parseFloat(item.price?.value || '0');
    const currency = item.price?.currency || 'USD';
    let shippingCost = null;
    let shippingText = '';
    if (item.shippingOptions?.[0]?.shippingCost) {
      shippingCost = parseFloat(item.shippingOptions[0].shippingCost.value || '0');
      shippingText = shippingCost === 0 ? 'Free Shipping' : `+$${shippingCost.toFixed(2)}`;
    }

    return {
      title: item.title || '',
      price,
      currency,
      imageUrl: (item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl || '').replace(/s-l\d+/, 's-l500'),
      url: item.itemWebUrl || '',
      condition: item.condition || '',
      location: item.itemLocation?.country || '',
      seller: item.seller?.username || '',
      shippingCost,
      shippingText,
      itemId: item.itemId || '',
    };
  }).filter(i => i.title && i.price > 0);

  return { items, total: data.total || items.length };
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, keyword, limit, sort, marketplace, minPrice, maxPrice } = req.query;

    // 為替レート取得
    if (action === 'rate') {
      const rate = await getExchangeRate();
      return res.json({ rate });
    }

    // eBay検索
    if (!keyword) return res.status(400).json({ error: 'キーワードが必要です' });

    // 日本語キーワードを自動翻訳
    let searchKeyword = keyword;
    let translatedFrom = null;
    if (containsJapanese(keyword)) {
      searchKeyword = await translateToEnglish(keyword);
      translatedFrom = keyword;
      console.log(`🌐 翻訳: "${keyword}" → "${searchKeyword}"`);
    }

    const result = await searchEbay(searchKeyword, {
      limit: parseInt(limit) || 30,
      sort: sort || 'price',
      marketplace: marketplace || 'EBAY_US',
      minPrice,
      maxPrice,
    });

    const rate = await getExchangeRate();
    return res.json({ 
      ...result, 
      exchangeRate: rate,
      searchKeyword,
      translatedFrom,
    });

  } catch (err) {
    console.error('eBay API エラー:', err);
    return res.status(500).json({ error: err.message });
  }
};
