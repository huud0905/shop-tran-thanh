import {
  verifyAdminToken,
  getAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  updateProductStatus,
  getOrders,
  updateOrderStatus,
  updateOrderTracking
} from './api.js';

const MAX_IMAGES = 10;
const PAGE_SIZE = 10;
const ADMIN_POLL_INTERVAL_MS = 3000;
const NEW_ORDER_HIGHLIGHT_MS = 4000;
const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="#e5e7eb"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#6b7280" font-size="11" font-family="sans-serif">No Img</text></svg>'
  );

const SHIPPING_CARRIERS = [
  'SPX Express',
  'Viettel Post',
  'GHTK (Giao Hàng Tiết Kiệm)',
  'GHN (Giao Hàng Nhanh)',
  'J&T Express',
  'Giao trực tiếp / Khác'
];

// Trạng thái ứng dụng cục bộ
const state = {
  activeTab: 'products',
  products: [],
  orders: [],
  productSearch: '',
  productStatus: 'all',
  productPage: 1,
  orderStatusFilter: 'all',
  editingProductId: null,
  existingImages: [],
  selectedFiles: [],
  objectUrls: [],
  pollTimerId: null,
  isPolling: false,
  hasLoadedInitialOrders: false,
  highlightedOrderTimers: new Map(),
  activeOrderDrawerId: null
};

// ============================================================================
// Khởi tạo & Điều phối sự kiện
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  bindEvents();
  checkAuth();
});

function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  applyTheme(saved);
}

function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', normalized);
  localStorage.setItem('theme', normalized);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = normalized === 'dark' ? '☀️' : '🌙';
}

function getToken() {
  // Ưu tiên localStorage (ghi nhớ), fallback sessionStorage
  return localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken') || '';
}

function isUnauthorizedError(err) {
  if (!err) return false;
  if (err.status === 401 || err.code === 401) return true;
  return String(err.message || '').includes('401');
}

function handleApiError(err, fallbackMsg) {
  if (isUnauthorizedError(err)) {
    showToast('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.', 'error');
    logout();
    return;
  }
  showToast(err?.message || fallbackMsg, 'error');
}

function syncBodyScrollLock() {
  const productOpen = !document.getElementById('product-modal').hidden;
  const drawerOpen = !document.getElementById('order-drawer-backdrop').hidden;
  const confirmOpen = !document.getElementById('confirm-modal').hidden;
  document.body.classList.toggle('modal-open', productOpen || drawerOpen || confirmOpen);
}

function scrollLoginFieldIntoView() {
  const loginOverlay = document.getElementById('login-overlay');
  const submitBtn = document.getElementById('login-submit-btn');
  if (!loginOverlay || loginOverlay.hidden || !submitBtn) return;
  submitBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function bindEvents() {
  // Đăng nhập / Đăng xuất / Theme
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tokenInput = document.getElementById('admin-token-input');
    const rememberMe = document.getElementById('remember-me').checked;
    await login(tokenInput.value.trim(), rememberMe);
  });

  // Cuộn mượt khi bàn phím ảo trên mobile hiển thị tại màn hình đăng nhập
  const tokenInputEl = document.getElementById('admin-token-input');
  tokenInputEl.addEventListener('focus', () => {
    setTimeout(() => {
      tokenInputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrollLoginFieldIntoView();
    }, 260);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (document.activeElement === tokenInputEl) {
        scrollLoginFieldIntoView();
      }
    });
  }

  // Toggle hiển thị mật khẩu
  document.getElementById('toggle-password-btn').addEventListener('click', () => {
    const input = document.getElementById('admin-token-input');
    const btn = document.getElementById('toggle-password-btn');
    const icon = btn.querySelector('.toggle-icon');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    icon.textContent = isPassword ? '🙈' : '👁️';
    btn.setAttribute('aria-pressed', String(isPassword));
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    logout();
  });

  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  // Chuyển tab Sidebar / Bottom bar
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Toolbar Sản phẩm
  document.getElementById('add-product-btn').addEventListener('click', () => {
    openProductModal(null);
  });

  document.getElementById('product-search-input').addEventListener('input', (e) => {
    state.productSearch = e.target.value.trim().toLowerCase();
    state.productPage = 1;
    renderProductsTable(state.products);
  });

  document.getElementById('product-status-filter').addEventListener('change', (e) => {
    state.productStatus = e.target.value;
    state.productPage = 1;
    renderProductsTable(state.products);
  });

  // Phân trang sản phẩm
  document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (state.productPage > 1) {
      state.productPage -= 1;
      renderProductsTable(state.products);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  document.getElementById('next-page-btn').addEventListener('click', () => {
    state.productPage += 1;
    renderProductsTable(state.products);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Modal Sản phẩm
  document.getElementById('close-product-modal-btn').addEventListener('click', closeProductModal);
  document.getElementById('cancel-product-modal-btn').addEventListener('click', closeProductModal);
  document.getElementById('product-modal').addEventListener('click', (e) => {
    if (e.target.id === 'product-modal') closeProductModal();
  });

  document.getElementById('product-price-input').addEventListener('input', handlePriceInput);

  document.querySelectorAll('input[name="product-status"]').forEach((radio) => {
    radio.addEventListener('change', syncStockFieldVisibility);
  });

  document.getElementById('product-images-input').addEventListener('change', handleFileSelection);
  document.getElementById('product-form').addEventListener('submit', handleProductFormSubmit);

  // Đơn hàng
  document.getElementById('refresh-orders-btn').addEventListener('click', () => {
    loadOrders();
    loadProducts({ silent: true });
  });
  document.getElementById('order-status-filters').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill-btn');
    if (!pill) return;
    state.orderStatusFilter = pill.dataset.status;
    document.querySelectorAll('#order-status-filters .pill-btn').forEach((b) => {
      b.classList.toggle('is-active', b === pill);
    });
    renderOrdersTable(state.orders);
  });

  // Slide-in Drawer Đơn hàng
  document.getElementById('close-order-drawer-btn').addEventListener('click', closeOrderDetail);
  document.getElementById('order-drawer-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'order-drawer-backdrop') closeOrderDetail();
  });

  // Đóng popup bằng phím Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('confirm-modal').hidden) return;
    if (!document.getElementById('order-drawer-backdrop').hidden) closeOrderDetail();
    if (!document.getElementById('product-modal').hidden) closeProductModal();
  });

  // Kiểm soát vòng đời tab (Visibility API) cho Polling thông minh
  document.addEventListener('visibilitychange', handleAdminVisibilityChange);
}

