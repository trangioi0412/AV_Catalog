# Wix Multilingual Translator — Cách hoạt động

Tài liệu này giải thích cách chức năng **Dịch đa ngôn ngữ Wix CMS** (`/admin/wix-translations`) hoạt động: dữ liệu đi từ đâu, qua những bước nào, và lưu vào đâu.

## 1. Tổng quan luồng dữ liệu

```
Wix CMS (Import1 / brand ...)          Wix Multilingual (Translation Manager)
        │  đọc field gốc                        │  schema field có thể dịch
        ▼                                        ▼
┌───────────────────────────────────────────────────────────┐
│              /admin/wix-translations (UI)                  │
│  1. Chọn Collection, ngôn ngữ nguồn/đích, field cần dịch    │
│  2. Chọn tối đa 20 sản phẩm/item                            │
│  3. Xem trước bản dịch (AI) → chỉnh sửa → Lưu nháp/Xuất bản │
└───────────────────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
  Gemini (dịch nội dung)   Wix Translation Content API
                            (lưu bản dịch theo entityId + locale)
```

Toàn bộ logic nghiệp vụ nằm ở **một điểm vào duy nhất**:
[translate-and-sync.ts](../src/services/wix-translation/translate-and-sync.ts) — hàm `translateAndSyncWixCmsItems()`. Mọi API route chỉ validate input rồi gọi hàm này.

## 2. Vì sao trước đây chỉ chọn được 1 CMS ("Sản phẩm")

Danh sách collection được phép đọc/dịch là một **allowlist phía server**, không phải do client tự chọn ID collection:

[wix-translation.config.ts](../src/config/wix-translation.config.ts)
```ts
export const ALLOWED_COLLECTIONS: Record<string, AllowedCollectionDef> = {
  products: { collectionId: process.env.WIX_PRODUCT_COLLECTION_ID || "Import1", label: "Sản phẩm" },
  brand:    { collectionId: process.env.WIX_BRAND_COLLECTION_ID || "brand",     label: "Thương hiệu" },
};
```

Trước đây object này chỉ có `products` nên dropdown "Collection" trong UI luôn bị `disabled` (chỉ có 1 lựa chọn). Đã thêm collection **`brand`** (collection "Thương hiệu" — collection thứ hai duy nhất được dùng thật trong code, xem [wixCms.ts](../src/lib/services/wixCms.ts)). Dropdown giờ tự động bật vì có ≥ 2 lựa chọn.

**Muốn thêm CMS/collection khác:** thêm một entry mới vào `ALLOWED_COLLECTIONS` với `collectionId` đúng `dataCollectionId` trong Wix, rồi đảm bảo collection đó **đã được đăng ký trong Wix Translation Manager** (bước 3 bên dưới) — nếu chưa, UI sẽ hiện cảnh báo "Không tìm thấy translation schema".

### Field dịch được refetch theo từng collection

Trước đây field cần dịch chỉ luôn lấy theo collection mặc định (`products`), dù người dùng đổi sang collection khác. Đã sửa: `GET /api/admin/wix-translations/config?collectionKey=...` giờ nhận thêm collection đang chọn và trả về đúng field/schema của collection đó; UI tự gọi lại API này mỗi khi đổi Collection ([wix-translation-page.tsx](../src/components/wix-translations/wix-translation-page.tsx)).

## 3. Field nào được coi là "có thể dịch"?

Không lấy tất cả field của Wix Data item. Field hợp lệ = giao của:
1. Field tồn tại trong **Wix Translation Manager schema** của collection đó (kiểu `SHORT_TEXT` / `LONG_TEXT` / `HTML`), lấy qua `findCollectionSchema()` + `getTranslatableFields()` trong [wixMultilingual.ts](../src/lib/services/wixMultilingual.ts).
2. Không nằm trong `NEVER_TRANSLATE_FIELD_KEYS` (denylist cứng phía server).
3. Được người dùng tick chọn trên UI.

→ Nếu một collection chưa được set up trong Wix Translation Manager (chưa đánh dấu field nào là "translatable"), tool sẽ báo "Không tìm thấy translation schema" và không dịch được, kể cả khi collection đã nằm trong allowlist ở bước 2.

## 4. Ngôn ngữ nguồn/đích

