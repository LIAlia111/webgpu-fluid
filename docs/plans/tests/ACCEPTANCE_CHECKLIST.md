# WebGPU 流体涟漪 Demo — 手动验收清单

**版本**：v1.0  
**对应 PRD**：PRD v1.0  
**对应 Design Doc**：DESIGN_DOC v1.0

---

## 测试环境准备

### 桌面测试环境
- **必须**：Chrome 113+（或 Edge 113+）带独立或集成 GPU
- 访问地址：开发环境 `http://localhost:5173` 或生产环境 `https://fluid.liaolief.com`
- 开启 Chrome DevTools → Performance 面板，可监控 FPS
- 开启 DEV 模式（`npm run dev`）以显示右上角 FPS 计数器

### 手机测试环境
- **推荐**：iOS 16.4+ Safari（WebGPU 支持）或 Android Chrome 113+
- 连接同一 WiFi，访问内网 IP 或使用 ngrok 隧道
- iOS Safari 需在 **设置 → Safari → 高级 → 实验性功能** 确认 WebGPU 已开启
- 手机测试时使用竖屏为主，测试旋转时切换横屏

### 不兼容浏览器（用于 AC-F5 测试）
- Firefox（截至 2026-05 默认不支持 WebGPU）
- 旧版 Safari（< 16.4）
- 微信内置浏览器

---

## AC-F1：WebGPU 兼容性检测

### 桌面测试（Chrome 113+）

- [ ] **F1-D-01** 打开页面，黑色背景立即出现（不白屏），左上角出现加载动画
- [ ] **F1-D-02** 加载动画在 3 秒内消失，canvas 全屏显示（无加载转圈残留）
- [ ] **F1-D-03** 打开 DevTools Console，无 `console.error` 输出（可以有 `console.warn`）
- [ ] **F1-D-04** 页面标题/favicon 正常显示（非 404 错误页）
- [ ] **F1-D-05** Canvas format 验证：在 Console 执行
  ```javascript
  navigator.gpu.getPreferredCanvasFormat()
  ```
  确认返回 `"bgra8unorm"` 或 `"rgba8unorm"`（非 undefined）

### 手机测试（iOS Safari / Android Chrome）

- [ ] **F1-M-01** 打开页面，背景黑色，无白屏闪烁
- [ ] **F1-M-02** 加载动画在 5 秒内消失（移动端 GPU 初始化可能稍慢）
- [ ] **F1-M-03** Canvas 全屏，无黑边，触控区域响应
- [ ] **F1-M-04** iOS Safari：不出现"此网页不使用您的完整屏幕"警告或异常

### 兼容性降级测试（Firefox 或旧 Safari）

- [ ] **F1-C-01** 使用 Firefox 打开，页面不显示 canvas，显示不支持提示页
- [ ] **F1-C-02** 不支持提示页背景为黑色，非白色
- [ ] **F1-C-03** 提示页无任何 JavaScript 错误信息暴露给用户（无堆栈、无 "Error:" 字样）
- [ ] **F1-C-04** Console 中只有 `console.warn`，无 `console.error`（生产构建下）

---

## AC-F2：流体模拟运行

### 桌面测试

- [ ] **F2-D-01** 页面加载后，右上角 FPS 计数器（DEV 模式）显示 ≥ 55 fps（桌面目标）
  - FPS 数字颜色应为蓝色 `rgba(0,196,232,0.8)`（正常）
  - 若显示红色，说明性能未达标
- [ ] **F2-D-02** 在 canvas 上单击一次，观察涟漪出现，**2-3 秒内**自然消散（不是瞬间消失，也不是永久保留）
- [ ] **F2-D-03** 停止操作 3 秒后，画面恢复接近全黑（速度场衰减）
- [ ] **F2-D-04** 快速大幅度滑动（模拟极端输入）持续 10 秒，画面不崩溃、不出现全白/全彩异常、不出现 GPU 崩溃提示
- [ ] **F2-D-05** 切换到其他标签页再切回，模拟恢复，画面不出现大跳变（dt 上限 1/30s 保护）

### 手机测试

