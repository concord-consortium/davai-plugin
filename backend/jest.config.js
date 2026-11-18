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
      useESM: true,
      // The main tsconfig limits "types" to node so the build can't see jest's globals.
      tsconfig: "tsconfig.test.json"
    }]
  },
  transformIgnorePatterns: [
    `/node_modules/(?!${transpileModules.join("|")}/)`
  ],
};
