const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'FreshBooks',
  },

  app: {
    model: 'FreshBooksService',
    exclude: [],
  },
})
