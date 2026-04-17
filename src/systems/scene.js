import { gameState } from "../core/state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton } from "../core/utils.js";
import { EL, CSS, LOG, MAX_D20_ROLL } from "../core/config.js";
import { evaluateCondition, fromRequiredState } from "./condition.js";
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
      this.engine.currentSceneEl.appendChild(buildSceneDescription(scene.title || scene.name, currentDesc));
      gameState.appendLog({ type: 'scene', title: scene.title || scene.name, desc: currentDesc });

      this.lastRenderedSceneId = sceneId;
      this.lastRenderedDesc = currentDesc;
    }

    // Reset skill-check DCs on re-entry. Found items persist; escalated DCs reset.
    if ((scene.options || []).some(opt => opt.charismaCheck)) {
      gameState.setFlag(`scene_charisma_${sceneId}`, {});
    }
    const perceptionOpt = (scene.options || []).find(opt => opt.perceptionCheck && opt.items?.length);
    if (perceptionOpt) {
      const state = gameState.getFlag(`look_around_${sceneId}`);
      if (state?.dcs) {
        gameState.setFlag(`look_around_${sceneId}`, {
          dcs:   perceptionOpt.items.map(item => item.dc ?? 10),
          found: state.found,
        });
      }
    }

    this.renderOptions(scene);
    this.engine.scrollNarrativeToBottom();
  }

  renderOptions(scene) {
    const optionsContainer = document.getElementById(EL.SCENE_OPTIONS);
    optionsContainer.classList.remove(CSS.SCENE_OPTIONS_COMBAT, CSS.SCENE_OPTIONS_MERCHANT);

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
      // Supports both the legacy requiredState shorthand and the full condition tree.
      const cond = opt.condition ?? fromRequiredState(opt.requiredState);
      if (!evaluateCondition(cond, gameState)) return;

      // Skill-check options (perceptionCheck / charismaCheck) are rendered in
      // the skills section, not here.
      if (opt.charismaCheck || opt.perceptionCheck) return;

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
    const charismaKey = `scene_charisma_${sceneId}`;
    const lookAroundKey = `look_around_${sceneId}`;

    (scene.options || []).forEach((opt, i) => {
      if (!opt.perceptionCheck && !opt.charismaCheck) return;
      const cond = opt.condition ?? fromRequiredState(opt.requiredState);
      if (!evaluateCondition(cond, gameState)) return;

      if (opt.perceptionCheck) {
        const items = opt.items || [];

        if (!items.length) {
          // Flavor-only: show once, then disappear
          if (gameState.getFlag(lookAroundKey)) return;
          const btn = buildOptionButton(opt.text, this.engine.t('actions.lookAroundBadge'));
          btn.onclick = () => {
            this.engine.isGameStart = false;
            gameState.setFlag(lookAroundKey, true);
            this.engine.log(LOG.PLAYER, opt.text, 'choice');
            this.engine.log(LOG.SYSTEM, this.engine.t('actions.lookAroundEmpty'));
            this.renderOptions(scene);
          };
          skillBtns.push(btn);
          return;
        }

        let state = gameState.getFlag(lookAroundKey);
        if (!state || !state.dcs) {
          state = { dcs: items.map(l => l.dc ?? 10), found: items.map(() => false) };
        }
        if (state.found.every(f => f)) return;

        const btn = buildOptionButton(opt.text, this.engine.t('actions.lookAroundBadge'));
        btn.onclick = () => {
          this.engine.isGameStart = false;
          this.engine.log(LOG.PLAYER, opt.text, 'choice');
          const mod = gameState.getPlayer().perception || 0;
          const hitRoll = roll(1, MAX_D20_ROLL) + mod;
          const newlyFound = [];
          items.forEach((l, idx) => {
            if (state.found[idx]) return;
            if (hitRoll >= state.dcs[idx]) { state.found[idx] = true; newlyFound.push(l); }
            else { state.dcs[idx] += l.increment ?? 1; }
          });
          const anyFound = newlyFound.length > 0;
          this.engine.log(LOG.SYSTEM, this.engine.t(anyFound ? 'actions.lookAroundFound' : 'actions.lookAroundFail', { roll: hitRoll, mod }), anyFound ? 'loot' : 'system');
          newlyFound.forEach(l => {
            if (l.item === 'gold') {
              gameState.modifyPlayerStat('gold', l.amount);
              this.engine.log(LOG.SYSTEM, this.engine.t('loot.foundGold', { amount: l.amount }), 'loot');
            } else {
              gameState.addToInventory(l.item, l.amount || 1);
              this.engine.log(LOG.SYSTEM, this.engine.t('loot.foundItem', { name: this.engine.data.items[l.item]?.name || l.item }), 'loot');
            }
          });
          gameState.setFlag(lookAroundKey, state);
          this.renderOptions(scene);
        };
        skillBtns.push(btn);

      } else {
        // charismaCheck
        const charismaState = gameState.getFlag(charismaKey) || {};
        const dc = charismaState[i] ?? opt.dc;
        const btn = buildOptionButton(opt.text, this.engine.t('dialogue.socialCheckBadge', { dc }));
        btn.onclick = () => {
          this.engine.isGameStart = false;
          this.engine.log(LOG.PLAYER, opt.text, 'choice');
          const mod = gameState.getPlayer().charisma || 0;
          const rolled = roll(1, MAX_D20_ROLL) + mod;
          const success = rolled >= dc;
          this.engine.log(
            LOG.SYSTEM,
            this.engine.t(success ? 'dialogue.socialSuccess' : 'dialogue.socialFail',
              { roll: rolled, mod, dc, name: opt.npcName || '...' }),
            success ? 'loot' : 'system'
          );
          if (success) {
            if (opt.changeStateFlag) gameState.setFlag(opt.changeStateFlag.flag, opt.changeStateFlag.value);
            this.engine.renderScene(opt.destination || gameState.getCurrentSceneId());
          } else {
            charismaState[i] = dc + (opt.increment ?? 1);
            gameState.setFlag(charismaKey, charismaState);
            this.renderOptions(scene);
          }
        };
        skillBtns.push(btn);
      }
    });

    if (skillBtns.length > 0) {
      const heading = createElement('div', CSS.SCENE_SKILLS_HEADING, this.engine.t('ui.skillsHeading'));
      skillsContainer.appendChild(heading);
      skillBtns.forEach(b => skillsContainer.appendChild(b));
      skillsContainer.removeAttribute('hidden');
    }

    if (scene.questsTriggeredOnEntry) {
      this.engine.emit('scene:entered', { sceneId: gameState.getCurrentSceneId(), scene });
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
    this.engine.log(LOG.PLAYER, opt.text, 'choice');

    if (opt.changeStateFlag) {
      gameState.setFlag(opt.changeStateFlag.flag, opt.changeStateFlag.value);
    }

    if (opt.action) {
      const handler = this.engine.getActionHandler(opt.action);
      if (handler) {
        handler(opt, this.engine);
      } else {
        console.warn(`[Gravity] handleOption: no handler for action "${opt.action}"`);
      }
    } else if (opt.destination) {
      this.engine.renderScene(opt.destination);
    }
  }

  // Returns the description string to display for a scene.
  // Handles three cases:
  //   1. Plain string description — returned as-is.
  //   2. Conditional array — first matching requiredState wins; the entry with
  //      no requiredState acts as the fallback.
  //   3. descriptionHook — appends dynamic content after the base description.
  _resolveDescription(scene) {
    let desc = scene.description;

    if (Array.isArray(scene.description)) {
      // Default to the fallback entry (no requiredState) first, then override
      // with the first conditional entry whose flag condition is met.
      desc = scene.description.find(d => !d.requiredState && !d.condition)?.text || '';
      for (const d of scene.description) {
        const cond = d.condition ?? fromRequiredState(d.requiredState);
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
}
