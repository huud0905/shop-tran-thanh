import { getProducts, createOrder } from './api.js';
import { removeVietnameseTones as configNormalize } from './config.js';
import { fetchProvinces, fetchWardsByProvince, formatFullAddress } from './vn-address-2cap.js';

const CART_STORAGE_KEY = 'cart';
const THEME_STORAGE_KEY = 'theme';
const ADDRESS_STORAGE_KEY = 'last_customer_address';
const FILTER_DEBOUNCE_MS = 280;
const POLL_INTERVAL_MS = 5000;
const SHIPPING_FEE = 19000;

const PRICE_PRESETS = {
  all: { min: null, max: null },
  'under-500k': { min: null, max: 500000 },
  '500k-2m': { min: 500000, max: 2000000 },
  '2m-5m': { min: 2000000, max: 5000000 },
  'over-5m': { min: 5000000, max: null },
};

const PLACEHOLDER_IMAGE = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" fill="none"><rect width="400" height="300" fill="#e2e8f0"/><path d="M140 190l42-48 34 38 26-28 48 56H110l30-18z" fill="#94a3b8"/><circle cx="155" cy="112" r="18" fill="#94a3b8"/></svg>`);

const state = {
  products: [],
  filteredProducts: [],
  cart: [],
  filters: { search: '', status: 'all', pricePreset: 'all', minPrice: null, maxPrice: null, sort: 'newest' },
  activeModalProductId: null,
  activeGalleryIndex: 0,
  galleryScrollTimer: null,
  filterDebounceTimer: null,
  pollingTimer: null,
  isSyncingProducts: false,
  syncSeq: 0,
  hasLoadedProducts: false,
  isSubmittingOrder: false,
};

const dom = {};

function cacheDom() {
  dom.themeToggle = document.getElementById('theme-toggle');
  dom.cartOpenBtn = document.getElementById('cart-open-btn');
  dom.cartBadge = document.getElementById('cart-badge');
  dom.catalogSummary = document.getElementById('catalog-summary');
  dom.searchInput = document.getElementById('search-input');
  dom.searchClearBtn = document.getElementById('search-clear-btn');
  dom.mobileFilterOpenBtn = document.getElementById('mobile-filter-open-btn');
  dom.activeFilterBadge = document.getElementById('active-filter-badge');
  dom.filterSheetOverlay = document.getElementById('filter-sheet-overlay');
  dom.filterSheet = document.getElementById('filter-sheet');
  dom.filterSheetCloseBtn = document.getElementById('filter-sheet-close-btn');
  dom.sheetClearFiltersBtn = document.getElementById('sheet-clear-filters-btn');
  dom.filterSheetApplyBtn = document.getElementById('filter-sheet-apply-btn');
  dom.statusRadios = document.querySelectorAll('input[name="status-filter"]');
  dom.sortSelect = document.getElementById('sort-select');
  dom.pricePresets = document.getElementById('price-presets');
  dom.priceMinInput = document.getElementById('price-min');
  dom.priceMaxInput = document.getElementById('price-max');
  dom.resultsCount = document.getElementById('results-count');
  dom.clearFiltersBtn = document.getElementById('clear-filters-btn');
  dom.productCatalogSection = document.getElementById('product-catalog-section');
  dom.productGrid = document.getElementById('product-grid');
  dom.emptyState = document.getElementById('empty-state');
  dom.emptyResetBtn = document.getElementById('empty-reset-btn');
  dom.productModal = document.getElementById('product-modal');
  dom.modalDialog = dom.productModal.querySelector('.modal-dialog');
  dom.modalCloseBtn = document.getElementById('modal-close-btn');
  dom.modalImageTrack = document.getElementById('modal-image-track');
  dom.modalGalleryDots = document.getElementById('modal-gallery-dots');
  dom.modalThumbnails = document.getElementById('modal-thumbnails');
  dom.modalStatus = document.getElementById('modal-status');
  dom.modalStock = document.getElementById('modal-stock');
  dom.modalProductName = document.getElementById('modal-product-name');
  dom.modalPrice = document.getElementById('modal-price');
  dom.modalDescription = document.getElementById('modal-description');
  dom.modalAddToCart = document.getElementById('modal-add-to-cart');
  dom.modalBuyNow = document.getElementById('modal-buy-now');
  dom.cartOverlay = document.getElementById('cart-overlay');
  dom.cartDrawer = document.getElementById('cart-drawer');
  dom.cartCloseBtn = document.getElementById('cart-close-btn');
  dom.cartItemsList = document.getElementById('cart-items-list');
  dom.cartEmpty = document.getElementById('cart-empty');
  dom.cartCheckoutSection = document.getElementById('cart-checkout-section');
  dom.cartOosWarning = document.getElementById('cart-oos-warning');
  dom.cartSubtotalAmount = document.getElementById('cart-subtotal-amount');
  dom.cartTotalAmount = document.getElementById('cart-total-amount');
  dom.cartDrawerFooter = document.getElementById('cart-drawer-footer');
  dom.cartFooterAmount = document.getElementById('cart-footer-amount');
  dom.checkoutForm = document.getElementById('checkout-form');
  dom.submitOrderBtn = document.getElementById('submit-order-btn');
  dom.toastContainer = document.getElementById('toast-container');
  
  dom.provinceSelect = document.getElementById('customer-province');
  dom.wardSelect = document.getElementById('customer-ward');
  dom.addressDetailInput = document.getElementById('customer-address-detail');
  dom.addressPreview = document.getElementById('address-preview');
  dom.addressPreviewText = document.getElementById('address-preview-text');
}

function animateCartIcon() {
  const btn = dom.cartOpenBtn;
  if (!btn) return;
  btn.classList.remove('cart-bump');
  void btn.offsetWidth;
  btn.classList.add('cart-bump');
  setTimeout(() => {
    btn.classList.remove('cart-bump');
  }, 350);
}

