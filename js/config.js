// ============================================================================
// CẤU HÌNH KẾT NỐI API & CHẾ ĐỘ HOẠT ĐỘNG
// ============================================================================

// true: Dùng Mock localStorage (không cần chạy Backend / Turso)
// false: Kết nối trực tiếp tới Cloudflare Worker REST API
export const USE_MOCK = false;

// URL của Cloudflare Worker Backend:
// - Chạy Local: 'http://localhost:8787'
// - Chạy Production: 'https://shoptranthanh.huud09052009.workers.dev'
export const API_BASE_URL = 'https://shoptranthanh.huud09052009.workers.dev';

// Độ trễ mạng giả lập khi USE_MOCK = true (ms)
export const MOCK_DELAY_MS = 300;

// Tên thương hiệu cửa hàng
export const SHOP_NAME = 'SHOP Trần Thành';

// Trạng thái đơn hàng
export const ORDER_STATUSES = {
  pending: 'Chờ duyệt',
  confirmed: 'Đã xác nhận',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
};

// Chuẩn hóa chuỗi tiếng Việt không dấu để phục vụ tìm kiếm / lọc
export function removeVietnameseTones(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

// Trích xuất danh sách danh mục duy nhất từ danh sách sản phẩm thực tế
export function extractCategories(products) {
  if (!Array.isArray(products)) return [];
  const set = new Set();
  products.forEach((p) => {
    const cat = p.category ? String(p.category).trim() : '';
    if (cat) set.add(cat);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
}
