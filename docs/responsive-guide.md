# Layout đa thiết bị (multi-device) — Đã kiểm tra và sửa gì

Khác với đợt tối ưu tốc độ trước (chỉ đọc code), đợt này **chạy thật** app bằng Playwright (headless Chromium), chụp ảnh 2 trang ở 3 độ rộng màn hình (375px điện thoại, 768px tablet, 1440px desktop), rồi soi ảnh thật để tìm lỗi — không đoán từ class Tailwind.

## 1. Trang đã kiểm tra

- **`/products/[slug]`** — trang công khai duy nhất (khách hàng xem sản phẩm).
- **`/admin/dashboard`** — trang admin đại diện, có sidebar responsive sẵn (`DashboardLayout.tsx` đã có bottom-nav riêng cho mobile).

## 2. Kết quả: trang sản phẩm — không có lỗi

Toàn bộ component (`ProductHero`, `ProductOverview`, `ProductSpecifications`, `ProductResources`, `ProductCompatibility`, `RelatedProducts`) đã dùng đúng pattern `grid-cols-1 sm:.../lg:...`, bảng thông số kỹ thuật đã bọc `overflow-x-auto` (không tràn ngang trang). Ảnh chụp ở cả 3 độ rộng đều sạch, không cắt chữ, không đè nhau, không tràn ngang (`document.scrollWidth === viewport width` ở cả 6 phép đo).

## 3. Lỗi thật tìm được: dashboard admin bị cắt chữ ở độ rộng tablet

Ảnh chụp `/admin/dashboard` ở 768px cho thấy 3 thẻ đầu trang ("Last Automated Scan", "Last CMS Sync", "Specs Translation Pipeline") bị **cắt chữ nghiêm trọng** — tiêu đề, ngày giờ, mô tả đều tràn ra ngoài khung thẻ.

**Nguyên nhân**: `src/app/admin/dashboard/page.tsx` dùng `grid-cols-1 md:grid-cols-3` cho hàng 3 thẻ này. Breakpoint `md:` của Tailwind là **768px** — đúng bằng độ rộng tablet đang test. Vì sidebar admin chiếm ~245px, vùng nội dung thật ở 768px chỉ còn ~500px, chia 3 cột chỉ còn ~160px/thẻ — quá hẹp cho nội dung.

**Đã sửa**: đổi `md:grid-cols-3` → `lg:grid-cols-3` (1024px). Ở độ rộng tablet, 3 thẻ giờ xếp dọc 1 cột (đủ chỗ đọc), chỉ chia 3 cột khi màn hình đủ rộng (≥1024px).

## 4. Lỗi thứ hai (phát hiện khi kiểm chứng lại lần sửa đầu): title + nút cùng hàng bị cắt trong lưới 2/4 cột

Hai thẻ "Products with Images" và "Products with Documents" có tiêu đề + nút hành động tiếng Việt dài (`"Xem sản phẩm thiếu tài liệu"`...) đặt **cùng một hàng** (`flex-row justify-between`). Các thẻ này nằm trong lưới `sm:grid-cols-2 lg:grid-cols-4` — nghĩa là thẻ **không bao giờ full-width** trừ khi màn hình < 640px.

**Lần sửa đầu bị sai**: thử đổi thành `flex-col sm:flex-row` (chỉ xếp dọc khi < 640px viewport) — nhưng đã kiểm chứng lại bằng ảnh chụp thì vẫn bị cắt y hệt ở 768px, vì `sm:` (640px) so với **viewport**, trong khi độ rộng THẬT của thẻ phụ thuộc vào **số cột đang active** (2 cột ở 768–1023px, 4 cột ở ≥1024px) — thẻ không bao giờ đủ rộng để tiêu đề + nút dài nằm cùng hàng một cách thoải mái, bất kể viewport bao nhiêu.

**Cách sửa đúng**: bỏ hẳn phần `sm:flex-row`, để tiêu đề + nút **luôn xếp dọc** (`flex-col items-start gap-2`), không phụ thuộc breakpoint. Đã kiểm chứng lại bằng ảnh chụp ở cả 375px/768px/1440px — mọi cỡ đều đọc rõ, kể cả ở 1440px (4 cột) nơi thẻ đã đủ rộng nhưng xếp dọc vẫn nhìn gọn gàng, không lãng phí không gian đáng kể.

*Bài học*: khi 1 component nằm trong lưới nhiều cột, đừng dùng breakpoint theo **viewport** (`sm:`/`md:`/`lg:`) để quyết định layout bên trong nó — độ rộng thật của thẻ phụ thuộc vào số cột đang active, không phải viewport. An toàn nhất là chọn 1 layout ổn định (ở đây: luôn xếp dọc) thay vì đoán ngưỡng.

