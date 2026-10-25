# QCVN 41:2024/BGTVT (báo hiệu đường bộ) và bộ 600 câu hỏi sát hạch GPLX

> **Mục đích tài liệu.** Tài liệu tham chiếu nội bộ phục vụ mô hình hoá tín hiệu đèn, vạch kẻ đường và biển báo trong **simulator lái xe 3D** (sa hình + đường trường), kèm phần mô tả bộ câu hỏi lý thuyết chính thức dùng cho sát hạch GPLX.
>
> **Mốc tra cứu / ngày hiệu lực áp dụng:** 25/10/2026. Mọi kết luận về hiệu lực được kiểm tra theo dữ liệu Công báo Chính phủ và trang văn bản của Chính phủ tại ngày này.
>
> **Nguyên tắc trích dẫn:** mọi trích dẫn trong tài liệu này là trích nguyên văn (verbatim) từ bản PDF gốc. Ký hiệu "tr." = **số trang in trên văn bản** (không phải số thứ tự trang của file PDF). Cụ thể:
> - **QCVN 41:2024/BGTVT** (và TT 51/2024): số trang in trên **Công báo** (các số 1359–1368/2024).
> - **TT 108/2026/TT-BCA**: số trang in trên **Công báo 429/2026** (ghi rõ "Công báo 429" tại chỗ trích).
> - **TT 12/2025/TT-BCA**: số trang in trên bản PDF của Thông tư (bản 133 trang; không đăng Công báo trong bộ tài liệu này), gồm cả số trang riêng của từng Phụ lục (đánh lại từ 1).
> - **CV 2262/CSGT-P5**: số trang PDF (6 trang) — nêu rõ tại Mục 7.
> - **QCVN 15:2026/BCA**: số trang in trên QCVN — nêu rõ tại Mục 6.6.

**Mục lục**

