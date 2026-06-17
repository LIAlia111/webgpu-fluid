# WebGPU 流体涟漪 Demo — 工作计划

版本：v1.0
日期：2026-05-21
依据：DESIGN_DOC v1.0、UI_SPEC v1.0、ACCEPTANCE_CHECKLIST v1.0

## 总体策略

纯前端静态项目，无构建步骤，无 npm。所有文件直接由 nginx alias 提供服务。
Shader 加载方式：在 fluid-sim.js 中通过 `fetch('/webgpu-fluid/shaders/xxx.wgsl')` 加载 WGSL 文本。

## 阶段总览

| 阶段 | 任务文件 | 关键产物 | 依赖 |
|------|---------|---------|------|
| Phase 1 | 001_project_skeleton.md | index.html, style.css, src/main.js | 无 |
| Phase 2 | 002_webgpu_init.md | src/webgpu-init.js | Phase 1 |
| Phase 3 | 003_shaders.md | shaders/*.wgsl (7个) | Design Doc §4 |
| Phase 4 | 004_fluid_sim.md | src/fluid-sim.js | Phase 2 + Phase 3 |
| Phase 5 | 005_input_renderer.md | src/touch-handler.js, src/renderer.js | Phase 4 |
| Phase 6 | 006_unsupported_page.md | index.html 完善, style.css 完善 | Phase 1 |
| Phase 7 | 007_nginx_deploy.md | /etc/nginx/sites-available/lief-portfolio | Phase 1-6 |

## 并行执行策略

Phase 1 和 Phase 3 可以并行（无依赖关系）
Phase 6 在 Phase 1 完成后可与 Phase 2-5 并行

## 验收标准总索引

AC-F1 → Phase 1, 2, 6
AC-F2 → Phase 4, 5
AC-F3 → Phase 5
AC-F4 → Phase 3, 4, 5
AC-F5 → Phase 6
AC-F6 → Phase 7

## 关键技术风险

1. SplatData WGSL 内存布局：vec3f 在 uniform 中对齐到 16 bytes，JS 端写 32 bytes/entry
2. texture_storage_2d read_write 支持：splat shader 需要 rg32float + read_write
3. fetch() shader 路径：必须与 nginx location alias 完全匹配（/webgpu-fluid/shaders/）
4. nginx 嵌套 location 与 alias 兼容性
