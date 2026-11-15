import { USE_MOCK, API_BASE_URL, MOCK_DELAY_MS } from './config.js';
import { MOCK_PRODUCTS, MOCK_ORDERS } from './mock-data.js';

/**
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} price
 * @property {'available'|'sold'} status
 * @property {number} stock
 * @property {string[]} images
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} createdAt
 * @property {string} customerName
 * @property {string} phone
 * @property {string} address
 * @property {string} note
 * @property {'pending'|'confirmed'|'completed'|'cancelled'} status
 * @property {string} [shippingCarrier]
 * @property {string} [trackingCode]
 * @property {Array<{productId:string, productName:string, qty:number, price:number}>} items
 * @property {number} total
 */

const STORAGE_KEYS = {
  PRODUCTS: 'mock_products',
  ORDERS: 'mock_orders',
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseStockValue(rawStock, fallback = 1) {
  if (rawStock !== undefined && rawStock !== null && String(rawStock).trim() !== '') {
    const parsed = Number.parseInt(String(rawStock), 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return Math.max(0, Number.parseInt(String(fallback), 10) || 0);
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function mockDB() {
  let products;
  let orders;

  const rawProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
  if (rawProducts) {
    products = JSON.parse(rawProducts);
  } else {
    products = JSON.parse(JSON.stringify(MOCK_PRODUCTS));
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
  }

  products = products.map((p) => ({
    ...p,
    stock: parseStockValue(p.stock, p.status === 'sold' ? 0 : 1),
  }));

  const rawOrders = localStorage.getItem(STORAGE_KEYS.ORDERS);
  if (rawOrders) {
    orders = JSON.parse(rawOrders);
  } else {
    orders = JSON.parse(JSON.stringify(MOCK_ORDERS));
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
  }

  return {
    products,
    orders,
    save() {
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
      localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
    },
  };
}

function assertMockToken(adminToken) {
  if (typeof adminToken !== 'string' || adminToken.trim().length < 6) {
    throw new ApiError(401, 'Admin token không hợp lệ hoặc đã hết hạn.');
  }
}

function getNormalizedBaseUrl() {
  return String(API_BASE_URL || '').replace(/\/+$/, '');
}

function serializeBody(data) {
  return data instanceof FormData ? data : JSON.stringify(data);
}

async function apiFetch(path, options = {}, adminToken = null) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (adminToken) {
    headers.set('Authorization', `Bearer ${adminToken}`);
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const targetUrl = `${getNormalizedBaseUrl()}${normalizedPath}`;

  const response = await fetch(targetUrl, {
    ...options,
    headers,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || `Lỗi HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }

  return payload;
}

export async function cancelCustomerOrder(orderId, { phone, customerName, reason } = {}) {
  const url = `${getNormalizedBaseUrl()}/api/orders/${encodeURIComponent(orderId)}/cancel`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, customerName, reason }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error || 'Hủy đơn hàng thất bại');
  }
  return data;
}

/**
 * Tra cứu hành trình thực tế của kiện hàng (SPX Express hoặc hãng khác)
 * @param {string} trackingCode
 * @param {string} [carrier]
 * @returns {Promise<{ supported: boolean, carrier: string, trackingCode: string, currentStatus: string, events: Array<{ time: string, status: string, location: string }>, fallbackUrl: string, message?: string }>}
 */
export async function getLiveTracking(trackingCode, carrier = '') {
  if (USE_MOCK) {
    await delay(MOCK_DELAY_MS);
    return {
      supported: true,
      carrier: carrier || 'SPX Express',
      trackingCode,
      currentStatus: 'Đang giao hàng đến bạn',
      events: [
        { time: '14:30 15/11/2026', status: 'Đang giao hàng đến bạn', location: 'Bưu cục Quận 1, TP.HCM' },
        { time: '09:15 15/11/2026', status: 'Đã rời kho phân loại', location: 'Kho tổng SPX, TP.HCM' },
        { time: '22:00 14/11/2026', status: 'Bưu tá đã lấy hàng', location: 'Shop Trần Thành' }
      ],
      fallbackUrl: `https://spx.vn/track?${trackingCode}`
    };
  }
  return await apiFetch(`/api/tracking/live?code=${encodeURIComponent(trackingCode)}&carrier=${encodeURIComponent(carrier)}`, { method: 'GET' });
}

export async function getProducts({ status } = {}) {
  try {
    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      const { products } = mockDB();
      const filtered = status ? products.filter((p) => p.status === status) : products;
      return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await apiFetch(`/api/products${query}`, { method: 'GET' });
    return Array.isArray(res) ? res : res?.products || [];
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể tải danh sách sản phẩm: ${error.message}`);
  }
}

export async function lookupOrders(phone, orderId = '') {
  try {
    const trimmedPhone = String(phone || '').trim();
    const trimmedOrderId = String(orderId || '').trim();

    if (!trimmedPhone && !trimmedOrderId) {
      throw new ApiError(400, 'Vui lòng nhập số điện thoại để tra cứu đơn hàng.');
    }

    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      const { orders } = mockDB();
      const normalizedTarget = normalizePhone(trimmedPhone);

      const matched = orders.filter((order) => {
        const phoneMatch = normalizedTarget
          ? normalizePhone(order.phone) === normalizedTarget
          : true;
        const idMatch = trimmedOrderId
          ? String(order.id ?? order._id ?? '').toLowerCase() === trimmedOrderId.toLowerCase()
          : true;
        return phoneMatch && idMatch;
      });

      return matched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const params = new URLSearchParams();
    if (trimmedPhone) params.set('phone', trimmedPhone);
    if (trimmedOrderId) params.set('orderId', trimmedOrderId);

    const res = await apiFetch(`/api/orders/lookup?${params.toString()}`, { method: 'GET' });
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.orders)) return res.orders;
    if (res?.order) return [res.order];
    return [];
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể tra cứu đơn hàng: ${error.message}`);
  }
}

export async function createOrder({ items, customerName, phone, address, note = '' }) {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, 'Đơn hàng phải có ít nhất một sản phẩm.');
    }
    if (!customerName?.trim() || !phone?.trim() || !address?.trim()) {
      throw new ApiError(400, 'Vui lòng điền đầy đủ họ tên, số điện thoại và địa chỉ.');
    }

    const trimmedCustomer = customerName.trim();
    const trimmedPhone = phone.trim();
    const trimmedAddress = address.trim();
    const trimmedNote = (note || '').trim();

    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      const db = mockDB();

      const normalizedItems = items.map((item) => {
        const product = db.products.find((p) => p.id === item.productId);
        const qty = Number(item.qty) > 0 ? Number(item.qty) : 1;
        const price = product ? Number(product.price) : Number(item.price || 0);
        const productName = product ? product.name : item.productName || 'Sản phẩm';
        return { productId: item.productId, productName, qty, price };
      });

      const subtotal = normalizedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
      const shippingFee = 19000;
      const total = subtotal + shippingFee;
      const orderId = generateId();

      const newOrder = {
        id: orderId,
        createdAt: new Date().toISOString(),
        customerName: trimmedCustomer,
        phone: trimmedPhone,
        address: trimmedAddress,
        note: trimmedNote,
        status: 'pending',
        shippingCarrier: '',
        trackingCode: '',
        items: normalizedItems,
        subtotal,
        shippingFee,
        total,
      };

      db.orders.unshift(newOrder);
      db.save();
      return { success: true, orderId };
    }

    const res = await apiFetch('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        items,
        customerName: trimmedCustomer,
        phone: trimmedPhone,
        address: trimmedAddress,
        note: trimmedNote,
      }),
    });

    return {
      success: Boolean(res?.success || res?.orderId || res?.order),
      orderId: res?.orderId || res?.order?.id || res?.id,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể tạo đơn hàng: ${error.message}`);
  }
}

export async function verifyAdminToken(token) {
  try {
    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      const valid = typeof token === 'string' && token.trim().length >= 6;
      return { valid };
    }

    try {
      const res = await apiFetch('/api/admin/verify', { method: 'GET' }, token);
      return { valid: res && typeof res.valid === 'boolean' ? res.valid : true };
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return { valid: false };
      }
      throw err;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Lỗi xác thực token admin: ${error.message}`);
  }
}

