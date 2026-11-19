// 白兵与单挑共用当前武器的动作选用规则。素材与存档中的装备、武将数据分开。
import { data, weaponGroup } from './core/game.js';

const STYLES = ['sword', 'blade', 'spear', 'fan', 'bow'];
const GRID_WEAPONS = {
  'b-guojia-motion': 'sword',
  'b-sun-motion': 'bow',
  'b-wang-motion': 'bow',
  'b-zhen-motion': 'fan',
  'b-diao-motion': 'fan',
  'b-gao-motion': 'spear',
  'b-zhangxiu-motion': 'spear',
};

export const authoredGridWeapon = (ref) => Object.hasOwn(GRID_WEAPONS, ref) ? GRID_WEAPONS[ref] : null;
export const equippedWeaponStyle = (game, group) => game?.scenarioId && game.scenarioId !== 'original' ? STYLES[group] ?? null : null;

export function replacementWeaponMotion(game, id, group, personal) {
  const style = equippedWeaponStyle(game, group);
  if (!style) return null;
  // 弓扇需要确实画有该兵器的专用出手帧。只有人物名字或默认武器相同还不够。
  if (style === 'bow' || style === 'fan') return personal?.meta?.weapon === style ? null : style;
  const spec = data().officers[id];
  const original = authoredGridWeapon(spec?.visual?.motion) ?? STYLES[weaponGroup(spec?.weapon)];
  return original === style ? null : style;
}

export function riderStrip(sprites, game, { id, eq }, look) {
  const personal = sprites[`duel-${id}`];
  const replacement = replacementWeaponMotion(game, id, eq.wgrp, personal);
  return (replacement && sprites[`weapon-${replacement}`]) || personal
    || (sprites[`officer-${id}`] ? null : sprites[`duel-${look}`]);
}

// 第三行动作格为准备、出手、收招、受伤。弓的放箭事件放在切到松弦帧时。
export const BOW_POSES = ['bow_nock', 'bow_draw', 'bow_release'];
export const FAN_POSES = ['fan_ready', 'fan_sweep', 'fan_follow'];
export const BOW_CLIP = [['bow_nock', 150], ['bow_draw', 310], ['bow_release', 120, 'loose']];
export const FAN_CLIP = [['fan_ready', 180], ['fan_sweep', 110, 'hit'], ['fan_follow', 180]];
