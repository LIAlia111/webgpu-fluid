# Task 002: WebGPU 初始化模块

## 依赖
Phase 1 完成

## 产物
- /root/lief-projects/webgpu-fluid/src/webgpu-init.js

## 接口
export async function initWebGPU(canvas) → { device, context, canvasFormat }
所有错误均 throw，由 main.js catch

## 实现要求

```javascript
export async function initWebGPU(canvas) {
  if (!navigator.gpu) throw new Error('WebGPU_NOT_SUPPORTED');

  const TIMEOUT = 5000;
  const adapter = await Promise.race([
    navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }),
    new Promise((_, r) => setTimeout(() => r(new Error('WebGPU_TIMEOUT')), TIMEOUT))
  ]);
  if (!adapter) throw new Error('WebGPU_ADAPTER_NULL');

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxTextureDimension2D: 4096,
      maxStorageTexturesPerShaderStage: 4,
    }
  });

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU_CONTEXT_NULL');

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

  return { device, context, canvasFormat };
}
```

## 注意事项
- requiredLimits 在低端设备可能失败；如失败可降级重试（不带 requiredLimits）
- 不暴露任何错误信息到 DOM
- device.lost.then() 在 main.js 注册