// ============================================================================
// Xác thực
// ============================================================================
function checkAuth() {
  const token = getToken();
  const loginOverlay = document.getElementById('login-overlay');
  const adminApp = document.getElementById('admin-app');

  if (!token) {
    stopAdminPolling();
    loginOverlay.hidden = false;
    adminApp.hidden = true;
    syncBodyScrollLock();
    if (window.innerWidth >= 768) {
      document.getElementById('admin-token-input').focus();
    }
    return;
  }

  loginOverlay.hidden = true;
  adminApp.hidden = false;
  syncBodyScrollLock();
  loadProducts();
  loadOrders();
  if (document.visibilityState !== 'hidden') {
    startAdminPolling();
  } else {
    updateRealtimeIndicator(false);
  }
}

async function login(token, rememberMe) {
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit-btn');
  const btnText = submitBtn.querySelector('.btn-text');
  const btnLoading = submitBtn.querySelector('.btn-loading');

  errorEl.hidden = true;
  errorEl.textContent = '';

  if (!token) {
    errorEl.textContent = 'Vui lòng nhập Admin Token.';
    errorEl.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  if (btnText) btnText.hidden = true;
  if (btnLoading) btnLoading.hidden = false;

  try {
    const res = await verifyAdminToken(token);

    if (res && res.valid) {
      if (rememberMe) {
        localStorage.setItem('adminToken', token);
        sessionStorage.removeItem('adminToken');
      } else {
        sessionStorage.setItem('adminToken', token);
        localStorage.removeItem('adminToken');
      }
      document.getElementById('admin-token-input').value = '';
      checkAuth();
      showToast('Đăng nhập thành công!');
    } else {
      errorEl.textContent = 'Token không chính xác hoặc đã hết hạn.';
      errorEl.hidden = false;
    }
  } catch (err) {
    if (isUnauthorizedError(err)) {
      errorEl.textContent = 'Token không chính xác hoặc đã hết hạn.';
    } else {
      errorEl.textContent = err.message || 'Không thể kết nối đến máy chủ.';
    }
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    if (btnText) btnText.hidden = false;
    if (btnLoading) btnLoading.hidden = true;
  }
}

function logout() {
  stopAdminPolling();
  clearAllHighlightTimers();
  localStorage.removeItem('adminToken');
  sessionStorage.removeItem('adminToken');
  state.products = [];
  state.orders = [];
  state.hasLoadedInitialOrders = false;
  state.activeOrderDrawerId = null;
  closeProductModal();
  closeOrderDetail();
  checkAuth();
}

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  document.getElementById('tab-products').hidden = tabName !== 'products';
  document.getElementById('tab-orders').hidden = tabName !== 'orders';
}

// ============================================================================
// Đồng bộ Real-time (Background Polling 3s + Visibility API + Web Audio API)
// ============================================================================
function updateRealtimeIndicator(isLive) {
  const pill = document.querySelector('.realtime-status-pill');
  if (!pill) return;
  pill.classList.toggle('is-paused', !isLive);
  const textEl = pill.querySelector('.live-text');
  if (textEl) {
    textEl.textContent = isLive ? 'Trực tiếp' : 'Tạm dừng';
  }
}

function startAdminPolling() {
  if (!getToken()) return;
  stopAdminPolling();
  updateRealtimeIndicator(true);
  state.pollTimerId = setInterval(() => {
    if (document.visibilityState === 'visible') {
      pollAdminData();
    }
  }, ADMIN_POLL_INTERVAL_MS);
}

function stopAdminPolling() {
  if (state.pollTimerId !== null) {
    clearInterval(state.pollTimerId);
    state.pollTimerId = null;
  }
  updateRealtimeIndicator(false);
}

function handleAdminVisibilityChange() {
  if (!getToken()) return;
  if (document.visibilityState === 'hidden') {
    stopAdminPolling();
  } else if (document.visibilityState === 'visible') {
    pollAdminData();
    startAdminPolling();
  }
}

function clearAllHighlightTimers() {
  state.highlightedOrderTimers.forEach((timerId) => clearTimeout(timerId));
  state.highlightedOrderTimers.clear();
}

function markOrderHighlighted(orderId) {
  const key = String(orderId);
  const existingTimer = state.highlightedOrderTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timerId = setTimeout(() => {
    state.highlightedOrderTimers.delete(key);
    const rows = document.querySelectorAll(`#orders-tbody tr[data-order-id="${CSS.escape(key)}"]`);
    rows.forEach((row) => row.classList.remove('row-new-highlight'));
  }, NEW_ORDER_HIGHLIGHT_MS);

  state.highlightedOrderTimers.set(key, timerId);
}

function playNewOrderSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    const playTone = (freq, startOffset, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);

      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.14, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    playTone(880, 0, 0.14);
    playTone(1200, 0.15, 0.24);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch {
    // Bỏ qua nếu trình duyệt chặn autoplay hoặc không hỗ trợ Web Audio API
  }
}

function getOrdersSignature(list) {
  return JSON.stringify(
    (list || []).map((o) => ({
      id: String(o.id ?? o._id ?? ''),
      status: o.status || '',
      total: Number(o.total || 0),
      shippingCarrier: o.shippingCarrier || o.shipping_carrier || '',
      trackingCode: o.trackingCode || o.tracking_code || '',
      updatedAt: o.updatedAt || o.createdAt || ''
    }))
  );
}

function getProductsSignature(list) {
  return JSON.stringify(
    (list || []).map((p) => ({
      id: String(p.id ?? p._id ?? ''),
      name: p.name || '',
      price: Number(p.price || 0),
      status: p.status || '',
      stock: getNormalizedStock(p),
      images: Array.isArray(p.images) ? p.images : p.image ? [p.image] : [],
      updatedAt: p.updatedAt || ''
    }))
  );
}

