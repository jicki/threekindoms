// 构造对应修订的固定名单，避免旧存档夹带后续新增武将。
export function legacyRoster(game, revision = 9) {
  game.campaignRevision = revision;
  game.famousRoster = revision === 10 ? 2 : 1;
  game.officers.length = revision === 10 ? 273 : 265;
  return game;
}
