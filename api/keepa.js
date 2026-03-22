// Keepa APIプロキシ — Vercel Serverless Function
// フロントエンドからAPIキーを隠蔽してKeepa APIにアクセス

const https = require('https');
const zlib = require('zlib');

const KEEPA_API_KEY = 'ad07ahj2ltpq4om3fs0e2iol7g1cp7eb3tr1c81u862g92k4olbe8kr7bd2r6hei';
const AMAZON_DOMAIN = 5; // Amazon.co.jp

// Keepa APIにリクエストを送る
function keepaFetch(endpoint, params) {
    return new Promise((resolve, reject) => {
        const queryParams = new URLSearchParams({ key: KEEPA_API_KEY, domain: AMAZON_DOMAIN, ...params });
        const url = `https://api.keepa.com/${endpoint}?${queryParams}`;
        const options = { headers: { 'Accept-Encoding': 'gzip, deflate' } };
        
        https.get(url, options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const encoding = res.headers['content-encoding'];
                const parse = (str) => {
                    try { resolve(JSON.parse(str)); }
                    catch (e) { reject(new Error('JSON解析エラー')); }
                };
                if (encoding === 'gzip') {
                    zlib.gunzip(buffer, (err, decoded) => err ? reject(err) : parse(decoded.toString()));
                } else if (encoding === 'deflate') {
                    zlib.inflate(buffer, (err, decoded) => err ? reject(err) : parse(decoded.toString()));
                } else {
                    parse(buffer.toString());
                }
            });
        }).on('error', reject);
    });
}

// 商品データを整形する
function formatProduct(product) {
    const stats = product.stats || {};
    const amazonPrice = stats.current?.[0] > 0 ? stats.current[0] : null;
    const newPrice = stats.current?.[1] > 0 ? stats.current[1] : null;
    const salesRank = stats.current?.[3] > 0 ? stats.current[3] : null;
    const avgAmazon = stats.avg180?.[0] > 0 ? stats.avg180[0] : null;
    const avgNew = stats.avg180?.[1] > 0 ? stats.avg180[1] : null;
    const sellingPrice = amazonPrice || newPrice || avgAmazon || avgNew;

    return {
        asin: product.asin,
        title: product.title || '(タイトル不明)',
        category: product.categoryTree?.[0]?.name || '',
        amazonPrice, newPrice, sellingPrice, avgAmazon, avgNew, salesRank,
        ean: product.eanList?.[0] || null,
        url: `https://www.amazon.co.jp/dp/${product.asin}`,
        imageUrl: product.imagesCSV
            ? `https://images-na.ssl-images-amazon.com/images/I/${product.imagesCSV.split(',')[0]}`
            : null,
    };
}

module.exports = async (req, res) => {
    // CORS対応
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const url = new URL(req.url, `https://${req.headers.host}`);
    const action = url.searchParams.get('action');

    try {
        // キーワード検索
        if (action === 'search') {
            const term = url.searchParams.get('term');
            if (!term) return res.status(400).json({ error: 'キーワードが必要です' });
            const data = await keepaFetch('search', { type: 'product', term, stats: 180, page: 0 });
            const products = (data.products || []).map(formatProduct).filter(p => p.sellingPrice);
            products.sort((a, b) => (a.salesRank || 999999) - (b.salesRank || 999999));
            return res.status(200).json({ products, tokensLeft: data.tokensLeft });
        }

        // ASIN検索
        if (action === 'lookup') {
            const asin = url.searchParams.get('asin');
            if (!asin) return res.status(400).json({ error: 'ASINが必要です' });
            const data = await keepaFetch('product', { asin, stats: 180, offers: 20 });
            const products = (data.products || []).map(formatProduct);
            return res.status(200).json({ products, tokensLeft: data.tokensLeft });
        }

        // トークン残量チェック
        if (action === 'tokens') {
            const data = await keepaFetch('token', {});
            return res.status(200).json({ tokensLeft: data.tokensLeft });
        }

        return res.status(400).json({ error: '不明なアクション', usage: '?action=search&term=xxx or ?action=lookup&asin=xxx' });
    } catch (err) {
        console.error('Keepa API Error:', err);
        return res.status(500).json({ error: err.message || 'サーバーエラー' });
    }
};
