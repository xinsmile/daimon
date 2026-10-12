// pm2 进程守护配置：在项目根目录执行 `pm2 start deploy/ecosystem.config.js`
// 前置：已 `npm install && npm run build`（生成本文件引用的 dist/cli.js）
module.exports = {
  apps: [
    {
      name: "daimon",
      script: "dist/cli.js",
      args: "serve --host 0.0.0.0 --port 3000 --config config.yaml --data-dir ./data",
      cwd: process.cwd(),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "512M",
      env: { NODE_ENV: "production" },
      // 密钥 / 令牌按需在此或通过 `pm2 env` / shell 环境变量注入（勿提交明文）
      // env: { DAEMON_API_TOKEN: "change-me", AGNES_API_KEYS: "key1,key2" },
      error_file: "./data/pm2-daimon-error.log",
      out_file: "./data/pm2-daimon-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
