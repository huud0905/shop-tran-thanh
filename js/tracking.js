import { lookupOrders, getLiveTracking, cancelCustomerOrder } from './api.js';

const THEME_STORAGE_KEY = 'theme';
const MY_ORDERS_STORAGE_KEY = 'my_orders';

const state = {
  isLoading: false,
  lastSearchedPhone: '',
  lastResults: [],
  cancelOrderId: null
};

const dom = {};

function cacheDom() {
  dom.themeToggle = document.getElementById('theme-toggle');
  dom.searchForm = document.getElementById('tracking-search-form');
  dom.phoneInput = document.getElementById('tracking-phone-input');
  dom.phoneClearBtn = document.getElementById('tracking-phone-clear');
  dom.submitBtn = document.getElementById('tracking-submit-btn');
  dom.submitSpinner = dom.submitBtn.querySelector('.btn-spinner');
  dom.submitLabel = dom.submitBtn.querySelector('.btn-label');

  dom.recentSection = document.getElementById('recent-orders-section');
  dom.recentList = document.getElementById('recent-orders-list');
  dom.recentClearBtn = document.getElementById('recent-orders-clear');

  dom.initialState = document.getElementById('tracking-initial-state');
  dom.resultsSection = document.getElementById('tracking-results-section');
  dom.resultsMeta = document.getElementById('tracking-results-meta');
  dom.resultsList = document.getElementById('tracking-results');
  dom.emptyState = document.getElementById('tracking-empty-state');

  dom.toastContainer = document.getElementById('toast-container');
  
  dom.cancelModal = document.getElementById('cancel-order-modal');
  dom.cancelForm = document.getElementById('cancel-order-form');
  dom.cancelErrorBox = document.getElementById('cancel-modal-error');
  dom.cancelReasonSelect = document.getElementById('cancel-reason-select');
  dom.cancelReasonOtherWrap = document.getElementById('cancel-reason-other-wrap');
  dom.cancelReasonOther = document.getElementById('cancel-reason-other');
  dom.cancelCustomerName = document.getElementById('cancel-customer-name');
  dom.cancelPhone = document.getElementById('cancel-phone');
  dom.cancelSubmitBtn = document.getElementById('confirm-cancel-submit-btn');
  dom.cancelBackBtn = document.getElementById('cancel-modal-back-btn');
  dom.cancelCloseBtn = document.getElementById('cancel-modal-close-btn');
}

function showCancelModalError(msg) {
  if (!dom.cancelErrorBox) return;
  dom.cancelErrorBox.textContent = msg;
  dom.cancelErrorBox.hidden = false;
  dom.cancelErrorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideCancelModalError() {
  if (!dom.cancelErrorBox) return;
  dom.cancelErrorBox.hidden = true;
  dom.cancelErrorBox.textContent = '';
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === 'dark' || savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
}

function toggleDarkMode() {
  const currentAttr = document.documentElement.getAttribute('data-theme');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isCurrentlyDark = currentAttr ? currentAttr === 'dark' : systemDark;
  const nextTheme = isCurrentlyDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nextTheme);
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value) {
  return `${(Number(value) || 0).toLocaleString('vi-VN')} ₫`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function maskName(name) {
  const clean = String(name || '').trim();
  if (!clean) return '—';
  const parts = clean.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].length <= 1 ? '*' : `${parts[0][0]}***`;
  }
  if (parts.length === 2) {
    const second = parts[1];
    return `${parts[0]} ${second[0] || ''}***`;
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  const maskedMiddle = parts
    .slice(1, -1)
    .map(() => '***')
    .join(' ');
  return `${first} ${maskedMiddle} ${last}`;
}

function maskPhone(phone) {
  const clean = String(phone || '').trim();
  if (!clean) return '—';
  if (clean.length <= 6) {
    return `${clean.slice(0, 2)}***`;
  }
  return `${clean.slice(0, 3)}****${clean.slice(-3)}`;
}

