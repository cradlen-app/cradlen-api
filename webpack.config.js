// Extends the default Nest CLI webpack config to resolve our TS path aliases
// (@common/*, @infrastructure/*, @builder/*, @core/*, @plugins/*, @config/*)
// in dev (`nest start --watch`) and production (`nest build`).
const path = require('path');

const layerAliases = {
  '@common': path.resolve(__dirname, 'src/common'),
  '@infrastructure': path.resolve(__dirname, 'src/infrastructure'),
  '@builder': path.resolve(__dirname, 'src/builder'),
  '@core': path.resolve(__dirname, 'src/core'),
  '@plugins': path.resolve(__dirname, 'src/plugins'),
  '@config': path.resolve(__dirname, 'src/config'),
};

module.exports = (options) => ({
  ...options,
  resolve: {
    ...options.resolve,
    alias: {
      ...(options.resolve?.alias ?? {}),
      ...layerAliases,
    },
    // Source uses NodeNext-style `.js` suffixes on TS imports — map them to `.ts`.
    extensionAlias: {
      ...(options.resolve?.extensionAlias ?? {}),
      '.js': ['.ts', '.js'],
    },
  },
});
