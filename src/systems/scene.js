import { gameState } from "../core/state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton } from "../core/utils.js";
import { EL, CSS, LOG, MAX_D20_ROLL } from "../core/config.js";
import { evaluateCondition } from "./condition.js";
import { roll } from "./dice.js";

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

  render(sceneId) {
    if (this.engine.inCombat) return;

    const scene = this.engine.data.scenes[sceneId];
    if (!scene) {
      console.error(`Scene ${sceneId} not found!`);
      return;
    }

    // addVisitedScene must be called BEFORE setCurrentSceneId because
    // setCurrentSceneId triggers notifyListeners → ui.update() → renderMinimap(),
    // which checks visitedScenes. If the order is reversed, the current scene
    // would be absent from visitedScenes when the minimap first renders.
    gameState.addVisitedScene(sceneId);
    gameState.setCurrentSceneId(sceneId);

    const currentDesc = this._resolveDescription(scene);

    // Only append a new narrative block when the scene or its description has
    // actually changed — prevents duplicate entries when options re-render.
    if (this.lastRenderedSceneId !== sceneId || this.lastRenderedDesc !== currentDesc) {
      this.engine.openScene();
      // Scene content comes from developer-authored JSON, not user input —
      // buildSceneDescription uses innerHTML for the body to allow basic formatting.
      const descEl = buildSceneDescription(scene.title || scene.name, currentDesc);
      this._lastDescBodyEl = descEl.querySelector(`.${CSS.SCENE_BODY}`);
      this.engine.currentSceneEl.appendChild(descEl);
      gameState.appendLog({ type: 'scene', title: scene.title || scene.name, desc: currentDesc });

      this.lastRenderedSceneId = sceneId;
      this.lastRenderedDesc = currentDesc;
    }

    // Reset skill-check DCs on re-entry. Found items persist; escalated DCs reset.
    (scene.skills || []).forEach(opt => {
      if (!opt.skillCheck) return;
      const key = `skill_dc_${opt.skillCheck}_${sceneId}`;
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

    this.renderOptions(scene);

    // Emit scene:entered once per actual entry so quest triggers and other
    // listeners don't fire on skill-check re-renders or save restores.
    if (scene.questTrigger) {
      this.engine.emit('scene:entered', { sceneId, scene });
    }

    if (scene.autoAttack) {
      const cond = scene.autoAttack.condition ?? null;
      if (!cond || evaluateCondition(cond, gameState)) {
        this.engine.combatSystem.startCombat(
          scene.autoAttack.enemies,
          scene.autoAttack
        );
        return;
      }
    }

    this.engine.scrollNarrativeToBottom();
  }

  renderOptions(scene) {
    const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());

    const optionsContainer = document.getElementById(EL.SCENE_OPTIONS);

    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    clearElement(optionsContainer);
    if (reminder) {
      reminder.innerText = scene.title || scene.name;
      optionsContainer.appendChild(reminder);
    }

    const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
    clearElement(skillsContainer);
    skillsContainer.setAttribute('hidden', '');

    (scene.options || []).forEach(opt => {
      // Hide options whose condition is not currently met.
      const cond = opt.condition ?? null;
      if (!evaluateCondition(cond, gameState)) return;

      let reqText = null;
      let disabled = false;
      if (opt.requirements?.item) {
        const hasItem = gameState.getPlayer().inventory.find(i => i.item === opt.requirements.item);
        if (!hasItem) {
          disabled = true;
          reqText = this.engine.t('ui.itemRequires', { name: this.engine.data.items[opt.requirements.item]?.name || opt.requirements.item });
        }
      }

      const btn = buildOptionButton(opt.text, reqText);
      if (disabled) btn.disabled = true;
      btn.onclick = () => this.handleOption(opt);
      optionsContainer.appendChild(btn);
    });

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
      const xpFlag = `xp_awarded_${gameState.getCurrentSceneId()}`;
      if (!gameState.getFlag(xpFlag)) {
        gameState.addXP(scene.xpReward);
        gameState.setFlag(xpFlag, true);
        this.engine.log(LOG.SYSTEM, this.engine.t('loot.xpGained', { amount: scene.xpReward }), 'loot');
      }
    }
  }

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
    const skillKey = `skill_dc_${opt.skillCheck}_${sceneId}`;
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
      const mod = gameState.getPlayer().attributes[opt.skillCheck] || 0;
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
      aggregated.forEach(d => {
        if (d.item === 'gold') {
          gameState.modifyPlayerStat('gold', d.amount);
          this.engine.log(LOG.SYSTEM, this.engine.t('loot.foundGold', { amount: d.amount }), 'loot');
        } else {
          gameState.addToInventory(d.item, d.amount);
          this.engine.log(LOG.SYSTEM, this.engine.t('loot.foundItem', { name: this.engine.data.items[d.item]?.name || d.item }), 'loot');
        }
      });
      gameState.setFlag(skillKey, state);
      this.renderOptions(scene);
    };
    return btn;
  }

  // Flavor-only skill check: no roll, shown once then hidden permanently.
  // Returns a button, or null if it has already been triggered.
  _buildFlavorButton(opt, sceneId, scene) {
    const skillKey = `skill_dc_${opt.skillCheck}_${sceneId}`;
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
    const skillKey = `skill_dc_${opt.skillCheck}_${sceneId}`;
    const skillState = gameState.getFlag(skillKey) || {};
    const dc = skillState[i] ?? opt.dc;
    const btn = buildOptionButton(opt.text, this.engine.t(`actions.skillBadge.${opt.skillCheck}`, { dc }));
    btn.onclick = () => {
      this.engine.isGameStart = false;
      this.engine.log(LOG.PLAYER, opt.text, 'choice');
      const mod = gameState.getPlayer().attributes[opt.skillCheck] || 0;
      const rolled = roll(1, MAX_D20_ROLL) + mod;
      const success = rolled >= dc;
      this.engine.log(
        LOG.SYSTEM,
        this.engine.t(success ? 'actions.skillSuccess' : 'actions.skillFail',
          { roll: rolled, mod, dc, skill: opt.skillCheck }),
        success ? 'loot' : 'system'
      );
      if (success) {
        const sceneIdBefore = gameState.getCurrentSceneId();
        this.engine.runActions(opt.actions || []);
        const didNavigate = gameState.getCurrentSceneId() !== sceneIdBefore || this.engine.inCombat;
        if (!didNavigate) this.engine.renderScene(gameState.getCurrentSceneId());
      } else {
        skillState[i] = dc + (opt.increment ?? 1);
        gameState.setFlag(skillKey, skillState);
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
  // Each entry may carry an optional `weight` field (defaults to 1).
  _rollTable(tableId) {
    const table = this.engine.data.tables[tableId];
    if (!table?.entries?.length) return null;
    const totalWeight = table.entries.reduce((sum, e) => sum + (e.weight ?? 1), 0);
    let r = Math.random() * totalWeight;
    for (const entry of table.entries) {
      r -= (entry.weight ?? 1);
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

    return desc;
  }

  // Updates the body of the most recently rendered scene description in place.
  // Used by custom UIs (e.g. ChestUI) to reflect state changes without appending
  // a new narrative block.
  refreshDescription(scene) {
    if (!this._lastDescBodyEl) return;
    this._lastDescBodyEl.innerHTML = this._resolveDescription(scene);
  }
}
