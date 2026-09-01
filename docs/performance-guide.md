# Tối ưu tốc độ website — Đã sửa gì và vì sao

Tài liệu này ghi lại đợt tối ưu performance cho `/products/[slug]` — trang **công khai duy nhất** trong app này (mọi route khác dưới `/admin/*` là công cụ quản trị sau đăng nhập, nơi "luôn lấy dữ liệu mới nhất" là hành vi đúng, không phải lỗi cần sửa).

## 1. Lỗi nghiêm trọng nhất: ISR bị vô hiệu hoá ngầm

`app/products/[slug]/page.tsx` đã khai báo `export const revalidate = 3600;` — ý định rõ ràng là dùng **ISR** (cache trang tĩnh, làm mới mỗi giờ) thay vì render lại từ đầu mỗi request.

Nhưng hai hàm được gọi trực tiếp trong trang (`getAllProducts()`, `getActiveBrands()` — dùng cho phần "Sản phẩm liên quan") có `fetch(..., { cache: "no-store" })` **cứng trong code**. Theo tài liệu Next.js đóng gói sẵn trong `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md` (dự án này KHÔNG bật `cacheComponents`, nên áp dụng mô hình cache "cũ"):

> `'force-dynamic'`... equivalent to: Setting the option of every `fetch()` request in a layout or page to `{ cache: 'no-store', ... }`

Nói cách khác: **chỉ cần một `fetch` nào đó trong cây render dùng `no-store`, cả route bị ép render động (SSR) trên mọi request** — bất kể `revalidate = 3600` đã khai báo. Đã kiểm chứng: build output của route này luôn hiện `ƒ /products/[slug]` (dynamic), đúng như dự đoán.

Hệ quả thực tế: **mỗi lượt xem trang sản phẩm** — không phải mỗi giờ một lần — đều:
1. Gọi API Wix để lấy sản phẩm theo slug.
2. Gọi `getAllProducts()` — **fetch toàn bộ catalog**, phân trang tuần tự 100 item/lần (nếu catalog có 500 sản phẩm = 5 round-trip nối tiếp tới Wix).
3. Gọi `getActiveBrands()` — fetch toàn bộ danh sách brand.

Tất cả đều đồng bộ, chặn phản hồi HTML cho người dùng — đây gần như chắc chắn là nguyên nhân chính khiến trang sản phẩm "chậm".

### Cách sửa

Không đổi hành vi của `getAllProducts()`/`getActiveBrands()` gốc — các tool admin (`discoveryEngine.ts`, `imageDiscoveryService.ts`, `admin/dashboard`) **cố tình** cần dữ liệu luôn mới, đổi cache ở đó sẽ là lỗi khác. Thay vào đó, tách logic query dùng chung ra hàm nội bộ (`queryAllProducts`, `queryActiveBrands`) nhận tham số cache, rồi thêm 2 hàm export mới **chỉ dành cho trang công khai**:

```ts
// wixCms.ts
export async function getAllProducts() {        // admin — không đổi, vẫn no-store
  return queryAllProducts({ cache: "no-store" });
}
export const getAllProductsForPublicPage = cache(async () => {  // trang sản phẩm — ISR-cached
  return queryAllProducts({ next: { revalidate: 3600 } });
});
```

Tương tự cho `getActiveBrands`/`getActiveBrandsForPublicPage`. `products/[slug]/page.tsx` đổi sang gọi 2 hàm `*ForPublicPage`. Fallback-scan bên trong `getProductBySlug()` (khi query filter trực tiếp không ra kết quả) cũng đổi sang gọi `getAllProductsForPublicPage()` — hàm này vốn chỉ được gọi từ trang công khai.

Bọc thêm React `cache()` quanh 2 hàm mới để dedupe trong cùng 1 lượt render (nếu cả `RelatedProducts` lẫn fallback-scan của `getProductBySlug` cùng cần `allProducts` trong 1 request, chỉ fetch 1 lần).

**Kết quả kỳ vọng**: lượt xem đầu tiên của 1 sản phẩm vẫn chậm như cũ (phải fetch thật), nhưng **mọi lượt xem tiếp theo trong vòng 1 giờ** được phục vụ từ cache tĩnh của Next — gần như tức thời, không chạm tới Wix API nữa.

## 2. Ảnh sản phẩm chưa được tối ưu — dùng `<img>` thô

`ProductGallery.tsx` (ảnh chính + thumbnail) và `RelatedProducts.tsx` (4 ảnh sản phẩm liên quan) đều dùng `<img src=... />` thẳng tới URL gốc từ Wix CDN (`static.wixstatic.com`) — bỏ qua hoàn toàn Next Image Optimization: không resize theo kích thước hiển thị thực tế, không tự chuyển WebP/AVIF, không lazy-load chuẩn.