- [ ] **F2-M-01** DEV 模式下右上角 FPS ≥ 30（移动端最低要求）
- [ ] **F2-M-02** 触控拖动产生涟漪，2-3 秒衰减（与桌面行为一致）
- [ ] **F2-M-03** 快速划屏 10 秒，无崩溃、无 GPU 相关错误提示
- [ ] **F2-M-04** 低端测试：若 FPS < 25 连续 3 帧，观察模拟是否仍然稳定（自动降级保护）

### 数值稳定性验证

- [ ] **F2-S-01** 长时运行 5 分钟，画面持续正常（无 NaN 导致的全黑/全白爆炸）
- [ ] **F2-S-02** 打开 DevTools，切换到 Performance Monitor，GPU Memory 无持续增长（无内存泄漏）

---

## AC-F3：触控/鼠标输入响应

### 桌面测试（鼠标）

- [ ] **F3-D-01** 鼠标**按住**canvas 并拖动，产生涟漪轨迹
- [ ] **F3-D-02** 鼠标**未按下**时移动，不产生任何涟漪（状态门控正确）
- [ ] **F3-D-03** 鼠标**松开**后继续移动，不产生涟漪
- [ ] **F3-D-04** 鼠标拖动方向验证：
  - 向右拖动 → 涟漪/颜色向右侧扩散
  - 向左拖动 → 涟漪向左侧扩散
  - 快速转向 → 速度方向随即改变
- [ ] **F3-D-05** 鼠标移出 canvas 边界：涟漪停止（mouseleave 状态清除）
- [ ] **F3-D-06** 右键菜单被阻止（contextmenu 事件 preventDefault）

### 手机测试（触控）

- [ ] **F3-M-01** 单指滑动产生涟漪，方向与滑动方向一致
- [ ] **F3-M-02** 单指轻点（几乎不移动）：可能产生很轻微涟漪，或无效果（速度阈值 1e-4 过滤）
- [ ] **F3-M-03** **双指同时触控**：两个触点各自产生独立涟漪，颜色不同（两个预设颜色）
- [ ] **F3-M-04** **3 指同时触控**：3 个触点均产生涟漪，无截断
  - 测试方式：三根手指同时按在不同位置并缓慢滑动
  - 验证：3 个位置均出现颜色/涟漪
- [ ] **F3-M-05** **5 指同时触控**（验证最大 10 splat 限制）：5 根手指同时在不同位置滑动，全部产生涟漪
- [ ] **F3-M-06** 快速多指交替触控（随机乱划 10 秒），无崩溃、无黑屏异常
- [ ] **F3-M-07** 触控不触发页面滚动（`preventDefault()` 生效，页面不被意外滚动）

### 坐标准确性验证

- [ ] **F3-C-01** 触点在 canvas 边缘：涟漪出现在边缘位置（坐标不偏移）
- [ ] **F3-C-02** 横屏旋转后坐标仍然准确（getBoundingClientRect 动态获取）
- [ ] **F3-C-03** 双指缩放手势（pinch）：不产生异常 splat（非预期输入）

---

## AC-F4：视觉渲染效果

### 桌面测试

- [ ] **F4-D-01** 初始状态（无输入）：canvas 接近全黑，无随机噪点或异色
- [ ] **F4-D-02** 触控/拖动后涟漪颜色为**蓝绿色调**（青蓝 #00c4e8 附近），非红色/绿色/白色
- [ ] **F4-D-03** 快速滑动产生高速涟漪时，边缘出现**白色高光**效果（velocity gradient highlight）
- [ ] **F4-D-04** Canvas 全屏无黑边（四个角落无未覆盖区域）
- [ ] **F4-D-05** 屏幕旋转或窗口缩放：canvas 自动适应新尺寸，无内容裁切、无拉伸变形
- [ ] **F4-D-06** DPR 验证（Retina 屏幕）：画面清晰，无模糊（高分辨率屏正确渲染）
- [ ] **F4-D-07** 多次触控后，涟漪相互干扰产生自然流体混合效果（不是简单叠加）

### 手机测试