function maskAddress(address) {
  const clean = String(address || '').trim();
  if (!clean) return '—';
  const segments = clean
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length >= 2) {
    const tail = segments.slice(1).join(', ');
    const firstPart = segments[0];
    const prefix = firstPart.length > 4 ? `${firstPart.slice(0, 2)}***` : '***';
    return `${prefix}, ${tail}`;
  }

  if (clean.length <= 8) return '***';
  return `***${clean.slice(Math.floor(clean.length / 2))}`;
}

function getCarrierTrackingUrl(carrier, trackingCode) {
  const code = String(trackingCode || '').trim();
  if (!code) return '#';
  const normalized = String(carrier || '').toLowerCase();
  const encoded = encodeURIComponent(code);

  if (normalized.includes('spx')) {
    return `https://spx.vn/track?${encoded}`;
  }
  if (normalized.includes('viettel')) {
    return `https://viettelpost.com.vn/tra-cuu-hanh-trinh-don/?order_number=${encoded}`;
  }
  if (normalized.includes('ghtk') || normalized.includes('tiết kiệm')) {
    return `https://i.ghtk.vn/${encoded}`;
  }
  if (normalized.includes('ghn') || normalized.includes('hàng nhanh')) {
    return `https://donhang.ghn.vn/?order_code=${encoded}`;
  }
  if (normalized.includes('j&t') || normalized.includes('jnt')) {
    return `https://jtexpress.vn/vi/tracking?billcode=${encoded}`;
  }
  return `https://www.google.com/search?q=${encoded}`;
}

function getOrderStatusMeta(status) {
  const map = {
    pending: { label: 'Chờ xác nhận', className: 'is-pending' },
    confirmed: { label: 'Shop đã xác nhận', className: 'is-confirmed' },
    completed: { label: 'Giao thành công', className: 'is-completed' },
    cancelled: { label: 'Đã hủy', className: 'is-cancelled' },
  };
  return map[status] || { label: status || 'Đang xử lý', className: 'is-pending' };
}

function loadSavedOrdersSuggestions() {
  try {
    const raw = localStorage.getItem(MY_ORDERS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.phone) : [];
  } catch {
    return [];
  }
}

function renderQuickSuggestions() {
  const items = loadSavedOrdersSuggestions();
  if (items.length === 0) {
    dom.recentSection.hidden = true;
    dom.recentList.innerHTML = '';
    return;
  }

  const uniqueByPhone = [];
  const seenPhones = new Set();
  for (const entry of items) {
    const phone = String(entry.phone || '').trim();
    if (!phone || seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    uniqueByPhone.push(entry);
  }

  if (uniqueByPhone.length === 0) {
    dom.recentSection.hidden = true;
    return;
  }

  dom.recentSection.hidden = false;
  dom.recentList.innerHTML = uniqueByPhone
    .slice(0, 5)
    .map((entry) => {
      const shortId = entry.id ? `#${String(entry.id).slice(-6)}` : 'Đơn gần đây';
      return `
        <button
          type="button"
          class="suggestion-chip"
          data-phone="${escapeHtml(entry.phone)}"
          title="Tra cứu nhanh SĐT ${escapeHtml(entry.phone)}"
        >
          <span class="suggestion-chip-icon" aria-hidden="true">📱</span>
          <span class="suggestion-chip-phone">${escapeHtml(entry.phone)}</span>
          <span class="suggestion-chip-meta">${escapeHtml(shortId)}</span>
        </button>
      `;
    })
    .join('');
}

function updateClearBtnVisibility() {
  dom.phoneClearBtn.hidden = dom.phoneInput.value.length === 0;
}

function setLoadingState(loading) {
  state.isLoading = loading;
  dom.submitBtn.disabled = loading;
  dom.submitSpinner.hidden = !loading;
  dom.submitLabel.textContent = loading ? 'Đang tra cứu...' : 'Tra cứu đơn hàng';
}

async function performLookup(rawPhone, { updateUrl = true } = {}) {
  const phone = String(rawPhone || '').trim();
  if (!phone) {
    showToast('Vui lòng nhập số điện thoại đã đặt hàng.', 'warning');
    dom.phoneInput.focus();
    return;
  }

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) {
    showToast('Số điện thoại chưa hợp lệ. Vui lòng nhập ít nhất 9 chữ số.', 'warning');
    dom.phoneInput.focus();
    return;
  }

  state.lastSearchedPhone = phone;
  setLoadingState(true);

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('phone', phone);
    window.history.replaceState({}, '', url.toString());
  }

  try {
    const orders = await lookupOrders(phone);
    state.lastResults = orders;
    renderLookupResults(orders, phone);
  } catch (error) {
    console.error('Lỗi tra cứu đơn hàng:', error);
    dom.initialState.hidden = true;
    dom.resultsSection.hidden = true;
    dom.emptyState.hidden = false;
    showToast(error?.message || 'Không thể tra cứu đơn hàng lúc này. Vui lòng thử lại.', 'error');
  } finally {
    setLoadingState(false);
  }
}

