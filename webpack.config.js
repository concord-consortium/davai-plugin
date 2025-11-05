'use strict';

const webpack = require('webpack');
const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const os = require('os');

// These environment variables are provided to the built code via the EnvironmentPlugin below
require('dotenv').config();

// DEPLOY_PATH is set by the s3-deploy-action its value will be:
// `branch/[branch-name]/` or `version/[tag-name]/`
// See the following documentation for more detail:
//   https://github.com/concord-consortium/s3-deploy-action/blob/main/README.md#top-branch-example
const DEPLOY_PATH = process.env.DEPLOY_PATH;

// Derive DAVAI_VERSION from DEPLOY_PATH to show it in the UI
const DAVAI_VERSION = DEPLOY_PATH ? DEPLOY_PATH.replace(/\/$/, '').split('/').pop() : 'local-build';

module.exports = (env, argv) => {
  const devMode = argv.mode !== 'production';

  return {
    context: __dirname, // to automatically find tsconfig.json
    devServer: {
      static: 'dist',
      hot: true,
      https: {
        key: path.resolve(os.homedir(), '.localhost-ssl/localhost.key'),
        cert: path.resolve(os.homedir(), '.localhost-ssl/localhost.pem'),
      },
      proxy: [
        // Proxy anything not available locally to codap3.concord.org
        // This makes it possible to load CODAP at https://localhost:8080/branch/main
        // and the plugin at https://localhost:8080/ this way the plugin can be
        // embedded in CODAP during development.
        {
          context: ['/'],
          target: 'https://codap3.concord.org',
          secure: true,
          changeOrigin: true,
        }
      ]
    },
    devtool: devMode ? 'eval-cheap-module-source-map' : 'source-map',
    entry: './src/index.tsx',
    mode: 'development',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'assets/index.[contenthash].js',
    },
    performance: { hints: false },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          loader: 'ts-loader',
        },
        // This code coverage instrumentation should only be added when needed. It makes
        // the code larger and slower
        process.env.CODE_COVERAGE ? {
          test: /\.[tj]sx?$/,
          loader: '@jsdevtools/coverage-istanbul-loader',
          options: { esModules: true },
          enforce: 'post',
          exclude: path.join(__dirname, 'node_modules'),
        } : {},
        {
          test: /\.(sa|sc|le|c)ss$/i,
          use: [
            devMode ? 'style-loader' : MiniCssExtractPlugin.loader,
            {
              loader: 'css-loader',
              options: {
                esModule: false,
                modules: {
                  // required for :import from scss files
                  // cf. https://github.com/webpack-contrib/css-loader#separating-interoperable-css-only-and-css-module-features
                  mode: 'icss',
                }
              }
            },
            'postcss-loader',
            'sass-loader',
          ]
        },
        {
          test: /\.(png|woff|woff2|eot|ttf)$/,
          type: 'asset',
        },
        { // disable svgo optimization for files ending in .nosvgo.svg
          test: /\.nosvgo\.svg$/i,
          loader: '@svgr/webpack',
          options: {
            svgo: false,
          }
        },
        {
          test: /\.svg$/i,
          exclude: /\.nosvgo\.svg$/i,
          oneOf: [
            {
              // Do not apply SVGR import in CSS files.
              issuer: /\.(css|scss|less)$/,
              type: 'asset',
            },
            {
              issuer: /\.tsx?$/,
              loader: '@svgr/webpack',
              options: {
                svgoConfig: {
                  plugins: [
                    {
                      // cf. https://github.com/svg/svgo/releases/tag/v2.4.0
                      name: 'preset-default',
                      params: {
                        overrides: {
                          // don't minify "id"s (i.e. turn randomly-generated unique ids into "a", "b", ...)
                          // https://github.com/svg/svgo/blob/master/plugins/cleanupIds.js
                          cleanupIds: { minify: false },
                          // leave <line>s, <rect>s and <circle>s alone
                          // https://github.com/svg/svgo/blob/master/plugins/convertShapeToPath.js
                          convertShapeToPath: false,
                          // leave "stroke"s and "fill"s alone
                          // https://github.com/svg/svgo/blob/master/plugins/removeUnknownsAndDefaults.js
                          removeUnknownsAndDefaults: { defaultAttrs: false },
                          // leave viewBox alone
                          removeViewBox: false
                        }
                      }
                    }
                  ]
                }
              }
            }
          ]
        }
      ]
    },
    resolve: {
      extensions: [ '.ts', '.tsx', '.js' ],
    },
    stats: {
      // suppress "export not found" warnings about re-exported types
      warningsFilter: /export .* was not found in/,
    },
    plugins: [
      new ESLintPlugin({
        extensions: ['ts', 'tsx', 'js', 'jsx'],
      }),
      new MiniCssExtractPlugin({
        filename: devMode ? 'assets/[name].css' : 'assets/[name].[contenthash].css',
      }),
      new HtmlWebpackPlugin({
        filename: 'index.html',
        template: 'src/index.html',
        favicon: 'src/public/favicon.ico',
        publicPath: '.',
      }),
      ...(DEPLOY_PATH ? [new HtmlWebpackPlugin({
        filename: 'index-top.html',
        template: 'src/index.html',
        favicon: 'src/public/favicon.ico',
        publicPath: DEPLOY_PATH
      })] : []),
      new CleanWebpackPlugin(),
      // Provide these environment variables to the built code
      new webpack.EnvironmentPlugin({
        NODE_ENV: process.env.NODE_ENV,        // standard
        DEPLOY_PATH,                           // not necessary but can't hurt
        DAVAI_VERSION,                         // derived from DEPLOY_PATH
        AUTH_TOKEN: process.env.AUTH_TOKEN,    // davai server token
        LANGCHAIN_SERVER_URL: process.env.LANGCHAIN_SERVER_URL,
        REACT_APP_OPENAI_BASE_URL: process.env.REACT_APP_OPENAI_BASE_URL,
        REACT_APP_OPENAI_API_KEY: process.env.REACT_APP_OPENAI_API_KEY,
      }),
    ]
  };
};