Danh sách ngôn ngữ **luôn lấy trực tiếp từ Wix Multilingual** (`listLocales()`), không hard-code `vi`/`en`. Ngôn ngữ đích phải:
- Tồn tại trong danh sách locale của site, và
- Đang ở trạng thái `VISIBLE` (đã bật công khai).

Nếu không thỏa, request bị chặn với lỗi `LOCALE_NOT_AVAILABLE` trước khi gọi AI hay ghi dữ liệu.

## 5. Ba chế độ xử lý (`mode`)

| Mode | Gọi AI? | Ghi vào Wix? | Dùng khi nào |
|---|---|---|---|
| `preview` | Có | Không | Bấm "Dịch các mục đã chọn" — xem trước, cho phép sửa tay trước khi lưu |
| `draft` | Không (dùng field đã sửa) | Có, `published: false` | Bấm "Lưu bản nháp" |
| `publish` | Không (dùng field đã sửa) | Có, `published: true` | Bấm "Xuất bản lên Wix" |

Với mỗi item, field nào **đã có bản dịch sẵn** sẽ được giữ nguyên (không dịch lại) trừ khi bật **"Dịch lại và ghi đè field đã chọn"**.

## 6. Chống mất dữ liệu / ghi đè nhầm

- **Source hash**: lúc preview, hệ thống hash nội dung gốc (sha256). Lúc lưu, nếu nội dung gốc trong Wix CMS đã đổi so với lúc preview (ai đó sửa CMS song song), item bị bỏ qua với thông báo "Dữ liệu nguồn đã thay đổi kể từ khi xem trước" thay vì ghi đè mù.
- **Xác nhận ghi đè**: nếu item đã có bản dịch và không bật overwrite, hệ thống hỏi lại trước khi ghi đè (dialog "Ghi đè bản dịch đã tồn tại?").
- **Verify sau khi ghi**: sau khi tạo/cập nhật, hệ thống query lại Wix Translation Content API vài lần (do có độ trễ eventual-consistency) để xác nhận dữ liệu đã lưu đúng trước khi báo "thành công".

## 7. Hiển thị field HTML trong popup xem trước/xem bản dịch

Một số field translatable là kiểu **`HTML`** (rich text) — ví dụ *Product Overview*, *FAQ*, *Technical Specifications*. Trước đây cả popup "Xem trước & chỉnh sửa bản dịch" lẫn popup "Xem bản dịch đã lưu" đều render các field này bằng `whitespace-pre-wrap` như text thường, tức là **dump nguyên các thẻ HTML ra màn hình** (`<p>`, `<ul>`, `<strong>`...) thay vì hiển thị nội dung đã được định dạng — nhìn như một khối chữ dính liền, khó đọc, và bị "bóp" khi nhét vào cột rộng một nửa (`grid-cols-2`) của dialog.

Đã sửa 2 việc:

1. **Render đúng HTML cho field kiểu `HTML`**: field nào có `type === "HTML"` giờ được render bằng nội dung HTML thật (`dangerouslySetInnerHTML`) thay vì text thô, nên đoạn văn, danh sách, in đậm... hiển thị đúng cấu trúc. Nội dung này luôn được làm sạch trước bằng `sanitizeHtmlForPreview()` ([translation-mapper.service.ts](../src/services/wix-translation/translation-mapper.service.ts)) — hàm này đã có sẵn trong code nhưng trước đó **chưa từng được gọi ở đâu cả**; nó cắt `<script>`/`<style>`, thuộc tính `on*` inline, và link `javascript:` trước khi hiển thị hoặc ghi vào Wix.
2. **Không còn ép field rich-text vào cột nửa chiều rộng**: field kiểu `HTML` (có đoạn văn/danh sách cần chỗ) giờ chiếm full width, xếp chồng (gốc ở trên, bản dịch ở dưới) thay vì side-by-side. Field text thường (`SHORT_TEXT`, `LONG_TEXT`) vẫn giữ layout 2 cột — cột hẹp hơn giúp dòng chữ tự xuống dòng sớm, dễ đọc hơn là kéo dài hết chiều ngang dialog. Khung nội dung có `max-height` + cuộn riêng để không bị vỡ layout dialog khi nội dung rất dài.

