import { gameState } from "../core/state.js";
import { createElement, buildSceneDescription, buildOptionButton, getItemLabel, resetOptionsPanel, wrapLogPrefix } from "../core/utils.js";
import { CSS, FLAG_KEYS, GOLD_ITEM_ID, LOG, MAX_D20_ROLL } from "../core/config.js";
import { evaluateCondition } from "./condition.js";
import { roll } from "./dice.js";
import { resolveTimeCost } from "./time.js";
import {
  performSkillCheck, normalizeOutcomes, formatMod, resolveRetryText,
  getAttempts, recordAttempt, isResolved, markResolved, resetAttempts,
  performLuckCheck, luckEnabled, luckOdds,
  skillBadge, retryGate, applyRetryGate
} from "./skill-checks.js";

// SceneRenderer handles navigating to scenes, resolving their descriptions,
// and rendering their option buttons. It is the main driver of scene-to-scene
// movement and all non-combat, non-dialogue player interactions.
export class SceneRenderer {
  constructor(engine) {
    this.engine = engine;
    // Tracks the last rendered scene/desc so we don't duplicate narrative
    // entries when re-rendering options without changing the scene body.
    this.lastRenderedSceneId = null;
    this.lastRenderedDesc = null;
  }

  reset() {
    this.lastRenderedSceneId = null;
    this.lastRenderedDesc = null;
  }

  // Called after a save is loaded. Syncs the cache to the restored state so
  // the next render doesn't duplicate the scene description, then re-renders
  // the option buttons without appending a new narrative block.
  restoreFromSave(sceneId, lastDesc) {
    if (lastDesc !== null) {
      this.lastRenderedSceneId = sceneId;
      this.lastRenderedDesc = lastDesc;
    }
    const scene = this.engine.data.scenes[sceneId];
    if (scene) this.renderOptions(scene);
  }

  /**
   * Renders a scene: its description, options, skills, and any auto-combat.
   * No-op while combat is active.
   *
   * @param {string} sceneId - The id of the scene to render.
   * @param {object} [opts]
   * @param {boolean} [opts.skipAutoAttack=false] - Suppresses the scene's
   *   autoAttack encounter. Used by the post-victory re-render so winning a
   *   fight on an auto-attack scene doesn't immediately restart it.
   */
  render(sceneId, { skipAutoAttack = false } = {}) {
    if (this.engine.inCombat) return;

    const scene = this.engine.data.scenes[sceneId];
    if (!scene) {
      console.error(`Scene ${sceneId} not found!`);
      return;
    }

    this._registerInitialDisplays(scene, sceneId);

    // Passive checks roll BEFORE the description resolves, so conditional
    // description variants already see the flags they set. Their narration
    // logs after the description block (see below).
    const passiveTexts = this._rollPassiveChecks(scene, sceneId);

    // Attempt counters reset on actual (re-)entry only — a same-scene
    // re-render (e.g. after a successful check) must not rewind other checks'
    // retry wording or refill their maxAttempts budgets mid-visit.
    const isEntry = gameState.getCurrentSceneId() !== sceneId;

    // addVisitedScene must be called BEFORE setCurrentSceneId because
    // setCurrentSceneId triggers notifyListeners → ui.update() → renderMinimap(),
    // which checks visitedScenes. If the order is reversed, the current scene
    // would be absent from visitedScenes when the minimap first renders.
    gameState.addVisitedScene(sceneId);
    gameState.setCurrentSceneId(sceneId);

    this._appendSceneDescription(scene, sceneId);
    passiveTexts.forEach(text => this.engine.log(LOG.NARRATOR, text));
    if (isEntry) this._resetSkillAttempts(scene, sceneId);
    this.renderOptions(scene);

    // Emit scene:entered once per actual entry so quest triggers and other
    // listeners don't fire on skill-check re-renders or save restores.
    if (scene.questTrigger) {
      this.engine.emit('scene:entered', { sceneId, scene });
    }

    if (!skipAutoAttack && this._maybeStartAutoAttack(scene)) return;

    this.engine.scrollNarrativeToBottom();
  }

