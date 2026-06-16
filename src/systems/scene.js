import { gameState } from "../core/state.js";
import { createElement, buildSceneDescription, buildOptionButton, getItemLabel, resetOptionsPanel } from "../core/utils.js";
import { CSS, FLAG_KEYS, GOLD_ITEM_ID, LOG, MAX_D20_ROLL } from "../core/config.js";
import { evaluateCondition } from "./condition.js";
import { roll } from "./dice.js";
import { performSkillCheck, getEscalatedDc, escalateDc } from "./skill-checks.js";

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
   */
  render(sceneId) {
    if (this.engine.inCombat) return;

    const scene = this.engine.data.scenes[sceneId];
    if (!scene) {
      console.error(`Scene ${sceneId} not found!`);
      return;
    }

    this._registerInitialDisplays(scene, sceneId);

    // addVisitedScene must be called BEFORE setCurrentSceneId because
    // setCurrentSceneId triggers notifyListeners → ui.update() → renderMinimap(),
    // which checks visitedScenes. If the order is reversed, the current scene
    // would be absent from visitedScenes when the minimap first renders.
    gameState.addVisitedScene(sceneId);
    gameState.setCurrentSceneId(sceneId);

    this._appendSceneDescription(scene, sceneId);
    this._resetSkillDcs(scene, sceneId);
    this.renderOptions(scene);

    // Emit scene:entered once per actual entry so quest triggers and other
    // listeners don't fire on skill-check re-renders or save restores.
    if (scene.questTrigger) {
      this.engine.emit('scene:entered', { sceneId, scene });
    }

    if (this._maybeStartAutoAttack(scene)) return;

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

  // Resets skill-check DCs on scene re-entry. Found items persist; escalated DCs reset.
  _resetSkillDcs(scene, sceneId) {
    (scene.skills || []).forEach(opt => {
      if (!opt.skillCheck) return;
      const key = FLAG_KEYS.skillDc(opt.skillCheck, sceneId);
      if (opt.items?.length) {
        // Item-discovery: reset escalated DCs but preserve which items were already found.
        const state = gameState.getFlag(key);
        if (state?.dcs) {
          gameState.setFlag(key, { dcs: opt.items.map(item => item.dc ?? 10), found: state.found });
        }
      } else if (opt.dc) {
        // Pass/fail: reset DC escalation so a re-entered scene starts fresh.
        gameState.setFlag(key, {});
      }
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
      if (!opt.skillCheck) return;
      const cond = opt.condition ?? null;
      if (!evaluateCondition(cond, gameState)) return;

      const items = opt.items || [];
      let btn;
      if (items.length) {
        btn = this._buildItemDiscoveryButton(opt, sceneId, scene);
      } else if (!opt.dc) {
        btn = this._buildFlavorButton(opt, sceneId, scene);
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

    const sceneIdBefore = gameState.getCurrentSceneId();
    this.engine.runActions(opt.actions || []);

    // Re-render options if nothing caused navigation, so flag changes take
    // effect immediately. Checking sceneId and inCombat covers all action types
    // including plugins, without maintaining a hardcoded list.
    const navigated = gameState.getCurrentSceneId() !== sceneIdBefore || this.engine.inCombat || this.engine.inDialogue || this.engine.inCustomUI;
    if (!navigated) {
      const scene = this.engine.data.scenes[gameState.getCurrentSceneId()];
      if (scene) this.renderOptions(scene);
    }
  }

  // Item-discovery skill check: roll against per-item DCs, track found items.
  // Returns a button, or null if all items have already been found.
  _buildItemDiscoveryButton(opt, sceneId, scene) {
    const skillKey = FLAG_KEYS.skillDc(opt.skillCheck, sceneId);
    const items = opt.items;
    let state = gameState.getFlag(skillKey);
    if (!state || !state.dcs) {
      state = { dcs: items.map(l => l.dc ?? 10), found: items.map(() => false) };
    }
    if (state.found.every(f => f)) return null;

    const lowestDc = Math.min(...state.dcs.filter((_, idx) => !state.found[idx]));
    const btn = buildOptionButton(opt.text, this.engine.t(`actions.skillBadge.${opt.skillCheck}`, { dc: lowestDc }));
    btn.onclick = () => {
      this.engine.isGameStart = false;
      this.engine.log(LOG.PLAYER, opt.text, 'choice');
      this._resolveDiscovery(opt, state, skillKey, scene);
    };
    return btn;
  }

  // Resolves one discovery attempt: rolls once against every still-hidden
  // item's DC, marks hits as found, escalates the DCs of misses, awards the
  // found loot, persists the updated state, and re-renders the options.
  _resolveDiscovery(opt, state, skillKey, scene) {
    const items = opt.items;
    const mod = gameState.getPlayer().attributes[opt.skillCheck] ?? 0;
    const hitRoll = roll(1, MAX_D20_ROLL) + mod;

    const newlyFound = [];
    items.forEach((l, idx) => {
      if (state.found[idx]) return;
      if (hitRoll >= state.dcs[idx]) { state.found[idx] = true; newlyFound.push(l); }
      else { state.dcs[idx] += l.increment ?? 1; }
    });

    const anyFound = newlyFound.length > 0;
    const stillMore = anyFound && !state.found.every(f => f);
    const msgKey = anyFound
      ? (stillMore ? 'actions.lookAroundFoundMore' : 'actions.lookAroundFound')
      : 'actions.lookAroundFail';
    this.engine.log(LOG.SYSTEM, this.engine.t(msgKey, { roll: hitRoll, mod }), anyFound ? 'loot' : 'system');

    this._awardDiscoveredLoot(newlyFound);

    gameState.setFlag(skillKey, state);
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

  // Flavor-only skill check: no roll, shown once then hidden permanently.
  // Returns a button, or null if it has already been triggered.
  _buildFlavorButton(opt, sceneId, scene) {
    const skillKey = FLAG_KEYS.skillDc(opt.skillCheck, sceneId);
    if (gameState.getFlag(skillKey)) return null;
    const btn = buildOptionButton(opt.text, this.engine.t('actions.lookAroundBadge'));
    btn.onclick = () => {
      this.engine.isGameStart = false;
      gameState.setFlag(skillKey, true);
      this.engine.log(LOG.PLAYER, opt.text, 'choice');
      this.engine.log(LOG.SYSTEM, this.engine.t('actions.lookAroundEmpty'));
      this.renderOptions(scene);
    };
    return btn;
  }

  // Pass/fail skill check with an escalating DC on failure.
  // Always returns a button (the check remains available until the player passes).
  _buildPassFailButton(opt, i, sceneId, scene) {
    const skillKey = FLAG_KEYS.skillDc(opt.skillCheck, sceneId);
    const dc = getEscalatedDc(skillKey, i, opt.dc);
    const btn = buildOptionButton(opt.text, this.engine.t(`actions.skillBadge.${opt.skillCheck}`, { dc }));
    btn.onclick = () => {
      this.engine.isGameStart = false;
      this.engine.log(LOG.PLAYER, opt.text, 'choice');
      const { success } = performSkillCheck(this.engine, opt.skillCheck, dc);
      if (success) {
        const sceneIdBefore = gameState.getCurrentSceneId();
        this.engine.runActions(opt.actions || []);
        const didNavigate = gameState.getCurrentSceneId() !== sceneIdBefore || this.engine.inCombat;
        if (!didNavigate) this.engine.renderScene(gameState.getCurrentSceneId());
      } else {
        escalateDc(skillKey, i, dc, opt.increment ?? 1);
        if (opt.onFailure?.length) {
          const sceneIdBefore = gameState.getCurrentSceneId();
          this.engine.runActions(opt.onFailure);
          const didNavigate = gameState.getCurrentSceneId() !== sceneIdBefore || this.engine.inCombat;
          if (!didNavigate) this.renderOptions(scene);
        } else {
          this.renderOptions(scene);
        }
      }
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
    this._lastDescBodyEl.innerHTML = desc;
  }
}
