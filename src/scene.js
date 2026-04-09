import { gameState } from "./state.js";
import { createElement } from "./utils.js";
import { REST_HEAL_AMOUNT, SNACK_HEAL_AMOUNT } from "./config.js";

export class SceneRenderer {
  constructor(engine) {
    this.engine = engine;
    this.lastRenderedSceneId = null;
    this.lastRenderedDesc = null;
  }

  reset() {
    this.lastRenderedSceneId = null;
    this.lastRenderedDesc = null;
  }

  render(sceneId) {
    if (this.engine.combatSystem.inCombat) return;

    const scene = this.engine.data.scenes[sceneId];
    if (!scene) {
      console.error(`Scene ${sceneId} not found!`);
      return;
    }

    gameState.addVisitedScene(sceneId);
    gameState.setCurrentSceneId(sceneId);

    const currentDesc = this._resolveDescription(scene);

    if (this.lastRenderedSceneId !== sceneId || this.lastRenderedDesc !== currentDesc) {
      this.engine.openScene();
      const desc = createElement('div', 'scene__description');
      desc.innerHTML = `<h2 class="scene__title">${scene.title || scene.name}</h2><p class="scene__body">${currentDesc}</p>`;
      this.engine.currentSceneEl.appendChild(desc);
      gameState.appendLog({ type: 'scene', title: scene.title || scene.name, desc: currentDesc });

      this.lastRenderedSceneId = sceneId;
      this.lastRenderedDesc = currentDesc;
    }

    this.renderOptions(scene);
    this.engine.narrative.scrollToBottom();
  }

  renderOptions(scene) {
    const reminder = document.getElementById('scene-location-reminder');
    if (reminder) reminder.innerText = scene.title || scene.name;

    const optionsContainer = document.getElementById('scene-options');
    optionsContainer.innerHTML = '';

    (scene.options || []).forEach(opt => {
      if (opt.requiredState) {
        if (gameState.getFlag(opt.requiredState.flag) !== opt.requiredState.value) return;
      }

      const btn = document.createElement('button');
      btn.className = 'option-btn';

      let reqHtml = '';
      let disabled = false;
      if (opt.requirements?.item) {
        const hasItem = gameState.getPlayer().inventory.find(i => i.item === opt.requirements.item);
        if (!hasItem) {
          disabled = true;
          reqHtml = `<span class="option-btn__req-text">Requires: ${this.engine.data.items[opt.requirements.item]?.name || opt.requirements.item}</span>`;
        }
      }

      btn.innerHTML = `<span>${opt.text}</span> ${reqHtml}`;
      if (disabled) btn.disabled = true;
      btn.onclick = () => this.handleOption(opt);
      optionsContainer.appendChild(btn);
    });

    if (scene.questsTriggeredOnEntry) {
      this.engine.questSystem.handleTrigger(scene.questsTriggeredOnEntry);
    }

    if (scene.xpReward) {
      const xpFlag = `xp_awarded_${gameState.getCurrentSceneId()}`;
      if (!gameState.getFlag(xpFlag)) {
        gameState.addXP(scene.xpReward);
        gameState.setFlag(xpFlag, true);
        this.engine.log("System", `+${scene.xpReward} XP`, 'loot');
      }
    }
  }

  handleOption(opt) {
    this.engine.isGameStart = false;
    this.engine.log('player', opt.text, 'choice');

    if (opt.changeStateFlag) {
      gameState.setFlag(opt.changeStateFlag.flag, opt.changeStateFlag.value);
    }

    if (opt.action) {
      switch (opt.action) {
        case "loot": {
          const param = opt.actionDetails;
          gameState.addToInventory(param.item, param.amount || 1);
          this.engine.log("System", `You received ${this.engine.data.items[param.item]?.name || param.item}!`, 'loot');
          if (param.xpReward) {
            gameState.addXP(param.xpReward);
            this.engine.log("System", `+${param.xpReward} XP`, 'loot');
          }
          if (param.hideAfter && opt.requiredState) {
            gameState.setFlag(opt.requiredState.flag, !opt.requiredState.value);
          }
          this.engine.renderScene(opt.destination || gameState.getCurrentSceneId());
          break;
        }
        case "combat":
          this.engine.combatSystem.startCombat(opt.actionDetails.enemy, opt);
          break;
        case "dialogue":
          this.engine.dialogueSystem.startDialogue(opt.actionDetails.npc);
          break;
        case "rest":
          gameState.modifyPlayerStat('hp', opt.actionDetails.heal || REST_HEAL_AMOUNT);
          this.engine.log("System", "You rested and recovered HP.");
          if (opt.actionDetails.hideAfter && opt.requiredState) {
            gameState.setFlag(opt.requiredState.flag, !opt.requiredState.value);
          }
          this.engine.renderScene(opt.destination || gameState.getCurrentSceneId());
          break;
        case "return_to_world":
          this.engine.renderScene(gameState.getReturnSceneId() || "dungeon_start");
          break;
        case "full_rest": {
          const p = gameState.getPlayer();
          gameState.modifyPlayerStat('hp', p.maxHp - p.hp);
          gameState.modifyPlayerStat('ap', p.maxAp - p.ap);
          this.engine.log("System", "You slept soundly. Health and Actions fully restored.");
          if (opt.destination) this.engine.renderScene(opt.destination);
          break;
        }
        case "eat_snack":
          gameState.modifyPlayerStat('hp', SNACK_HEAL_AMOUNT);
          this.engine.log("System", `You ate a warm meal from the pot. Recovered ${SNACK_HEAL_AMOUNT} HP.`, 'loot');
          if (opt.destination) this.engine.renderScene(opt.destination);
          break;
        case "manage_chest":
          this.engine.ui.renderMuseumChestUI();
          break;
      }
    } else if (opt.destination) {
      this.engine.renderScene(opt.destination);
    }
  }

  // Resolves the correct description string for a scene, accounting for
  // conditional descriptions and description hooks.
  _resolveDescription(scene) {
    let desc = scene.description;

    if (Array.isArray(scene.description)) {
      desc = scene.description.find(d => !d.requiredState)?.text || '';
      for (const d of scene.description) {
        if (d.requiredState && gameState.getFlag(d.requiredState.flag) === d.requiredState.value) {
          desc = d.text;
          break;
        }
      }
    }

    if (scene.descriptionHook === "museumChestContents") {
      const chest = gameState.getMuseumChest();
      if (chest && chest.length > 0) {
        const names = chest.map(b => {
          const name = this.engine.data.items[b.item]?.name || b.item;
          return b.amount > 1 ? `${name} (x${b.amount})` : name;
        }).join(", ");
        desc += `<br><br>Displayed within the room: <span style="color:var(--gold-color);">${names}</span>.`;
      } else {
        desc += `<br><br>The room is currently devoid of trophies.`;
      }
    }

    return desc;
  }
}