- [0. Tóm tắt kiểm tra hiệu lực](#0-tóm-tắt-kiểm-tra-hiệu-lực-tại-ngày-25102026)
- [1. QCVN 41:2024/BGTVT — thông tin văn bản](#1-qcvn-412024bgtvt--thông-tin-văn-bản)
- [2. Tín hiệu đèn giao thông](#2-tín-hiệu-đèn-giao-thông)
- [3. Vạch kẻ đường cho mô hình 3D](#3-vạch-kẻ-đường-cho-mô-hình-3d)
- [4. Thứ tự hiệu lực của hệ thống báo hiệu](#4-thứ-tự-hiệu-lực-của-hệ-thống-báo-hiệu)
- [5. Các nhóm biển báo](#5-các-nhóm-biển-báo)
- [6. Các biển cụ thể dùng trong sa hình / đường trường](#6-các-biển-cụ-thể-dùng-trong-sa-hình--đường-trường)
- [7. Bộ 600 câu hỏi sát hạch GPLX — thông tin văn bản](#7-bộ-600-câu-hỏi-sát-hạch-gplx--thông-tin-văn-bản)
- [8. Mâu thuẫn & chưa rõ](#8-mâu-thuẫn--chưa-rõ)
- [9. Danh mục nguồn & kiểm chứng](#9-danh-mục-nguồn--kiểm-chứng)
- [10. Tóm tắt dành cho lập trình viên simulator](#10-tóm-tắt-dành-cho-lập-trình-viên-simulator)

---

## 0. Tóm tắt kiểm tra hiệu lực (tại ngày 25/10/2026)

| Câu hỏi kiểm tra | Kết quả | Căn cứ |
|---|---|---|
| QCVN 41:2024/BGTVT còn hiệu lực? | **Có** — ban hành kèm Thông tư 51/2024/TT-BGTVT, hiệu lực từ 01/01/2025, thay thế QCVN 41:2019/BGTVT; không tìm thấy văn bản sửa đổi/thay thế/bãi bỏ đến 25/10/2026 | TT 51/2024/TT-BGTVT Điều 1–2 (Công báo 1359+1360, tr. 2); tra cứu CSDL Công báo ngày 25/10/2026: không có kết quả "báo hiệu đường bộ" nào ban hành sau 15/11/2024; trang vanban.chinhphu.vn (docid 211908) ghi Ngày có hiệu lực 01/01/2025, không có ngày hết hiệu lực |
| Có QCVN 41:2025 hay QCVN 41:2026 thay thế? | **Không tìm thấy** | Tìm kiếm toàn văn CSDL Công báo các cụm "QCVN 41", "báo hiệu đường bộ", "quy chuẩn kỹ thuật quốc gia về báo hiệu đường bộ" — chỉ trả về các bản 2012, 2016, 2019, 2024 |
| Bộ 600 câu hỏi có còn là bộ câu hỏi chính thức? | **Có**, là bộ đang được Cục CSGT công bố trên cổng thông tin; dùng cho kỳ sát hạch theo TT 12/2025 đến hết 28/02/2027 | CV 2262/CSGT-P5 ngày 07/05/2025; trang csgt.bocongan.gov.vn mục "Bộ 600 câu hỏi" (ngày đăng 05/05/2026); TT 108/2026/TT-BCA Điều 41 khoản 6 |
| Đã có bộ câu hỏi mới cho kỳ sát hạch từ 01/03/2027? | **Chưa công bố** (tính đến 25/10/2026) | TT 108/2026/TT-BCA có hiệu lực 01/07/2026 nhưng nội dung sát hạch lý thuyết tại khoản 4 Điều 4 chỉ áp dụng từ 01/03/2027; Điều 36 giao Cục CSGT "xây dựng bộ câu hỏi" nhưng không kèm bộ câu hỏi; trên cổng CSGT chỉ có file "Bộ 600 câu hỏi" (Hà Nội – 2025) |

**Cảnh báo về nguồn:** trang `csgt.bocongan.gov.vn/van-ban/quy-chuan-ky-thuat-quoc-gia-ve-bao-hieu-duong-bo` hiện vẫn trỏ tới **QCVN 41:2016/BGTVT** (file `146_QCVN 41_2016_Final_IN.pdf`), tức dữ liệu cũ, không dùng để xác định hiệu lực. Bản đúng đang dùng là QCVN 41:2024/BGTVT trong Công báo 1359–1368 ngày 19/12/2024.

---

## 1. QCVN 41:2024/BGTVT — thông tin văn bản

### 1.1. Văn bản ban hành

- **Số hiệu quy chuẩn:** QCVN 41:2024/BGTVT — "Quy chuẩn kỹ thuật quốc gia về báo hiệu đường bộ" (National Technical Regulation on Traffic Signs and Signals).
- **Văn bản ban hành:** Thông tư số **51/2024/TT-BGTVT** ngày **15/11/2024** của Bộ trưởng Bộ Giao thông vận tải, ký bởi Thứ trưởng Nguyễn Duy Lâm.
- **Hiệu lực:** từ **01/01/2025**.
- **Thay thế:** Thông tư số 54/2019/TT-BGTVT ngày 31/12/2019 (QCVN 41:2019/BGTVT).
- **Công báo:** Số 1359 + 1360, 1361 + 1362, 1363 + 1364, 1365 + 1366, 1367 + 1368, cùng ngày **19/12/2024**.
- **Cơ quan ban hành:** Bộ Giao thông vận tải (nay thuộc phạm vi quản lý nhà nước của Bộ Xây dựng sau sắp xếp tổ chức bộ máy; quy chuẩn không vì thế mà hết hiệu lực).

**Trích nguyên văn — TT 51/2024/TT-BGTVT, Điều 1–2 (tr. 2):**

> "Điều 1. Ban hành kèm theo Thông tư này Quy chuẩn kỹ thuật quốc gia về báo hiệu đường bộ
> Số hiệu: QCVN 41:2024/BGTVT.
> Điều 2. Điều khoản thi hành
> 1. Thông tư này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2025.
> 2. Thông tư này thay thế Thông tư số 54/2019/TT-BGTVT ngày 31 tháng 12 năm 2019 của Bộ trưởng Bộ Giao thông vận tải ban hành Quy chuẩn kỹ thuật quốc gia về báo hiệu đường bộ QCVN 41:2019/BGTVT."

**Trích nguyên văn — Lời nói đầu (tr. 4):**

> "QCVN 41:2024/BGTVT thay thế QCVN 41:2019/BGTVT.
> Quy chuẩn kỹ thuật Quốc gia về báo hiệu đường bộ QCVN 41:2024/BGTVT do Cục Đường bộ Việt Nam biên soạn, Bộ Khoa học và Công nghệ thẩm định, Bộ trưởng Bộ Giao thông vận tải ban hành theo Thông tư số 51/2024/TT-BGTVT ngày 15 tháng 11 năm 2024."

### 1.2. Bố cục quy chuẩn

- **Phần 1 — Quy định chung:** Điều 1–3 (phạm vi, đối tượng, giải thích từ ngữ).
- **Phần 2 — Quy định kỹ thuật:** Chương 1–16, Điều 4–82 (Chương 1–10: Điều 4–51; Chương 11–16: Điều 52–82).
  - Chương 1: thứ tự hiệu lực của hệ thống báo hiệu và thứ tự đường ưu tiên (Điều 4–5).
  - Chương 2: tín hiệu giao thông (Điều 6–10).
  - Chương 3: biển báo hiệu — quy định chung (Điều 11–20).
  - Chương 4: biển báo cấm (Điều 21–26).
  - Chương 5: biển báo nguy hiểm và cảnh báo (Điều 27–30).
  - Chương 6: biển hiệu lệnh (Điều 31–34).
  - Chương 7: biển chỉ dẫn trên đường ô tô không phải đường cao tốc (Điều 35–40).
  - Chương 8: biển phụ, biển viết bằng chữ (Điều 41–44).
  - Chương 9: biển chỉ dẫn trên đường cao tốc (Điều 45–47).
  - Chương 10: vạch kẻ đường (Điều 48–51).
  - Chương 11–16: cọc tiêu, tiêu phản quang, tường bảo vệ, hàng rào chắn; cột km, cọc H; mốc lộ giới; báo hiệu cấm đi lại; gương cầu lồi, dải phân cách, lan can; thiết bị âm thanh (Điều 52–82).
- **Phần 3 — Tổ chức thực hiện:** Điều 83–84.
  - 83.1: báo hiệu có nội dung/ý nghĩa sai khác phải thay thế, điều chỉnh ngay.
  - 83.2: báo hiệu lắp đặt trước ngày Thông tư có hiệu lực, chưa hoàn toàn phù hợp nhưng không gây hiểu nhầm thì được tiếp tục sử dụng đến khi sửa chữa/hư hỏng và **phải thay thế xong trước 20/8/2030**.
  - 83.3: báo hiệu thuộc dự án chưa thi công phải thực hiện theo Quy chuẩn này.
- **Phụ lục:** A (đèn tín hiệu), B (biển cấm), C (biển nguy hiểm), D (biển hiệu lệnh), E (biển chỉ dẫn), F (biển phụ), G (vạch kẻ đường), I (cột km, cọc H, mốc lộ giới), K (kích thước chữ), M (chi tiết thiết kế biển), N–O (mã hiệu đường), P (thiết kế biển chỉ dẫn trên cao tốc).

### 1.3. Nguồn tệp đã dùng (đối chiếu SHA-256)

| Tệp | Công báo | SHA-256 (rút gọn) |
|---|---|---|
| `tt-51-2024-p1-congbao-1359-1360.pdf` | 1359 + 1360 | `0964e7bb…c33070` |
| `tt-51-2024-p2-congbao-1361-1362.pdf` | 1361 + 1362 | `075d30ab…c7a13` |
| `tt-51-2024-p3-congbao-1363-1364.pdf` | 1363 + 1364 | `1a11c6ff…c2372b` |
| `tt-51-2024-p4-congbao-1365-1366.pdf` | 1365 + 1366 | `0b34b0c0…251ebb` |
| `tt-51-2024-p5-congbao-1367-1368.pdf` | 1367 + 1368 | `dbcbc88a…177a1c8e` |

> **Lưu ý kỹ thuật:** p4 (95 trang) và p5 (45 trang) là **ảnh scan** — chỉ có lớp text của dòng chân trang và dòng tiêu đề "VĂN BẢN QUY PHẠM PHÁP LUẬT / BỘ GIAO THÔNG VẬN TẢI / Thông tư số 51/2024/TT-BGTVT ... (Tiếp theo Công báo số 1363 + 1364)", không có nội dung chữ của phụ lục. Đây là các phụ lục bản vẽ M/N/O/P và phần cuối Phụ lục K; nội dung chữ cần cho mô hình hoá đã nằm trong p1–p3. Không có nội dung quy phạm nào bị thiếu trong phần A–G.

---

## 2. Tín hiệu đèn giao thông

### 2.1. Cấu tạo, thứ tự đèn

**Trích nguyên văn — Điều 6 khoản 6.1 (tr. 10):**

> "6.1. Đèn tín hiệu chính điều khiển giao thông được áp dụng ba loại màu tín hiệu: xanh, vàng và đỏ; chủ yếu có dạng hình tròn, lắp theo chiều thẳng đứng hoặc nằm ngang.
> 6.1.1. Thứ tự tín hiệu lắp theo chiều thẳng đứng: đèn đỏ ở trên, đèn vàng ở giữa và đèn xanh ở dưới.
> 6.1.2. Thứ tự tín hiệu lắp đặt theo chiều ngang: đèn đỏ ở phía bên trái, đèn vàng ở giữa và đèn xanh ở phía bên phải theo chiều đi."

### 2.2. Ý nghĩa từng màu — trích nguyên văn Điều 6 khoản 6.3 (tr. 10–11)

> "6.3. Ý nghĩa của đèn tín hiệu: tín hiệu đèn giao thông có 03 màu, gồm: màu xanh, màu vàng, màu đỏ; có hiển thị thời gian hoặc không hiển thị thời gian. Người tham gia giao thông đường bộ phải chấp hành như sau:
> 6.3.1. Tín hiệu xanh: tín hiệu đèn màu xanh là được đi; trường hợp người đi bộ, xe lăn của người khuyết tật đang đi ở lòng đường, người điều khiển phương tiện tham gia giao thông đường bộ phải giảm tốc độ hoặc dừng lại nhường đường cho người đi bộ, xe lăn của người khuyết tật qua đường;
> 6.3.2. Tín hiệu đèn màu vàng phải dừng lại trước vạch dừng; trường hợp đang đi trên vạch dừng hoặc đã đi qua vạch dừng mà tín hiệu đèn màu vàng thì được đi tiếp.
> Trường hợp tín hiệu đèn màu vàng nhấp nháy, người điều khiển phương tiện tham gia giao thông đường bộ được đi nhưng phải quan sát, giảm tốc độ hoặc dừng lại nhường đường cho người đi bộ, xe lăn của người khuyết tật qua đường hoặc các phương tiện khác.
> 6.3.3. Tín hiệu đèn màu đỏ là cấm đi: báo hiệu phải dừng lại trước vạch dừng. Nếu không có vạch dừng thì phải dừng trước đèn tín hiệu theo chiều đi.
> 6.3.4. Trường hợp không có vạch dừng, thì vị trí đặt đèn tín hiệu gần nhất theo chiều đi coi như là vạch dừng.
> 6.3.5. Tại một thời điểm, trên cùng một bộ đèn tín hiệu chỉ được sáng một trong ba màu: xanh, vàng hoặc đỏ."

**Bảng diễn giải cho simulator:**

| Tín hiệu | Hành vi bắt buộc | Điểm dừng | Ghi chú |
|---|---|---|---|
| **Xanh** | Được đi | — | Phải giảm tốc/dừng nhường người đi bộ, xe lăn đang qua đường |
| **Vàng (sáng đủ)** | Phải dừng lại | Trước vạch dừng | Ngoại lệ: đã đi trên/qua vạch dừng thì được đi tiếp |
| **Vàng nhấp nháy** | Được đi nhưng phải quan sát, giảm tốc | — | Dừng lại nhường người đi bộ/xe lăn/phương tiện khác |
| **Đỏ** | Cấm đi, phải dừng | Trước vạch dừng; nếu không có vạch dừng thì trước đèn gần nhất theo chiều đi | Vị trí đèn gần nhất được coi là vạch dừng |
| **Mũi tên xanh** | Chỉ được đi theo hướng mũi tên đang sáng | — | Mũi tên cho phép rẽ trái ⇒ đồng thời cho phép quay đầu, trừ khi có biển P.124(a,b) |
| **Mũi tên đỏ (sáng cùng đèn chính xanh)** | Không được đi theo hướng mũi tên | — | Cần bố trí làn chờ cho xe đi hướng đỏ |
| **Đèn hình phương tiện màu đỏ** | Loại phương tiện đó không được đi | — | Cần làn chờ cho phương tiện đó |
| **Chữ thập đỏ** | Xe phải dừng lại | — | Xe đã ở trong nút giao phải nhanh chóng đi ra |

### 2.3. Ý nghĩa đèn hình mũi tên — trích nguyên văn Điều 6 khoản 6.4 (tr. 11)

> "6.4.1. Nếu đèn có lắp đèn hình mũi tên màu xanh thì các loại phương tiện giao thông chỉ được đi khi tín hiệu mũi tên bật sáng cho phép. Tín hiệu mũi tên cho phép rẽ trái thì đồng thời cho phép quay đầu nếu không có báo hiệu cấm quay đầu khác.
> 6.4.2. Nếu đèn có hình của một loại phương tiện giao thông nào đó xanh thì chỉ loại phương tiện đó được phép đi.
> 6.4.3. Khi tín hiệu mũi tên màu xanh được bật sáng cùng một lúc với tín hiệu đỏ hoặc vàng thì các phương tiện đi theo hướng mũi tên nhưng phải nhường đường cho các loại phương tiện đi từ các hướng khác đang được phép đi.
> 6.4.4. Khi tín hiệu mũi tên màu đỏ được bật sáng cùng lúc với tín hiệu đèn chính màu xanh thì phương tiện không được đi theo hướng mũi tên. Những nơi bố trí mũi tên màu đỏ cần bố trí làn chờ cho các xe đi hướng đang có đèn màu đỏ.
> 6.4.5. Khi tín hiệu màu đỏ có hình của một loại phương tiện nào đó bật sáng cùng lúc với tín hiệu đèn chính màu xanh thì loại phương tiện đó không được đi. Những nơi có bố trí đèn hình phương tiện màu đỏ thì cần bố trí làn chờ cho phương tiện đó."

**Trích nguyên văn — Điều 6 khoản 6.2.2 (tr. 10):**

> "Trong từng tín hiệu của đèn có thể có hình mũi tên. Nếu mũi tên chỉ hướng cho phép rẽ trái thì đồng thời cho phép quay đầu, trừ khi có đặt biển báo số P.124 (a,b) "Cấm quay đầu xe"."

### 2.4. Đèn hai màu, đèn đường sắt, đèn điều khiển làn

**Trích nguyên văn — Điều 6 khoản 6.5.1–6.5.3 (tr. 11–12):**

> "6.5.1. Điều khiển giao thông đối với người đi bộ bằng loại đèn hai màu: khi tín hiệu màu đỏ có tín hiệu hình người tư thế đứng hoặc chữ viết "Dừng lại"; khi tín hiệu màu xanh, có hình người tư thế đi hoặc chữ viết "Đi".
> Người đi bộ chỉ được phép đi qua đường khi tín hiệu đèn xanh bật sáng và đi trong hàng đinh gắn trên mặt đường hoặc vạch sơn dành cho người đi bộ qua đường. Tín hiệu đèn xanh nhấp nháy báo hiệu chuẩn bị chuyển sang tín hiệu màu đỏ; người đi bộ lúc này không được bắt đầu đi ngang qua đường.
> 6.5.2. Loại đèn hai màu xanh và đỏ không nhấp nháy dùng để điều khiển giao thông ở những nơi giao nhau với đường sắt, bến phà, cầu cất, giá cho máy bay lên xuống ở độ cao không lớn v.v... Đèn xanh bật sáng: cho phép các phương tiện giao thông được đi. Đèn đỏ bật sáng: cấm đi. Hai đèn xanh và đỏ không được cùng bật sáng một lúc.
> 6.5.3. Loại đèn đỏ hai bên thay nhau nhấp nháy nơi giao nhau với đường sắt, khi bật sáng thì mọi phương tiện phải dừng lại và chỉ được đi khi đèn tắt. Ngoài ra để gây chú ý, ngoài đèn đỏ nhấp nháy còn trang bị thêm chuông điện hoặc tiếng nói nhắc nhở có tàu hỏa."

**Trích nguyên văn — Điều 6 khoản 6.6 (tr. 12):**

> "6.6. Để điều khiển giao thông trên từng làn đường riêng có thể áp dụng bộ đèn tín hiệu gồm 2 màu treo trên phần đường xe chạy, tín hiệu xanh có hình mũi tên phải đặt phía trên làn đường cần điều khiển, tín hiệu đỏ có hình hai gạch chéo. Những tín hiệu của đèn này có ý nghĩa như sau.
> 6.6.1. Tín hiệu xanh cho phép đi ở trên làn đường có mũi tên chỉ;
> 6.6.2. Tín hiệu đỏ phải dừng lại theo điểm 6.3.3 khoản 6.3 Điều này trên làn đường có đèn treo tín hiệu màu đỏ."

### 2.5. Hiệu lực của đèn và vị trí đặt đèn

**Trích nguyên văn — Điều 8 (tr. 13):**

> "Ở nơi đường giao nhau vừa có đèn tín hiệu vừa có biển báo hiệu và vạch sơn thì lái xe phải tuân theo hiệu lệnh của đèn tín hiệu. Trong trường hợp không sử dụng đèn tín hiệu để điều khiển giao thông theo từng làn đường riêng thì tín hiệu đèn có tác dụng cho toàn bộ phần đường xe chạy theo hướng xe đến. Trong trường hợp đèn tín hiệu tắt hoặc có đèn tín hiệu vàng nhấp nháy thì lái xe phải tuân theo biển báo hiệu và vạch sơn theo thứ tự hiệu lực đã quy định."

**Trích nguyên văn — Điều 9 khoản 9.2–9.3 (tr. 13):**

> "9.2. Khi đèn bố trí theo chiều thẳng đứng trên cột đặt trên lề đường, dải phân cách, đảo giao thông: chiều cao vị trí thấp nhất của đèn từ 1,7m đến 5,8m, khoảng cách từ bộ đèn đến mép phần đường xe chạy từ 0,5 đến 2m.
> 9.3. Khi đèn được đặt theo chiều ngang trên cần vươn thì chiều cao tối thiểu là 5,2 m, tối đa là 7,8m tính từ điểm thấp nhất của đèn đến mặt đường hoặc mặt vỉa hè;"

### 2.6. Thông số kỹ thuật đèn — Phụ lục A

**Trích nguyên văn — Phụ lục A khoản A.1 điểm p (tr. 87):**

> "p) Kích thước của đèn từ 200 mm đến 300 mm với các đèn tín hiệu chính. Với các đèn có số, chữ và hình phương tiện tham gia giao thông có thể điều chỉnh phù hợp để người tham gia giao thông dễ dàng nhận biết."

**Trích nguyên văn — Phụ lục A khoản A.2 (tr. 87–88):**

> "- Thời gian đèn xanh tối thiểu cho một hướng giao thông ít nhất là 15 giây;
> - Thời gian tín hiệu đèn dành cho người đi bộ dài ít nhất là 10 giây. Khi lưu lượng người đi bộ thấp và bề rộng đường hẹp (2 làn xe) và không là đường ưu tiên thì có thể giảm bớt thời gian tín hiệu đèn ngắn hơn, nhưng bảo đảm đủ để người đi bộ có thể qua được đường. Chú ý, tốc độ của người đi bộ sang đường tính bằng 1,2 m/s, nếu nơi bố trí dành cho người khuyết tật qua đường sẽ phải tính tốc độ của người sang đường thấp hơn 1,2 m/s và căn cứ vào thị sát để đặt chu kỳ đèn cho phù hợp..."

**Bảng A.1 — Khoảng cách tối thiểu nhìn thấy đèn tín hiệu (tr. 88–89, tóm tắt số liệu):**

| Tốc độ V85 (km/h) | 30 | 40 | 50 | 60 | 70 | 80 | 90 |
|---|---|---|---|---|---|---|---|
| Khoảng cách nhìn thấy nhỏ nhất (m) | 50 | 65 | 85 | 110 | 140 | 165 | 195 |

- Dùng đèn đường kính **300 mm** trên đường có **V85 ≥ 60 km/h** và nơi thường xuyên không có người điều khiển giao thông / nhiều người già (Phụ lục A.2, tr. 88–89).

**Các dạng đèn theo Phụ lục A.1 (tr. 86–87):** Dạng 1 (3 đèn tròn xanh–vàng–đỏ, có kiểu bổ sung mũi tên); Dạng 2 (ba màu hình mũi tên điều khiển theo hướng); Dạng 3 (2 mũi gạch chéo đỏ + mũi tên xanh cho làn); Dạng 4 (2 màu xanh–đỏ, đứng hoặc ngang); Dạng 5 (một màu đỏ, đèn tròn hoặc chữ thập); Dạng 6 (bảng bố trí đèn tín hiệu, 4 tín hiệu trắng đường kính 80–100 mm); Dạng 7 (đèn điều khiển người đi bộ: người đứng đỏ/người đi xanh); Dạng 8 (đèn đếm lùi hiển thị số xanh/đỏ); Dạng 9 (đèn cảnh báo nguy hiểm nhấp nháy tròn hoặc chữ).

**Trích nguyên văn — Phụ lục A.1 điểm a–e (tr. 86–87):**

> "a) Dạng đèn 1 Kiểu 1 là dạng đèn thường dùng, có 3 đèn tín hiệu xanh - vàng - đỏ. Ngoài ra còn các kiểu 2, 3, 4 các loại đèn báo hiệu cho phép ngoài đèn chính còn đèn mũi tên báo hiệu cho phép xe đi thẳng hoặc rẽ trái, rẽ phải, quay đầu.
> b) Dạng đèn 2 bao gồm các kiểu đèn ba màu hình mũi tên nhằm điều khiển các phương tiện theo các hướng cụ thể.
> c) Dạng đèn 3: Bên trái là đèn 2 mũi gạch chéo màu đỏ, bên phải là đèn mũi tên màu xanh. Khi tín hiệu màu đỏ sáng, các phương tiện phải dừng lại, khi đèn màu xanh sáng, các phương tiện được phép đi theo hướng mũi tên.
> d) Dạng đèn 4: Đèn tín hiệu 2 màu, xanh và đỏ. Kiểu 1 là đèn dạng đứng: tín hiệu đỏ ở trên, tín hiệu xanh ở dưới; Kiểu 2 là đèn dạng nằm ngang: đèn đỏ bên trái, đèn xanh bên phải. Tín hiệu màu đỏ các phương tiện dừng lại, tín hiệu màu xanh các phương tiện được đi.
> e) Dạng đèn 5: Đèn tín hiệu một màu đỏ. Kiểu 1 là đèn tròn, kiểu 2 là đèn chữ thập. Khi đèn sáng cấm đi, đặt phía sau nút giao theo chiều đi."

### 2.7. Ghi chú mô hình hoá đèn cho simulator

- Tại một thời điểm chỉ một trong ba màu xanh/vàng/đỏ được sáng trên cùng một bộ đèn (6.3.5).
- Đèn vàng **không** phải "đèn chuẩn bị dừng tuỳ ý": về nguyên tắc phải dừng trước vạch; chỉ được đi tiếp nếu đã ở trên/qua vạch dừng.
- Khi đèn tắt hoặc vàng nhấp nháy, hiệu lực chuyển sang biển báo rồi vạch sơn (Điều 8).
- Đèn mũi tên xanh rẽ trái ⇒ quay đầu được phép (trừ P.124(a,b)); đây là quy tắc hay bị mô hình hoá sai.
- Kích thước hiển thị gợi ý: đèn chính đường kính 200–300 mm; cột đứng thấp nhất 1,7 m; cần vươn 5,2–7,8 m.

---
## 3. Vạch kẻ đường cho mô hình 3D

### 3.1. Quy định chung

**Trích nguyên văn — Điều 48 khoản 48.1–48.4 (tr. 69):**

> "48.1. Vạch kẻ đường để hướng dẫn, điều khiển giao thông nhằm nâng cao an toàn và khả năng thông xe.
> 48.2. Vạch kẻ đường được dùng độc lập và có thể kết hợp với các loại biển báo hiệu đường bộ hoặc đèn tín hiệu chỉ huy giao thông.
> 48.3. Vạch kẻ đường bao gồm các loại vạch, chữ viết, hình vẽ ở trên mặt đường xe chạy, trên thành vỉa hè, trên các công trình giao thông và một số bộ phận khác của đường để quy định trật tự giao thông, khổ giới hạn của các công trình giao thông, chỉ hướng đi quy định của làn đường xe chạy.
> 48.4. Vạch kẻ đường phải bảo đảm cho xe chạy trên đường êm thuận, đảm bảo độ bám giữa lốp xe và mặt đường, không bị trơn trượt, không cao quá mặt đường 6 mm."

**Trích nguyên văn — Điều 49 khoản 49.1 và 49.1.1 (tr. 69):**

> "49.1. Dựa vào vị trí sử dụng, vạch kẻ đường được chia thành hai loại: vạch trên mặt bằng (bao gồm vạch trên mặt đường: vạch dọc đường, ngang đường và những loại vạch khác) và vạch đứng.
> 48.1.1. Vạch trên mặt bằng dùng để quy định các phần đường khác nhau trên mặt bằng có màu trắng trừ một số vạch quy định ở Phụ lục G có màu vàng. Trong một số trường hợp có thể sử dụng các màu sắc khác để nâng mức độ cảnh báo giao thông trên mặt đường."

> **Lưu ý:** số hiệu "48.1.1" trong bản Công báo là lỗi đánh số của quy chuẩn (đáng lẽ phải là 49.1.1). Đây là điểm cần báo cáo tại Mục 8 (C-6), không tự ý sửa khi trích dẫn.

**Trích nguyên văn — Điều 51 (tr. 70):**

> "Vạch kẻ đường khi sử dụng độc lập thì người tham gia giao thông phải tuân theo ý nghĩa của vạch kẻ đường. Vạch kẻ đường khi sử dụng kết hợp với đèn tín hiệu, biển báo hiệu thì người tham gia giao thông phải tuân theo ý nghĩa, hiệu lệnh của cả vạch kẻ đường và đèn tín hiệu, biển báo hiệu theo thứ tự quy định tại Điều 4 của Quy chuẩn này."

### 3.2. Bảng vạch kẻ đường cần cho simulator

> **Cách đọc số trang:** Phụ lục G nằm ở hai số Công báo liên tiếp — các trang 79–89 thuộc Công báo số 1361+1362/Ngày 19-12-2024; các trang 2–31 thuộc Công báo số 1363+1364/Ngày 19-12-2024. Cột "Trang" dưới đây là số trang in trên từng số Công báo tương ứng.

| Mã vạch | Tên | Màu | Bề rộng nét (b) | Chu kỳ / kích thước | Ý nghĩa cốt lõi | Trang |
|---|---|---|---|---|---|---|
| **1.1** | Vạch phân chia hai chiều xe chạy (vạch tim đường), đơn, đứt nét | Vàng | 15 cm (đường hẹp: 10 cm) | L1 = 1–3 m; L2 = 2–6 m; L1/L2 = 1:2 | Phân chia hai chiều ngược chiều; **xe được phép cắt qua** để dùng làn ngược chiều từ cả hai phía | 79 |
| **1.2** | Vạch tim đường, đơn, nét liền | Vàng | 15 cm | Liền suốt | Phân chia hai chiều; **không được lấn làn, không được đè lên vạch** | 79 |
| **1.3** | Vạch tim đường, đôi, nét liền | Vàng | 15 cm/nét; khe trong 15–50 cm | Hai vạch song song liền | Phân chia hai chiều; không lấn làn/đè vạch; dùng cho đường ≥ 4 làn không có dải phân cách, đoạn không đảm bảo tầm nhìn vượt | 80 |
| **1.4** | Vạch tim đường, đôi: một liền + một đứt | Vàng | 15 cm/nét; khe trong 15–20 cm | Nhánh đứt: L1 = 1–3 m, L2 = 2–6 m, L1/L2 = 1:2 | Bên tiếp giáp vạch đứt được cắt qua; bên tiếp giáp vạch liền không được lấn/đè | 81 |
| **1.5** | Ranh giới làn có thể đổi hướng theo thời gian | Vàng | 15 cm/nét; khe trong 15–20 cm | L1 = 1–2 m, L2 = 3–6 m, L1:L2 = 1:3 | Xác định làn đổi chiều theo thời điểm (điều khiển bởi người/đèn/biển) | 82 |
| **2.1** | Phân chia các làn xe cùng chiều, đơn, đứt nét | Trắng | 15 cm | L1 = 1–3 m; L2 = 3–9 m; L1/L2 = 1:3 | Phân chia làn cùng chiều; **được chuyển làn qua vạch** | 86 |
| **2.2** | Phân chia các làn cùng chiều, đơn, liền nét | Trắng | 15 cm | Liền suốt | Không cho chuyển làn; không lấn làn/đè vạch | 86 |
| **2.3** | Giới hạn làn dành riêng / làn ưu tiên | Trắng | 30 cm | Đứt: L1 = L2 = 1–2 m, 1:1; hoặc liền | Liền = làn dành riêng (xe khác không vào, trừ khẩn cấp); đứt = làn ưu tiên (xe khác dùng được nhưng phải nhường) | 87 |
| **2.4** | Phân chia làn cùng chiều, vạch kép (một liền + một đứt) | Trắng | Theo 2.1 + 2.2 | Tổ hợp | Nhánh đứt được cắt qua; nhánh liền không | 88 |
| **3.1a / 3.1b** | Giới hạn mép ngoài phần xe chạy / phân cách làn cơ giới – thô sơ | Trắng | 15–20 cm | 3.1a liền; 3.1b đứt L1 = L2 = 0,6 m, 1:1 | Xác định mép phần xe chạy; xe được đè khi cần và phải nhường xe thô sơ. Mép ngoài vạch cách mép phần xe chạy 15–30 cm | 88–90 |
| **4.1** | Kênh hoá dòng xe dạng gạch chéo | Trắng | Mỗi vạch 45 cm; khe 100 cm; góc 135° | Vạch bao quanh b = 20 cm | Giới hạn phần mặt đường **không** dùng cho xe chạy; không được lấn/cắt qua trừ khẩn cấp | 2–3 |
| **4.2** | Kênh hoá dòng xe dạng chữ V | Trắng | Mỗi vạch 45 cm; khe 100 cm; góc 135° | Vạch bao quanh b = 20 cm | Như 4.1, dạng chữ V | 3–4 |
| **6.1** | Vạch cấm đỗ xe trên đường | Vàng | ≥ 15 cm (trên bó vỉa) hoặc 15 cm (trên mặt đường) | Nét vàng L1 = 100 cm (hoặc bằng viên bó vỉa); L2 = L1 | Báo **không được đỗ xe** bên đường; đặt trên bó vỉa hoặc cách mép mặt đường 30 cm khi không có bó vỉa | 12–13 |
| **6.2** | Vạch cấm dừng xe, cấm đỗ xe trên đường | Vàng | ≥ 15 cm / 15 cm | Liền nét | Báo **không được dừng xe, đỗ xe** bên đường; cùng vị trí đặt như 6.1 | 13–14 |
| **7.1** | Vạch dừng xe | Trắng | 20, 30 hoặc 40 cm | Kẻ ngang toàn bộ bề rộng đường theo hướng xe chạy | Xác định vị trí dừng chờ đèn đỏ / trước biển R.122; trước vạch đi bộ, trước đường sắt, trong làn chờ rẽ trái | 14–15 |
| **7.2** | Vạch nhường đường | Trắng | Mẫu 1: vạch đôi nét đứt + tam giác ngược; Mẫu 2: tam giác cân đáy 50 cm, cao 70 cm, cách nhau 30 cm | — | Báo xe phải đi chậm hoặc dừng lại nhường đường; dùng kèm biển W.208 | 15–16 |
| **7.3** | Vạch đi bộ qua đường | Trắng | Mẫu 1: vạch ngựa vằn đậm liền song song; Mẫu 2: hai vạch liền b = 40 cm | Chiều rộng tối thiểu 3 m, tăng theo cấp 1 m; hai vạch cách nhau > 150 m | Xác định phạm vi phần đường dành cho người đi bộ cắt qua đường | 16–18 |
| **8.1** | Vạch đứng trên mốc cố định | Vàng–đen (ngoài đô thị) hoặc đỏ–trắng (trong đô thị) | Nét chéo 45°, rộng 15 cm, cách 15 cm | — | Cảnh báo chướng ngại vật cao hơn mặt đường (trụ cầu, cửa hầm, đảo an toàn…) | 22–23 |
| **8.2** | Vạch xác định mép dưới thấp nhất của kết cấu cầu vượt | Đỏ–trắng | Nét đứng rộng 20 cm, cao 50 cm; toàn bộ rộng 1 m | — | Xác định mép dưới cùng của cầu vượt/công trình phía trên đường | 24–25 |
| **8.7** | Vạch kẻ ở hàng vỉa hè nơi nguy hiểm hoặc hàng vỉa đảo an toàn | Đỏ–trắng | L1 = 1–2 m; L2 = 2–4 m; 1:2 (bán kính nhỏ: L1 = L2 = 0,5–2 m, 1:1) | — | Cảnh báo mép vỉa hè/đảo an toàn nguy hiểm | 26 |
| **9.1** | Vạch cấm xe quay đầu | Vàng | Theo Hình G.71 | — | Cấm quay đầu tại nút giao hoặc chỗ mở dải phân cách | 26–27 |
| **9.3** | Vạch mũi tên chỉ hướng trên mặt đường | Trắng | Theo tốc độ: kích thước tăng theo tốc độ; có 3 cỡ (thấp / cao / ≥ 100 km/h) | Hình G.73 (đường tốc độ thấp), G.74 (đường tốc độ cao) | Chỉ hướng xe phải đi; chủ yếu ở nút giao có tách/nhập làn, đường nhiều làn | 27–28 |
| **9.4** | Vạch mũi tên báo số làn phía trước bị giảm | Trắng | Theo Hình G.75/76 | Giảm 0,5 lần (tốc độ thấp) hoặc tăng 1,5 lần (tốc độ cao) | Báo số làn theo hướng mũi tên bị giảm, phải chuyển làn theo mũi tên | 29–30 |

### 3.3. Trích nguyên văn các vạch trọng yếu

**Vạch 7.1 — Vạch dừng xe (tr. 14–15):**

> "Ý nghĩa sử dụng: dùng để xác định vị trí dừng xe để chờ tín hiệu cho phép đi tiếp. Vạch dùng để xác định vị trí người điều khiển phương tiện phải dừng lại khi có tín hiệu đèn đỏ hoặc khi có biển số R.122. Vạch cũng dùng để xác định vị trí người điều khiển phải dừng lại trong các điều kiện nhất định ở một số vị trí như: trên nhánh dẫn tới nút giao cùng mức với đường sắt, trên làn chờ rẽ trái trong phạm vi nút giao, trước vị trí vạch người đi bộ qua đường."
>
> "Vạch 7.1 là vạch liền nét màu trắng. Bề rộng vạch, căn cứ vào cấp đường, lưu lượng xe, tốc độ xe chạy mà chọn dùng một trong các giá trị 20 cm, 30 cm hoặc 40 cm (bề rộng nét vẽ lớn hơn áp dụng cho đường có lưu lượng, tốc độ xe chạy lớn hơn). Vạch này kẻ ngang toàn bộ bề rộng đường của hướng xe chạy."
>
> "Vạch dừng xe cần đặt ở vị trí mà lái xe có thể dễ dàng quan sát. Tại các nút giao cùng mức, vạch dừng xe nên đặt trùng với đường kéo dài của bó vỉa trục đường giao khi trên nhánh dẫn không bố trí vạch đi bộ cắt qua đường; trường hợp trên nhánh dẫn có bố trí vạch đi bộ cắt qua đường thì vạch dừng xe nên đặt cách mép vạch người đi bộ qua đường (1,5 m - 3,0 m) (xem Hình G.47)."
>
> "Vạch dừng xe có thể sử dụng kết hợp với vạch chữ “STOP”. Đỉnh chữ “STOP” cách mép vạch dừng xe trong khoảng từ (2,0 m - 3,0 m); và có thể vẽ thêm chữ “STOP” để báo hiệu trước trong phạm vi 25 m trước vị trí vạch dừng xe. Chi tiết thể hiện trên Hình 48."

**Vạch 7.3 — Vạch đi bộ qua đường (tr. 16–18):**

> "Ý nghĩa sử dụng: Vạch đi bộ qua đường xác định phạm vi phần đường dành cho người đi bộ cắt qua đường.
> Bố trí vạch đi bộ qua đường ở những nơi có người đi bộ qua đường, khoảng cách bố trí hai vạch đi bộ qua đường trên cùng một đoạn đường nên cách nhau lớn hơn 150 m. Chiều rộng nhỏ nhất dành cho bố trí vạch đi bộ qua đường không được nhỏ hơn 3 m, tùy theo lượng người đi qua để nâng thêm chiều rộng, mỗi cấp nâng lên là 1 m.
> Trên những đoạn đường không bình thường (tầm nhìn bị hạn chế, dốc dọc lớn, góc ngoặt lớn hoặc đường cong nằm bán kính nhỏ hoặc có các nguy hiểm khó lường hoặc ở những đoạn đường có bề rộng làn xe bị thu hẹp dần) thì không bố trí vạch đi bộ qua đường."
>
> "- Mẫu 1: Vạch đi bộ qua đường là các đường vạch đậm liền song song màu trắng (còn gọi là vạch ngựa vằn). Kích thước vạch xem trên Hình G.51.
> - Mẫu 2: Sử dụng hai vạch liền, màu trắng, bề rộng nét vẽ b = 40 cm kẻ song song theo phương ngang đường để xác định phần đường dành cho người đi bộ (xem Hình 52). Mẫu 2 chỉ áp dụng để xác định phần đường cho người đi bộ qua đường ở những nơi có đèn tín hiệu phân định thời gian người đi bộ được phép qua đường.
> Trước vạch đi bộ qua đường cần sử dụng vạch dừng xe. Các phương tiện phải dừng lại trước vạch dừng xe nói trên trong thời gian tín hiệu đèn đỏ hoặc phải dừng lại quan sát trước khi cắt qua vạch dừng xe nếu biển số R.122 - “Dừng xe” được sử dụng kèm theo. Trường hợp không có đèn tín hiệu điều khiển và không sử dụng biển số R.122 - “Dừng xe”, các phương tiện phải dừng lại nhường đường cho người đi bộ qua đường khi có dấu hiệu người đi bộ qua đường trong khu vực kẻ vạch dừng xe."

**Vạch 6.1 và 6.2 — Vạch cấm dừng/đỗ (tr. 12–14):**

> "Vạch 6.1 là vạch đứt khúc màu vàng được sơn trên bó vỉa sát mép mặt đường phía cấm đỗ xe hoặc sơn trên mặt đường phía cấm đỗ xe, cách mép mặt đường 30 cm khi không có bó vỉa sát mép mặt đường.
> Khi vạch 6.1 được bố trí trên bó vỉa, bề rộng phần sơn vàng được lấy bằng bề rộng viên đá vỉa hoặc tối thiểu 15 cm; ngoài ra bề rộng phần sơn vàng được kéo dài trên toàn bộ mặt vát hoặc mặt đứng của viên đá vỉa phía tiếp giáp với mặt đường. Trường hợp bố trí trên mặt đường, bề rộng vạch là 15 cm. Chiều dài của nét liền (màu vàng) L1 là 100 cm hoặc bằng chiều dài của viên bó vỉa (khi bố trí vạch 6.1 trên bó vỉa), chiều dài nét đứt (không sơn) L2 bằng chiều dài nét liền L1."
>
> "Vạch 6.2 là vạch liền nét màu vàng được sơn trên bó vỉa sát mép mặt đường phía cấm dừng xe hoặc đỗ xe hoặc sơn trên mặt đường phía cấm dừng xe hoặc đỗ xe, cách mép mặt đường 30 cm khi không có bó vỉa sát mép mặt đường."

**Vạch tim đường 1.1 và 1.2 (tr. 79–80):**

> "Vạch 1.1 là vạch đơn, đứt nét, màu vàng. Bề rộng nét vẽ b = 15 cm, chiều dài đoạn nét liền L1 = 1 m - 3 m; chiều dài đoạn nét đứt (2 m - 6 m); tỷ lệ L1/L2=1:2. Trong trường hợp đường hẹp, không đủ 2 làn cơ giới, nhưng có nhiều xe máy lưu thông, có thể sử dụng vạch dạng này để phân chia, khi đó bề rộng vạch rộng 10cm, tỷ lệ L1/L2=1:3 hoặc 1:2."
>
> "Vạch 1.2 là vạch đơn, liền nét, màu vàng, bề rộng vạch 15 cm. Vạch này thường sử dụng ở đoạn đường không đảm bảo tầm nhìn vượt xe, nguy cơ tai nạn giao thông đối đầu lớn trên các đường có 2 hoặc 3 làn xe cơ giới và không có dải phân cách giữa."

**Vạch phân làn 2.1 và 2.2 (tr. 86):**

> "Vạch 2.1 là vạch đơn, đứt nét, màu trắng. Bề rộng nét vẽ b = 15cm, chiều dài đoạn nét liền L1 = (1 m - 3 m); chiều dài đoạn nét đứt (3 m - 9 m); tỷ lệ L1/L2 = 1:3."
>
> "Vạch 2.2 là vạch đơn, liền nét, màu trắng, bề rộng vạch 15 cm."

**Vạch mũi tên chỉ hướng 9.3 (tr. 27–28):**

> "Ý nghĩa sử dụng: Vạch mũi tên chỉ hướng trên mặt đường được sử dụng để chỉ hướng xe phải đi. Mũi tên chỉ hướng chủ yếu sử dụng ở các nút giao có tách nhập làn và trên đường có nhiều làn xe. Mũi tên cũng có thể được sử dụng cho các phần đường xe chạy một chiều để xác nhận hướng giao thông.
> Quy cách vạch như sau:
> - Màu sắc của mũi tên chỉ đường là màu trắng.
> - Tùy theo tốc độ xe chạy mà chọn kích thước các mũi tên phù hợp theo nguyên tắc tốc độ xe chạy càng lớn thì kích thước mũi tên càng lớn. Kích thước mũi tên thể hiện trên Hình G.73 áp dụng cho các đường có tốc độ xe chạy thấp. Kích thước mũi tên ghi ngoài ngoặc đơn thể hiện trên Hình G.74 áp dụng cho các đường có tốc độ xe chạy cao. Kích thước mũi trên ghi trong ngoặc đơn thể hiện trên Hình G.74 áp dụng cho đường ô tô cao tốc và các đường có tốc độ thiết kế ≥ 100 km/h."

### 3.4. Ghi chú mô hình hoá vạch

- **Màu:** mặc định trắng; các vạch tim đường (1.x), vạch cấm dừng/đỗ (6.x), vạch 9.1, 9.2 và một số vạch cảnh báo là **vàng**.
- **Bề rộng chuẩn:** 15 cm cho hầu hết vạch dọc; 20/30/40 cm cho vạch dừng 7.1; 30 cm cho vạch 2.3; 40 cm cho vạch 7.3 mẫu 2 và vạch xe đạp qua đường 7.4 (hai vạch đứt song song, mỗi vạch rộng 40 cm).
- **Vạch liền vs đứt:** liền = cấm lấn/đè/cắt qua (trừ trường hợp khẩn cấp); đứt = được cắt/chuyển làn.
- **Độ nổi:** vạch không được cao quá mặt đường 6 mm (48.4) — trong 3D nên để gần như phẳng, chỉ đổi màu/vật liệu.
- **Chữ trên mặt đường (vạch 9.5a–e, 9.6):** "STOP", "Ô TÔ", "XE MÁY", "XE BUÝT", "XE ĐẠP" và ký hiệu xe đạp. Quy định chung: chữ/số màu trắng; chiều cao 3,0 m cho đường cao tốc, 2,5 m cho đường khác, 1,6 m cho đường đô thị tốc độ thấp; khoảng cách hàng chữ 1,0–1,5 m; nét vẽ 12–18 cm (Phụ lục G, vạch 9.5, tr. 30–31).

---
## 4. Thứ tự hiệu lực của hệ thống báo hiệu

**Trích nguyên văn — Điều 4 khoản 4.1 và 4.2 (tr. 9):**

> "4.1. Khi đồng thời có, bố trí các hình thức báo hiệu có ý nghĩa khác nhau cùng ở một khu vực, người tham gia giao thông đường bộ phải chấp hành báo hiệu đường bộ theo thứ tự ưu tiên từ trên xuống dưới như sau:
> 4.1.1. Hiệu lệnh của người điều khiển giao thông;
> 4.1.2. Tín hiệu đèn giao thông;
> 4.1.3. Biển báo hiệu đường bộ;
> 4.1.4. Vạch kẻ đường và các dấu hiệu khác trên mặt đường;
> 4.1.5. Cọc tiêu, tường bảo vệ, rào chắn, đinh phản quang, tiêu phản quang, cột Km, cọc H;
> 4.1.6. Thiết bị âm thanh báo hiệu đường bộ.
> 4.2. Khi ở một vị trí đã có biển báo hiệu đặt cố định lại có biển báo hiệu khác đặt có tính chất tạm thời mà hai biển có ý nghĩa khác nhau thì người tham gia giao thông phải chấp hành hiệu lệnh của biển báo hiệu có tính chất tạm thời."

**Mô hình hoá cho simulator (thang ưu tiên khi xung đột):**

```
1. Hiệu lệnh người điều khiển giao thông (CSGT, người điều khiển tại công trường…)
2. Đèn tín hiệu giao thông
3. Biển báo hiệu đường bộ (biển tạm thời > biển cố định nếu khác nghĩa)
4. Vạch kẻ đường và dấu hiệu trên mặt đường
5. Cọc tiêu, tường bảo vệ, rào chắn, đinh/tiêu phản quang, cột Km, cọc H
6. Thiết bị âm thanh báo hiệu đường bộ
```

**Trích nguyên văn — Điều 15 khoản 15.3 (tr. 20):**

> "15.3. Biển báo khi sử dụng độc lập thì người tham gia giao thông phải tuân theo ý nghĩa của biển báo. Biển báo khi sử dụng kết hợp với đèn tín hiệu thì người tham gia giao thông phải tuân theo ý nghĩa, hiệu lệnh của cả biển báo và đèn tín hiệu theo thứ tự quy định tại Điều 4 của Quy chuẩn này."

**Trích nguyên văn — Điều 14 khoản 14.1 (tr. 19) về biển VMS:**

> "Khi ở một vị trí đã có biển báo có thông tin tĩnh đồng thời lại có thêm biển báo có thông tin thay đổi mà hai biển này có ý nghĩa khác nhau thì người tham gia giao thông phải chấp hành hiệu lệnh của biển báo hiệu có thông tin thay đổi."

**Trích nguyên văn — Điều 5 khoản 5.1 (tr. 9) về thứ tự đường ưu tiên** (dùng cho logic nhường đường ở nút giao không có đèn/biển):

> "- Đường cao tốc;
> - Quốc lộ;
> - Đường đô thị;
> - Đường tỉnh;
> - Đường huyện;
> - Đường xã;
> - Đường thôn;
> - Đường chuyên dùng."

---

## 5. Các nhóm biển báo

### 5.1. Năm nhóm cơ bản — trích nguyên văn Điều 11 (tr. 14–15)

> "Biển báo hiệu đường bộ trong Quy chuẩn này được chia thành 5 nhóm cơ bản sau đây: biển báo cấm; biển hiệu lệnh; biển báo nguy hiểm và cảnh báo; biển chỉ dẫn; biển phụ, biển viết bằng chữ."

> "11.1. Nhóm biển báo cấm là nhóm biển biểu thị các điều cấm mà người tham gia giao thông không được vi phạm. Biển báo cấm chủ yếu có dạng hình tròn, viền đỏ, nền màu trắng, trên nền có hình vẽ hoặc chữ số, chữ viết màu đen thể hiện điều cấm, trừ trường hợp biển báo cấm được ghép với các thông tin chỉ dẫn trên cùng một biển báo.
> 11.2. Nhóm biển hiệu lệnh là nhóm biển để báo các hiệu lệnh phải chấp hành. Người tham gia giao thông phải chấp hành các hiệu lệnh trên biển báo (trừ một số biển đặc biệt). Các biển có dạng hình tròn trên nền xanh lam có hình vẽ màu trắng đặc trưng cho hiệu lệnh nhằm báo cho người tham gia giao thông đường biết.
> 11.3. Nhóm biển báo nguy hiểm và cảnh báo là nhóm biển báo cho người tham gia giao thông biết trước các nguy hiểm trên đường để chủ động phòng ngừa kịp thời. Biển chủ yếu có hình tam giác đều, viền đỏ, nền màu vàng, trên có hình vẽ màu đen mô tả sự việc cần báo hiệu.
> 11.4. Nhóm biển chỉ dẫn là nhóm biển báo dùng để cung cấp thông tin và các chỉ dẫn cần thiết cho người tham gia giao thông. Biển chỉ dẫn chủ yếu có hình chữ nhật hoặc hình vuông hoặc hình mũi tên, nền màu xanh.
> 11.5. Nhóm biển phụ, biển viết bằng chữ là nhóm biển nhằm thuyết minh bổ sung nội dung nhóm biển tại khoản 11.1, 11.2, 11.3, 11.4 Điều này hoặc được sử dụng độc lập."

**Bảng tổng hợp 5 nhóm (dùng để phân loại khi dựng asset):**

| Nhóm | Mã hiệu | Hình dạng chủ yếu | Màu | Chức năng |
|---|---|---|---|---|
| Biển báo cấm | **P**, **DP** (hết cấm) | Tròn | Viền đỏ, nền trắng, hình/chữ đen | Báo điều cấm |
| Biển hiệu lệnh | **R**, **R.E** | Tròn | Nền xanh lam, hình trắng | Báo hiệu lệnh phải chấp hành |
| Biển báo nguy hiểm và cảnh báo | **W** | Tam giác đều | Viền đỏ, nền vàng, hình đen | Báo trước nguy hiểm |
| Biển chỉ dẫn | **I**, **IE** | Chữ nhật / vuông / mũi tên | Nền xanh | Cung cấp thông tin, chỉ dẫn |
| Biển phụ, biển viết bằng chữ | **S**, **S.G**, **S.H** | Chữ nhật / vuông | Nền trắng chữ đen hoặc nền xanh lam chữ trắng | Thuyết minh bổ sung; biển S.507 dùng độc lập |

> **Ngoại lệ hình dạng:** **R.122 "Dừng lại"** là biển hiệu lệnh nhưng có dạng **bát giác** (xem Bảng 1, mục 5.2) — không phải hình tròn như các biển R khác. Đây là suy luận từ Bảng 1 (xem thêm C-9).

### 5.2. Kích thước cơ bản của biển (Bảng 1, tr. 16) — hệ số 1 (đường đô thị)

| Loại biển | Kích thước | Giá trị (mm) |
|---|---|---|
| Biển tròn | Đường kính ngoài D | **700** |
| | Chiều rộng mép viền đỏ B | 100 |
| | Chiều rộng vạch đỏ A | 50 |
| Biển bát giác (STOP) | Đường kính ngoài D | **600** |
| | Độ rộng viền trắng xung quanh B | 30 |
| Biển tam giác | Chiều dài cạnh L | **700** |
| | Chiều rộng viền mép đỏ B | 50 |
| | Bán kính lượn tròn R | 35 |
| | Khoảng cách đỉnh cung tròn đến đỉnh tam giác C | 30 |
| Biển vuông, chữ nhật | Khoảng cách đỉnh cung tròn đến đỉnh chữ nhật C | 20–30 |

**Hệ số kích thước theo loại đường (Bảng 2, tr. 16–17):**

| Loại đường | Biển cấm / hiệu lệnh / nguy hiểm | Biển chỉ dẫn |
|---|---|---|
| Đường cao tốc | 2 | (quy định riêng tại Chương 9) |
| Đường đôi ngoài đô thị | 1,8 | 2,0 |
| Đường ô tô thông thường | 1,25 | 1,5 |
| Đường đô thị | 1 | 1 |

**Trích nguyên văn — Điều 12 khoản 12.2 (tr. 15):**

> "12.2. Đối với các đường khác, kích thước biển, hình vẽ trong biển và chữ viết phải nhân với hệ số tương ứng trong Bảng 2, kích thước biển được làm tròn theo nguyên tắc:
> a) Số hàng đơn vị ≤ 5 thì lấy bằng 5;
> b) Số hàng đơn vị > 5 thì lấy bằng 0 và tăng số hàng chục lên 1 đơn vị."

> **Ghi chú kỹ thuật:** trong bản PDF Công báo, ký tự ">" ở dòng b) bị lỗi font thành U+F03E (ký tự private-use) nên `pdftotext` có thể hiển thị sai; bản trích trên đã thay bằng ">" theo đúng nghĩa văn bản.

### 5.3. Quy định chung về biển báo cấm

**Trích nguyên văn — Điều 21 (tr. 24):**

> "Biển báo cấm để biểu thị các điều cấm. Người tham gia giao thông phải chấp hành những điều cấm mà biển đã báo."

**Trích nguyên văn — Điều 26 khoản 26.8 (tr. 27):**

> "26.8. Biển số P.125, P.126, P.127(a,b,c), P.130, P.131(a,b,c) có hiệu lực đến nơi đường giao nhau tiếp giáp hoặc đến vị trí đặt biển hết cấm (các biển số DP.133, DP.134, DP.135, DP.127d). Các biển số P.130 và P.131(a,b,c) còn căn cứ vào các biển phụ."

---

## 6. Các biển cụ thể dùng trong sa hình / đường trường

> **Bảng tra nhanh cho simulator.** Cột "Trang" là trang Công báo nơi có mô tả đầy đủ (thường kèm hình vẽ — hình không trích trong tài liệu này).

### 6.1. Nhóm biển hiệu lệnh (R) — bắt buộc

| Mã | Tên | Ý nghĩa cốt lõi | Trang |
|---|---|---|---|
| **R.122** | Dừng lại | Buộc mọi xe cơ giới & thô sơ (kể cả xe ưu tiên) dừng trước biển/vạch ngang; chỉ đi khi có tín hiệu cho phép của người điều khiển hoặc đèn cờ; nếu không có thì chỉ đi khi đường không còn nguy cơ mất ATGT | 33 |
| **R.301(a–h)** | Hướng đi phải theo | Buộc đi theo hướng mũi tên: a = đi thẳng; b = rẽ phải; c = rẽ trái; d = rẽ phải; e = rẽ trái; f = thẳng + phải; g = thẳng + trái; h = trái + phải. **Lưu ý:** b/c đặt **sau** nút giao (chỉ hướng được đi qua nút), d/e đặt **trước** nút giao | 33–35 |
| **R.303** | Nơi giao nhau chạy theo vòng xuyến | Buộc chạy vòng theo đảo an toàn theo hướng mũi tên | 36 |
| **R.306** | Tốc độ tối thiểu cho phép | Buộc xe cơ giới chạy ≥ trị số ghi trên biển trong điều kiện thuận lợi, an toàn; xe có tốc độ tối đa theo nhà sản xuất không đạt trị số thì không được vào | 37 |

**Trích nguyên văn — Phụ lục D, mục D.1 (tr. 33):**

> "a) Để báo các xe (cơ giới và thô sơ) dừng lại, đặt biển số R.122 "Dừng lại". Đây là biển hiệu lệnh dạng đặc biệt.
> b) Biển có hiệu lực buộc các loại xe cơ giới và thô sơ kể cả xe được ưu tiên theo quy định dừng lại trước biển hoặc trước vạch ngang đường và chỉ được phép đi khi thấy các tín hiệu (do người điều khiển giao thông hoặc đèn cờ) cho phép đi. Trong trường hợp trên đường không đặt tín hiệu đèn cờ, không có người điều khiển giao thông hoặc các tín hiệu đèn không bật sáng thì người tham gia giao thông chỉ được phép đi khi trên đường không còn nguy cơ mất an toàn giao thông.
> c) Để đảm bảo quyền ưu tiên rẽ tại nơi giao nhau cho người tham gia giao thông ưu tiên, đặt trên đường không ưu tiên biển số R.122 kèm theo biển số S.506b "Hướng đường ưu tiên" bên dưới. Biển có hiệu lực bắt buộc người tham gia giao thông trên đường không ưu tiên phải nhường đường (trừ các xe được quyền ưu tiên theo quy định) cho xe trên đường ưu tiên được đi trước qua vị trí giao nhau.
> d) Khi tầm nhìn tại nơi đường giao nhau không đảm bảo, cần bố trí biển số R.122 kết hợp với biển phụ ghi chữ “Dừng lại quan sát” và vạch sơn gờ giảm tốc trên đường không ưu tiên."

**Trích nguyên văn — Phụ lục D, mục D.1a (tr. 33–35):**

> "a) Để báo cho các loại xe (thô sơ và cơ giới) phải đi theo hướng quy định, đặt một trong những kiểu biển số R.301(a,b,c,d,e,f,g,h) "Hướng đi phải theo". Tùy theo hướng đi mà chọn kiểu biển cho phù hợp.
> b) Biển có hiệu lực bắt buộc các loại xe phải đi theo hướng mũi tên chỉ (trừ xe được quyền ưu tiên theo quy định):
> - Biển số R.301a: các xe chỉ được đi thẳng;
> - Biển số R.301b: các xe chỉ được rẽ phải;
> - Biển số R.301c: các xe chỉ được rẽ trái;
> - Biển số R.301d: các xe chỉ được rẽ phải;
> - Biển số R.301e: các xe chỉ được rẽ trái;
> - Biển số R.301f: các xe chỉ được đi thẳng và rẽ phải;
> - Biển số R.301g: các xe chỉ được đi thẳng và rẽ trái;
> - Biển số R.301h: các xe chỉ được rẽ trái và rẽ phải."

