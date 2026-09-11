import { createElement, buildSceneDescription, buildOptionButton, addDirectionMarker, getItemLabel, isResourcePool, resetOptionsPanel } from '../core/utils.js';
import { CHECK_KEYS, CSS, FLAG_KEYS, GOLD_ITEM_ID, LOG, MAX_D20_ROLL } from '../core/config.js';
import { evaluateCondition } from './condition.js';
import { formatList, translateOr } from '../core/i18n.js';
import { roll, rollTable } from './dice.js';
import { resolveTimeCost } from './time.js';
import {
  runCheckAttempt, checkPresentation, normalizeOutcomes,
  getAttempts, isResolved, resetAttempts,
  spendRetryCost, pickVariant,
  rollBreakdown, skillLabel
} from './skill-checks.js';

// Scene rendering: the description, the options panel, the skill checks, and
// the moves between scenes.
export class SceneRenderer {
  constructor(engine) {
    this.engine = engine;
    // So an options re-render does not append the description again.
    this.lastRenderedSceneId = null;
    this.lastRenderedDesc = null;
  }

  reset() {
    this.lastRenderedSceneId = null;
    this.lastRenderedDesc = null;
  }

  // After a load: sync the cache so the next render does not repeat the
  // description, and rebuild the options without a new narrative block.
  restoreFromSave(sceneId, lastDesc) {
    if (lastDesc !== null) {
      this.lastRenderedSceneId = sceneId;
      this.lastRenderedDesc = lastDesc;
    }
    const scene = this.engine.data.scenes[sceneId];
    if (scene) {
      this.engine.audio?.syncAmbience(scene);
      this.renderOptions(scene);
    }
  }

  // No-op in combat. skipAutoAttack is for the post-victory re-render, so a
  // won ambush does not restart itself.
  render(sceneId, { skipAutoAttack = false } = {}) {
    if (this.engine.inCombat) return;

    const scene = this.engine.data.scenes[sceneId];
    if (!scene) {
      console.error(`Scene ${sceneId} not found!`);
      return;
    }

    // Passive checks roll before the description resolves, so its variants
    // see the flags they set; their narration logs after it.
    const passiveTexts = this._rollPassiveChecks(scene, sceneId);

    // Attempt counters reset on entry only; a same-scene re-render must not
    // refill maxAttempts budgets mid-visit.
    const isEntry = this.engine.state.getCurrentSceneId() !== sceneId;

    // Visited before current: the current-scene notification redraws the map.
    this.engine.state.addVisitedScene(sceneId);
    this.engine.state.setCurrentSceneId(sceneId);

    this._appendSceneDescription(scene, sceneId);
    this.engine.audio?.syncAmbience(scene);

    passiveTexts.forEach(text => this.engine.log(LOG.NARRATOR, text));
    if (isEntry) this._resetSkillAttempts(scene, sceneId);
    this._awardSceneXP(scene, sceneId);
    this.renderOptions(scene);

    // After the options render, so a listener may replace the panel with a UI
    // of its own. isEntry separates arrival from a re-render; startsCombat is
    // decided before the emit because a listener opening a UI on arrival
    // cannot otherwise know a fight is about to take the screen.
    const startsCombat = !skipAutoAttack && this._autoAttackDue(scene);
    this.engine.emit('scene:entered', { sceneId, scene, isEntry, startsCombat });

    if (startsCombat) {
      // The scene description rendered a moment ago is this encounter's
      // framing, so the fight doesn't re-describe the enemy on top of it.
      this.engine.combatSystem.startCombat(scene.autoAttack.enemies, scene.autoAttack, { fromSceneEntry: true });
      return;
    }

    this.engine.scrollNarrativeToBottom();
  }

