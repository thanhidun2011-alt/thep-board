# CLAUDE.md

Website theo dõi **cổ phiếu ngành thép** Việt Nam ("Thép Board"), có dashboard riêng cho từng doanh nghiệp: giá, chỉ số tài chính, BCTC, so sánh cùng ngành, hồ sơ công ty.

## Phạm vi

Web chỉ theo dõi đúng 10 mã: **HPG, HSG, NKG, GDA, VGS, POM, TVN, TIS, TLH, SMC**.
- Danh sách khai báo ở `STEEL` trong [worker/src/services.js](worker/src/services.js) và `STEEL` trong [frontend/js/app.js](frontend/js/app.js). Khi đổi danh sách thì phải sửa cả hai chỗ.
- Cả 10 mã cùng mã ngành ICB 1757 (Sắt thép). Nhóm "cùng ngành" chính là 10 mã này, nên không cần tra ICB.
- Ô tìm kiếm chỉ lọc trong 10 mã này. API trả 404 cho mã nằm ngoài danh sách.

## Môi trường

- Windows 10, shell PowerShell 5.1: không dùng `&&` hay `||`, nối lệnh bằng `;`.
- Node 24 và npm có sẵn. Backend là **Cloudflare Worker (JavaScript)**, không còn backend Python.
- Python 3.12 trong `.venv` chỉ dùng cho script chụp ảnh: gọi bằng `.\.venv\Scripts\python`. Lệnh `python` và `pip` không có trong PATH.
- Git 2.56 đã cài; xem cách gọi git từ shell của Claude ở mục Deploy.
- Thư mục dự án có dấu cách (`E:\new pj\code`), nên luôn đặt đường dẫn trong ngoặc kép.

## Chạy trên máy

```powershell
npm install
npm run dev          # wrangler dev: Worker và giao diện cùng chạy ở http://127.0.0.1:8787/#/HPG
```

`wrangler dev` tự load lại khi sửa file. Chạy trên máy **không** áp giới hạn CPU và không đổi IP như khi chạy thật trên Cloudflare, nên một số lỗi chỉ lộ ra sau khi deploy.

Chụp screenshot để kiểm tra giao diện (cần `npm run dev` đang chạy; dùng Playwright với Edge có sẵn trên máy):

```powershell
.\.venv\Scripts\python scripts\screenshot.py "#/HPG" screenshots\hpg.png
.\.venv\Scripts\python scripts\screenshot.py "#/NKG/peers" screenshots\m.png --mobile --theme light
```

Script này in ra các phần tử làm tràn ngang trang và các lỗi JS. Đừng dùng `msedge --headless --window-size=390,...` để chụp bản mobile: Edge áp chiều rộng cửa sổ tối thiểu nên ảnh bị cắt sai.

## Nguồn dữ liệu: Vietcap (VCI), gọi trực tiếp

- `vnstock` và `vnai` đã bị **PyPI quarantine** từ khoảng 09/2026. **Không cài `vnstock-installer`**, vì có báo cáo là gói mạo danh.
- Request tới Vietcap nằm trong [worker/src/vietcap.js](worker/src/vietcap.js). Request cần header `Referer`/`Origin` là `https://trading.vietcap.com.vn/` và User-Agent của trình duyệt.
- **Trình duyệt không gọi thẳng được** API bảng giá của Vietcap và API của Yahoo, vì hai nguồn này không cho phép trang web khác gọi tới (đã test CORS 10/2026). Vì vậy bắt buộc phải có Worker đứng giữa.
- Cache trong bộ nhớ qua `cached(name, ttl, fn)` trong [worker/src/cache.js](worker/src/cache.js): giá 20–60 giây, BCTC và hồ sơ 1 giờ, danh mục chỉ tiêu 1 ngày, hàng hóa 30 phút. Khi nguồn lỗi mà vẫn còn bản cache cũ thì trả bản cũ. Cache mất khi isolate của Worker bị thu hồi.

