// NETSEA APIプロキシ — Vercel Serverless Function
// NETSEAバイヤーAPIにアクセスし、商品情報を取得・Amazon価格と比較

const https = require('https');
const zlib = require('zlib');

// 環境変数から取得（Vercelのダッシュボードで設定）
const NETSEA_TOKEN = process.env.NETSEA_TOKEN || '';
const KEEPA_API_KEY = process.env.KEEPA_API_KEY || 'ad07ahj2ltpq4om3fs0e2iol7g1cp7eb3tr1c81u862g92k4olbe8kr7bd2r6hei';
const NETSEA_API_BASE = 'https://api.netsea.jp/buyer/v1';
const AMAZON_DOMAIN = 5; // Amazon.co.jp

// ===== NETSEA APIリクエスト（POST/GET両対応） =====
function netseaFetch(endpoint, params = {}, method = 'POST') {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(`${NETSEA_API_BASE}${endpoint}`);
        const postData = method === 'POST' ? JSON.stringify(params) : '';

        // GETの場合はクエリパラメータに追加
        if (method === 'GET') {
            Object.entries(params).forEach(([k, v]) => urlObj.searchParams.set(k, v));
        }

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: {
                'Authorization': `Bearer ${NETSEA_TOKEN}`,
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
            },
        };

        // POSTの場合はContent-Typeを設定
        if (method === 'POST') {
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const encoding = res.headers['content-encoding'];
                const parse = (str) => {
                    try {
                        const json = JSON.parse(str);
                        if (json.error) {
                            reject(new Error(`NETSEA API [${res.statusCode}]: ${typeof json.error === 'string' ? json.error : (json.error.message || JSON.stringify(json.error))}`));
                        } else {
                            resolve(json);
                        }
                    } catch (e) {
                        reject(new Error(`JSON解析エラー [${res.statusCode}]: ${str.substring(0, 300)}`));
                    }
                };
                if (encoding === 'gzip') {
                    zlib.gunzip(buffer, (err, decoded) => err ? reject(err) : parse(decoded.toString()));
                } else if (encoding === 'deflate') {
                    zlib.inflate(buffer, (err, decoded) => err ? reject(err) : parse(decoded.toString()));
                } else {
                    parse(buffer.toString());
                }
            });
        });

        req.on('error', reject);

        // POSTの場合はボディを送信
        if (method === 'POST') {
            req.write(postData);
        }
        req.end();
    });
}

// ===== Keepa APIリクエスト（Amazon価格取得用） =====
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

// ===== Keepa商品情報を整形 =====
function formatKeepaProduct(product) {
    const stats = product.stats || {};
    const amazonPrice = stats.current?.[0] > 0 ? stats.current[0] : null;
    const newPrice = stats.current?.[1] > 0 ? stats.current[1] : null;
    const salesRank = stats.current?.[3] > 0 ? stats.current[3] : null;
    return {
        amazonPrice,
        newPrice,
        sellingPrice: amazonPrice || newPrice || null,
        salesRank,
    };
}

// ===== モックデータ（トークン未設定時のデモ用） =====
function getMockCategories() {
    return [
        { id: 1, name: '食品・飲料' },
        { id: 2, name: '美容・コスメ' },
        { id: 3, name: '日用品・雑貨' },
        { id: 4, name: 'ファッション' },
        { id: 5, name: 'アクセサリー' },
        { id: 6, name: 'キッチン用品' },
        { id: 7, name: 'インテリア' },
        { id: 8, name: 'ペット用品' },
        { id: 9, name: 'ベビー・キッズ' },
        { id: 10, name: 'スポーツ・アウトドア' },
    ];
}

