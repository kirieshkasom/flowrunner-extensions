const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'Deel',
  },

  app: {
    model: 'DeelService',
    exclude: [],
  },
})
