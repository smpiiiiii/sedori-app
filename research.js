// せどりリサーチツール — Keepa API連携
// NETSEA商品をAmazonと比較して利益商品を見つける

const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ===== 設定 =====
const KEEPA_API_KEY = 'ad07ahj2ltpq4om3fs0e2iol7g1cp7eb3tr1c81u862g92k4olbe8kr7bd2r6hei';
const AMAZON_DOMAIN = 5; // 5 = Amazon.co.jp
const FBA_FEE_RATE = 0.15; // Amazon販売手数料 15%
const FBA_SHIPPING_FEE = 500; // FBA配送手数料（平均）

// ===== Keepa APIリクエスト =====
function keepaRequest(endpoint, params) {
    return new Promise((resolve, reject) => {
        const queryParams = new URLSearchParams({ key: KEEPA_API_KEY, domain: AMAZON_DOMAIN, ...params });
        const url = `https://api.keepa.com/${endpoint}?${queryParams}`;
        console.log(`🔍 Keepa API: ${endpoint}...`);
        
        const options = {
            headers: { 'Accept-Encoding': 'gzip, deflate' }
        };
        
        https.get(url, options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const encoding = res.headers['content-encoding'];
                
                const parseJSON = (str) => {
                    try {
                        const json = JSON.parse(str);
                        if (json.error) {
                            reject(new Error(`Keepa API エラー: ${JSON.stringify(json.error)}`));
                        } else {
                            if (json.tokensLeft !== undefined) {
                                console.log(`   💰 トークン残量: ${json.tokensLeft}`);
                            }
                            resolve(json);
                        }
                    } catch (e) {
                        reject(new Error(`JSON解析エラー: ${e.message}`));
                    }
                };
                
                if (encoding === 'gzip') {
                    zlib.gunzip(buffer, (err, decoded) => {
                        if (err) return reject(new Error(`gzip解凍エラー: ${err.message}`));
                        parseJSON(decoded.toString());
                    });
                } else if (encoding === 'deflate') {
                    zlib.inflate(buffer, (err, decoded) => {
                        if (err) return reject(new Error(`deflate解凍エラー: ${err.message}`));
                        parseJSON(decoded.toString());
                    });
                } else {
                    parseJSON(buffer.toString());
                }
            });
        }).on('error', reject);
    });
}

// ===== 商品検索（キーワード） =====
async function searchByKeyword(keyword) {
    console.log(`\n🔎 キーワード検索: "${keyword}"`);
    const result = await keepaRequest('search', {
        type: 'product',
        term: keyword,
        stats: 180, // 180日間の統計
        page: 0,
    });
    return result.products || [];
}

// ===== ASIN/JANで商品情報取得 =====
async function getProductsByAsin(asins) {
    // ASINの配列を受け取る（最大100個）
    const asinList = Array.isArray(asins) ? asins.join(',') : asins;
    console.log(`\n📦 商品情報取得: ${asinList.split(',').length}件`);
    const result = await keepaRequest('product', {
        asin: asinList,
        stats: 180,
        offers: 20,
    });
    return result.products || [];
}

// ===== Product Finder（条件で大量検索） =====
async function productFinder(options = {}) {
    const {
        // 価格範囲（円）
        minPrice = 500,
        maxPrice = 5000,
        // 売れ筋ランキング
        minSalesRank = 1,
        maxSalesRank = 100000,
        // カテゴリ
        categoryId = null,
        // 結果制限
        perPage = 50,
    } = options;

    // Keepa価格はセント単位（1円 = 1）
    const productFinderParams = {
        // Amazon価格
        CURRENT_Amazon_PRICE_min: minPrice,
        CURRENT_Amazon_PRICE_max: maxPrice,
        // 売れ筋ランキング
        CURRENT_SALES_RANK_min: minSalesRank,
        CURRENT_SALES_RANK_max: maxSalesRank,
        // 在庫あり
        CURRENT_Amazon_PRICE_isActive: true,
        // 日本語の商品
        productType: [0], // 通常商品
        perPage: perPage,
        page: 0,
    };

    if (categoryId) {
        productFinderParams.rootCategory = categoryId;
    }

    console.log(`\n🔍 Product Finder: ¥${minPrice}〜¥${maxPrice}, ランキング ${maxSalesRank}位以内`);
    const result = await keepaRequest('query', {
        selection: JSON.stringify(productFinderParams),
    });
    return result.asinList || [];
}

// ===== Keepa価格をJPYに変換 =====
function keepaPrice(price) {
    if (!price || price < 0) return null;
    return price; // 日本の場合は1:1（セント→円）
}

