# Constraints — NezFocus Backend

Chuẩn chất lượng của repo này, chốt ở G0 (04/11/2026) qua skill `agent-skills:constraint-driven-development`. Mỗi luật có lệnh kiểm tra và lý do. AI và người viết code đều đọc file này trước khi code; **không hạ chuẩn ở đây để một thay đổi qua được kiểm tra**. Muốn nới một luật thì chủ dự án quyết, ghi lý do, và sửa file này trong một commit riêng, không chung với code đang đỏ.

Lần rà gần nhất: 04/11/2026, Phạm Trung Hiếu.

## Chạy lúc nào

Mọi kiểm tra chỉ xét **phần thay đổi**, so với một mốc gốc:
- trên `main`: những gì chưa commit (chủ dự án commit một lần ở bước A4);
- trên nhánh `learn/*`: từ chỗ nhánh tách khỏi `main`;
- trên CI: so với commit trước lần push.

| Lúc | Lệnh | Chạy gì | Thời gian đo được |
|---|---|---|---|
| Trong lúc sửa | — | Không có hook chạy sau mỗi lần sửa: ESLint có kiểu phải nạp cả chương trình TypeScript (~1 GB RAM), lặp lại hàng chục lần thì máy yếu không chịu nổi | — |
| Giữa lát, khi cần | `pnpm check:fast` | lint file đã đổi, sàn, secret | ~6 giây |
| Cuối mỗi lát của A2 | `pnpm check:task` | `check:fast` + `tsc --noEmit` + test liên quan + coverage dòng đổi | 17–19 giây (một lát chạm 6 suite test); giới hạn 90 giây |
| Commit | hook `pre-commit`, `commit-msg` | secret trên file staged, lint-staged, sàn trên commit | vài giây |
| Push | hook `pre-push` | `pnpm test && pnpm test:e2e` (e2e chỉ cần Node, không cần Docker) | như base |
| Cuối A2, một lần | `pnpm check:full` | lint + format + tsc + sàn + secret + unit + e2e + integration + OpenAPI + env + `pnpm audit`; chạy lần lượt từng lệnh. Cần `pnpm test:services:up` trước | vài phút |
| CI (mỗi lần push ở A4) | `.github/workflows/ci.yml` | mọi thứ trên, cộng coverage dòng đổi trên cả suite, Semgrep, gitleaks, Trivy, cấu hình giám sát | không giới hạn |

Lệnh ở cột "Lệnh" là bản tiện dụng; bảng "Luật có số" bên dưới là nguồn chính. Hai chỗ lệch nhau thì file này đúng.

## Sàn (luôn áp dụng)

Kiểm bởi `node scripts/constraints/floor-guard.mjs`, chuyển thể từ bản mẫu của skill. Chạy trong `check:fast`, hook `commit-msg`, `check:full` và job `guard` trên CI.