async function pollAdminData() {
  const token = getToken();
  if (!token || state.isPolling) return;

  state.isPolling = true;
  try {
    const [ordersRes, productsRes] = await Promise.all([
      getOrders(token),
      getAdminProducts(token)
    ]);

    const fetchedOrders = Array.isArray(ordersRes)
      ? ordersRes
      : ordersRes?.orders || ordersRes?.data || [];
    const fetchedProducts = Array.isArray(productsRes)
      ? productsRes
      : productsRes?.products || productsRes?.data || [];

    processPolledOrders(fetchedOrders);
    processPolledProducts(fetchedProducts);
  } catch (err) {
    if (isUnauthorizedError(err)) {
      stopAdminPolling();
      handleApiError(err, 'Phiên đăng nhập hết hạn.');
    } else {
      console.warn('Background polling sync failed:', err?.message || err);
    }
  } finally {
    state.isPolling = false;
  }
}

function processPolledOrders(fetchedOrders) {
  const prevMap = new Map(state.orders.map((o) => [String(o.id ?? o._id), o]));
  const newOrders = [];
  const changedOrderIds = new Set();

  for (const order of fetchedOrders) {
    const id = String(order.id ?? order._id);
    const prev = prevMap.get(id);
    if (!prev) {
      newOrders.push(order);
    } else if (
      prev.status !== order.status ||
      (prev.shippingCarrier || prev.shipping_carrier || '') !==
        (order.shippingCarrier || order.shipping_carrier || '') ||
      (prev.trackingCode || prev.tracking_code || '') !==
        (order.trackingCode || order.tracking_code || '')
    ) {
      changedOrderIds.add(id);
    }
  }

  const prevSignature = getOrdersSignature(state.orders);
  const nextSignature = getOrdersSignature(fetchedOrders);
  const hasOrderChanges =
    prevSignature !== nextSignature || newOrders.length > 0 || changedOrderIds.size > 0;

  if (!hasOrderChanges) return;

  if (state.hasLoadedInitialOrders && newOrders.length > 0) {
    const newIdSet = new Set(newOrders.map((o) => String(o.id ?? o._id)));
    const existingUpdated = fetchedOrders.filter((o) => !newIdSet.has(String(o.id ?? o._id)));
    state.orders = [...newOrders, ...existingUpdated];

    newOrders.forEach((order) => {
      const id = String(order.id ?? order._id);
      markOrderHighlighted(id);
      const shortId = id.slice(-8);
      const customerName = order.customerName || 'Khách hàng';
      showToast(
        `🔔 Đơn hàng mới #${shortId} từ ${customerName} (${formatCurrency(order.total)})`,
        'new-order'
      );
    });

    playNewOrderSound();
  } else {
    state.orders = fetchedOrders;
  }

  state.hasLoadedInitialOrders = true;

  const pendingCount = state.orders.filter((o) => o.status === 'pending').length;
  renderOrderBadge(pendingCount);
  renderOrdersTable(state.orders);

  // Cập nhật dữ liệu bên trong Drawer chi tiết nếu đang mở đúng đơn vừa đổi trạng thái (trừ khi admin đang nhập form vận đơn)
  const drawerOpen = !document.getElementById('order-drawer-backdrop').hidden;
  if (drawerOpen && state.activeOrderDrawerId) {
    const activeId = String(state.activeOrderDrawerId);
    const activeEl = document.activeElement;
    const isEditingTracking = Boolean(activeEl && activeEl.closest('#order-tracking-form'));
    if (changedOrderIds.has(activeId) && !isEditingTracking) {
      const updatedOrder = state.orders.find((o) => String(o.id ?? o._id) === activeId);
      if (updatedOrder) {
        openOrderDetail(updatedOrder, { preserveScroll: true });
      }
    }
  }
}

function processPolledProducts(fetchedProducts) {
  if (getProductsSignature(state.products) === getProductsSignature(fetchedProducts)) {
    return;
  }
  state.products = fetchedProducts;
  renderProductsTable(state.products);
}

// ============================================================================
// Quản lý Sản phẩm
// ============================================================================
async function loadProducts({ silent = false } = {}) {
  const tbody = document.getElementById('products-tbody');
  if (!silent) {
    tbody.innerHTML = '<tr class="is-empty-row"><td colspan="5" class="table-empty">Đang tải sản phẩm...</td></tr>';
  }

  try {
    const token = getToken();
    const data = await getAdminProducts(token);
    state.products = Array.isArray(data) ? data : data?.products || data?.data || [];
    renderProductsTable(state.products);
  } catch (err) {
    if (!silent) {
      tbody.innerHTML = '<tr class="is-empty-row"><td colspan="5" class="table-empty">Không tải được danh sách sản phẩm.</td></tr>';
      handleApiError(err, 'Lỗi khi tải danh sách sản phẩm.');
    }
  }
}

function getNormalizedStock(product) {
  const parsed = Number(product?.stock);
  if (Number.isFinite(parsed) && product?.stock !== undefined && product?.stock !== null && product?.stock !== '') {
    return Math.max(0, Math.floor(parsed));
  }
  return product?.status === 'sold' ? 0 : 1;
}

function getFilteredProducts(products) {
  return products.filter((p) => {
    const nameMatch = !state.productSearch || (p.name || '').toLowerCase().includes(state.productSearch);
    const stock = getNormalizedStock(p);
    const normalizedStatus = p.status === 'sold' || stock <= 0 ? 'sold' : 'available';
    const statusMatch = state.productStatus === 'all' || normalizedStatus === state.productStatus;
    return nameMatch && statusMatch;
  });
}