**Trích nguyên văn — Phụ lục D, mục D.3 (tr. 36):**

> "a) Để báo cho các loại xe (thô sơ và cơ giới) phải chạy vòng theo đảo an toàn ở nơi đường giao nhau phải đặt biển số R.303 "Nơi giao nhau chạy theo vòng xuyến".
> b) Biển có hiệu lực bắt buộc các loại xe muốn chuyển hướng phải chạy vòng theo đảo an toàn theo hướng mũi tên."

**Trích nguyên văn — Phụ lục D, mục D.6 (tr. 37):**

> "a) Để báo tốc độ tối thiểu cho phép các xe cơ giới chạy, đặt biển số R.306 "Tốc độ tối thiểu cho phép".
> b) Biển có hiệu lực bắt buộc các loại xe cơ giới vận hành với tốc độ không nhỏ hơn trị số ghi trên biển trong điều kiện giao thông thuận lợi và an toàn. Các loại xe có tốc độ tối đa theo quy định của nhà sản xuất không đạt tốc độ tối thiểu đã ghi trên biển không được phép đi vào đường này.
> c) Trị số ghi trên biển chỉ tốc độ tối thiểu cho phép tính bằng km/h và được quy định tùy theo tiêu chuẩn kỹ thuật của cầu đường và tổ chức giao thông, không được quy định trị số lớn hơn trị số an toàn.
> d) Kiểu biển này chỉ áp dụng trên những đoạn đường cần nâng cao năng lực thông xe, ở ngoài khu đông dân cư, xe chạy với tốc độ cao."