  // Auto-registers initial displays defined in the scene file, unless the
  // scene already has displays registered in state (e.g. from a loaded save).
  _registerInitialDisplays(scene, sceneId) {
    if (!scene.displays?.length) return;
    if (gameState.getDisplaysForScene(sceneId).length > 0) return;
    scene.displays.forEach(d => {
      gameState.addDisplayToScene(sceneId, {
        id: d.id,
        name: d.name,
        item: d.item || null,
        allowedTypes: d.allowedTypes || null
      });
    });
  }

  // Appends the scene description as a new narrative block — but only when the
  // scene or its description actually changed, preventing duplicate entries
  // when options re-render.
  _appendSceneDescription(scene, sceneId) {
    const currentDesc = this._resolveDescription(scene);
    if (this.lastRenderedSceneId === sceneId && this.lastRenderedDesc === currentDesc) return;

    this.engine.openScene();
    // Scene content comes from developer-authored JSON, not user input —
    // buildSceneDescription uses innerHTML for the body to allow basic formatting.
    const descEl = buildSceneDescription(scene.title || scene.name, currentDesc, this.engine.t.bind(this.engine));
    this._lastDescBodyEl = descEl.querySelector(`.${CSS.SCENE_BODY}`);
    this.engine.currentSceneEl.appendChild(descEl);
    gameState.appendLog({ type: 'scene', title: scene.title || scene.name, desc: currentDesc });

    this.lastRenderedSceneId = sceneId;
    this.lastRenderedDesc = currentDesc;
  }

  // Passive checks: auto-rolled the first time the player enters the scene,
  // writing pass/fail into an author-named flag that conditions, description
  // variants, and option gates can read. Rolled exactly once per game — never
  // re-rolled on re-entry — so the world stays consistent. Silent unless the
  // check succeeds and carries authored `text` (returned for post-description
  // logging).
  _rollPassiveChecks(scene, sceneId) {
    const texts = [];
    (scene.passiveChecks || []).forEach((check, i) => {
      if (!check.skillCheck || !check.flag) return;
      const doneKey = FLAG_KEYS.passiveDone(sceneId, i);
      if (gameState.getFlag(doneKey)) return;
      gameState.setFlag(doneKey, true);
      const mod = gameState.getPlayer().attributes[check.skillCheck] ?? 0;
      const success = roll(1, MAX_D20_ROLL) + mod >= (check.dc ?? 10);
      gameState.setFlag(check.flag, success);
      if (success && check.text) texts.push(check.text);
    });
    return texts;
  }

  // Resets skill-check attempt counters on scene re-entry so retryText wording
  // starts fresh. Discovery progress and resolved (retired) checks persist.
  _resetSkillAttempts(scene, sceneId) {
    (scene.skills || []).forEach(opt => {
      if (!opt.skillCheck) return;
      resetAttempts(FLAG_KEYS.skillDc(opt.skillCheck, sceneId));
    });
  }

  // Starts the scene's autoAttack encounter when its condition allows.
  // Returns true when combat was started (the caller stops rendering).
  _maybeStartAutoAttack(scene) {
    if (!scene.autoAttack) return false;
    const cond = scene.autoAttack.condition ?? null;
    if (cond && !evaluateCondition(cond, gameState)) return false;
    this.engine.combatSystem.startCombat(scene.autoAttack.enemies, scene.autoAttack);
    return true;
  }