Field type được truyền xuyên suốt: `config.fields[].type` (từ Wix Translation Manager schema) → `selectedFieldDefs` trong [wix-translation-page.tsx](../src/components/wix-translations/wix-translation-page.tsx) → `ReviewFieldDef.type` trong [translation-review-panel.tsx](../src/components/wix-translations/translation-review-panel.tsx); và tương tự phía server, `GET /api/admin/wix-translations/content` trả kèm `type` + giá trị đã sanitize cho [translated-content-viewer.tsx](../src/components/wix-translations/translated-content-viewer.tsx).

Việc sanitize HTML giờ cũng chạy trước khi **ghi vào Wix** (không chỉ khi hiển thị) — trong `runPreview()`/`runWrite()` của [translate-and-sync.ts](../src/services/wix-translation/translate-and-sync.ts) — nên bản dịch được lưu cũng sạch, không chỉ bản xem trước.

**Đợt chỉnh thêm cho dễ nhìn hơn** (sau phản hồi vẫn thấy khó nhìn): mỗi field giờ nằm trong một khung bo góc riêng (`rounded-xl border`) để tách biệt rõ ràng giữa các field thay vì chỉ cách nhau bằng khoảng trắng; cỡ chữ nội dung tăng từ `text-xs` (12px) lên `text-sm` (14px) kèm `leading-relaxed`; nền khối "gốc" đậm hơn và bỏ giảm opacity chữ (`text-foreground/80` → `text-foreground`) để tăng tương phản, đỡ bị mờ; khối "bản dịch" có viền màu primary để phân biệt rõ đây là ô có thể sửa.

### Nguyên nhân thật sự: toàn bộ dialog trong app bị giới hạn còn ~384px

Sau khi vẫn thấy layout bị bóp dù đã sửa các mục trên, hoá ra vấn đề nằm ở một chỗ hoàn toàn khác — không phải trong `translation-review-panel.tsx`, mà ở component dùng chung [dialog.tsx](../src/components/ui/dialog.tsx). `DialogContent` có class mặc định là:

```
max-w-[calc(100%-2rem)] ... sm:max-w-sm
```

Mọi dialog trong dự án (kể cả popup dịch, popup xem media, popup xoá...) đều cố ghi đè bằng một class **không có tiền tố breakpoint**, ví dụ `max-w-6xl`. Vấn đề là `tailwind-merge` (hàm `cn()`) coi `sm:max-w-sm` và `max-w-6xl` là **hai nhóm khác nhau** (vì khác biến thể breakpoint) nên **giữ lại cả hai** thay vì loại bỏ class mặc định. Ở bất kỳ màn hình nào ≥ 640px (tức hầu như mọi máy tính), rule `sm:max-w-sm` nằm trong CSS media query nên được sinh ra **sau** trong stylesheet của Tailwind → thắng thế trong cascade, khiến dialog luôn bị ép về tối đa 384px bất kể `max-w-6xl` được truyền vào — toàn bộ nội dung bên trong (kể cả dòng chữ "0/1 sản phẩm đã dịch xong" ở footer) bị bóp nghẹt xuống còn vài chục pixel bề ngang, vỡ chữ từng từ một dòng.

Đã kiểm chứng lại bằng cách chạy trực tiếp `twMerge()`:
```
BEFORE: "sm:max-w-sm max-w-6xl w-full"   ← cả 2 class cùng tồn tại, sm:max-w-sm thắng ở màn hình lớn
AFTER:  "max-w-6xl w-full"               ← chỉ còn class mong muốn
```

**Cách sửa**: gộp 2 rule mặc định (`max-w-[calc(100%-2rem)]` cho màn hình rất nhỏ + `sm:max-w-sm` cho màn hình bình thường) thành **một** class không breakpoint duy nhất: `max-w-[min(24rem,calc(100%-2rem))]`. Class này tự chọn giá trị nhỏ hơn giữa 24rem (384px) và (100% - 2rem), nên vẫn giữ đúng hành vi mặc định cho dialog nhỏ (ví dụ dialog xác nhận), nhưng giờ cùng nhóm `max-w-*` với override của các dialog khác — `max-w-6xl`/`max-w-4xl`/... của mọi dialog trong app (popup dịch, popup xem media, popup xoá sản phẩm...) giờ mới thật sự có tác dụng.