  // A new narrative block, only when the scene or its description changed.
  _appendSceneDescription(scene, sceneId) {
    const currentDesc = this._resolveDescription(scene);
    if (this.lastRenderedSceneId === sceneId && this.lastRenderedDesc === currentDesc) return;

    this.engine.openScene();
    const descEl = buildSceneDescription(scene.title || scene.name, currentDesc, this.engine.t);
    this.engine.currentSceneEl.appendChild(descEl);
    this.engine.state.appendLog({ type: 'scene', title: scene.title || scene.name, desc: currentDesc });

    this.lastRenderedSceneId = sceneId;
    this.lastRenderedDesc = currentDesc;
  }

  // Rolled once per game on first entry, writing pass/fail into an authored
  // flag. Returns the success texts to narrate after the description.
  _rollPassiveChecks(scene, sceneId) {
    const texts = [];
    (scene.passiveChecks || []).forEach((check, i) => {
      if (!check.skillCheck || !check.flag) return;
      const doneKey = FLAG_KEYS.passiveDone(sceneId, i);
      if (this.engine.state.getFlag(doneKey)) return;
      this.engine.state.setFlag(doneKey, true);
      const mod = this.engine.state.getPlayer().attributes[check.skillCheck] ?? 0;
      const success = roll(1, MAX_D20_ROLL) + mod >= (check.dc ?? 10);
      this.engine.state.setFlag(check.flag, success);
      if (success && check.text) texts.push(check.text);
    });
    return texts;
  }

  // Once per game; in render(), because rendering buttons must never mutate
  // progression.
  _awardSceneXP(scene, sceneId) {
    if (!scene.xpReward) return;
    const xpFlag = FLAG_KEYS.xpAwarded(sceneId);
    if (this.engine.state.getFlag(xpFlag)) return;
    this.engine.state.addXP(scene.xpReward);
    this.engine.state.setFlag(xpFlag, true);
    this.engine.log(LOG.SYSTEM, this.engine.t('loot.xpGained', { amount: scene.xpReward }), 'loot');
  }

  // Retry wording starts fresh on re-entry; resolved checks stay resolved.
  _resetSkillAttempts(scene, sceneId) {
    (scene.skills || []).forEach(opt => {
      if (!opt.skillCheck) return;
      resetAttempts(this.engine.state, CHECK_KEYS.skillDc(opt.skillCheck, sceneId));
    });
  }

  // Whether the scene's autoAttack encounter starts on this render — decided
  // before scene:entered is emitted so listeners know a fight is coming.
  _autoAttackDue(scene) {
    return !!scene.autoAttack && evaluateCondition(scene.autoAttack.condition, this.engine.state);
  }