function formatPrice(value) { return `${(Number(value) || 0).toLocaleString('vi-VN')} ₫`; }
function formatThousandDots(value) { const digits = String(value ?? '').replace(/\D/g, ''); if (!digits) return ''; return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function formatPriceInputKeepCaret(inputEl) {
  const raw = inputEl.value;
  const cursorPos = inputEl.selectionStart ?? raw.length;
  const digitsBeforeCursor = raw.slice(0, cursorPos).replace(/\D/g, '').length;
  const formatted = formatThousandDots(raw);
  inputEl.value = formatted;
  if (document.activeElement === inputEl && typeof inputEl.setSelectionRange === 'function') {
    let seenDigits = 0;
    let nextPos = formatted.length;
    for (let i = 0; i < formatted.length; i += 1) {
      if (/\d/.test(formatted[i])) seenDigits += 1;
      if (seenDigits >= digitsBeforeCursor) { nextPos = digitsBeforeCursor === 0 ? 0 : i + 1; break; }
    }
    inputEl.setSelectionRange(nextPos, nextPos);
  }
}
function parseOptionalPrice(rawValue) { const digits = String(rawValue ?? '').replace(/\./g, '').replace(/\D/g, '').trim(); if (!digits) return null; const num = Number(digits); if (!Number.isFinite(num) || num < 0) return null; return num; }
function escapeHtml(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function normalizeVietnamese(str) { if (typeof configNormalize === 'function') return configNormalize(str); return String(str ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim(); }
function getProductThumbnail(product) { return (Array.isArray(product?.images) && product.images.length > 0 && product.images[0]) ? product.images[0] : PLACEHOLDER_IMAGE; }
function getProductStock(product) { if (!product) return 0; if (product.status === 'sold') return 0; const parsed = Math.floor(Number(product.stock)); return Number.isFinite(parsed) ? Math.max(0, parsed) : 0; }
function isProductSold(product) { if (!product) return true; return product.status === 'sold' || getProductStock(product) <= 0; }
function getAvailableStockById(productId) { const product = state.products.find((p) => String(p.id) === String(productId)); if (product) return getProductStock(product); if (state.hasLoadedProducts) return 0; const cartItem = state.cart.find((item) => String(item.productId) === String(productId)); return (cartItem && Number.isFinite(Number(cartItem.stock))) ? Math.max(0, Math.floor(Number(cartItem.stock))) : Infinity; }
function isCartItemSoldOut(item) { if (!item) return true; const product = state.products.find((p) => String(p.id) === String(item.productId)); if (product) return isProductSold(product); if (state.hasLoadedProducts) return true; return Boolean(item.isSoldOut) || (Number.isFinite(Number(item.stock)) && Number(item.stock) <= 0); }
function syncBodyScrollLock() { const hasOpenModal = !dom.productModal.hidden; const hasOpenCart = dom.cartDrawer.classList.contains('is-open'); const hasOpenFilterSheet = dom.filterSheet.classList.contains('is-open'); document.body.classList.toggle('no-scroll', hasOpenModal || hasOpenCart || hasOpenFilterSheet); }

async function initAddress() {
  const provinces = await fetchProvinces();
  dom.provinceSelect.innerHTML = '<option value="">-- Chọn Tỉnh / Thành phố --</option>';
  provinces.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.code;
    opt.textContent = p.name;
    dom.provinceSelect.appendChild(opt);
  });

  const saved = JSON.parse(localStorage.getItem(ADDRESS_STORAGE_KEY) || '{}');
  if (saved.provinceCode) {
    dom.provinceSelect.value = saved.provinceCode;
    await loadWards(saved.provinceCode, saved.wardCode);
  }
  if (saved.addressDetail) dom.addressDetailInput.value = saved.addressDetail;
  if (saved.name) document.getElementById('customer-name').value = saved.name;
  if (saved.phone) document.getElementById('customer-phone').value = saved.phone;
  updateAddressPreview();
}

async function loadWards(provinceCode, selectedWardCode = null) {
  dom.wardSelect.innerHTML = '<option value="">-- Chọn Xã / Phường / Đặc khu --</option>';
  dom.wardSelect.disabled = true;
  if (!provinceCode) {
    updateAddressPreview();
    return;
  }
  dom.wardSelect.innerHTML = '<option value="">-- Đang tải Xã / Phường / Đặc khu... --</option>';
  const wards = await fetchWardsByProvince(provinceCode);
  dom.wardSelect.innerHTML = '<option value="">-- Chọn Xã / Phường / Đặc khu --</option>';
  wards.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.code;
    opt.textContent = w.name;
    if (w.code === selectedWardCode) opt.selected = true;
    dom.wardSelect.appendChild(opt);
  });
  dom.wardSelect.disabled = false;
  updateAddressPreview();
}

function updateAddressPreview() {
  const p = dom.provinceSelect.options[dom.provinceSelect.selectedIndex];
  const w = dom.wardSelect.options[dom.wardSelect.selectedIndex];
  const detail = dom.addressDetailInput.value.trim();
  if (p.value && w.value && detail) {
    dom.addressPreview.hidden = false;
    dom.addressPreviewText.textContent = `📍 Giao tới: ${detail}, ${w.text}, ${p.text}`;
  } else {
    dom.addressPreview.hidden = true;
  }
}

async function init() {
  cacheDom();
  initTheme();
  initAddress();
  loadCartFromStorage();
  renderCartBadge();
  renderCart();
  updateSearchClearButton();
  bindEvents();
  renderSkeletons(8);
  try {
    await syncProducts({ force: true, notifyCart: true, throwOnError: true });
    renderPricePresets();
    syncModalWithUrl();
  } catch (error) {
    console.error('Lỗi tải danh sách sản phẩm:', error);
    dom.productGrid.innerHTML = '';
    dom.emptyState.hidden = false;
    updateFilterMeta();
    showToast('Không thể tải danh sách sản phẩm. Vui lòng thử lại sau.', 'error');
  }
  if (document.visibilityState !== 'hidden') startProductPolling();
}