function renderProductsTable(products) {
  const tbody = document.getElementById('products-tbody');
  const paginationEl = document.getElementById('products-pagination');
  const filtered = getFilteredProducts(products);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr class="is-empty-row"><td colspan="5" class="table-empty">Không có sản phẩm nào phù hợp.</td></tr>';
    paginationEl.hidden = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (state.productPage > totalPages) state.productPage = totalPages;

  const startIndex = (state.productPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  tbody.innerHTML = pageItems
    .map((p) => {
      const id = p.id ?? p._id;
      const images = Array.isArray(p.images) ? p.images : p.image ? [p.image] : [];
      const thumb = images[0] || PLACEHOLDER_IMG;
      const stock = getNormalizedStock(p);
      const isSold = p.status === 'sold' || stock <= 0;
      const statusBadge = isSold
        ? '<span class="badge badge-sold">Đã bán</span>'
        : `<span class="badge badge-available">Còn hàng (SL: ${stock})</span>`;
      const toggleLabel = isSold ? 'Đánh dấu Còn hàng' : 'Đánh dấu Đã bán';

      return `
        <tr data-product-id="${escapeHtml(id)}">
          <td class="col-thumb">
            <img class="product-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(p.name || '')}" loading="lazy" />
          </td>
          <td class="product-name-cell">${escapeHtml(p.name || '')}</td>
          <td class="price-cell">${formatCurrency(p.price)}</td>
          <td class="col-status">${statusBadge}</td>
          <td class="text-right col-actions">
            <div class="table-actions">
              <button type="button" class="btn btn-outline btn-xs js-edit-product" data-id="${escapeHtml(id)}">Sửa</button>
              <button type="button" class="btn btn-outline btn-xs js-toggle-status" data-id="${escapeHtml(id)}" data-status="${isSold ? 'sold' : 'available'}">
                <span class="label-desktop">${toggleLabel}</span>
                <span class="label-mobile">Đổi trạng thái</span>
              </button>
              <button type="button" class="btn btn-danger btn-xs js-delete-product" data-id="${escapeHtml(id)}">Xóa</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.js-edit-product').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = state.products.find((item) => String(item.id ?? item._id) === btn.dataset.id);
      if (target) openProductModal(target);
    });
  });

  tbody.querySelectorAll('.js-toggle-status').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleProductStatus(btn.dataset.id, btn.dataset.status);
    });
  });

  tbody.querySelectorAll('.js-delete-product').forEach((btn) => {
    btn.addEventListener('click', () => {
      deleteProductById(btn.dataset.id);
    });
  });

  paginationEl.hidden = false;
  document.getElementById('pagination-info').textContent = `Hiển thị ${startIndex + 1}–${Math.min(
    startIndex + PAGE_SIZE,
    filtered.length
  )} / ${filtered.length} sản phẩm`;
  document.getElementById('page-indicator').textContent = `${state.productPage} / ${totalPages}`;
  document.getElementById('prev-page-btn').disabled = state.productPage <= 1;
  document.getElementById('next-page-btn').disabled = state.productPage >= totalPages;
}

function formatPriceDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const normalized = digits.replace(/^0+(?=\d)/, '');
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function updatePricePreview(formattedPrice) {
  const previewEl = document.getElementById('price-preview-label');
  if (!previewEl) return;
  if (formattedPrice) {
    previewEl.textContent = `${formattedPrice} đồng`;
    previewEl.hidden = false;
  } else {
    previewEl.textContent = '';
    previewEl.hidden = true;
  }
}

function handlePriceInput(e) {
  const formatted = formatPriceDigits(e.target.value);
  e.target.value = formatted;
  updatePricePreview(formatted);
}

function syncStockFieldVisibility() {
  const statusChecked = document.querySelector('input[name="product-status"]:checked');
  const statusVal = statusChecked ? statusChecked.value : 'available';
  const stockGroup = document.getElementById('stock-form-group');
  const stockInput = document.getElementById('product-stock-input');
  const stockErr = document.getElementById('error-product-stock');

  if (statusVal === 'sold') {
    if (stockGroup) stockGroup.hidden = true;
    if (stockInput) {
      stockInput.value = '0';
      stockInput.classList.remove('is-invalid');
    }
    if (stockErr) {
      stockErr.hidden = true;
      stockErr.textContent = '';
    }
  } else {
    if (stockGroup) stockGroup.hidden = false;
    if (stockInput && (!stockInput.value || Number(stockInput.value) < 1)) {
      stockInput.value = '1';
    }
  }
}

function openProductModal(product = null) {
  clearProductValidation();
  revokePreviewUrls();

  state.editingProductId = product ? product.id ?? product._id : null;
  state.selectedFiles = [];
  state.existingImages = product
    ? [...(Array.isArray(product.images) ? product.images : product.image ? [product.image] : [])]
    : [];

  document.getElementById('product-modal-title').textContent = product ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm mới';
  document.getElementById('product-id-input').value = state.editingProductId || '';
  document.getElementById('product-name-input').value = product?.name || '';

  const formattedPrice = product?.price !== undefined && product?.price !== null && product?.price !== ''
    ? formatPriceDigits(Math.round(Number(product.price)))
    : '';
  document.getElementById('product-price-input').value = formattedPrice;
  updatePricePreview(formattedPrice);

  document.getElementById('product-desc-input').value = product?.description || '';
  document.getElementById('product-images-input').value = '';
  document.getElementById('product-urls-input').value = '';

  const stock = product ? getNormalizedStock(product) : 1;
  const statusVal = product && (product.status === 'sold' || stock <= 0) ? 'sold' : 'available';
  const radio = document.querySelector(`input[name="product-status"][value="${statusVal}"]`);
  if (radio) radio.checked = true;

  const stockInput = document.getElementById('product-stock-input');
  if (stockInput) {
    stockInput.value = statusVal === 'sold' ? '0' : String(product ? Math.max(1, stock) : 1);
  }
  syncStockFieldVisibility();

  renderImagePreviews(state.selectedFiles, state.existingImages);
  const modal = document.getElementById('product-modal');
  modal.hidden = false;
  syncBodyScrollLock();

  const bodyEl = document.getElementById('product-form');
  if (bodyEl) bodyEl.scrollTop = 0;

  if (window.innerWidth >= 768) {
    document.getElementById('product-name-input').focus();
  }
}

function closeProductModal() {
  document.getElementById('product-modal').hidden = true;
  state.editingProductId = null;
  state.selectedFiles = [];
  state.existingImages = [];
  revokePreviewUrls();
  syncBodyScrollLock();
}

function revokePreviewUrls() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
}

function handleFileSelection(e) {
  const newFiles = Array.from(e.target.files || []);
  const errorEl = document.getElementById('error-product-images');
  errorEl.hidden = true;

  if (newFiles.length === 0) return;

  const totalCount = state.existingImages.length + state.selectedFiles.length + newFiles.length;
  if (totalCount > MAX_IMAGES) {
    const allowed = Math.max(0, MAX_IMAGES - state.existingImages.length - state.selectedFiles.length);
    const accepted = newFiles.slice(0, allowed);
    state.selectedFiles.push(...accepted);

    const msg = `Chỉ được tối đa ${MAX_IMAGES} ảnh cho mỗi sản phẩm.`;
    errorEl.textContent = msg;
    errorEl.hidden = false;
    showToast(msg, 'warning');
  } else {
    state.selectedFiles.push(...newFiles);
  }

  e.target.value = '';
  renderImagePreviews(state.selectedFiles, state.existingImages);
}

function renderImagePreviews(files, existingUrls) {
  const grid = document.getElementById('image-preview-grid');
  revokePreviewUrls();

  const existingHtml = existingUrls
    .map(
      (url, index) => `
      <div class="preview-item">
        <img src="${escapeHtml(url)}" alt="Ảnh sản phẩm ${index + 1}" />
        <span class="preview-tag">Ảnh cũ</span>
        <button type="button" class="preview-remove-btn js-remove-existing" data-index="${index}" aria-label="Xóa ảnh" title="Xóa ảnh">×</button>
      </div>
    `
    )
    .join('');

  const fileHtml = files
    .map((file, index) => {
      const objUrl = URL.createObjectURL(file);
      state.objectUrls.push(objUrl);
      return `
        <div class="preview-item">
          <img src="${objUrl}" alt="${escapeHtml(file.name)}" />
          <span class="preview-tag">Mới</span>
          <button type="button" class="preview-remove-btn js-remove-file" data-index="${index}" aria-label="Xóa ảnh" title="Xóa ảnh">×</button>
        </div>
      `;
    })
    .join('');

  grid.innerHTML = existingHtml + fileHtml;

  grid.querySelectorAll('.js-remove-existing').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      state.existingImages.splice(idx, 1);
      document.getElementById('error-product-images').hidden = true;
      renderImagePreviews(state.selectedFiles, state.existingImages);
    });
  });

  grid.querySelectorAll('.js-remove-file').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      state.selectedFiles.splice(idx, 1);
      document.getElementById('error-product-images').hidden = true;
      renderImagePreviews(state.selectedFiles, state.existingImages);
    });
  });
}

function clearProductValidation() {
  ['error-product-name', 'error-product-price', 'error-product-stock', 'error-product-images'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.hidden = true;
      el.textContent = '';
    }
  });
  ['product-name-input', 'product-price-input', 'product-stock-input'].forEach((id) => {
    document.getElementById(id)?.classList.remove('is-invalid');
  });
}

function validateProductForm() {
  clearProductValidation();
  let isValid = true;

  const nameInput = document.getElementById('product-name-input');
  const priceInput = document.getElementById('product-price-input');
  const stockInput = document.getElementById('product-stock-input');
  const statusChecked = document.querySelector('input[name="product-status"]:checked');
  const statusVal = statusChecked ? statusChecked.value : 'available';
  const manualUrls = getManualImageUrls();

  if (!nameInput.value.trim()) {
    setFieldError(nameInput, 'error-product-name', 'Vui lòng nhập tên sản phẩm.');
    isValid = false;
  }

  const rawPriceStr = String(priceInput.value || '').replace(/\./g, '').trim();
  const priceNum = Number(rawPriceStr);
  if (rawPriceStr === '' || !/^\d+$/.test(rawPriceStr) || Number.isNaN(priceNum) || priceNum < 0) {
    setFieldError(priceInput, 'error-product-price', 'Vui lòng nhập giá hợp lệ (>= 0).');
    isValid = false;
  }

  if (statusVal === 'available') {
    const stockRaw = String(stockInput.value || '').trim();
    const stockNum = Number(stockRaw);
    if (stockRaw === '' || !Number.isInteger(stockNum) || stockNum < 1) {
      setFieldError(stockInput, 'error-product-stock', 'Vui lòng nhập số lượng tồn kho (>= 1).');
      isValid = false;
    }
  }

  const totalImages = state.existingImages.length + state.selectedFiles.length + manualUrls.length;
  if (totalImages > MAX_IMAGES) {
    const imgErr = document.getElementById('error-product-images');
    imgErr.textContent = `Tổng số ảnh (file + URL) không được vượt quá ${MAX_IMAGES} ảnh.`;
    imgErr.hidden = false;
    isValid = false;
  }

  return isValid;
}

function setFieldError(inputEl, errorId, message) {
  inputEl.classList.add('is-invalid');
  const errEl = document.getElementById(errorId);
  errEl.textContent = message;
  errEl.hidden = false;
}

function getManualImageUrls() {
  const raw = document.getElementById('product-urls-input').value || '';
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function handleProductFormSubmit(e) {
  e.preventDefault();
  if (!validateProductForm()) return;

  const cleanPrice = String(document.getElementById('product-price-input').value || '')
    .replace(/\./g, '')
    .trim();

  const statusChecked = document.querySelector('input[name="product-status"]:checked');
  const statusValue = statusChecked ? statusChecked.value : 'available';
  const stockValue =
    statusValue === 'sold'
      ? 0
      : Math.max(1, Number.parseInt(document.getElementById('product-stock-input').value, 10) || 1);

  const formData = new FormData();
  formData.append('name', document.getElementById('product-name-input').value.trim());
  formData.append('price', String(Number(cleanPrice)));
  formData.append('status', statusValue);
  formData.append('stock', String(stockValue));
  formData.append('description', document.getElementById('product-desc-input').value.trim());

  const mergedUrls = [...state.existingImages, ...getManualImageUrls()];
  formData.append('existingImages', JSON.stringify(state.existingImages));
  formData.append('imageUrls', JSON.stringify(mergedUrls));

  state.selectedFiles.forEach((file) => {
    formData.append('images', file);
  });

  await saveProduct(formData);
}

async function saveProduct(formData) {
  const saveBtn = document.getElementById('save-product-btn');
  const isEditing = Boolean(state.editingProductId);

  saveBtn.disabled = true;
  saveBtn.textContent = 'Đang lưu...';

  try {
    const token = getToken();
    if (isEditing) {
      await updateProduct(state.editingProductId, formData, token);
      showToast('Cập nhật sản phẩm thành công!');
    } else {
      await createProduct(formData, token);
      showToast('Thêm sản phẩm mới thành công!');
    }

    closeProductModal();
    await loadProducts();
  } catch (err) {
    handleApiError(err, 'Không thể lưu sản phẩm. Vui lòng thử lại.');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Lưu sản phẩm';
  }
}

async function deleteProductById(id) {
  const target = state.products.find((p) => String(p.id ?? p._id) === String(id));
  const label = target?.name ? `"${target.name}"` : 'sản phẩm này';
  const confirmed = await showConfirm(`Bạn có chắc chắn muốn xóa ${label}? Hành động này không thể hoàn tác.`);
  if (!confirmed) return;

  try {
    await deleteProduct(id, getToken());
    showToast('Đã xóa sản phẩm.');
    await loadProducts();
  } catch (err) {
    handleApiError(err, 'Xóa sản phẩm thất bại.');
  }
}

async function toggleProductStatus(id, currentStatus) {
  const nextStatus = currentStatus === 'sold' ? 'available' : 'sold';
  const nextStock = nextStatus === 'sold' ? 0 : 1;
  try {
    await updateProductStatus(id, nextStatus, getToken(), nextStock);
    showToast(nextStatus === 'sold' ? 'Đã đánh dấu sản phẩm là Đã bán.' : 'Đã chuyển sản phẩm sang Còn hàng.');
    await loadProducts();
  } catch (err) {
    handleApiError(err, 'Cập nhật trạng thái sản phẩm thất bại.');
  }
}

// ============================================================================
// Quản lý Đơn hàng & Mã vận đơn
// ============================================================================
async function loadOrders() {
  const tbody = document.getElementById('orders-tbody');
  if (!state.hasLoadedInitialOrders) {
    tbody.innerHTML = '<tr class="is-empty-row"><td colspan="9" class="table-empty">Đang tải đơn hàng...</td></tr>';
  }

  try {
    const data = await getOrders(getToken());
    state.orders = Array.isArray(data) ? data : data?.orders || data?.data || [];
    state.hasLoadedInitialOrders = true;

    const pendingCount = state.orders.filter((o) => o.status === 'pending').length;
    renderOrderBadge(pendingCount);
    renderOrdersTable(state.orders);
  } catch (err) {
    if (!state.hasLoadedInitialOrders) {
      tbody.innerHTML = '<tr class="is-empty-row"><td colspan="9" class="table-empty">Không tải được danh sách đơn hàng.</td></tr>';
    }
    handleApiError(err, 'Lỗi khi tải danh sách đơn hàng.');
  }
}

function getOrderStatusMeta(status) {
  const map = {
    pending: { label: 'Chờ duyệt', badgeClass: 'badge-pending' },
    confirmed: { label: 'Đã xác nhận', badgeClass: 'badge-confirmed' },
    completed: { label: 'Hoàn thành', badgeClass: 'badge-completed' },
    cancelled: { label: 'Đã hủy', badgeClass: 'badge-cancelled' }
  };
  return map[status] || { label: status || 'Không rõ', badgeClass: 'badge-sold' };
}

function summarizeOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) return '—';
  const first = items[0];
  const firstName =
    typeof first.product === 'string'
      ? first.product
      : first.product?.name || first.productName || first.name || 'Sản phẩm';
  if (items.length === 1) return `${firstName} (x${first.qty || 1})`;
  return `${firstName} (+${items.length - 1} sp khác)`;
}

function renderPhoneLink(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '—';
  const telHref = raw.replace(/[^\d+]/g, '');
  if (!telHref) return escapeHtml(raw);
  return `<a href="tel:${escapeHtml(telHref)}" class="tel-link" aria-label="Gọi ${escapeHtml(raw)}">📞 ${escapeHtml(raw)}</a>`;
}

function buildOrderTrackingTag(order) {
  const carrier = String(order.shippingCarrier ?? order.shipping_carrier ?? '').trim();
  const code = String(order.trackingCode ?? order.tracking_code ?? '').trim();
  if (!carrier && !code) return '';

  const text = carrier && code ? `${carrier}: ${code}` : code || carrier;
  return `<div class="order-tracking-tag" title="${escapeHtml(text)}">🚚 ${escapeHtml(text)}</div>`;
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('orders-tbody');
  const filtered =
    state.orderStatusFilter === 'all'
      ? orders
      : orders.filter((o) => o.status === state.orderStatusFilter);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr class="is-empty-row"><td colspan="9" class="table-empty">Không có đơn hàng nào.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((order) => {
      const id = order.id ?? order._id;
      const meta = getOrderStatusMeta(order.status);
      const trackingTagHtml = buildOrderTrackingTag(order);
      const actionsHtml = buildOrderActionButtons(id, order.status, { includeMobileDetail: true });
      const highlightClass = state.highlightedOrderTimers.has(String(id)) ? ' row-new-highlight' : '';

      return `
        <tr class="js-order-row${highlightClass}" data-order-id="${escapeHtml(id)}">
          <td class="col-order-id"><strong>#${escapeHtml(String(id).slice(-8))}</strong></td>
          <td class="col-order-time" style="white-space: nowrap;">${formatDateTime(order.createdAt)}</td>
          <td class="col-order-customer">${escapeHtml(order.customerName || '')}</td>
          <td class="col-order-phone" style="white-space: nowrap;">${renderPhoneLink(order.phone)}</td>
          <td class="cell-truncate col-order-address" title="${escapeHtml(order.address || '')}">${escapeHtml(order.address || '')}</td>
          <td class="cell-truncate col-order-items" title="${escapeHtml(summarizeOrderItems(order.items))}">${escapeHtml(
        summarizeOrderItems(order.items)
      )}</td>
          <td class="price-cell col-order-total">${formatCurrency(order.total)}</td>
          <td class="col-order-status">
            <div class="order-status-cell">
              <span class="badge ${meta.badgeClass}">${meta.label}</span>
              ${trackingTagHtml}
            </div>
          </td>
          <td class="text-right col-order-actions">
            <div class="table-actions">${actionsHtml}</div>
          </td>
        </tr>
      `;
    })
    .join('');

  // Click hàng để mở panel chi tiết
  tbody.querySelectorAll('.js-order-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      const target = state.orders.find((o) => String(o.id ?? o._id) === row.dataset.orderId);
      if (target) openOrderDetail(target);
    });
  });

  // Gán sự kiện nút thao tác trạng thái
  tbody.querySelectorAll('.js-order-status-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      changeOrderStatus(btn.dataset.id, btn.dataset.nextStatus);
    });
  });

  tbody.querySelectorAll('.js-order-detail-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = state.orders.find((o) => String(o.id ?? o._id) === btn.dataset.id);
      if (target) openOrderDetail(target);
    });
  });
}

function buildOrderActionButtons(orderId, status, { includeMobileDetail = false, isDrawer = false } = {}) {
  const detailBtnMobile = includeMobileDetail
    ? `<button type="button" class="btn btn-outline btn-xs js-order-detail-btn mobile-only-btn" data-id="${escapeHtml(
        orderId
      )}">Chi tiết</button>`
    : '';

  if (status === 'pending') {
    return `
      <button type="button" class="btn btn-primary btn-xs js-order-status-btn" data-id="${escapeHtml(
        orderId
      )}" data-next-status="confirmed">Xác nhận</button>
      <button type="button" class="btn btn-danger btn-xs js-order-status-btn" data-id="${escapeHtml(
        orderId
      )}" data-next-status="cancelled">Hủy đơn</button>
      ${detailBtnMobile}
    `;
  }
  if (status === 'confirmed') {
    return `
      <button type="button" class="btn btn-success btn-xs js-order-status-btn" data-id="${escapeHtml(
        orderId
      )}" data-next-status="completed">Hoàn thành</button>
      <button type="button" class="btn btn-danger btn-xs js-order-status-btn" data-id="${escapeHtml(
        orderId
      )}" data-next-status="cancelled">Hủy đơn</button>
      ${detailBtnMobile}
    `;
  }
  if (isDrawer) {
    return `
      <button type="button" class="btn btn-outline js-close-drawer-btn">Đóng</button>
    `;
  }
  return `
    <button type="button" class="btn btn-outline btn-xs js-order-detail-btn" data-id="${escapeHtml(orderId)}">
      Chi tiết
    </button>
  `;
}

function openOrderDetail(order, { preserveScroll = false } = {}) {
  const id = order.id ?? order._id;
  state.activeOrderDrawerId = String(id);

  const meta = getOrderStatusMeta(order.status);
  const items = Array.isArray(order.items) ? order.items : [];
  const currentCarrier = String(order.shippingCarrier ?? order.shipping_carrier ?? '').trim();
  const currentCode = String(order.trackingCode ?? order.tracking_code ?? '').trim();

  document.getElementById('order-drawer-title').textContent = `Đơn hàng #${id}`;
  document.getElementById('order-drawer-subtitle').textContent = `Đặt lúc ${formatDateTime(order.createdAt)}`;

  const itemsHtml = items.length
    ? items
        .map((item) => {
          const itemName =
            typeof item.product === 'string'
              ? item.product
              : item.product?.name || item.productName || item.name || 'Sản phẩm';
          const qty = Number(item.qty || 1);
          const price = Number(item.price || 0);
          return `
            <div class="order-item-row">
              <div>
                <div class="order-item-name">${escapeHtml(itemName)}</div>
                <div class="order-item-meta">${formatCurrency(price)} × ${qty}</div>
              </div>
              <strong>${formatCurrency(price * qty)}</strong>
            </div>
          `;
        })
        .join('')
    : '<p class="order-item-meta">Không có thông tin sản phẩm.</p>';

  const carrierOptionsHtml = SHIPPING_CARRIERS.map(
    (carrier) => `<option value="${escapeHtml(carrier)}">${escapeHtml(carrier)}</option>`
  ).join('');

  const body = document.getElementById('order-drawer-body');
  const prevScrollTop = body.scrollTop;

  body.innerHTML = `
    ${order.status === 'cancelled' && order.cancelReason ? `
      <div class="drawer-alert drawer-alert-danger" style="margin-bottom: var(--spacing-16); padding: var(--spacing-12); background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-md); color: #ef4444;">
        <div style="font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
          <span>⚠️</span> Đơn hàng đã bị hủy
        </div>
        <div style="font-size: 0.875rem; color: var(--color-text);">
          Lý do: <em>${escapeHtml(order.cancelReason)}</em>
        </div>
      </div>
    ` : ''}
    <div class="drawer-section">
      <h4 class="drawer-section-title">Thông tin khách hàng</h4>
      <div class="info-list">
        <div class="info-row">
          <span class="info-label">Trạng thái</span>
          <span class="info-value"><span class="badge ${meta.badgeClass}">${meta.label}</span></span>
        </div>
        <div class="info-row">
          <span class="info-label">Khách hàng</span>
          <span class="info-value">${escapeHtml(order.customerName || '—')}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Số điện thoại</span>
          <span class="info-value">${renderPhoneLink(order.phone)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Địa chỉ</span>
          <span class="info-value">${escapeHtml(order.address || '—')}</span>
        </div>
      </div>
    </div>

    <div class="drawer-section">
      <h4 class="drawer-section-title">Ghi chú khách hàng</h4>
      <div class="order-note-box">${escapeHtml(order.note || 'Không có ghi chú.')}</div>
    </div>

    <div class="drawer-section">
      <h4 class="drawer-section-title">Cập nhật vận chuyển</h4>
      <form id="order-tracking-form" class="tracking-form-box" novalidate>
        <div class="form-group">
          <label for="shipping-carrier-select" class="form-label">Hãng vận chuyển</label>
          <select id="shipping-carrier-select" class="form-control">
            <option value="">-- Chọn hãng vận chuyển --</option>
            ${carrierOptionsHtml}
          </select>
        </div>

        <div class="form-group">
          <label for="tracking-code-input" class="form-label">Mã vận đơn</label>
          <input
            type="text"
            id="tracking-code-input"
            class="form-control"
            placeholder="Nhập mã vận đơn thực tế..."
            autocomplete="off"
          />
        </div>

        ${
          order.status === 'pending'
            ? `<div class="form-check tracking-confirm-check">
                 <input type="checkbox" id="tracking-auto-confirm" class="form-check-input" checked />
                 <label for="tracking-auto-confirm" class="form-check-label">
                   Chuyển trạng thái sang <strong>Đã xác nhận</strong> khi lưu vận đơn
                 </label>
               </div>`
            : ''
        }

        <button type="submit" id="save-tracking-btn" class="btn btn-primary btn-block">
          💾 Lưu vận đơn
        </button>
      </form>
    </div>

    <div class="drawer-section">
      <h4 class="drawer-section-title">Sản phẩm đã đặt (${items.length})</h4>
      <div class="order-items-list">${itemsHtml}</div>
      <div class="order-total-row">
        <div class="order-total-line"><span>Tạm tính:</span> <span>${formatCurrency(order.subtotal || Math.max(0, order.total - (order.shippingFee || 19000)))}</span></div>
        <div class="order-total-line"><span>Phí ship:</span> <span>${formatCurrency(order.shippingFee || 19000)}</span></div>
        <div class="order-total-line" style="margin-top: 8px; border-top: 1px solid var(--color-border); padding-top: 8px;">
          <span>Tổng thu khách</span>
          <strong>${formatCurrency(order.total)}</strong>
        </div>
      </div>
    </div>
  `;

  // Gán giá trị hiện tại của hãng vận chuyển & mã vận đơn
  const carrierSelect = document.getElementById('shipping-carrier-select');
  const codeInput = document.getElementById('tracking-code-input');
  if (carrierSelect) {
    if (currentCarrier && !SHIPPING_CARRIERS.includes(currentCarrier)) {
      const customOption = document.createElement('option');
      customOption.value = currentCarrier;
      customOption.textContent = currentCarrier;
      carrierSelect.appendChild(customOption);
    }
    carrierSelect.value = currentCarrier;
  }
  if (codeInput) {
    codeInput.value = currentCode;
  }

  const trackingForm = document.getElementById('order-tracking-form');
  if (trackingForm) {
    trackingForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSaveOrderTracking(id, order.status);
    });
  }

  const footer = document.getElementById('order-drawer-footer');
  footer.innerHTML = buildOrderActionButtons(id, order.status, { isDrawer: true });

  footer.querySelectorAll('.js-order-status-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      changeOrderStatus(btn.dataset.id, btn.dataset.nextStatus);
    });
  });

  footer.querySelectorAll('.js-close-drawer-btn').forEach((btn) => {
    btn.addEventListener('click', closeOrderDetail);
  });

  document.getElementById('order-drawer-backdrop').hidden = false;
  body.scrollTop = preserveScroll ? prevScrollTop : 0;
  syncBodyScrollLock();
}

