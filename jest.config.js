const transpileModules = [
  "@langchain",
  "react-markdown",
  "tone",
  "bail",
  "comma-separated-tokens",
  "decode-named-character-reference",
  "devlop",
  "estree-util-is-identifier-name",
  "hast-util-to-jsx-runtime",
  "hast-util-whitespace",
  "html-url-attributes",
  "is-plain-obj",
  "langchain",
  "mdast-util-from-markdown",
  "mdast-util-to-string",
  "mdast-util-to-hast",
  "micromark",
  "nanoid",
  "property-information",
  "remark-parse",
  "remark-rehype",
  "space-separated-tokens",
  "trim-lines",
  "trough",
  "unified",
  "unist-util-is",
  "unist-util-position",
  "unist-util-stringify-position",
  "unist-util-visit",
  "vfile",
  "vfile-message"
];

module.exports = {
  preset: "ts-jest/presets/js-with-ts",
  setupFilesAfterEnv: ["<rootDir>/src/test/setupTests.ts"],
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.tsx?$": "ts-jest",
    "^.+\\.(js|jsx)$": "babel-jest"
  },
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  testPathIgnorePatterns: ["/node_modules/", "/cypress/"],
  coveragePathIgnorePatterns: ["/node_modules/", "src/utilities/test-utils.ts"],
  transformIgnorePatterns: [
    // "/node_modules/(?!react-markdown|bail|comma-separated-tokens|decode-named-character-reference|devlop|estree-util-is-identifier-name|hast-util-to-jsx-runtime|hast-util-whitespace|html-url-attributes|is-plain-obj|mdast-util-from-markdown|mdast-util-to-string|mdast-util-to-hast|micromark|property-information|remark-parse|remark-rehype|space-separated-tokens|trim-lines|trough|unified|unist-util-is|unist-util-position|unist-util-stringify-position|unist-util-visit|vfile|vfile-message/)"
    `/node_modules/(?!${transpileModules.join("|")}/)`
  ],
  moduleNameMapper: {
    "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$": "<rootDir>/__mocks__/fileMock.js",
    "\\.(css|less|sass|scss)$": "identity-obj-proxy",
    "^tone$": "<rootDir>/__mocks__/tone.js",
    "react-markdown": "<rootDir>/node_modules/react-markdown/index.js"
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"]
};