## 5. Một điều "trông giống bug" nhưng không phải

Trong ảnh chụp full-page (`fullPage: true`), có 1 vòng tròn đen chữ "N" nổi đè lên nội dung ở vị trí bất thường (không cố định theo layout). Đây là **badge dev-tools của Next.js** (`next dev` hiển thị mặc định, biến mất khi build production) — do là phần tử `position: fixed`, khi Playwright ghép nhiều khung hình để chụp full-page, phần tử fixed bị "đóng băng" ở 1 vị trí lệch thay vì bám đáy màn hình như lúc cuộn thật. Không phải lỗi trang, không cần sửa.

## 6. Đã kiểm chứng

- `tsc --noEmit`: sạch.
- `eslint` trên `src/app/admin/dashboard/page.tsx`: 4 warning — đã đối chiếu `git stash`, xác nhận có sẵn từ trước (import không dùng, không liên quan đến đợt sửa này).
- `next build`: thành công.
- Test suite: 161/163 pass (2 lỗi có sẵn từ trước, không liên quan).
- **Kiểm chứng bằng ảnh chụp thật** (không chỉ đọc code): chụp lại `/admin/dashboard` ở cả 3 độ rộng sau khi sửa — xác nhận cả 2 lỗi trên đã hết, không phát sinh lỗi mới.

## 7. Đợt kiểm tra thêm ở PC (1440px, 1920px) — lỗi thật thứ ba

Theo yêu cầu "chỉnh lại layout trên PC cho ổn định", đã mở rộng audit sang 2 trang admin mới build trong phiên này (`/admin/tools/cms-translate`, `/admin/wix-translations`) ở cả 1440px lẫn 1920px (màn hình rộng).

**Lỗi tìm được**: nút "Tải lại" (Reload) trong card "Sản phẩm trong CMS" bị rớt xuống **một hàng riêng, full-width**, thay vì nằm gọn ở góc phải cùng hàng với tiêu đề — xảy ra ở **cả 2 trang**, mọi độ rộng PC.

**Nguyên nhân**: component `CardHeader` (trong `src/components/ui/card.tsx`) mặc định là `display: grid` (không phải `flex`). Code viết `className="flex-row items-center justify-between ..."` để đổi layout — nhưng `flex-row` chỉ là *flex-direction*, không phải *display*. Thiếu class `flex` (chính là class set `display: flex`) nên `display: grid` từ base class không bao giờ bị ghi đè — mọi phần tử con vẫn xếp theo grid 1 cột mặc định (mỗi phần tử 1 hàng riêng, full-width), bất kể `items-center`/`justify-between` có mặt hay không (các class đó vô tác dụng vì `display` vẫn là `grid`).

Đây là dạng lỗi **im lặng** — code nhìn hợp lý, TypeScript/ESLint không báo gì, chỉ lộ ra khi nhìn ảnh chụp thật. Đúng 3 chỗ dính lỗi này (đều do tôi viết trong phiên làm việc này):
- `src/components/wix-translations/wix-translation-page.tsx:318`
- `src/app/admin/tools/cms-translate/page.tsx:416` và `:551`

**Đã sửa**: thêm class `flex` còn thiếu (`"flex flex-row items-center justify-between ..."`). Đã rà lại toàn bộ codebase (`grep className="flex-row` / `"flex-col`) để chắc chắn không còn chỗ nào khác dính lỗi tương tự — sạch.

**Đã kiểm chứng lại bằng ảnh chụp** (không chỉ tin đã sửa đúng): chụp lại cả 2 trang sau khi sửa — nút giờ nằm đúng vị trí, cùng hàng với tiêu đề. Ảnh trước/sau đã gửi kèm.

## 8. Phạm vi chưa kiểm tra (do giới hạn thời gian phiên làm việc)

Chỉ kiểm tra sâu các trang: `/products/[slug]`, `/admin/dashboard`, `/admin/tools/cms-translate`, `/admin/wix-translations`. Các trang admin khác (`/admin/discovery`, các bảng dữ liệu lớn, `/admin/tools/cms-merge`, `/admin/tools/wix-translation-sync`...) chưa được audit — có thể có lỗi cùng loại (grid/flex thiếu class, breakpoint viewport áp cho nội dung trong lưới nhiều cột) — nếu cần, nên audit thêm bằng đúng cách đã làm ở đây (chụp ảnh thật ở nhiều độ rộng, không chỉ đọc class Tailwind).
