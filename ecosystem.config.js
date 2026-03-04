module.exports = {
  apps: [
    {
      name: 'aiq-app',
      script: 'server.js',
      cwd: '/www/wwwroot/aiq.qianshao.ai',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
      },
      env_file: '.env.local',
      // 日志路径
      out_file: '/www/wwwroot/aiq.qianshao.ai/logs/out.log',
      error_file: '/www/wwwroot/aiq.qianshao.ai/logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // 崩溃自动重启
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
    },
  ],
}
