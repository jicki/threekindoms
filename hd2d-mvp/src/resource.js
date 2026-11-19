// 期限覆盖响应体。服务器已发出响应头但中途停止传输时，也会取消请求。
export async function readResource(url, read, { timeout = 8000, ...options } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`读取 ${url} 失败（HTTP ${response.status}）`);
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`读取 ${url} 超时`, { cause: error });
    throw error;
  } finally { clearTimeout(timer); }
}
