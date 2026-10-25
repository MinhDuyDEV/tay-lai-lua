# tay-lai-lua

Web 3D tập thi sát hạch lái xe. Kiến trúc: `docs/architecture.md`.

## Chạy

Cần: Rust (theo `rust-toolchain.toml`), Node 24, pnpm (`corepack enable`), [Task](https://taskfile.dev), `wasm-tools`.

```sh
task web:preview   # dựng sim.wasm + trang tĩnh, mở http://localhost:4173/thi (bài 1) hoặc /thi/3 (bài 3: dừng và khởi hành xe ngang dốc)
task web:dev       # như trên nhưng có hot reload (Next dev server)
task check         # kiểm tra toàn bộ: wasm, luật, vết chuẩn trên 5 môi trường, web, e2e
```

`task check` cần trình duyệt của Playwright (một lần): `cd tools/browser && npm ci && npx playwright install --with-deps chromium firefox webkit`.

Trang `/thi` chỉ cần bàn phím: bấm phím bất kỳ để vào xe; bảng phím hiện ngay trên màn hình.
