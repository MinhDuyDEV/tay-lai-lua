# Kiến trúc taylailua — mô phỏng thi sát hạch lái xe Việt Nam

> Trạng thái: **bản thiết kế, chưa có code**. Cập nhật lần cuối: 2026-10-25.
> Phiên bản phần mềm ghi trong tài liệu này lấy từ nghiên cứu ngày 2026-10-25. Khi khởi tạo dự án phải kiểm tra lại.
> Đặc tả nghiệp vụ (luật thi) nằm trong `docs/legal/`. Tài liệu này chỉ tham chiếu tới đó, không chép lại.

## 1. Mục tiêu và phạm vi

**Sản phẩm.** Web 3D cho học viên tự học. Học viên luyện trước các bài thi sát hạch lái xe, nhớ trình tự từng bài, và biết lỗi nào bị trừ điểm hay bị đình chỉ, để tránh khi thi thật.

| | Phạm vi |
|---|---|
| **v1** | Hạng B (số sàn và số tự động): **sa hình 11 bài** và **đường trường 12 bài**, chấm theo TT 108/2026/TT-BCA |
| **Thiết bị** | Máy tính là ưu tiên số 1 (bàn phím, tay cầm, vô lăng). Điện thoại phải chạy được |
| **Người dùng** | Học viên tự học (B2C). Chưa có tài khoản cho trung tâm đào tạo |
| **Mở rộng (đã tính trước trong thiết kế)** | Lý thuyết; hạng C1, C, D1, D2, D; các hạng E; B1; A1, A |
| **Không làm** | Bài "mô phỏng tình huống giao thông" 120 câu. Bài này đã bị bỏ khỏi kỳ thi từ 01/07/2026. Vì vậy module dùng tên `sa_hinh` và `duong_truong`, không dùng tên `mo_phong` |

**Tiêu chí chọn công nghệ** (chủ dự án đã chốt): mỗi lớp dùng công nghệ tốt nhất cho việc của lớp đó, **mở rộng được** và **tối ưu hiệu năng**. Công nghệ khó học không phải là lý do để loại. Ngược lại, một công nghệ chỉ được chọn khi lợi ích của nó **đo được**, không chọn vì nó mới hay vì nó khó.

## 2. Nguyên tắc

1. **Văn bản luật gốc là nguồn sự thật.**
   - Mỗi luật chấm điểm có một mã ổn định, kèm câu trích nguyên văn và vị trí trong văn bản (`docs/legal/*`).
   - Code không được tự đặt ra lỗi. Mọi thứ văn bản không quy định (ví dụ mốc thời gian đi tới từng bài) phải ghi rõ là **giả định**.
2. **Mô phỏng tất định (deterministic).** Cùng file `.wasm`, cùng bộ luật, cùng seed và cùng chuỗi thao tác thì phải cho cùng kết quả **từng bit** trên mọi trình duyệt và trên server. Nhờ đó mới phát lại được, viết test được, và server kiểm lại được.
3. **Nặng ở máy khách, nhẹ ở server.** Toàn bộ mô phỏng chạy trên máy người học. Server chỉ lưu trữ và kiểm tra. Đây là lý do hệ thống mở rộng được mà không cần microservices.
4. **Đo rồi mới chọn.** Các câu hỏi WebGPU hay WebGL, Worker hay main thread, cách định dạng bản ghi lượt chạy đều phải trả lời bằng số đo ở giai đoạn 0.
5. **Mỗi module là module sâu.** Giao diện nhỏ, nhiều hành vi ẩn bên trong, test được qua chính giao diện đó. Chỉ thêm seam (điểm cắm để thay hành vi mà không sửa code ở chỗ đó) khi có thứ thực sự thay đổi ở đó.

## 3. Tổng quan

```
                  ┌────────────── Cloudflare CDN (HAN/SGN/DAD) ───────────────┐
Trình duyệt       │ apps/web: Next.js (file tĩnh) + file 3D + sim.wasm         │
                  └────────────────────────────────────────────────────────────┘
  ┌──────────── main thread ─────────────┐    ┌──────── Web Worker ─────────┐
  │ React UI (quy trình thi, HUD, KQ)    │    │ sim.wasm (Rust, sim-core)   │
  │ R3F/three: vẽ + nội suy trạng thái   │◄───│  60 bước/giây cố định       │
  │ Input: phím/tay cầm/vô lăng/cảm ứng ─┼───►│  họ xe · máy dò · luật      │
  │ AudioWorklet: tiếng máy (rpm, côn)   │    │  đạo diễn · giám khảo · log │
  └──────────────────────────────────────┘    └─────────────────────────────┘
          │ ConnectRPC (protobuf)                 │ bản ghi lượt chạy (zstd)
          ▼                                       ▼ tải thẳng qua link ký sẵn (presigned URL)
  apps/api: Go + chi + connect-go ──► PostgreSQL     Object storage tại VN
          │                                              ▲
          └── việc nền: wazero chạy lại sim.wasm ─────────┘ (kiểm tra lượt chạy)
```

