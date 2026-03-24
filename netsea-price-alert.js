/**
 * NETSEA価格アラートボット — STEP3
 *
 * NETSEAスキャンで見つけた商品のAmazon価格をKeepaで定期監視し、
 * 価格下落時にDiscordに通知する。
 *
 * 使い方:
 *   node netsea-price-alert.js          # 2時間間隔で自動巡回
 *   node netsea-price-alert.js --once   # 1回だけ実行
 *   node netsea-price-alert.js --test   # テスト通知送信
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ============================================================
//  設定
// ============================================================

const KEEPA_API_KEY = 'ad07ahj2ltpq4om3fs0e2iol7g1cp7eb3tr1c81u862g92k4olbe8kr7bd2r6hei';
const DISCORD_WEBHOOK_URL = 'https://discordapp.com/api/webhooks/1482438080089690316/5uZz6YtdL7eki2gcG0zBW56pQhgQffvZl0ZCUIPq4yDkq3bwoFTN2IPUW_D2UGMswn_c';
const AMAZON_DOMAIN = 5; // Amazon.co.jp

/** 監視間隔（ミリ秒） */
const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2時間

/** 価格下落アラートしきい値 */
const DROP_THRESHOLD_PERCENT = 5;    // 5%以上の下落
const DROP_THRESHOLD_YEN = 500;      // または¥500以上の下落

/** 利益率しきい値（これ以下は通知しない） */
const MIN_PROFIT_RATE = 10;          // 10%

/** ウォッチリストファイル */
const WATCHLIST_FILE = path.join(__dirname, 'watchlist.json');

/** 1回のチェックで処理するアイテム数（Keepa APIレート制限対策） */
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 3000;

// ============================================================
//  グローバルクラッシュハンドラ
// ============================================================

