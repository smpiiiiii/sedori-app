// セドリ利益計算アプリ - メインロジック
(function() {
    'use strict';

    // ===== データ管理 =====
    var STORAGE_KEY = 'sedori_products';

    function loadProducts() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(e) { return []; }
    }
    function saveProducts(products) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(products)); } catch(e) {}
    }

    // ===== 手数料計算 =====
    // カテゴリ別Amazon販売手数料率
    var CATEGORY_FEES = {
        'general': { label: '一般（15%）', rate: 0.15 },
        'electronics': { label: '家電（8%）', rate: 0.08 },
        'camera': { label: 'カメラ（8%）', rate: 0.08 },
        'pc': { label: 'パソコン（8%）', rate: 0.08 },
        'game': { label: 'ゲーム（15%）', rate: 0.15 },
        'toys': { label: 'おもちゃ（10%）', rate: 0.10 },
        'beauty': { label: '美容（8%）', rate: 0.08 },
        'health': { label: '健康（8%）', rate: 0.08 },
        'food': { label: '食品（8%）', rate: 0.08 },
        'books': { label: '本・CD（15%）', rate: 0.15 },
        'fashion': { label: 'ファッション（15%）', rate: 0.15 },
        'sports': { label: 'スポーツ（10%）', rate: 0.10 },
        'hobby': { label: 'ホビー（10%）', rate: 0.10 },
        'cards': { label: 'トレカ（10%）', rate: 0.10 }
    };

    // FBA手数料（サイズ別概算）
    var FBA_FEES = {
        'small': { label: '小型（25cm以下）', fee: 288 },
        'standard': { label: '標準（45cm以下）', fee: 421 },
        'large1': { label: '大型1（60cm以下）', fee: 589 },
        'large2': { label: '大型2（80cm以下）', fee: 712 },
        'oversize': { label: '特大（80cm超）', fee: 1350 }
    };

    // 利益計算
    function calcProfit(sellPrice, buyPrice, category, fbaSize, shippingCost) {
        var catFee = CATEGORY_FEES[category] || CATEGORY_FEES.general;
        var fba = FBA_FEES[fbaSize] || FBA_FEES.standard;
        var shipping = shippingCost || 0;

        var amazonFee = Math.floor(sellPrice * catFee.rate);
        var fbaFee = fba.fee;
        var totalCost = buyPrice + amazonFee + fbaFee + shipping;
        var profit = sellPrice - totalCost;
        var profitRate = sellPrice > 0 ? (profit / sellPrice * 100) : 0;

        return {
            sellPrice: sellPrice,
            buyPrice: buyPrice,
            amazonFee: amazonFee,
            fbaFee: fbaFee,
            shipping: shipping,
            totalCost: totalCost,
            profit: profit,
            profitRate: profitRate
        };
    }

    // ===== ソート・フィルター状態 =====
    var currentSort = { key: 'profit', dir: 'desc' };
    var currentFilter = 'all';
    var searchQuery = '';

    // ===== UI初期化 =====
    function init() {
        renderCategoryOptions();
        renderFBAOptions();
        renderTable();
        updateStats();
        bindEvents();
    }

    // カテゴリセレクト生成
    function renderCategoryOptions() {
        var sel = document.getElementById('addCategory');
        if (!sel) return;
        for (var key in CATEGORY_FEES) {
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = CATEGORY_FEES[key].label;
            sel.appendChild(opt);
        }
    }

    // FBAサイズセレクト生成
    function renderFBAOptions() {
        var sel = document.getElementById('addFBA');
        if (!sel) return;
        for (var key in FBA_FEES) {
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = FBA_FEES[key].label + ' ¥' + FBA_FEES[key].fee;
            sel.appendChild(opt);
        }
    }

    // ===== 統計更新 =====
    function updateStats() {
        var products = loadProducts();
        var totalProfit = 0, totalRevenue = 0, profitableCount = 0;

        products.forEach(function(p) {
            var r = calcProfit(p.sellPrice, p.buyPrice, p.category, p.fbaSize, p.shipping);
            totalProfit += r.profit;
            totalRevenue += r.sellPrice;
            if (r.profit > 0) profitableCount++;
        });

        var avgRate = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;

        document.getElementById('statProfit').textContent = '¥' + totalProfit.toLocaleString();
        document.getElementById('statRevenue').textContent = '¥' + totalRevenue.toLocaleString();
        document.getElementById('statItems').textContent = products.length;
        document.getElementById('statRate').textContent = avgRate.toFixed(1) + '%';
        document.getElementById('statProfitable').textContent = profitableCount + '/' + products.length + '件 利益あり';
    }

    // ===== テーブル描画 =====
    function renderTable() {
        var products = loadProducts();
        var tbody = document.getElementById('productBody');
        var empty = document.getElementById('emptyState');
        if (!tbody) return;
        tbody.innerHTML = '';

        // フィルター
        var filtered = products.filter(function(p) {
            if (searchQuery) {
                var q = searchQuery.toLowerCase();
                if (!(p.name || '').toLowerCase().includes(q) && !(p.asin || '').toLowerCase().includes(q)) return false;
            }
            if (currentFilter === 'all') return true;
            var r = calcProfit(p.sellPrice, p.buyPrice, p.category, p.fbaSize, p.shipping);
            if (currentFilter === 'profit') return r.profit > 0;
            if (currentFilter === 'loss') return r.profit <= 0;
            if (currentFilter === 'high') return r.profitRate >= 20;
            return true;
        });

        // ソート
        filtered.sort(function(a, b) {
            var ra = calcProfit(a.sellPrice, a.buyPrice, a.category, a.fbaSize, a.shipping);
            var rb = calcProfit(b.sellPrice, b.buyPrice, b.category, b.fbaSize, b.shipping);
            var va, vb;
            switch(currentSort.key) {
                case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); break;
                case 'buyPrice': va = a.buyPrice; vb = b.buyPrice; break;
                case 'sellPrice': va = a.sellPrice; vb = b.sellPrice; break;
                case 'profit': va = ra.profit; vb = rb.profit; break;
                case 'profitRate': va = ra.profitRate; vb = rb.profitRate; break;
                default: va = ra.profit; vb = rb.profit;
            }
            if (typeof va === 'string') {
                return currentSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            return currentSort.dir === 'asc' ? va - vb : vb - va;
        });

        if (filtered.length === 0) {
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        filtered.forEach(function(p) {
            var r = calcProfit(p.sellPrice, p.buyPrice, p.category, p.fbaSize, p.shipping);
            var tr = document.createElement('tr');

            var catLabel = CATEGORY_FEES[p.category] ? CATEGORY_FEES[p.category].label.split('（')[0] : '一般';
            var rateClass = r.profitRate >= 20 ? 'high' : r.profitRate >= 10 ? 'mid' : 'low';

            tr.innerHTML = '<td><div class="product-name">' + escHtml(p.name || '') + '</div>' +
                (p.asin ? '<div class="asin-code">' + escHtml(p.asin) + '</div>' : '') + '</td>' +
                '<td><span class="category-badge">' + escHtml(catLabel) + '</span></td>' +
                '<td>¥' + p.buyPrice.toLocaleString() + '</td>' +
                '<td>¥' + p.sellPrice.toLocaleString() + '</td>' +
                '<td class="' + (r.profit >= 0 ? 'profit-positive' : 'profit-negative') + '">¥' + r.profit.toLocaleString() + '</td>' +
                '<td><span class="rate-badge ' + rateClass + '">' + r.profitRate.toFixed(1) + '%</span></td>' +
                '<td class="actions-cell">' +
                    '<button class="btn btn-ghost btn-sm" onclick="sedoriApp.deleteProduct(\'' + p.id + '\')">🗑</button>' +
                '</td>';
            tbody.appendChild(tr);
        });

        // ソートヘッダーのハイライト
        document.querySelectorAll('.data-table th[data-sort]').forEach(function(th) {
            th.classList.toggle('sorted', th.getAttribute('data-sort') === currentSort.key);
        });
    }

    function escHtml(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ===== イベント =====
    function bindEvents() {
        // 商品追加モーダル開閉
        document.getElementById('addBtn').addEventListener('click', function() {
            document.getElementById('addModal').classList.remove('hidden');
            document.getElementById('addName').focus();
        });
        document.getElementById('csvBtn').addEventListener('click', function() {
            document.getElementById('csvModal').classList.remove('hidden');
        });
        document.querySelectorAll('.modal-close').forEach(function(el) {
            el.addEventListener('click', function() {
                this.closest('.modal-overlay').classList.add('hidden');
            });
        });
        document.querySelectorAll('.modal-overlay').forEach(function(el) {
            el.addEventListener('click', function(e) {
                if (e.target === this) this.classList.add('hidden');
            });
        });

        // 商品追加フォーム
        document.getElementById('addForm').addEventListener('submit', function(e) {
            e.preventDefault();
            addProduct();
        });

        // リアルタイム利益プレビュー
        ['addBuyPrice', 'addSellPrice', 'addCategory', 'addFBA', 'addShipping'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('input', updateProfitPreview);
        });

        // 検索
        document.getElementById('searchInput').addEventListener('input', function() {
            searchQuery = this.value;
            renderTable();
        });

        // フィルター
        document.querySelectorAll('.filter-chip').forEach(function(el) {
            el.addEventListener('click', function() {
                document.querySelectorAll('.filter-chip').forEach(function(c) { c.classList.remove('active'); });
                this.classList.add('active');
                currentFilter = this.getAttribute('data-filter');
                renderTable();
            });
        });

        // ソート
        document.querySelectorAll('.data-table th[data-sort]').forEach(function(th) {
            th.addEventListener('click', function() {
                var key = this.getAttribute('data-sort');
                if (currentSort.key === key) {
                    currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.key = key;
                    currentSort.dir = 'desc';
                }
                renderTable();
            });
        });

        // CSV
        var dropzone = document.getElementById('csvDropzone');
        var csvFile = document.getElementById('csvFile');
        if (dropzone) {
            dropzone.addEventListener('click', function() { csvFile.click(); });
            dropzone.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('dragover'); });
            dropzone.addEventListener('dragleave', function() { this.classList.remove('dragover'); });
            dropzone.addEventListener('drop', function(e) {
                e.preventDefault();
                this.classList.remove('dragover');
                if (e.dataTransfer.files.length) handleCSV(e.dataTransfer.files[0]);
            });
            csvFile.addEventListener('change', function() {
                if (this.files.length) handleCSV(this.files[0]);
            });
        }

        // 全削除
        document.getElementById('clearBtn').addEventListener('click', function() {
            if (confirm('全ての商品データを削除しますか？')) {
                saveProducts([]);
                renderTable();
                updateStats();
            }
        });
    }

    // ===== 商品追加 =====
    function addProduct() {
        var name = document.getElementById('addName').value.trim();
        var asin = document.getElementById('addASIN').value.trim();
        var buyPrice = parseInt(document.getElementById('addBuyPrice').value) || 0;
        var sellPrice = parseInt(document.getElementById('addSellPrice').value) || 0;
        var category = document.getElementById('addCategory').value;
        var fbaSize = document.getElementById('addFBA').value;
        var shipping = parseInt(document.getElementById('addShipping').value) || 0;

        if (!name) { alert('商品名を入力してください'); return; }
        if (buyPrice <= 0) { alert('仕入値を入力してください'); return; }
        if (sellPrice <= 0) { alert('販売価格を入力してください'); return; }

        var products = loadProducts();
        products.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: name,
            asin: asin,
            buyPrice: buyPrice,
            sellPrice: sellPrice,
            category: category,
            fbaSize: fbaSize,
            shipping: shipping,
            addedAt: new Date().toISOString()
        });
        saveProducts(products);

        document.getElementById('addForm').reset();
        document.getElementById('addModal').classList.add('hidden');
        updateProfitPreview();
        renderTable();
        updateStats();
    }

    // ===== 商品削除 =====
    function deleteProduct(id) {
        var products = loadProducts().filter(function(p) { return p.id !== id; });
        saveProducts(products);
        renderTable();
        updateStats();
    }

    // ===== 利益プレビュー =====
    function updateProfitPreview() {
        var buyPrice = parseInt(document.getElementById('addBuyPrice').value) || 0;
        var sellPrice = parseInt(document.getElementById('addSellPrice').value) || 0;
        var category = document.getElementById('addCategory').value;
        var fbaSize = document.getElementById('addFBA').value;
        var shipping = parseInt(document.getElementById('addShipping').value) || 0;

        var preview = document.getElementById('profitPreview');
        if (!preview) return;

        if (buyPrice <= 0 || sellPrice <= 0) {
            preview.style.display = 'none';
            return;
        }
        preview.style.display = '';

        var r = calcProfit(sellPrice, buyPrice, category, fbaSize, shipping);

        document.getElementById('prevSell').textContent = '¥' + r.sellPrice.toLocaleString();
        document.getElementById('prevBuy').textContent = '-¥' + r.buyPrice.toLocaleString();
        document.getElementById('prevAmazon').textContent = '-¥' + r.amazonFee.toLocaleString();
        document.getElementById('prevFBA').textContent = '-¥' + r.fbaFee.toLocaleString();
        document.getElementById('prevShip').textContent = '-¥' + r.shipping.toLocaleString();
        var profitEl = document.getElementById('prevProfit');
        profitEl.textContent = '¥' + r.profit.toLocaleString() + ' (' + r.profitRate.toFixed(1) + '%)';
        profitEl.style.color = r.profit >= 0 ? '#55efc4' : '#ff6b6b';
    }

    // ===== CSV処理 =====
    function handleCSV(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var text = e.target.result;
            var lines = text.split('\n');
            var products = loadProducts();
            var added = 0;

            for (var i = 1; i < lines.length; i++) {
                var cols = lines[i].split(',');
                if (cols.length < 3) continue;
                var name = (cols[0] || '').trim().replace(/^"|"$/g, '');
                var buyPrice = parseInt(cols[1]) || 0;
                var sellPrice = parseInt(cols[2]) || 0;
                var asin = (cols[3] || '').trim().replace(/^"|"$/g, '');
                var category = (cols[4] || 'general').trim();

                if (name && buyPrice > 0 && sellPrice > 0) {
                    products.push({
                        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i,
                        name: name,
                        asin: asin,
                        buyPrice: buyPrice,
                        sellPrice: sellPrice,
                        category: CATEGORY_FEES[category] ? category : 'general',
                        fbaSize: 'standard',
                        shipping: 0,
                        addedAt: new Date().toISOString()
                    });
                    added++;
                }
            }

            saveProducts(products);
            document.getElementById('csvModal').classList.add('hidden');
            renderTable();
            updateStats();
            alert(added + '件の商品をインポートしました');
        };
        reader.readAsText(file, 'UTF-8');
    }

    // ===== グローバルAPI =====
    window.sedoriApp = {
        deleteProduct: deleteProduct,
        addProductDirect: function(name, asin, sellPrice) {
            // リサーチタブから利益計算に直接追加（仕入値は手入力）
            document.getElementById('addModal').classList.remove('hidden');
            document.getElementById('addName').value = name;
            document.getElementById('addASIN').value = asin || '';
            document.getElementById('addSellPrice').value = sellPrice || '';
            document.getElementById('addBuyPrice').value = '';
            document.getElementById('addBuyPrice').focus();
            // 利益計算タブに切り替え
            switchTab('calc');
        }
    };

    // ===== タブ切り替え =====
    function switchTab(tabName) {
        // タブボタン
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });
        // タブコンテンツ
        document.getElementById('calcSection').style.display = tabName === 'calc' ? '' : 'none';
        document.getElementById('researchSection').style.display = tabName === 'research' ? '' : 'none';
        // ヘッダー
        var title = document.getElementById('pageTitle');
        var addBtn = document.getElementById('addBtn');
        var csvBtn = document.getElementById('csvBtn');
        if (tabName === 'research') {
            title.textContent = '🔍 リサーチ';
            addBtn.style.display = 'none';
            csvBtn.style.display = 'none';
        } else {
            title.textContent = '📦 セドリ利益計算';
            addBtn.style.display = '';
            csvBtn.style.display = '';
        }
    }

    // タブイベント
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            switchTab(this.getAttribute('data-tab'));
        });
    });

    // ===== Keepa検索 =====
    var keepaSearchBtn = document.getElementById('keepaSearchBtn');
    var keepaSearchInput = document.getElementById('keepaSearchInput');
    var searchLoading = document.getElementById('searchLoading');
    var searchResults = document.getElementById('searchResults');

    if (keepaSearchBtn) {
        keepaSearchBtn.addEventListener('click', doKeepaSearch);
        keepaSearchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') doKeepaSearch();
        });
    }

    function doKeepaSearch() {
        var term = keepaSearchInput.value.trim();
        if (!term) { alert('検索キーワードを入力してください'); return; }

        searchLoading.style.display = '';
        searchResults.innerHTML = '';
        keepaSearchBtn.disabled = true;
        keepaSearchBtn.textContent = '⏳ 検索中...';

        fetch('/api/keepa?action=search&term=' + encodeURIComponent(term))
            .then(function(res) { return res.json(); })
            .then(function(data) {
                searchLoading.style.display = 'none';
                keepaSearchBtn.disabled = false;
                keepaSearchBtn.textContent = '🔍 検索';

                if (data.error) {
                    searchResults.innerHTML = '<div class="research-loading"><p>❌ ' + escHtml(data.error) + '</p></div>';
                    return;
                }
                if (data.tokensLeft !== undefined) {
                    document.getElementById('tokenInfo').textContent = '💰 トークン残量: ' + data.tokensLeft;
                }
                renderSearchResults(data.products || []);
            })
            .catch(function(err) {
                searchLoading.style.display = 'none';
                keepaSearchBtn.disabled = false;
                keepaSearchBtn.textContent = '🔍 検索';
                searchResults.innerHTML = '<div class="research-loading"><p>❌ 通信エラー: ' + escHtml(err.message) + '</p></div>';
            });
    }

    function renderSearchResults(products) {
        if (products.length === 0) {
            searchResults.innerHTML = '<div class="research-loading"><p>商品が見つかりませんでした</p></div>';
            return;
        }

        searchResults.innerHTML = '<div style="color:var(--text2);font-size:13px;margin-bottom:8px">📊 ' + products.length + '件の結果</div>';

        products.forEach(function(p) {
            var card = document.createElement('div');
            card.className = 'result-card';

            var priceStr = p.amazonPrice ? '¥' + p.amazonPrice.toLocaleString() : (p.newPrice ? '¥' + p.newPrice.toLocaleString() : '-');
            var rankStr = p.salesRank ? '#' + p.salesRank.toLocaleString() : '-';

            card.innerHTML =
                (p.imageUrl ? '<img class="result-img" src="' + escHtml(p.imageUrl) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
                '<div class="result-info">' +
                    '<div class="result-title">' + escHtml(p.title) + '</div>' +
                    '<div class="result-meta">' +
                        '<span class="result-tag price">💰 ' + priceStr + '</span>' +
                        '<span class="result-tag rank">📈 ' + rankStr + '</span>' +
                        '<span class="result-tag asin">' + escHtml(p.asin) + '</span>' +
                    '</div>' +
                    (p.category ? '<div style="font-size:11px;color:var(--text2)">' + escHtml(p.category) + '</div>' : '') +
                '</div>' +
                '<div class="result-actions">' +
                    '<button class="btn-add-calc" data-title="' + escHtml(p.title).replace(/"/g, '&quot;') + '" data-asin="' + escHtml(p.asin) + '" data-price="' + (p.sellingPrice || '') + '">📊 利益計算</button>' +
                    '<a class="btn-amazon" href="' + escHtml(p.url) + '" target="_blank">🔗 Amazon</a>' +
                '</div>';

            // 利益計算ボタンのイベント
            card.querySelector('.btn-add-calc').addEventListener('click', function() {
                var title = this.getAttribute('data-title');
                var asin = this.getAttribute('data-asin');
                var price = this.getAttribute('data-price');
                sedoriApp.addProductDirect(title, asin, price);
            });

            searchResults.appendChild(card);
        });
    }

    // 起動
    init();
})();