Ba ngôn ngữ dùng chung một schema Protobuf (`proto/`). Mỗi ngôn ngữ giữ đúng một vai:
- Rust: tính toán chính xác.
- TypeScript: giao diện và đồ họa.
- Go: lưu trữ và phục vụ.

## 4. Các module

### 4.1. `sim-core` (Rust → wasm32): lõi mô phỏng và chấm điểm

Đây là module quan trọng nhất. Mọi thứ cần đúng tuyệt đối đều nằm ở đây.

**Interface** (bao gồm các bất biến, không chỉ chữ ký hàm):

```
create(config: SessionConfig) -> Session      // hạng, bộ luật, xe, sân hoặc tuyến, seed
step(session, input: TickInput) -> ()         // tiến đúng 1 bước 1/60 s
state(session) -> &StateView                  // đọc trực tiếp từ bộ nhớ wasm (typed array)
drain_events(session) -> [Event]              // lỗi, điểm, hiệu lệnh, kết thúc bài
hash(session) -> u64                          // mã băm trạng thái để kiểm tra tất định
```

**Bất biến:**
- **Bước thời gian cố định 1/60 s.** Bộ đếm thời gian nằm ở phía gọi. `step` không nhận `dt`.
- **`TickInput` đã được lượng tử hóa:**
  - Mỗi bước nhận đúng một snapshot thao tác.
  - Bản ghi lượt chạy lưu đúng các snapshot đã dùng.
- **File `.wasm` không import gì từ bên ngoài.** Không dùng `env.sin` hay `env.pow`, không dùng wasm-bindgen trong lõi.
  - Phần giao tiếp chỉ gồm vài hàm `extern "C"` cùng các hàm cấp phát và giải phóng bộ nhớ.
  - Nhờ vậy trình duyệt và wazero chạy **cùng một file**.
- **Cấu hình build và tính toán:**
  - Build với `panic=abort`.
  - Tắt relaxed-SIMD, vì nó cho kết quả khác nhau giữa các máy.
  - Chuẩn hóa giá trị NaN trước khi băm trạng thái.
  - Không dùng phép nhân-cộng gộp (`mul_add`) ngầm định.
- **Không có I/O, không đọc đồng hồ thật, không tự sinh số ngẫu nhiên.** Mọi yếu tố ngẫu nhiên đều đi từ seed qua một bộ sinh số giả ngẫu nhiên (PRNG) chạy bên trong lõi.

**Bên trong module** (đây là seam nội bộ, dùng cho test của chính module, không lộ ra ngoài):

| Phần | Vai trò | v1 |
|---|---|---|
| Họ xe | `trait VehicleModel`: nhận thao tác, trả về trạng thái và hình bao (thân xe, từng bánh) | Ô tô thân liền: mô hình xe đạp động học (kinematic bicycle) cùng hệ truyền động: côn, số sàn/tự động, vòng tua, chết máy |
| Hình học | Va chạm 2D: bánh xe với vạch hoặc polyline, thân xe với vùng hoặc ô đỗ, khoảng cách đầu xe tới vạch dừng | Có |
| Máy dò (detector) | Các hàm nhỏ, mỗi hàm phát hiện một loại sự kiện: `wheel_on_line`, `stop_distance`, `rollback`, `timer`, `speed_over`, `rpm_over`, `stall`, `signal_state`, `red_light`, `yield_pedestrian`, `collision`… | Đủ cho hạng B |
| Bộ luật | Đọc dữ liệu luật (mục 6) và nối máy dò với điểm trừ | `tt108-2026` (và `tt12-2025` nếu cần) |
| Giám khảo ảo | Ra hiệu lệnh và quản lý trình tự bài: sa hình thi liên hoàn; đường trường thì bài 1 và 12 cố định, bài 2–11 lặp lại được và không theo thứ tự | Có |
| Đạo diễn tình huống | Đường trường: khi giám khảo gọi bài nào thì đặt xe chậm, xe ngược chiều, người đi bộ, đèn cần cho bài đó; thêm một ít xe nền | Có |
| Phát lại | Header gồm mã băm `.wasm`, mã bộ luật, phiên bản nội dung, seed; tiếp theo là log thao tác từng bước | Có |