// ===== 商品データを整形 =====
function formatProduct(product) {
    const stats = product.stats || {};

    // 現在のAmazon価格
    const amazonPrice = keepaPrice(stats.current?.[0]);
    // 現在の新品最安値（マーケットプレイス）
    const newPrice = keepaPrice(stats.current?.[1]);
    // 売れ筋ランキング
    const salesRank = stats.current?.[3];
    // Amazon直販平均価格（180日）
    const avgAmazon = keepaPrice(stats.avg180?.[0]);
    // 新品平均価格（180日）
    const avgNew = keepaPrice(stats.avg180?.[1]);

    // 売れる価格を決定（Amazon価格 or 新品最安値の高い方）
    const sellingPrice = amazonPrice || newPrice || avgAmazon || avgNew;

    return {
        asin: product.asin,
        title: product.title || '(タイトル不明)',
        // カテゴリ
        category: product.categoryTree?.[0]?.name || '',
        // 価格情報
        amazonPrice,
        newPrice,
        sellingPrice,
        avgAmazon,
        avgNew,
        // ランキング
        salesRank,
        // 画像
        imageUrl: product.imagesCSV ? `https://images-na.ssl-images-amazon.com/images/I/${product.imagesCSV.split(',')[0]}` : null,
        // Amazon URL
        url: `https://www.amazon.co.jp/dp/${product.asin}`,
        // JAN/EAN
        ean: product.eanList?.[0] || null,
    };
}

// ===== 利益計算 =====
function calculateProfit(sellingPrice, wholesalePrice) {
    if (!sellingPrice || !wholesalePrice) return null;
    // Amazon手数料（販売手数料 + FBA配送料）
    const amazonFee = Math.round(sellingPrice * FBA_FEE_RATE);
    const totalFee = amazonFee + FBA_SHIPPING_FEE;
    const profit = sellingPrice - wholesalePrice - totalFee;
    const profitRate = Math.round((profit / sellingPrice) * 100);

    return {
        sellingPrice,       // 販売価格
        wholesalePrice,     // 仕入値
        amazonFee,          // Amazon手数料
        shippingFee: FBA_SHIPPING_FEE, // FBA配送料
        totalFee,           // 総手数料
        profit,             // 利益
        profitRate,         // 利益率（%）
    };
}

// ===== 結果をCSV出力 =====
function exportCSV(results, filename) {
    const header = 'ASIN,商品名,カテゴリ,Amazon価格,新品最安値,売れ筋ランキング,JAN,URL';
    const rows = results.map(r =>
        `"${r.asin}","${(r.title || '').replace(/"/g, '""')}","${r.category}",${r.amazonPrice || ''},${r.newPrice || ''},${r.salesRank || ''},"${r.ean || ''}","${r.url}"`
    );
    const csv = '\uFEFF' + header + '\n' + rows.join('\n'); // BOM付きUTF-8
    fs.writeFileSync(filename, csv, 'utf-8');
    console.log(`\n📁 CSV出力: ${filename} (${results.length}件)`);
}

// ===== 利益計算付きCSV出力 =====
function exportProfitCSV(results, filename) {
    const header = 'ASIN,商品名,カテゴリ,Amazon価格,仕入値,利益,利益率,売れ筋ランキング,JAN,URL';
    const rows = results.map(r => {
        const p = r.profitCalc || {};
        return `"${r.asin}","${(r.title || '').replace(/"/g, '""')}","${r.category}",${r.sellingPrice || ''},${p.wholesalePrice || ''},${p.profit || ''},${p.profitRate || ''}%,${r.salesRank || ''},"${r.ean || ''}","${r.url}"`;
    });
    const csv = '\uFEFF' + header + '\n' + rows.join('\n');
    fs.writeFileSync(filename, csv, 'utf-8');
    console.log(`\n📁 利益計算CSV: ${filename} (${results.length}件)`);
}

