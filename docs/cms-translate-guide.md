# Dịch CMS Anh → Việt — Cách hoạt động

Tài liệu này giải thích chức năng **Dịch CMS Anh → Việt** (`/admin/tools/cms-translate`) — khác với [Wix Multilingual Translator](wix-translation-guide.md) (`/admin/wix-translations`).

## 1. Khác biệt với Wix Multilingual Translator

Wix Multilingual Translator dùng **Wix Translation Schema/Content API**: một field logic duy nhất (ví dụ `title`) có nội dung khác nhau theo locale, lưu tách biệt khỏi item CMS.

Tính năng này dùng cho các collection **không** đăng ký Wix Multilingual mà thay vào đó có **field vật lý riêng cho từng ngôn ngữ trên cùng một item**, ví dụ `title_EN` / `title_VI`, `description_EN` / `description_VI`. Vì cả hai field cùng sống trên một item CMS, đọc/ghi chỉ cần Wix Data Items API thông thường — không đụng đến Translation Content API.

## 2. Luồng dữ liệu

```
Wix CMS item                                    AI Provider (Ollama/GPT/Gemini)
  { title_EN: "...", title_VI: "" }                     │ dịch field_EN → field_VI
        │ đọc field *_EN                                 ▼
        ▼                                        translateCmsEnglishToVietnamese()
  Chỉ gửi field *_EN còn thiếu bản dịch                   │
  (không gửi cả item, không gửi field đã có VI)           │ PATCH field *_VI
                                                           ▼
                                                    Wix CMS item (field EN giữ nguyên,
                                                    field không liên quan không đổi)
```

Hàm chính: [`translateCmsEnglishToVietnamese()`](../src/services/cms-translation/translate-cms.service.ts).

## 3. Tái sử dụng hạ tầng có sẵn (không dựng kiến trúc song song)

| Việc cần | Tái sử dụng từ |
|---|---|
| Allowlist collection (không nhận raw collection ID từ client) | `ALLOWED_COLLECTIONS`/`resolveCollection()` trong [wix-translation.config.ts](../src/config/wix-translation.config.ts) — cùng danh sách `products`/`brand` đã dùng cho Wix Multilingual Translator |
| Đọc item CMS, liệt kê có phân trang | `getWixCmsItems`, `getWixCmsItemById` trong [wix-cms.service.ts](../src/services/wix-translation/wix-cms.service.ts) |
| Ghi field lên CMS (partial update) | `updateWixCmsItemFields()` — **hàm mới**, thêm vào cùng file trên, dùng chung wire format PATCH `SET_FIELD` đã có sẵn ở `updateProductImages()` trong `wixCms.ts` |
| Provider dịch AI (Ollama/GPT/Gemini) | `getTranslationProvider()`, `stripCodeFence()` trong [translationProvider.ts](../src/lib/services/translationProvider.ts) — y hệt hạ tầng đa-provider đã build cho Wix Multilingual Translator |
| Sanitize HTML cho field `richText` | `sanitizeHtmlForPreview()` trong [translation-mapper.service.ts](../src/services/wix-translation/translation-mapper.service.ts) |
| Giới hạn concurrency khi xử lý hàng loạt | `mapWithConcurrency()` trong [concurrencyLimit.ts](../src/lib/utils/concurrencyLimit.ts) |
| Xác thực admin | `checkAdminSession()` — cùng pattern mọi route `/api/admin/*` khác |

**Thay đổi hạ tầng dùng chung** để hỗ trợ ghi PATCH: `wixDataFetch()` trong [server-client.ts](../src/lib/wix/server-client.ts) trước đây chỉ POST — đã thêm tham số `method` (`"POST" | "PATCH"`, mặc định `"POST"` để không phá lời gọi cũ) để tái sử dụng cho endpoint update-item.

## 4. Field mapping — cấu hình được, không hard-code

