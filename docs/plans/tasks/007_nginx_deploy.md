# Task 007: Nginx 部署配置

## 依赖
Phase 1-6 全部完成

## 产物
修改 /etc/nginx/sites-available/lief-portfolio

## 新增 location 块（在现有 neon-shooter location 附近添加）

```nginx
location /webgpu-fluid {
    alias /root/lief-projects/webgpu-fluid/;
    index index.html;
    try_files $uri $uri/ /webgpu-fluid/index.html;

    location ~* \.html$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
    location ~* \.(js|css)$ {
        add_header Cache-Control "no-cache";
    }
    location ~* \.wgsl$ {
        add_header Content-Type "text/plain; charset=utf-8";
        add_header Cache-Control "no-cache";
    }
}
```

## 操作步骤
1. 读取 /etc/nginx/sites-available/lief-portfolio 找到合适的插入位置
2. 添加 location 块
3. nginx -t 验证语法
4. systemctl reload nginx
5. 验证：curl -I https://lief.liaolief.com/webgpu-fluid/

## 注意事项
- alias 路径末尾必须有 /
- 无 Vite content hash，不使用 immutable 缓存
- WebGPU 需要 HTTPS（Secure Context），lief.liaolief.com 已有 HTTPS
- COOP/COEP 头不需要（不用 SharedArrayBuffer）