**Họ xe là một seam đã biết trước.** Các hạng sau này cần họ xe khác:
- xe kéo rơ-moóc (khớp nối, các hạng E);
- xe 3 bánh (B1);
- xe 2 bánh (A1, A).

Theo nguyên tắc "một adapter chỉ là seam giả định", v1 **chỉ khai báo trait và có một adapter** là ô tô thân liền. Không dựng sẵn hạ tầng chung cho các họ xe chưa làm. Xe tải và xe khách (C1–D) dùng cùng adapter ô tô, chỉ khác tham số.

**Vật lý:** v1 **không dùng engine vật lý**. Ở tốc độ sa hình (≤ 24 km/h) mô hình động học đã đủ. Khi cần va chạm vật rắn hoặc thăng bằng xe máy, sẽ thêm `rapier3d` bật tính năng `enhanced-determinism` làm dependency Rust.

### 4.2. `content`: dữ liệu nghiệp vụ, có phiên bản

Toàn bộ "hồ sơ" của từng hạng xe là **dữ liệu**, không phải code:

| Loại | Nội dung | Nguồn |
|---|---|---|
| `license_classes` | Hạng, phần thi, thứ tự, điều kiện thi phần sau | TT 108 Điều 4, 12 (`docs/legal/tt-108-2026-bca.md`) |
| `rulesets/<id>` | Bộ luật có ngày hiệu lực: bài thi, giới hạn chung, danh sách lỗi | `tt-108-2026-phu-luc-iii-oto.md`, `tt-108-2026-bca.md` |
| `vehicles` | Kích thước xe thi (a, b, chiều dài cơ sở, Rqv, B1), thông số hệ truyền động | QCVN 15:2026 mục 2.2 |
| `courses` | Sân sa hình: công thức hình học cùng cách bố trí | `qcvn-15-2026-hinh-ve.md`, `qcvn-15-2026-bca.md` |
| `routes` | Tuyến đường trường dạng đồ thị làn: đoạn thẳng, cung tròn, clothoid; nút giao, đèn, vạch người đi bộ, vòng xuyến | Tự dựng theo QCVN 41:2024 và TT 108 mục 4.3 |
| `signs_markings` | Mã biển báo, vạch kẻ đường, ý nghĩa đèn | `qcvn-41-2024-va-bo-cau-hoi.md` |
| `question_banks` (sau v1) | Câu hỏi, đáp án, nhóm câu điểm liệt, cấu trúc đề theo hạng | Bộ 600 câu (CV 2262), sau này là bộ cho 2027 |
| `penalties` (thông tin thêm) | Mức phạt ngoài đời tương ứng với lỗi | NĐ 168/2024 sửa bởi NĐ 238/2026 (`luat-giao-thong-nen-tang.md`) |

**Định dạng dữ liệu:**
- Schema định nghĩa trong `proto/content`.
- File nguồn là JSON theo cách ánh xạ JSON chuẩn của protobuf, để người đọc và review được.
- Lúc build, JSON được kiểm tra hợp lệ rồi biên dịch sang dạng nhị phân, nhúng vào `sim.wasm` hoặc tải kèm.

Tách như vậy để thêm một hạng xe thường chỉ là thêm dữ liệu.

### 4.3. `apps/web`: Next.js + R3F

- **Khung app:**
  - Next.js 16.4.x, `output: 'export'` (xuất ra file tĩnh), chưa bật `cacheComponents`.
  - Các trang SEO (mẹo từng bài, bảng lỗi, sau này là lý thuyết) được dựng sẵn thành HTML.
  - Route `/thi/*` chỉ chạy trên trình duyệt. Route này nạp `three`, R3F và `sim.wasm` theo kiểu lazy (chỉ tải khi người dùng vào trang). Trang giới thiệu không tải three.js.