function renderLookupResults(orders, searchedPhone) {
  dom.initialState.hidden = true;

  if (!Array.isArray(orders) || orders.length === 0) {
    dom.resultsSection.hidden = true;
    dom.emptyState.hidden = false;
    return;
  }

  dom.emptyState.hidden = true;
  dom.resultsSection.hidden = false;
  dom.resultsMeta.innerHTML = `Tìm thấy <strong>${orders.length}</strong> đơn hàng cho SĐT <strong>${escapeHtml(
    searchedPhone
  )}</strong>`;

  dom.resultsList.innerHTML = orders.map((order) => buildOrderCardHtml(order)).join('');
}

function buildOrderCardHtml(order) {
  const orderId = String(order.id ?? order._id ?? '');
  const shortId = orderId ? `#${orderId.slice(-8)}` : '#—';
  const status = order.status || 'pending';
  const statusMeta = getOrderStatusMeta(status);

  const carrier = String(order.shippingCarrier ?? order.shipping_carrier ?? '').trim();
  const trackingCode = String(order.trackingCode ?? order.tracking_code ?? '').trim();
  const hasTracking = trackingCode.length > 0;

  let progressHtml = '';
  if (status === 'cancelled') {
    progressHtml = `
      <div class="tracking-cancelled-box">
        <span class="badge-cancelled">ĐÃ HỦY</span>
        ${order.cancelReason ? ` <span class="cancel-reason-text">Lý do: <strong>${escapeHtml(order.cancelReason)}</strong></span>` : ''}
      </div>
    `;
  } else {
    const step1Active = true;
    const step2Active = status === 'confirmed' || status === 'completed';
    const step3Active = hasTracking || status === 'completed';
    const step4Active = status === 'completed';

    const steps = [
      { label: 'Đã đặt hàng', active: step1Active },
      { label: 'Shop đã xác nhận', active: step2Active },
      { label: 'Đang giao hàng', active: step3Active },
      { label: 'Giao thành công', active: step4Active },
    ];

    let lastActiveIdx = 0;
    steps.forEach((s, idx) => {
      if (s.active) lastActiveIdx = idx;
    });

    progressHtml = `
      <div class="order-timeline" aria-label="Tiến trình xử lý đơn hàng">
        ${steps
          .map((step, idx) => {
            const stateClass = step.active
              ? idx === lastActiveIdx
                ? 'is-active is-current'
                : 'is-active is-done'
              : 'is-upcoming';
            return `
              <div class="timeline-step ${stateClass}">
                <div class="timeline-marker" aria-hidden="true">${step.active ? '✓' : idx + 1}</div>
                <div class="timeline-content">
                  <span class="timeline-label">${escapeHtml(step.label)}</span>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  let shippingHtml = '';
  if (hasTracking) {
    const carrierDisplay = carrier || 'Đơn vị vận chuyển';
    const carrierUrl = getCarrierTrackingUrl(carrier, trackingCode);

    shippingHtml = `
      <div class="shipping-box has-tracking" id="shipping-box-${orderId}">
        <div class="shipping-box-head">
          <div class="shipping-carrier-wrap">
            <span class="shipping-box-eyebrow">Thông tin vận chuyển</span>
            <strong class="shipping-carrier-name">🚚 ${escapeHtml(carrierDisplay)}</strong>
          </div>
          <button type="button" class="btn btn-secondary btn-refresh-tracking" data-order-id="${orderId}" data-code="${trackingCode}" data-carrier="${carrier}">
            Làm mới hành trình 🔄
          </button>
        </div>

        <div class="shipping-code-row">
          <div class="shipping-code-display">
            <span class="shipping-code-label">Mã vận đơn:</span>
            <code class="shipping-code-value">${escapeHtml(trackingCode)}</code>
          </div>
          <div class="shipping-code-actions">
            <button type="button" class="btn btn-secondary btn-copy-code" data-copy-code="${escapeHtml(trackingCode)}">📋 Sao chép mã</button>
            <a href="${escapeHtml(carrierUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-track-carrier">Tra hành trình trên hãng ↗</a>
          </div>
        </div>
        <div class="live-tracking-section" id="live-tracking-${orderId}"></div>
      </div>
    `;
  } else {
    if (status === 'pending') {
      shippingHtml = `
        <div class="shipping-box is-pending-code">
          <div class="shipping-box-head">
            <div class="shipping-carrier-wrap">
              <span class="shipping-box-eyebrow">Thông tin vận chuyển</span>
            </div>
            <button type="button" class="btn btn-outline-danger btn-cancel-order" data-order-id="${escapeHtml(orderId)}">Hủy đơn hàng</button>
          </div>
        </div>
      `;
    } else {
      shippingHtml = `
        <div class="shipping-box is-pending-code">
          <div class="shipping-box-head">
            <div class="shipping-carrier-wrap">
              <span class="shipping-box-eyebrow">Thông tin vận chuyển</span>
            </div>
            <div class="tracking-cancel-note"><span class="icon">ℹ️</span> Đơn đã xác nhận — cần hỗ trợ vui lòng liên hệ shop.</div>
          </div>
        </div>
      `;
    }
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.length
    ? items
        .map((item) => {
          const itemName = item.productName || item.name || 'Sản phẩm';
          const qty = Number(item.qty || 1);
          const unitPrice = Number(item.price || 0);
          const lineTotal = unitPrice * qty;
          return `
            <li class="tracking-item-row">
              <div class="tracking-item-info">
                <span class="tracking-item-name">${escapeHtml(itemName)}</span>
                <span class="tracking-item-unit">${formatPrice(unitPrice)} × ${qty}</span>
              </div>
              <strong class="tracking-item-total">${formatPrice(lineTotal)}</strong>
            </li>
          `;
        })
        .join('')
    : '<li class="tracking-item-row"><span class="tracking-item-unit">Không có chi tiết sản phẩm.</span></li>';

  return `
    <article class="order-tracking-card" data-order-id="${escapeHtml(orderId)}">
      <header class="order-card-header">
        <div class="order-card-id-group">
          <span class="order-card-id">Đơn hàng <strong>${escapeHtml(shortId)}</strong></span>
          <span class="order-card-date">Đặt lúc ${escapeHtml(formatDateTime(order.createdAt))}</span>
        </div>
        <span class="tracking-status-badge ${statusMeta.className}">${escapeHtml(statusMeta.label)}</span>
      </header>
      ${progressHtml}
      ${shippingHtml}
      <div class="order-details-grid">
        <div class="order-items-section">
          <h3 class="order-section-heading">Sản phẩm đã đặt (${items.length})</h3>
          <ul class="tracking-items-list">${itemsHtml}</ul>
          <div class="order-card-total-row">
            <div class="order-card-total-line">
              <span>Tạm tính tiền hàng:</span>
              <span>${formatPrice(order.subtotal || Math.max(0, order.total - (order.shippingFee || 19000)))}</span>
            </div>
            <div class="order-card-total-line">
              <span>Phí vận chuyển:</span>
              <span>${formatPrice(order.shippingFee || 19000)}</span>
            </div>
            <div class="order-card-total-line" style="margin-top: 8px; border-top: 1px solid var(--color-border); padding-top: 8px;">
              <span>Tổng thanh toán</span>
              <strong class="order-card-total-value">${formatPrice(order.total)}</strong>
            </div>
          </div>
        </div>
        <div class="order-receiver-section">
          <h3 class="order-section-heading">Thông tin nhận hàng</h3>
          <dl class="receiver-info-list">
            <div class="receiver-info-row"><dt>Người nhận</dt><dd>${escapeHtml(maskName(order.customerName))}</dd></div>
            <div class="receiver-info-row"><dt>Số điện thoại</dt><dd>${escapeHtml(maskPhone(order.phone))}</dd></div>
            <div class="receiver-info-row"><dt>Địa chỉ</dt><dd>${escapeHtml(maskAddress(order.address))}</dd></div>
          </dl>
        </div>
      </div>
    </article>
  `;
}

async function handleRefreshTracking(btn) {
  const orderId = btn.dataset.orderId;
  const code = btn.dataset.code;
  const carrier = btn.dataset.carrier;
  const container = document.getElementById(`live-tracking-${orderId}`);
  
  container.innerHTML = '<div class="loading-spinner">Đang tải hành trình...</div>';
  
  try {
    const data = await getLiveTracking(code, carrier);
    if (data.events && data.events.length > 0) {
      container.innerHTML = `
        <div class="live-tracking-header">Hành trình bưu cục chi tiết</div>
        <div class="journey-timeline">
          ${data.events.map((e, i) => `
            <div class="journey-step ${i === 0 ? 'is-latest' : ''}">
              <div class="journey-node"><div class="journey-dot"></div></div>
              <div class="journey-content">
                <div class="journey-status">${escapeHtml(e.status)}</div>
                <div class="journey-location">📍 ${escapeHtml(e.location)}</div>
                <div class="journey-time">${escapeHtml(e.time)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="no-journey-data">Chưa có dữ liệu hành trình chi tiết.</div>
        <a href="${data.fallbackUrl}" target="_blank" class="btn btn-primary">Tra hành trình trên web hãng ↗</a>
      `;
    }
  } catch (e) {
    container.innerHTML = '<div class="error-msg">Không thể tải hành trình. Vui lòng thử lại sau.</div>';
  }
}

async function copyTrackingCode(code) {
  if (!code) return;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(code);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    showToast('Đã sao chép mã vận đơn!', 'success');
  } catch {
    showToast('Không thể tự động sao chép. Vui lòng chọn và sao chép thủ công.', 'warning');
  }
}

function showToast(msg, type = 'success') {
  const toast = document.createElement('div');
  const typeClass = type === 'error' ? 'is-error' : type === 'warning' ? 'is-warning' : type === 'info' ? 'is-info' : '';
  toast.className = `toast ${typeClass}`.trim();
  toast.textContent = msg;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'opacity 200ms ease, transform 200ms ease';
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

function openCancelModal(orderId) {
  state.cancelOrderId = orderId;
  hideCancelModalError();
  dom.cancelForm.reset();
  dom.cancelCustomerName.value = '';
  dom.cancelPhone.value = '';
  dom.cancelReasonSelect.value = 'Đặt nhầm sản phẩm / số lượng';
  dom.cancelReasonOtherWrap.hidden = true;
  dom.cancelReasonOther.value = '';
  
  dom.cancelModal.hidden = false;
  document.body.classList.add('no-scroll');
  dom.cancelCustomerName.focus();
}

function closeCancelModal() {
  hideCancelModalError();
  dom.cancelModal.hidden = true;
  document.body.classList.remove('no-scroll');
  dom.cancelForm.reset();
  state.cancelOrderId = null;
}

function bindEvents() {
  dom.themeToggle.addEventListener('click', toggleDarkMode);
  dom.phoneInput.addEventListener('input', updateClearBtnVisibility);
  dom.phoneClearBtn.addEventListener('click', () => {
    dom.phoneInput.value = '';
    updateClearBtnVisibility();
    dom.phoneInput.focus();
  });
  dom.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    performLookup(dom.phoneInput.value, { updateUrl: true });
  });
  dom.recentList.addEventListener('click', (e) => {
    const chip = e.target.closest('.suggestion-chip');
    if (!chip) return;
    const phone = chip.dataset.phone || '';
    dom.phoneInput.value = phone;
    updateClearBtnVisibility();
    performLookup(phone, { updateUrl: true });
  });
  dom.recentClearBtn.addEventListener('click', () => {
    localStorage.removeItem(MY_ORDERS_STORAGE_KEY);
    renderQuickSuggestions();
    showToast('Đã xóa gợi ý đơn hàng trên trình duyệt.', 'info');
  });
  dom.resultsList.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.btn-copy-code');
    if (copyBtn) copyTrackingCode(copyBtn.dataset.copyCode);
    const refreshBtn = e.target.closest('.btn-refresh-tracking');
    if (refreshBtn) handleRefreshTracking(refreshBtn);
    const cancelBtn = e.target.closest('.btn-cancel-order');
    if (cancelBtn) openCancelModal(cancelBtn.dataset.orderId);
  });
  
  dom.cancelReasonSelect.addEventListener('change', (e) => {
    dom.cancelReasonOtherWrap.hidden = e.target.value !== 'other';
    hideCancelModalError();
  });
  
  dom.cancelCustomerName.addEventListener('input', hideCancelModalError);
  dom.cancelPhone.addEventListener('input', hideCancelModalError);
  
  dom.cancelCloseBtn.addEventListener('click', closeCancelModal);
  dom.cancelBackBtn.addEventListener('click', closeCancelModal);
  dom.cancelModal.addEventListener('click', (e) => { if (e.target === dom.cancelModal) closeCancelModal(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dom.cancelModal.hidden) closeCancelModal(); });
  
  dom.cancelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const customerName = dom.cancelCustomerName.value.trim();
    const phone = dom.cancelPhone.value.trim();
    const reason = dom.cancelReasonSelect.value === 'other' ? dom.cancelReasonOther.value.trim() : dom.cancelReasonSelect.value;
    
    if (!customerName) {
      showCancelModalError('Vui lòng nhập họ và tên người nhận.');
      showToast('Vui lòng nhập họ và tên người nhận.', 'error');
      return;
    }
    if (!/^0\d{9}$/.test(phone)) {
      showCancelModalError('Vui lòng nhập đầy đủ 10 số điện thoại đặt hàng.');
      showToast('Vui lòng nhập đầy đủ 10 số điện thoại đặt hàng.', 'error');
      return;
    }
    if (dom.cancelReasonSelect.value === 'other' && !reason) {
      showCancelModalError('Vui lòng nhập lý do cụ thể.');
      showToast('Vui lòng nhập lý do cụ thể.', 'error');
      return;
    }
    
    dom.cancelSubmitBtn.disabled = true;
    dom.cancelSubmitBtn.textContent = 'Đang xác minh...';
    
    try {
      await cancelCustomerOrder(state.cancelOrderId, { phone, customerName, reason });
      showToast('Đã hủy đơn hàng thành công.', 'success');
      closeCancelModal();
      
      const orderIdx = state.lastResults.findIndex(o => (o.id || o._id) === state.cancelOrderId);
      if (orderIdx !== -1) {
        state.lastResults[orderIdx].status = 'cancelled';
        state.lastResults[orderIdx].cancelReason = reason;
        renderLookupResults(state.lastResults, state.lastSearchedPhone);
      }
    } catch (err) {
      showCancelModalError(err.message || 'Thông tin Họ tên hoặc Số điện thoại không khớp với đơn hàng.');
      showToast(err.message || 'Hủy đơn thất bại.', 'error');
    } finally {
      dom.cancelSubmitBtn.disabled = false;
      dom.cancelSubmitBtn.textContent = 'Xác nhận hủy đơn';
    }
  });
}

function init() {
  cacheDom();
  initTheme();
  renderQuickSuggestions();
  bindEvents();
  const params = new URLSearchParams(window.location.search);
  const phoneFromUrl = params.get('phone');
  if (phoneFromUrl && phoneFromUrl.trim()) {
    dom.phoneInput.value = phoneFromUrl.trim();
    updateClearBtnVisibility();
    performLookup(phoneFromUrl.trim(), { updateUrl: false });
  } else {
    updateClearBtnVisibility();
  }
}

document.addEventListener('DOMContentLoaded', init);
