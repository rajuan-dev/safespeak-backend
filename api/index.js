const { createApp } = require('../dist/app');
const { bootstrapApp } = require('../dist/bootstrap');

const app = createApp();

module.exports = async (req, res) => {
  await bootstrapApp();
  return app(req, res);
};
