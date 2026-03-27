/**
 * eBayタブ — 相場検索・利益計算
 * eBay Browse APIで商品検索し、日本仕入値との利益差を計算する
 */

(function() {
  'use strict';

  // ===== 定数 =====
  const EBAY_FEE_PERCENT = 13;  // eBay最終価値手数料
  const PAYMENT_FEE_PERCENT = 3; // 決済手数料
  const DEFAULT_SHIPPING_USD = 20; // デフォルト国際送料

  // ===== 状態管理 =====
  let currentRate = 150; // USD/JPYデフォルト
  let searchResults = [];
  let isSearching = false;

  // ===== 初期化 =====
  document.addEventListener('DOMContentLoaded', () => {
    initEbayTab();
    fetchExchangeRate();
  });

  function initEbayTab() {
    // 検索ボタン
    const searchBtn = document.getElementById('ebaySearchBtn');
    if (searchBtn) searchBtn.addEventListener('click', handleSearch);

    // Enter検索
    const input = document.getElementById('ebayKeyword');
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });

    // ソート変更
    const sortSelect = document.getElementById('ebaySort');
    if (sortSelect) sortSelect.addEventListener('change', handleSearch);

    // マーケット変更
    const marketSelect = document.getElementById('ebayMarket');
    if (marketSelect) marketSelect.addEventListener('change', handleSearch);

    // ローカルストレージからキャッシュ読み込み
    loadCachedResults();
  }

  // ===== 為替レート取得 =====
  async function fetchExchangeRate() {
    try {
      const res = await fetch('/api/ebay?action=rate');
      if (res.ok) {
        const data = await res.json();
        currentRate = data.rate || 150;
      }
    } catch (e) {
      console.warn('為替レート取得失敗、デフォルト値使用:', currentRate);
    }
    updateRateDisplay();
  }

  function updateRateDisplay() {
    const el = document.getElementById('ebayRateDisplay');
    if (el) el.textContent = `$1 = ¥${currentRate.toFixed(1)}`;
  }

  // ===== 検索 =====
  async function handleSearch() {
    const keyword = document.getElementById('ebayKeyword')?.value.trim();
    if (!keyword || isSearching) return;

    const sort = document.getElementById('ebaySort')?.value || 'price';
    const market = document.getElementById('ebayMarket')?.value || 'EBAY_US';

    isSearching = true;
    showLoading(true);
    document.getElementById('ebayResults').innerHTML = '';

    try {
      const params = new URLSearchParams({
        keyword,
        limit: '40',
        sort,
        marketplace: market,
      });

      const res = await fetch(`/api/ebay?${params}`);
      if (!res.ok) throw new Error(`APIエラー (${res.status})`);

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      currentRate = data.exchangeRate || currentRate;
      updateRateDisplay();

      searchResults = data.items || [];
      renderResults(searchResults);

      // キャッシュ保存
      localStorage.setItem('ebay_cache', JSON.stringify({
        keyword, results: searchResults, rate: currentRate, timestamp: Date.now()
      }));

    } catch (err) {
      document.getElementById('ebayResults').innerHTML = `
        <div class="ebay-error">
          <div class="icon">⚠️</div>
          <p>${err.message}</p>
        </div>`;
    } finally {
      isSearching = false;
      showLoading(false);
    }
  }

  function showLoading(show) {
    const el = document.getElementById('ebayLoading');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  // ===== 結果表示 =====
  function renderResults(items) {
    const container = document.getElementById('ebayResults');
    if (!container) return;

    if (!items.length) {
      container.innerHTML = `
        <div class="ebay-empty">
          <div class="icon">🔍</div>
          <p>商品が見つかりませんでした</p>
        </div>`;
      return;
    }

    // 統計
    const prices = items.map(i => i.price);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);

    let html = `
      <div class="ebay-stats-bar">
        <div class="ebay-stat"><span class="label">検索結果</span><span class="value">${items.length}件</span></div>
        <div class="ebay-stat"><span class="label">平均価格</span><span class="value">$${avgPrice.toFixed(2)}</span></div>
        <div class="ebay-stat"><span class="label">最安値</span><span class="value green">$${minP.toFixed(2)}</span></div>
        <div class="ebay-stat"><span class="label">最高値</span><span class="value">$${maxP.toFixed(2)}</span></div>
      </div>
      <div class="ebay-cards">`;

    for (const item of items) {
      const jpyPrice = Math.round(item.price * currentRate);
      const conditionBadge = getConditionBadge(item.condition);

      html += `
        <div class="ebay-card">
          <div class="ebay-card-img">
            ${item.imageUrl ? `<img src="${item.imageUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="no-img">📦</div>'}
          </div>
          <div class="ebay-card-body">
            <a href="${item.url}" target="_blank" class="ebay-card-title">${item.title}</a>
            <div class="ebay-card-meta">
              ${conditionBadge}
              ${item.location ? `<span class="ebay-location">📍${item.location}</span>` : ''}
              ${item.seller ? `<span class="ebay-seller">👤${item.seller}</span>` : ''}
            </div>
            <div class="ebay-card-prices">
              <div class="ebay-price-usd">$${item.price.toFixed(2)}</div>
              <div class="ebay-price-jpy">≈ ¥${jpyPrice.toLocaleString()}</div>
              ${item.shippingText ? `<div class="ebay-shipping">${item.shippingText}</div>` : ''}
            </div>
            <div class="ebay-profit-calc">
              <div class="ebay-calc-row">
                <label>仕入値(円)</label>
                <input type="number" class="ebay-cost-input" placeholder="例: 3000" inputmode="numeric"
                  data-price="${item.price}" data-shipping="${item.shippingCost || 0}"
                  oninput="window.calcEbayProfit(this)">
              </div>
              <div class="ebay-calc-row">
                <label>送料($)</label>
                <input type="number" class="ebay-ship-input" value="${DEFAULT_SHIPPING_USD}" inputmode="numeric"
                  data-price="${item.price}" oninput="window.calcEbayProfit(this)">
              </div>
              <div class="ebay-profit-result" style="display:none"></div>
            </div>
          </div>
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
  }

  function getConditionBadge(condition) {
    const map = {
      'New': ['🆕 新品', 'badge-new'],
      'Used': ['♻️ 中古', 'badge-used'],
      'Refurbished': ['🔧 整備済', 'badge-refurb'],
    };
    const [label, cls] = map[condition] || [condition || '不明', 'badge-other'];
    return `<span class="ebay-condition ${cls}">${label}</span>`;
  }

  // ===== 利益計算 =====
  window.calcEbayProfit = function(inputEl) {
    const card = inputEl.closest('.ebay-card');
    if (!card) return;

    const costInput = card.querySelector('.ebay-cost-input');
    const shipInput = card.querySelector('.ebay-ship-input');
    const resultEl = card.querySelector('.ebay-profit-result');

    const costJpy = parseInt(costInput?.value) || 0;
    const shippingUsd = parseFloat(shipInput?.value) || DEFAULT_SHIPPING_USD;
    const sellPriceUsd = parseFloat(costInput?.dataset.price) || 0;

    if (!costJpy || !sellPriceUsd) {
      resultEl.style.display = 'none';
      return;
    }

    // 利益計算
    const ebayFee = sellPriceUsd * (EBAY_FEE_PERCENT / 100);
    const paymentFee = sellPriceUsd * (PAYMENT_FEE_PERCENT / 100);
    const totalCostUsd = (costJpy / currentRate) + shippingUsd;
    const netProfitUsd = sellPriceUsd - ebayFee - paymentFee - totalCostUsd;
    const netProfitJpy = Math.round(netProfitUsd * currentRate);
    const profitRate = ((netProfitUsd / sellPriceUsd) * 100);

    const isProfit = netProfitJpy > 0;

    resultEl.style.display = 'block';
    resultEl.className = `ebay-profit-result ${isProfit ? 'profit-positive' : 'profit-negative'}`;
    resultEl.innerHTML = `
      <div class="profit-main">
        <span class="profit-icon">${isProfit ? '💰' : '📉'}</span>
        <span class="profit-amount">${isProfit ? '+' : ''}¥${netProfitJpy.toLocaleString()}</span>
        <span class="profit-rate">(${profitRate.toFixed(1)}%)</span>
      </div>
      <div class="profit-detail">
        <span>売値: $${sellPriceUsd.toFixed(2)}</span>
        <span>手数料: -$${(ebayFee + paymentFee).toFixed(2)}</span>
        <span>送料: -$${shippingUsd.toFixed(2)}</span>
        <span>仕入: -$${(costJpy / currentRate).toFixed(2)}</span>
      </div>`;
  };

  // ===== キャッシュ =====
  function loadCachedResults() {
    try {
      const cached = JSON.parse(localStorage.getItem('ebay_cache'));
      if (cached && Date.now() - cached.timestamp < 3600000) { // 1時間以内
        searchResults = cached.results;
        currentRate = cached.rate || currentRate;
        updateRateDisplay();
        if (searchResults.length) {
          renderResults(searchResults);
          const input = document.getElementById('ebayKeyword');
          if (input) input.value = cached.keyword;
        }
      }
    } catch (e) {}
  }

})();