### 6.2. Nhóm biển báo nguy hiểm và cảnh báo (W)

| Mã | Tên | Ý nghĩa cốt lõi | Trang |
|---|---|---|---|
| **W.205(a–e)** | Đường giao nhau | Báo trước nơi giao nhau cùng mức của các tuyến cùng cấp (không đường nào ưu tiên) | 17 |
| **W.206** | Giao nhau chạy theo vòng xuyến | Báo trước nơi giao nhau có đảo an toàn, phải đi vòng quanh đảo theo chiều mũi tên | 17 |
| **W.209** | Giao nhau có tín hiệu đèn | Báo trước nơi giao nhau điều khiển bằng đèn tín hiệu khi khó quan sát; có thể dùng bổ sung/thay thế W.205–W.208 | 19 |
| **W.210** | Giao nhau với đường sắt có rào chắn | Báo trước chỗ giao đường bộ – đường sắt có rào chắn (cần chắn/giàn chắn) | 19 |
| **W.211** | Giao nhau với đường sắt không có rào chắn | Báo trước chỗ giao đường bộ – đường sắt **không rào chắn, không người điều khiển**; đặt kèm W.242(a,b) cách ray ngoài cùng 10 m | 20 |
| **W.219** | Dốc xuống nguy hiểm | Báo trước đoạn xuống dốc nguy hiểm; số ghi = độ dốc thực tế % (làm tròn) | 22 |
| **W.220** | Dốc lên nguy hiểm | Báo trước đoạn lên dốc nguy hiểm; số ghi = độ dốc thực tế % | 23 |
| **W.224** | Đường người đi bộ cắt ngang | Báo trước phần đường dành cho người đi bộ sang ngang; phải giảm tốc, nhường ưu tiên cho người đi bộ | 24 |
| **W.242(a,b)** | Nơi đường sắt giao vuông góc với đường bộ | Bổ sung cho W.211: a = 1 cặp ray; b = từ 2 cặp ray trở lên; đặt cách ray gần nhất 10 m | 30 |

**Trích nguyên văn — Phụ lục C, mục C.9 (tr. 19):**

> "a) Để báo trước nơi giao nhau có điều khiển giao thông bằng tín hiệu đèn trong trường hợp người tham gia giao thông khó quan sát thấy đèn để kịp thời xử lý, đặt biển số W.209 "Giao nhau có tín hiệu đèn". Trường hợp dễ dàng nhận biết đèn tín hiệu thì không nên đặt biển số W.209.
> b) Biển số W.209 có thể được dùng bổ sung hoặc thay thế cho các biển số W.205, W.206, W.207, W.208."

**Trích nguyên văn — Phụ lục C, mục C.11 (tr. 20):**

> "a) Để báo trước sắp đến chỗ giao nhau giữa đường bộ và đường sắt không có rào chắn, không có người điều khiển giao thông, đặt biển số W.211 "Giao nhau với đường sắt không có rào chắn".
> b) Trong trường hợp có từng đoạn đường bộ và đường sắt cùng đi chung với nhau, như cầu đi chung, đặt một trong hai biển số W.210 hoặc W.211 cho phù hợp với thực tế có hay không có rào chắn.
> c) Nơi đặt biển số W.211, đặt thêm biển số W.242(a,b) "Nơi đường sắt giao nhau vuông góc với đường bộ" đặt cách ray ngoài cùng của đường sắt là 10 m."