function getMockItems(keyword, category, page) {
    // デモ用のサンプル商品データ
    const mockProducts = [
        { id: 1001, name: 'オーガニック ハンドソープ 250ml', wholesale_price: 380, retail_price: 980, supplier: 'ナチュラルコスメ工房', image: null, jan: '4901301729286', category: '日用品・雑貨' },
        { id: 1002, name: 'プレミアム フェイスパック 10枚入', wholesale_price: 450, retail_price: 1280, supplier: 'ビューティーラボ', image: null, jan: '4902508083010', category: '美容・コスメ' },
        { id: 1003, name: 'ステンレス 真空断熱タンブラー 450ml', wholesale_price: 650, retail_price: 1980, supplier: 'メタルクラフト', image: null, jan: '4549292157468', category: 'キッチン用品' },
        { id: 1004, name: 'アロマ ディフューザー ミスト式', wholesale_price: 1200, retail_price: 3500, supplier: 'リラクゼーション本舗', image: null, jan: '4571234567890', category: 'インテリア' },
        { id: 1005, name: 'スマホ用 防水ケース IPX8対応', wholesale_price: 280, retail_price: 890, supplier: 'テックアクセサリーズ', image: null, jan: '4580000000001', category: 'アクセサリー' },
        { id: 1006, name: 'エコバッグ 折りたたみ コンパクト', wholesale_price: 150, retail_price: 590, supplier: 'エコライフ', image: null, jan: '4580000000002', category: '日用品・雑貨' },
        { id: 1007, name: 'プロテインバー チョコ味 12本入', wholesale_price: 980, retail_price: 2400, supplier: 'フィットネスフーズ', image: null, jan: '4580000000003', category: '食品・飲料' },
        { id: 1008, name: 'LEDデスクライト 調光3段階', wholesale_price: 890, retail_price: 2680, supplier: 'ライトニング', image: null, jan: '4580000000004', category: 'インテリア' },
        { id: 1009, name: 'ペット用 自動給水器 1.5L', wholesale_price: 720, retail_price: 2180, supplier: 'ペットパラダイス', image: null, jan: '4580000000005', category: 'ペット用品' },
        { id: 1010, name: 'シリコン 調理スプーン 5本セット', wholesale_price: 350, retail_price: 1200, supplier: 'キッチンツールズ', image: null, jan: '4580000000006', category: 'キッチン用品' },
    ];

    let filtered = mockProducts;
    if (keyword) {
        const kw = keyword.toLowerCase();
        filtered = filtered.filter(p => p.name.toLowerCase().includes(kw) || p.category.toLowerCase().includes(kw));
    }
    if (category) {
        filtered = filtered.filter(p => p.category === category);
    }
    return {
        items: filtered,
        total: filtered.length,
        isMock: true,
    };
}