  renderOptions(scene) {
    const { container: optionsContainer, skillsContainer } = resetOptionsPanel(scene.title || scene.name);

    const standardOpts = [];
    const backOpts = [];

    // A "back" option is sorted to the bottom of the list. Detected by the
    // `return` action type or an explicit `"isBack": true` flag — never by
    // matching English words in the text, which would break in other locales.
    const isBackOption = (opt) => {
      if (opt.isBack === true) return true;
      return opt.actions?.some(a => a.type === 'return') ?? false;
    };

    (scene.options || []).forEach(opt => {
      const cond = opt.condition ?? null;
      if (!evaluateCondition(cond, gameState)) return;

      if (isBackOption(opt)) {
        backOpts.push(opt);
      } else {
        standardOpts.push(opt);
      }
    });

    const renderOptionBtn = (opt) => {
      let reqText = null;
      let disabled = false;
      if (opt.requirements?.item) {
        const totalCount = gameState.countPlayerItem(opt.requirements.item);
        if (totalCount <= 0) {
          disabled = true;
          reqText = this.engine.t('ui.itemRequires', { name: getItemLabel(this.engine.data.items, opt.requirements.item) });
        }
      }

      const btn = buildOptionButton(opt.text, reqText);
      if (disabled) btn.disabled = true;
      btn.onclick = () => this.handleOption(opt);
      optionsContainer.appendChild(btn);
    };

    standardOpts.forEach(renderOptionBtn);

    const skillBtns = [];
    const sceneId = gameState.getCurrentSceneId();

    (scene.skills || []).forEach((opt, i) => {
      if (!opt.skillCheck && !opt.luckCheck) return;
      const cond = opt.condition ?? null;
      if (!evaluateCondition(cond, gameState)) return;

      const items = opt.items || [];
      let btn;
      if (opt.luckCheck) {
        btn = this._buildLuckButton(opt, i, sceneId, scene);
      } else if (items.length) {
        btn = this._buildItemDiscoveryButton(opt, i, sceneId, scene);
      } else if (!opt.dc) {
        btn = this._buildNarrativeButton(opt, i, sceneId, scene);
      } else {
        btn = this._buildPassFailButton(opt, i, sceneId, scene);
      }
      if (btn) skillBtns.push(btn);
    });

    if (skillBtns.length > 0) {
      const heading = createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.skillsHeading'));
      skillsContainer.appendChild(heading);
      skillBtns.forEach(b => skillsContainer.appendChild(b));
      skillsContainer.removeAttribute('hidden');
    }

    // One-time XP reward on first visit. The flag prevents re-awarding on
    // subsequent visits or after loading a save.
    if (scene.xpReward) {
      const xpFlag = FLAG_KEYS.xpAwarded(gameState.getCurrentSceneId());
      if (!gameState.getFlag(xpFlag)) {
        gameState.addXP(scene.xpReward);
        gameState.setFlag(xpFlag, true);
        this.engine.log(LOG.SYSTEM, this.engine.t('loot.xpGained', { amount: scene.xpReward }), 'loot');
      }
    }

    // Plugin-registered decorators may append extra option buttons (e.g. the
    // curator plugin's exhibit-management button).
    for (const decorator of this.engine.sceneDecorators) {
      if (decorator.options) decorator.options(scene, optionsContainer, this.engine);
    }

    backOpts.forEach(renderOptionBtn);
  }

  /**
   * Executes a chosen scene option: logs the choice (unless silenced) and runs
   * its action pipeline.
   *
   * @param {object} opt - The option object from the scene's `options` array.
   */
  handleOption(opt) {
    this.engine.isGameStart = false;
    if (opt.log !== false) this.engine.log(LOG.PLAYER, opt.text, 'choice');

    this._chargeTime(opt, this._optionCostKind(opt));

    const sceneIdBefore = gameState.getCurrentSceneId();
    this.engine.runActions(opt.actions || []);

    // Re-render options if nothing caused navigation, so flag changes take
    // effect immediately.
    if (!this._didNavigate(sceneIdBefore)) {
      const scene = this.engine.data.scenes[gameState.getCurrentSceneId()];
      if (scene) this.renderOptions(scene);
    }
  }

