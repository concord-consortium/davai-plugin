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
  extensionsToTreatAsEsm: [".ts"],
  globals: {
    "ts-jest": {
      useESM: true
    }
  },
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  testPathIgnorePatterns: ["/node_modules/"],
  transform: {
    "^.+\\.(js)$": "babel-jest",
    "^.+\\.ts$": ["ts-jest", {
      useESM: true
    }]
  },
  transformIgnorePatterns: [
    `/node_modules/(?!${transpileModules.join("|")}/)`
  ],
};
