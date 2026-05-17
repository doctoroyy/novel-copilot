/**
 * @cloudflare/playwright 的 shim
 *
 * 本地环境不支持 Cloudflare Browser Rendering，
 * 提供空实现以避免导入错误。
 */

export function launch(_browserBinding?: unknown): Promise<any> {
  return Promise.reject(
    new Error(
      '[本地模式] Cloudflare Browser Rendering 不可用。番茄热榜采集功能需要在线模式才能使用。',
    ),
  );
}

export default { launch };