```ts
interface FieldMapping {
  sourceField: string;   // field tiếng Anh, vd "title_EN"
  targetField: string;   // field tiếng Việt, vd "title_VI"
  type: "text" | "richText";
}
```

Nhập trực tiếp trên UI (nút "Thêm field"), không giới hạn 1 field cứng. `richText` được sanitize HTML trước khi ghi; `text` giữ nguyên chuỗi.

**Validation phía server** (route, không tin client):
- `sourceField`/`targetField` phải khớp `^[a-zA-Z_][a-zA-Z0-9_]*$` (định danh thường, không ký tự lạ).
- Không được là field hệ thống Wix: `_id`, `_owner`, `_createdDate`, `_updatedDate`, `_updatedDateVersion`.
- `sourceField !== targetField`.
- Tối đa 20 mapping, tối đa 50 item mỗi lần gọi.

## 5. Quy tắc dịch từng item (không gửi cả item, không ghi đè field không liên quan)

Với mỗi field mapping của một item:
1. Field nguồn (`*_EN`) rỗng hoặc không phải chuỗi → **bỏ qua field này** (không gửi AI).
2. Field đích (`*_VI`) đã có nội dung **và** `overwrite = false` → **bỏ qua field này**.
3. Ngược lại → gom vào danh sách field cần dịch.