function stopProductPolling() { if (state.pollingTimer) { clearTimeout(state.pollingTimer); state.pollingTimer = null; } }
function startProductPolling() { stopProductPolling(); if (document.visibilityState === 'hidden') return; state.pollingTimer = setTimeout(async () => { state.pollingTimer = null; if (document.visibilityState === 'hidden') return; await syncProducts({ force: false, notifyCart: true, throwOnError: false }); if (document.visibilityState === 'visible') startProductPolling(); }, POLL_INTERVAL_MS); }
function handleVisibilityChange() { if (document.visibilityState === 'hidden') { stopProductPolling(); return; } if (document.visibilityState === 'visible') { stopProductPolling(); syncProducts({ force: false, notifyCart: true, throwOnError: false }).finally(() => { if (document.visibilityState === 'visible') startProductPolling(); }); } }
function haveProductsChanged(prevList, nextList) { if (!Array.isArray(prevList) || !Array.isArray(nextList)) return true; if (prevList.length !== nextList.length) return true; const prevMap = new Map(prevList.map((p) => [String(p.id), p])); for (const next of nextList) { const prev = prevMap.get(String(next.id)); if (!prev) return true; if (getProductStock(prev) !== getProductStock(next) || isProductSold(prev) !== isProductSold(next) || prev.status !== next.status || Number(prev.price) !== Number(next.price) || prev.name !== next.name || prev.updatedAt !== next.updatedAt) return true; } return false; }
async function syncProducts({ force = false, notifyCart = true, throwOnError = false } = {}) { if (state.isSyncingProducts && !force) return null; state.isSyncingProducts = true; const reqSeq = ++state.syncSeq; try { const products = await getProducts(); if (reqSeq !== state.syncSeq) return state.products; const nextProducts = Array.isArray(products) ? products : []; const isInitialLoad = !state.hasLoadedProducts; const changed = isInitialLoad || haveProductsChanged(state.products, nextProducts); state.products = nextProducts; state.hasLoadedProducts = true; if (changed) applyProductsSnapshot({ preserveScroll: !isInitialLoad, notifyCart }); else { const cartAdjusted = syncCartWithProducts(state.products, { notify: notifyCart }); if (cartAdjusted) { renderCartBadge(); renderCart(); } } return nextProducts; } catch (error) { if (throwOnError) throw error; console.error('Lỗi đồng bộ danh sách sản phẩm:', error); return null; } finally { if (reqSeq === state.syncSeq) state.isSyncingProducts = false; } }
function applyProductsSnapshot({ preserveScroll = true, notifyCart = true } = {}) { const scrollX = window.scrollX; const scrollY = window.scrollY; const matched = filterProductsByCurrentState(state.products); const nextFiltered = sortProducts(matched, state.filters.sort); state.filteredProducts = nextFiltered; updateFilterMeta(); if (canPatchProductGridInPlace(nextFiltered)) patchProductGridInPlace(nextFiltered); else { renderProducts(nextFiltered); if (preserveScroll) window.scrollTo(scrollX, scrollY); } syncOpenModalWithProducts(); syncCartWithProducts(state.products, { notify: notifyCart }); renderCartBadge(); renderCart(); }
function canPatchProductGridInPlace(nextFiltered) { if (!nextFiltered || nextFiltered.length === 0) return false; const cards = dom.productGrid.querySelectorAll('.product-card[data-product-id]'); if (cards.length !== nextFiltered.length) return false; for (let i = 0; i < nextFiltered.length; i += 1) if (String(cards[i].dataset.productId) !== String(nextFiltered[i].id)) return false; return true; }
function patchProductGridInPlace(products) { dom.emptyState.hidden = true; const cards = dom.productGrid.querySelectorAll('.product-card[data-product-id]'); products.forEach((product, index) => { const card = cards[index]; if (!card) return; const stock = getProductStock(product); const isSold = isProductSold(product); const statusText = isSold ? 'Đã bán' : `Còn hàng (${stock})`; const statusClass = isSold ? 'is-sold' : 'is-available'; card.classList.toggle('is-sold', isSold); card.setAttribute('tabindex', isSold ? '-1' : '0'); card.setAttribute('aria-disabled', isSold ? 'true' : 'false'); const badge = card.querySelector('.status-badge'); if (badge) { badge.textContent = statusText; badge.className = `status-badge ${statusClass}`; } const media = card.querySelector('.card-media'); if (media) { const existingRibbon = media.querySelector('.sold-ribbon'); if (isSold && !existingRibbon) { const ribbon = document.createElement('div'); ribbon.className = 'sold-ribbon'; ribbon.setAttribute('aria-hidden', 'true'); ribbon.innerHTML = '<span>ĐÃ BÁN</span>'; media.appendChild(ribbon); } else if (!isSold && existingRibbon) existingRibbon.remove(); } const titleEl = card.querySelector('.card-title'); if (titleEl && titleEl.textContent !== (product.name || '')) titleEl.textContent = product.name || ''; const priceEl = card.querySelector('.card-price'); const formattedPrice = formatPrice(product.price); if (priceEl && priceEl.textContent !== formattedPrice) priceEl.textContent = formattedPrice; const detailBtn = card.querySelector('.card-detail-btn'); if (detailBtn) { detailBtn.disabled = isSold; detailBtn.textContent = isSold ? 'Đã bán' : 'Xem chi tiết'; } const addBtn = card.querySelector('.card-add-btn'); if (addBtn) addBtn.disabled = isSold; }); }
function syncOpenModalWithProducts() { if (dom.productModal.hidden || !state.activeModalProductId) return; const product = state.products.find((p) => String(p.id) === String(state.activeModalProductId)); if (!product) return; const stock = getProductStock(product); const isSold = isProductSold(product); const wasDisabled = dom.modalAddToCart.disabled; dom.modalStatus.textContent = isSold ? 'Đã bán' : `Còn hàng (${stock})`; dom.modalStatus.className = `status-badge ${isSold ? 'is-sold' : 'is-available'}`; dom.modalStock.textContent = isSold ? 'Hết hàng' : `Số lượng còn lại: ${stock} sản phẩm`; dom.modalPrice.textContent = formatPrice(product.price); dom.modalAddToCart.disabled = isSold; dom.modalBuyNow.disabled = isSold; if (isSold && !wasDisabled) showToast(`Sản phẩm "${product.name}" vừa được bán hết.`, 'warning'); }
function syncCartWithProducts(products, { notify = true } = {}) { if (!Array.isArray(state.cart) || state.cart.length === 0) return false; const productMap = new Map((Array.isArray(products) ? products : []).map((p) => [String(p.id), p])); let changed = false; state.cart.forEach((item) => { const product = productMap.get(String(item.productId)); const latestStock = product ? getProductStock(product) : 0; const isSoldOut = !product || isProductSold(product) || latestStock <= 0; const wasSoldOut = Boolean(item.isSoldOut); if (product) { const latestPrice = Number(product.price); if (Number.isFinite(latestPrice) && item.price !== latestPrice) { item.price = latestPrice; changed = true; } if (product.name && item.name !== product.name) { item.name = product.name; changed = true; } } if (item.stock !== latestStock) { item.stock = latestStock; changed = true; } if (item.isSoldOut !== isSoldOut) { item.isSoldOut = isSoldOut; changed = true; } if (isSoldOut) { if (notify && !wasSoldOut) showToast(`Sản phẩm "${item.name}" trong giỏ hàng đã hết hàng.`, 'warning'); } else if (item.qty > latestStock) { item.qty = latestStock; changed = true; if (notify) showToast(`Số lượng "${item.name}" trong giỏ đã được điều chỉnh về ${latestStock} theo tồn kho hiện tại.`, 'warning'); } }); if (changed) saveCartToStorage(); return changed; }
function initTheme() { const savedTheme = localStorage.getItem(THEME_STORAGE_KEY); if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.setAttribute('data-theme', savedTheme); }
function toggleDarkMode() { const currentAttr = document.documentElement.getAttribute('data-theme'); const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches; const isCurrentlyDark = currentAttr ? currentAttr === 'dark' : systemDark; const nextTheme = isCurrentlyDark ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', nextTheme); localStorage.setItem(THEME_STORAGE_KEY, nextTheme); }
function openFilterSheet() { dom.filterSheetOverlay.hidden = false; void dom.filterSheetOverlay.offsetWidth; dom.filterSheetOverlay.classList.add('is-open'); dom.filterSheet.classList.add('is-open'); dom.filterSheet.setAttribute('aria-hidden', 'false'); dom.mobileFilterOpenBtn.setAttribute('aria-expanded', 'true'); syncBodyScrollLock(); }
function closeFilterSheet(scrollToCatalog = false) { dom.filterSheetOverlay.classList.remove('is-open'); dom.filterSheet.classList.remove('is-open'); dom.filterSheet.setAttribute('aria-hidden', 'true'); dom.mobileFilterOpenBtn.setAttribute('aria-expanded', 'false'); setTimeout(() => { if (!dom.filterSheet.classList.contains('is-open')) dom.filterSheetOverlay.hidden = true; }, 300); syncBodyScrollLock(); if (scrollToCatalog && dom.productCatalogSection) setTimeout(() => { dom.productCatalogSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); }
function countActiveSheetFilters() { let count = 0; if (state.filters.status !== 'all') count += 1; if (state.filters.minPrice !== null || state.filters.maxPrice !== null) count += 1; return count; }
function updateSearchClearButton() { if (!dom.searchClearBtn || !dom.searchInput) return; dom.searchClearBtn.hidden = dom.searchInput.value.length === 0; }
function renderSkeletons(count = 8) { const items = Array.from({ length: count }, () => `<div class="skeleton-card" aria-hidden="true"><div class="skeleton-thumb skeleton-shimmer"></div><div class="skeleton-body"><div class="skeleton-line short skeleton-shimmer"></div><div class="skeleton-line skeleton-shimmer"></div><div class="skeleton-line medium skeleton-shimmer"></div></div></div>`).join(''); dom.productGrid.innerHTML = items; dom.emptyState.hidden = true; }
function renderPricePresets() { const buttons = dom.pricePresets.querySelectorAll('button[data-price-preset]'); buttons.forEach((btn) => { const isActive = btn.dataset.pricePreset === state.filters.pricePreset; btn.classList.toggle('is-active', isActive); btn.setAttribute('aria-pressed', isActive ? 'true' : 'false'); }); }
function detectMatchingPricePreset(minPrice, maxPrice) { for (const [key, range] of Object.entries(PRICE_PRESETS)) if (range.min === minPrice && range.max === maxPrice) return key; return null; }
function isDefaultFilterState() { const { search, status, minPrice, maxPrice, sort } = state.filters; return (!search.trim() && status === 'all' && minPrice === null && maxPrice === null && sort === 'newest'); }
function filterProductsByCurrentState(list) { const normalizedQuery = normalizeVietnamese(state.filters.search); const { status, minPrice, maxPrice } = state.filters; return list.filter((product) => { const effectiveStatus = isProductSold(product) ? 'sold' : 'available'; if (status !== 'all' && effectiveStatus !== status) return false; const price = Number(product.price) || 0; if (minPrice !== null && price < minPrice) return false; if (maxPrice !== null && price > maxPrice) return false; if (normalizedQuery) { const normalizedName = normalizeVietnamese(product.name); const normalizedDesc = normalizeVietnamese(product.description); if (!normalizedName.includes(normalizedQuery) && !normalizedDesc.includes(normalizedQuery)) return false; } return true; }); }
function sortProducts(list, sortKey) { const sorted = [...list]; switch (sortKey) { case 'price-asc': return sorted.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0)); case 'price-desc': return sorted.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0)); case 'name-asc': return sorted.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi', { sensitivity: 'base' })); case 'newest': default: return sorted.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()); } }
function applyFilters(debounce = false) { const executeFilter = () => { const matched = filterProductsByCurrentState(state.products); state.filteredProducts = sortProducts(matched, state.filters.sort); updateFilterMeta(); renderProducts(state.filteredProducts); }; if (state.filterDebounceTimer) { clearTimeout(state.filterDebounceTimer); state.filterDebounceTimer = null; } if (debounce) state.filterDebounceTimer = setTimeout(executeFilter, FILTER_DEBOUNCE_MS); else executeFilter(); }
function updateFilterMeta() { const count = state.filteredProducts.length; const totalAvailable = state.products.filter((p) => !isProductSold(p)).length; const activeSheetCount = countActiveSheetFilters(); if (dom.resultsCount) dom.resultsCount.innerHTML = `Tìm thấy <strong>${count}</strong> sản phẩm`; if (dom.catalogSummary) dom.catalogSummary.textContent = `Tổng ${state.products.length} sản phẩm (${totalAvailable} còn hàng)`; if (dom.activeFilterBadge) { dom.activeFilterBadge.textContent = String(activeSheetCount); dom.activeFilterBadge.hidden = activeSheetCount === 0; } if (dom.filterSheetApplyBtn) dom.filterSheetApplyBtn.textContent = `Xem ${count} sản phẩm`; if (dom.sheetClearFiltersBtn) dom.sheetClearFiltersBtn.disabled = activeSheetCount === 0; const isDefault = isDefaultFilterState(); if (dom.clearFiltersBtn) { dom.clearFiltersBtn.disabled = isDefault; dom.clearFiltersBtn.classList.toggle('is-active', !isDefault); } }
function renderProducts(products) { if (!products || products.length === 0) { dom.productGrid.innerHTML = ''; dom.emptyState.hidden = false; return; } dom.emptyState.hidden = true; dom.productGrid.innerHTML = products.map((product) => { const stock = getProductStock(product); const isSold = isProductSold(product); const thumb = getProductThumbnail(product); const statusText = isSold ? 'Đã bán' : `Còn hàng (${stock})`; const statusClass = isSold ? 'is-sold' : 'is-available'; return `<article class="product-card ${isSold ? 'is-sold' : ''}" data-product-id="${escapeHtml(product.id)}" tabindex="${isSold ? '-1' : '0'}" aria-disabled="${isSold ? 'true' : 'false'}"><div class="card-media"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(product.name)}" class="card-image" loading="lazy" /><span class="status-badge ${statusClass}">${escapeHtml(statusText)}</span>${isSold ? '<div class="sold-ribbon" aria-hidden="true"><span>ĐÃ BÁN</span></div>' : ''}</div><div class="card-body"><h3 class="card-title">${escapeHtml(product.name)}</h3><div class="card-footer"><span class="card-price">${formatPrice(product.price)}</span><div class="card-actions"><button type="button" class="card-detail-btn" ${isSold ? 'disabled' : ''} aria-label="Xem chi tiết ${escapeHtml(product.name)}">${isSold ? 'Đã bán' : 'Xem chi tiết'}</button><button type="button" class="card-add-btn" data-add-id="${escapeHtml(product.id)}" ${isSold ? 'disabled' : ''} aria-label="Thêm ${escapeHtml(product.name)} vào giỏ hàng" title="Thêm vào giỏ hàng"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg><span class="card-add-label">Thêm</span></button></div></div></div></article>`; }).join(''); dom.productGrid.querySelectorAll('.card-image').forEach((img) => { img.addEventListener('error', () => { img.src = PLACEHOLDER_IMAGE; }, { once: true }); }); }
function resetSheetFiltersOnly() { state.filters.status = 'all'; state.filters.pricePreset = 'all'; state.filters.minPrice = null; state.filters.maxPrice = null; dom.statusRadios.forEach((radio) => { radio.checked = radio.value === 'all'; }); dom.priceMinInput.value = ''; dom.priceMaxInput.value = ''; renderPricePresets(); applyFilters(false); }
function resetAllFilters() { state.filters = { search: '', status: 'all', pricePreset: 'all', minPrice: null, maxPrice: null, sort: 'newest' }; dom.searchInput.value = ''; updateSearchClearButton(); dom.statusRadios.forEach((radio) => { radio.checked = radio.value === 'all'; }); dom.priceMinInput.value = ''; dom.priceMaxInput.value = ''; dom.sortSelect.value = 'newest'; renderPricePresets(); applyFilters(false); }
function setActiveGallerySlide(index, scrollTrack = true) { const slides = dom.modalImageTrack.querySelectorAll('.modal-slide'); if (slides.length === 0) return; const clamped = Math.max(0, Math.min(index, slides.length - 1)); state.activeGalleryIndex = clamped; if (scrollTrack) { const slideWidth = dom.modalImageTrack.clientWidth; dom.modalImageTrack.scrollTo({ left: clamped * slideWidth, behavior: 'smooth' }); } dom.modalGalleryDots.querySelectorAll('.gallery-dot').forEach((dot, idx) => { dot.classList.toggle('is-active', idx === clamped); }); const thumbBtns = dom.modalThumbnails.querySelectorAll('.thumb-btn'); thumbBtns.forEach((btn, idx) => { const isActive = idx === clamped; btn.classList.toggle('is-active', isActive); if (isActive) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }); }
function openProductModal(product) { if (!product || isProductSold(product)) return; state.activeModalProductId = product.id; state.activeGalleryIndex = 0; const images = (Array.isArray(product.images) && product.images.length > 0) ? product.images : [PLACEHOLDER_IMAGE]; dom.modalImageTrack.innerHTML = images.map((imgUrl, idx) => `<div class="modal-slide"><img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(product.name || '')} - Ảnh ${idx + 1}" class="modal-main-image" /></div>`).join(''); dom.modalImageTrack.scrollLeft = 0; dom.modalImageTrack.querySelectorAll('img').forEach((img) => { img.addEventListener('error', () => { img.src = PLACEHOLDER_IMAGE; }, { once: true }); }); if (images.length > 1) { dom.modalGalleryDots.hidden = false; dom.modalGalleryDots.innerHTML = images.map((_, idx) => `<button type="button" class="gallery-dot ${idx === 0 ? 'is-active' : ''}" data-slide-index="${idx}" aria-label="Chuyển tới ảnh ${idx + 1}"></button>`).join(''); } else { dom.modalGalleryDots.hidden = true; dom.modalGalleryDots.innerHTML = ''; } dom.modalThumbnails.innerHTML = images.map((imgUrl, idx) => `<button type="button" class="thumb-btn ${idx === 0 ? 'is-active' : ''}" data-slide-index="${idx}" aria-label="Xem ảnh ${idx + 1}"><img src="${escapeHtml(imgUrl)}" alt="" /></button>`).join(''); dom.modalThumbnails.querySelectorAll('img').forEach((img) => { img.addEventListener('error', () => { img.src = PLACEHOLDER_IMAGE; }, { once: true }); }); const stock = getProductStock(product); const isSold = isProductSold(product); dom.modalStatus.textContent = isSold ? 'Đã bán' : `Còn hàng (${stock})`; dom.modalStatus.className = `status-badge ${isSold ? 'is-sold' : 'is-available'}`; dom.modalStock.textContent = isSold ? 'Hết hàng' : `Số lượng còn lại: ${stock} sản phẩm`; dom.modalProductName.textContent = product.name || ''; dom.modalPrice.textContent = formatPrice(product.price); dom.modalDescription.textContent = product.description || 'Không có mô tả chi tiết.'; dom.modalAddToCart.disabled = isSold; dom.modalBuyNow.disabled = isSold; dom.productModal.hidden = false; if (dom.modalDialog) dom.modalDialog.scrollTop = 0; syncBodyScrollLock(); const url = new URL(window.location.href); if (url.searchParams.get('product') !== String(product.id)) { url.searchParams.set('product', String(product.id)); window.history.pushState({ productId: product.id }, '', url.toString()); } }
function closeProductModal(updateHistory = true) { if (dom.productModal.hidden) return; dom.productModal.hidden = true; state.activeModalProductId = null; syncBodyScrollLock(); if (updateHistory) { const url = new URL(window.location.href); if (url.searchParams.has('product')) { url.searchParams.delete('product'); window.history.pushState({}, '', url.toString()); } } }
function syncModalWithUrl() { const url = new URL(window.location.href); const productId = url.searchParams.get('product'); if (!productId) { closeProductModal(false); return; } const target = state.products.find((p) => String(p.id) === String(productId)); if (target && !isProductSold(target)) openProductModal(target); else closeProductModal(true); }
function loadCartFromStorage() { try { const raw = localStorage.getItem(CART_STORAGE_KEY); const parsed = raw ? JSON.parse(raw) : []; state.cart = Array.isArray(parsed) ? parsed : []; } catch { state.cart = []; } }
function saveCartToStorage() { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart)); }
function openCart(scrollToForm = false) { dom.cartOverlay.hidden = false; void dom.cartOverlay.offsetWidth; dom.cartOverlay.classList.add('is-open'); dom.cartDrawer.classList.add('is-open'); dom.cartDrawer.setAttribute('aria-hidden', 'false'); syncBodyScrollLock(); if (scrollToForm && !dom.cartCheckoutSection.hidden) setTimeout(() => { dom.checkoutForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 260); }
function closeCart() { dom.cartOverlay.classList.remove('is-open'); dom.cartDrawer.classList.remove('is-open'); dom.cartDrawer.setAttribute('aria-hidden', 'true'); setTimeout(() => { if (!dom.cartDrawer.classList.contains('is-open')) dom.cartOverlay.hidden = true; }, 300); syncBodyScrollLock(); }
function addToCart(product, qty = 1) { const stock = getProductStock(product); if (!product || isProductSold(product) || stock <= 0) { showToast('Sản phẩm này đã bán, không thể thêm vào giỏ.', 'error'); return false; } const existing = state.cart.find((item) => String(item.productId) === String(product.id)); const currentQty = existing ? existing.qty : 0; if (currentQty + qty > stock) { showToast(`Chỉ còn tối đa ${stock} sản phẩm trong kho!`, 'warning'); return false; } if (existing) { existing.qty += qty; existing.stock = stock; existing.isSoldOut = false; } else { state.cart.push({ productId: product.id, name: product.name, price: Number(product.price) || 0, image: getProductThumbnail(product), stock, isSoldOut: false, qty }); } saveCartToStorage(); renderCartBadge(); renderCart(); showToast(`Đã thêm "${product.name}" vào giỏ hàng.`); return true; }
function removeFromCart(productId) { state.cart = state.cart.filter((item) => String(item.productId) !== String(productId)); saveCartToStorage(); renderCartBadge(); renderCart(); }
function updateCartQty(productId, delta) { const item = state.cart.find((entry) => String(entry.productId) === String(productId)); if (!item) return; const isSoldOut = isCartItemSoldOut(item); const maxStock = getAvailableStockById(productId); if (delta > 0 && (isSoldOut || maxStock <= 0)) { item.isSoldOut = true; item.stock = 0; saveCartToStorage(); renderCart(); showToast(`Sản phẩm "${item.name}" đã hết hàng.`, 'error'); return; } const nextQty = item.qty + delta; if (nextQty <= 0) { removeFromCart(productId); return; } if (delta > 0 && nextQty > maxStock) { item.stock = maxStock; if (item.qty > maxStock) item.qty = maxStock; saveCartToStorage(); renderCartBadge(); renderCart(); showToast(`Chỉ còn tối đa ${maxStock} sản phẩm trong kho!`, 'warning'); return; } item.qty = nextQty; saveCartToStorage(); renderCartBadge(); renderCart(); }
function renderCartBadge() { const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0); dom.cartBadge.textContent = String(totalQty); dom.cartBadge.hidden = totalQty === 0; }
function renderCart() { if (state.cart.length === 0) { dom.cartItemsList.innerHTML = ''; dom.cartEmpty.hidden = false; dom.cartCheckoutSection.hidden = true; dom.cartDrawerFooter.hidden = true; if (dom.cartOosWarning) { dom.cartOosWarning.hidden = true; dom.cartOosWarning.textContent = ''; } dom.cartTotalAmount.textContent = formatPrice(0); dom.cartFooterAmount.textContent = formatPrice(0); return; } dom.cartEmpty.hidden = true; dom.cartCheckoutSection.hidden = false; dom.cartDrawerFooter.hidden = false; const oosItems = []; dom.cartItemsList.innerHTML = state.cart.map((item) => { const maxStock = getAvailableStockById(item.productId); const isSoldOut = isCartItemSoldOut(item) || maxStock <= 0; const isAtMax = isSoldOut || item.qty >= maxStock; if (isSoldOut) oosItems.push(item); return `<div class="cart-item ${isSoldOut ? 'is-out-of-stock' : ''}" data-cart-id="${escapeHtml(item.productId)}"><img src="${escapeHtml(item.image || PLACEHOLDER_IMAGE)}" alt="${escapeHtml(item.name)}" class="cart-item-img" /><div class="cart-item-info"><div class="cart-item-head"><h4 class="cart-item-name">${escapeHtml(item.name)}</h4><button type="button" class="cart-remove-btn" data-action="remove" data-id="${escapeHtml(item.productId)}" aria-label="Xóa ${escapeHtml(item.name)} khỏi giỏ"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button></div>${isSoldOut ? '<p class="cart-item-oos">Sản phẩm đã hết hàng</p>' : ''}<div class="cart-item-foot"><span class="cart-item-price">${formatPrice(item.price * item.qty)}</span><div class="qty-control"><button type="button" class="qty-btn" data-action="decrease" data-id="${escapeHtml(item.productId)}" aria-label="Giảm số lượng">−</button><span class="qty-value">${item.qty}</span><button type="button" class="qty-btn" data-action="increase" data-id="${escapeHtml(item.productId)}" ${isAtMax ? 'disabled' : ''} aria-label="Tăng số lượng">+</button></div></div></div></div>`; }).join(''); if (dom.cartOosWarning) { if (oosItems.length > 0) { const names = oosItems.map((i) => `"${i.name}"`).join(', '); dom.cartOosWarning.hidden = false; dom.cartOosWarning.textContent = `Cảnh báo: ${names} đã hết hàng. Vui lòng xóa khỏi giỏ trước khi đặt hàng.`; } else { dom.cartOosWarning.hidden = true; dom.cartOosWarning.textContent = ''; } } dom.cartItemsList.querySelectorAll('.cart-item-img').forEach((img) => { img.addEventListener('error', () => { img.src = PLACEHOLDER_IMAGE; }, { once: true }); }); const subtotal = state.cart.reduce((sum, item) => sum + (Number(item.price) || 0) * item.qty, 0); const total = subtotal + SHIPPING_FEE; dom.cartSubtotalAmount.textContent = formatPrice(subtotal); dom.cartTotalAmount.textContent = formatPrice(total); dom.cartFooterAmount.textContent = formatPrice(total); }
async function handleCheckout(formData) { if (state.isSubmittingOrder || state.cart.length === 0) return; for (const item of state.cart) { const maxStock = getAvailableStockById(item.productId); if (isCartItemSoldOut(item) || maxStock <= 0) { item.isSoldOut = true; item.stock = 0; saveCartToStorage(); renderCart(); showToast(`Sản phẩm "${item.name}" đã hết hàng. Vui lòng xóa khỏi giỏ trước khi đặt.`, 'error'); return; } if (item.qty > maxStock) { item.qty = maxStock; item.stock = maxStock; saveCartToStorage(); renderCartBadge(); renderCart(); showToast(`Sản phẩm "${item.name}" chỉ còn tối đa ${maxStock} sản phẩm. Giỏ hàng đã được cập nhật.`, 'warning'); return; } } const customerPhone = String(formData.get('phone') || '').trim(); const provinceCode = dom.provinceSelect.value; const wardCode = dom.wardSelect.value; const addressDetail = String(formData.get('addressDetail') || '').trim(); if (!provinceCode || !wardCode || !addressDetail) { showToast('Vui lòng chọn đầy đủ Tỉnh/Thành, Xã/Phường và nhập địa chỉ chi tiết.', 'error'); return; } const provinceName = dom.provinceSelect.options[dom.provinceSelect.selectedIndex].text; const wardName = dom.wardSelect.options[dom.wardSelect.selectedIndex].text; const fullAddress = formatFullAddress({ detail: addressDetail, wardName, provinceName }); const orderData = { items: state.cart.map((item) => ({ productId: item.productId, qty: item.qty })), customerName: String(formData.get('customerName') || '').trim(), phone: customerPhone, address: fullAddress, note: String(formData.get('note') || '').trim() }; localStorage.setItem(ADDRESS_STORAGE_KEY, JSON.stringify({ name: orderData.customerName, phone: customerPhone, provinceCode, wardCode, addressDetail })); state.isSubmittingOrder = true; dom.submitOrderBtn.disabled = true; dom.submitOrderBtn.textContent = 'Đang gửi đơn hàng...'; try { const res = await createOrder(orderData); if (res && res.success) { state.cart = []; saveCartToStorage(); renderCartBadge(); renderCart(); dom.checkoutForm.reset(); closeCart(); showToast(`Đặt hàng thành công! Shop sẽ sớm liên hệ xác nhận.`, 'success', { actionLabel: 'Theo dõi đơn hàng →', actionHref: `tracking.html?phone=${encodeURIComponent(customerPhone)}`, duration: 8000 }); syncProducts({ force: true, notifyCart: false, throwOnError: false }); } else throw new Error('Phản hồi tạo đơn không hợp lệ.'); } catch (err) { console.error('Lỗi đặt hàng:', err); if (err && err.status === 409) { showToast(err.message || 'Sản phẩm trong giỏ vừa hết hàng.', 'error'); await syncProducts({ force: true, notifyCart: false, throwOnError: false }); renderCartBadge(); renderCart(); openCart(false); } else showToast('Đặt hàng thất bại. Vui lòng thử lại.', 'error'); } finally { state.isSubmittingOrder = false; dom.submitOrderBtn.disabled = false; dom.submitOrderBtn.textContent = 'Đặt hàng ngay'; } }
function showToast(msg, type = 'success', options = {}) { const toast = document.createElement('div'); const typeClass = type === 'error' ? 'is-error' : type === 'warning' ? 'is-warning' : type === 'info' ? 'is-info' : ''; toast.className = `toast ${typeClass}`.trim(); const textEl = document.createElement('div'); textEl.className = 'toast-message'; textEl.textContent = msg; toast.appendChild(textEl); if (options && options.actionHref && options.actionLabel) { const actionLink = document.createElement('a'); actionLink.className = 'toast-action-link'; actionLink.href = options.actionHref; actionLink.textContent = options.actionLabel; toast.appendChild(actionLink); } dom.toastContainer.appendChild(toast); const duration = Number(options?.duration) > 0 ? Number(options.duration) : 3400; setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)'; toast.style.transition = 'opacity 200ms ease, transform 200ms ease'; setTimeout(() => toast.remove(), 220); }, duration); }
function handleManualPriceChange(e) { if (e && e.target) formatPriceInputKeepCaret(e.target); const minPrice = parseOptionalPrice(dom.priceMinInput.value); const maxPrice = parseOptionalPrice(dom.priceMaxInput.value); state.filters.minPrice = minPrice; state.filters.maxPrice = maxPrice; state.filters.pricePreset = detectMatchingPricePreset(minPrice, maxPrice); renderPricePresets(); applyFilters(true); }
function bindEvents() { dom.themeToggle.addEventListener('click', toggleDarkMode); document.addEventListener('visibilitychange', handleVisibilityChange); dom.searchInput.addEventListener('input', (e) => { state.filters.search = e.target.value; updateSearchClearButton(); applyFilters(true); }); dom.searchClearBtn.addEventListener('click', () => { dom.searchInput.value = ''; state.filters.search = ''; updateSearchClearButton(); applyFilters(false); dom.searchInput.focus(); }); dom.mobileFilterOpenBtn.addEventListener('click', openFilterSheet); dom.filterSheetCloseBtn.addEventListener('click', () => closeFilterSheet(false)); dom.filterSheetOverlay.addEventListener('click', () => closeFilterSheet(false)); dom.sheetClearFiltersBtn.addEventListener('click', resetSheetFiltersOnly); dom.filterSheetApplyBtn.addEventListener('click', () => closeFilterSheet(true)); dom.statusRadios.forEach((radio) => { radio.addEventListener('change', (e) => { state.filters.status = e.target.value; applyFilters(false); }); }); dom.sortSelect.addEventListener('change', (e) => { state.filters.sort = e.target.value || 'newest'; applyFilters(false); }); dom.pricePresets.addEventListener('click', (e) => { const btn = e.target.closest('button[data-price-preset]'); if (!btn) return; const presetKey = btn.dataset.pricePreset; const preset = PRICE_PRESETS[presetKey]; if (!preset) return; state.filters.pricePreset = presetKey; state.filters.minPrice = preset.min; state.filters.maxPrice = preset.max; dom.priceMinInput.value = preset.min !== null ? formatThousandDots(preset.min) : ''; dom.priceMaxInput.value = preset.max !== null ? formatThousandDots(preset.max) : ''; renderPricePresets(); applyFilters(false); }); dom.priceMinInput.addEventListener('input', handleManualPriceChange); dom.priceMaxInput.addEventListener('input', handleManualPriceChange); dom.clearFiltersBtn.addEventListener('click', resetAllFilters); dom.emptyResetBtn.addEventListener('click', resetAllFilters); dom.productGrid.addEventListener('click', (e) => { const addBtn = e.target.closest('.card-add-btn'); if (addBtn) { e.stopPropagation(); const product = state.products.find((p) => String(p.id) === String(addBtn.dataset.addId)); if (product) { if (addToCart(product, 1)) animateCartIcon(); } return; } const card = e.target.closest('.product-card'); if (!card || card.classList.contains('is-sold')) return; const product = state.products.find((p) => String(p.id) === String(card.dataset.productId)); if (product) openProductModal(product); }); dom.productGrid.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; if (e.target.closest('.card-add-btn')) return; const card = e.target.closest('.product-card'); if (!card || card.classList.contains('is-sold')) return; e.preventDefault(); const product = state.products.find((p) => String(p.id) === String(card.dataset.productId)); if (product) openProductModal(product); }); dom.modalThumbnails.addEventListener('click', (e) => { const thumbBtn = e.target.closest('.thumb-btn'); if (!thumbBtn) return; const idx = Number(thumbBtn.dataset.slideIndex); if (Number.isFinite(idx)) setActiveGallerySlide(idx, true); }); dom.modalGalleryDots.addEventListener('click', (e) => { const dotBtn = e.target.closest('.gallery-dot'); if (!dotBtn) return; const idx = Number(dotBtn.dataset.slideIndex); if (Number.isFinite(idx)) setActiveGallerySlide(idx, true); }); dom.modalImageTrack.addEventListener('scroll', () => { if (state.galleryScrollTimer) clearTimeout(state.galleryScrollTimer); state.galleryScrollTimer = setTimeout(() => { const slideWidth = dom.modalImageTrack.clientWidth; if (!slideWidth) return; const idx = Math.round(dom.modalImageTrack.scrollLeft / slideWidth); if (idx !== state.activeGalleryIndex) setActiveGallerySlide(idx, false); }, 60); }, { passive: true }); dom.modalAddToCart.addEventListener('click', () => { const product = state.products.find((p) => String(p.id) === String(state.activeModalProductId)); if (!product) return; if (addToCart(product, 1)) { closeProductModal(); animateCartIcon(); } }); dom.modalBuyNow.addEventListener('click', () => { const product = state.products.find((p) => String(p.id) === String(state.activeModalProductId)); if (!product) return; if (!state.cart.some((item) => String(item.productId) === String(product.id))) { if (!addToCart(product, 1)) return; } closeProductModal(); openCart(true); }); dom.modalCloseBtn.addEventListener('click', () => closeProductModal(true)); dom.productModal.addEventListener('click', (e) => { if (e.target === dom.productModal) closeProductModal(true); }); dom.cartOpenBtn.addEventListener('click', () => openCart(false)); dom.cartCloseBtn.addEventListener('click', closeCart); dom.cartOverlay.addEventListener('click', closeCart); dom.cartItemsList.addEventListener('click', (e) => { const btn = e.target.closest('button[data-action]'); if (!btn) return; const { action, id } = btn.dataset; if (action === 'increase') updateCartQty(id, 1); if (action === 'decrease') updateCartQty(id, -1); if (action === 'remove') removeFromCart(id); }); dom.checkoutForm.addEventListener('submit', (e) => { e.preventDefault(); if (!dom.checkoutForm.reportValidity()) { const firstInvalid = dom.checkoutForm.querySelector(':invalid'); if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; } handleCheckout(new FormData(dom.checkoutForm)); }); dom.provinceSelect.addEventListener('change', (e) => loadWards(e.target.value)); dom.wardSelect.addEventListener('change', updateAddressPreview); dom.addressDetailInput.addEventListener('input', updateAddressPreview); document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (dom.cartDrawer.classList.contains('is-open')) closeCart(); else if (dom.filterSheet.classList.contains('is-open')) closeFilterSheet(false); else if (!dom.productModal.hidden) closeProductModal(true); }); window.addEventListener('popstate', syncModalWithUrl); }
document.addEventListener('DOMContentLoaded', init);
