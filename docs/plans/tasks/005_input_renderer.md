# Task 005: 触控输入 + 渲染主循环

## 依赖
Phase 4（fluid-sim.js）

## 产物
- /root/lief-projects/webgpu-fluid/src/touch-handler.js
- /root/lief-projects/webgpu-fluid/src/renderer.js

## TouchHandler 类接口
export class TouchHandler {
  constructor(canvas)
  getSplats(dt) → Splat[]  // 返回本帧 splat 列表，清空内部缓存
  destroy()
}

## Splat 结构
{ u, v, dx, dy, color: [r,g,b], radius }

## 事件注册（passive: false）
touchstart, touchmove, touchend, touchcancel → canvas
mousedown, mousemove, mouseup, mouseleave → canvas

## 颜色方案（5 色循环）
[0.0, 0.78, 0.91] 青蓝
[0.0, 0.91, 0.63] 青绿
[0.7, 0.9,  1.0 ] 浅蓝白
[0.4, 0.6,  1.0 ] 蓝紫
[0.0, 0.6,  0.85] 深青

颜色索引：touchId % 5（鼠标用 0）

## 坐标转换
getBoundingClientRect()
u = (clientX - rect.left) / rect.width
v = (clientY - rect.top) / rect.height

## 速度向量
dx = (currU - prevU) * SPLAT_FORCE / dt
dy = (currV - prevV) * SPLAT_FORCE / dt
静止触点（|dx|+|dy| < 1e-4）不生成 splat

## touchmove 处理
用 changedTouches（不是 touches）
用 touch.identifier 稳定追踪多点

## Renderer 类接口
export class Renderer {
  constructor(fluidSim, touchHandler)
  start()
  stop()
}

## Renderer 主循环
requestAnimationFrame 驱动
dt = clamp((now - last) / 1000, 1/120, 1/30)
splats = touchHandler.getSplats(dt)
fluidSim.step(dt, splats)

## FPS 计数器（开发模式）
判断条件：window.location.hostname === 'localhost' || window.location.port !== ''
右上角 div#fps-counter，半透明黑色背景，青蓝文字
fps < 30 时变红色预警

## 注意事项
- 事件处理函数在 constructor 中 bind，以便 removeEventListener
- touchcancel 映射到 onTouchEnd（清除触点状态）
- 鼠标 mouseleave 清除鼠标状态
- import.meta.env.DEV 不可用（无 Vite）