Đây là bug ảnh hưởng **toàn bộ dialog trong ứng dụng**, không riêng gì tính năng dịch — chỉ là tính năng dịch có nội dung dài nên lộ rõ nhất.

### "VI · gốc" hiện trống khi dịch AI thất bại (ví dụ rate limit)

Sau khi sửa layout dialog, phát hiện thêm một lỗi thật (không phải layout): khi provider AI trả lỗi giữa chừng (`Translation provider rate limit reached.`, timeout, v.v.), khối "VI · gốc (chỉ đọc)" hiện **trống** dù nội dung gốc trong Wix CMS hoàn toàn không trống.

Nguyên nhân: trong `runPreview()` ở [translate-and-sync.ts](../src/services/wix-translation/translate-and-sync.ts), việc đọc item gốc từ Wix CMS và việc gọi AI dịch nằm chung trong **một khối `try/catch`**. Khi bước đọc CMS thành công nhưng bước gọi AI ném lỗi (rate limit...), khối `catch` phía dưới trả về kết quả lỗi **không kèm `sourceFields`** — dù nội dung gốc đã lấy được thành công ngay trước đó — nên UI không có gì để hiển thị và rơi về "(Trống)".

**Đã sửa**: nội dung gốc (`sourceFields`, `sourceHash`, `itemName`) giờ được lưu vào biến ở ngoài khối `try` ngay khi đọc CMS thành công, nên dù bước dịch AI sau đó thất bại, kết quả trả về (`status: "failed"`) vẫn kèm theo nội dung gốc đã lấy được — người dùng vẫn thấy được "VI · gốc" bình thường, chỉ có "bản dịch" là trống và có thể bấm "Dịch lại" khi hết rate limit. Có test riêng (`translate-and-sync.test.ts`) khoá lại hành vi này.

## 8. Cột "Field chưa dịch" trong bảng sản phẩm

Bảng danh sách trước đây hiện Model / Thương hiệu / Ngày cập nhật — những thông tin này không nói lên được item còn thiếu bản dịch ở đâu. Đã thay bằng cột **"Field chưa dịch"**: liệt kê tên các field translatable (theo schema Wix Translation Manager của collection, ví dụ *Product Overview*, *Series*, *Main Feature*, ...) mà item đó **chưa có `textValue`** ở ngôn ngữ đích đang chọn.

- Nếu item đã dịch đủ tất cả field: hiện chữ "Đầy đủ" (xanh).
- Nếu thiếu: hiện badge đỏ cho tối đa 3 field, phần còn lại gộp thành `+N` (hover để xem đầy đủ qua `title`).
- Tính theo **toàn bộ field translatable của collection** (không phụ thuộc field đang tick ở phần "Thiết lập"), để phản ánh đúng tình trạng dịch thực tế trong Wix.

Việc tính "field chưa dịch" nằm trong `translationInfoFor()` ở [items/route.ts](../src/app/api/admin/wix-translations/items/route.ts) — dùng `getTranslatableFields(schema)` để lấy field hợp lệ, rồi so với `queryContentForEntity()` để biết field nào chưa có `textValue`.

## 9. Xem thêm thông tin đã dịch (mới)

Trước đây bảng danh sách sản phẩm chỉ hiện một badge trạng thái (Chưa dịch / Nháp / Đã xuất bản) mà không xem được nội dung bên trong. Giờ:

- Với item **đã có bản dịch** (Nháp hoặc Đã xuất bản), badge trạng thái trở thành nút bấm được.
- Bấm vào mở modal "Xem bản dịch đã lưu" ([translated-content-viewer.tsx](../src/components/wix-translations/translated-content-viewer.tsx)), hiển thị **từng field**: giá trị gốc bên trái, bản dịch đã lưu bên phải kèm badge Nháp/Đã xuất bản riêng cho từng field.
- Modal này gọi API mới `GET /api/admin/wix-translations/content` ([route.ts](../src/app/api/admin/wix-translations/content/route.ts)) — **chỉ đọc**, không gọi AI, không tính vào quota Gemini, dùng để tra cứu nhanh mà không cần mở luồng "Dịch lại" đầy đủ.

## 10. Các API route liên quan