// ===== メインハンドラー =====
module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const url = new URL(req.url, `https://${req.headers.host}`);
    const action = url.searchParams.get('action');
    const useMock = !NETSEA_TOKEN;

    try {
        // ===== カテゴリ一覧 =====
        if (action === 'categories') {
            if (useMock) {
                return res.status(200).json({ categories: getMockCategories(), isMock: true });
            }
            // GETで試行、失敗時POSTにフォールバック
            let data;
            try {
                data = await netseaFetch('/categories', {}, 'GET');
            } catch (e) {
                data = await netseaFetch('/categories', {}, 'POST');
            }
            return res.status(200).json({ categories: data.categories || data, isMock: false });
        }

        // ===== 商品検索（supplier_ids必須） =====
        if (action === 'items') {
            const supplierId = url.searchParams.get('supplier_id') || '';
            const categoryId = url.searchParams.get('category') || '';
            const minPrice = url.searchParams.get('minPrice') || '';
            const maxPrice = url.searchParams.get('maxPrice') || '';
            const nextItemId = url.searchParams.get('next_id') || '';

            if (useMock) {
                const keyword = url.searchParams.get('keyword') || '';
                const mockData = getMockItems(keyword, categoryId);
                return res.status(200).json({ ...mockData, isMock: true });
            }

            if (!supplierId) {
                return res.status(400).json({ error: 'サプライヤーを選択してください' });
            }

            // NETSEA API パラメータ（supplier_ids必須）
            const params = {
                supplier_ids: [parseInt(supplierId)],
            };
            if (categoryId) params.categories = [parseInt(categoryId)];
            if (minPrice) params.price_range_from = parseInt(minPrice);
            if (maxPrice) params.price_range_to = parseInt(maxPrice);
            if (nextItemId) params.next_direct_item_id = parseInt(nextItemId);

            const data = await netseaFetch('/items', params, 'POST');
            const items = (data.items || []).map(item => ({
                id: item.direct_item_id || item.id,
                name: item.item_name || item.name || '',
                wholesale_price: item.price || 0,
                retail_price: item.msrp || item.retail_price || 0,
                supplier: item.supplier_name || '',
                image: item.image_url || item.main_image_url || null,
                jan: item.jan_code || item.branch_code || '',
                category: item.category_name || '',
                min_lot: item.min_lot || 1,
            }));

            return res.status(200).json({
                items,
                total: data.total || items.length,
                nextId: data.next_direct_item_id || null,
                isMock: false,
            });
        }

        // ===== 承認済みサプライヤー商品スキャン =====
        if (action === 'scan') {
            if (useMock) {
                return res.status(200).json({ items: [], total: 0, message: 'デモモード - NETSEAトークン設定後に利用可能' });
            }

            // サプライヤー一覧を取得
            let suppliers = [];
            let rawSupplierData = null;
            try {
                let sData;
                try { sData = await netseaFetch('/suppliers', {}, 'GET'); }
                catch (e) { sData = await netseaFetch('/suppliers', {}, 'POST'); }
                rawSupplierData = sData;
                const raw = sData.suppliers || sData.data || sData;
                suppliers = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
            } catch (e) {
                return res.status(200).json({ items: [], total: 0, message: 'サプライヤー取得エラー: ' + e.message });
            }

            if (suppliers.length === 0) {
                // デバッグ: APIが返した生データを含める
                return res.status(200).json({
                    items: [], total: 0,
                    message: '承認済みサプライヤーが0件です',
                    debug: {
                        rawKeys: rawSupplierData ? Object.keys(rawSupplierData) : [],
                        rawSample: rawSupplierData ? JSON.stringify(rawSupplierData).substring(0, 500) : 'null',
                    }
                });
            }

            // 全サプライヤーの商品を取得
            const allItems = [];
            const debugInfo = { approved: [], denied: 0, rawSamples: [] };

            const delay = (ms) => new Promise(r => setTimeout(r, ms));

            // x-www-form-urlencoded形式でNETSEA APIにリクエスト
            function netseaRawFetch(endpoint, params) {
                return new Promise((resolve, reject) => {
                    const urlObj = new URL(`${NETSEA_API_BASE}${endpoint}`);
                    // URLSearchParams形式でボディを作成
                    const formParams = new URLSearchParams();
                    Object.entries(params).forEach(([k, v]) => {
                        formParams.append(k, Array.isArray(v) ? v.join(',') : v);
                    });
                    const postData = formParams.toString();
                    const options = {
                        hostname: urlObj.hostname,
                        path: urlObj.pathname + urlObj.search,
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${NETSEA_TOKEN}`,
                            'Accept': 'application/json',
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Content-Length': Buffer.byteLength(postData),
                        },
                    };
                    const req = https.request(options, (res) => {
                        const chunks = [];
                        res.on('data', chunk => chunks.push(chunk));
                        res.on('end', () => {
                            const buffer = Buffer.concat(chunks);
                            const encoding = res.headers['content-encoding'];
                            const parse = (str) => {
                                try { resolve({ status: res.statusCode, body: JSON.parse(str), raw: str.substring(0, 300) }); }
                                catch (e) { resolve({ status: res.statusCode, body: null, raw: str.substring(0, 300) }); }
                            };
                            if (encoding === 'gzip') {
                                zlib.gunzip(buffer, (err, decoded) => err ? reject(err) : parse(decoded.toString()));
                            } else if (encoding === 'deflate') {
                                zlib.inflate(buffer, (err, decoded) => err ? reject(err) : parse(decoded.toString()));
                            } else {
                                parse(buffer.toString());
                            }
                        });
                    });
                    req.on('error', reject);
                    req.write(postData);
                    req.end();
                });
            }

            for (const sup of suppliers.slice(0, 5)) {
                const supId = sup.id || sup.supplier_id;
                const supName = sup.name || sup.supplier_name || sup.shop_name || `ID:${supId}`;
                if (!supId) continue;

                try {
                    const result = await netseaRawFetch('/items', { supplier_ids: [parseInt(supId)] });

                    // errorがあっても、itemsもある場合はデータを取得
                    const body = result.body || {};
                    const rawItems = body.items || body.data || body.direct_items || [];
                    const items = Array.isArray(rawItems) ? rawItems : [];

                    // デバッグ: 最初の3社の生レスポンスと商品サンプルを保存
                    if (debugInfo.rawSamples.length < 3) {
                        const sampleItem = items.length > 0 ? items[0] : null;
                        debugInfo.rawSamples.push({
                            supplierId: supId,
                            status: result.status,
                            bodyKeys: result.body ? Object.keys(result.body) : [],
                            itemCount: items.length,
                            itemKeys: sampleItem ? Object.keys(sampleItem) : [],
                            sampleItem: sampleItem ? JSON.stringify(sampleItem).substring(0, 500) : 'none',
                        });
                    }

                    if (items.length > 0) {
                        debugInfo.approved.push({ name: supName, id: supId, count: items.length });
                    } else {
                        debugInfo.denied++;
                    }

                    items.forEach(item => {
                        // setフィールドから価格を抽出
                        const sets = item.set || [];
                        let wholesale = 0;
                        let retail = 0;
                        let minLot = 1;
                        if (Array.isArray(sets) && sets.length > 0) {
                            const s = sets[0];
                            wholesale = s.price || s.wholesale_price || s.net_price || 0;
                            retail = s.retail_price || s.reference_price || s.msrp || 0;
                            minLot = s.min_quantity || s.lot || s.min_lot || 1;
                        }

                        // デバッグ: 最初の商品のsetフィールドを保存
                        if (allItems.length === 0 && sets.length > 0 && !debugInfo.sampleSet) {
                            debugInfo.sampleSet = JSON.stringify(sets[0]).substring(0, 400);
                        }

                        const margin = retail > 0 ? Math.round((1 - wholesale / retail) * 100) : 0;
                        allItems.push({
                            id: item.product_id || item.direct_item_id || '',
                            name: item.product_name || '',
                            wholesale_price: wholesale,
                            retail_price: retail,
                            margin: margin,
                            supplier: item.shop_name || supName,
                            supplier_id: supId,
                            image: item.image_url_1 || null,
                            jan: item.jan_code || '',
                            category: item.category_id || '',
                            min_lot: minLot,
                            netsea_url: item.product_url || `https://www.netsea.jp/shop/${supId}/${item.product_id}`,
                        });
                    });
                } catch (e) {
                    debugInfo.denied++;
                }
                // レート制限回避
                await delay(100);
            }

            // 粗利率の高い順にソート（卸値あるものを優先）
            allItems.sort((a, b) => {
                if (a.wholesale_price > 0 && b.wholesale_price === 0) return -1;
                if (a.wholesale_price === 0 && b.wholesale_price > 0) return 1;
                return b.margin - a.margin;
            });

            return res.status(200).json({
                items: allItems.slice(0, 50),
                total: allItems.length,
                suppliersScanned: suppliers.length,
                suppliersApproved: debugInfo.approved.length,
                message: `${suppliers.length}社中 承認${debugInfo.approved.length}社から${allItems.length}商品を取得（${debugInfo.denied}社は未承認）`,
                debug: debugInfo,
            });
        }

        // ===== Amazon価格比較 =====
        if (action === 'compare') {
            const jan = url.searchParams.get('jan') || '';
            const name = url.searchParams.get('name') || '';
            const wholesalePrice = parseInt(url.searchParams.get('price')) || 0;

            if (!jan && !name) {
                return res.status(400).json({ error: 'JANコードまたは商品名が必要です' });
            }

            let amazonData = null;

            // JANコードで検索（優先）
            if (jan) {
                try {
                    const data = await keepaFetch('product', { code: jan, stats: 180 });
                    if (data.products && data.products.length > 0) {
                        amazonData = formatKeepaProduct(data.products[0]);
                        amazonData.asin = data.products[0].asin;
                        amazonData.title = data.products[0].title;
                        amazonData.url = `https://www.amazon.co.jp/dp/${data.products[0].asin}`;
                        amazonData.imageUrl = data.products[0].imagesCSV
                            ? `https://images-na.ssl-images-amazon.com/images/I/${data.products[0].imagesCSV.split(',')[0]}`
                            : null;
                    }
                } catch (e) {
                    console.log('JAN検索失敗:', e.message);
                }
            }

            // JANで見つからない場合、キーワード検索（短縮リトライ付き）
            if (!amazonData && name) {
                const words = name.split(/[\s\u3000]+/);
                const searchTerms = [name];
                if (words.length > 2) searchTerms.push(words.slice(0, 3).join(' '));
                if (words.length > 2) searchTerms.push(words.slice(0, 2).join(' '));

                for (const term of searchTerms) {
                    if (amazonData) break;
                    try {
                        const data = await keepaFetch('search', { type: 'product', term, stats: 180, page: 0 });
                        if (data.products && data.products.length > 0) {
                            const best = data.products[0];
                            amazonData = formatKeepaProduct(best);
                            amazonData.asin = best.asin;
                            amazonData.title = best.title;
                            amazonData.url = `https://www.amazon.co.jp/dp/${best.asin}`;
                            amazonData.imageUrl = best.imagesCSV
                                ? `https://images-na.ssl-images-amazon.com/images/I/${best.imagesCSV.split(',')[0]}`
                                : null;
                        }
                    } catch (e) {
                        console.log(`検索失敗 [${term}]:`, e.message);
                    }
                }
            }

            // 利益計算（送料含む）
            let profit = null;
            if (amazonData && amazonData.sellingPrice && wholesalePrice > 0) {
                const amazonFee = Math.round(amazonData.sellingPrice * 0.15);
                const fbaFee = 421; // 標準サイズFBA手数料
                const shippingCost = 700; // NETSEA仕入れ送料（概算）
                const totalProfit = amazonData.sellingPrice - wholesalePrice - amazonFee - fbaFee - shippingCost;
                const profitRate = Math.round((totalProfit / amazonData.sellingPrice) * 100);
                profit = {
                    sellingPrice: amazonData.sellingPrice,
                    wholesalePrice,
                    amazonFee,
                    fbaFee,
                    shippingCost,
                    profit: totalProfit,
                    profitRate,
                };
            }

            return res.status(200).json({
                amazon: amazonData,
                profit,
                found: !!amazonData,
            });
        }

        // ===== サプライヤー一覧 =====
        if (action === 'suppliers') {
            if (useMock) {
                return res.status(200).json({
                    suppliers: [
                        { id: 1, name: 'ナチュラルコスメ工房', category: '美容・コスメ' },
                        { id: 2, name: 'メタルクラフト', category: 'キッチン用品' },
                        { id: 3, name: 'フィットネスフーズ', category: '食品・飲料' },
                    ],
                    isMock: true,
                });
            }
            const data = await netseaFetch('/suppliers', {}, 'GET').catch(() => netseaFetch('/suppliers', {}, 'POST'));
            // APIレスポンスの構造を正規化（{data:[...]}, 配列, {suppliers:[...]} 等に対応）
            let list = [];
            if (Array.isArray(data)) {
                list = data;
            } else if (data.data && Array.isArray(data.data)) {
                list = data.data;
            } else if (data.suppliers) {
                list = Array.isArray(data.suppliers) ? data.suppliers : (data.suppliers.data || []);
            }
            return res.status(200).json({ suppliers: list, isMock: false });
        }

        // ===== ステータス確認 =====
        if (action === 'status') {
            return res.status(200).json({
                connected: !!NETSEA_TOKEN,
                message: NETSEA_TOKEN ? 'NETSEA API接続済み' : 'NETSEAトークン未設定（デモモード）',
            });
        }

        return res.status(400).json({ error: '不明なアクション: ' + action });
    } catch (err) {
        console.error('NETSEA API Error:', err);
        return res.status(500).json({ error: err.message || 'サーバーエラー' });
    }
};