- Không thêm comment tắt kiểm tra: `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `eslint-disable`, `istanbul ignore`, `c8 ignore`, `nosemgrep`, `gitleaks:allow`. Bảy `eslint-disable` có sẵn trong code base được giữ (sàn chỉ xét phần thay đổi).
- Không để việc dở: `throw new Error('Not implemented')`, `catch {}` rỗng, `TODO` trong code.
- Không làm test dễ đi: không thêm `.skip`, `.only`, `.todo`, `xit`, `xdescribe`.
- Không xóa test hay assertion mà không có lý do: xóa file test hay bỏ một `expect` thì commit message phải có dòng `Tests-removed: <vì sao>`. `check:task` liệt kê những chỗ này để AI đưa lý do vào commit message gợi ý; hook `commit-msg` và CI chặn khi thiếu.
- Không có secret trong code: xem dòng "Secret" ở bảng dưới.
- File này không bị nới để một thay đổi qua được: hạ một ngưỡng, xóa một luật hay thêm một dòng ngoại lệ đều bị floor-guard báo.

**Nhánh `learn/*` (bước B3 của docs/WORKFLOW.md)** chỉ được miễn luật "việc dở" (`TODO(human)`, thân hàm bị thay bằng `throw`), vì bản viết lại bắt đầu từ chữ ký và thân trống. Luật secret, luật cấm skip / xóa test và việc test phải chạy vẫn giữ nguyên: test là thứ chấm bản viết lại.

## Luật có số

| Chiều | Luật | Kiểm bởi | Chạy lúc | Lý do |
|---|---|---|---|---|
| Kiểu | 0 lỗi kiểu | `tsc --noEmit` | `check:task`, `check:full`, CI | Lỗi kiểu là lỗi; không có lý do giữ lỗi nào |
| Lint | 0 lỗi ESLint theo `eslint.config.mjs` (cảnh báo không chặn) | `node scripts/constraints/lint-changed.mjs`; toàn bộ: `pnpm lint` | `check:fast`, commit (lint-staged), `check:full`, CI | Cấu hình của base đã cấm `any` và giữ ranh giới module |
| Format | 0 file lệch Prettier | `pnpm format:check` | commit (lint-staged), `check:full`, CI | Như base |
| Kiến trúc: ranh giới lớp | 0 vi phạm: `domain/` không import `@nestjs`, `@prisma`, `@/generated` hay lớp khác; `application/` không import `infrastructure/`, `presentation/`, Prisma | Luật `no-restricted-imports` (`LAYER_BANS`) trong `eslint.config.mjs`, chạy cùng lint | như Lint | Luật phụ thuộc của hexagonal (docs/hexagonal-architecture.md) trước đây chỉ có trên giấy. Test được miễn vì cố ý nối adapter thật |
| Kiến trúc: ranh giới module | 0 vi phạm: module chỉ dùng module khác qua `index.ts` | Luật `no-restricted-imports` (`moduleBans`) trong `eslint.config.mjs` | như Lint | Có sẵn từ base |
| Test liên quan | Mọi test liên quan đến file đã đổi phải xanh | `jest --findRelatedTests` trong `coverage-changed.mjs` | `check:task` | Bắt lỗi trước khi chạy cả suite |
| Coverage dòng đổi | Dòng đổi chạy được trong `domain/` và `application/`: ≥ 80% được test chạy qua | `node scripts/constraints/coverage-changed.mjs` (CI: đọc lcov của `pnpm test --coverage`, không chạy lại) | `check:task`, CI. Trên `learn/*`: chỉ báo, không chặn | 80% đủ để bắt phải có test, vẫn chừa chỗ cho dòng cấu hình. Chỉ đo hai lớp chứa luật nghiệp vụ; repository và controller do integration / e2e phủ, mà hai bộ đó cần Docker hoặc chạy lâu |
| Suite đầy đủ | unit, e2e, integration đều xanh | `pnpm test`, `pnpm test:e2e`, `pnpm test:integration` | push (unit + e2e), `check:full`, CI | Như base |
| Hợp đồng API | `openapi.json` khớp code; `.env.example` khớp schema cấu hình | `pnpm openapi:check`, `pnpm env:check` | `check:full`, CI | Như base; frontend sinh kiểu từ `openapi.json` |
| Migration | Migration sinh ra đúng schema | `pnpm prisma:check` | CI | Như base |
| Secret | 0 phát hiện | `node scripts/constraints/secrets.mjs` (gitleaks, luôn `--redact`) | `check:fast`, pre-commit (`--staged`), `check:full`, CI | **Bên ngoài.** Thiếu gitleaks thì pre-commit đỏ kèm cách cài: `winget install --id Gitleaks.Gitleaks -e` |
| Bảo mật: code | 0 phát hiện mức high / critical / `ERROR` trên file `src/` đã đổi | Semgrep `p/default` 1.181.0 + `scripts/constraints/quality-gate.mjs` | CI (job `semgrep`) | **Bên ngoài.** Chỉ chạy trên CI vì nặng; quét file đã đổi để code base không làm đỏ |
| Bảo mật: dependency | 0 advisory mức high trở lên ở dependency production | `pnpm audit --prod --audit-level high` | `check:full`, CI | **Bên ngoài.** Mặc định của skill: dưới mức high phần lớn là nhiễu |
| Bảo mật: image | 0 lỗ hổng high / critical đã có bản vá | Trivy (job `image`) | CI | **Bên ngoài.** Như base |
| Cấu hình giám sát | Alloy, Loki, Prometheus, Alertmanager hợp lệ, test rule xanh | `pnpm monitoring:check` | CI | Như base; giữ theo D-126. Không chạy ở máy vì kéo 4 image Docker |

## Đo, chưa ép

| Chỉ số | Hiện tại | Hướng | Ghi chú |
|---|---|---|---|
| Coverage toàn dự án (dòng, `src/`) | đo sau lát dọn base của M0 | must not fall (dung sai 0.5%) | Đo trước lúc đó thì vô nghĩa vì M0 gỡ 2FA và Turnstile. Số đo nằm trong dòng `text-summary` của bước `pnpm test --coverage` trên CI; ghi số vào ô này khi lát dọn base xong |

## Không chọn

- **Hiệu năng (Lighthouse, size-limit):** backend không có trang để đo. Tải backend đo bằng k6 nhắm vào server đã deploy ở M7 (D-126, NFR-PERF), không phải một cổng kiểm tra.
- **Accessibility:** không áp cho backend; xét ở lượt CONSTRAINTS của frontend.
- **Mutation testing (Stryker):** quá nặng cho máy hiện tại. Thay bằng luật của WORKFLOW bước A2: mỗi luật chính có test báo đỏ khi cố tình làm hỏng code.

## Ngoại lệ

| ID | Luật | Đường dẫn | Lý do | Người chịu trách nhiệm | Hết hạn |
|---|---|---|---|---|---|

Chưa có. Một ngoại lệ mới cần chủ dự án duyệt, có người chịu trách nhiệm và ngày hết hạn (mặc định 90 ngày).
