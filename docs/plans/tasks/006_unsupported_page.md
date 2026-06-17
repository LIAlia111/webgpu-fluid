# Task 006: 不兼容提示页 + 样式完善

## 依赖
Phase 1（index.html 和 style.css 存在）

## 产物
- 更新 /root/lief-projects/webgpu-fluid/index.html
- 更新 /root/lief-projects/webgpu-fluid/style.css

## #unsupported-page 完整内容
```html
<div id="unsupported-page" style="display:none">
  <div class="unsupported-content">
    <div class="unsupported-icon">≋</div>
    <h1 class="unsupported-title">需要支持 WebGPU 的浏览器</h1>
    <p class="unsupported-desc">
      这个 Demo 使用 WebGPU 实时模拟流体效果，<br>当前浏览器暂不支持。
    </p>
    <div class="browser-card">
      <p class="browser-card-title">推荐以下浏览器打开：</p>
      <ul class="browser-list">
        <li><span class="browser-name">Chrome / Edge 113+</span><span class="browser-platform">Android 或桌面端</span></li>
        <li><span class="browser-name">Safari iOS 17+</span><span class="browser-platform">iPhone 12 及以上</span></li>
      </ul>
    </div>
    <a href="https://developer.chrome.com/docs/web-platform/webgpu"
       target="_blank" rel="noopener" class="webgpu-link">了解 WebGPU →</a>
  </div>
</div>
```

## 样式规格
背景：#000000
提示页容器：position:fixed, 全屏, display:flex, center
图标 ≋：font-size:32px, color:#00c4e8
标题：font-size:20px, font-weight:500, color:#ffffff
说明：font-size:14px, color:#7a9bbf
browser-card：background:#0a1628, border:1px solid #1a3a5c, border-radius:8px
链接按钮：color:#00c4e8, border:1px solid #00c4e8, border-radius:6px

## 注意事项
- loading-indicator CSS display 完全由 CSS 控制，JS 用 style.display = '' 恢复（不写死 flex）
- 对比度全部满足 WCAG AA
- rel="noopener" 安全