**Trích nguyên văn — Phụ lục C, mục C.19 (tr. 22):**

> "a) Để báo trước sắp tới đoạn đường xuống dốc nguy hiểm, đặt biển số W.219 "Dốc xuống nguy hiểm".
> b) Con số ghi trong biển chỉ độ dốc thực tế tính bằng % làm tròn không có số thập phân.
> Chiều dài của đoạn dốc được chỉ dẫn bằng biển số S.501 "Phạm vi tác dụng của biển" đặt bên dưới biển chính.
> c) Những vị trí xuống dốc nguy hiểm là:
> - Độ dốc từ 6% trở lên và chiều dài dốc trên 600 m;
> - Độ dốc từ 10% trở lên và chiều dài dốc trên 140 m;
> Người lái các phương tiện phải lựa chọn phương thức chạy xe cho phù hợp để xe xuống dốc một cách thuận lợi, an toàn."

**Trích nguyên văn — Phụ lục C, mục C.20 (tr. 23):**

> "a) Để báo trước sắp tới đoạn đường lên dốc nguy hiểm, đặt biển số W.220 "Dốc lên nguy hiểm".
> b) Con số ghi trong biển chỉ độ dốc thực tế tính bằng %, làm tròn đến %.
> Chiều dài của đoạn dốc được chỉ dẫn bằng biển số S.501 "Phạm vi tác dụng của biển" đặt bên dưới biển chính.
> c) Những vị trí lên dốc nguy hiểm là:
> - Độ dốc từ 6% trở lên và chiều dài dốc trên 600 m;
> - Độ dốc từ 10% trở lên và chiều dài dốc trên 140 m;
> Người lái các phương tiện phải lựa chọn phương thức chạy xe cho phù hợp để xe lên dốc một cách thuận lợi, an toàn."

**Trích nguyên văn — Phụ lục C, mục C.24 (tr. 24):**

> "a) Để báo trước sắp tới phần đường dành cho người đi bộ sang qua đường, đặt biển số W.224 "Đường người đi bộ cắt ngang". Gặp biển này các xe phải giảm tốc độ, nhường ưu tiên cho người đi bộ và chỉ được chạy xe khi không gây nguy hiểm cho người đi bộ.
> b) Phần đường dành cho người đi bộ cắt ngang tại nơi đường giao nhau, trong nội thành, nội thị nơi người qua lại nhiều phải được sơn kẻ vạch đường dành cho người đi bộ.
> c) Không cần phải đặt biển này tại các đoạn đường qua khu đông dân cư nếu người tham gia giao thông dễ thấy được phần đường sang ngang của người đi bộ, khi tốc độ hạn chế tối đa dưới 50 km/h hoặc tại vị trí này có hệ thống đèn điều khiển giao thông."

**Trích nguyên văn — Phụ lục C, mục C.6 (tr. 17):**

> "Để báo trước nơi giao nhau có bố trí đảo an toàn ở giữa nút giao, các loại xe qua nút giao phải đi vòng xuyến quanh đảo an toàn theo chiều mũi tên, đặt biển số W.206 "Giao nhau chạy theo vòng xuyến". Trong nội thành, nội thị có thể không đặt biển này."

### 6.3. Nhóm biển báo cấm (P) và biển hết cấm (DP)

| Mã | Tên | Ý nghĩa cốt lõi | Trang |
|---|---|---|---|
| **P.123a / P.123b** | Cấm rẽ trái / Cấm rẽ phải | Cấm rẽ theo hướng mũi tên; **không có giá trị cấm quay đầu** | 4 |
| **P.124(a,b)** | Cấm quay đầu xe / Cấm ô tô quay đầu xe | Cấm quay đầu kiểu chữ U; a = mọi xe, b = ô tô & xe máy 3 bánh; không cấm rẽ trái | 4 |
| **P.124(c,d,e,f)** | Cấm rẽ trái/phải và quay đầu (c,d); cấm ô tô rẽ trái/phải và quay đầu (e,f) | Kết hợp cấm rẽ + quay đầu | 4 |
| **P.125** | Cấm vượt | Cấm mọi xe cơ giới vượt nhau (kể cả xe ưu tiên); **được phép vượt xe máy 2 bánh, xe gắn máy** | 5 |
| **P.126** | Cấm xe ô tô tải vượt | Cấm ô tô tải > 3.500 kg (kể cả xe ưu tiên) vượt xe cơ giới khác; được vượt xe máy 2 bánh, xe gắn máy | 5 |
| **P.127** | Tốc độ tối đa cho phép | Cấm xe cơ giới chạy vượt trị số ghi trên biển, trừ xe ưu tiên | 6–8 |
| **P.127a** | Tốc độ tối đa cho phép về ban đêm | Chỉ hiệu lực trong thời gian ghi trên biển; tối đa không quá 80 km/h | 8–9 |
| **P.127b / P.127c** | Biển ghép tốc độ tối đa theo làn / theo phương tiện trên từng làn | Xe chạy làn nào phải theo tốc độ làn đó | 9–10 |
| **DP.127** | Hết tốc độ tối đa cho phép theo biển ghép | Hết hiệu lực P.127b/c | 10 |
| **P.130** | Cấm dừng xe và đỗ xe | Cấm dừng và đỗ ở phía đường có biển, trừ xe ưu tiên; hiệu lực từ biển đến nơi giao nhau hoặc vị trí quy định dừng/đỗ | 11 |
| **P.131(a,b,c)** | Cấm đỗ xe | a = cấm đỗ; b = cấm đỗ ngày lẻ; c = cấm đỗ ngày chẵn | 11–12 |
| **DP.133 / DP.134 / DP.135** | Hết cấm vượt / Hết tốc độ tối đa / Hết tất cả các lệnh cấm | Kết thúc hiệu lực các biển tương ứng | 12–13 |

**Trích nguyên văn — Phụ lục B, mục B.23 (tr. 4):**

> "a) Để báo cấm rẽ trái hoặc rẽ phải (theo hướng mũi tên chỉ) ở những vị trí đường giao nhau, đặt biển số P.123a "Cấm rẽ trái" hoặc biển số P.123b "Cấm rẽ phải". Biển không có giá trị cấm quay đầu xe.
> b) Biển có hiệu lực cấm các loại xe (cơ giới và thô sơ) rẽ sang phía trái hoặc phía phải trừ các xe được ưu tiên theo quy định."

**Trích nguyên văn — Phụ lục B, mục B.24 (tr. 4–5):**

> "a) Để báo cấm các loại xe quay đầu (theo kiểu chữ U), đặt biển số P.124a "Cấm quay đầu xe". Chiều mũi tên phù hợp với chiều cấm quay đầu xe.
> b) Để báo cấm xe ô tô quay đầu (theo kiểu chữ U), đặt biển số P.124b "Cấm ô tô quay đầu xe". Chiều mũi tên phù hợp với chiều cấm xe ô tô quay đầu.
> c) Để báo cấm các loại xe rẽ trái đồng thời cấm quay đầu, đặt biển số P.124c “Cấm rẽ trái và quay đầu xe”.
> d) Để báo cấm các loại xe rẽ phải đồng thời cấm quay đầu, đặt biển số P.124d “Cấm rẽ phải và quay đầu xe”.
> e) Để báo cấm xe ô tô rẽ trái và đồng thời cấm quay đầu, đặt biển số P.124e “Cấm ô tô rẽ trái và quay đầu xe”.
> f) Để báo cấm xe ô tô rẽ phải và đồng thời cấm quay đầu, đặt biển số P.124f “Cấm ô tô rẽ phải và quay đầu xe”.
> g) Biển số P.124a có hiệu lực cấm các loại xe (cơ giới và thô sơ) và biển số P.124b có hiệu lực cấm xe ô tô và xe máy 3 bánh (side car) quay đầu (theo kiểu chữ U) trừ các xe được ưu tiên theo quy định.
> Biển không có giá trị cấm rẽ trái để đi sang hướng đường khác."

**Trích nguyên văn — Phụ lục B, mục B.25 (tr. 5):**

> "a) Để báo cấm các loại xe cơ giới vượt nhau, đặt biển số P.125 "Cấm vượt".
> b) Biển có hiệu lực cấm tất cả các loại xe cơ giới vượt nhau (kể cả xe được ưu tiên theo quy định) nhưng được phép vượt xe máy 2 bánh, xe gắn máy.
> c) Biển hết hiệu lực cấm khi có biển số P.133 "Hết cấm vượt" hoặc đến vị trí đặt biển số P.135 "Hết tất cả các lệnh cấm" nếu đồng thời có nhiều biển cấm khác hết tác dụng."

**Trích nguyên văn — Phụ lục B, mục B.27 (tr. 6–10):**

> "a) Để báo tốc độ tối đa cho phép các xe cơ giới chạy, đặt biển số P.127 "Tốc độ tối đa cho phép";
> b) Biển có hiệu lực cấm các loại xe cơ giới chạy với tốc độ tối đa vượt quá trị số ghi trên biển trừ các xe được ưu tiên theo quy định. Người điều khiển phương tiện căn cứ vào điều kiện cụ thể khác như khí hậu thời tiết tình trạng mặt đường, tình hình giao thông, phương tiện, điều kiện sức khỏe để điều khiển phương tiện với tốc độ phù hợp, an toàn và không quá giá trị ghi trên biển;
> c) Số ghi trên biển tốc độ tối đa cho phép tính bằng km/h và tùy theo tiêu chuẩn kỹ thuật hoặc điều kiện khai thác thực tế của đường mà quy định cho phù hợp. Khi không có các nghiên cứu cụ thể, có thể tham khảo toán đồ trên Hình B.27a để xác định giá trị tốc độ tối đa cho phép cho từng hướng đường;
> d) Không sử dụng biển số P.127 một cách tràn lan khi không có nghiên cứu cụ thể;"

**Trích nguyên văn — Phụ lục B, mục B.30 (tr. 11):**

> "a) Để báo nơi cấm dừng xe và đỗ xe, đặt biển số P.130 "Cấm dừng xe và đỗ xe". Biển có hiệu lực cấm các loại xe cơ giới dừng và đỗ ở phía đường có đặt biển trừ các xe được ưu tiên theo quy định. Đối với các loại xe ô tô buýt chạy theo hành trình quy định được hướng dẫn vị trí dừng thích hợp.
> b) Hiệu lực cấm của biển bắt đầu từ vị trí đặt biển đến nơi đường giao nhau hoặc đến vị trí quy định đỗ xe, dừng xe (hoặc đến vị trí đặt biển số DP.135 "Hết tất cả các lệnh cấm" nếu đồng thời có nhiều biển cấm khác hết tác dụng)."

**Trích nguyên văn — Phụ lục B, mục B.31 (tr. 11–12):**

> "a) Để báo nơi cấm đỗ xe trừ các xe được ưu tiên theo quy định, đặt biển số P.131 (a, b, c) "Cấm đỗ xe".
> Biển số P.131a có hiệu lực cấm các loại xe cơ giới đỗ ở phía đường có đặt biển.
> Biển số P.131b có hiệu lực cấm các loại xe cơ giới đỗ ở phía đường có đặt biển vào những ngày lẻ và biển số P.131c vào những ngày chẵn.
> b) Hiệu lực cấm và thời gian cấm đỗ xe áp dụng theo quy định tại điểm b, c mục B.30 đối với biển số P.130.
> c) Trong phạm vi có hiệu lực của biển, nếu có chỗ mở dải phân cách cho phép xe quay đầu thì cần đặt thêm biển nhắc lại."

### 6.4. Nhóm biển chỉ dẫn (I) — liên quan bãi đỗ, nơi đỗ

| Mã | Tên | Ý nghĩa cốt lõi | Trang |
|---|---|---|---|
| **I.408** | Nơi đỗ xe | Chỉ dẫn nơi được phép đỗ xe, bãi đỗ, bến xe; chiều dài có thể xác định bằng vạch kẻ hoặc hình dáng bãi; hết hiệu lực 10 m trước nơi giao nhau tiếp theo | 52 |
| **I.408a** | Nơi đỗ xe một phần trên hè phố | Đỗ sao cho các bánh phía ghế phụ trên hè phố | 53 |
| **I.409** | Chỗ quay xe | Chỉ dẫn vị trí được phép quay đầu | 53 |
| **I.410** | Khu vực quay xe | Chỉ dẫn khu vực được phép quay đầu, mô tả cách thức quay | 53 |
| **I.446** | Nơi đỗ xe dành cho người khuyết tật | Đặt kèm P.131a và I.408 | 69 |

**Trích nguyên văn — Phụ lục E, mục E.8 (tr. 52):**

> "a) Để chỉ dẫn những nơi được phép đỗ xe, những bãi đỗ xe, bến xe, v.v..., đặt biển số I.408 "Nơi đỗ xe".
> b) Chiều dài nơi đỗ xe có thể được xác định giới hạn bằng vạch kẻ trên mặt đường hoặc bãi đỗ có hình dáng rõ ràng. Phạm vi quy định đỗ xe sẽ hết hiệu lực 10 m trước khi đến nơi đường giao nhau tiếp theo; khi cần thiết, có thể đặt thêm biển phụ chỉ hiệu lực của vùng cho phép đỗ xe."

**Trích nguyên văn — Phụ lục E, mục E.8a (tr. 52–53):**

> "a) Để chỉ dẫn những nơi được phép đỗ xe một phần trên hè phố rộng, đặt biển số I.408a "Nơi đỗ xe một phần trên hè phố". Xe phải đỗ sao cho các bánh phía ghế phụ trên hè phố.
> b) Mặt biển có thể theo chiều hướng đi hoặc đặt song song và có hiệu lực từ vị trí đặt biển. Chiều dài nơi đỗ xe có thể được xác định giới hạn bằng vạch kẻ trên mặt đường. Khi cần thiết có thể đặt thêm biển phụ chỉ hiệu lực của vùng cho phép đỗ."

### 6.5. Biển phụ dùng thường xuyên trong sa hình

| Mã | Tên | Dùng cho |
|---|---|---|
| **S.501** | Phạm vi tác dụng của biển | Ghi chiều dài đoạn nguy hiểm / đoạn cấm |
| **S.502** | Khoảng cách đến đối tượng báo hiệu | Khi biển đặt xa vị trí cần báo |
| **S.503(a–f)** | Hướng tác dụng của biển | Chỉ hướng / vị trí bắt đầu – kết thúc hiệu lực |
| **S.505a/b/c** | Loại xe; loại xe hạn chế qua cầu; tải trọng trục hạn chế qua cầu | Biển phụ cho P.106/P.115/P.116 |
| **S.506(a,b)** | Hướng đường ưu tiên | Đặt dưới I.401 hoặc W.208/R.122 |
| **S.507** | Hướng rẽ | Đặt độc lập, cao 1,2–1,5 m |
| **S.508(a,b)** | Biểu thị thời gian | Cấm theo giờ/ngày |
| **S.509(a,b)** | Thuyết minh biển chính | Ghi "Lối vào"/"Lối ra" cho P.127 |

**Trích nguyên văn — Điều 41 khoản 41.1–41.2 (tr. 37–38):**

> "41.1. Tác dụng của biển phụ:
> Biển phụ thường được đặt kết hợp với các biển báo chính nhằm thuyết minh, bổ sung để hiểu rõ, trừ biển số S.507 "Hướng rẽ" được sử dụng độc lập.
> 41.2. Ý nghĩa sử dụng biển phụ:
> 41.2.1. Biển phụ có mã S, S.G và S.H với tên các biển phổ biến như sau:
> - Biển số S.501: Phạm vi tác dụng của biển;
> - Biển số S.502: Khoảng cách đến đối tượng báo hiệu;
> - Biển số S.503 (a,b,c,d,e,f): Hướng tác dụng của biển;
> - Biển S.H,3 (a,b,c): Hướng tác dụng của biển;
> - Biển số S.504: Làn đường;
> - Biển số S.505a: Loại xe;
> - Biển số S.505b: Loại xe hạn chế qua cầu;
> - Biển số S.505c: Tải trọng trục hạn chế qua cầu;
> - Biển số S.506(a,b): Hướng đường ưu tiên;
> - Biển số S.507: Hướng rẽ;
> - Biển số S.508(a,b): Biểu thị thời gian;
> - Biển số S.509(a,b): Thuyết minh biển chính;
> - Biển số S.510a: Chú ý đường trơn có băng tuyết;
> - Biển số S.510b: Chú ý đường sắt;
> - Biển số S.G,7: Địa điểm cắm trại;
> - Biển số S.G,8: Địa điểm nhà trọ;
> - Biển số S.G,9b: Chỉ dẫn tới điểm đỗ xe dành cho lái xe muốn sử dụng phương tiện công cộng;
> - Biển số S.G,11a; S.G,11c: Chỉ dẫn số lượng làn và hướng đi cho từng làn;
> - Biển số S.G,12a; S.G,12b: Chỉ dẫn làn đường không lưu thông;
> - Biển số S.H,6: Ngoại lệ.
> Ngoài ra, tùy theo các tình huống giao thông khác để có thể bố trí các biển phụ khác cho phù hợp."
>
> "41.3.2. Các biển có nền là màu trắng, hình vẽ và chữ viết màu đen hoặc có nền là màu xanh lam, chữ viết màu trắng. Biển số S.507 và S.508 (a,b) có đặc điểm riêng chỉ dẫn ở Phụ lục F của Quy chuẩn này;"