- **Vẽ 3D:**
  - three r186 (khóa phiên bản), `@react-three/fiber` 9.8.x, drei 10.7.x, dùng **WebGLRenderer**.
  - Trên máy tính có thể bật thêm WebGPU, nhưng chỉ khi bộ đo của dự án cho thấy nhanh hơn (mục 9).
  - Các vật lặp lại như cọc, vạch, lề dùng `InstancedMesh` hoặc `BatchedMesh`.
- **Vòng lặp vẽ:**
  - Mỗi khung hình (`rAF`), lấy thao tác hiện tại gửi cho Worker.
  - Worker chạy đủ số bước cố định cần chạy, trả về trạng thái.
  - React/three nội suy giữa 2 trạng thái gần nhất.
  - Vẽ 3D không nằm trong React state. Dùng ref và `useFrame`. Zustand chỉ dùng cho giao diện.
- **Sân thi** được dựng từ `courses` và kích thước xe ngay trong trình duyệt, gần như không phải tải file. Chỉ xe, cảnh vật và biển báo là file glTF, nén meshopt và KTX2 bằng gltf-transform.
- **Âm thanh:** tiếng động cơ được tổng hợp trong AudioWorklet theo vòng tua, tải và vị trí côn.
  - Đây là phần dạy học quan trọng: học viên phải nghe được lúc côn bắt và lúc sắp chết máy.
  - Trên iOS, `AudioContext` chỉ mở được sau khi người dùng chạm màn hình, và phải `resume()` lại khi quay lại ứng dụng.
- **Điều khiển:** mọi thiết bị đầu vào được quy về cùng một bộ hành động (lái, ga, phanh, côn, số, phanh tay, xi nhan, còi, đèn khẩn cấp, dây an toàn, quan sát gương trái/phải/trong, ngoái đầu, đặt biển cảnh báo…).
  - Những thao tác ngoài đời mà luật trừ điểm (quan sát, đi vòng kiểm tra xe, đặt biển cảnh báo) trở thành **hành động bấm được** để máy dò chấm điểm.
  - Thiết bị hỗ trợ: bàn phím, Gamepad API (có màn hình hiệu chỉnh vô lăng G29), bộ điều khiển cảm ứng riêng cho từng họ xe.
- **Mức đồ họa:** `detect-gpu` ước lượng mức ban đầu, sau đó drei `PerformanceMonitor` và `AdaptiveDpr` điều chỉnh khi đang chạy. Trên điện thoại, giới hạn DPR (mật độ điểm ảnh khi vẽ).

### 4.4. `apps/api`: Go

- **Nền tảng:**
  - Go 1.27.x, router `chi` v5.
  - Gắn **ConnectRPC** (`connect-go`) để phục vụ API chính.
  - Webhook thanh toán và callback OAuth dùng handler `net/http` thường gắn trên cùng router.
- **Lưu trữ:**
  - PostgreSQL 18; nâng lên 19 khi bản chính thức ra và đã được kiểm.
  - `pgx` v5 + `sqlc`, migration bằng `goose`.
  - Bảng lượt thi chia partition theo tháng khi dữ liệu lớn.
- **Bản ghi lượt chạy:** trình duyệt nén bằng zstd rồi tải thẳng lên object storage qua link ký sẵn. API chỉ lưu thông tin mô tả.
- **Kiểm tra lượt chạy (việc nền, không chặn request):**
  1. wazero (v1.12) biên dịch trước (AOT) file `sim.wasm` đúng phiên bản ghi trong header của bản ghi.
  2. Chạy lại toàn bộ chuỗi thao tác.
  3. So mã băm trạng thái và danh sách sự kiện với kết quả trình duyệt gửi lên.
  4. Lệch thì đánh dấu lượt chạy, không xóa.
- **Đăng nhập:**
  - Session lưu phía server (có thể khóa tài khoản ngay lập tức).
  - Đăng nhập bằng Google và Zalo OAuth v4 (PKCE).
  - OTP qua tin nhắn Zalo (ZNS), dự phòng bằng SMS brandname (sau v1).
- **Vận hành:** server không giữ trạng thái giữa các request, nên chỉ cần thêm instance là mở rộng được. Log bằng `slog`, trace và metric bằng OpenTelemetry, đóng gói container bằng `ko`.

### 4.5. `proto/`: schema chung (buf)

| Gói | Dùng cho |
|---|---|
| `api.v1` | Dịch vụ ConnectRPC: lượt thi, tiến độ, phiên bản nội dung |
| `replay.v1` | Header bản ghi lượt chạy, định dạng log thao tác, sự kiện |
| `content.v1` | Hạng, bộ luật, xe, sân, tuyến, câu hỏi |