| Dữ liệu | Endpoint |
|---|---|
| Nến OHLCV (cổ phiếu và chỉ số) | `POST trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart` với body `{timeFrame: ONE_MINUTE\|ONE_DAY, symbols:[1 mã], to, countBack}` |
| Bảng giá | `POST .../api/price/symbols/getList` với body `{symbols:[...]}` |
| Chỉ số thị trường, độ rộng | `POST .../api/price/marketIndex/getList` |
| Hồ sơ công ty | `GET iq.vietcap.com.vn/api/iq-insight-service/v1/company/{ma}` |
| Chỉ số tài chính | `GET .../company/{ma}/statistics-financial` |
| BCTC | `GET .../company/{ma}/financial-statement?section=INCOME_STATEMENT\|BALANCE_SHEET\|CASH_FLOW` |
| Tên chỉ tiêu BCTC | `GET .../company/{ma}/financial-statement/metrics` |
| Cổ đông lớn | `GET .../company/{ma}/shareholder` |

Lưu ý về dữ liệu:
- Giá cổ phiếu trả về bằng **VND** (ví dụ 20100), hiển thị theo nghìn đồng (20,10). Điểm chỉ số giữ nguyên giá trị.
- Mã chỉ số trong API: `VNINDEX`, `VN30`, `HNXIndex`, `HNXUpcomIndex`. Gửi nhiều mã trong một request `gap-chart` sẽ nhận về `[]`, nên mỗi lần chỉ gửi 1 mã.
- `accumulatedValue` và `totalValue` tính bằng **triệu đồng**. Backend nhân 1e6 để đổi sang VND.
- `statistics-financial`: `quarter` từ 1 đến 4 là TTM theo quý, `quarter = 5` là số cả năm. Các tỉ lệ ở dạng thập phân (0,17 nghĩa là 17%), backend nhân 100.
- BCTC dùng field code: `isa3` doanh thu thuần, `isa5` lợi nhuận gộp, `isa20` LNST, `isa22` LNST công ty mẹ, `isa23`/`isa24` EPS (đơn vị VND).
- `pb = 0` khi vốn chủ sở hữu âm (POM). Backend đổi giá trị này thành `null`.
- EPS và P/E trên dashboard **tự tính**: P/E = giá hiện tại / (LNST công ty mẹ 4 quý gần nhất / số CP niêm yết). Không lấy P/E từ API.

## Kiến trúc

```
wrangler.toml        Cấu hình Worker; [assets] phục vụ thư mục frontend/
worker/src/
  index.js           Router /api/*, CORS, mã lỗi (404/422/502)
  services.js        Cổ phiếu: TTM, tăng trưởng, chuỗi dữ liệu cho biểu đồ
  vietcap.js         Gọi API Vietcap, fetchJson dùng chung, UpstreamError
  commodities.js     Danh sách hàng hóa, gọi Sina/Yahoo, tóm tắt + nến từng mặt hàng
  cache.js           Cache trong bộ nhớ, trả bản cũ khi nguồn lỗi
frontend/            HTML/CSS/JS thuần, không có bước build
  index.html         Lấy lightweight-charts@4.2.0 (unpkg) và chart.js@4.4.1 (jsdelivr) từ CDN
  css/style.css      Theme tối/sáng bằng CSS variables (`data-theme` trên thẻ <html>)
  js/config.js       API_BASE: để trống khi chạy cùng Worker, điền URL Worker nếu đặt giao diện trên GitHub Pages
  js/format.js       Định dạng số VN, priceClass, cafefUrl, sparkline
  js/charts.js       PriceChart (nến, volume, MA20/50) và các helper Chart.js
  js/commodities.js  Trang Hàng hóa
  js/app.js          State, router dạng hash, dashboard doanh nghiệp
scripts/screenshot.py
```

API:
- `/api/config`, `/api/indices`, `/api/watchlist`
- `/api/history/{ma}?range=1d|1m|3m|6m|1y|3y|5y` (mã cổ phiếu hoặc mã chỉ số)
- `/api/stock/{ma}`
- `/api/stock/{ma}/financials?section=income|balance|cashflow&period=year|quarter`
- `/api/stock/{ma}/series?period=quarter|year`
- `/api/fundamentals/{ma}`: chỉ số TTM của 1 mã. Frontend gọi cho cả 10 mã rồi tự tính trung vị ngành.
- `/api/commodities`: chỉ trả danh sách và thông tin mặt hàng, không gọi ra nguồn ngoài.
- `/api/commodities/{id}?range=1m|...|5y`: tóm tắt và nến của 1 mặt hàng.