- [ ] **F4-M-01** 竖屏：canvas 全屏，无黑边，无地址栏遮挡问题
- [ ] **F4-M-02** 横屏：旋转后 canvas 自动填满新视口（防抖 200ms 后重建）
- [ ] **F4-M-03** iOS Safari 底部工具栏出现/消失时，canvas 重新适配高度
- [ ] **F4-M-04** 颜色效果与桌面一致（蓝绿色调 + 白色高光）

### 颜色规格验证

- [ ] **F4-V-01** 使用 Chrome DevTools 截图工具，取样涟漪颜色：
  - Hue（色相）应在 170°-220° 范围（青蓝色系）
  - 不应出现红色调（Hue 0°-20° 或 340°-360°）
- [ ] **F4-V-02** 静止区域（无速度）：亮度接近 0（`brightness = 0` when `mag = 0`）
- [ ] **F4-V-03** 高速区域高光：接近白色（R≈G≈B≈255 的区域）

---

## AC-F5：WebGPU 不支持时的降级提示页

### 降级页外观

- [ ] **F5-A-01** 使用 Firefox 或旧版 Safari 访问：显示降级提示页，不是空白页
- [ ] **F5-A-02** 降级页背景为**黑色**，与主体验视觉风格一致（非白底）
- [ ] **F5-A-03** 降级页文字颜色为浅色/白色（在黑背景上可读）
- [ ] **F5-A-04** 降级页包含**推荐浏览器列表**（至少包含 Chrome 或 Edge）
- [ ] **F5-A-05** 降级页**不显示任何技术错误信息**（无 "Error:"、无堆栈、无 "WebGPU_NOT_SUPPORTED" 字样）

### 降级逻辑验证

- [ ] **F5-L-01** WebGPU 不支持时，canvas 元素不可见（display:none 或 visibility:hidden）
- [ ] **F5-L-02** 降级后，加载动画（#loading-indicator）不可见（已消失）
- [ ] **F5-L-03** 生产构建访问（`npm run build && npm run preview`）：Console 只有 `console.warn('WebGPU not supported')`，无 `console.error`

### Chrome 中模拟验证（DevTools）

在 Chrome DevTools Console 中执行以下命令，临时禁用 WebGPU：

```javascript
// 方法：覆盖 requestAdapter 返回 null
const origGpu = navigator.gpu;
Object.defineProperty(navigator, 'gpu', { get: () => undefined });
location.reload();
```

- [ ] **F5-D-01** 执行上述操作后刷新页面：降级提示页正常显示
- [ ] **F5-D-02** 恢复（重新打开标签页）：正常 WebGPU 体验恢复

---

## 性能验收

### FPS 标准

| 设备类型 | 目标 FPS | 最低可接受 FPS |
|---------|---------|--------------|
| 桌面（独显）| 60 fps | 30 fps |
| 桌面（集显）| 60 fps | 30 fps |
| 高端手机（iPhone 15 Pro / 旗舰 Android）| 60 fps | 30 fps |
| 中端手机 | 30 fps | 20 fps |

- [ ] **P-01** 桌面 DEV 模式右上角 FPS 计数器 ≥ 55，颜色为蓝色
- [ ] **P-02** 手机 DEV 模式 FPS ≥ 30，颜色为蓝色（≥ 30 时显示蓝色）
- [ ] **P-03** 生产构建（`npm run build`）FPS 与 DEV 模式相当（无额外性能损失）

### 帧时间测量（Chrome DevTools）

使用 Chrome DevTools → Performance → Record 录制 3 秒：

- [ ] **P-04** 主线程帧时间（Frame duration）平均 < 16.7ms（60fps 基准）
- [ ] **P-05** GPU 帧时间（如可见）< 8ms（目标：512×512 网格 20 次 Jacobi ≈ 7ms）
- [ ] **P-06** 无明显的帧时间尖峰（无超过 50ms 的异常帧，除首帧外）

### GPU 内存

使用 Chrome DevTools → Memory 或 `chrome://tracing`：

- [ ] **P-07** GPU 内存占用约 12-15MB（512×512 网格，含双缓冲）
- [ ] **P-08** 运行 5 分钟，GPU 内存无持续增长（无纹理泄漏）
- [ ] **P-09** 手机 GPU 内存 < 50MB（总限制 200MB，实际占用远低于此）