  renderOptions(scene) {
    const { container: optionsContainer, talkContainer, actionsContainer, skillsContainer } = resetOptionsPanel(scene.title || scene.name);

    const navOpts = [];
    const backOpts = [];
    const talkOpts = [];
    const actionOpts = [];

    // Sinks to the bottom. Detected by action type or the isBack flag, never
    // by the words in the text.
    const isBackOption = (opt) => {
      if (opt.isBack === true) return true;
      return opt.actions?.some(a => a.type === 'return') ?? false;
    };

    // The section follows from what the pipeline does: moves in the unheaded
    // list, talk under its heading, everything else under Actions.
    const startsAction = (opt, type) => opt.actions?.some(a => a.type === type) ?? false;

    // Where an option leads, as a scene id; whether the move has a direction
    // is addDirectionMarker's question. An unknown destination is validate.js's.
    const destinationOf = (opt) => (opt.actions || [])
      .find(a => a.type === 'navigate' && this.engine.data.scenes[a.destination])?.destination;

    (scene.options || []).forEach(opt => {
      if (!evaluateCondition(opt.condition, this.engine.state)) return;

      if (isBackOption(opt)) {
        backOpts.push(opt);
      } else if (startsAction(opt, 'navigate')) {
        navOpts.push(opt);
      } else if (startsAction(opt, 'dialogue')) {
        talkOpts.push(opt);
      } else {
        actionOpts.push(opt);
      }
    });

    const renderOptionBtn = (opt, target = optionsContainer, extraStats = null) => {
      let reqText = null;
      let disabled = false;
      if (opt.requirements?.item) {
        const totalCount = this.engine.state.countPlayerItem(opt.requirements.item);
        if (totalCount <= 0) {
          disabled = true;
          reqText = this.engine.t('ui.itemRequires', { name: getItemLabel(this.engine.data.items, opt.requirements.item) });
        }
      }

      const stats = [...(extraStats ?? []), ...(reqText ? [reqText] : [])];
      const btn = buildOptionButton(opt.text, stats.length ? stats : null);

      // The destination rides on the button for the minimap peek (ui.js).
      const destId = destinationOf(opt);
      if (destId) {
        addDirectionMarker(this.engine, scene, this.engine.data.scenes[destId], btn);
        btn.dataset.destination = destId;
      }

      if (disabled) btn.disabled = true;
      btn.onclick = () => this.handleOption(opt);
      target.appendChild(btn);
      return btn;
    };

    // Opened up front and swept at the end, so a decorator can append to a
    // section without knowing whether the scene filled it.
    const openSection = (container, headingKey) => {
      container.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t(headingKey)));
      container.removeAttribute('hidden');
    };
    const sweepSection = (container) => {
      if (container.querySelector('button')) return;
      container.replaceChildren();
      container.setAttribute('hidden', '');
    };

    openSection(talkContainer, 'ui.conversationsHeading');
    openSection(actionsContainer, 'ui.actionsHeading');

    navOpts.forEach(opt => renderOptionBtn(opt));
    talkOpts.forEach(opt => renderOptionBtn(opt, talkContainer));
    // Authored order. A rest's card says what it does; the short rest disables
    // rather than hides at an empty pool, so what a full rest restores stays visible.
    actionOpts.forEach(opt => {
      if (startsAction(opt, 'full_rest')) {
        renderOptionBtn(opt, actionsContainer, this._fullRestStats());
      } else if (startsAction(opt, 'short_rest')) {
        const btn = renderOptionBtn(opt, actionsContainer, this._shortRestStats());
        const pool = this.engine.state.getPlayer().resources?.[this.engine.data.rules?.shortRest?.resource];
        if (pool?.current < 1) btn.disabled = true;
      } else {
        renderOptionBtn(opt, actionsContainer);
      }
    });

    const skillBtns = [];
    const sceneId = this.engine.state.getCurrentSceneId();

    (scene.skills || []).forEach((opt, i) => {
      if (!opt.skillCheck) return;
      if (!evaluateCondition(opt.condition, this.engine.state)) return;

      const items = opt.items || [];
      let btn;
      if (items.length) {
        btn = this._buildItemDiscoveryButton(opt, i, sceneId, scene);
      } else if (!opt.dc) {
        btn = this._buildNarrativeButton(opt, i, sceneId, scene);
      } else {
        btn = this._buildPassFailButton(opt, i, sceneId, scene);
      }
      if (btn) skillBtns.push(btn);
    });

    if (skillBtns.length > 0) {
      const heading = createElement('div', CSS.SECTION_HEADING, this.engine.t('ui.skillsHeading'));
      skillsContainer.appendChild(heading);
      skillBtns.forEach(b => skillsContainer.appendChild(b));
      skillsContainer.removeAttribute('hidden');
    }

    // Decorators get the headed sections too, so a plugin's act sits with the
    // scene's acts instead of among its doors.
    const sections = { conversations: talkContainer, actions: actionsContainer };
    for (const decorator of this.engine.sceneDecorators) {
      if (decorator.options) decorator.options(scene, optionsContainer, this.engine, sections);
    }

    backOpts.forEach(opt => renderOptionBtn(opt));
    sweepSection(talkContainer);
    sweepSection(actionsContainer);
  }

  // The short rest's card lines: the heal and the pool's remaining uses. Null
  // when rules.shortRest is not wired to a pool, so the act still renders.
  _shortRestStats() {
    const config = this.engine.data.rules?.shortRest;
    if (!config?.resource) return null;
    const pool = this.engine.state.getPlayer().resources?.[config.resource];
    if (!isResourcePool(pool)) return null;

    return [
      this.engine.t('ui.restHealing', { value: String(config.heal ?? 1) }),
      this.engine.t('ui.shortRestRemaining', { current: pool.current, max: pool.max }),
    ];
  }

  // The full rest's card lines, from the same rules handleFullRest reads.
  _fullRestStats() {
    const t = this.engine.t;
    const resourceLabel = (id) => translateOr(t, `ui.resources.${id}`, id);
    const lines = [t('ui.restHealing', { value: t('ui.restFull') })];
    const retry = this.engine.data.rules?.skillRetry;
    if (retry?.resource && retry.restRestore > 0) {
      lines.push(t('ui.restRestores', { resource: resourceLabel(retry.resource), value: `+${retry.restRestore}` }));
    }
    const shortRest = this.engine.data.rules?.shortRest;
    if (shortRest?.resource) {
      lines.push(t('ui.restRestores', { resource: resourceLabel(shortRest.resource), value: t('ui.restFull') }));
    }
    return lines;
  }

  handleOption(opt) {
    if (this.engine.isGameOver) return; // only Load/Restart act after death
    if (opt.log !== false) this.engine.log(LOG.PLAYER, opt.text, 'choice');

    this._chargeTime(opt, this._optionCostKind(opt));

    const didNavigate = this.engine.snapshotNavigation();
    this.engine.runActions(opt.actions || []);

    // Flag changes take effect at once when nothing navigated.
    if (!didNavigate()) {
      const scene = this.engine.data.scenes[this.engine.state.getCurrentSceneId()];
      if (scene) this.renderOptions(scene);
    }
  }

  // Which rules.time.defaultCosts kind a plain option charges: a move the
  // travel cost, a full rest the rest cost, anything else nothing.
  _optionCostKind(opt) {
    const actions = opt.actions || [];
    if (actions.some(a => a.type === 'navigate' || a.type === 'return')) return 'navigate';
    if (actions.some(a => a.type === 'full_rest')) return 'fullRest';
    return null;
  }

  // Charged before any pipeline that can navigate, so a timer that fires can
  // set flags the destination already sees. Checks charge after their roll,
  // so time reads as a consequence of the attempt.
  _chargeTime(opt, kind) {
    const cost = resolveTimeCost(opt.timeCost, kind, this.engine.data.rules);
    if (cost > 0) this.engine.advanceTime(cost);
  }

  // One discovery entry's state, namespaced under `disc_<index>` in the map
  // every check of the same skill shares; replacing the whole map would wipe
  // the siblings. Older saves kept it at the top level, adopted by entry 0.
  _readDiscoveryState(skillKey, i, items) {
    const map = this.engine.state.getCheckState(skillKey);
    const state = typeof map === 'object' && map !== null ? map[`disc_${i}`] : null;
    if (state?.found) return state;
    if (i === 0 && map?.found) {
      // `found` is padded or truncated to the current item list.
      return {
        found: items.map((_, idx) => map.found[idx] ?? false),
        tries: map.tries,
        resolved: map.resolved,
      };
    }
    return { found: items.map(() => false) };
  }

  // Clears the legacy top-level fields the entry supersedes.
  _saveDiscoveryState(skillKey, i, state) {
    const existing = this.engine.state.getCheckState(skillKey);
    const map = typeof existing === 'object' && existing !== null ? existing : {};
    delete map.found;
    delete map.tries;
    delete map.resolved;
    delete map.dcs;
    map[`disc_${i}`] = state;
    this.engine.state.setCheckState(skillKey, map);
  }

  // A roll against per-item DCs. Null once everything is found or the check
  // is retired.
  _buildItemDiscoveryButton(opt, i, sceneId, scene) {
    const skillKey = CHECK_KEYS.skillDc(opt.skillCheck, sceneId);
    const items = opt.items;
    const state = this._readDiscoveryState(skillKey, i, items);
    if (state.resolved || state.found.every(f => f)) return null;

    const lowestDc = this._lowestHiddenDc(items, state);
    const p = checkPresentation(this.engine, opt, state.tries || 0, lowestDc);
    const btn = buildOptionButton(p.displayText, p.badge);
    if (p.blocked) {
      btn.disabled = true;
      return btn;
    }
    btn.onclick = () => {
      if (this.engine.isGameOver) return;
      this.engine.log(LOG.PLAYER, p.displayText, 'choice');
      spendRetryCost(this.engine, p.gate);
      this._resolveDiscovery(opt, i, state, skillKey, scene);
    };
    return btn;
  }

  // The easiest still-hidden item's DC, which the badge advertised.
  _lowestHiddenDc(items, state) {
    return Math.min(...items.map(l => l.dc ?? 10).filter((_, idx) => !state.found[idx]));
  }

  // One roll against every still-hidden item's DC; an exhausted maxAttempts
  // budget retires the check and runs onExhausted.
  _resolveDiscovery(opt, i, state, skillKey, scene) {
    const items = opt.items;
    const mod = this.engine.state.getPlayer().attributes[opt.skillCheck] ?? 0;
    const baseRoll = roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + mod;
    const lowestDc = this._lowestHiddenDc(items, state);

    const newlyFound = [];
    items.forEach((l, idx) => {
      if (state.found[idx]) return;
      if (hitRoll >= (l.dc ?? 10)) { state.found[idx] = true; newlyFound.push(l); }
    });

    const anyFound = newlyFound.length > 0;
    const stillMore = anyFound && !state.found.every(f => f);
    const msgKey = anyFound
      ? (stillMore ? 'actions.lookAroundFoundMore' : 'actions.lookAroundFound')
      : 'actions.lookAroundFail';
    const variant = anyFound ? 'loot' : 'system';
    this.engine.log(LOG.SYSTEM, this.engine.t('actions.lookAroundRoll', {
      roll: hitRoll,
      dc: lowestDc,
      breakdown: rollBreakdown(baseRoll, mod, skillLabel(this.engine, opt.skillCheck)),
    }), variant);
    // Its own entry, so it groups under the roll line like combat's damage.
    this.engine.log(LOG.SYSTEM, this.engine.t(msgKey), variant);

    this._awardDiscoveredLoot(newlyFound);
    this._chargeTime(opt, 'skillAttempt');

    state.tries = (state.tries || 0) + 1;
    const allFound = state.found.every(f => f);
    const exhausted = !allFound && opt.maxAttempts && state.tries >= opt.maxAttempts;
    if (opt.resolveOnce || exhausted) state.resolved = true;
    this._saveDiscoveryState(skillKey, i, state);

    if (exhausted && opt.onExhausted?.length) {
      const didNavigate = this.engine.snapshotNavigation();
      this.engine.runActions(opt.onExhausted);
      if (didNavigate()) return;
    }
    this.renderOptions(scene);
  }

  // Rolls tables into drops, aggregates duplicates, awards, and logs one line.
  _awardDiscoveredLoot(newlyFound) {
    const drops = [];
    newlyFound.forEach(l => {
      if (l.table) {
        for (let i = 0; i < (l.itemDrops ?? 1); i++) {
          const resolved = rollTable(this.engine.data.tables[l.table]);
          if (resolved) drops.push(resolved);
        }
      } else {
        drops.push(l);
      }
    });

    const aggregated = new Map();
    drops.forEach(d => {
      const existing = aggregated.get(d.item);
      if (existing) existing.amount += (d.amount ?? 1);
      else aggregated.set(d.item, { item: d.item, amount: d.amount ?? 1 });
    });

    const lootItems = [];
    aggregated.forEach(d => {
      if (d.item === GOLD_ITEM_ID) {
        this.engine.state.modifyPlayerStat('gold', d.amount);
        lootItems.push(`${d.amount} ${this.engine.t('loot.gold')}`);
      } else {
        this.engine.state.addToInventory(d.item, d.amount);
        lootItems.push(getItemLabel(this.engine.data.items, d.item, d.amount));
      }
    });

    if (lootItems.length === 0) return;

    const list = formatList(this.engine.language, lootItems);
    this.engine.log(LOG.SYSTEM, this.engine.t('loot.foundItems', { list }), 'loot');
  }

  // A story beat framed as a skill: no roll, no DC. Retires after one use
  // unless repeatable.
  _buildNarrativeButton(opt, i, sceneId, scene) {
    const skillKey = CHECK_KEYS.skillDc(opt.skillCheck, sceneId);
    const state = this.engine.state.getCheckState(skillKey);
    // Older saves stored a bare `true` at this key for a used flavor check.
    const uses = state === true ? 1 : (state?.[`uses_${i}`] || 0);
    if (uses > 0 && !opt.repeatable) return null;

    const badge = translateOr(this.engine.t, `actions.skillBadgeFree.${opt.skillCheck}`, this.engine.t('actions.lookAroundBadge'));

    const btn = buildOptionButton(opt.text, badge);
    btn.onclick = () => {
      if (this.engine.isGameOver) return;
      const map = typeof state === 'object' && state !== null ? state : {};
      map[`uses_${i}`] = uses + 1;
      this.engine.state.setCheckState(skillKey, map);
      this.engine.log(LOG.PLAYER, opt.text, 'choice');

      if (opt.resultText) {
        this.engine.log(LOG.NARRATOR, pickVariant(opt.resultText, uses));
      } else {
        this.engine.log(LOG.SYSTEM, this.engine.t('actions.lookAroundEmpty'));
      }

      // No skillAttempt default cost: a beat is free unless it says otherwise.
      this._chargeTime(opt, null);

      const didNavigate = this.engine.snapshotNavigation();
      this.engine.runActions(normalizeOutcomes(opt).success.actions);
      if (!didNavigate()) this.renderOptions(scene);
    };
    return btn;
  }

  // Resolved against the outcome tiers by runCheckAttempt. Null once retired.
  _buildPassFailButton(opt, i, sceneId, scene) {
    const skillKey = CHECK_KEYS.skillDc(opt.skillCheck, sceneId);
    if (isResolved(this.engine.state, skillKey, i)) return null;
    const p = checkPresentation(this.engine, opt, getAttempts(this.engine.state, skillKey, i));
    const btn = buildOptionButton(p.displayText, p.badge);
    if (p.blocked) {
      btn.disabled = true;
      return btn;
    }
    btn.onclick = () => {
      if (this.engine.isGameOver) return;
      this.engine.log(LOG.PLAYER, p.displayText, 'choice');
      spendRetryCost(this.engine, p.gate);
      runCheckAttempt(this.engine, opt, {
        attemptKey: skillKey,
        entryKey: i,
        runActions: (actions) => this.engine.runActions(actions),
        didNavigate: this.engine.snapshotNavigation(),
        chargeTime: () => this._chargeTime(opt, 'skillAttempt'),
        rerender: () => this.renderOptions(scene),
        // A success may set flags a description variant reads.
        rerenderSuccess: () => this.engine.renderScene(this.engine.state.getCurrentSceneId()),
      });
    };
    return btn;
  }

  // The description string to display for a scene: a plain string as-is, or
  // the matching entry of a conditional array — first matching condition
  // wins; the entry with no condition is the fallback.
  _resolveDescription(scene) {
    let desc = scene.description;

    if (Array.isArray(scene.description)) {
      const variant = scene.description.find(d => d.condition && evaluateCondition(d.condition, this.engine.state))
        ?? scene.description.find(d => !d.condition);
      desc = variant?.text || '';
    }

    const sceneId = this.engine.state.getCurrentSceneId() || scene.id;
    for (const decorator of this.engine.sceneDecorators) {
      if (decorator.description) desc += decorator.description(scene, sceneId, this.engine) || '';
    }

    return desc;
  }
}