**Giới hạn của gói miễn phí Cloudflare Workers:**
- 100.000 request/ngày. Request lấy file tĩnh không bị tính.
- **10ms CPU mỗi request.** Vì vậy API được tách theo từng mã và từng mặt hàng, không có endpoint gộp nhiều mã (ví dụ dữ liệu Sina của một mặt hàng có thể tới khoảng 500KB JSON). Đừng thêm endpoint gộp nhiều mã hay nhiều mặt hàng.
- Tối đa 50 request ra ngoài mỗi lần chạy. `/api/watchlist` đang dùng 11.

## Trang và menu chính

Menu trên cùng gồm 3 trang, điều hướng bằng hash (`showPage()` và `route()` trong `app.js`):

| Menu | Hash | Nội dung |
|---|---|---|
| Doanh nghiệp | `#/{MA}` hoặc `#/{MA}/{tab}` | Dashboard doanh nghiệp, có tab "So sánh cùng ngành" bên trong |
| Hàng hóa | `#/hang-hoa` hoặc `#/hang-hoa/nang-luong` | Giá hàng hóa: nhóm ngành thép, nhóm năng lượng & nông sản ([frontend/js/commodities.js](frontend/js/commodities.js)) |
| Vĩ mô & Tỷ giá | `#/vi-mo` | **Chưa làm**, hiện chỉ là placeholder. Dự kiến gồm USD/VND, CNY/VND, lãi suất |

Trên trang Hàng hóa và Vĩ mô, layout chuyển sang 2 cột (class `.layout.wide` ẩn cột phải).

## Hàng hóa ngành thép

- Danh sách mặt hàng khai báo ở `COMMODITIES` trong [worker/src/commodities.js](worker/src/commodities.js). Trang chia làm 2 nhóm, chọn bằng nút chuyển nhóm. Ánh xạ từ `group` sang nhóm nằm ở `CATEGORY`.
  - **Ngành thép** (`#/hang-hoa`): quặng sắt, than luyện cốc, than cốc, phế liệu, HRC, thép cây.
  - **Năng lượng & Nông sản** (`#/hang-hoa/nang-luong`):
    - Dầu: WTI `CL=F`, Brent `BZ=F`, dầu thô INE `SC0`.
    - Khí tự nhiên: Henry Hub `NG=F`.
    - Đường: đường thô ICE số 11 `SB=F`, đường trắng ZCE `SR0`.
    - Cao su: RSS3 SHFE `RU0`, TSR20 INE `NR0`.
- **Mỗi nhóm tối đa 8 mặt hàng**, vì biểu đồ so sánh chỉ có 8 màu phân loại. Cần thêm mặt hàng thì tách thành nhóm mới, không thêm màu thứ 9.
- Màu `--cat-N` gán theo thứ tự của mặt hàng trong nhóm (`cmSlot()`). Đừng đổi thứ tự khi không cần, vì màu của các mặt hàng sẽ đổi theo.
- Mã khác đã kiểm tra là có dữ liệu, chưa dùng: Yahoo `HO=F` (dầu sưởi), `RB=F` (xăng RBOB), `QA=F`; Sina `BR0` (cao su butadien). `SF=F` chỉ có 1 điểm dữ liệu.
- Lấy dữ liệu trong [worker/src/commodities.js](worker/src/commodities.js). Cả hai nguồn đều miễn phí, không cần key, nhưng là endpoint **không chính thức**:
  - **Sina Finance:** hợp đồng liên tục sàn DCE/SHFE, gồm `I0` quặng sắt, `JM0` than luyện cốc, `J0` than cốc, `HC0` HRC, `RB0` thép cây. Đơn vị CNY/tấn. Request cần header `Referer: https://finance.sina.com.cn/`.
  - **Yahoo Finance** (`query1.finance.yahoo.com/v8/finance/chart/{ticker}`): `TIO=F` quặng sắt 62% Fe (USD/tấn), `HRC=F` HRC Mỹ (USD/tấn ngắn), `BUS=F` phế liệu Busheling (USD/tấn dài).
