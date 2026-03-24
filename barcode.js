// バーコードスキャン機能 — スマホカメラでJAN/EANを読み取り
(function() {
    'use strict';

    // ===== 状態管理 =====
    var scanning = false;
    var stream = null;

    // ===== スキャンモーダル開く =====
    window.openBarcodeScanner = function() {
        var modal = document.getElementById('barcodeModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        startCamera();
    };

    // ===== カメラ起動 =====
    function startCamera() {
        var video = document.getElementById('barcodeVideo');
        var status = document.getElementById('barcodeStatus');
        if (!video) return;

        // カメラ権限チェック
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            status.textContent = '❌ このブラウザではカメラが使えません';
            return;
        }

        status.textContent = '📷 カメラを起動中...';

        navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // 背面カメラ
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        })
        .then(function(mediaStream) {
            stream = mediaStream;
            video.srcObject = stream;
            video.play();
            scanning = true;
            status.textContent = '📷 バーコードをカメラに映してください';
            // フレームごとにバーコード検出
            requestAnimationFrame(scanFrame);
        })
        .catch(function(err) {
            console.error('カメラエラー:', err);
            status.textContent = '❌ カメラの起動に失敗: ' + err.message;
        });
    }

    // ===== フレームごとにバーコード検出 =====
    function scanFrame() {
        if (!scanning) return;

        var video = document.getElementById('barcodeVideo');
        var canvas = document.getElementById('barcodeCanvas');
        if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
            requestAnimationFrame(scanFrame);
            return;
        }

        var ctx = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        // BarcodeDetector API（ChromeとSafariで対応）
        if ('BarcodeDetector' in window) {
            var detector = new BarcodeDetector({
                formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']
            });
            detector.detect(canvas)
                .then(function(barcodes) {
                    if (barcodes.length > 0) {
                        onBarcodeDetected(barcodes[0].rawValue);
                        return;
                    }
                    if (scanning) requestAnimationFrame(scanFrame);
                })
                .catch(function() {
                    if (scanning) requestAnimationFrame(scanFrame);
                });
        } else {
            // BarcodeDetector非対応の場合はJAN手入力に切替
            document.getElementById('barcodeStatus').textContent =
                '⚠️ このブラウザはバーコード検出非対応です。下のフォームからJANコードを手入力してください';
            document.getElementById('barcodeManualInput').style.display = '';
            scanning = false;
        }
    }

    // ===== バーコード検出時 =====
    function onBarcodeDetected(code) {
        scanning = false;
        stopCamera();

        var status = document.getElementById('barcodeStatus');
        status.textContent = '✅ 検出: ' + code + ' — 商品情報を検索中...';

        // バイブレーション（対応端末のみ）
        if (navigator.vibrate) navigator.vibrate(200);

        // 検出音
        playBeep();

        // Amazon検索
        searchByJAN(code);
    }

    // ===== JAN→Amazon検索 =====
    function searchByJAN(jan) {
        var resultEl = document.getElementById('barcodeResult');
        resultEl.innerHTML = '<div class="research-loading"><div class="spinner"></div><p>Amazon価格を検索中...</p></div>';

        fetch('/api/keepa?action=search&term=' + encodeURIComponent(jan))
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.error) {
                    resultEl.innerHTML = '<div class="barcode-result-error">❌ ' + escHtml(data.error) + '</div>';
                    return;
                }

                var products = data.products || [];
                if (products.length === 0) {
                    resultEl.innerHTML =
                        '<div class="barcode-result-empty">' +
                            '<p>🔍 JAN: ' + escHtml(jan) + ' の商品が見つかりませんでした</p>' +
                            '<a class="btn btn-outline" href="https://www.amazon.co.jp/s?k=' + encodeURIComponent(jan) + '" target="_blank" style="justify-content:center;display:flex;margin-top:8px;">🛒 Amazonで検索</a>' +
                        '</div>';
                    return;
                }

                var p = products[0];
                var sellPrice = p.amazonPrice || p.newPrice || p.sellingPrice || 0;
                var breakeven = calcBreakeven(sellPrice, 'general', 'standard', 0);

                resultEl.innerHTML =
                    '<div class="barcode-result-card">' +
                        (p.imageUrl ? '<img class="barcode-result-img" src="' + escHtml(p.imageUrl) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
                        '<div class="barcode-result-info">' +
                            '<div class="barcode-result-title">' + escHtml(p.title) + '</div>' +
                            '<div class="barcode-result-meta">' +
                                '<span class="result-tag price">💰 Amazon ¥' + sellPrice.toLocaleString() + '</span>' +
                                '<span class="result-tag rank">📈 #' + (p.salesRank || '-').toLocaleString() + '</span>' +
                            '</div>' +
                            '<div class="barcode-breakeven">' +
                                '📊 損益分岐点: <strong>¥' + breakeven.toLocaleString() + '</strong> 以下で仕入れれば利益' +
                            '</div>' +
                            '<div class="barcode-result-jan">📦 JAN: ' + escHtml(jan) + ' | ASIN: ' + escHtml(p.asin || '-') + '</div>' +
                        '</div>' +
                        '<div class="barcode-result-actions">' +
                            '<button class="btn btn-success" onclick="addFromBarcode(\'' + escHtml(p.title).replace(/'/g, "\\'") + '\', \'' + escHtml(p.asin || '') + '\', ' + sellPrice + ')">📊 利益計算に追加</button>' +
                            '<button class="btn btn-outline" onclick="openBarcodeScanner()">📷 続けてスキャン</button>' +
                        '</div>' +
                    '</div>';
            })
            .catch(function(err) {
                resultEl.innerHTML = '<div class="barcode-result-error">❌ 検索エラー: ' + escHtml(err.message) + '</div>';
            });
    }

    // ===== 損益分岐点計算 =====
    function calcBreakeven(sellPrice, category, fbaSize, shipping) {
        // カテゴリ別手数料率
        var rates = {
            'general': 0.15, 'electronics': 0.08, 'camera': 0.08,
            'toys': 0.10, 'beauty': 0.08, 'food': 0.08,
            'books': 0.15, 'fashion': 0.15, 'sports': 0.10,
            'hobby': 0.10, 'cards': 0.10
        };
        // FBA手数料
        var fbaFees = {
            'small': 288, 'standard': 421, 'large1': 589, 'large2': 712, 'oversize': 1350
        };
        var rate = rates[category] || 0.15;
        var fba = fbaFees[fbaSize] || 421;
        var amazonFee = Math.floor(sellPrice * rate);
        // 損益分岐点 = 売価 - Amazon手数料 - FBA手数料 - 送料
        return sellPrice - amazonFee - fba - (shipping || 0);
    }

    // ===== 利益計算に追加 =====
    window.addFromBarcode = function(title, asin, sellPrice) {
        var modal = document.getElementById('barcodeModal');
        modal.classList.add('hidden');
        stopCamera();
        if (window.sedoriApp && window.sedoriApp.addProductDirect) {
            window.sedoriApp.addProductDirect(title, asin, sellPrice);
        }
    };

    // ===== JAN手入力 =====
    window.submitManualJAN = function() {
        var input = document.getElementById('manualJANInput');
        var jan = (input.value || '').trim();
        if (!jan || jan.length < 8) {
            alert('8桁以上のJANコードを入力してください');
            return;
        }
        onBarcodeDetected(jan);
    };

    // ===== カメラ停止 =====
    function stopCamera() {
        scanning = false;
        if (stream) {
            stream.getTracks().forEach(function(t) { t.stop(); });
            stream = null;
        }
    }

    // ===== モーダル閉じる =====
    var barcodeModal = document.getElementById('barcodeModal');
    if (barcodeModal) {
        barcodeModal.querySelector('.modal-close').addEventListener('click', function() {
            barcodeModal.classList.add('hidden');
            stopCamera();
        });
        barcodeModal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.add('hidden');
                stopCamera();
            }
        });
    }

    // ===== 検出音 =====
    function playBeep() {
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 1200;
            gain.gain.value = 0.3;
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
        } catch(e) {}
    }

    // ===== HTMLエスケープ =====
    function escHtml(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }
})();
