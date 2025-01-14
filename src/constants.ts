export const DEBUG_SPEAKER = "Debug Log";
export const DAVAI_SPEAKER = "DAVAI";
export const USER_SPEAKER = "User";

export const GREETING = `Hello! I'm DAVAI, your Data Analysis through Voice and Artificial Intelligence partner.`;

// we don't send case-level information, only info about dataContexts, collections + attributes
// documentation about CODAP Data Interactive API notifications: https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API#codap-initiated-actions
export const notificationsToIgnore = [
  "selectCases",
  "moveCases",
  "createCases",
  "createItems",
  "updateCases"
];