async function handleSaveOrderTracking(orderId, currentStatus) {
  const carrierSelect = document.getElementById('shipping-carrier-select');
  const codeInput = document.getElementById('tracking-code-input');
  const autoConfirmCheckbox = document.getElementById('tracking-auto-confirm');
  const saveBtn = document.getElementById('save-tracking-btn');

  const shippingCarrier = carrierSelect ? carrierSelect.value.trim() : '';
  const trackingCode = codeInput ? codeInput.value.trim() : '';
  const shouldConfirm =
    currentStatus === 'pending' && autoConfirmCheckbox && autoConfirmCheckbox.checked;
  const nextStatus = shouldConfirm ? 'confirmed' : undefined;

  if (!shippingCarrier && !trackingCode) {
    showToast('Vui lòng chọn hãng vận chuyển hoặc nhập mã vận đơn.', 'warning');
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang lưu...';
  }

  try {
    const updated = await updateOrderTracking(
      orderId,
      { shippingCarrier, trackingCode, status: nextStatus },
      getToken()
    );

    showToast(
      shouldConfirm
        ? 'Đã lưu vận đơn và chuyển đơn hàng sang "Đã xác nhận"!'
        : 'Đã lưu thông tin vận đơn thành công!'
    );

    await loadOrders();
    if (shouldConfirm) {
      await loadProducts({ silent: true });
    }

    const drawerOpen = !document.getElementById('order-drawer-backdrop').hidden;
    if (drawerOpen) {
      const refreshed =
        state.orders.find((o) => String(o.id ?? o._id) === String(orderId)) || updated;
      if (refreshed) {
        openOrderDetail(refreshed, { preserveScroll: true });
      }
    }
  } catch (err) {
    handleApiError(err, 'Cập nhật thông tin vận đơn thất bại.');
  } finally {
    const currentSaveBtn = document.getElementById('save-tracking-btn');
    if (currentSaveBtn) {
      currentSaveBtn.disabled = false;
      currentSaveBtn.textContent = '💾 Lưu vận đơn';
    }
  }
}