export async function getAdminProducts(adminToken) {
  try {
    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      assertMockToken(adminToken);
      const { products } = mockDB();
      return [...products].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const res = await apiFetch('/api/admin/products', { method: 'GET' }, adminToken);
    return Array.isArray(res) ? res : res?.products || [];
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể tải danh sách sản phẩm quản trị: ${error.message}`);
  }
}

export async function createProduct(data, adminToken) {
  try {
    const isForm = data instanceof FormData;
    const name = isForm ? data.get('name') : data.name;
    const price = isForm ? data.get('price') : data.price;
    const status = isForm ? (data.get('status') || 'available') : (data.status || 'available');
    const rawStock = isForm ? data.get('stock') : data.stock;
    const description = isForm ? (data.get('description') || '') : (data.description || '');
    const imageUrlsRaw = isForm ? data.get('imageUrls') : null;
    let images = Array.isArray(data.images) ? data.images : [];
    if (imageUrlsRaw) {
      try { images = JSON.parse(imageUrlsRaw); } catch { images = []; }
    }

    if (!String(name || '').trim()) {
      throw new ApiError(400, 'Tên sản phẩm không được để trống.');
    }

    const stock = parseStockValue(rawStock, 1);

    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      assertMockToken(adminToken);
      const db = mockDB();
      const now = new Date().toISOString();

      const newProduct = {
        id: generateId(),
        name: String(name).trim(),
        description: String(description).trim(),
        price: Number(price) || 0,
        status: status === 'sold' ? 'sold' : 'available',
        stock,
        images: Array.isArray(images) ? images.filter(Boolean) : [],
        createdAt: now,
        updatedAt: now,
      };

      db.products.unshift(newProduct);
      db.save();
      return newProduct;
    }

    let payload = data;
    if (isForm) {
      if (!data.has('stock')) {
        data.append('stock', String(stock));
      }
    } else {
      payload = { ...data, stock };
    }

    const res = await apiFetch(
      '/api/admin/products',
      { method: 'POST', body: serializeBody(payload) },
      adminToken
    );
    return res?.product || res;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể tạo sản phẩm: ${error.message}`);
  }
}

