const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'GitHub',
  },
  app: {
    model: 'GitHub',
    exclude: [
      'github-api.json',
      'src/index.backup.js',
      'build-scripts/**',
    ],
  },
})