| Route | Việc gì |
|---|---|
| `GET /api/admin/wix-translations/config` | Danh sách collection, locale, field dịch được, trạng thái cấu hình. Nhận thêm `?collectionKey=` để lấy field theo đúng collection đang chọn. |
| `GET /api/admin/wix-translations/items` | Danh sách item của 1 collection (phân trang, tìm kiếm) + trạng thái dịch và danh sách field chưa dịch mỗi item. |
| `GET /api/admin/wix-translations/content` | **(Mới)** Nội dung gốc + bản dịch đã lưu của 1 item — chỉ đọc, để xem nhanh. |
| `POST /api/admin/wix-translations/preview` | Dịch thử bằng AI (Ollama, GPT, hoặc Gemini — tuỳ cấu hình), không ghi Wix. |
| `POST /api/admin/wix-translations/save` | Ghi bản dịch (đã người dùng duyệt/sửa) vào Wix Multilingual, mode `draft` hoặc `publish`. |

## 11. Provider dịch AI — Gemini, GPT, và Ollama

Ban đầu chỉ có Gemini. Sau đó thêm **GPT (OpenAI)**, và giờ thêm **Ollama** (self-hosted hoặc cloud) làm provider thứ ba — cả ba đều implement chung interface `TranslationProvider` trong [translationProvider.ts](../src/lib/services/translationProvider.ts), nên phần còn lại của tool (preview/save/review UI) không cần biết đang chạy AI nào.

**Cấu hình qua biến môi trường** (`.env.local`):
| Biến | Ý nghĩa |
|---|---|
| `OLLAMA_BASE_URL` | Bật provider Ollama, ví dụ `http://localhost:11434` cho instance chạy local, hoặc URL của Ollama cloud/proxy. |
| `OLLAMA_MODEL` | Tên model đã pull trong Ollama (mặc định `llama3.1` nếu để trống). |
| `OLLAMA_API_KEY` | (tuỳ chọn) chỉ cần nếu instance Ollama yêu cầu bearer token (Ollama local mặc định không cần). |
| `OLLAMA_TIMEOUT_MS` | (tuỳ chọn) timeout mỗi lần gọi, mặc định 120000ms (2 phút) — model chạy local thường chậm hơn API cloud nhiều. |
| `GEMINI_API_KEY` | Bật provider Gemini (`gemini-2.5-pro`). |
| `GPT_API_KEY` | Bật provider GPT (mặc định model `gpt-4o`, đổi bằng `GPT_MODEL`). |
| `TRANSLATION_PROVIDER` | (tuỳ chọn) ép buộc `ollama`, `gpt`, hoặc `gemini`, bỏ qua logic tự chọn bên dưới. |

**Thứ tự ưu tiên khi có nhiều biến cùng lúc**: `OLLAMA_BASE_URL` > `GPT_API_KEY` > `GEMINI_API_KEY` — xem `resolveProviderKind()` trong [translationProvider.ts](../src/lib/services/translationProvider.ts). Không cần chỉnh gì thêm trong code hay UI: chỉ cần điền `OLLAMA_BASE_URL` vào `.env.local` là tool tự chuyển sang dùng Ollama (badge "Translation provider" trong warnings/config API sẽ hiện `ollama`).

Đây là hàm dùng chung cho **cả hai** tính năng dịch trong dự án — cả "Wix Multilingual Translator" (`/admin/wix-translations`) lẫn tool dịch cũ hơn ở `/api/admin/translations/generate` — nên thêm provider mới ở đây tự động áp dụng cho cả hai, không cần sửa từng nơi.

### Ollama dùng prompt và cách gọi khác với Gemini/GPT

Gemini và GPT dịch **tất cả field được chọn trong 1 lần gọi**, yêu cầu model trả về JSON (`{"title": "...", "productOverview": "..."}`) rồi `parseTranslationResponse()` parse ra — hiệu quả hơn nhưng đòi hỏi model tuân thủ định dạng JSON nghiêm ngặt.

Ollama chạy đúng theo **prompt do người dùng chỉ định** (`buildOllamaPrompt()`), vốn được thiết kế để dịch **một khối nội dung** và "chỉ trả về bản dịch, không giải thích" — không có JSON. Vì vậy `OllamaTranslationProvider` gọi API riêng cho **từng field một** (tuần tự, không song song trong cùng 1 item, để không dồn nhiều generation cùng lúc vào 1 Ollama instance), ghép kết quả lại thành `Record<key, translatedText>` giống hệt output của Gemini/GPT để phần còn lại của hệ thống không cần biết sự khác biệt này.