export async function updateProduct(id, data, adminToken) {
  try {
    if (!id) throw new ApiError(400, 'Thiếu ID sản phẩm.');

    const isForm = data instanceof FormData;
    const rawStock = isForm ? data.get('stock') : data.stock;

    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      assertMockToken(adminToken);
      const db = mockDB();
      const index = db.products.findIndex((p) => p.id === id);
      if (index === -1) throw new ApiError(404, `Không tìm thấy sản phẩm có ID ${id}.`);

      const name = isForm ? data.get('name') : data.name;
      const price = isForm ? data.get('price') : data.price;
      const status = isForm ? data.get('status') : data.status;
      const description = isForm ? data.get('description') : data.description;
      const existingImagesRaw = isForm ? data.get('existingImages') : null;
      const imageUrlsRaw = isForm ? data.get('imageUrls') : null;

      let images = db.products[index].images;
      let parsedExisting = null;
      let parsedUrls = null;
      if (existingImagesRaw) {
        try { parsedExisting = JSON.parse(existingImagesRaw); } catch {}
      }
      if (imageUrlsRaw) {
        try { parsedUrls = JSON.parse(imageUrlsRaw); } catch {}
      }

      if (parsedExisting !== null || parsedUrls !== null) {
        images = Array.from(new Set([...(parsedExisting || []), ...(parsedUrls || [])]));
      } else if (Array.isArray(data.images)) {
        images = data.images;
      }

      const existing = db.products[index];
      const nextStatus = status === 'sold' ? 'sold' : status === 'available' ? 'available' : existing.status;
      const hasStockParam = rawStock !== undefined && rawStock !== null && String(rawStock).trim() !== '';
      const fallbackStock = nextStatus === 'sold' ? 0 : parseStockValue(existing.stock, 1);
      const nextStock = hasStockParam ? parseStockValue(rawStock, fallbackStock) : fallbackStock;

      const updated = {
        ...existing,
        name: name !== undefined ? String(name).trim() : existing.name,
        description: description !== undefined ? String(description).trim() : existing.description,
        price: price !== undefined ? Number(price) : existing.price,
        status: nextStatus,
        stock: nextStock,
        images,
        updatedAt: new Date().toISOString(),
      };

      db.products[index] = updated;
      db.save();
      return updated;
    }

    let payload = data;
    if (!isForm && rawStock !== undefined && rawStock !== null && String(rawStock).trim() !== '') {
      payload = { ...data, stock: parseStockValue(rawStock, 1) };
    }

    const res = await apiFetch(
      `/api/admin/products/${encodeURIComponent(id)}`,
      { method: 'PUT', body: serializeBody(payload) },
      adminToken
    );
    return res?.product || res;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể cập nhật sản phẩm: ${error.message}`);
  }
}

export async function deleteProduct(id, adminToken) {
  try {
    if (!id) throw new ApiError(400, 'Thiếu ID sản phẩm.');

    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      assertMockToken(adminToken);
      const db = mockDB();
      const index = db.products.findIndex((p) => p.id === id);
      if (index === -1) throw new ApiError(404, `Không tìm thấy sản phẩm có ID ${id}.`);
      db.products.splice(index, 1);
      db.save();
      return { success: true };
    }

    const res = await apiFetch(
      `/api/admin/products/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      adminToken
    );
    return { success: Boolean(res?.success || res?.deleted || true) };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể xóa sản phẩm: ${error.message}`);
  }
}

export async function updateProductStatus(id, status, adminToken, stock) {
  try {
    if (!id) throw new ApiError(400, 'Thiếu ID sản phẩm.');
    if (status !== 'available' && status !== 'sold') {
      throw new ApiError(400, 'Trạng thái sản phẩm phải là "available" hoặc "sold".');
    }

    const nextStock = parseStockValue(stock, status === 'sold' ? 0 : 1);

    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      assertMockToken(adminToken);
      const db = mockDB();
      const index = db.products.findIndex((p) => p.id === id);
      if (index === -1) throw new ApiError(404, `Không tìm thấy sản phẩm có ID ${id}.`);
      db.products[index] = {
        ...db.products[index],
        status,
        stock: nextStock,
        updatedAt: new Date().toISOString(),
      };
      db.save();
      return db.products[index];
    }

    const res = await apiFetch(
      `/api/admin/products/${encodeURIComponent(id)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status, stock: nextStock }) },
      adminToken
    );
    return res?.product || res;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể cập nhật trạng thái sản phẩm: ${error.message}`);
  }
}

export async function getOrders(adminToken) {
  try {
    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      assertMockToken(adminToken);
      const { orders } = mockDB();
      return [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const res = await apiFetch('/api/admin/orders', { method: 'GET' }, adminToken);
    return Array.isArray(res) ? res : res?.orders || [];
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể tải danh sách đơn hàng: ${error.message}`);
  }
}

