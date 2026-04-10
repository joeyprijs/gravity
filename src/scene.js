import { gameState } from "./state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton } from "./utils.js";
import { EL, LOG } from "./config.js";
import { evaluateCondition, fromRequiredState } from "./condition.js";

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

    this.renderOptions(scene);
    this.engine.narrative.scrollToBottom();
  }

  renderOptions(scene) {
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = scene.title || scene.name;

    const optionsContainer = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(optionsContainer);

    (scene.options || []).forEach(opt => {
      // Hide options whose condition is not currently met.
      // Supports both the legacy requiredState shorthand and the full condition tree.
      const cond = opt.condition ?? fromRequiredState(opt.requiredState);
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