### 6.6. Đối chiếu với QCVN 15:2026/BCA (trung tâm sát hạch) — biển dùng trong sân

QCVN 15:2026/BCA (ban hành kèm TT 107/2026/TT-BCA, hiệu lực 01/7/2026; một số mục áp dụng từ 01/01/2027 và 01/01/2028) quy định tại khoản 2.1.8 (tr. 5). Các số "tr." trong mục 6.6 là **số trang in trên QCVN 15**, không phải trang Công báo (QCVN 15 chưa thấy đăng Công báo tại thời điểm tra cứu):

> "Đèn tín hiệu giao thông, biển báo hiệu đường bộ, vạch kẻ đường trong sân sát hạch phải bố trí đầy đủ, đúng quy cách, kiểu loại quy định tại Quy chuẩn kỹ thuật quốc gia về báo hiệu đường bộ."

**Các bài sa hình và biển/vạch tương ứng (QCVN 15:2026/BCA, mục 2.1.15):**

| Bài sát hạch | Biển báo | Vạch kẻ |
|---|---|---|
| Xuất phát / Kết thúc | — | "Vạch dừng xe" ngang + chữ "XUẤT PHÁT"/"KẾT THÚC" |
| Dừng xe nhường đường cho người đi bộ | "Dừng lại", "Đường người đi bộ cắt ngang" | "Vạch dừng xe", "Đi bộ qua đường" (dạng vuông góc) |
| Dừng và khởi hành xe trên dốc | "Dừng lại", "Dốc lên nguy hiểm", "Dốc xuống nguy hiểm" | "Vạch dừng xe" cách chân dốc ≥ 6 m (dốc dài 15 m, độ dốc 10 %) |
| Qua ngã tư | "Hướng đi phải theo", "Đường giao nhau", "Giao nhau có tín hiệu đèn" | "Vạch dừng xe", "Đi bộ qua đường" (dạng vuông góc) + hệ thống đèn tín hiệu |
| Qua vệt bánh xe và đường vòng vuông góc | — | Vạch dọc giới hạn vệt bánh xe (Bvb = B1 + 0,2 m; Lvb = a) |
| Qua đường vòng quanh co | — | Không có biển; hình chữ S (Bqc = 2,2b; Rn = Rqv + 1,2 m) |
| Ghép xe dọc vào nơi đỗ (B, C1) | "Nơi đỗ xe" | Không gian Ld = a + 1,0 m; Rd = b + 0,6 m; Ed = 1,2a |
| Ghép xe ngang vào nơi đỗ (B) | "Nơi đỗ xe" | Lg = 3a/2; Rg = 5b/4 |
| Ghép xe ngang vào nơi đỗ (C, D1, D2, D) | "Nơi đỗ xe" | Lg = 5a/3; Rg = 5b/4 |
| Tình huống nguy hiểm | — | 05 vị trí (Trung tâm loại 1) / 03 vị trí (loại 2) |
| Hạng BE, D1E, D2E, DE | — | Tiến qua hình có 05 cọc chuẩn và vòng trở lại |
| Hạng C1E, CE | — | 05 cọc chuẩn + vòng trở lại; ghép xe dọc vào nơi đỗ |
| Tạm dừng ở chỗ có đường sắt chạy qua | "Giao nhau với đường sắt không có rào chắn", "Nơi đường sắt giao vuông góc với đường bộ", "Dừng lại" | "Vạch dừng xe" cách ray ngoài cùng ≥ 5,0 m |
| Thay đổi số trên đường bằng | Biển phụ "Bắt đầu tăng số, tăng tốc độ"; "Bắt đầu giảm số, giảm tốc độ"; "Kết thúc giảm số, giảm tốc độ" | — |

> **Trích nguyên văn — QCVN 15:2026/BCA, mục 2.1.15.2 (tr. 10):**
> "Tại vị trí người đi bộ qua đường kẻ vạch “Vạch dừng xe”, vạch “Đi bộ qua đường” (dạng vuông góc) và lắp các biển báo “Dừng lại” và “Đường người đi bộ cắt ngang” để yêu cầu xe sát hạch dừng xe nhường đường cho người đi bộ."

> **Trích nguyên văn — QCVN 15:2026/BCA, mục 2.1.15.3 (tr. 11):**
> "Trên đường dốc lên có chiều dài 15 m, độ dốc 10 %, cách chân dốc tối thiểu 06 m kẻ vạch “Vạch dừng xe” và lắp biển báo “Dừng lại” để yêu cầu xe sát hạch dừng và khởi hành xe trên dốc và biển báo "Dốc lên nguy hiểm", "Dốc xuống nguy hiểm"."

> **Trích nguyên văn — QCVN 15:2026/BCA, mục 2.1.15.10 (tr. 15):**
> "Trên mặt đường bố trí 02 thanh ray đường sắt, tạo tình huống giả định có đường bộ giao nhau với đường sắt không có rào chắn, không có người điều khiển giao thông; cách ray ngoài cùng của đường sắt tối thiểu 5,0 m kẻ vạch “Vạch dừng xe” và lắp biển báo “Giao nhau với đường sắt không có rào chắn”, biển “Nơi đường sắt giao vuông góc với đường bộ” và biển báo “Dừng lại” để yêu cầu dừng xe sát hạch ở chỗ có đường sắt chạy qua."


### 6.7. Bộ tối thiểu cho bài thi "đường trường" (lái xe trên đường)

Bài sát hạch thực hành lái xe trên đường (hạng B–D) diễn ra trong điều kiện giao thông thực tế; để mô hình hoá đúng cần tối thiểu:

| Nhóm | Mã / đối tượng | Dùng để mô phỏng |
|---|---|---|
| Tốc độ | **P.127** (tối đa), **P.127a** (ban đêm), **R.306** (tối thiểu), **DP.134** | Giới hạn tốc độ theo đoạn đường |
| Dừng / đỗ | **P.130**, **P.131a–c**, **I.408**, **I.408a**, vạch **6.1**, **6.2** | Bài "dừng xe, khởi hành", "ghép xe vào nơi đỗ" |
| Nút giao | **W.205a–e**, **W.206**, **W.207**, **W.208**, **W.209**, **R.301a–h**, **R.303**, vạch **7.1**, **7.2**, **7.3**, đèn tín hiệu | Bài "qua ngã tư", "nhường đường" |
| Đường sắt | **W.210**, **W.211**, **W.242a/b**, vạch **7.1** | Bài "tạm dừng ở chỗ đường sắt" |
| Dốc | **W.219**, **W.220**, **S.501** | Bài "dừng và khởi hành trên dốc" |
| Người đi bộ | **W.224**, **I.423**, vạch **7.3** | Bài "nhường đường cho người đi bộ" |
| Làn / hướng | **R.411**, **R.412a–h**, **R.415**, vạch **2.1**, **2.2**, **2.3**, **3.2**, **3.3**, vạch **9.3**, **9.4** | Chuyển làn, rẽ theo làn |
| Cấm vượt | **P.125**, **P.126**, **DP.133**, vạch **1.2**, **1.3** | Bài "vượt xe" (từ 01/3/2027 theo TT 108) |

---
## 7. Bộ 600 câu hỏi sát hạch GPLX — thông tin văn bản

### 7.1. Văn bản ban hành và hiệu lực

- **Tên bộ:** "600 câu hỏi dùng cho sát hạch lái xe cơ giới đường bộ" (Bộ Công an — Cục Cảnh sát giao thông; Hà Nội – 2025).
- **Văn bản hướng dẫn:** Công văn số **2262/CSGT-P5** ngày **07/5/2025** của Cục Cảnh sát giao thông, "V/v sử dụng bộ 600 câu hỏi dùng để sát hạch lái xe cơ giới đường bộ", ký bởi Trung tướng Nguyễn Văn Trung.
- **Căn cứ pháp lý:** khoản 1 Điều 35 Thông tư số **12/2025/TT-BCA** ngày 28/2/2025 của Bộ trưởng Bộ Công an quy định về sát hạch, cấp giấy phép lái xe; cấp, sử dụng giấy phép lái xe quốc tế. Cụ thể, điểm b khoản 1 Điều 35 giao Cục CSGT *"Xây dựng bộ câu hỏi; phần mềm hệ thống thông tin sát hạch, cấp giấy phép lái xe; phần mềm dùng cho sát hạch lý thuyết; phần mềm mô phỏng các tình huống giao thông…"* — đây là cơ sở để CV 2262 ban hành bộ 600 câu.
- **Thời điểm áp dụng:** từ ngày **01/6/2025** (CV 2262, mục III.1).

> **Quy ước trang cho CV 2262:** Công văn không đăng Công báo, nên các số "tr." trong Mục 7 khi trích CV 2262 là **số trang PDF** của file `cv-2262-csgt-p5.pdf` (6 trang), không phải số trang Công báo.

**Trích nguyên văn — CV 2262/CSGT-P5, mục I.1 và ghi chú (tr. 1):**

> "1. Bố cục bộ 600 câu hỏi:
> 1.1. Chương I: Gồm 180 câu về Quy định chung và quy tắc giao thông đường bộ (từ câu số 1 đến câu số 180).
> 1.2. Chương II: Gồm 25 câu về Văn hóa giao thông, đạo đức người lái xe, kỹ năng phòng cháy, chữa cháy và cứu hộ, cứu nạn (từ câu số 181 đến câu số 205).
> 1.3 Chương III: Gồm 58 câu về Kỹ thuật lái xe (từ câu 206 đến câu 263).
> 1.4. Chương IV: Gồm 37 câu về Cấu tạo và sửa chữa (từ câu 264 đến câu 300).
> 1.5. Chương V: Gồm 185 câu về Báo hiệu đường bộ (từ số 301 đến câu số 485).
> 1.6. Chương VI: Gồm 115 câu về Giải thế sa hình và kỹ năng xử lý tình huống giao thông (từ số 486 đến câu số 600).
> * Ghi chú:
> - Trong bộ 600 câu hỏi có 60 câu hỏi về xử lý tình huống mất an toàn giao thông nghiêm trọng, mỗi đề sát hạch có một câu hỏi về xử lý tình huống mất an toàn giao thông nghiêm trọng, thí sinh lựa chọn đáp án sai tại câu này được tính là điểm liệt, bài thi lý thuyết sẽ không đạt yêu cầu (danh sách 60 câu hỏi tại Phụ lục III Công văn này).
> - Phần đáp án đúng là phần gạch chân dưới câu hỏi."

**Trích nguyên văn — CV 2262/CSGT-P5, mục III.1–2 (tr. 3):**

> "1. Bộ 600 câu hỏi dùng cho sát hạch lái xe cơ giới đường bộ được áp dụng từ ngày 01 tháng 6 năm 2025.
> 2. Cục Cảnh sát giao thông xây dựng, sửa đổi phần mềm sát hạch lý thuyết trên máy vi tính đối với sát hạch lái xe ô tô và mô tô các hạng; chuyển giao cho các Phòng Cảnh sát giao thông và các Trung tâm sát hạch lái xe sử dụng thống nhất trên phạm vi cả nước."

### 7.2. Cấu trúc 6 chương

| Chương | Nội dung | Số câu | Khoảng câu |
|---|---|---|---|
| I | Quy định chung và quy tắc giao thông đường bộ | **180** | 1–180 |
| II | Văn hóa giao thông, đạo đức người lái xe, kỹ năng phòng cháy, chữa cháy và cứu hộ, cứu nạn | **25** | 181–205 |
| III | Kỹ thuật lái xe | **58** | 206–263 |
| IV | Cấu tạo và sửa chữa | **37** | 264–300 |
| V | Báo hiệu đường bộ | **185** | 301–485 |
| VI | Giải thế sa hình và kỹ năng xử lý tình huống giao thông | **115** | 486–600 |
| **Tổng** | | **600** | 1–600 |

### 7.3. 60 câu hỏi "điểm liệt" — Phụ lục 3 CV 2262/CSGT-P5

**Danh sách đầy đủ (60 số hiệu câu):**

```
19  20  21  22  23  24  25  26  27  28
30  32  34  35  47  48  52  53  55  58
63  64  65  66  67  68  70  71  72  73
74  85  86  87  88  89  90  91  92  93
97  98  102 117 163 165 167 197 198 206
215 226 234 245 246 252 253 254 255 260
```

- **Phân bố theo chương:** Chương I: 47 câu; Chương II: 2 câu (197, 198); Chương III: 11 câu (206, 215, 226, 234, 245, 246, 252, 253, 254, 255, 260); Chương IV–VI: 0 câu.
- **Quy tắc:** mỗi đề sát hạch có đúng **01 câu** thuộc nhóm này; chọn sai ⇒ **điểm liệt** ⇒ bài lý thuyết không đạt, bất kể các câu khác đúng.

**Trích nguyên văn — CV 2262/CSGT-P5, Phụ lục 3 (tr. 6):**

> "60 CÂU HỎI XỬ LÝ TÌNH HUỐNG MẤT ATGT NGHIÊM TRỌNG ĐƯỢC LỰA CHỌN TỪ BỘ 600 CÂU HỎI
> (Kèm theo văn bản số 2262/CSGT-P5 ngày 07 tháng 5 năm 2025)"

**Các bộ con theo hạng (CV 2262 mục I.2):**

| Hạng áp dụng | Số câu dùng | Số câu "điểm liệt" | Phụ lục |
|---|---|---|---|
| B, C1, C, D1, D2, D và BE, C1E, CE, D1E, D2E, DE | 600 | 60 | — |
| B1 | 300 (chọn từ 600) | 30 | Phụ lục 2 |
| A1, A | 250 (chọn từ 600) | 20 | Phụ lục 1 |

### 7.4. Cấu trúc đề sát hạch theo CV 2262/CSGT-P5 (áp dụng từ 01/6/2025, nền TT 12/2025)

**Trích nguyên văn — CV 2262/CSGT-P5, mục II.1 (tr. 2) — ví dụ hạng B:**

> "1. Bộ đề sát hạch cấp Giấy phép lái xe ô tô hạng B gồm 30 câu hỏi được chọn ngẫu nhiên trong bộ 600 câu hỏi, trong đó: 08 câu về một số quy định chung và quy tắc giao thông đường bộ; 01 câu hỏi về tình huống mất an toàn giao thông nghiêm trọng; 01 câu về văn hóa giao thông, đạo đức người lái xe, kỹ năng phòng cháy, chữa cháy và cứu hộ, cứu nạn; 01 câu về kỹ thuật lái xe; 01 câu về cấu tạo và sửa chữa; 09 câu về báo hiệu đường bộ; 09 câu về giải thế sa hình và kỹ năng xử lý tình huống giao thông."

| Hạng | Tổng câu | Quy định chung | Tình huống mất ATGT nghiêm trọng | Văn hóa GT | Kỹ thuật lái xe | Cấu tạo – sửa chữa | Báo hiệu đường bộ | Giải thế sa hình |
|---|---|---|---|---|---|---|---|---|
| **B** | 30 | 8 | 1 | 1 | 1 | 1 | 9 | 9 |
| **C1** | 35 | 10 | 1 | 1 | 2 | 1 | 10 | 10 |
| **C** | 40 | 10 | 1 | 1 | 2 | 1 | 14 | 11 |
| **D1, D2, D và BE, C1E, CE, D1E, D2E, DE** | 45 | 10 | 1 | 1 | 2 | 1 | 16 | 14 |
| **A1, A, B1** | 25 | 8 | 1 | 1 | 1 (kỹ thuật **hoặc** cấu tạo — chỉ 1 câu cho cả hai nội dung) | — | 8 | 6 |

### 7.5. Điều kiện đạt và thời gian — TT 12/2025/TT-BCA (áp dụng đến 28/02/2027)

**Trích nguyên văn — TT 12/2025/TT-BCA, Phụ lục IV mục II.2.1–2.2 (đối với hạng B–D; bảng số liệu nằm giữa hai khoản được trình bày lại ngay dưới):**

> "2.1. Đề sát hạch có số lượng câu hỏi và thời gian làm bài như sau:
> 2.2. Mỗi câu hỏi được tính 01 điểm và mỗi đề thi có 01 câu hỏi nếu lựa chọn đáp án sai được tính là điểm liệt; mỗi câu có từ 02 đến 04 ý trả lời, thí sinh đọc đề bài và lựa chọn ra đáp án đúng nhất. Trường hợp bị điểm liệt trong bài thi thì không đạt nội dung sát hạch Lý thuyết."

**Bảng tóm tắt (đọc từ bảng số liệu trong văn bản):**

