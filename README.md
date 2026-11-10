# tay-lai-lua

Web 3D tập thi sát hạch lái xe. Kiến trúc: `docs/architecture.md`.

## Chạy

Cần: Rust (theo `rust-toolchain.toml`), Node 24, pnpm (`corepack enable`), [Task](https://taskfile.dev), `wasm-tools`.

```sh
task web:preview   # dựng sim.wasm + trang tĩnh, mở http://localhost:4173/ (danh sách 11 bài); /thi là bài 1, /thi/3 là bài 3, /lien-hoan là thi thử cả 11 bài
task web:dev       # như trên nhưng có hot reload (Next dev server)
task check         # kiểm tra toàn bộ: wasm, luật, vết chuẩn trên 5 môi trường, web, e2e
```

`task check` cần trình duyệt của Playwright (một lần): `cd tools/browser && npm ci && npx playwright install --with-deps chromium firefox webkit`.

Mỗi bài chỉ cần bàn phím: bấm “Vào xe” hoặc phím bất kỳ để vào xe; màn hình chỉ bước tiếp theo và phím cần bấm, bảng phím đầy đủ ở nút “Bảng phím”.