Sinh code: Rust (prost), Go (connect-go), TypeScript (protobuf-es/connect-es).

**Không băm byte protobuf để kiểm tra tất định**, vì cùng một dữ liệu có thể mã hóa ra byte khác nhau. Chỉ băm trạng thái mô phỏng.

## 5. Vòng đời một lượt thi

1. Web gọi `StartAttempt(class, ruleset, mode)`. API trả về `attempt_id`, seed, phiên bản nội dung và mã băm `sim.wasm` mong đợi.
2. Worker gọi `create(config)`. Mỗi bước 1/60 s chạy `step(input)`. Sự kiện (lỗi, hiệu lệnh) được đẩy lên giao diện ngay lập tức.
3. Khi bài thi kết thúc:
   - web nén log thao tác,
   - tải lên object storage qua link ký sẵn,
   - gọi `FinishAttempt` kèm điểm, các sự kiện và mã băm cuối.
4. Một việc nền chạy lại lượt thi bằng wazero và ghi kết quả kiểm tra.
5. Màn hình kết quả cho phép phát lại chính lượt đó: cùng file `.wasm` cộng log thao tác. Trên đường đi của xe có đánh dấu chỗ bị lỗi, mỗi lỗi kèm trích dẫn điều luật.

## 6. Mô hình luật chấm điểm

Mỗi lỗi trong `docs/legal` trở thành một dòng dữ liệu. Ví dụ (TT 108 Phụ lục III, bài dốc):

```json
{
  "id": "SH.03.TUT_DOC",
  "exercise": "sa_hinh.doc",
  "detector": "rollback",
  "params": { "max_m": 0.5, "from": "stopped_at_line" },
  "penalty": { "kind": "DISQUALIFY" },
  "repeat": "ONCE",
  "source": {
    "doc": "TT 108/2026/TT-BCA",
    "loc": "Phụ lục III, B.I.2.2.4, Bài 3",
    "quote": "Xe bị tụt dốc quá 500mm kể từ khi dừng xe, bị đình chỉ sát hạch."
  }
}
```

- Có 4 cách tính lặp lại:
  - `ONCE`: tính một lần;
  - `EACH`: mỗi lần xảy ra;
  - `PER_INTERVAL{seconds}`: ví dụ "cứ 03 giây trừ 01 điểm", "cứ quá 05 giây trừ 05 điểm";
  - `PER_OVERRUN{seconds}`: ví dụ "cứ quá 02 phút trừ 05 điểm".
- Các lỗi chung (chết máy, vòng tua > 4000, quá tốc độ, vỉa hè, tai nạn) khai báo một lần ở mức bộ luật. Mỗi bài chỉ liệt kê những lỗi chung áp dụng cho bài đó, đúng như bảng lỗi trong văn bản.
- **Giả định** (không có trong văn bản, ví dụ mốc thời gian đi tới từng bài, thời gian đèn vàng) nằm trong một khối `assumptions` riêng. Giao diện hiển thị rõ đây là giả định.
- **Chỗ văn bản chưa thống nhất** được ghi thành dữ liệu kèm phương án mặc định và ghi chú hiển thị cho người học. Ví dụ ngã tư ghi cả ≤ 500 mm lẫn ≤ 1000 mm; bài thay đổi số với xe số tự động.
- Mã lỗi trong `docs/legal/tt-108-2026-phu-luc-iii-oto.md` (`SH.*`, `DT.*`) và trong `tt-108-2026-bca.md` (146 mã của các hạng khác) **phải được chuẩn hóa về một quy ước** khi tạo `content/rulesets/tt108-2026`.

## 7. Sân sa hình và tuyến đường trường

- **Sân sa hình** được sinh từ công thức QCVN 15:2026 theo kích thước xe thi. Ví dụ:
  - ô ghép dọc: Ld = a + 1,0 m;
  - đường quanh co: Rn = Rqv + 1,2 m;
  - dốc: 15 m, độ dốc 10 %, đỉnh dốc bằng dài 10 m.

  Mỗi hình gồm:
  - polyline vạch giới hạn, trắng, rộng 0,1 m, cách bó vỉa ≥ 0,1 m;
  - bó vỉa ≥ 0,15 m;
  - vạch dừng, vùng cảm biến, ô đỗ.

  Bộ sinh sân (course generator) xuất cùng lúc **hình học để chấm điểm** (2D, chính xác) và **mesh để vẽ**, nên hai thứ không bao giờ lệch nhau. Sai số thi công ±5% (QCVN 15 mục 2.1.12) có thể bật để luyện với nhiều sân khác nhau.