function closeOrderDetail() {
  document.getElementById('order-drawer-backdrop').hidden = true;
  state.activeOrderDrawerId = null;
  syncBodyScrollLock();
}

async function changeOrderStatus(orderId, status) {
  if (status === 'cancelled') {
    const confirmed = await showConfirm('Bạn có chắc chắn muốn hủy đơn hàng này không?');
    if (!confirmed) return;
  }

  try {
    const updated = await updateOrderStatus(orderId, status, getToken());
    const statusText = getOrderStatusMeta(status).label;
    showToast(`Đã cập nhật đơn hàng sang trạng thái "${statusText}".`);

    await loadOrders();
    await loadProducts({ silent: true });
    const drawerOpen = !document.getElementById('order-drawer-backdrop').hidden;
    if (drawerOpen) {
      const refreshed = state.orders.find((o) => String(o.id ?? o._id) === String(orderId)) || updated;
      if (refreshed) openOrderDetail(refreshed, { preserveScroll: true });
    }
  } catch (err) {
    handleApiError(err, 'Cập nhật trạng thái đơn hàng thất bại.');
  }
}

function renderOrderBadge(count) {
  const badge = document.getElementById('pending-orders-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = false;
  } else {
    badge.textContent = '0';
    badge.hidden = true;
  }
}

// ============================================================================
// Tiện ích UI (Toast, Confirm, Format, Escape)
// ============================================================================
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);

  const duration = type === 'new-order' ? 5000 : 3200;
  setTimeout(() => {
    toast.remove();
  }, duration);
}

function showConfirm(msg) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');

    msgEl.textContent = msg;
    modal.hidden = false;
    syncBodyScrollLock();

    const cleanup = (result) => {
      modal.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      syncBodyScrollLock();
      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => {
      if (e.target === modal) cleanup(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    cancelBtn.focus();
  });
}

function formatCurrency(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
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
    minute: '2-digit'
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