Gọi thẳng REST API gốc của Ollama (`POST {OLLAMA_BASE_URL}/api/generate`, `stream: false`) — không thêm SDK nào, cùng phong cách với `OpenAiTranslationProvider`.

### Lỗi "Translation provider returned an empty response." với model có khả năng "thinking"

Gặp ngay khi thử với model `qwen3.5:4b` (và mọi model hybrid-reasoning tương tự, ví dụ dòng Qwen3). Đã xác minh trực tiếp bằng cách gọi thật API Ollama với đúng prompt dài như trong app: model trả về `"response": ""` (rỗng) kèm `"done_reason": "length"` và một trường `"thinking"` dài **~16.000 ký tự**. Nguyên nhân: model tự sinh một đoạn suy luận nội bộ (chain-of-thought) trước khi viết câu trả lời thật; với prompt dài + nhiều rule như prompt AV này, đoạn suy luận đó chiếm hết toàn bộ ngân sách token đầu ra, khiến quá trình sinh bị cắt giữa chừng **trước khi** model kịp viết bản dịch — `response` rỗng dù request hoàn toàn thành công (HTTP 200).

**Đã sửa**: thêm `think: false` vào body gửi lên `/api/generate` trong [translationProvider.ts](../src/lib/services/translationProvider.ts) — bảo model bỏ qua bước suy luận nội bộ và viết thẳng câu trả lời. Đã kiểm chứng lại bằng cách gọi thật API với cùng prompt: có `think:false` → `response` trả về bản dịch đầy đủ, `done_reason: "stop"` (hoàn tất bình thường); không có → rỗng như mô tả ở trên. Tham số này không ảnh hưởng đến các model thường (không hỗ trợ thinking) — Ollama bỏ qua nó một cách an toàn.

Nếu sau này vẫn gặp lỗi này với model khác không hỗ trợ `think`, thông báo lỗi giờ kèm gợi ý cụ thể khi `done_reason` là `"length"` (hết ngân sách token đầu ra) thay vì chỉ nói chung chung "empty response".

### Prompt Ollama giờ dịch được cả hai chiều (Việt→Anh và Anh→Việt)

Prompt gốc bạn đưa cố định "dịch từ tiếng Việt sang tiếng Anh". Đã tham số hoá `buildOllamaPrompt()` theo `sourceLocale`/`targetLocale` thực tế đang chọn trên UI — cùng nội dung, cùng bộ rule, chỉ đổi tên ngôn ngữ nguồn/đích trong câu (`"chuyên gia dịch thuật Việt–Anh"` ⇄ `"chuyên gia dịch thuật Anh–Việt"`, `"từ tiếng Việt sang tiếng Anh"` ⇄ `"từ tiếng Anh sang tiếng Việt"`). Không đoán: đã gọi thật API Ollama với chiều Anh→Việt để xác nhận bản dịch ra đúng và tự nhiên trước khi báo hoàn tất.

Để thông tin ngôn ngữ đến được Ollama, phải nối thêm một đoạn bị thiếu trong luồng dữ liệu: `sourceLocale`/`targetLocale` đã có sẵn trong `TranslationRequest` của [translation-provider.service.ts](../src/services/wix-translation/translation-provider.service.ts) (nhận từ `translate-and-sync.ts`, tức từ lựa chọn thật của người dùng trên UI) nhưng **trước đó chưa từng được truyền tiếp** xuống `provider.translate()` ở tầng thấp hơn — đã bổ sung. `TranslationRequest` trong [translationProvider.ts](../src/lib/services/translationProvider.ts) giờ có thêm 2 field tuỳ chọn này.

Lưu ý phạm vi: chỉ prompt của **Ollama** (`buildOllamaPrompt()`) đọc `sourceLocale`/`targetLocale`. Prompt chung của Gemini/GPT (`buildPrompt()`) vẫn cố định "Vietnamese to English" bất kể lựa chọn ngôn ngữ trên UI — đây là hạn chế có sẵn từ trước, chưa nằm trong yêu cầu lần này nên chưa động tới; nếu cần dịch ngược chiều bằng Gemini/GPT thì đây là chỗ cần sửa tiếp theo.