| Hạng | Số câu | Thời gian (phút) | Điểm đạt tối thiểu | Câu "điểm liệt" |
|---|---|---|---|---|
| A1 | 25 | 19 | ≥ 21/25 | 1 |
| A | 25 | 19 | ≥ 23/25 | 1 |
| B1 | 25 | 19 | ≥ 23/25 | 1 |
| B | 30 | 20 | ≥ 27/30 | 1 |
| C1 | 35 | 22 | ≥ 32/35 | 1 |
| C | 40 | 24 | ≥ 36/40 | 1 |
| D1, D2, D | 45 | 26 | ≥ 41/45 | 1 |

### 7.6. Thay đổi từ TT 108/2026/TT-BCA (hiệu lực 01/7/2026; nội dung lý thuyết áp dụng 01/3/2027)

**Trích nguyên văn — TT 108/2026/TT-BCA, Điều 41 khoản 1–2, 6 (tr. 37–38 Công báo 429):**

> "1. Thông tư này có hiệu lực thi hành từ ngày 01 tháng 7 năm 2026, trừ trường hợp quy định tại khoản 2, khoản 3, khoản 4, khoản 5 Điều này.
> 2. Nội dung sát hạch lý thuyết, sát hạch thực hành lái xe trong hình, sát hạch thực hành lái xe trên đường quy định tại khoản 4 Điều 4 Thông tư này áp dụng từ ngày 01 tháng 3 năm 2027; nội dung bài sát hạch số 2 quy định tại khoản 4 Điều 4 và Phụ lục I ban hành kèm theo Thông tư này áp dụng từ ngày 01 tháng 01 năm 2028.
> 6. Thông tư số 12/2025/TT-BCA ngày 28 tháng 02 năm 2025 của Bộ trưởng Bộ Công an quy định về sát hạch, cấp giấy phép lái xe; cấp, sử dụng giấy phép lái xe quốc tế hết hiệu lực kể từ ngày Thông tư này có hiệu lực thi hành, trừ các trường hợp quy định tại khoản 1, khoản 2, khoản 3 Điều 4, Phụ lục II, Phụ lục III, mục A, C, mẫu số 01, 02, 03 mục D Phụ lục IV, mục A, C, mẫu số 01, 02, 03 mục D Phụ lục V, mục A, C, mẫu số 01, 02, 03 mục D Phụ lục VI ban hành kèm theo Thông tư số 12/2025/TT-BCA tiếp tục có hiệu lực thi hành đến hết ngày 28 tháng 02 năm 2027."

**Trích nguyên văn — TT 108/2026/TT-BCA, Phụ lục III mục A.II.3.1–3.2 và III.1 (tr. 56–57 Công báo 429; bảng số liệu nằm giữa hai khoản được trình bày lại ngay dưới):**

> "3.1. Đề sát hạch có số lượng câu hỏi và thời gian làm bài như sau:
> 3.2. Mỗi câu hỏi được tính 01 điểm."
>
> "1. Điểm đạt yêu cầu, theo bảng sau"

**Bảng tóm tắt (đọc từ bảng số liệu trong văn bản):**

| Hạng | Số câu | Thời gian (phút) | Điểm đạt tối thiểu |
|---|---|---|---|
| B | 50 | 33 | ≥ 45/50 |
| C1 | 60 | 40 | ≥ 54/60 |
| C | 70 | 47 | ≥ 63/70 |
| D1, D2, D | 80 | 53 | ≥ 72/80 |
| B1 | 50 | 33 | ≥ 45/50 |
| A1, A | 40 | 27 | ≥ 36/40 |

- **Hạng A1 thi trên giấy (người dân tộc thiểu số không biết đọc, viết tiếng Việt):** 30 câu, 60 phút, đạt ≥ 27/30 (TT 108/2026, Phụ lục I mục A.II.2.3 và 3.1).
- **Bãi bỏ thành phần "sát hạch mô phỏng":** TT 108/2026 không còn quy định sát hạch bằng phần mềm mô phỏng (từ khoá "mô phỏng" xuất hiện **0 lần** trong toàn văn TT 108/2026, so với **30 lần** trong TT 12/2025). Điều 4 TT 108/2026 chỉ còn 3 nội dung: lý thuyết, thực hành trong hình, thực hành trên đường.
- **Không còn cụm "điểm liệt":** từ khoá "liệt" xuất hiện **0 lần** trong TT 108/2026 (so với **12 lần** trong TT 12/2025 và nhiều lần trong CV 2262). Xem phân tích tại Mục 8.

### 7.7. Định dạng đề và đáp án

**Trích nguyên văn — TT 12/2025/TT-BCA, Phụ lục II mục A.II.2.2 điểm c (thi trên giấy, hạng A1) (tr. 3 in trong Phụ lục II):**

> "c) Ý trả lời của thí sinh chỉ được đánh dấu bằng dấu nhân (x) trong ô tương ứng; những trường hợp đánh dấu nhân vào 02 ô trở lên trên một cột hoặc tẩy xoá đều bị coi là trả lời sai; không được dùng bút có mực màu đỏ hoặc bút chì để đánh dấu trả lời câu hỏi sát hạch."


- **Định dạng câu hỏi:** trắc nghiệm, mỗi câu có **02–04 ý trả lời**, thí sinh chọn **01 đáp án đúng nhất** — quy định tại TT 12/2025 (Phụ lục II, III, IV). TT 108/2026 **không nhắc lại** quy định số ý trả lời trong các Phụ lục I–III (chỉ nêu số câu và cách tính điểm), nên đây là một điểm cần theo dõi.
- **Định dạng đáp án trong bộ 600 câu (bản PDF chính thức):** đáp án đúng được **gạch chân** ngay dưới dòng của ý trả lời đúng.
  - Kiểm chứng kỹ thuật: lớp text của PDF **không** chứa ký tự đánh dấu; gạch chân là **đường vector** (path) phía dưới dòng chữ. Đã trích xuất toạ độ path và đối chiếu với toạ độ word (ví dụ Câu 1 — đáp án là ý **2. "Phần đường xe chạy."**; Câu 204 — đáp án là ý **4. "Cả ba ý trên."**).
  - Hệ quả: nếu chỉ `pdftotext` thông thường sẽ **mất toàn bộ đáp án**. Cần OCR/hình ảnh hoặc trích path như mô tả ở trên.
- **Định dạng câu hỏi trong PDF:** "Câu N." (riêng **Câu 507** dùng dấu hai chấm "Câu 507:" — lỗi định dạng nhỏ, không ảnh hưởng nội dung).
- **Đếm và kiểm tra:** PDF có **188 trang**, tạo ngày **19/5/2025**; có đúng **600** tiêu đề "Câu N."; **không thiếu, không trùng** số câu (1–600).

### 7.8. Nguồn tải chính thức

| Tài liệu | URL | SHA-256 (đầy đủ) |
|---|---|---|
| Bộ 600 câu hỏi (PDF) | `https://csgtmedia.bocongan.gov.vn/upload/services/725823572_600 câu hỏi dùng cho sát hạch GPLX cơ giới đường bộ.pdf` | `6a6dab8543eb334b36ac9de6abcd938e864f2e0e915be27c3a2157ee6e518575` |
| CV 2262/CSGT-P5 (PDF) | `https://csgtmedia.bocongan.gov.vn/upload/services/2071319603_Hướng dẫn sử dụng bộ câu hỏi sát hạch GPLX (CV 2262.07.5.2025).pdf` | `dcb0b42473a23af3b006ed07cfd3a728254eb3d5263f6a26d0536c576d69e634` |
| Trang danh mục | `https://csgt.bocongan.gov.vn/van-ban/bo-600-cau-hoi-dung-cho-sat-hach-lai-xe-co-gioi-duong-bo` | — |

> **Lưu ý ngày đăng:** trên trang danh mục văn bản của CSGT, mục "Bộ 600 câu hỏi" được ghi ngày **05/05/2026**, trong khi PDF nội bộ đề "Hà Nội – 2025" và metadata tạo ngày 19/5/2025. Đây là ngày **đăng lại/cập nhật danh mục**, không phải ngày ban hành văn bản.

### 7.9. Quyền sử dụng lại (licensing)

- Trang Cổng Thông tin điện tử Bộ Công an ghi: *"Bản quyền thuộc về Bộ Công an. Khi sử dụng lại thông tin, đề nghị ghi rõ nguồn 'Cổng Thông tin điện tử Bộ Công an'"*.
- Trang CSGT ghi: *"Copyright by Bộ Công An - Cục Cảnh sát giao thông"*.
- **Không có giấy phép mở** (không CC BY, không OGL…) được công bố kèm bộ câu hỏi. Khi dùng lại trong sản phẩm/simulator cần: (i) ghi rõ nguồn "Cục Cảnh sát giao thông – Bộ Công an"; (ii) không tuyên bố là bản chính thức; (iii) kiểm tra lại điều khoản tại thời điểm phát hành.

### 7.10. Trạng thái bộ câu hỏi cho kỳ sát hạch từ 01/3/2027

- TT 108/2026/TT-BCA **không ban hành kèm bộ câu hỏi**; Điều 36 khoản 1 điểm b chỉ giao Cục CSGT *"Xây dựng bộ câu hỏi; phần mềm hệ thống thông tin sát hạch, cấp giấy phép lái xe; phần mềm dùng cho sát hạch lý thuyết để phục vụ công tác sát hạch lái xe, hướng dẫn thực hiện thống nhất trong cả nước và chuyển giao cho Phòng Cảnh sát giao thông"*.
- **Tính đến 25/10/2026:** chưa có văn bản/bộ câu hỏi mới nào được công bố cho nội dung lý thuyết áp dụng từ **01/3/2027**. Trang CSGT vẫn chỉ có "Bộ 600 câu hỏi" (Hà Nội – 2025).
- **Khuyến nghị cho simulator:** tiếp tục dùng bộ 600 câu hiện hành cho đến khi có bộ mới; thiết kế lớp dữ liệu tách rời (câu hỏi/đáp án/nhóm điểm liệt) để thay thế dễ dàng.

---
## 8. Mâu thuẫn & chưa rõ

> Mỗi mục dưới đây ghi: **hiện tượng** → **nguồn** → **ảnh hưởng** → **hướng xử lý đề xuất**. Các mục đánh dấu **[C]** là mâu thuẫn thực sự giữa hai văn bản; **[U]** là chưa rõ/thiếu dữ liệu.

### [C-1] Cổng CSGT vẫn công bố QCVN 41:2016/BGTVT là quy chuẩn báo hiệu đường bộ hiện hành

- **Hiện tượng:** trang `https://csgt.bocongan.gov.vn/van-ban/quy-chuan-ky-thuat-quoc-gia-ve-bao-hieu-duong-bo` có tiêu đề "QCVN 41:2016/BGTVT — Quy chuẩn kỹ thuật quốc gia về báo hiệu đường bộ" và liên kết file `/upload/services/146_QCVN 41_2016_Final_IN.pdf`.
- **Nguồn:** HTML trang danh mục văn bản CSGT (tải ngày 25/10/2026).
- **Mâu thuẫn:** QCVN 41:2016 đã bị thay thế bởi QCVN 41:2019, và QCVN 41:2019 đã bị thay thế bởi **QCVN 41:2024** (TT 51/2024, hiệu lực 01/01/2025). Trang CSGT chậm **02 phiên bản**.
- **Ảnh hưởng:** nếu lấy dữ liệu từ trang này sẽ mô hình hoá sai (nhiều biển/vạch đã đổi mã, kích thước, ý nghĩa).
- **Hướng xử lý:** chỉ dùng bản Công báo 1359–1368/2024 (đã đối chiếu SHA-256). Ghi chú cảnh báo tại Mục 0.

### [C-2] TT 108/2026 không còn khái niệm "điểm liệt" — nhưng CV 2262 và bộ 600 câu vẫn vận hành theo "điểm liệt"

- **Hiện tượng:** từ khoá "liệt" xuất hiện **0 lần** trong toàn văn TT 108/2026/TT-BCA (Công báo 429/2026, 5.030 dòng; so với **12 lần** trong TT 12/2025). TT 108 chỉ quy định **điểm đạt tối thiểu** (B 45/50; C1 54/60; C 63/70; D1–D 72/80).
- **Nguồn:** TT 108/2026 Điều 4, Phụ lục III mục A.II.3 và III.1; so sánh với TT 12/2025 (nhiều lần "điểm liệt", ví dụ Phụ lục IV mục II.2.2) và CV 2262 (mục I.1 ghi chú: "thí sinh lựa chọn đáp án sai tại câu này được tính là điểm liệt, bài thi lý thuyết sẽ không đạt yêu cầu").
- **Câu hỏi chưa rõ:** từ 01/3/2027, một câu trả lời sai thuộc nhóm 60 câu "mất ATGT nghiêm trọng" có còn **tự động đánh trượt** hay chỉ trừ 1 điểm như các câu khác?
  - Nếu **vẫn đánh trượt**: một thí sinh sai 1 câu điểm liệt + 4 câu khác = 45/50 vẫn trượt — nhưng TT 108 không có câu nào diễn đạt điều đó.
  - Nếu **không còn**: cần bỏ khái niệm "điểm liệt" khỏi dữ liệu simulator/ôn tập từ 01/3/2027.
- **Ảnh hưởng:** logic chấm điểm và logic ôn tập trong simulator.
- **Hướng xử lý:** giữ nguyên mô hình "điểm liệt" cho giai đoạn đến 28/02/2027; với giai đoạn từ 01/3/2027 phải chờ văn bản hướng dẫn của Cục CSGT (Điều 36 TT 108 giao nhiệm vụ xây dựng bộ câu hỏi, nhưng chưa có).

### [C-3] Số câu / thời gian / điểm đạt thay đổi lớn giữa TT 12/2025 và TT 108/2026

| Hạng | TT 12/2025 (đến 28/02/2027) | TT 108/2026 (từ 01/3/2027) | Chênh lệch |
|---|---|---|---|
| A1, A | 25 câu / 19 phút / ≥21 (A1), ≥23 (A) | 40 câu / 27 phút / ≥36 | +15 câu, +8 phút |
| B1 | 25 câu / 19 phút / ≥23 | 50 câu / 33 phút / ≥45 | +25 câu, +14 phút |
| B | 30 câu / 20 phút / ≥27 | 50 câu / 33 phút / ≥45 | +20 câu, +13 phút |
| C1 | 35 câu / 22 phút / ≥32 | 60 câu / 40 phút / ≥54 | +25 câu, +18 phút |
| C | 40 câu / 24 phút / ≥36 | 70 câu / 47 phút / ≥63 | +30 câu, +23 phút |
| D1, D2, D | 45 câu / 26 phút / ≥41 | 80 câu / 53 phút / ≥72 | +35 câu, +27 phút |

- **Nguồn:** TT 12/2025 Phụ lục IV mục II.2.1–2.2 và Phụ lục I/II/III; TT 108/2026 Phụ lục I mục A.I.2.3, Phụ lục II mục A.II.3, Phụ lục III mục A.II.3.1.
- **Mâu thuẫn nội tại đáng lưu ý:** **hạng B1** trong TT 108/2026 (Phụ lục II) lại có **cùng** 50 câu/33 phút/45 điểm với hạng B, trong khi TT 12/2025 quy định B1 chỉ 25 câu/19 phút và về bản chất B1 là giấy phép lái xe mô tô ba bánh (Luật 36/2024/QH15, Điều 57 khoản 1 điểm c). Việc B1 dùng đề 50 câu "ô tô" là bất thường, cần xác minh lại với Cục CSGT.
- **Ảnh hưởng:** cấu hình đề thi, đồng hồ đếm giờ, ngưỡng đạt trong simulator.

### [C-4] Bộ 600 câu hỏi không tương thích về mặt số lượng với đề 50/60/70/80 câu

- **Hiện tượng:** CV 2262 xây dựng bộ 600 câu và phân nhóm theo chương. TT 108/2026 yêu cầu đề hạng B 50 câu, C1 60, C 70, D 80 — nhưng **không công bố tổng số câu của bộ mới** cho từng hạng, cũng không công bố tỷ lệ phân bổ theo chương.
- **Nguồn:** CV 2262 mục I.1; TT 108/2026 Phụ lục III mục A.II.3.1.
- **Chưa rõ:** bộ 600 câu hiện tại có được dùng tiếp cho đề 50–80 câu không (về mặt số học thì được — 600 > 80), hay sẽ có bộ mới lớn hơn? Nếu dùng tiếp 600 câu thì tỷ lệ rút theo chương ra sao?
- **Ảnh hưởng:** nếu tự sinh đề trong simulator, không có cơ sở chính thức để phân bổ tỷ lệ câu theo chương cho giai đoạn từ 01/3/2027.
- **Hướng xử lý:** dùng tỷ lệ CV 2262 cho giai đoạn hiện tại; đánh dấu "TBD" cho giai đoạn 2027.

### [C-5] Hiệu lực của CV 2262/CSGT-P5 sau khi TT 12/2025 hết hiệu lực

