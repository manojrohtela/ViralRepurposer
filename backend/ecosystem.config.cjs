module.exports = {
  apps: [
    {
      name: "viral-repurposer-api",
      script: "src/server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: "8012",
      },
    },
  ],
};