  // Picks which rules.time.defaultCosts entry applies to a plain scene option,
  // from what its pipeline does: moving somewhere defaults to the travel cost,
  // a full rest to the rest cost. Anything else is free unless the option
  // carries an explicit timeCost.
  _optionCostKind(opt) {
    const actions = opt.actions || [];
    if (actions.some(a => a.type === 'navigate' || a.type === 'return')) return 'navigate';
    if (actions.some(a => a.type === 'full_rest')) return 'fullRest';
    return null;
  }

  // Advances the world clock for a chosen option/check. An explicit timeCost
  // always wins; otherwise the kind's default from rules.time.defaultCosts
  // applies. Charged BEFORE the pipeline runs, so a timer that fires can set
  // flags the pipeline's destination scene already sees.
  _chargeTime(opt, kind) {
    const cost = resolveTimeCost(opt.timeCost, kind, this.engine.data.rules);
    if (cost > 0) this.engine.advanceTime(cost);
  }

  // Returns true when the last pipeline run moved the player somewhere else —
  // a scene change, combat, dialogue, or a custom UI. Callers skip re-rendering
  // the current scene's options so they don't clobber the new panel.
  _didNavigate(sceneIdBefore) {
    return gameState.getCurrentSceneId() !== sceneIdBefore ||
      this.engine.inCombat || this.engine.inDialogue || this.engine.inCustomUI;
  }

  // Reads one discovery entry's state from the shared per-skill flag map.
  // The map is shared by every check in the scene that rolls the same skill
  // (pass/fail attempt counters, narrative uses, resolution markers), so
  // discovery state lives NAMESPACED under `disc_<index>` — it must never
  // replace the whole map, or it wipes its siblings' state. Older saves
  // stored discovery state at the map's top level; that shape is adopted by
  // the first discovery entry that reads it.
  _readDiscoveryState(skillKey, i, items) {
    const map = gameState.getFlag(skillKey);
    const state = typeof map === 'object' && map !== null ? map[`disc_${i}`] : null;
    if (state?.found) return state;
    if (i === 0 && map?.found) {
      // Legacy top-level shape (pre-namespacing) — adopt it as the FIRST
      // entry's only (later entries didn't exist when it was written), padding
      // or truncating `found` to the current item list so no holes or stale
      // trailing entries survive.
      return {
        found: items.map((_, idx) => map.found[idx] ?? false),
        tries: map.tries,
        resolved: map.resolved,
      };
    }
    return { found: items.map(() => false) };
  }

  // Persists one discovery entry's state into the shared map, clearing any
  // legacy top-level discovery fields it supersedes.
  _saveDiscoveryState(skillKey, i, state) {
    const existing = gameState.getFlag(skillKey);
    const map = typeof existing === 'object' && existing !== null ? existing : {};
    delete map.found;
    delete map.tries;
    delete map.resolved;
    delete map.dcs;
    map[`disc_${i}`] = state;
    gameState.setFlag(skillKey, map);
  }

  // Item-discovery skill check: roll against per-item DCs, track found items.
  // Returns a button, or null when everything has been found or the check has
  // been retired (resolveOnce, or an exhausted maxAttempts budget).
  _buildItemDiscoveryButton(opt, i, sceneId, scene) {
    const skillKey = FLAG_KEYS.skillDc(opt.skillCheck, sceneId);
    const items = opt.items;
    const state = this._readDiscoveryState(skillKey, i, items);
    if (state.resolved || state.found.every(f => f)) return null;

    const lowestDc = Math.min(...items.map(l => l.dc ?? 10).filter((_, idx) => !state.found[idx]));
    const displayText = resolveRetryText(opt, state.tries || 0);
    const gate = retryGate(this.engine, state.tries || 0);
    const btn = buildOptionButton(displayText, applyRetryGate(this.engine, gate, skillBadge(this.engine, opt.skillCheck, lowestDc)));
    if (gate.blocked) {
      btn.disabled = true;
      return btn;
    }
    btn.onclick = () => {
      this.engine.isGameStart = false;
      this.engine.log(LOG.PLAYER, displayText, 'choice');
      if (gate.cost > 0) gameState.modifyPlayerStat('luck', -gate.cost);
      this._chargeTime(opt, 'skillAttempt');
      this._resolveDiscovery(opt, i, state, skillKey, scene);
    };
    return btn;
  }

