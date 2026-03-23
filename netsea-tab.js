// NETSEAタブ — 商品検索・Amazon価格比較ロジック
(function() {
    'use strict';

    // ===== DOM要素 =====
    var searchBtn = document.getElementById('netseaSearchBtn');
    var keywordInput = document.getElementById('netseaKeyword');
    var categorySelect = document.getElementById('netseaCategoryFilter');
    var minPriceInput = document.getElementById('netseaMinPrice');
    var maxPriceInput = document.getElementById('netseaMaxPrice');
    var loadingEl = document.getElementById('netseaLoading');
    var resultsEl = document.getElementById('netseaResults');
    var statusBar = document.getElementById('netseaStatusBar');
    var statusText = document.getElementById('netseaStatusText');

    // ===== 初期化フラグ =====
    var initialized = false;

    // ===== HTMLエスケープ =====
    function esc(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ===== NETSEAタブ初期化（タブ切替時に呼ばれる） =====
    function initNetsea() {
        if (initialized) return;
        initialized = true;
        checkStatus();
        loadCategories();
    }

    // ===== API接続ステータス確認 =====
    function checkStatus() {
        fetch('/api/netsea?action=status')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.connected) {
                    statusBar.className = 'netsea-status-bar connected';
                    statusText.textContent = '✅ ' + data.message;
                } else {
                    statusBar.className = 'netsea-status-bar demo';
                    statusText.textContent = '⚠️ ' + data.message;
                }
            })
            .catch(function() {
                statusBar.className = 'netsea-status-bar error';
                statusText.textContent = '❌ API接続エラー';
            });
    }

    // ===== カテゴリ一覧を取得 =====
    function loadCategories() {
        fetch('/api/netsea?action=categories')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                var categories = data.categories || [];
                categories.forEach(function(cat) {
                    var opt = document.createElement('option');
                    opt.value = cat.name || cat.id;
                    opt.textContent = cat.name;
                    categorySelect.appendChild(opt);
                });
            })
            .catch(function(err) {
                console.error('カテゴリ取得エラー:', err);
            });
    }

    // ===== 商品検索 =====
    function doSearch() {
        var keyword = keywordInput.value.trim();
        var category = categorySelect.value;
        var minPrice = minPriceInput.value;
        var maxPrice = maxPriceInput.value;

        if (!keyword && !category) {
            alert('キーワードまたはカテゴリを指定してください');
            return;
        }

        loadingEl.style.display = '';
        resultsEl.innerHTML = '';
        searchBtn.disabled = true;
        searchBtn.textContent = '⏳ 検索中...';

        var params = 'action=items';
        if (keyword) params += '&keyword=' + encodeURIComponent(keyword);
        if (category) params += '&category=' + encodeURIComponent(category);
        if (minPrice) params += '&minPrice=' + minPrice;
        if (maxPrice) params += '&maxPrice=' + maxPrice;

        fetch('/api/netsea?' + params)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                loadingEl.style.display = 'none';
                searchBtn.disabled = false;
                searchBtn.textContent = '🔍 検索';

                if (data.error) {
                    resultsEl.innerHTML = '<div class="research-loading"><p>❌ ' + esc(data.error) + '</p></div>';
                    return;
                }

                var items = data.items || [];
                if (data.isMock) {
                    resultsEl.innerHTML = '<div class="netsea-mock-notice">📋 デモモード — NETSEAトークン設定後に実データが表示されます</div>';
                }

                renderItems(items);
            })
            .catch(function(err) {
                loadingEl.style.display = 'none';
                searchBtn.disabled = false;
                searchBtn.textContent = '🔍 検索';
                resultsEl.innerHTML = '<div class="research-loading"><p>❌ 通信エラー: ' + esc(err.message) + '</p></div>';
            });
    }

    // ===== 商品カード描画 =====
    function renderItems(items) {
        if (items.length === 0) {
            resultsEl.innerHTML += '<div class="research-loading"><p>商品が見つかりませんでした</p></div>';
            return;
        }

        var countEl = document.createElement('div');
        countEl.className = 'netsea-result-count';
        countEl.textContent = '🏭 ' + items.length + '件の卸商品';
        resultsEl.appendChild(countEl);

        items.forEach(function(item) {
            var card = document.createElement('div');
            card.className = 'result-card netsea-item-card';

            var priceHtml = '¥' + (item.wholesale_price || 0).toLocaleString();
            var retailHtml = item.retail_price ? '¥' + item.retail_price.toLocaleString() : '-';
            var margin = item.retail_price && item.wholesale_price
                ? Math.round((1 - item.wholesale_price / item.retail_price) * 100) + '%'
                : '-';

            card.innerHTML =
                '<div class="result-info">' +
                    '<div class="result-title">' + esc(item.name) + '</div>' +
                    '<div class="result-meta">' +
                        '<span class="result-tag netsea-wholesale">🏭 卸値 ' + priceHtml + '</span>' +
                        '<span class="result-tag netsea-retail">🏪 参考 ' + retailHtml + '</span>' +
                        '<span class="result-tag netsea-margin">📊 粗利率 ' + margin + '</span>' +
                    '</div>' +
                    '<div class="netsea-item-detail">' +
                        (item.supplier ? '<span>🏢 ' + esc(item.supplier) + '</span>' : '') +
                        (item.jan ? '<span>📦 JAN: ' + esc(item.jan) + '</span>' : '') +
                        (item.category ? '<span>📂 ' + esc(item.category) + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="result-actions">' +
                    '<button class="btn-compare-amazon" data-name="' + esc(item.name).replace(/"/g, '&quot;') + '" data-jan="' + esc(item.jan || '') + '" data-price="' + (item.wholesale_price || 0) + '">🔍 Amazon比較</button>' +
                    '<button class="btn-add-calc" data-title="' + esc(item.name).replace(/"/g, '&quot;') + '" data-asin="" data-price="">📊 利益計算</button>' +
                '</div>';

            // Amazon比較ボタン
            card.querySelector('.btn-compare-amazon').addEventListener('click', function() {
                compareWithAmazon(
                    this.getAttribute('data-name'),
                    this.getAttribute('data-jan'),
                    parseInt(this.getAttribute('data-price'))
                );
            });

            // 利益計算に追加ボタン
            card.querySelector('.btn-add-calc').addEventListener('click', function() {
                var title = this.getAttribute('data-title');
                if (window.sedoriApp && window.sedoriApp.addProductDirect) {
                    window.sedoriApp.addProductDirect(title, '', '');
                }
            });

            resultsEl.appendChild(card);
        });
    }

    // ===== Amazon価格比較 =====
    function compareWithAmazon(name, jan, wholesalePrice) {
        var modal = document.getElementById('netseaCompareModal');
        var body = document.getElementById('netseaCompareBody');
        modal.classList.remove('hidden');
        body.innerHTML = '<div class="research-loading"><div class="spinner"></div><p>Amazon価格を検索中...</p></div>';

        var params = 'action=compare&price=' + wholesalePrice;
        if (jan) params += '&jan=' + encodeURIComponent(jan);
        params += '&name=' + encodeURIComponent(name);

        fetch('/api/netsea?' + params)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (!data.found) {
                    body.innerHTML =
                        '<div class="netsea-compare-result">' +
                            '<div class="netsea-compare-header">📦 ' + esc(name) + '</div>' +
                            '<div class="netsea-compare-not-found">' +
                                '<p>❌ Amazonで該当商品が見つかりませんでした</p>' +
                                '<p class="hint">JANコード・キーワードでのマッチングに失敗しました。</p>' +
                            '</div>' +
                        '</div>';
                    return;
                }

                var a = data.amazon;
                var p = data.profit;
                var profitClass = p && p.profit >= 0 ? 'positive' : 'negative';
                var profitSign = p && p.profit >= 0 ? '+' : '';

                body.innerHTML =
                    '<div class="netsea-compare-result">' +
                        '<div class="netsea-compare-header">' + esc(a.title || name) + '</div>' +
                        (a.imageUrl ? '<img class="netsea-compare-img" src="' + esc(a.imageUrl) + '" alt="">' : '') +
                        '<div class="netsea-compare-prices">' +
                            '<div class="netsea-price-row">' +
                                '<span>🏭 NETSEA卸値</span>' +
                                '<span class="netsea-price wholesale">¥' + wholesalePrice.toLocaleString() + '</span>' +
                            '</div>' +
                            '<div class="netsea-price-row">' +
                                '<span>🛒 Amazon販売価格</span>' +
                                '<span class="netsea-price amazon">¥' + (a.sellingPrice || 0).toLocaleString() + '</span>' +
                            '</div>' +
                            (p ? '<div class="netsea-price-row"><span>💳 Amazon手数料</span><span>-¥' + (p.amazonFee || 0).toLocaleString() + '</span></div>' : '') +
                            (p ? '<div class="netsea-price-row"><span>📦 FBA手数料</span><span>-¥' + (p.fbaFee || 0).toLocaleString() + '</span></div>' : '') +
                            (p ? '<div class="netsea-price-row total ' + profitClass + '"><span>💰 純利益</span><span>' + profitSign + '¥' + (p.profit || 0).toLocaleString() + ' (' + (p.profitRate || 0) + '%)</span></div>' : '') +
                        '</div>' +
                        '<div class="netsea-compare-actions">' +
                            '<a class="btn btn-outline" href="' + esc(a.url || '') + '" target="_blank">🔗 Amazonで確認</a>' +
                            '<button class="btn btn-success netsea-add-profit" data-title="' + esc(a.title || name).replace(/"/g, '&quot;') + '" data-asin="' + esc(a.asin || '') + '" data-sell="' + (a.sellingPrice || '') + '">📊 利益計算に追加</button>' +
                        '</div>' +
                    '</div>';

                // 利益計算に追加
                var addBtn = body.querySelector('.netsea-add-profit');
                if (addBtn) {
                    addBtn.addEventListener('click', function() {
                        modal.classList.add('hidden');
                        if (window.sedoriApp && window.sedoriApp.addProductDirect) {
                            window.sedoriApp.addProductDirect(
                                this.getAttribute('data-title'),
                                this.getAttribute('data-asin'),
                                this.getAttribute('data-sell')
                            );
                        }
                    });
                }
            })
            .catch(function(err) {
                body.innerHTML = '<div class="research-loading"><p>❌ エラー: ' + esc(err.message) + '</p></div>';
            });
    }

    // ===== イベントバインド =====
    if (searchBtn) {
        searchBtn.addEventListener('click', doSearch);
    }
    if (keywordInput) {
        keywordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') doSearch();
        });
    }

    // モーダル閉じる
    var compareModal = document.getElementById('netseaCompareModal');
    if (compareModal) {
        compareModal.querySelector('.modal-close').addEventListener('click', function() {
            compareModal.classList.add('hidden');
        });
        compareModal.addEventListener('click', function(e) {
            if (e.target === this) this.classList.add('hidden');
        });
    }

    // タブ切替を監視してNETSEA初期化
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            if (this.getAttribute('data-tab') === 'netsea') {
                initNetsea();
            }
        });
    });
})();
