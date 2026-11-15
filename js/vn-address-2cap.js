/**
 * Module quản lý địa chỉ Việt Nam (2 cấp: Tỉnh/Thành - Xã/Phường)
 * API: https://provinces.open-api.vn/api/v2/
 */

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 ngày

const FALLBACK_PROVINCES = [
  { code: "1", name: "Hà Nội" }, { code: "79", name: "TP. Hồ Chí Minh" },
  { code: "31", name: "Hải Phòng" }, { code: "48", name: "Đà Nẵng" },
  { code: "92", name: "Cần Thơ" }, { code: "46", name: "Thừa Thiên Huế" },
  { code: "40", name: "Nghệ An" }, { code: "38", name: "Thanh Hóa" },
  { code: "42", name: "Hà Tĩnh" }, { code: "22", name: "Quảng Ninh" },
  { code: "27", name: "Bắc Ninh" }, { code: "33", name: "Hưng Yên" },
  { code: "37", name: "Ninh Bình" }, { code: "25", name: "Phú Thọ" },
  { code: "19", name: "Thái Nguyên" }, { code: "10", name: "Lào Cai" },
  { code: "08", name: "Tuyên Quang" }, { code: "04", name: "Cao Bằng" },
  { code: "20", name: "Lạng Sơn" }, { code: "14", name: "Sơn La" },
  { code: "11", name: "Điện Biên" }, { code: "12", name: "Lai Châu" },
  { code: "45", name: "Quảng Trị" }, { code: "51", name: "Quảng Ngãi" },
  { code: "64", name: "Gia Lai" }, { code: "66", name: "Đắk Lắk" },
  { code: "56", name: "Khánh Hòa" }, { code: "68", name: "Lâm Đồng" },
  { code: "75", name: "Đồng Nai" }, { code: "72", name: "Tây Ninh" },
  { code: "87", name: "Đồng Tháp" }, { code: "86", name: "Vĩnh Long" },
  { code: "89", name: "An Giang" }, { code: "96", name: "Cà Mau" }
];

async function fetchWithTimeout(url, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return await response.json();
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

export async function fetchProvinces() {
  const cacheKey = 'vn_provinces_v2_list';
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TTL) return data;
  }

  try {
    const data = await fetchWithTimeout('https://provinces.open-api.vn/api/v2/p/');
    const formatted = data.map(p => ({ code: String(p.code), name: p.name }))
                         .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    localStorage.setItem(cacheKey, JSON.stringify({ data: formatted, timestamp: Date.now() }));
    return formatted;
  } catch (e) {
    return FALLBACK_PROVINCES.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }
}

export async function fetchWardsByProvince(provinceCode) {
  const cacheKey = `vn_provinces_v2_wards_${provinceCode}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TTL) return data;
  }

  try {
    const data = await fetchWithTimeout(`https://provinces.open-api.vn/api/v2/p/${encodeURIComponent(provinceCode)}?depth=2`);
    let wards = data.wards || [];
    if (!wards.length && data.districts) {
      wards = data.districts.flatMap(d => d.wards || []);
    }
    
    const uniqueWards = Array.from(new Map(wards.map(w => [w.code, { code: String(w.code), name: w.name, division_type: w.division_type || '' }])).values())
                             .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    
    localStorage.setItem(cacheKey, JSON.stringify({ data: uniqueWards, timestamp: Date.now() }));
    return uniqueWards;
  } catch (e) {
    return []; // Trả về mảng rỗng nếu lỗi, yêu cầu logic UI xử lý fallback cụ thể nếu cần
  }
}

export function formatFullAddress({ detail, wardName, provinceName }) {
  return [detail, wardName, provinceName]
    .filter(part => part && part.trim() !== '')
    .map(part => part.trim())
    .join(', ');
}

export { fetchProvinces as getProvinces, fetchWardsByProvince as getCommunesByProvince };