- `BUS=F` **ngừng cập nhật từ 10/12/2025**. Worker gắn cờ `stale` cho mặt hàng nào có phiên cuối cũ hơn `STALE_DAYS` (10 ngày). Frontend hiện badge "Dữ liệu cũ" và mặc định tắt series đó trên biểu đồ so sánh.
- **Phôi thép:** chưa có nguồn miễn phí (Mysteel, SteelOrbis đều thu phí). Trang đang ghi chú điều này và gợi ý xem thép cây SHFE thay thế.
- Đã thử, **không có dữ liệu** trên Yahoo: `HMF=F`, `ACO=F`, `SR=F`, `SCR=F`, `LBQ=F`, `BIL=F`, `ALW=F`, `ACM=F`, `MCC=F`, `CKC=F`, `SSC=F`, `HMS=F`, `TSR=F`. Riêng `MTF=F` là than nhiệt API2, không phải than luyện cốc.
- Biểu đồ "Diễn biến tương đối" chỉ số hoá mỗi mặt hàng về 100 tại đầu kỳ, để so sánh các đơn vị khác nhau trên cùng một trục (không vẽ 2 trục y). Mốc cắt kỳ tính từ **hôm nay**, không tính từ phiên cuối của từng mặt hàng, nếu không series ngừng cập nhật sẽ kéo trục thời gian lùi về trước.

## Giao diện

Lấy bố cục FireAnt (fireant.vn) làm mẫu tham khảo. **Không** dùng tên, logo hay thương hiệu FireAnt.
- **Cột trái:** biểu đồ chỉ số (bấm vào một dòng chỉ số để đổi biểu đồ), danh sách 4 chỉ số kèm sparkline, watchlist 10 mã thép.
- **Ở giữa:**
  - Header giá, biểu đồ nến kèm volume, MA20 và MA50.
  - 8 thẻ KPI, mỗi thẻ có dòng "Trung vị ngành" để so sánh.
  - 4 tab: Kết quả kinh doanh, Báo cáo tài chính, So sánh cùng ngành, Hồ sơ công ty.
- **Cột phải:** tổng quan ngành thép hôm nay (biến động bình quân theo vốn hoá, số mã tăng/giảm), khối ngoại mua/bán ròng, độ rộng thị trường.
- **Màu giá theo quy ước sàn VN:** tăng `--up` xanh lá, giảm `--down` đỏ, tham chiếu `--ref` vàng, trần `--ceil` tím, sàn `--floor` xanh lam.
- **Màu biểu đồ:**
  - Biểu đồ 1–2 series dùng `--series-1` (blue) và `--series-2` (orange).
  - Biểu đồ nhiều mặt hàng dùng `--cat-1..8`, theo bảng màu tham chiếu đã kiểm định CVD trên nền `#14171d` và `#ffffff`.
  - Ở nền sáng, slot 3, 4, 5 có độ tương phản dưới 3:1. Vì vậy phải luôn có nhãn giá trị cuối và bảng số liệu đi kèm.
  - Text không dùng màu series.
- **Quy tắc vẽ biểu đồ:**
  - Không vẽ biểu đồ 2 trục y; hai đại lượng khác thang đo thì tách thành 2 biểu đồ.
  - Biểu đồ cột luôn bắt đầu từ 0.
  - Biểu đồ so sánh ngành: mã đang xem dùng màu nhấn, các mã khác màu xám, kèm vạch trung vị.
- **Responsive:**
  - Dưới 1280px: cột phải chuyển xuống dưới.
  - Dưới 900px: còn 1 cột, padding hai bên 16px.

## So sánh cùng ngành

- Bảng 10 mã, click tiêu đề cột để sắp xếp. Mã đang xem được highlight. Dòng cuối là trung vị ngành.
- Các cột: giá, %, vốn hoá, P/E, P/B, EPS, ROE, ROA, biên gộp, biên ròng, nợ vay/VCSH, tăng trưởng DT và LN (TTM so với 4 quý cùng kỳ năm trước).
- Có biểu đồ thanh ngang so sánh một chỉ số, chọn chỉ số bằng dropdown.

