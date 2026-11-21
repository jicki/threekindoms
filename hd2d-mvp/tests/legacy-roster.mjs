import { OFFICER_ROSTER_REVISION, REGIONAL_REVISION, REGIONAL_OFFICERS, ADDITIONAL_OFFICERS } from '../src/core/regional-content.js';

// 构造对应修订的固定名单，避免旧存档夹带后续新增武将。
export function legacyRoster(game, revision = 9) {
  game.campaignRevision = revision;
  game.famousRoster = revision >= OFFICER_ROSTER_REVISION ? 3 : revision >= REGIONAL_REVISION ? 2 : 1;
  game.officers.length = 265 + (game.famousRoster >= 2 ? REGIONAL_OFFICERS.length : 0)
    + (game.famousRoster === 3 ? ADDITIONAL_OFFICERS.length : 0);
  return game;
}
