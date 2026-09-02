module.exports = {
  apps: [
    {
      name: 'kasir-api',
      script: 'server/index.js',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
    },
    {
      name: 'kasir-frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: '--host 0.0.0.0 --port 5173',
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
