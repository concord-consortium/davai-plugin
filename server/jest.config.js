const transpileModules = [
  "@langchain",
  "dotenv",
  "express",
  "jsdom",
  "langchain",
  "nanoid",
  "zod"
];

export default {
  coveragePathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "js", "json"],
  // moduleNameMapper: {
  //   "^(\\.{1,2}/.*)\\.js$": "$1"
  // },
  preset: "ts-jest/presets/js-with-ts",
  testEnvironment: "node",
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  testPathIgnorePatterns: ["/node_modules/"],
  transform: {
    "^.+\\.(js)$": "babel-jest"
  },
  transformIgnorePatterns: [
    `/node_modules/(?!${transpileModules.join("|")}/)`
  ],
};
