// NETSEA商品監視ツール — Node.jsスクリプト
// NETSEAの商品をスキャンし、Amazon価格と比較して利益商品を発見

const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ===== 設定 =====
const NETSEA_TOKEN = process.env.NETSEA_TOKEN || '';
const KEEPA_API_KEY = process.env.KEEPA_API_KEY || 'ad07ahj2ltpq4om3fs0e2iol7g1cp7eb3tr1c81u862g92k4olbe8kr7bd2r6hei';
const NETSEA_API_BASE = 'https://api.netsea.jp/buyer/v1';
const AMAZON_DOMAIN = 5;

// ===== HTTPリクエストヘルパー =====
function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = { headers: { 'Accept-Encoding': 'gzip, deflate', ...headers } };
        https.get(url, options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const encoding = res.headers['content-encoding'];
                const parse = (str) => {
                    try { resolve(JSON.parse(str)); }
                    catch (e) { reject(new Error(`JSON解析エラー: ${e.message}`)); }
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

// ===== NETSEA API =====
async function netseaFetch(endpoint, params = {}) {
    if (!NETSEA_TOKEN) {
        throw new Error('NETSEA_TOKEN環境変数が設定されていません。\n設定方法: set NETSEA_TOKEN=あなたのトークン');
    }
    const queryParams = new URLSearchParams(params);
    const url = `${NETSEA_API_BASE}${endpoint}?${queryParams}`;
    return httpGet(url, { 'Authorization': `Bearer ${NETSEA_TOKEN}`, 'Accept': 'application/json' });
}

// ===== Keepa API =====
async function keepaFetch(endpoint, params) {
    const queryParams = new URLSearchParams({ key: KEEPA_API_KEY, domain: AMAZON_DOMAIN, ...params });
    const url = `https://api.keepa.com/${endpoint}?${queryParams}`;
    return httpGet(url);
}

// ===== Amazon価格取得 =====
async function getAmazonPrice(jan, productName) {
    try {
        // JANコードで検索（優先）
        if (jan) {
            const data = await keepaFetch('product', { code: jan, stats: 180 });
            if (data.products && data.products.length > 0) {
                const p = data.products[0];
                const stats = p.stats || {};
                const price = stats.current?.[0] > 0 ? stats.current[0] : (stats.current?.[1] > 0 ? stats.current[1] : null);
                const rank = stats.current?.[3] > 0 ? stats.current[3] : null;
                return {
                    asin: p.asin,
                    price,
                    rank,
                    title: p.title,
                    url: `https://www.amazon.co.jp/dp/${p.asin}`,
                };
            }
        }

        // キーワード検索にフォールバック
        if (productName) {
            const data = await keepaFetch('search', { type: 'product', term: productName, stats: 180, page: 0 });
            if (data.products && data.products.length > 0) {
                const p = data.products[0];
                const stats = p.stats || {};
                const price = stats.current?.[0] > 0 ? stats.current[0] : (stats.current?.[1] > 0 ? stats.current[1] : null);
                const rank = stats.current?.[3] > 0 ? stats.current[3] : null;
                return {
                    asin: p.asin,
                    price,
                    rank,
                    title: p.title,
                    url: `https://www.amazon.co.jp/dp/${p.asin}`,
                };
            }
        }
    } catch (e) {
        console.log(`   ⚠️ Amazon価格取得エラー: ${e.message}`);
    }
    return null;
}

// ===== 利益計算 =====
function calcProfit(amazonPrice, wholesalePrice) {
    if (!amazonPrice || !wholesalePrice) return null;
    const amazonFee = Math.round(amazonPrice * 0.15);
    const fbaFee = 421;
    const profit = amazonPrice - wholesalePrice - amazonFee - fbaFee;
    const profitRate = Math.round((profit / amazonPrice) * 100);
    return { amazonPrice, wholesalePrice, amazonFee, fbaFee, profit, profitRate };
}

// ===== CSV出力 =====
function exportCSV(results, filename) {
    const header = 'NETSEA商品名,卸価格,Amazon販売価格,ASIN,利益,利益率,ランキング,JAN,AmazonURL';
    const rows = results.map(r => {
        const p = r.profitCalc || {};
        return `"${(r.netseaName || '').replace(/"/g, '""')}",${r.wholesalePrice || ''},${p.amazonPrice || ''},${r.asin || ''},${p.profit || ''},${p.profitRate || ''}%,${r.rank || ''},${r.jan || ''},"${r.amazonUrl || ''}"`;
    });
    const csv = '\uFEFF' + header + '\n' + rows.join('\n');
    fs.writeFileSync(filename, csv, 'utf-8');
    console.log(`\n📁 CSV出力: ${filename} (${results.length}件)`);
}

// ===== メインコマンド =====
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';

    console.log('========================================');
    console.log('🏭 NETSEA商品監視ツール v1.0');
    console.log('========================================');

    switch (command) {
        // カテゴリ一覧
        case 'categories': {
            console.log('\n📂 カテゴリ一覧を取得中...');
            const data = await netseaFetch('/categories');
            const cats = data.categories || data || [];
            console.log(`\n${cats.length}件のカテゴリ:`);
            cats.forEach((c, i) => {
                console.log(`  ${i + 1}. [${c.id}] ${c.name}`);
            });
            break;
        }

        // 商品検索
        case 'search': {
            const keyword = args.slice(1).join(' ');
            if (!keyword) {
                console.log('❌ キーワードを指定してください');
                console.log('使い方: node netsea-monitor.js search <キーワード>');
                return;
            }
            console.log(`\n🔍 NETSEA検索: "${keyword}"`);
            const data = await netseaFetch('/items', { keyword, deal_net_shop_flag: 1 });
            const items = data.items || [];
            console.log(`\n📊 ${items.length}件の商品\n`);
            items.slice(0, 30).forEach((item, i) => {
                const name = item.item_name || item.name || '';
                const price = item.price || 0;
                console.log(`${i + 1}. ${name.substring(0, 50)}`);
                console.log(`   🏭 卸値: ¥${price.toLocaleString()} | サプライヤー: ${item.supplier_name || '-'}`);
            });
            break;
        }

        // 利益スキャン — NETSEA商品をAmazonと比較
        case 'scan': {
            const minProfit = parseInt(args.find(a => a.startsWith('--min-profit='))?.split('=')[1]) || 10;
            const category = args.find(a => a.startsWith('--category='))?.split('=')[1] || '';
            const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1]) || 50;

            console.log(`\n🚀 利益スキャン開始`);
            console.log(`   最低利益率: ${minProfit}% | カテゴリ: ${category || 'すべて'} | 上限: ${limit}件\n`);

            // NETSEA商品を取得
            const params = { deal_net_shop_flag: 1 };
            if (category) params.keyword = category;
            const data = await netseaFetch('/items', params);
            const items = (data.items || []).slice(0, limit);

            if (items.length === 0) {
                console.log('❌ 商品が見つかりませんでした');
                return;
            }
            console.log(`📦 ${items.length}件の商品をスキャン中...\n`);

            const results = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const name = item.item_name || item.name || '';
                const wholesalePrice = item.price || 0;
                const jan = item.jan_code || item.branch_code || '';

                process.stdout.write(`  [${i + 1}/${items.length}] ${name.substring(0, 40)}... `);

                const amazon = await getAmazonPrice(jan, name);
                if (!amazon || !amazon.price) {
                    console.log('❌ Amazon未登録');
                    continue;
                }

                const prof = calcProfit(amazon.price, wholesalePrice);
                if (!prof) {
                    console.log('❌ 計算不可');
                    continue;
                }

                if (prof.profitRate >= minProfit) {
                    console.log(`✅ 利益¥${prof.profit.toLocaleString()} (${prof.profitRate}%)`);
                    results.push({
                        netseaName: name,
                        wholesalePrice,
                        jan,
                        asin: amazon.asin,
                        rank: amazon.rank,
                        amazonUrl: amazon.url,
                        profitCalc: prof,
                    });
                } else {
                    console.log(`⚠️ 利益率${prof.profitRate}% (基準${minProfit}%未満)`);
                }

                // APIレート制限を考慮（Keepaトークン消費）
                await new Promise(r => setTimeout(r, 2000));
            }

            // 結果表示
            results.sort((a, b) => (b.profitCalc?.profitRate || 0) - (a.profitCalc?.profitRate || 0));

            console.log(`\n\n🎯 利益商品: ${results.length}件\n`);
            results.forEach((r, i) => {
                const p = r.profitCalc;
                console.log(`${i + 1}. ${r.netseaName}`);
                console.log(`   卸値: ¥${p.wholesalePrice.toLocaleString()} → Amazon: ¥${p.amazonPrice.toLocaleString()} → 利益: ¥${p.profit.toLocaleString()} (${p.profitRate}%)`);
                console.log(`   🔗 ${r.amazonUrl}`);
            });

            // CSV出力
            if (results.length > 0) {
                const csvFile = path.join(__dirname, `netsea_profit_${Date.now()}.csv`);
                exportCSV(results, csvFile);
            }
            break;
        }

        default:
            console.log('');
            console.log('📖 使い方:');
            console.log('');
            console.log('  1. カテゴリ一覧');
            console.log('     node netsea-monitor.js categories');
            console.log('');
            console.log('  2. 商品検索');
            console.log('     node netsea-monitor.js search <キーワード>');
            console.log('     例: node netsea-monitor.js search フェイスパック');
            console.log('');
            console.log('  3. 利益スキャン（NETSEA→Amazon価格比較）');
            console.log('     node netsea-monitor.js scan [--min-profit=20] [--category=食品] [--limit=50]');
            console.log('     例: node netsea-monitor.js scan --min-profit=20 --category=食品');
            console.log('');
            console.log('⚠️ 環境変数の設定:');
            console.log('  set NETSEA_TOKEN=あなたのNETSEAアクセストークン');
            console.log('');
            break;
    }
}

// 実行
main().catch(err => {
    console.error('❌ エラー:', err.message);
    process.exit(1);
});
