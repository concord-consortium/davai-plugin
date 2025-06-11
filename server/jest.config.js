const transpileModules = [
  "dotenv",
  "express",
  "jsdom",
  "nanoid",
  "zod"
];

export default {
  preset: "ts-jest/presets/js-with-ts",
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.(js)$": "babel-jest"
  },
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  testPathIgnorePatterns: ["/node_modules/"],
  coveragePathIgnorePatterns: ["/node_modules/"],
  transformIgnorePatterns: [
    `/node_modules/(?!${transpileModules.join("|")}/)`
  ],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  moduleFileExtensions: ["ts", "js", "json"]
};
