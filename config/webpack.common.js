'use strict';

const SizePlugin = require('size-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const PATHS = require('./paths');

// To re-use webpack configuration across templates,
// CLI maintains a common webpack configuration file - `webpack.common.js`.
// Whenever user creates an extension, CLI adds `webpack.common.js` file
// in template's `config` folder
const common = {
  resolve: {
    alias: {
      docx$: require.resolve('docx').replace(/index\.cjs$/, 'index.mjs'),
    },
  },
  output: {
    // the build folder to output bundles and assets in.
    path: PATHS.build,
    // the filename template for entry chunks
    filename: '[name].js',
    // MV3 disallows dynamic code generation, including Webpack's global-object fallback.
    globalObject: 'globalThis',
    environment: {
      globalThis: true,
    },
    // clean build folder before emitting new files
    clean: true,
  },
  optimization: {
    emitOnErrors: false,
  },
  devtool: false,
  stats: {
    all: false,
    errors: true,
    builtAt: true,
  },
  module: {
    rules: [
      {
        test: /node_modules\/docx\/dist\/index\.mjs$/,
        enforce: 'pre',
        use: [require.resolve('./mv3-safe-docx-loader')],
      },
      // Help webpack in understanding CSS files imported in .js files
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
      // Check for images imported in .js files and
      {
        test: /\.(png|jpe?g|gif)$/i,
        use: [
          {
            loader: 'file-loader',
            options: {
              outputPath: 'images',
              name: '[name].[ext]',
            },
          },
        ],
      },
      {
        test: /\.xml$/i,
        type: 'asset/source',
      },
    ],
  },
  plugins: [
    // Print file sizes
    new SizePlugin(),
    // Copy static assets from `public` folder to `build` folder
    new CopyWebpackPlugin({
      patterns: [
        {
          from: '**/*',
          context: 'public',
        },
        {
          from: PATHS.src + '/jquery-3.7.0.js',
          to: 'jquery-3.7.0.js',
        },
        {
          from: PATHS.src + '/all.min.css',
          to: 'all.min.css',
        },
        {
          from: PATHS.src + '/all.min.js',
          to: 'all.min.js',
        },
        {
          from: PATHS.src + '/webfonts',
          to: 'webfonts',
        },
      ]
    }),
    // Extract CSS into separate files
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
  ],
};

module.exports = common;