`next.config.ts` trước đó **không có `images.remotePatterns`** — lý do nhiều khả năng những `<img>` này từng cố dùng `next/image` nhưng bị lỗi "hostname not configured" nên chuyển tạm sang `<img>` thô (thấy rõ trong `ProductGallery.tsx`: đã `import Image from "next/image"` nhưng chưa từng dùng tới).

### Đã sửa
- Thêm `images.remotePatterns` cho `static.wixstatic.com` trong `next.config.ts`.
- Đổi toàn bộ `<img>` trong `ProductGallery.tsx` và `RelatedProducts.tsx` sang `<Image fill sizes=... />` (ảnh chính có `priority` cho ảnh đầu tiên; ảnh liên quan dùng `loading="lazy"` vì nằm dưới màn hình đầu).

## 3. Hai bộ font được tải nhưng không hiển thị

`globals.css` có:
```css
@theme inline {
  --font-sans: var(--font-sans); /* tự tham chiếu — không bao giờ resolve ra giá trị nào */
}
```
Trong khi `layout.tsx` tải **cả** Geist Sans lẫn Inter (5 weight: 400/500/600/700/800) qua `next/font/google`. Vì `--font-sans` không trỏ tới font nào trong hai font đã tải, body text thực chất rơi về font mặc định của trình duyệt — hai bộ font kia được tải về (tốn băng thông, tốn 1 phần thời gian render font) mà **không hiển thị ở đâu cả**.

### Đã sửa (theo lựa chọn của bạn: Geist Sans)
- `--font-sans: var(--font-sans)` → `--font-sans: var(--font-geist-sans)`.
- Bỏ hẳn việc tải Inter trong `layout.tsx` (không còn dùng ở đâu) — giảm số font-file phải tải, giảm CLS tiềm ẩn từ web font swap.

## 4. Đã kiểm tra, không phải vấn đề

- Dependency nặng phía server (`googleapis`, `playwright`, `nodemailer`, `xlsx`) — đều chỉ được import trong `src/lib/services/*.ts`, không có Client Component nào import trực tiếp; không rò rỉ vào bundle client.
- `getBrandById()`, `getProductBySlug()` (truy vấn lọc trực tiếp, không phải "lấy hết rồi lọc") vốn đã bọc React `cache()` và không set `no-store` — không góp phần vào lỗi ISR ở mục 1.

## 5. Đã kiểm tra sau khi sửa

- `tsc --noEmit`: sạch.
- `eslint` trên toàn bộ file đã đổi: sạch (không phát sinh lỗi/warning mới — đã đối chiếu với `git stash` để xác nhận các warning còn lại trong `wixCms.ts` là có sẵn từ trước, không liên quan).
- `next build`: thành công.
- Test suite: 161/163 pass (2 lỗi còn lại có sẵn từ trước, không liên quan — đã xác minh nhiều lần trong phiên làm việc này).

**Chưa kiểm chứng được bằng cách chạy thật** (cần credential Wix + traffic thật): tốc độ tải trang thực tế trước/sau, vì route `/products/[slug]` luôn hiện `ƒ` trong bảng route của `next build` — đây là do `dynamicParams: true` không có `generateStaticParams()` (không có path nào được prerender ở build time), không phản ánh việc ISR có hoạt động đúng lúc runtime hay không. Cách xác minh triệt để là deploy rồi theo dõi thời gian phản hồi trang sản phẩm qua nhiều lượt xem liên tiếp trong vòng 1 giờ — lượt sau phải nhanh hơn hẳn lượt đầu nếu cache hoạt động đúng.

## 6. Gợi ý nếu muốn tối ưu thêm (chưa làm trong đợt này)

- **`generateStaticParams()`**: prerender sẵn HTML cho các sản phẩm quan trọng/phổ biến ngay lúc build, thay vì để lượt truy cập đầu tiên luôn phải chịu chi phí fetch đầy đủ.
- **Phân tích bundle** (`@next/bundle-analyzer`, chưa cài): xác định chính xác dung lượng JS gửi xuống client cho từng route, đặc biệt các trang admin nhiều component nặng (bảng dữ liệu, dialog, drag-drop).
- **`getProductBySlug`'s fallback full-scan**: nếu field `slug` trong Wix CMS không được điền đầy đủ/nhất quán, nhiều sản phẩm sẽ thường xuyên rơi vào nhánh quét toàn bộ catalog thay vì query lọc trực tiếp — nên rà soát dữ liệu CMS thực tế để giảm tần suất rơi vào nhánh chậm này.