process.on('uncaughtException', (err) => {
    console.error('🛡️ [uncaughtException]:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('🛡️ [unhandledRejection]:', reason);
});

// ============================================================
//  ウォッチリスト管理
// ============================================================

/** ウォッチリストを読み込む */
function loadWatchlist() {
    try {
        if (fs.existsSync(WATCHLIST_FILE)) {
            return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
        }
    } catch (e) { console.error('ウォッチリスト読み込みエラー:', e.message); }
    return [];
}

/** ウォッチリストを保存する */
function saveWatchlist(list) {
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

/** ウォッチリストに追加 */
function addToWatchlist(item) {
    const list = loadWatchlist();
    // 重複チェック（JANコードで判定）
    const exists = list.findIndex(w => w.jan === item.jan);
    if (exists >= 0) {
        list[exists] = { ...list[exists], ...item, updated_at: new Date().toISOString() };
    } else {
        list.push({ ...item, added_at: new Date().toISOString() });
    }
    saveWatchlist(list);
    return list.length;
}

// ============================================================
//  Keepa API
// ============================================================

/** Keepa APIリクエスト */
function keepaFetch(endpoint, params) {
    return new Promise((resolve, reject) => {
        const queryParams = new URLSearchParams({ key: KEEPA_API_KEY, domain: AMAZON_DOMAIN, ...params });
        const url = `https://api.keepa.com/${endpoint}?${queryParams}`;

        https.get(url, { headers: { 'Accept-Encoding': 'gzip, deflate' } }, (res) => {
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

/** JANコードからAmazon価格を取得 */
async function getAmazonPrice(jan) {
    const data = await keepaFetch('product', { code: jan, stats: 180 });
    if (!data.products || data.products.length === 0) return null;

    const product = data.products[0];
    const stats = product.stats || {};
    const amazonPrice = stats.current?.[0] > 0 ? stats.current[0] : null;
    const newPrice = stats.current?.[1] > 0 ? stats.current[1] : null;
    const salesRank = stats.current?.[3] > 0 ? stats.current[3] : null;

    // Keepa価格は1/100単位（セント）ではなく円単位
    return {
        asin: product.asin,
        title: product.title,
        amazonPrice,         // Amazon本体価格
        newPrice,            // 新品最安値
        sellingPrice: amazonPrice || newPrice || null,
        salesRank,
        url: `https://www.amazon.co.jp/dp/${product.asin}`,
        imageUrl: product.imagesCSV
            ? `https://images-na.ssl-images-amazon.com/images/I/${product.imagesCSV.split(',')[0]}`
            : null,
    };
}

// ============================================================
//  利益計算
// ============================================================

/** FBA利益計算 */
function calcProfit(netseaPrice, amazonPrice) {
    if (!amazonPrice || amazonPrice <= 0) return null;
    const amazonFee = Math.round(amazonPrice * 0.15);     // Amazon販売手数料 15%
    const fbaFee = 421;                                     // FBA手数料（標準）
    const shippingCost = 700;                               // NETSEA仕入れ送料（概算）
    const profit = amazonPrice - netseaPrice - amazonFee - fbaFee - shippingCost;
    const profitRate = Math.round((profit / amazonPrice) * 100);
    return { profit, profitRate, amazonFee, fbaFee, shippingCost };
}

// ============================================================
//  Discord通知
// ============================================================

/** Discord Webhookに通知送信 */
async function sendDiscordAlert(item, amazonData, priceChange, profitData) {
    const dropPercent = Math.abs(priceChange.percent).toFixed(1);
    const dropYen = Math.abs(priceChange.diff);
    const isNewItem = priceChange.isNew;

    const emoji = dropPercent >= 20 ? '🔥🔥🔥' : dropPercent >= 10 ? '🔥🔥' : '🔥';
    const profitEmoji = profitData.profitRate >= 30 ? '💰💰💰' : profitData.profitRate >= 20 ? '💰💰' : '💰';

    const embed = {
        title: isNewItem
            ? `📊 新規登録: ${(amazonData.title || item.name).substring(0, 60)}`
            : `${emoji} 価格下落アラート！ -${dropPercent}% (-¥${dropYen.toLocaleString()})`,
        description: isNewItem
            ? `ウォッチリストに追加された商品の現在価格です`
            : `**${(amazonData.title || item.name).substring(0, 60)}**`,
        color: isNewItem ? 0x00AAFF : (dropPercent >= 20 ? 0xFF0000 : dropPercent >= 10 ? 0xFF6600 : 0xFFCC00),
        fields: [
            { name: '🏭 NETSEA仕入値', value: `¥${item.netsea_price.toLocaleString()}`, inline: true },
            { name: '🛒 Amazon現在価格', value: `¥${amazonData.sellingPrice.toLocaleString()}`, inline: true },
            { name: `${profitEmoji} 純利益`, value: `¥${profitData.profit.toLocaleString()} (${profitData.profitRate}%)`, inline: true },
        ],
        footer: { text: 'せどりアラート STEP3 • Keepa監視' },
        timestamp: new Date().toISOString(),
    };

    if (!isNewItem) {
        embed.fields.unshift({
            name: '📉 価格変動',
            value: `¥${priceChange.oldPrice.toLocaleString()} → ¥${amazonData.sellingPrice.toLocaleString()} (**-¥${dropYen.toLocaleString()}**)`,
            inline: false,
        });
    }

    if (amazonData.salesRank) {
        embed.fields.push({ name: '📊 売れ筋', value: `#${amazonData.salesRank.toLocaleString()}位`, inline: true });
    }
    embed.fields.push({ name: '🏢 サプライヤー', value: item.supplier || '不明', inline: true });

    if (amazonData.url) {
        embed.fields.push({ name: '🔗 リンク', value: `[Amazon](${amazonData.url}) | [Keepa](https://keepa.com/#!product/5-${amazonData.asin})`, inline: false });
    }

    if (amazonData.imageUrl) {
        embed.thumbnail = { url: amazonData.imageUrl };
    }

    const body = JSON.stringify({
        username: '📱 せどり価格アラート',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2331/2331941.png',
        embeds: [embed],
    });

    return new Promise((resolve, reject) => {
        const url = new URL(DISCORD_WEBHOOK_URL);
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`  📨 Discord通知送信完了`);
                    resolve();
                } else {
                    console.error(`  ❌ Discord通知エラー: ${res.statusCode} ${data}`);
                    reject(new Error(`Discord ${res.statusCode}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ============================================================
//  メインスキャン
// ============================================================

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkPrices() {
    const startTime = Date.now();
    const watchlist = loadWatchlist();

    console.log('\n' + '='.repeat(50));
    console.log(`📱 価格チェック開始 — ${new Date().toLocaleString('ja-JP')}`);
    console.log(`   監視中: ${watchlist.length}商品`);
    console.log('='.repeat(50));

    if (watchlist.length === 0) {
        console.log('⚠️ ウォッチリストが空です。セドリアプリからスキャン結果を追加してください。');
        return;
    }

    let checked = 0, alerts = 0, errors = 0;

    // バッチ処理（Keepa APIレート制限対策）
    for (let i = 0; i < watchlist.length; i += BATCH_SIZE) {
        const batch = watchlist.slice(i, i + BATCH_SIZE);

        for (const item of batch) {
            if (!item.jan || item.jan.length < 8) {
                console.log(`  ⏭️ JANなし: ${(item.name || '').substring(0, 30)}`);
                continue;
            }

            try {
                console.log(`  🔍 ${item.name ? item.name.substring(0, 40) : item.jan}...`);
                const amazonData = await getAmazonPrice(item.jan);

                if (!amazonData || !amazonData.sellingPrice) {
                    console.log(`  ⏭️ Amazon価格取得できず`);
                    continue;
                }

                checked++;
                const currentPrice = amazonData.sellingPrice;
                const prevPrice = item.last_amazon_price || null;

                // 利益計算
                const profitData = calcProfit(item.netsea_price, currentPrice);
                if (!profitData) continue;

                // 利益率チェック
                if (profitData.profitRate < MIN_PROFIT_RATE) {
                    console.log(`  ⏭️ 利益率 ${profitData.profitRate}% < ${MIN_PROFIT_RATE}% — スキップ`);
                    item.last_amazon_price = currentPrice;
                    item.last_checked = new Date().toISOString();
                    continue;
                }

                // 価格下落チェック
                let shouldAlert = false;
                let priceChange = { diff: 0, percent: 0, oldPrice: prevPrice, isNew: false };

                if (prevPrice === null) {
                    // 初回チェック — 利益商品なら通知
                    shouldAlert = true;
                    priceChange.isNew = true;
                    console.log(`  📊 初回: Amazon ¥${currentPrice.toLocaleString()} / 利益 ¥${profitData.profit.toLocaleString()} (${profitData.profitRate}%)`);
                } else if (currentPrice < prevPrice) {
                    const diff = prevPrice - currentPrice;
                    const percent = (diff / prevPrice) * 100;
                    priceChange = { diff, percent, oldPrice: prevPrice, isNew: false };

                    if (percent >= DROP_THRESHOLD_PERCENT || diff >= DROP_THRESHOLD_YEN) {
                        shouldAlert = true;
                        console.log(`  📉 下落！ ¥${prevPrice.toLocaleString()} → ¥${currentPrice.toLocaleString()} (-${percent.toFixed(1)}%)`);
                    } else {
                        console.log(`  → 微下落 -${percent.toFixed(1)}% (しきい値未満)`);
                    }
                } else {
                    console.log(`  → 価格変動なし/上昇 ¥${currentPrice.toLocaleString()}`);
                }

                // 更新
                item.last_amazon_price = currentPrice;
                item.last_checked = new Date().toISOString();
                item.asin = amazonData.asin;

                if (shouldAlert) {
                    try {
                        await sendDiscordAlert(item, amazonData, priceChange, profitData);
                        alerts++;
                        await sleep(1500); // レート制限対策
                    } catch (e) {
                        console.error(`  ❌ 通知エラー: ${e.message}`);
                    }
                }
            } catch (err) {
                errors++;
                console.error(`  ❌ エラー [${item.jan}]: ${err.message}`);
            }
        }

        // バッチ間のディレイ
        if (i + BATCH_SIZE < watchlist.length) {
            console.log(`  ⏳ 次のバッチまで${BATCH_DELAY_MS / 1000}秒待機...`);
            await sleep(BATCH_DELAY_MS);
        }
    }

    // ウォッチリスト更新保存
    saveWatchlist(watchlist);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ チェック完了 (${elapsed}秒)`);
    console.log(`   チェック: ${checked}件 | アラート: ${alerts}件 | エラー: ${errors}件`);
    console.log('='.repeat(50));
}

// ============================================================
//  エントリポイント
// ============================================================

async function main() {
    console.log('📱 NETSEA価格アラートボット v1.0');
    console.log(`   Keepa API → Amazon価格監視 → Discord通知`);
    console.log(`   監視間隔: ${CHECK_INTERVAL_MS / 60000}分`);
    console.log(`   下落しきい値: ${DROP_THRESHOLD_PERCENT}%以上 or ¥${DROP_THRESHOLD_YEN}以上`);
    console.log(`   利益率フィルタ: ${MIN_PROFIT_RATE}%以上のみ通知`);
    console.log('');

    const isOnce = process.argv.includes('--once');
    const isTest = process.argv.includes('--test');

    if (isTest) {
        console.log('🧪 テスト通知送信...');
        const testItem = { jan: 'TEST', name: 'テスト商品', netsea_price: 500, supplier: 'テストサプライヤー' };
        const testAmazon = { title: 'テスト商品 Amazon', sellingPrice: 1500, salesRank: 1234, asin: 'B000000000', url: 'https://amazon.co.jp', imageUrl: null };
        const testProfit = calcProfit(500, 1500);
        await sendDiscordAlert(testItem, testAmazon, { diff: 200, percent: 11.8, oldPrice: 1700, isNew: false }, testProfit);
        console.log('✅ テスト完了');
        return;
    }

    if (isOnce) {
        console.log('📌 ワンショットモード');
        await checkPrices();
        return;
    }

    // 初回実行
    await checkPrices();

    // 定期巡回
    console.log(`\n⏰ 次回チェック: ${new Date(Date.now() + CHECK_INTERVAL_MS).toLocaleString('ja-JP')}`);
    setInterval(async () => {
        try {
            await checkPrices();
            console.log(`\n⏰ 次回チェック: ${new Date(Date.now() + CHECK_INTERVAL_MS).toLocaleString('ja-JP')}`);
        } catch (e) {
            console.error('❌ チェックエラー:', e.message);
        }
    }, CHECK_INTERVAL_MS);
}

main().catch(e => console.error('❌ 起動エラー:', e.message));