export async function updateOrderStatus(orderId, status, adminToken) {
  try {
    if (!orderId) throw new ApiError(400, 'Thiếu mã đơn hàng.');
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new ApiError(400, `Trạng thái đơn hàng không hợp lệ: ${status}.`);
    }

    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      assertMockToken(adminToken);
      const db = mockDB();
      const index = db.orders.findIndex((o) => o.id === orderId);
      if (index === -1) throw new ApiError(404, `Không tìm thấy đơn hàng có mã ${orderId}.`);
      db.orders[index] = { ...db.orders[index], status };
      db.save();
      return db.orders[index];
    }

    const res = await apiFetch(
      `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
      adminToken
    );
    return res?.order || res;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể cập nhật trạng thái đơn hàng: ${error.message}`);
  }
}

export async function updateOrderTracking(orderId, { shippingCarrier = '', trackingCode = '', status } = {}, adminToken) {
  try {
    if (!orderId) throw new ApiError(400, 'Thiếu mã đơn hàng.');

    const cleanCarrier = String(shippingCarrier || '').trim();
    const cleanCode = String(trackingCode || '').trim();
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

    if (status && !validStatuses.includes(status)) {
      throw new ApiError(400, `Trạng thái đơn hàng không hợp lệ: ${status}.`);
    }

    if (USE_MOCK) {
      await delay(MOCK_DELAY_MS);
      assertMockToken(adminToken);
      const db = mockDB();
      const index = db.orders.findIndex((o) => o.id === orderId);
      if (index === -1) throw new ApiError(404, `Không tìm thấy đơn hàng có mã ${orderId}.`);

      db.orders[index] = {
        ...db.orders[index],
        shippingCarrier: cleanCarrier,
        trackingCode: cleanCode,
        ...(status ? { status } : {}),
        updatedAt: new Date().toISOString(),
      };
      db.save();
      return db.orders[index];
    }

    const bodyPayload = {
      shippingCarrier: cleanCarrier,
      trackingCode: cleanCode,
      ...(status ? { status } : {}),
    };

    try {
      const res = await apiFetch(
        `/api/admin/orders/${encodeURIComponent(orderId)}/tracking`,
        { method: 'PATCH', body: JSON.stringify(bodyPayload) },
        adminToken
      );
      return res?.order || res;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
        const fallbackRes = await apiFetch(
          `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
          { method: 'PATCH', body: JSON.stringify(bodyPayload) },
          adminToken
        );
        return fallbackRes?.order || fallbackRes;
      }
      throw err;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể cập nhật thông tin vận chuyển: ${error.message}`);
  }
}