- **Hiện tượng:** CV 2262 dẫn căn cứ "khoản 1 Điều 35 Thông tư số 12/2025/TT-BCA". TT 108/2026 Điều 41 khoản 6: TT 12/2025 hết hiệu lực từ **01/7/2026**, trừ một số điều/khoản/phụ lục tiếp tục đến hết **28/02/2027**.
- **Chưa rõ:** CV 2262 là văn bản hướng dẫn dưới luật (công văn), không phải văn bản quy phạm pháp luật; khi căn cứ pháp lý hết hiệu lực thì CV 2262 đương nhiên hết hiệu lực hay vẫn được áp dụng theo quy định chuyển tiếp? Không có điều khoản nào nói rõ.
- **Ảnh hưởng:** tính pháp lý của bộ 600 câu và danh sách 60 câu "điểm liệt" trong giai đoạn 01/7/2026 – 28/02/2027.
- **Hướng xử lý:** coi CV 2262 + bộ 600 câu là hướng dẫn kỹ thuật đang áp dụng trên thực tế (Cục CSGT vẫn công bố công khai), nhưng phải ghi rõ đây là "hướng dẫn tạm thời" và theo dõi văn bản thay thế.

### [C-6] Lỗi đánh số trong QCVN 41:2024 (Điều 49)

- **Hiện tượng:** Điều 49 khoản 49.1 có tiểu khoản được đánh số **"48.1.1"** thay vì "49.1.1" (bản Công báo 1359+1360, tr. 70, dòng ngay sau 49.1). Nội dung nói về màu sắc vạch trên mặt bằng — đúng vị trí của 49.1.1.
- **Ảnh hưởng:** khi trích dẫn/đối chiếu số hiệu có thể gây nhầm với Điều 48.
- **Hướng xử lý:** trích nguyên văn như bản gốc (đã ghi chú trong Mục 3.1), khi tham chiếu thì dùng "49.1.1 (in là 48.1.1 trong Công báo)".

### [C-7] Điều 26.8 dẫn chiếu "DP.127d" nhưng danh mục Điều 22 chỉ có "DP.127"

- **Hiện tượng:** Điều 26.8 (tr. 27) viết "…các biển số DP.133, DP.134, DP.135, **DP.127d**". Trong khi Điều 22.1 (tr. 25–26) chỉ liệt kê "Biển số DP.127: Biển hết tốc độ tối đa cho phép theo biển ghép"; và Phụ lục B mục B.27d định nghĩa "Biển số DP.127a / DP.127b / DP.127c" (Hình B.27d).
- **Ảnh hưởng:** nhỏ, nhưng nếu parse tự động theo mã sẽ lỗi.
- **Hướng xử lý:** dùng mã "DP.127" làm khoá, các biến thể a/b/c là thuộc tính.

### [C-8] Không có quy định thời gian đèn vàng

- **Hiện tượng:** QCVN 41:2024 chỉ quy định **thời gian đèn xanh tối thiểu 15 giây** và **thời gian tín hiệu người đi bộ tối thiểu 10 giây** (Phụ lục A mục A.2). Không có quy định thời gian đèn vàng (thường 3–5 giây theo thực tế).
- **Ảnh hưởng:** simulator phải tự chọn thời gian vàng; nếu mô phỏng để dạy "vượt đèn vàng" cần giả định rõ.
- **Hướng xử lý:** ghi rõ trong tài liệu kỹ thuật của simulator: "thời gian vàng là tham số cấu hình, không có giá trị quy chuẩn".

### [C-9] QCVN 41:2024 không quy định "biển bát giác" ngoài bảng kích thước

- **Hiện tượng:** Bảng 1 (tr. 16) có dòng "Biển bát giác — Đường kính ngoài D = 600 mm, độ rộng viền trắng B = 30 mm". Nhưng phần chữ của quy chuẩn **không mô tả** biển bát giác; trong Phụ lục D, R.122 "Dừng lại" được mô tả là "biển hiệu lệnh dạng đặc biệt" mà không nêu hình dạng.
- **Hệ quả:** chỉ có thể suy ra R.122 là biển bát giác từ Bảng 1 + thực tế, không có câu chữ quy định trực tiếp.
- **Hướng xử lý:** khi mô hình hoá R.122, dùng bát giác đều D=600 mm (hệ số 1), viền trắng 30 mm, nền đỏ, chữ trắng "STOP" — ghi rõ đây là suy luận từ Bảng 1.

### [C-10] Phụ lục M/N/O/P là bản scan — không kiểm chứng được bằng text

- **Hiện tượng:** `tt-51-2024-p4-congbao-1365-1366.pdf` (95 trang) và `p5-congbao-1367-1368.pdf` (45 trang) chỉ có dòng chân trang, không có lớp text (scan ảnh).
- **Ảnh hưởng:** các bản vẽ chi tiết biển (Phụ lục M), mã hiệu đường (N, O), thiết kế biển chỉ dẫn trên cao tốc (P) và phần cuối Phụ lục K **không thể trích dẫn nguyên văn**. Các kích thước/hình dạng cụ thể của từng biển trong tài liệu này lấy từ **Bảng 1–3** và mô tả chữ ở p1–p3, không lấy từ bản vẽ.
- **Hướng xử lý:** nếu cần thông số hình học chính xác cho từng biển (góc lượn, vị trí mũi tên…), phải OCR hoặc đọc bản in; đã ghi rõ giới hạn này.

### [C-11] Đáp án trong PDF bộ 600 câu chỉ là gạch chân vector — không có trong text layer

- **Hiện tượng:** lớp text của PDF chỉ chứa câu hỏi và các ý trả lời; **không có ký tự đánh dấu đáp án**. Đáp án đúng là **đường kẻ vector** (path) nằm dưới dòng của ý đúng. Ví dụ đã kiểm chứng:
  - Câu 1 (tr. PDF 5): gạch chân dưới dòng "2. Phần đường xe chạy." ⇒ đáp án **2**.
  - Câu 204 (tr. PDF 48): gạch chân dưới dòng "4. Cả ba ý trên." ⇒ đáp án **4**.
- **Ảnh hưởng:** mọi pipeline `pdftotext` thông thường sẽ mất 100% đáp án; không thể tự động xây bộ ôn tập nếu chỉ dùng text.
- **Hướng xử lý:** trích path vector (như đã làm) hoặc OCR bản in; đối chiếu chéo với ít nhất 2 nguồn trước khi dùng cho chấm điểm.

### [C-12] Ngày trên cổng CSGT (05/05/2026) khác ngày tạo PDF (19/5/2025) và năm in "Hà Nội – 2025"

- **Hiện tượng:** mục "Bộ 600 câu hỏi" trên trang danh mục CSGT ghi **05/05/2026**; metadata PDF ghi CreationDate **2025-05-19**; trang bìa ghi "Hà Nội - 2025".
- **Chưa rõ:** có phải đã có bản cập nhật nội dung năm 2026 nhưng dùng lại metadata cũ? Hay chỉ là ngày đăng lại?
- **Hướng xử lý:** đã đối chiếu SHA-256 file tải ngày 25/10/2026 với file trong manifest — **trùng khớp** (`6a6dab85…518575`), tức nội dung không đổi. Ghi nhận ngày 05/05/2026 là ngày đăng danh mục.

### [C-13] QCVN 15:2026/BCA dẫn chiếu "Quy chuẩn kỹ thuật quốc gia về báo hiệu đường bộ" không nêu số hiệu

- **Hiện tượng:** QCVN 15:2026/BCA mục 2.1.8 yêu cầu "đúng quy cách, kiểu loại quy định tại Quy chuẩn kỹ thuật quốc gia về báo hiệu đường bộ" — không ghi QCVN 41:2024 hay bản nào.
- **Ảnh hưởng:** về nguyên tắc áp dụng bản hiện hành (QCVN 41:2024); nhưng nếu sau này QCVN 41 có bản mới thì QCVN 15:2026 sẽ tự động dẫn chiếu bản mới.
- **Hướng xử lý:** hiện dùng QCVN 41:2024.

### [C-14] Các điểm chưa rõ khác cần theo dõi

| # | Nội dung | Trạng thái |
|---|---|---|
| U-1 | Có bộ câu hỏi chính thức mới cho giai đoạn từ 01/3/2027 chưa? | **Chưa** (đến 25/10/2026) |
| U-2 | Có văn bản sửa đổi QCVN 41:2024 (đính chính lỗi 48.1.1, DP.127d…) chưa? | **Chưa tìm thấy** |
| U-3 | Có hướng dẫn chính thức về "điểm liệt" sau 01/3/2027? | **Chưa** |
| U-4 | Hạng B1 theo TT 108/2026 dùng đề 50 câu — có đúng ý định lập pháp? | **Cần xác minh** |
| U-5 | Quy định thời gian đèn vàng | **Không có trong QCVN** |
| U-6 | Bản dịch tiếng Anh chính thức của QCVN 41:2024 | **Không có** (chỉ tiếng Việt) |

---

## 9. Danh mục nguồn & kiểm chứng

### 9.1. Nguồn pháp lý (đã tải, có SHA-256 trong `_manifest.txt`)

| # | Văn bản | Cơ quan | Ngày | Hiệu lực | Công báo |
|---|---|---|---|---|---|
| 1 | Thông tư 51/2024/TT-BGTVT + QCVN 41:2024/BGTVT | Bộ GTVT | 15/11/2024 | 01/01/2025 | 1359–1368/2024, ngày 19/12/2024 |
| 2 | Thông tư 12/2025/TT-BCA | Bộ Công an | 28/02/2025 | 01/03/2025 | — (bản PDF 133 tr.) |
| 3 | Công văn 2262/CSGT-P5 | Cục CSGT | 07/05/2025 | Áp dụng từ 01/6/2025 | — |
| 4 | Bộ 600 câu hỏi | Cục CSGT | Hà Nội 2025 (PDF 19/5/2025) | Từ 01/6/2025 | — |
| 5 | Thông tư 108/2026/TT-BCA | Bộ Công an | 29/6/2026 | 01/7/2026 (lý thuyết: 01/3/2027) | 429/2026, ngày 23/7/2026 |
| 6 | Thông tư 107/2026/TT-BCA + QCVN 15:2026/BCA (trung tâm sát hạch lái xe) | Bộ Công an | 29/6/2026 | 01/7/2026 (một số mục từ 01/01/2027 và 01/01/2028) | — |
| 7 | Nghị định 94/2026/NĐ-CP (hoạt động đào tạo và sát hạch lái xe) | Chính phủ | 31/3/2026 | — | — |

### 9.2. Kiểm chứng hiệu lực

- **QCVN 41:2024/BGTVT:** tra cứu CSDL Công báo Chính phủ (api-searchcongbao.chinhphu.vn) với các từ khoá "QCVN 41", "báo hiệu đường bộ", "quy chuẩn kỹ thuật quốc gia về báo hiệu đường bộ", "sửa đổi Thông tư 51/2024/TT-BGTVT" — **không có** văn bản sửa đổi/thay thế/bãi bỏ nào ban hành sau 15/11/2024 và trước 25/10/2026.
- **vanban.chinhphu.vn** (docid 211908) ghi: Ngày có hiệu lực **01/01/2025**, không có ngày hết hiệu lực.
- **TT 12/2025:** vẫn còn hiệu lực một phần đến hết 28/02/2027 theo TT 108/2026 Điều 41 khoản 6.
- **TT 108/2026:** xác nhận trên Công báo 429 ngày 23/7/2026 (134 trang, gồm toàn văn + 14 phụ lục).

### 9.3. Công cụ và phương pháp

- **Trích xuất PDF:** `pdftotext -layout` (poppler) cho văn bản; `pdftocairo -svg` để trích path vector (đáp án gạch chân, đường kẻ).
- **Làm sạch:** script `_tools/clean` (loại bỏ ký tự điều khiển C0/C1, ký tự private-use, chuẩn hoá NFC) — bắt buộc vì text PDF Công báo chứa nhiều ký tự lỗi.
- **Đối chiếu trang:** hàm tìm số trang in từ dòng chân trang của từng văn bản (QCVN 41: `"N CÔNG BÁO/Số …"`; QCVN 15 và TT 12/2025: số trang in ở chân trang); "tr." là số trang in trên văn bản, không phải số thứ tự trang của file PDF.
- **Kiểm tra số câu:** đếm tiêu đề `"Câu N."` trong PDF bộ 600 câu = 600; kiểm tra dải 1–600 không thiếu/không trùng.

### 9.4. Giới hạn của tài liệu

1. **Không có bản vẽ/hình ảnh biển báo** trong tài liệu này (theo yêu cầu: chỉ ghi mã, tên, kích thước, màu, ý nghĩa từ chữ/bảng).
2. **Phụ lục M/N/O/P (bản scan)** không trích được — xem C-10.
3. **Không trích toàn bộ 600 câu hỏi/đáp án** — chỉ mô tả cấu trúc, danh sách 60 câu "điểm liệt", định dạng đáp án. Nếu cần nội dung từng câu, phải xử lý riêng file PDF gốc (6,7 MB, 188 trang).
4. **Các trang web có thể thay đổi** — mọi URL ghi tại thời điểm 25/10/2026.

---

## 10. Tóm tắt dành cho lập trình viên simulator

### 10.1. Checklist dữ liệu cần mô hình hoá

- [ ] **Đèn tín hiệu:** 3 màu chính (đỏ/vàng/xanh), thứ tự dọc/ngang; mũi tên xanh/đỏ; đèn hình phương tiện; đèn 2 màu cho người đi bộ; đèn chớp vàng; đèn đường sắt; đèn làn (6.6). Kích thước 200–300 mm; cao 1,7–5,8 m (dọc) hoặc 5,2–7,8 m (ngang); cách mép đường 0,5–2 m.
- [ ] **Vạch kẻ:** 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1a/b, 4.1, 4.2, 6.1, 6.2, 7.1, 7.2, 7.3, 8.1, 8.2, 8.7, 9.1, 9.2, 9.3, 9.4, 9.5a–e, 9.6 — màu/bề rộng/chu kỳ theo bảng Mục 3.2.
- [ ] **Biển báo:** 5 nhóm; tối thiểu các mã R.122, R.301a–h, R.303, R.306, P.123a/b, P.124a–f, P.125, P.126, P.127, P.130, P.131a–c, DP.133–135, W.205a–e, W.206, W.209, W.210, W.211, W.219, W.220, W.224, W.242a/b, I.408, I.408a, I.409, I.410, I.446, S.501–S.509.
- [ ] **Thứ tự hiệu lực:** người điều khiển (1) > đèn (2) > biển (3) > vạch (4) > cọc tiêu/tường/rào (5) > âm thanh (6); biển tạm thời thắng biển cố định; biển VMS thắng biển tĩnh.
- [ ] **Sa hình QCVN 15:2026/BCA:** 12 bài cho hạng B–D (2.1.15.1–2.1.15.12) + biển/vạch tương ứng (bảng Mục 6.6).

### 10.2. Bảng quy đổi nhanh đơn vị

| Đại lượng | Đơn vị chuẩn trong QCVN | Ghi chú |
|---|---|---|
| Bề rộng vạch | cm | 15, 20, 30, 40 |
| Chiều dài nét | m | L1, L2 |
| Kích thước biển | mm | Bảng 1, 2 |
| Chiều cao đèn | m | 1,7–5,8; 5,2–7,8 |
| Độ dốc | % | W.219/W.220 |
| Tốc độ | km/h | P.127, R.306 |

### 10.3. Sai lệch thường gặp khi mô hình hoá (từ kinh nghiệm đối chiếu)

| Lỗi | Đúng theo QCVN |
|---|---|
| Vẽ vạch tim đường màu trắng | Phải **vàng** (1.x) |
| Vẽ vạch dừng xe 15 cm | Phải **20/30/40 cm** (7.1) |
| Vẽ vạch đi bộ mẫu 2 với nét 15 cm | Phải **40 cm** (7.3 mẫu 2) |
| Đặt biển nguy hiểm nền trắng | Phải **nền vàng, viền đỏ, hình đen** |
| Biển chỉ dẫn nền vàng | Phải **nền xanh** |
| Biển hiệu lệnh nền trắng | Phải **nền xanh lam, hình trắng** |
| Cho rằng P.123 cấm quay đầu | **Không** — P.123 chỉ cấm rẽ; muốn cấm quay đầu dùng P.124 |
| Cho rằng P.125 cấm vượt xe máy | **Không** — được vượt xe máy 2 bánh/xe gắn máy |
| Đèn vàng nhấp nháy = dừng | **Không** — được đi nhưng phải quan sát, giảm tốc |
| Đèn tắt = hết hiệu lực biển/vạch | **Không** — vẫn phải theo biển/vạch (Điều 8) |

---

*Tài liệu lập ngày 25/10/2026. Mọi trích dẫn là nguyên văn từ bản PDF gốc; quy ước số trang xem phần đầu tài liệu.*