  // Resolves one discovery attempt: rolls once against every still-hidden
  // item's DC, marks hits as found, awards the found loot, persists the
  // updated state, and re-renders the options. A maxAttempts budget that runs
  // out (or resolveOnce) retires the check; exhaustion runs onExhausted.
  _resolveDiscovery(opt, i, state, skillKey, scene) {
    const items = opt.items;
    const mod = gameState.getPlayer().attributes[opt.skillCheck] ?? 0;
    const baseRoll = roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + mod;

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
    this.engine.log(LOG.SYSTEM, this.engine.t(msgKey, { roll: hitRoll, base: baseRoll, mod: formatMod(mod) }), anyFound ? 'loot' : 'system');

    this._awardDiscoveredLoot(newlyFound);

    state.tries = (state.tries || 0) + 1;
    const allFound = state.found.every(f => f);
    const exhausted = !allFound && opt.maxAttempts && state.tries >= opt.maxAttempts;
    if (opt.resolveOnce || exhausted) state.resolved = true;
    this._saveDiscoveryState(skillKey, i, state);

    if (exhausted && opt.onExhausted?.length) {
      const sceneIdBefore = gameState.getCurrentSceneId();
      this.engine.runActions(opt.onExhausted);
      if (this._didNavigate(sceneIdBefore)) return;
    }
    this.renderOptions(scene);
  }

