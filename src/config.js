/** 生产环境留空，由 Nginx 同域反代；也可设为 https://3dgisdevelopment.top */
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