### 网格分辨率自适应

- [ ] **P-10** 桌面（1920×1080）：在 Console 确认 gridSize ≈ 480×272 或 512×512
- [ ] **P-11** 手机竖屏（390×844）：gridSize ≈ 96×208（≤ 256 上限）
- [ ] **P-12** 旋转手机到横屏：gridSize 动态重算，模拟继续正常运行

---

## 多点触控专项测试

此部分针对 AC-F3 中多点触控的详细验收，需在真实手机上测试（Playwright 模拟有限制）。

### 2 点触控

- [ ] **MT-2-01** 两根手指同时点击不同位置：2 个涟漪同时出现，位置对应触点
- [ ] **MT-2-02** 两根手指同时向不同方向滑动：2 个涟漪方向各自独立，不相互干扰
- [ ] **MT-2-03** 两个涟漪颜色不同（按 touch.identifier % 5 分配预设颜色）

### 3 点触控

- [ ] **MT-3-01** 三根手指同时触控：3 个独立涟漪同时出现
- [ ] **MT-3-02** 先触 2 根手指，再加第 3 根：第 3 个涟漪正常出现（不丢失）
- [ ] **MT-3-03** 3 根手指同向扫动：3 条涟漪轨迹，视觉上流场方向一致（有累积效果）

### 5 点触控（最大 SplatList.count = 10 内的极限测试）

- [ ] **MT-5-01** 5 根手指（或用 5 指可操作区域）同时触控：5 个涟漪全部出现，无截断
- [ ] **MT-5-02** 5 根手指同时快速滑动 3 秒：画面不崩溃，FPS 不跌破 15fps

---

## AC-F6（运维/部署验收）

此部分需在有 Nginx 访问权限的服务器上验证。

### Nginx 配置

- [ ] **F6-N-01** `nginx -t` 语法检查通过，无 error
- [ ] **F6-N-02** HTTP 访问 `http://fluid.liaolief.com` 返回 301 跳转到 HTTPS

### MIME Type 与缓存

```bash
# 验证 .wgsl MIME type
curl -I https://fluid.liaolief.com/assets/advect-xxxxx.wgsl | grep Content-Type
# 期望：text/plain 或 text/plain;charset=utf-8

# 验证 JS 文件长缓存
curl -I https://fluid.liaolief.com/assets/main-xxxxx.js | grep Cache-Control
# 期望：public, max-age=31536000, immutable

# 验证 HTML 不缓存
curl -I https://fluid.liaolief.com/ | grep Cache-Control
# 期望：no-cache, no-store, must-revalidate

# 验证 Gzip 压缩
curl -H "Accept-Encoding: gzip" -I https://fluid.liaolief.com/assets/main-xxxxx.js | grep Content-Encoding
# 期望：gzip
```

- [ ] **F6-N-03** `.wgsl` 文件 Content-Type 为 `text/plain`
- [ ] **F6-N-04** JS/CSS 文件 Cache-Control 含 `immutable`
- [ ] **F6-N-05** HTML 文件 Cache-Control 含 `no-cache`
- [ ] **F6-N-06** JS 文件响应头含 `Content-Encoding: gzip`

### HTTPS（WebGPU Secure Context 要求）

- [ ] **F6-S-01** 通过 HTTPS 访问，WebGPU 正常初始化（Secure Context 验证）
- [ ] **F6-S-02** SSL 证书有效，浏览器无安全警告

---

## 验收结论

| AC | 测试项数 | 通过 | 失败 | 跳过 |
|----|---------|------|------|------|
| AC-F1 | 9 | | | |
| AC-F2 | 9 | | | |
| AC-F3 | 13 | | | |
| AC-F4 | 11 | | | |
| AC-F5 | 8 | | | |
| 性能 | 12 | | | |
| 多点触控 | 8 | | | |
| AC-F6 | 6 | | | |
| **合计** | **76** | | | |

**验收日期**：___________  
**测试人员**：___________  
**测试设备**：___________  
**结论**：□ 通过  □ 有条件通过（附备注）  □ 未通过

**备注**：
```
（填写失败项、临时豁免说明等）
```