// ===== メインコマンド =====
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';

    console.log('========================================');
    console.log('🔍 せどりリサーチツール v1.0');
    console.log('========================================');

    switch (command) {
        // キーワード検索
        case 'search': {
            const keyword = args.slice(1).join(' ');
            if (!keyword) {
                console.log('❌ キーワードを指定してください');
                console.log('使い方: node research.js search <キーワード>');
                return;
            }
            const products = await searchByKeyword(keyword);
            if (products.length === 0) {
                console.log('❌ 商品が見つかりませんでした');
                return;
            }
            const results = products.map(formatProduct).filter(r => r.sellingPrice);
            // ランキング順にソート
            results.sort((a, b) => (a.salesRank || 999999) - (b.salesRank || 999999));

            console.log(`\n📊 検索結果: ${results.length}件\n`);
            results.slice(0, 20).forEach((r, i) => {
                console.log(`${i + 1}. [${r.asin}] ${r.title.substring(0, 50)}`);
                console.log(`   💰 Amazon: ¥${r.amazonPrice?.toLocaleString() || '-'} | 新品: ¥${r.newPrice?.toLocaleString() || '-'} | ランキング: ${r.salesRank?.toLocaleString() || '-'}位`);
                console.log(`   🔗 ${r.url}`);
                console.log('');
            });

            // CSV出力
            const csvFile = path.join(__dirname, `search_${Date.now()}.csv`);
            exportCSV(results, csvFile);
            break;
        }

        // ASIN指定で商品情報取得
        case 'lookup': {
            const asins = args.slice(1);
            if (asins.length === 0) {
                console.log('❌ ASINを指定してください');
                console.log('使い方: node research.js lookup <ASIN1> <ASIN2> ...');
                return;
            }
            const products = await getProductsByAsin(asins);
            const results = products.map(formatProduct);

            results.forEach(r => {
                console.log(`\n📦 ${r.title}`);
                console.log(`   ASIN: ${r.asin}`);
                console.log(`   カテゴリ: ${r.category}`);
                console.log(`   Amazon価格: ¥${r.amazonPrice?.toLocaleString() || '-'}`);
                console.log(`   新品最安値: ¥${r.newPrice?.toLocaleString() || '-'}`);
                console.log(`   180日平均: ¥${r.avgAmazon?.toLocaleString() || '-'}`);
                console.log(`   ランキング: ${r.salesRank?.toLocaleString() || '-'}位`);
                console.log(`   JAN: ${r.ean || '-'}`);
                console.log(`   🔗 ${r.url}`);
            });
            break;
        }

        // 利益計算（ASIN + 仕入値）
        case 'profit': {
            const asin = args[1];
            const cost = parseInt(args[2]);
            if (!asin || !cost) {
                console.log('❌ ASINと仕入値を指定してください');
                console.log('使い方: node research.js profit <ASIN> <仕入値>');
                console.log('例: node research.js profit B08N5WRWNW 1500');
                return;
            }
            const products = await getProductsByAsin([asin]);
            if (products.length === 0) {
                console.log('❌ 商品が見つかりませんでした');
                return;
            }
            const r = formatProduct(products[0]);
            const calc = calculateProfit(r.sellingPrice, cost);

            console.log(`\n📦 ${r.title}`);
            console.log(`   ASIN: ${r.asin} | ランキング: ${r.salesRank?.toLocaleString() || '-'}位`);
            console.log('');
            console.log('   ┌─────────────────────────────┐');
            console.log(`   │ 販売価格:    ¥${(calc.sellingPrice || 0).toLocaleString().padStart(8)}`);
            console.log(`   │ 仕入値:      ¥${(calc.wholesalePrice || 0).toLocaleString().padStart(8)}`);
            console.log(`   │ Amazon手数料: ¥${(calc.amazonFee || 0).toLocaleString().padStart(8)} (15%)`);
            console.log(`   │ FBA配送料:   ¥${(calc.shippingFee || 0).toLocaleString().padStart(8)}`);
            console.log('   │─────────────────────────────│');
            console.log(`   │ 利益:        ¥${(calc.profit || 0).toLocaleString().padStart(8)} (${calc.profitRate}%)`);
            console.log('   └─────────────────────────────┘');
            if (calc.profit > 0) {
                console.log('   ✅ 利益出ます！');
            } else {
                console.log('   ❌ 赤字です');
            }
            break;
        }

        // Product Finder（条件検索）
        case 'find': {
            const minPrice = parseInt(args[1]) || 1000;
            const maxPrice = parseInt(args[2]) || 5000;
            const maxRank = parseInt(args[3]) || 50000;

            const asins = await productFinder({ minPrice, maxPrice, maxSalesRank: maxRank });
            if (asins.length === 0) {
                console.log('❌ 条件に合う商品が見つかりませんでした');
                return;
            }
            console.log(`\n🎯 ${asins.length}件ヒット! 詳細を取得中...`);

            // 最大100件ずつ取得
            const allResults = [];
            for (let i = 0; i < asins.length; i += 100) {
                const batch = asins.slice(i, i + 100);
                const products = await getProductsByAsin(batch);
                const formatted = products.map(formatProduct).filter(r => r.sellingPrice);
                allResults.push(...formatted);
                // API制限を考慮して待機
                if (i + 100 < asins.length) {
                    console.log('   ⏳ APIレート制限を待機中 (60秒)...');
                    await new Promise(r => setTimeout(r, 60000));
                }
            }

            // ランキング順ソート
            allResults.sort((a, b) => (a.salesRank || 999999) - (b.salesRank || 999999));

            console.log(`\n📊 結果: ${allResults.length}件\n`);
            allResults.slice(0, 30).forEach((r, i) => {
                console.log(`${i + 1}. [${r.asin}] ${r.title.substring(0, 50)}`);
                console.log(`   💰 ¥${r.sellingPrice?.toLocaleString() || '-'} | ランキング: ${r.salesRank?.toLocaleString() || '-'}位`);
            });

            // CSV出力
            const csvFile = path.join(__dirname, `finder_${Date.now()}.csv`);
            exportCSV(allResults, csvFile);
            break;
        }

        // NETSEAの商品リストと比較
        case 'compare': {
            const csvPath = args[1];
            if (!csvPath) {
                console.log('❌ NETSEAの商品CSVファイルを指定してください');
                console.log('使い方: node research.js compare <netsea_products.csv>');
                console.log('');
                console.log('CSVフォーマット: 商品名,卸価格,JAN(任意)');
                console.log('例:');
                console.log('  ハンドソープ 泡タイプ 250ml,350,4901301729286');
                console.log('  フェイスパック 10枚入,800');
                return;
            }
            if (!fs.existsSync(csvPath)) {
                console.log(`❌ ファイルが見つかりません: ${csvPath}`);
                return;
            }
            const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());
            // ヘッダーチェック
            const startIdx = lines[0].includes('商品名') ? 1 : 0;
            const items = [];
            for (let i = startIdx; i < lines.length; i++) {
                const parts = lines[i].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
                if (parts.length >= 2) {
                    items.push({
                        name: parts[0],
                        cost: parseInt(parts[1]) || 0,
                        jan: parts[2] || null,
                    });
                }
            }
            console.log(`\n📋 ${items.length}件の商品を比較中...`);

            const results = [];
            for (const item of items) {
                try {
                    let products;
                    if (item.jan) {
                        // JANコードで検索
                        products = await keepaRequest('product', {
                            key: KEEPA_API_KEY,
                            domain: AMAZON_DOMAIN,
                            code: item.jan,
                            stats: 180,
                        });
                        products = products.products || [];
                    } else {
                        // キーワード検索
                        products = await searchByKeyword(item.name);
                    }

                    if (products.length > 0) {
                        const r = formatProduct(products[0]);
                        const calc = calculateProfit(r.sellingPrice, item.cost);
                        if (calc && calc.profit > 0) {
                            r.profitCalc = calc;
                            r.wholesaleName = item.name;
                            results.push(r);
                            console.log(`   ✅ ${item.name} → ¥${calc.profit.toLocaleString()} (${calc.profitRate}%)`);
                        } else {
                            console.log(`   ❌ ${item.name} → 利益なし`);
                        }
                    } else {
                        console.log(`   ⚠️ ${item.name} → Amazon未登録`);
                    }

                    // APIレート制限を考慮（1トークン/分）
                    await new Promise(r => setTimeout(r, 62000));
                } catch (e) {
                    console.log(`   ❌ ${item.name} → エラー: ${e.message}`);
                }
            }

            // 利益率順にソート
            results.sort((a, b) => (b.profitCalc?.profitRate || 0) - (a.profitCalc?.profitRate || 0));

            console.log(`\n\n🎯 利益商品: ${results.length}件\n`);
            results.forEach((r, i) => {
                const p = r.profitCalc;
                console.log(`${i + 1}. ${r.wholesaleName}`);
                console.log(`   Amazon: ¥${r.sellingPrice?.toLocaleString()} → 仕入: ¥${p.wholesalePrice.toLocaleString()} → 利益: ¥${p.profit.toLocaleString()} (${p.profitRate}%)`);
                console.log(`   🔗 ${r.url}`);
            });

            // CSV出力
            if (results.length > 0) {
                const csvFile = path.join(__dirname, `profit_${Date.now()}.csv`);
                exportProfitCSV(results, csvFile);
            }
            break;
        }

        default:
            console.log('');
            console.log('📖 使い方:');
            console.log('');
            console.log('  1. キーワード検索（Amazon商品をキーワードで探す）');
            console.log('     node research.js search <キーワード>');
            console.log('     例: node research.js search フェイスパック');
            console.log('');
            console.log('  2. ASIN検索（商品の詳細情報を取得）');
            console.log('     node research.js lookup <ASIN>');
            console.log('     例: node research.js lookup B08N5WRWNW');
            console.log('');
            console.log('  3. 利益計算（ASINと仕入値から利益を計算）');
            console.log('     node research.js profit <ASIN> <仕入値>');
            console.log('     例: node research.js profit B08N5WRWNW 1500');
            console.log('');
            console.log('  4. 条件検索（価格帯・ランキングで一括検索）');
            console.log('     node research.js find <最低価格> <最高価格> <最大ランキング>');
            console.log('     例: node research.js find 1000 5000 50000');
            console.log('');
            console.log('  5. NETSEA商品比較（CSVファイルと比較して利益商品を発見）');
            console.log('     node research.js compare <CSVファイル>');
            console.log('     例: node research.js compare netsea_products.csv');
            console.log('');
            break;
    }
}

// 実行
main().catch(err => {
    console.error('❌ エラー:', err.message);
    process.exit(1);
});