Tất cả field cần dịch của **một item** được gộp vào **một lệnh gọi AI duy nhất** (không phải 1 field = 1 lệnh gọi, trừ Ollama tự lặp theo field bên trong provider của nó — xem [wix-translation-guide.md §11](wix-translation-guide.md#11-provider-dịch-ai--ollama-gpt-và-gemini)) — giữ đúng yêu cầu "không gửi toàn bộ item, chỉ gửi field cần dịch".

Nếu **không có field nào** cần dịch (tất cả nguồn rỗng, hoặc tất cả đích đã có dữ liệu) → cả item được đánh dấu `skipped` với lý do cụ thể, không gọi AI, không ghi Wix.

`updateWixCmsItemFields()` dùng PATCH `SET_FIELD` — chỉ field được liệt kê trong `fieldModifications` bị đổi, mọi field khác trên item (kể cả `*_EN`, `_id`, `_createdDate`...) giữ nguyên tuyệt đối.

## 6. Xác thực bản dịch trước khi ghi

Trước khi coi một field là dịch thành công:
```ts
const cleaned = stripCodeFence(rawTranslated).trim();
if (!cleaned) throw new Error(`Translation provider returned an empty response for field "${targetKey}".`);
```
`stripCodeFence()` loại bỏ markdown code fence (` ```html ... ``` `) nếu AI lỡ trả kèm — tái sử dụng hàm đã có, không viết lại. Nếu **bất kỳ field nào** trong item trả về rỗng sau khi làm sạch, **toàn bộ item** đó được đánh dấu `failed` với thông báo lỗi cụ thể — không ghi phần dở dang lên Wix.

## 7. Retry cho lỗi tạm thời (không retry vô hạn, không retry lỗi validation)

`translateWithRetry()` chỉ retry tối đa 2 lần (backoff nhân đôi: 800ms → 1600ms) khi lỗi có `code` là `TIMEOUT`, `RATE_LIMITED`, hoặc `UPSTREAM_ERROR`. Lỗi `NOT_CONFIGURED`/`INVALID_RESPONSE` không retry — vì retry không giải quyết được (thiếu cấu hình / phản hồi sai định dạng sẽ lặp lại y hệt).

## 8. Hai bước tách biệt — dịch để duyệt, rồi mới ghi (con người luôn ở giữa)

**Không có đường tắt "dịch xong tự ghi luôn".** `mode` bắt buộc là `"preview"` hoặc `"write"`, và đây là hai lệnh gọi API hoàn toàn tách biệt:

- **`mode: "preview"`** — gọi AI dịch các field đã chọn, trả về từng field kèm `{source, translated}` để hiển thị **đối chiếu, có thể sửa tay**. Không bao giờ gọi `updateWixCmsItemFields()`.
- **`mode: "write"`** — nhận lại đúng `items: [{itemId, fieldValues}]` mà người quản trị đã xem/sửa ở bước preview, ghi thẳng các giá trị đó vào Wix CMS. **Không gọi AI lần nào nữa** — giá trị được ghi là đúng những gì hiển thị trên màn hình, kể cả khi bị sửa tay, không phải một bản dịch mới sinh ra âm thầm.

Tách bạch này đảm bảo: không có nội dung AI nào tới được CMS thật mà chưa qua mắt người kiểm tra.

**Bảo vệ khỏi ghi đè race-condition**: `mode: "write"` đọc lại field đích **ngay tại thời điểm ghi** (không dùng lại trạng thái đã thấy lúc preview) — nếu ai đó đã điền field đó từ lúc preview đến lúc admin bấm duyệt, field bị bỏ qua trừ khi `overwrite: true`, giống hệt logic bảo vệ đã áp dụng ở bước preview.

**Field admin xoá trắng lúc sửa** = "không ghi field này" — nếu ô bản dịch bị admin sửa thành rỗng trước khi duyệt, field đó bị bỏ qua ở bước ghi (không ghi chuỗi rỗng đè lên).

**Chặn key lạ**: `mode: "write"` chỉ chấp nhận `fieldValues` với key nằm trong `targetField` đã khai báo ở `fieldMappings` của chính request đó — key khác (kể cả field hệ thống) bị lờ đi, không tin tưởng mù quáng dữ liệu client gửi lên dù đã qua bước preview.

## 9. API route

`POST /api/admin/cms-translate` ([route.ts](../src/app/api/admin/cms-translate/route.ts)) — gọi 2 lần cho 2 bước:

**Bước 1 — xem trước:**
```json
{
  "collectionKey": "products",
  "mode": "preview",
  "itemIds": ["item-id-1", "item-id-2"],
  "fieldMappings": [{ "sourceField": "title_EN", "targetField": "title_VI", "type": "text" }],
  "overwrite": false,
  "batchSize": 5
}
```
Trả về `{ success, mode: "preview", summary, items: [{ itemId, name, status: "translated"|"skipped"|"failed", fieldValues: {targetField: {source, translated}}, reason?, error? }] }`.

**Bước 2 — ghi (dùng đúng `fieldValues` người quản trị đã duyệt/sửa ở bước 1):**
```json
{
  "collectionKey": "products",
  "mode": "write",
  "items": [{ "itemId": "item-id-1", "fieldValues": { "title_VI": "Bản dịch đã duyệt" } }],
  "fieldMappings": [{ "sourceField": "title_EN", "targetField": "title_VI", "type": "text" }],
  "overwrite": false
}
```
Trả về `{ success, mode: "write", summary, items: [{ itemId, name, status: "updated"|"skipped"|"failed", translatedFields?, reason?, error? }] }`.

**Lệch so với đề bài gốc, có chủ đích**: đề bài đề xuất endpoint `/api/cms/translate` và tham số `collectionId` thô. Đã đổi thành `/api/admin/cms-translate` (khớp prefix `/api/admin/*` mà toàn bộ route admin khác trong dự án dùng, để `checkAdminSession()` áp dụng nhất quán) và `collectionKey` thay vì `collectionId` thô (khớp nguyên tắc bảo mật đã áp dụng xuyên suốt dự án: client không bao giờ được tự chọn ID collection trực tiếp).

**Không tạo biến môi trường mới**: đề bài gợi ý `TRANSLATION_PROVIDER`, `TRANSLATION_API_URL`, `TRANSLATION_MODEL` — dự án đã có sẵn `GEMINI_API_KEY`/`GPT_API_KEY`/`OLLAMA_BASE_URL`/`OLLAMA_MODEL`/`OLLAMA_TIMEOUT_MS`/`TRANSLATION_PROVIDER` (xem [wix-translation-guide.md §11](wix-translation-guide.md#11-provider-dịch-ai--ollama-gpt-và-gemini)) nên tái sử dụng nguyên vẹn, không thêm biến trùng lặp.

## 9b. Field nguồn/đích được chọn từ danh sách field thật của Wix, không gõ tay

Bản đầu tiên của trang này để admin **gõ tay** tên field nguồn/đích (`Input` text) — dễ gõ sai tên field không tồn tại trên collection, dẫn đến lỗi hoặc field bị bỏ qua âm thầm. Đã sửa: field nguồn/đích giờ là **dropdown** liệt kê đúng field thật đang có trên collection đang chọn.

Thêm route mới `GET /api/admin/cms-translate/fields?collectionKey=...` ([route.ts](../src/app/api/admin/cms-translate/fields/route.ts)) — trả về danh sách field (`key`, `displayName`, `type`) của collection, lấy qua hàm mới `getWixCollectionFields()` trong [wix-cms.service.ts](../src/services/wix-translation/wix-cms.service.ts). Hàm này gọi endpoint **Wix Data Collections** (`GET wix-data/v2/collections` — liệt kê toàn site rồi lọc đúng collection cần) — cùng lệnh gọi đã được chứng minh hoạt động đúng ở route có sẵn `/api/image-sync/collections`, chỉ khác là bọc lại có `checkAdminSession()` + allowlist `collectionKey` (route kia hiện không có bước xác thực admin, và trả về TẤT CẢ collection thay vì chỉ collection được yêu cầu — không tái dùng thẳng route đó vì hai lý do này).

Field hệ thống Wix (`_id`, `_owner`, `_createdDate`, `_updatedDate`, `_updatedDateVersion`) bị lọc khỏi danh sách trả về — không bao giờ xuất hiện trong dropdown, khớp với denylist validate ở `POST /api/admin/cms-translate`.

`wixDataFetch()` ở [server-client.ts](../src/lib/wix/server-client.ts) trước đó chỉ hỗ trợ POST/PATCH có body — đã thêm `"GET"` (không gửi body) để gọi được endpoint liệt kê collection này qua cùng client dùng chung, thay vì viết một lệnh `fetch()` riêng như route `/api/image-sync/collections` đang làm.

Trên UI: đổi collection sẽ tự tải lại danh sách field và reset các cặp mapping đang chọn (vì field của collection cũ không còn hợp lệ cho collection mới). Nếu tải field lỗi, hiện thông báo lỗi kèm nút "Thử lại" thay vì để dropdown trống im lặng.

## 9c. Danh sách sản phẩm bị thiếu — chỉ tải 50 item đầu, không có phân trang

Bản đầu tiên của bảng "Sản phẩm trong CMS" gọi `/api/admin/wix-translations/items` với `page=1&limit=50` **cố định** và không có nút chuyển trang — collection nào có hơn 50 sản phẩm thì các item còn lại hoàn toàn không hiện ra để chọn, dù vẫn tồn tại trong Wix CMS.

**Đã sửa**: thêm state `page`/`total`, đổi `limit` về `20` (khớp `PAGE_SIZE` của trang Wix Multilingual Translator), và thêm nút chuyển trang Trước/Sau + dòng "Trang X/Y · N sản phẩm" — cùng pattern với `wix-translation-page.tsx` đã có sẵn. Đổi collection hoặc gõ tìm kiếm sẽ tự quay về trang 1 (trang cũ không còn ý nghĩa với tập kết quả mới). Card header giờ hiện luôn tổng số sản phẩm thật của collection (`Tổng N sản phẩm trong collection`), không chỉ số item đang hiện trên trang.

Nhân tiện thêm luôn giới hạn chọn tối đa **50 item/lần dịch** (khớp đúng `MAX_ITEMS` mà `POST /api/admin/cms-translate` đã giới hạn phía server) kèm cảnh báo khi chọn vượt quá — trước đó chưa có giới hạn nào phía client nên chọn "tất cả" trên nhiều trang có thể vô tình vượt giới hạn server mà không rõ lý do bị từ chối.

## 9d. Route riêng cho danh sách item, và nút ẩn sản phẩm đã dịch đủ

Bảng item lúc đầu mượn tạm `/api/admin/wix-translations/items` (route của tính năng Wix Multilingual Translator) — chỉ để lấy tên/ID, không dùng phần trạng thái dịch của nó (vì route đó tính theo Wix Translation Schema, không áp dụng cho mô hình field-pair `*_EN`/`*_VI` của tính năng này). Nay đã tách hẳn thành route riêng: `GET /api/admin/cms-translate/items` ([route.ts](../src/app/api/admin/cms-translate/items/route.ts)).

Route mới nhận thêm `targetFields` (danh sách target field của các cặp mapping đang khai báo, phân tách bởi dấu phẩy) và trả về `translated: boolean` cho từng item — `true` khi **mọi** field trong `targetFields` đều có nội dung không rỗng. Không tốn thêm lượt gọi Wix nào: `getWixCmsItems()` vốn đã trả về toàn bộ `data` thô của mỗi item trong 1 lần query, nên tính `translated` chỉ là so sánh trong bộ nhớ.

Trên UI: checkbox **"Ẩn sản phẩm đã dịch đủ"** cạnh ô tìm kiếm — bật lên sẽ lọc khỏi bảng (và khỏi vùng chọn "tất cả") những item đã có đủ nội dung ở mọi field đích đang khai báo, kèm số lượng bị ẩn trong ngoặc. Vô hiệu hoá khi chưa khai báo cặp field nào (chưa có gì để biết "đã dịch đủ" nghĩa là gì). Item nào đã dịch đủ nhưng vẫn đang hiện (checkbox tắt) được đánh dấu badge "Đã dịch đủ" cạnh tên, để dễ nhận ra mà không cần bật ẩn. Việc lọc diễn ra **trên trang hiện tại** (không đổi lại phép tính phân trang ở §9c) — đơn giản và đủ dùng cho mục đích dọn bớt danh sách; nếu cần "trang nào cũng chỉ toàn item chưa dịch" thì phải lọc từ phía Wix Data query, phức tạp hơn nhiều vì `overwrite`/nhiều field cùng lúc không biểu diễn gọn bằng filter DSL của Wix.

## 9e. Hiện luôn field nào chưa dịch, không chỉ có/không

`untranslatedFields` (đã có sẵn trong response từ §9d, ban đầu chỉ dùng để tính `translated`) giờ được hiển thị trực tiếp trên UI — cùng layout badge đã dùng cho "Đã dịch đủ": item nào chưa dịch xong hiện tối đa 3 badge đỏ tên field còn thiếu (map từ field key sang `displayName` thật qua danh sách field đã tải ở §9b), phần dư gộp thành `+N`, hover xem đầy đủ qua `title`. Item dịch đủ vẫn hiện đúng 1 badge xanh "Đã dịch đủ" như trước — hai kiểu badge dùng chung một vị trí (dưới tên sản phẩm), không thêm cột mới. Cùng nguyên tắc thị giác đã áp dụng cho cột "Field chưa dịch" ở [wix-translation-guide.md §8](wix-translation-guide.md#8-cột-field-chưa-dịch-trong-bảng-sản-phẩm) của tính năng Wix Multilingual Translator.

## 10. Giao diện — 3 bước hiện trên cùng trang

Trang **"Dịch CMS Anh → Việt"** tại `/admin/tools/cms-translate` (menu Tools trong sidebar), theo đúng luồng 2 bước ở §8:
- Chọn Collection (tái dùng danh sách từ `/api/admin/wix-translations/config`).
- Khai báo cặp field EN→VI bằng **dropdown** chọn từ field thật của collection (xem §9b) — thêm/xoá được, chọn kiểu `text`/`richText`.
- Bảng chọn nhiều item, có phân trang (route riêng `/api/admin/cms-translate/items` — xem §9c, §9d), tối đa 50 item được chọn mỗi lần, có thể ẩn bớt item đã dịch đủ.
- Checkbox "Ghi đè nội dung tiếng Việt hiện có".
- **Bước 1 · Dịch để xem trước** — gọi `mode: "preview"`.
- **Bước 2 · Kiểm tra bản dịch trước khi ghi** — chỉ hiện sau khi có kết quả bước 1. Mỗi item hiện field gốc (EN, chỉ đọc) cạnh ô bản dịch (VI, `<textarea>` sửa được trực tiếp). Nút "Ghi N mục vào CMS" chỉ tính các item có trạng thái "Đã dịch — chờ duyệt" (bỏ qua item lỗi/skip ở bước 1), có dialog xác nhận trước khi ghi thật (nhắc rõ: ghi đúng nội dung đang hiển thị, không dịch lại).
- **Bước 3 · Kết quả ghi vào Wix CMS** — chỉ hiện sau khi bấm ghi ở bước 2, dùng `mode: "write"` với đúng `fieldValues` đã duyệt/sửa.
- Nút của từng bước bị disable trong lúc bước đó đang chạy.

## 11. Test đã viết, và những gì chưa kiểm thử được

24 test cho service ([translate-cms.service.test.ts](../src/services/cms-translation/translate-cms.service.test.ts)) + 8 test cho route ([route.test.ts](../src/app/api/admin/cms-translate/route.test.ts)) + 2 test cho `getWixCollectionFields` + 4 test cho route field-picker + 6 test cho route item-picker ([items/route.test.ts](../src/app/api/admin/cms-translate/items/route.test.ts), gồm cả tính `translated` đúng khi đủ/thiếu/không có field đích), bao gồm: dịch 1/nhiều item (preview), field nguồn rỗng/không tồn tại, field đích đã có dữ liệu (overwrite true/false), preview không ghi Wix, provider trả rỗng, retry rate-limit thành công ở lần 2, lỗi không retry (NOT_CONFIGURED), code fence bị loại bỏ, phân trang khi không truyền `itemIds`, 1 item lỗi không chặn batch (cả preview lẫn write) — và riêng cho `mode: "write"`: ghi đúng giá trị đã duyệt (không gọi AI), ghi đúng nội dung đã sửa tay (không phải bản dịch gốc), bỏ qua key lạ không nằm trong `fieldMappings`, bỏ qua field bị admin xoá trắng, re-check race-condition tại thời điểm ghi (overwrite true/false), Wix API ghi lỗi không chặn batch, request thiếu quyền admin bị chặn ở cả 2 route, field mapping nhắm vào field hệ thống bị từ chối.

**Chưa kiểm thử được** (cần Wix credential thật hoặc dữ liệu thật):
- Chất lượng dịch thực tế (giữ brand/model/URL/số điện thoại nguyên vẹn) — phụ thuộc vào model AI thật đang chạy, không thể unit test một cách xác định (deterministic).
- Cấu trúc HTML phức tạp (bảng, danh sách lồng nhau) qua một model thật — chỉ test được logic sanitize/strip code fence, không test được khả năng "hiểu" HTML của AI.
- Toàn bộ luồng thật qua Wix API (đọc/ghi item thật) — tất cả test đều mock `wix-cms.service`; đã xác minh cơ chế PATCH đúng định dạng dựa trên `updateProductImages()` hiện có trong `wixCms.ts`, nhưng chưa gọi thật vì cần một collection có sẵn field `*_EN`/`*_VI` để không ảnh hưởng dữ liệu thật.