  // Awards the loot for newly found discovery entries: rolls table entries
  // into concrete drops, aggregates duplicates, adds gold/items to the player,
  // and logs one summary line listing everything found.
  _awardDiscoveredLoot(newlyFound) {
    const drops = [];
    newlyFound.forEach(l => {
      if (l.table) {
        for (let i = 0; i < (l.itemDrops ?? 1); i++) {
          const resolved = this._rollTable(l.table);
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
        gameState.modifyPlayerStat('gold', d.amount);
        lootItems.push(`${d.amount} ${this.engine.t('loot.gold')}`);
      } else {
        gameState.addToInventory(d.item, d.amount);
        lootItems.push(getItemLabel(this.engine.data.items, d.item, d.amount));
      }
    });

    if (lootItems.length === 0) return;

    let listStr = "";
    if (lootItems.length === 1) {
      listStr = lootItems[0];
    } else if (lootItems.length === 2) {
      listStr = `${lootItems[0]} and ${lootItems[1]}`;
    } else {
      listStr = `${lootItems.slice(0, -1).join(', ')}, and ${lootItems[lootItems.length - 1]}`;
    }
    const message = this.engine.t('loot.foundItems', { list: listStr });
    const fallbackMessage = message !== 'loot.foundItems' ? message : `Found ${listStr}.`;
    this.engine.log(LOG.SYSTEM, fallbackMessage, 'loot');
  }

  // Test Your Luck: an authored gamble against the player's own depleting luck
  // (2d6 roll-under, then luck −1 regardless — see performLuckCheck). No DC to
  // author: the player's luck IS the difficulty. One-shot by nature
  // (resolveOnce defaults to true); the button shows the odds so the gamble is
  // an informed decision. Returns a button, or null once resolved.
  _buildLuckButton(opt, i, sceneId, scene) {
    const skillKey = FLAG_KEYS.skillDc('luck', sceneId);
    if (isResolved(skillKey, i)) return null;
    if (!luckEnabled()) {
      console.warn(`[Gravity] luckCheck "${opt.text}": no luck resource in rules.playerDefaults — option hidden`);
      return null;
    }

    const luck = gameState.getPlayer().resources.luck.current;
    const btn = buildOptionButton(opt.text, this.engine.t('actions.luckBadge', { luck, odds: luckOdds(luck) }));
    btn.onclick = () => {
      this.engine.isGameStart = false;
      this.engine.log(LOG.PLAYER, opt.text, 'choice');
      this._chargeTime(opt, 'skillAttempt');
      const { lucky } = performLuckCheck(this.engine);
      if (opt.resolveOnce !== false) markResolved(skillKey, i);
      // Lucky lands on the success tier, unlucky on failure — same outcome
      // table as skill checks, including authored tier narration.
      const outcomes = normalizeOutcomes(opt);
      const tier = outcomes[lucky ? 'success' : 'failure'];
      if (tier.text) this.engine.log(LOG.NARRATOR, tier.text);
      const sceneIdBefore = gameState.getCurrentSceneId();
      this.engine.runActions(tier.actions);
      if (!this._didNavigate(sceneIdBefore)) {
        if (lucky) this.engine.renderScene(gameState.getCurrentSceneId());
        else this.renderOptions(scene);
      }
    };
    return btn;
  }

  // Narrative (free) skill check: no roll, no DC — a story beat framed as a
  // skill. Logs the authored resultText (a string, or an array walked per use)
  // and runs an optional action pipeline. Retires after one use unless marked
  // repeatable. Returns a button, or null once retired.
  _buildNarrativeButton(opt, i, sceneId, scene) {
    const skillKey = FLAG_KEYS.skillDc(opt.skillCheck, sceneId);
    const state = gameState.getFlag(skillKey);
    // Older saves stored a bare `true` at this key for a used flavor check.
    const uses = state === true ? 1 : (state?.[`uses_${i}`] || 0);
    if (uses > 0 && !opt.repeatable) return null;

    const badgeKey = `actions.skillBadgeFree.${opt.skillCheck}`;
    const badge = this.engine.t(badgeKey) !== badgeKey
      ? this.engine.t(badgeKey)
      : this.engine.t('actions.lookAroundBadge');

    const btn = buildOptionButton(opt.text, badge);
    btn.onclick = () => {
      this.engine.isGameStart = false;
      // Narrative beats are free by default — no skillAttempt default cost.
      this._chargeTime(opt, null);
      const map = typeof state === 'object' && state !== null ? state : {};
      map[`uses_${i}`] = uses + 1;
      gameState.setFlag(skillKey, map);
      this.engine.log(LOG.PLAYER, opt.text, 'choice');

      if (opt.resultText) {
        const variants = Array.isArray(opt.resultText) ? opt.resultText : [opt.resultText];
        this.engine.log(LOG.NARRATOR, variants[Math.min(uses, variants.length - 1)]);
      } else {
        this.engine.log(LOG.SYSTEM, this.engine.t('actions.lookAroundEmpty'));
      }

      const sceneIdBefore = gameState.getCurrentSceneId();
      this.engine.runActions(normalizeOutcomes(opt).success.actions);
      if (!this._didNavigate(sceneIdBefore)) this.renderOptions(scene);
    };
    return btn;
  }

  // Pass/fail skill check, resolved against the check's outcome tiers
  // (critical/success/partial/failure — see normalizeOutcomes). Returns a
  // button, or null when the check has been retired (resolveOnce, or an
  // exhausted maxAttempts budget).
  _buildPassFailButton(opt, i, sceneId, scene) {
    const skillKey = FLAG_KEYS.skillDc(opt.skillCheck, sceneId);
    if (isResolved(skillKey, i)) return null;
    const attempts = getAttempts(skillKey, i);
    const displayText = resolveRetryText(opt, attempts);
    const gate = retryGate(this.engine, attempts);
    const btn = buildOptionButton(displayText, applyRetryGate(this.engine, gate, skillBadge(this.engine, opt.skillCheck, opt.dc)));
    if (gate.blocked) {
      btn.disabled = true;
      return btn;
    }
    btn.onclick = () => {
      this.engine.isGameStart = false;
      this.engine.log(LOG.PLAYER, displayText, 'choice');
      if (gate.cost > 0) gameState.modifyPlayerStat('luck', -gate.cost);
      this._chargeTime(opt, 'skillAttempt');
      const outcomes = normalizeOutcomes(opt);
      const { tier, success } = performSkillCheck(this.engine, opt.skillCheck, opt.dc, outcomes);
      if (opt.resolveOnce) markResolved(skillKey, i);
      const sceneIdBefore = gameState.getCurrentSceneId();
      if (success) {
        this.engine.runActions(outcomes[tier].actions);
        // Like handleOption, the re-render must be skipped when the actions
        // opened a dialogue or custom UI — rendering would clobber it.
        if (!this._didNavigate(sceneIdBefore)) this.engine.renderScene(gameState.getCurrentSceneId());
        return;
      }
      // Partial and failure tiers both count as an attempt: partial is
      // fail-forward (its actions grant the something-with-a-catch), but the
      // check itself has not been passed.
      const attemptCount = recordAttempt(skillKey, i);
      this.engine.runActions(outcomes[tier].actions);
      if (!opt.resolveOnce && opt.maxAttempts && attemptCount >= opt.maxAttempts) {
        markResolved(skillKey, i);
        if (opt.onExhausted?.length) this.engine.runActions(opt.onExhausted);
      }
      if (!this._didNavigate(sceneIdBefore)) this.renderOptions(scene);
    };
    return btn;
  }

  // Picks a random entry from a loot table using weighted probability.
  // Each entry may carry an optional `dropWeight` field (relative likelihood,
  // defaults to 1) — higher means more common, not item carry weight.
  _rollTable(tableId) {
    const table = this.engine.data.tables[tableId];
    if (!table?.entries?.length) return null;
    const totalWeight = table.entries.reduce((sum, e) => sum + (e.dropWeight ?? 1), 0);
    let r = Math.random() * totalWeight;
    for (const entry of table.entries) {
      r -= (entry.dropWeight ?? 1);
      if (r <= 0) return entry;
    }
    return table.entries[table.entries.length - 1];
  }

  // Returns the description string to display for a scene.
  // Handles three cases:
  //   1. Plain string description — returned as-is.
  //   2. Conditional array — first matching condition wins; the entry with
  //      no condition acts as the fallback.
  //   3. descriptionHook — appends dynamic content after the base description.
  _resolveDescription(scene) {
    let desc = scene.description;

    if (Array.isArray(scene.description)) {
      desc = scene.description.find(d => !d.condition)?.text || '';
      for (const d of scene.description) {
        const cond = d.condition ?? null;
        if (cond && evaluateCondition(cond, gameState)) {
          desc = d.text;
          break;
        }
      }
    }

    if (scene.descriptionHook) {
      const hook = this.engine.getDescriptionHook(scene.descriptionHook);
      if (hook) desc += hook(this.engine);
    }

    // Plugin-registered decorators may append dynamic HTML to any scene's
    // description (e.g. the curator plugin's exhibits table).
    const sceneId = gameState.getCurrentSceneId() || scene.id;
    for (const decorator of this.engine.sceneDecorators) {
      if (decorator.description) desc += decorator.description(scene, sceneId, this.engine) || '';
    }

    return desc;
  }

  // Updates the body of the most recently rendered scene description in place.
  // Used by custom UIs (e.g. ChestUI) to reflect state changes without appending
  // a new narrative block.
  refreshDescription(scene) {
    if (!this._lastDescBodyEl) return;
    let desc = this._resolveDescription(scene);
    if (desc && !/^\s*\[/.test(desc)) {
      const translated = this.engine.t('log.Narrator');
      const label = translated !== 'log.Narrator' ? translated : 'Narrator';
      desc = `[${label}] ${desc}`;
    }
    this._lastDescBodyEl.innerHTML = wrapLogPrefix(desc);
  }
}