- **Tuyến đường trường** là đồ thị làn tự định nghĩa, dài ≥ 5 km.
  - Tuyến phải có đủ các tình huống mà TT 108 mục 4.3 yêu cầu: ngã ba, ngã tư, đường nhánh ra đường chính, vòng xuyến, đèn, lối người đi bộ.
  - Có thể nhập từ OpenDRIVE 1.9 lúc build bằng crate Rust `xodr`. OpenDRIVE chỉ là định dạng nhập, không dùng khi chạy.
- **Giám khảo ảo và đạo diễn tình huống** chọn vị trí trên tuyến cho từng bài 2–11, rồi chỉ sinh đúng các đối tượng cần cho bài đó.

## 8. Tất định, phát lại và kiểm thử

- **Test vết chuẩn (golden trace):** cùng một bộ log thao tác chuẩn phải cho cùng mã băm trên tất cả các môi trường sau:
  - Chrome (V8);
  - Firefox (SpiderMonkey);
  - Safari macOS và iOS (JSC);
  - wazero ở chế độ compiler và interpreter, trên chip amd64 và arm64.

  Test này là điều kiện bắt buộc của CI. Lệch một bit cũng là lỗi chặn release.
- **Kiểm tra file `.wasm` trong CI:** không có import nào, không có lệnh relaxed-SIMD.
- **Test luật** viết theo kịch bản: từ trạng thái nào, qua chuỗi thao tác nào, phải ra sự kiện nào và mấy điểm. Mỗi lỗi trong `docs/legal` có ít nhất một test kích hoạt lỗi và một test không kích hoạt. Test chạy bằng `cargo-nextest`.
- **Test web:** Vitest 5 (có Browser Mode), Playwright 1.64 cho test đầu-cuối và smoke test WebGL. Số FPS chỉ tính khi đo trên GPU thật, không tin số đo headless.
- **Test API:** `testcontainers-go` với Postgres thật.

## 9. Hiệu năng: ngân sách đề xuất

Các con số dưới đây là **đề xuất của dự án, chưa có nguồn chuẩn**. Giai đoạn 0 sẽ đo rồi chốt.

| Chỉ số | Mục tiêu |
|---|---|
| p95 thời gian một khung hình, laptop tầm trung, sa hình | ≤ 16,7 ms (60 fps) |
| p95 thời gian một khung hình, Android tầm trung (Mali, Adreno) | ≤ 33 ms (30 fps), có tự hạ chất lượng |
| Một bước `step` của lõi mô phỏng (sa hình hạng B) | ≪ 1 ms; đo bằng micro giây |
| Thời gian từ mở `/thi` tới lái được, mạng 4G | ≤ 3 s khi đã có cache ở CDN |
| Trang giới thiệu | Không tải three.js hay sim.wasm |
| Bản ghi lượt chạy 18 phút, sau nén | Ước tính vài chục đến vài trăm KB, cần đo |

**Hai câu hỏi phải trả lời bằng số đo:**
1. **WebGPU hay WebGL** với cảnh giống sân thi. Đã có báo cáo WebGPURenderer tốn CPU hơn khoảng 2 lần với cảnh nhiều vật nhỏ không instancing.
2. **Chạy lõi trong Worker hay trên main thread.**
   - Worker tách lõi khỏi công việc vẽ, nhưng làm thao tác đến chậm thêm khoảng một khung hình.
   - Lõi rất nhẹ, nên nếu độ trễ thao tác cảm nhận được thì có thể chạy cùng file `.wasm` trên main thread.
   - Interface của `sim-core` không đổi trong cả hai trường hợp.

## 10. Mở rộng, dữ liệu cá nhân, hạ tầng

- **Mở rộng số người dùng:**
  - Web tĩnh phục vụ qua CDN.
  - Bản ghi lượt chạy tải thẳng lên object storage.
  - API không giữ trạng thái giữa các request.
  - Postgres có một máy chính, thêm bản sao chỉ đọc khi cần.
  - Việc kiểm tra lượt chạy là hàng đợi nền.
