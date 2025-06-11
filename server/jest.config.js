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
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  testPathIgnorePatterns: ["/node_modules/"],
  extensionsToTreatAsEsm: [".ts"],
  globals: {
    "ts-jest": {
      useESM: true
    }
  },
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
