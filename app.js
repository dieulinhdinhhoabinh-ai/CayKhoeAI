/* Cây Khỏe AI – bản chạy hoàn toàn trên trình duyệt (không cần máy chủ).
   Logic dự đoán chuyển nguyên từ botchat.py + app.py của bản Flask. */
(function () {
  'use strict';

  // ================== CẤU HÌNH (giống botchat.py) ==================
  const MODEL_URL = 'model/model.json';
  const MODEL_CACHE = 'indexeddb://caykhoeai-model-v1';   // đổi tên khi thay mô hình mới
  const INPUT_SIZE = 224;
  const CONFIDENCE_LOW = 0.60;
  const CONFIDENCE_MEDIUM = 0.80;
  const HISTORY_KEY = 'caykhoeai_history_v1';
  const HISTORY_MAX = 15;

  const cac_lop = [
    'benh_loet_chanh', 'cam_bi_xi_mu', 'cam_khoe_manh', 'chanh_khoe_manh', 'chanh_vang_la',
    'lua_bi_nam', 'lua_binh_thuong', 'lua_sau_cuon_la', 'lua_sau_duc_than',
    'mia_gi_sat', 'mia_khoe_manh', 'mia_thoi_do', 'ngo_chay_la', 'ngo_khoe_manh'
  ];
  const ten_benh_map = {
    benh_loet_chanh: 'Bệnh loét chanh', cam_bi_xi_mu: 'Cam bị xì mủ', cam_khoe_manh: 'Cam khoẻ mạnh',
    chanh_khoe_manh: 'Chanh khoẻ mạnh', chanh_vang_la: 'Chanh vàng lá', lua_bi_nam: 'Lúa bị nấm',
    lua_binh_thuong: 'Lúa bình thường', lua_sau_cuon_la: 'Lúa sâu cuốn lá', lua_sau_duc_than: 'Lúa sâu đục thân',
    mia_gi_sat: 'Mía gỉ sắt', mia_khoe_manh: 'Mía khoẻ mạnh', mia_thoi_do: 'Mía thối đỏ',
    ngo_chay_la: 'Ngô cháy lá', ngo_khoe_manh: 'Ngô khoẻ mạnh'
  };

  // ================== PHẦN TỬ GIAO DIỆN ==================
  const $ = (id) => document.getElementById(id);
  const chatBox = $('chat-box'), emptyState = $('emptyState');
  const fileInput = $('fileInput'), fileName = $('fileName');
  const sendBtn = $('sendBtn'), form = $('chatForm');
  const statusBox = $('modelStatus'), statusText = $('modelStatusText'), progressBar = $('modelProgress');

  let mo_hinh = null, thong_tin_benh = {}, busy = false;

  function setStatus(text, kind) {
    statusText.textContent = text;
    statusBox.classList.remove('error', 'ready');
    if (kind) statusBox.classList.add(kind);
  }

  // ================== NẠP MÔ HÌNH + KHO TRI THỨC ==================
  async function loadAll() {
    try {
      const res = await fetch('dieu_tri.json', { cache: 'no-cache' });
      thong_tin_benh = await res.json();
    } catch (e) { console.warn('Không đọc được dieu_tri.json', e); }

    await tf.ready();
    try {
      mo_hinh = await tf.loadLayersModel(MODEL_CACHE);           // đã lưu trên máy từ lần trước
      setStatus('Mô hình AI đã sẵn sàng (đã lưu trên máy, dùng được cả khi mạng yếu).', 'ready');
    } catch (e) {
      setStatus('Đang tải mô hình AI lần đầu (khoảng 10 MB), vui lòng chờ…');
      mo_hinh = await tf.loadLayersModel(MODEL_URL, {
        onProgress: (p) => { progressBar.style.width = Math.round(p * 100) + '%'; }
      });
      try { await mo_hinh.save(MODEL_CACHE); } catch (e2) { console.warn('Không lưu được mô hình vào máy', e2); }
      setStatus('Mô hình AI đã sẵn sàng.', 'ready');
    }
    // chạy thử 1 lần để lần chẩn đoán đầu nhanh hơn
    tf.tidy(() => mo_hinh.predict(tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3])).dataSync());
    progressBar.parentElement.style.display = 'none';
    setTimeout(() => { statusBox.style.display = 'none'; }, 4000);
    updateSendState();
  }

  // ================== ĐỌC ẢNH ==================
  async function decodeImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file); } catch (e) { /* thử cách khác */ }
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  function srcSize(src) {
    return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
  }

  /* Đưa ảnh về 224×224 theo kiểu "nearest" – giống hệt image.load_img(target_size) của Keras (Pillow NEAREST).
     Pillow cộng dồn bước nhảy: v = 0.5*s; mỗi điểm lấy floor(v) rồi v += s (đã kiểm tra khớp 100%). */
  function nearestIndex(n) {
    const s = n / INPUT_SIZE, idx = new Int32Array(INPUT_SIZE);
    let v = 0.5 * s;
    for (let i = 0; i < INPUT_SIZE; i++) { idx[i] = Math.min(n - 1, Math.floor(v)); v += s; }
    return idx;
  }
  function toInputPixels(src) {
    const { w, h } = srcSize(src);
    const MAXPIX = 16000000;                       // giới hạn kích thước canvas của Safari trên iPhone
    let full, fw = w, fh = h;
    if (w * h <= MAXPIX) {
      full = document.createElement('canvas'); full.width = w; full.height = h;
      const fctx = full.getContext('2d', { willReadFrequently: true });
      fctx.drawImage(src, 0, 0);
    } else {                                        // ảnh quá lớn: thu nhỏ trước, vẫn giữ cách lấy mẫu nearest
      const s = Math.sqrt(MAXPIX / (w * h)); fw = Math.floor(w * s); fh = Math.floor(h * s);
      full = document.createElement('canvas'); full.width = fw; full.height = fh;
      const fctx = full.getContext('2d', { willReadFrequently: true });
      fctx.imageSmoothingEnabled = false; fctx.drawImage(src, 0, 0, fw, fh);
    }
    const ctx = full.getContext('2d', { willReadFrequently: true });
    const out = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
    const xs = nearestIndex(fw), ys = nearestIndex(fh);
    let k = 0;
    for (let y = 0; y < INPUT_SIZE; y++) {
      const yy = ys[y];
      const row = ctx.getImageData(0, yy, fw, 1).data;   // đọc 1 hàng
      for (let x = 0; x < INPUT_SIZE; x++) {
        const i = xs[x] * 4;
        out[k++] = row[i] / 255; out[k++] = row[i + 1] / 255; out[k++] = row[i + 2] / 255;
      }
    }
    return out;
  }

  function thumbnailDataURL(src, maxSide) {
    const { w, h } = srcSize(src);
    const s = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }

  // ================== DỰ ĐOÁN (giống du_doan_benh trong botchat.py) ==================
  function thoiDiemVN() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.day}/${p.month}/${p.year} - ${p.hour}:${p.minute}:${p.second}`;
  }

  function predictPixels(pixels) {
    return tf.tidy(() => Array.from(
      mo_hinh.predict(tf.tensor4d(pixels, [1, INPUT_SIZE, INPUT_SIZE, 3])).dataSync()));
  }

  function du_doan_benh(preds) {
    const thoi_diem = thoiDiemVN();
    const order = preds.map((v, i) => i).sort((a, b) => preds[b] - preds[a]);
    const top3 = order.slice(0, 3).map((i) => ({
      label: cac_lop[i], ten_hien_thi: ten_benh_map[cac_lop[i]] || cac_lop[i],
      confidence: Math.round(preds[i] * 10000) / 10000
    }));
    const idx = order[0], label = cac_lop[idx], confidence = preds[idx];
    const level = confidence < CONFIDENCE_LOW ? 'THẤP' : (confidence < CONFIDENCE_MEDIUM ? 'TRUNG BÌNH' : 'CAO');
    const info = thong_tin_benh[label] || null;
    const ten = ten_benh_map[label] || label;

    const t = [];
    t.push(`THỜI GIAN CHẨN ĐOÁN: ${thoi_diem}`, '');
    t.push(`MỨC ĐỘ TIN CẬY CỦA AI: ${Math.floor(confidence * 100)}% (${level})`, '');
    t.push(`CHẨN ĐOÁN CHÍNH: ${ten}`, '');
    t.push('TOP 3 DỰ ĐOÁN CỦA AI:');
    top3.forEach((it, i) => t.push(`${i + 1}. ${it.ten_hien_thi} – ${Math.floor(it.confidence * 100)}%`));
    t.push('');
    if (info) {
      if (info.nguyen_nhan) t.push('NGUYÊN NHÂN:', info.nguyen_nhan, '');
      if (info.dau_hieu && info.dau_hieu.length) { t.push('DẤU HIỆU BỆNH:'); info.dau_hieu.forEach((d) => t.push(`- ${d}`)); t.push(''); }
      if ((info.ten_thuoc && info.ten_thuoc.length) || info.lieu_luong || info.huong_dan_phun) {
        t.push('CÁCH ĐIỀU TRỊ:', '');
        if (info.ten_thuoc && info.ten_thuoc.length) t.push('Thuốc điều trị: ' + info.ten_thuoc.join(', '), '');
        if (info.lieu_luong) t.push('Liều lượng: ' + info.lieu_luong, '');
        if (info.huong_dan_phun) t.push('Hướng dẫn sử dụng:', info.huong_dan_phun, '');
      }
    }
    t.push('LƯU Ý:');
    if (level === 'CAO') t.push('Kết quả trên mang tính tham khảo. Vui lòng đối chiếu với tình trạng thực tế vườn cây và hướng dẫn của cán bộ kỹ thuật/nông nghiệp tại địa phương.');
    else if (level === 'TRUNG BÌNH') t.push('Mức độ tin cậy của AI ở mức TRUNG BÌNH. Nên chụp thêm ảnh ở nhiều góc khác nhau và tham khảo ý kiến cán bộ kỹ thuật trước khi quyết định phun thuốc.');
    else t.push('Mức độ tin cậy của AI đang THẤP. Vui lòng chụp lại ảnh rõ hơn ở nhiều góc, hoặc liên hệ cán bộ kỹ thuật để được chẩn đoán trực tiếp trước khi xử lý.');

    // phần cảnh báo đầu như app.py
    let text = t.join('\n');
    if (level === 'THẤP') text = '⚠️ CẢNH BÁO: Độ tin cậy của AI THẤP. Vui lòng chụp thêm ảnh rõ hơn ở nhiều góc và tham khảo cán bộ kỹ thuật trước khi xử lý.\n\n✅ [MÔ HÌNH AI]\n' + text;
    else if (level === 'TRUNG BÌNH') text = '⚠️ LƯU Ý: AI CHƯA HOÀN TOÀN CHẮC CHẮN. Nên đối chiếu thêm với tình trạng thực tế vườn cây và ý kiến chuyên gia trước khi phun thuốc.\n\n✅ [MÔ HÌNH AI]\n' + text;
    else text = '✅ [MÔ HÌNH AI]\n' + text;

    return { label, ten_benh: ten, confidence, confidence_level: level, top3, thoi_diem_chan_doan: thoi_diem, text };
  }

  // ================== LỊCH SỬ (lưu trên máy người dùng) ==================
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveHistory(list) {
    let arr = list.slice(-HISTORY_MAX);
    while (arr.length) {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); return; }
      catch (e) { arr = arr.slice(1); }           // đầy bộ nhớ: bỏ bớt bản cũ nhất
    }
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* bỏ qua */ }
  }

  // ================== HIỂN THỊ ==================
  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderEntry(entry, index) {
    emptyState.style.display = 'none';
    const msg = document.createElement('div');
    msg.className = 'message bot';
    const warn = entry.level === 'THẤP' || entry.level === 'TRUNG BÌNH';
    const percent = Math.floor(entry.confidence * 100);
    msg.innerHTML = `
      <div class="message-group">
        <img src="${entry.img}" class="chat-image" alt="Ảnh chẩn đoán">
        <div class="diagnosis-content">
          ${warn ? '<span class="status-badge status-error">⚠️ Cảnh báo</span>'
                 : '<span class="status-badge status-model">🔬 Mô hình AI</span>'}
          <div class="confidence-wrapper">
            <div class="confidence-label">Thanh mức độ tin cậy</div>
            <div class="confidence-bar" style="--confidence-percent:${percent}%"><div class="confidence-bar-fill"></div></div>
          </div>
          <pre>${escapeHTML(entry.text)}</pre>
        </div>
      </div>`;
    const img = msg.querySelector('.chat-image');
    img.addEventListener('click', () => { const w = window.open(); if (w) w.document.write(`<img src="${entry.img}" style="max-width:100%">`); });
    const block = msg.querySelector('.diagnosis-content');
    const pdfBtn = document.createElement('button');
    pdfBtn.type = 'button'; pdfBtn.className = 'pdf-btn'; pdfBtn.textContent = '⬇️ Tải báo cáo PDF';
    pdfBtn.addEventListener('click', () => exportPDF(msg, block, index));
    block.appendChild(pdfBtn);
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  // Xuất PDF giống bản cũ (html2pdf)
  function exportPDF(group, block, index) {
    const wrapper = document.createElement('div');
    wrapper.style.width = '180mm'; wrapper.style.padding = '10mm'; wrapper.style.boxSizing = 'border-box';
    wrapper.style.background = '#ffffff'; wrapper.style.fontFamily = "'Segoe UI', sans-serif";
    const title = document.createElement('h3');
    title.textContent = 'BÁO CÁO CHẨN ĐOÁN – CÂY KHỎE AI';
    title.style.cssText = 'color:#14532D;margin:0 0 6mm 0;font-size:18px;';
    wrapper.appendChild(title);
    const imgEl = group.querySelector('.chat-image');
    if (imgEl) {
      const img = imgEl.cloneNode(true);
      img.style.cssText = 'width:100%;height:auto;max-width:100%;border:none;border-radius:6px;box-shadow:none;min-width:0;max-height:none;';
      wrapper.appendChild(img);
      const sp = document.createElement('div'); sp.style.height = '8mm'; wrapper.appendChild(sp);
    }
    const diag = block.cloneNode(true);
    diag.style.cssText = 'width:100%;box-sizing:border-box;overflow:visible;box-shadow:none;border-radius:8px;border:1px solid #e5e7eb;padding:10mm;min-width:0;';
    diag.querySelectorAll('.pdf-btn').forEach((b) => b.remove());
    wrapper.appendChild(diag);
    document.body.appendChild(wrapper);
    html2pdf().set({
      margin: 10, filename: `bao_cao_cay_khoe_ai_${index + 1}.pdf`,
      image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(wrapper).save().then(() => wrapper.remove(), () => wrapper.remove());
  }

  function showThinking() {
    emptyState.style.display = 'none';
    const el = document.createElement('div');
    el.className = 'thinking';
    el.innerHTML = '<div class="spinner"></div> AI đang phân tích ảnh…';
    chatBox.appendChild(el); chatBox.scrollTop = chatBox.scrollHeight;
    return el;
  }
  function showError(text) {
    emptyState.style.display = 'none';
    const el = document.createElement('div');
    el.className = 'message bot';
    el.innerHTML = `<div class="message-group"><div class="diagnosis-content"><span class="status-badge status-error">⚠️ Lỗi</span><pre>${escapeHTML(text)}</pre></div></div>`;
    chatBox.appendChild(el); chatBox.scrollTop = chatBox.scrollHeight;
  }

  // ================== XỬ LÝ GỬI ẢNH ==================
  async function diagnose(file) {
    if (!file || busy) return;
    if (!mo_hinh) { showError('Mô hình AI chưa tải xong. Vui lòng chờ vài giây rồi gửi lại.'); return; }
    if (!/^image\//.test(file.type || 'image/')) { showError('Tệp đã chọn không phải ảnh. Vui lòng chọn ảnh JPG hoặc PNG.'); return; }
    busy = true; updateSendState();
    const thinking = showThinking();
    try {
      const src = await decodeImage(file);
      await new Promise((r) => setTimeout(r, 30));          // cho giao diện kịp vẽ vòng quay
      const t0 = performance.now();
      const preds = predictPixels(toInputPixels(src));
      const kq = du_doan_benh(preds);
      const entry = { img: thumbnailDataURL(src, 900), text: kq.text, level: kq.confidence_level,
                      confidence: kq.confidence, label: kq.label, ms: Math.round(performance.now() - t0) };
      if (src.close) src.close();
      thinking.remove();
      const hist = loadHistory(); hist.push(entry); saveHistory(hist);
      renderEntry(entry, hist.length - 1);
    } catch (e) {
      console.error(e);
      thinking.remove();
      showError('Không đọc được ảnh này. Hãy chọn ảnh định dạng JPG hoặc PNG, chụp rõ nét, rồi thử lại.');
    } finally {
      busy = false; fileInput.value = '';
      fileName.textContent = 'Ảnh cây trồng (ảnh có sẵn hoặc chụp trực tiếp)';
      updateSendState();
    }
  }

  function updateSendState() {
    sendBtn.disabled = !mo_hinh || busy || !(fileInput.files && fileInput.files.length);
  }

  fileInput.addEventListener('change', (e) => {
    fileName.textContent = e.target.files.length ? '✅ ' + e.target.files[0].name : 'Ảnh cây trồng (ảnh có sẵn hoặc chụp trực tiếp)';
    updateSendState();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); diagnose(fileInput.files[0]); });
  $('clearBtn').addEventListener('click', () => {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* bỏ qua */ }
    chatBox.querySelectorAll('.message, .thinking').forEach((m) => m.remove());
    emptyState.style.display = '';
  });

  // Hiện lại lịch sử cũ
  loadHistory().forEach((e, i) => renderEntry(e, i));

  loadAll().catch((e) => {
    console.error(e);
    setStatus('Không tải được mô hình AI. Kiểm tra kết nối mạng rồi tải lại trang.', 'error');
  });

  // Cho phép dùng không cần mạng sau lần mở đầu tiên
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Dùng cho kiểm thử tự động
  window.__cayKhoeAI = { toInputPixels, decodeImage, predictPixels, du_doan_benh, ready: () => !!mo_hinh };
})();