## Link sang CafeF

- Mọi chỗ hiển thị mã cổ phiếu đều có icon ↗ link sang CafeF, mở ở tab mới (`target="_blank" rel="noopener"`). Click vào mã thì mở dashboard nội bộ.
- Định dạng: `https://cafef.vn/du-lieu/{san}/{ma}-{slug-ten-cong-ty}.chn`, với `{san}` là `hose`, `hnx` hoặc `upcom`.
- Đã kiểm tra 10/2026: CafeF chỉ đọc phần mã đứng trước dấu `-` đầu tiên. Thiếu slug thì trả 404, slug sai vẫn mở đúng trang.
- Chỉ tạo link qua hàm `cafefUrl()` trong [frontend/js/format.js](frontend/js/format.js).

## Quy ước

- Text hiển thị trên UI viết bằng tiếng Việt. Code và tên biến viết bằng tiếng Anh.
- Định dạng số theo `vi-VN`: phân tách hàng nghìn bằng `.`, thập phân bằng `,`. Tiền lớn hiển thị theo tỷ đồng.
- Worker không dùng package npm nào lúc chạy, chỉ có `wrangler` (dev dependency, ghim phiên bản cố định). `playwright` chỉ dùng cho script chụp ảnh, nằm trong `requirements-dev.txt`.
- Không commit `.venv/`, `node_modules/`, `.wrangler/`, `screenshots/` (đã có trong `.gitignore`).

## Deploy

- **Web:** https://thep-board.thep-board.workers.dev. Worker tên `thep-board`, subdomain workers.dev là `thep-board`.
- **Repo:** https://github.com/thanhidun2011-alt/thep-board (private), nhánh `main`.
- Giao diện và API chạy chung trên **Cloudflare Workers** (gói miễn phí). GitHub dùng để lưu code.
- **Tự động deploy đã bật** (Workers Builds, nhánh `main`, deploy command `npx wrangler deploy`). Push lên `main` thì khoảng 40 giây sau web có bản mới. Đã kiểm chứng ngày 11/10/2026.
- **Quy trình sửa:** sửa code, chạy `npm run dev` và chụp screenshot để kiểm tra, rồi `git commit` và `git push origin main`. Push lên `main` là deploy thẳng ra web thật, nên phải kiểm tra trên máy trước.
- Thông tin đăng nhập GitHub đã lưu trong Windows Credential Manager, nên shell của Claude push được. Đặt `$env:GIT_TERMINAL_PROMPT = "0"` để lệnh báo lỗi ngay thay vì treo chờ đăng nhập.
- Shell của Claude phải nạp lại PATH trước khi gọi git: `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`. Git nằm ở `C:\Program Files\Git\cmd\git.exe`.
- Người dùng code bằng **Antigravity**. Terminal mở trước khi cài git sẽ không nhận lệnh `git`, cần khởi động lại Antigravity hoặc gọi bằng đường dẫn đầy đủ.
- Deploy thủ công khi cần (không qua GitHub): `npx wrangler login`, sau đó `npm run deploy`.
- Tùy chọn đặt giao diện trên GitHub Pages: publish thư mục `frontend/` và điền URL Worker vào `frontend/js/config.js`. Worker đã trả header CORS `*`.
- **Đã kiểm chứng 11/10/2026 sau deploy:**
  - Vietcap, Yahoo và Sina đều trả dữ liệu khi gọi từ Cloudflare.
  - Tất cả endpoint trả 200, không có lỗi 1102 (vượt CPU), kể cả `rubber-shfe?range=5y` với khoảng 5.300 nến từ Sina.
  - Sina chậm 3–5 giây ở lần tải đầu, các lần sau dùng cache.
  - Theo dõi log bằng `npx wrangler tail`.
- Subdomain workers.dev mới tạo cần khoảng 5 phút để có chứng chỉ HTTPS. Trước đó request sẽ báo lỗi SSL handshake.
