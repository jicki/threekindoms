// 期限覆盖响应体。服务器已发出响应头但中途停止传输时，也会取消请求。
export async function readResource(url, read, { timeout = 8000, ...options } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error(`读取 ${url} 失败（HTTP ${response.status}）`), { status: response.status });
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`读取 ${url} 超时`, { cause: error });
    throw error;
  } finally { clearTimeout(timer); }
}

export function readImage(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = () => { clearTimeout(timer); image.onload = image.onerror = null; };
    const timer = setTimeout(() => {
      finish(); image.removeAttribute('src'); reject(new Error(`读取 ${url} 超时`));
    }, timeout);
    image.onload = () => { finish(); resolve(image); };
    image.onerror = () => { finish(); reject(new Error(`读取 ${url} 失败`)); };
    image.src = url;
  });
}