- **Dữ liệu cá nhân (cần luật sư xác nhận trước khi chọn nơi đặt máy chủ):**
  - Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15, Điều 20: lưu dữ liệu trên cloud nước ngoài bị coi là chuyển dữ liệu ra nước ngoài, phải nộp hồ sơ đánh giá trong 60 ngày.
  - Nghị định 53/2022, Điều 26: doanh nghiệp trong nước phải lưu dữ liệu người dùng tại Việt Nam.
  - Nghị định 356/2025, Điều 4(1)(l): dữ liệu theo dõi hành vi có thể bị xếp vào loại nhạy cảm.

  Phương án hiện tại:

  | Thành phần | Đặt ở đâu |
  |---|---|
  | Tài khoản, số điện thoại, IP, đơn hàng, bản ghi lượt chạy | Postgres và object storage tại Việt Nam: AWS Hanoi Local Zone (EC2 tự vận hành Postgres, S3 One Zone-IA) hoặc cloud Viettel, FPT, VNG (chưa kiểm chứng) |
  | Web tĩnh và file 3D (không có dữ liệu cá nhân) | Cloudflare |
  | Theo dõi lỗi và hiệu năng | Không dùng SaaS nước ngoài. Tự vận hành tại Việt Nam, hoặc gửi về API Go |
- **Bộ 600 câu hỏi:** bản quyền thuộc Bộ Công an, không có giấy phép mở. Phải hỏi luật sư trước khi đưa vào sản phẩm thu phí.

## 11. Cấu trúc repo

```
apps/
  web/                Next.js + R3F + Worker nạp sim.wasm
  api/                Go: chi + connect-go + pgx/sqlc + wazero
crates/
  sim-core/           Rust: họ xe, hình học, máy dò, bộ luật, giám khảo, đạo diễn, replay
  sim-abi/            Lớp xuất hàm extern "C" tối giản → sim.wasm (không import gì)
  course-gen/         QCVN 15 → hình học chấm điểm + mesh (dùng chung web/sim)
  road-import/        OpenDRIVE → đồ thị làn (chạy lúc build)
proto/                buf: api.v1, replay.v1, content.v1
content/              rulesets/, vehicles/, courses/, routes/, (question_banks/)
packages/gen/         Code TS sinh từ proto
docs/
  architecture.md     Tài liệu này
  legal/              Đặc tả luật gốc (nguồn sự thật nghiệp vụ)
```

**Công cụ phát triển:**
- **Phiên bản công cụ:** mise khóa Node 26 LTS (kể từ 28/10/2026), Go, pnpm, buf. Rust khóa bằng `rust-toolchain.toml`.
- **Monorepo:** pnpm workspaces + Turborepo 2.11. Hỗ trợ Go và Rust của Turborepo còn thử nghiệm, nên có Taskfile làm phương án dự phòng.
- **Kiểm tra code:** Biome 2.6 cho lint và format, TypeScript 7 để kiểm tra kiểu.

`course-gen` chỉ tách thành crate riêng nếu web cần sinh mesh mà không qua `sim.wasm`. Nếu không cần, nó là module bên trong `sim-core`. Quyết định ở giai đoạn 0.

## 12. Lộ trình

| Giai đoạn | Nội dung | Điều kiện xong |
|---|---|---|
| **0. Khung và thử nghiệm** | Git repo và monorepo (cả ba ngôn ngữ build được bằng một lệnh); `sim-core` với xe hạng B số sàn, côn và chết máy; bài **xuất phát** và **dốc** theo QCVN 15 và TT 108; phát lại và mã băm; cảnh đo hiệu năng; thử âm thanh côn | Test vết chuẩn khớp trên Chrome, Firefox, Safari và wazero (amd64 + arm64); file `.wasm` không có import; có số đo WebGL/WebGPU và Worker/main thread; giáo viên dạy lái thử và xác nhận cảm giác côn và dốc |
| 1. Sa hình hạng B | Đủ 11 bài, số sàn và số tự động; màn hình kết quả và phát lại có trích dẫn luật | Mỗi lỗi trong Phụ lục III có test |
| 2. Đường trường hạng B | Tuyến ≥ 5 km, giám khảo ảo, đạo diễn tình huống, 12 bài | Mỗi bài kích hoạt được mọi lỗi của nó |
| 3. Tài khoản và lưu trữ | Đăng nhập, lưu lượt thi, kiểm tra bằng wazero, tiến độ học | Dữ liệu cá nhân đặt đúng nơi luật sư đã xác nhận |
| 4. Hạng C1, C, D1, D2, D | Cùng họ xe, chỉ thêm dữ liệu | Không phải sửa `sim-core` ngoài phần dữ liệu |
| 5. Lý thuyết | Bộ câu hỏi theo hạng, đề thi có giờ | Có bộ đề 2027, hoặc có ý kiến luật sư về bộ 600 câu |
| 6. Các hạng E, B1, A1, A | Họ xe mới: khớp nối, 3 bánh, 2 bánh | Bài 2 của hạng A1/A áp dụng từ 01/01/2028 |

