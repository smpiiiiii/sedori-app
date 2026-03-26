// NETSEAタブ — サプライヤー選択→商品一覧→Amazon価格比較
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

    // ===== 状態管理 =====
    var initialized = false;
    var supplierList = [];
    var selectedSupplierId = '';

    // ===== HTMLエスケープ =====
    function esc(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ===== NETSEAタブ初期化 =====
    function initNetsea() {
        if (initialized) return;
        initialized = true;
        checkStatus();
        loadSuppliers();
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

    // ===== サプライヤー一覧を取得→セレクトに表示 =====
    function loadSuppliers() {
        fetch('/api/netsea?action=suppliers')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                supplierList = Array.isArray(data.suppliers) ? data.suppliers : (data.suppliers && data.suppliers.data ? data.suppliers.data : []);
                var sel = document.getElementById('netseaCategoryFilter');
                // カテゴリではなくサプライヤーを表示
                sel.innerHTML = '<option value="">-- サプライヤーを選択 --</option>';
                supplierList.forEach(function(s) {
                    var opt = document.createElement('option');
                    opt.value = s.id || s.supplier_id || '';
                    opt.textContent = (s.name || s.supplier_name || '') + (s.category ? ' (' + s.category + ')' : '');
                    sel.appendChild(opt);
                });
                // ラベル更新
                var label = sel.previousElementSibling;
                if (label && label.tagName === 'LABEL') {
                    label.textContent = 'サプライヤー';
                }
            })
            .catch(function(err) {
                console.error('サプライヤー取得エラー:', err);
            });
    }

    // ===== 商品検索 =====
    function doSearch() {
        var supplierId = categorySelect.value;
        var keyword = keywordInput.value.trim();
        var minPrice = minPriceInput.value;
        var maxPrice = maxPriceInput.value;

        if (!supplierId && !keyword) {
            alert('サプライヤーを選択するか、キーワードを入力してください');
            return;
        }

        loadingEl.style.display = '';
        resultsEl.innerHTML = '';
        searchBtn.disabled = true;
        searchBtn.textContent = '⏳ 検索中...';

        var params = 'action=items';
        if (supplierId) params += '&supplier_id=' + encodeURIComponent(supplierId);
        if (keyword) params += '&keyword=' + encodeURIComponent(keyword);
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

                renderItems(items, data.nextId);
            })
            .catch(function(err) {
                loadingEl.style.display = 'none';
                searchBtn.disabled = false;
                searchBtn.textContent = '🔍 検索';
                resultsEl.innerHTML = '<div class="research-loading"><p>❌ 通信エラー: ' + esc(err.message) + '</p></div>';
            });
    }

    // ===== 商品カード描画 =====
    function renderItems(items, nextId) {
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
                (item.image ? '<img class="result-img" src="' + esc(item.image) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
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
                        (item.min_lot > 1 ? '<span>📋 最小ロット: ' + item.min_lot + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="result-actions">' +
                    (function() {
                        var netseaLink = item.netsea_url || '';
                        if (!netseaLink && item.id) {
                            netseaLink = 'https://www.netsea.jp/shop/' + (item.supplier_id || '') + '/' + item.id;
                        }
                        return netseaLink ? '<a class="btn-netsea-link" href="' + esc(netseaLink) + '" target="_blank" rel="noopener">🛒 NETSEAで購入</a>' : '';
                    })() +
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
                if (window.sedoriApp && window.sedoriApp.addProductDirect) {
                    window.sedoriApp.addProductDirect(this.getAttribute('data-title'), '', '');
                }
            });

            resultsEl.appendChild(card);
        });

        // もっと読み込むボタン
        if (nextId) {
            var moreBtn = document.createElement('button');
            moreBtn.className = 'btn btn-outline';
            moreBtn.style.cssText = 'width:100%;margin-top:12px;justify-content:center;';
            moreBtn.textContent = '📦 もっと読み込む';
            moreBtn.addEventListener('click', function() {
                moreBtn.remove();
                loadMore(nextId);
            });
            resultsEl.appendChild(moreBtn);
        }
    }

    // ===== もっと読み込む =====
    function loadMore(nextId) {
        var supplierId = categorySelect.value;
        var params = 'action=items&supplier_id=' + encodeURIComponent(supplierId) + '&next_id=' + nextId;
        fetch('/api/netsea?' + params)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                renderItems(data.items || [], data.nextId);
            })
            .catch(function(err) {
                console.error('追加読み込みエラー:', err);
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
                    var amazonSearchUrl = 'https://www.amazon.co.jp/s?k=' + encodeURIComponent(name);
                    body.innerHTML =
                        '<div class="netsea-compare-result">' +
                            '<div class="netsea-compare-header">📦 ' + esc(name) + '</div>' +
                            '<div class="netsea-compare-not-found">' +
                                '<p>🔍 自動検索でマッチしませんでした</p>' +
                                '<p class="hint">Amazonで直接検索して確認してください</p>' +
                                '<a class="btn btn-outline" href="' + amazonSearchUrl + '" target="_blank" style="margin-top:10px;justify-content:center;display:flex;">🛒 Amazonで検索する</a>' +
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
                            (p && p.shippingCost ? '<div class="netsea-price-row"><span>🚚 仕入れ送料</span><span>-¥' + (p.shippingCost || 0).toLocaleString() + '</span></div>' : '') +
                            (p ? '<div class="netsea-price-row total ' + profitClass + '"><span>💰 純利益</span><span>' + profitSign + '¥' + (p.profit || 0).toLocaleString() + ' (' + (p.profitRate || 0) + '%)</span></div>' : '') +
                        '</div>' +
                        '<div class="netsea-compare-actions">' +
                            '<a class="btn btn-outline" href="' + esc(a.url || '') + '" target="_blank">🔗 Amazonで確認</a>' +
                            '<button class="btn btn-success netsea-add-profit" data-title="' + esc(a.title || name).replace(/"/g, '&quot;') + '" data-asin="' + esc(a.asin || '') + '" data-sell="' + (a.sellingPrice || '') + '">📊 利益計算に追加</button>' +
                        '</div>';

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

    // ===== NETSEAスキャン（承認済みサプライヤー商品を取得） =====
    function doScan() {
        var scanBtn = document.getElementById('netseaScanBtn');
        var scanLoading = document.getElementById('netseaScanLoading');
        var scanResults = document.getElementById('netseaScanResults');
        if (!scanBtn) return;

        scanBtn.disabled = true;
        scanBtn.textContent = '⏳ スキャン中...';
        scanLoading.style.display = '';
        scanResults.innerHTML = '';

        fetch('/api/netsea?action=scan')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                scanLoading.style.display = 'none';
                scanBtn.disabled = false;
                scanBtn.textContent = '🔍 承認済み商品をスキャン';

                // localStorageに保存
                try {
                    localStorage.setItem('netsea_scan_data', JSON.stringify({
                        items: data.items,
                        message: data.message,
                        janCount: data.janCount,
                        total: data.total,
                        savedAt: new Date().toISOString(),
                    }));
                } catch(e) {}

                renderScanResults(data, scanResults);
            })
            .catch(function(err) {
                scanLoading.style.display = 'none';
                scanBtn.disabled = false;
                scanBtn.textContent = '🔍 承認済み商品をスキャン';
                scanResults.innerHTML = '<div class="netsea-scan-empty"><p>❌ エラー: ' + esc(err.message) + '</p></div>';
            });
    }

    // ===== スキャン結果レンダリング（localStorage復元にも使用） =====
    function renderScanResults(data, scanResults) {
        if (!data.items || data.items.length === 0) {
            scanResults.innerHTML =
                '<div class="netsea-scan-empty">' +
                    '<p>📭 ' + esc(data.message || '商品が見つかりませんでした') + '</p>' +
                    '<p class="hint">サプライヤーの取引承認が降りると、ここに利益商品が表示されます</p>' +
                '</div>';
            return;
        }

        // 保存日時
        var savedInfo = '';
        if (data.savedAt) {
            var d = new Date(data.savedAt);
            savedInfo = '<div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:4px;">📅 ' + d.toLocaleDateString('ja-JP') + ' ' + d.toLocaleTimeString('ja-JP', {hour:'2-digit',minute:'2-digit'}) + ' のスキャン結果</div>';
        }

        // JANフィルター付きメッセージ表示
        var filterHtml = '';
        if (data.janCount > 0) {
            filterHtml = '<div style="margin:8px 0;display:flex;gap:6px;flex-wrap:wrap;">' +
                '<button id="janFilterAll" onclick="window._janFilter(false)" style="padding:4px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:#fff;font-size:12px;cursor:pointer;">📦 全商品 (' + data.items.length + ')</button>' +
                '<button id="janFilterJan" onclick="window._janFilter(true)" style="padding:4px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:transparent;color:rgba(255,255,255,.7);font-size:12px;cursor:pointer;">🏷️ JAN付きのみ (' + data.janCount + ')</button>' +
            '</div>';
        }
        scanResults.innerHTML = '<div class="netsea-result-count">🏭 ' + data.message + '</div>' + savedInfo + filterHtml;

        // フィルター機能
        window._scanItems = data.items;
        window._janFilter = function(janOnly) {
            var allBtn = document.getElementById('janFilterAll');
            var janBtn = document.getElementById('janFilterJan');
            if (allBtn && janBtn) {
                allBtn.style.background = janOnly ? 'transparent' : 'rgba(255,255,255,.15)';
                allBtn.style.color = janOnly ? 'rgba(255,255,255,.7)' : '#fff';
                janBtn.style.background = janOnly ? 'rgba(255,255,255,.15)' : 'transparent';
                janBtn.style.color = janOnly ? '#fff' : 'rgba(255,255,255,.7)';
            }
            var cards = scanResults.querySelectorAll('.netsea-scan-card');
            cards.forEach(function(card, i) {
                var item = window._scanItems[i];
                if (!item) return;
                var hasJan = item.jan && item.jan.length >= 8;
                card.style.display = (janOnly && !hasJan) ? 'none' : '';
            });
        };

        // 表示件数を制限してクラッシュ防止（20件ずつ表示）
        var PAGE_SIZE = 20;
        window._scanShowCount = PAGE_SIZE;

        function renderScanCards(items, container, startIdx, count) {
            var end = Math.min(startIdx + count, items.length);
            for (var i = startIdx; i < end; i++) {
                var item = items[i];
                var card = document.createElement('div');
                card.className = 'result-card netsea-scan-card';

                var marginClass = item.margin >= 40 ? 'margin-high' : (item.margin >= 20 ? 'margin-mid' : 'margin-low');
                var netseaLink = item.netsea_url || ('https://www.netsea.jp/shop/' + (item.supplier_id || '') + '/' + (item.id || ''));

                card.innerHTML =
                    (item.image ? '<img class="result-img" src="' + esc(item.image) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
                    '<div class="result-info">' +
                        '<div class="result-title">' + esc(item.name) + '</div>' +
                        '<div class="result-meta">' +
                            '<span class="result-tag netsea-wholesale">🏭 卸値 ¥' + (item.wholesale_price || 0).toLocaleString() + '</span>' +
                            '<span class="result-tag netsea-retail">🏪 参考 ¥' + (item.retail_price || 0).toLocaleString() + '</span>' +
                            '<span class="result-tag ' + marginClass + '">📊 粗利 ' + (item.margin || 0) + '%</span>' +
                        '</div>' +
                        '<div class="netsea-item-detail">' +
                            '<span>🏢 ' + esc(item.supplier || '') + '</span>' +
                            (item.jan ? '<span>📦 JAN: ' + esc(item.jan) + '</span>' : '') +
                        '</div>' +
                        '<div class="recommend-links" style="margin-top:6px;">' +
                            '<a href="' + esc(netseaLink) + '" target="_blank" class="link-netsea">🛒 NETSEAで購入</a>' +
                            '<a href="https://www.amazon.co.jp/s?k=' + encodeURIComponent(item.name) + '" target="_blank" class="link-amazon">🔗 Amazon相場</a>' +
                        '</div>' +
                    '</div>' +
                    '<div class="result-actions">' +
                        '<button class="btn-compare-amazon" data-name="' + esc(item.name).replace(/"/g, '&quot;') + '" data-jan="' + esc(item.jan || '') + '" data-price="' + (item.wholesale_price || 0) + '">🔍 利益計算</button>' +
                        (item.jan && item.jan.length >= 8 ? '<button class="btn-watch" data-jan="' + esc(item.jan) + '" data-name="' + esc(item.name).replace(/"/g, '&quot;') + '" data-price="' + (item.wholesale_price || 0) + '" data-supplier="' + esc(item.supplier || '').replace(/"/g, '&quot;') + '" style="background:#7c4dff;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;margin-top:4px">📱 監視追加</button>' : '') +
                    '</div>';

                card.querySelector('.btn-compare-amazon').addEventListener('click', function() {
                    compareWithAmazon(
                        this.getAttribute('data-name'),
                        this.getAttribute('data-jan'),
                        parseInt(this.getAttribute('data-price'))
                    );
                });

                var watchBtn = card.querySelector('.btn-watch');
                if (watchBtn) {
                    watchBtn.addEventListener('click', function() {
                        var btn = this;
                        var params = 'action=watchlist-add' +
                            '&jan=' + encodeURIComponent(btn.getAttribute('data-jan')) +
                            '&name=' + encodeURIComponent(btn.getAttribute('data-name')) +
                            '&price=' + btn.getAttribute('data-price') +
                            '&supplier=' + encodeURIComponent(btn.getAttribute('data-supplier'));
                        btn.disabled = true;
                        btn.textContent = '⏳ 追加中...';
                        fetch('/api/netsea?' + params)
                            .then(function(r) { return r.json(); })
                            .then(function(d) {
                                btn.textContent = '✅ 監視中';
                                btn.style.background = '#388e3c';
                            })
                            .catch(function() {
                                btn.textContent = '❌ エラー';
                                btn.disabled = false;
                            });
                    });
                }

                container.appendChild(card);
            }
        }

        // 最初の20件だけ描画
        renderScanCards(data.items, scanResults, 0, PAGE_SIZE);

        // 「もっと見る」ボタン
        if (data.items.length > PAGE_SIZE) {
            var moreBtn = document.createElement('button');
            moreBtn.className = 'btn btn-outline';
            moreBtn.id = 'scanMoreBtn';
            moreBtn.style.cssText = 'width:100%;margin-top:12px;justify-content:center;padding:12px;font-size:14px;';
            moreBtn.textContent = '📦 もっと見る（残り' + (data.items.length - PAGE_SIZE) + '件）';
            moreBtn.addEventListener('click', function() {
                var current = window._scanShowCount || PAGE_SIZE;
                renderScanCards(data.items, scanResults, current, PAGE_SIZE);
                window._scanShowCount = current + PAGE_SIZE;
                if (window._scanShowCount >= data.items.length) {
                    moreBtn.remove();
                } else {
                    moreBtn.textContent = '📦 もっと見る（残り' + (data.items.length - window._scanShowCount) + '件）';
                    scanResults.appendChild(moreBtn);
                }
            });
            scanResults.appendChild(moreBtn);
        }
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
    var scanBtn = document.getElementById('netseaScanBtn');
    if (scanBtn) {
        scanBtn.addEventListener('click', doScan);
    }

    // ===== localStorage から前回スキャン結果を復元 =====
    try {
        var saved = localStorage.getItem('netsea_scan_data');
        if (saved) {
            var savedData = JSON.parse(saved);
            var scanResults = document.getElementById('netseaScanResults');
            if (savedData.items && savedData.items.length > 0 && scanResults) {
                renderScanResults(savedData, scanResults);
            }
        }
    } catch(e) {}

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
