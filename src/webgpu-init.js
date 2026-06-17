/**
 * WebGPU initialization module.
 * Throws descriptive errors on failure; caller decides how to handle.
 */
const INIT_TIMEOUT_MS = 5000;

export async function initWebGPU(canvas) {
  if (!navigator.gpu) {
    throw new Error('WebGPU_NOT_SUPPORTED');
  }

  const adapterPromise = navigator.gpu.requestAdapter({
    powerPreference: 'high-performance'
  });
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('WebGPU_TIMEOUT')), INIT_TIMEOUT_MS)
  );

  const adapter = await Promise.race([adapterPromise, timeoutPromise]);
  if (!adapter) throw new Error('WebGPU_ADAPTER_NULL');

  let device;
  try {
    device = await adapter.requestDevice({
      requiredLimits: {
        maxTextureDimension2D: 4096,
        maxStorageTexturesPerShaderStage: 4,
      }
    });
  } catch {
    // Fallback: try without required limits (some low-end devices)
    try {
      device = await adapter.requestDevice();
    } catch (e2) {
      throw new Error('WebGPU_DEVICE_FAILED');
    }
  }

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU_CONTEXT_NULL');

  // Use dynamic format (getPreferredCanvasFormat) instead of hardcoded bgra8unorm
  // iOS Safari prefers rgba8unorm; hardcoded format causes init failure on those devices
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: canvasFormat,
    alphaMode: 'opaque',
  });

  return { device, context, canvasFormat };
}