## 13. Hoãn lại có điều kiện

| Hạng mục | Hoãn vì | Xem lại khi |
|---|---|---|
| WebGPU làm mặc định | Với cảnh nhiều vật nhỏ, WebGPU chưa nhanh hơn WebGL; Firefox Android chưa bật WebGPU mặc định | R3F v10 và drei v11 ổn định, và bộ đo của dự án cho thấy WebGPU nhanh hơn |
| R3F v10 / drei v11 | Còn alpha; nhiều thành phần chưa chạy đúng trên WebGPU | Có bản beta hoặc stable |
| Engine vật lý (Rapier) | Mô hình động học đủ cho hạng B | Làm hạng E (khớp nối), xe máy, hoặc cần va chạm vật rắn |
| Valkey / Redis | Postgres đủ dùng | Đo thấy nút thắt |
| Kubernetes, microservices | Server nhẹ, không giữ trạng thái | Không có kế hoạch |
| Bazel / Buck2 | Thêm một hệ build thứ hai | Turborepo cộng Taskfile không còn đủ |
| SharedArrayBuffer / COOP-COEP | Một Worker không cần | Cần chạy wasm đa luồng |

## 14. Câu hỏi mở (chặn hoặc ảnh hưởng thiết kế)

| # | Câu hỏi | Hỏi ai | Phương án tạm |
|---|---|---|---|
| 1 | Xe số tự động làm bài "thay đổi số trên đường bằng" thế nào? (TT 108 PL III yêu cầu làm, còn QCVN 15 mục 2.1.15.11 loại xe số tự động ra khỏi hình) | Cục CSGT hoặc trung tâm sát hạch | Chỉ chấm tốc độ, có ghi chú |
| 2 | Dừng ở ngã tư: ≤ 500 mm hay ≤ 1000 mm? | như trên | 500 mm, có ghi chú |
| 3 | Còn câu điểm liệt không? (TT 108 bỏ, CV 2262 vẫn ghi) | Cục CSGT | Tắt, có cờ để bật lại |
| 4 | Mốc thời gian đi tới từng bài trong phần mềm chấm | Trung tâm sát hạch | Tự đặt giả định |
| 5 | B1 có phải là bề rộng lốp sau bên ghế phụ không? | Trung tâm sát hạch | Bề rộng lốp |
| 6 | Có được dùng bộ 600 câu trong sản phẩm thu phí không? | Luật sư | Chưa đưa lý thuyết vào bản thu phí |
| 7 | Có bắt buộc lưu dữ liệu tại Việt Nam không? Có phải nộp hồ sơ chuyển dữ liệu ra nước ngoài không? | Luật sư | Đặt dữ liệu cá nhân tại Việt Nam |
| 8 | Thời gian đèn vàng (QCVN 41 không quy định) | — | Giả định 3 s, cho chỉnh được |

## 15. Thuật ngữ

| Tiếng Việt | Định danh trong code | Nghĩa |
|---|---|---|
| Sa hình / sát hạch trong hình | `sa_hinh` | Phần thi trong sân kín |
| Đường trường / sát hạch trên đường | `duong_truong` | Phần thi trên đường giao thông |
| Bộ luật | `ruleset` | Bộ luật chấm điểm theo một thông tư, có ngày hiệu lực |
| Máy dò | `detector` | Hàm phát hiện một loại sự kiện từ trạng thái mô phỏng |
| Đình chỉ | `DISQUALIFY` | Bị dừng thi ngay (trước đây gọi là "truất quyền") |
| Họ xe | `VehicleModel` | Mô hình chuyển động của một loại xe |
| Giám khảo ảo | `examiner` | Ra hiệu lệnh và quản lý trình tự bài |
| Đạo diễn tình huống | `scenario_director` | Sinh xe và người cần cho từng bài đường trường |
| Bản ghi lượt chạy | `replay` | Header + log thao tác, đủ để chạy lại y hệt |
