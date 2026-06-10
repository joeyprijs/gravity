import { gameState } from "../core/state.js";
import { createElement, buildOptionButton, escapeHtml, getItemLabel, resetOptionsPanel } from "../core/utils.js";
import { ACTIONS, CSS, LOG } from "../core/config.js";

// Helper to wrap StateManager methods for reputation calculations.
// Only wrap once to prevent infinite recursion.
export function patchState(items = {}) {
  if (gameState._curatorPatched) {
    gameState._items = items;
    return;
  }
  gameState._curatorPatched = true;
  gameState._items = items;

  // Add helper methods
  gameState.getMuseumReputation = function() {
    return this.state.player?.attributes?.reputation ?? 0;
  };

  gameState._updateReputation = function() {
    let rep = this.state.museumReputation ?? 0;
    if (this.state.displays) {
      for (const sceneId in this.state.displays) {
        for (const display of this.state.displays[sceneId]) {
          if (display.item && this._items && this._items[display.item]) {
            const itemRep = this._items[display.item].reputation ?? 0;
            rep += itemRep;
          }
        }
      }
    }
    if (this.state.player && this.state.player.attributes) {
      this.state.player.attributes.reputation = rep;
    }
  };

  // Wrap init
  const originalInit = gameState.init;
  gameState.init = function(rules, itemsData = {}) {
    originalInit.call(gameState, rules, itemsData);
    this._items = itemsData;
    if (this.state.player && this.state.player.attributes) {
      if (!('reputation' in this.state.player.attributes)) {
        this.state.player.attributes.reputation = 0;
      }
    }
    this._updateReputation();
  };

  // Wrap modifyPlayerStat
  const originalModify = gameState.modifyPlayerStat;
  gameState.modifyPlayerStat = function(stat, amount) {
    if (stat === 'reputation') {
      this.state.museumReputation = (this.state.museumReputation ?? 0) + amount;
      this._updateReputation();
      this.notifyListeners('stats');
    } else {
      originalModify.call(gameState, stat, amount);
    }
  };

  // Wrap addToInventory
  const originalAdd = gameState.addToInventory;
  gameState.addToInventory = function(itemId, amount = 1, options = {}) {
    originalAdd.call(gameState, itemId, amount, options);
    if (this._items && this._items[itemId]) {
      const itemData = this._items[itemId];
      if (itemData.reputation) {
        if (!this.state.obtainedItems) this.state.obtainedItems = [];
        if (!this.state.obtainedItems.includes(itemId)) {
          this.state.obtainedItems.push(itemId);
          this.modifyPlayerStat('reputation', itemData.reputation);
        }
      }
    }
  };

  // Wrap placeItemInDisplay / takeItemFromDisplay
  const originalPlace = gameState.placeItemInDisplay;
  gameState.placeItemInDisplay = function(sceneId, displayId, itemId) {
    const res = originalPlace.call(gameState, sceneId, displayId, itemId);
    if (res) {
      this._updateReputation();
      this.notifyListeners('inventory');
      this.notifyListeners('stats');
    }
    return res;
  };

  const originalTake = gameState.takeItemFromDisplay;
  gameState.takeItemFromDisplay = function(sceneId, displayId) {
    const itemId = originalTake.call(gameState, sceneId, displayId);
    if (itemId) {
      this._updateReputation();
      this.notifyListeners('inventory');
      this.notifyListeners('stats');
    }
    return itemId;
  };

  // Wrap loadFromObject / reset
  const originalLoad = gameState.loadFromObject;
  gameState.loadFromObject = function(parsedData) {
    originalLoad.call(gameState, parsedData);
    this._updateReputation();
    this.notifyListeners();
  };

  const originalReset = gameState.reset;
  gameState.reset = function() {
    originalReset.call(gameState);
    this._updateReputation();
    this.notifyListeners();
  };

  // Register migration v4 for reputation save file additions
  gameState.registerMigration(4, (data) => {
    if (!('museumReputation' in data)) {
      data.museumReputation = 0;
    }
    if (!('obtainedItems' in data)) {
      const currentItems = new Set();
      if (data.player && data.player.inventory) {
        data.player.inventory.forEach(i => currentItems.add(i.item));
      }
      if (data.player && data.player.equipment) {
        Object.values(data.player.equipment).forEach(itemId => {
          if (itemId) currentItems.add(itemId);
        });
      }
      if (data.displays) {
        for (const sceneId in data.displays) {
          data.displays[sceneId].forEach(d => {
            if (d.item) currentItems.add(d.item);
          });
        }
      }
      data.obtainedItems = Array.from(currentItems);
    }
  });
}

// Builds the exhibits status table appended to the description of any scene
// that has display cases. Returns '' for scenes without displays. Display
// names come from player input (prompt), so all dynamic values are escaped.
function buildExhibitsTable(engine, sceneId) {
  const displays = gameState.getDisplaysForScene(sceneId);
  if (!displays.length) return '';

  const header = `<thead><tr>`
    + `<th>${engine.t('plugin.curator.curatorTableStand')}</th>`
    + `<th>${engine.t('plugin.curator.curatorTableRelic')}</th>`
    + `</tr></thead>`;
  const rows = displays.map(d => {
    const itemName = d.item ? getItemLabel(engine.data.items, d.item) : engine.t('plugin.curator.curatorEmpty');
    const stateClass = d.item ? 'exhibits-table__item--filled' : 'exhibits-table__item--empty';
    return `<tr><td>${escapeHtml(d.name)}</td><td class="${stateClass}">${escapeHtml(itemName)}</td></tr>`;
  }).join('');

  return `<div class="exhibits-table-container"><table class="exhibits-table">${header}<tbody>${rows}</tbody></table></div>`;
}

function injectReputationHeader() {
  if (document.querySelector('.stat-item--reputation')) return;
  const goldItem = document.querySelector('.stat-item--gold');
  if (goldItem) {
    const repItem = document.createElement('div');
    repItem.className = 'stat-item stat-item--reputation';
    repItem.innerHTML = `
      <span class="stat-item__label">REP</span>
      <span class="stat-item__value" data-stat-bind="attributes.reputation"></span>
    `;
    goldItem.parentNode.appendChild(repItem);
  }
}

export default function curatorPlugin(engine) {
  // 1. Patch state manager methods
  patchState(engine.data.items);

  // 2. Decorate every scene that has display cases: exhibits table appended to
  // the description, plus the curator-panel option button.
  engine.registerSceneDecorator({
    description: (scene, sceneId) => buildExhibitsTable(engine, sceneId),
    options: (scene, optionsContainer) => {
      const sceneId = gameState.getCurrentSceneId();
      const hasDisplays = gameState.getDisplaysForScene(sceneId).length > 0;
      if (!scene.supportsExhibits && !hasDisplays) return;
      const btn = buildOptionButton(engine.t('plugin.curator.curatorTitle'));
      btn.onclick = () => engine.scene.handleOption({
        text: engine.t('plugin.curator.curatorTitle'),
        actions: [{ type: ACTIONS.MANAGE_EXHIBITS }]
      });
      optionsContainer.appendChild(btn);
    }
  });

  // 3. Register custom action handlers
  engine.registerAction("manage_exhibits", (action, engine) => {
    engine._customUIOpen = true;
    new CuratorUI(engine).render();
  });

  engine.registerAction("add_display", (action, engine) => {
    const sceneId = action.scene || gameState.getCurrentSceneId();
    const cost = action.cost || 0;
    const p = gameState.getPlayer();
    if (p.resources.gold < cost) {
      engine.log(LOG.SYSTEM, engine.t('ui.notEnoughGold'));
      return;
    }
    gameState.modifyPlayerStat('gold', -cost);
    gameState.addDisplayToScene(sceneId, {
      name: action.name || "Display Pedestal"
    });
    engine.log(LOG.SYSTEM, `A new ${action.name || "Display Pedestal"} has been added to the room.`);
  });

  // 4. Inject reputation stat DOM element into header
  injectReputationHeader();
  gameState.subscribe(() => {
    injectReputationHeader();
  });
}

// standalone CuratorUI dashboard logic
export class CuratorUI {
  constructor(engine) {
    this.engine = engine;
  }

  _refreshSceneDesc() {
    const scene = this.engine.data.scenes[gameState.getCurrentSceneId()];
    if (scene) this.engine.scene.refreshDescription(scene);
  }

  render(screen = 'dashboard', context = null) {
    const sceneId = gameState.getCurrentSceneId();
    const scene = this.engine.data.scenes[sceneId];
    if (!scene) return;

    const { panel, container, skillsContainer } = resetOptionsPanel(this.engine.t('plugin.curator.curatorTitle'));

    if (screen === 'dashboard') {
      this._renderDashboard(container, panel, skillsContainer, sceneId, scene);
    } else if (screen === 'inspect_display') {
      this._renderInspectDisplay(container, panel, skillsContainer, sceneId, context);
    } else if (screen === 'select_artifact') {
      this._renderSelectArtifact(container, panel, skillsContainer, sceneId, context);
    }

    this.engine.scrollNarrativeToBottom();
  }

  _renderDashboard(container, panel, skillsContainer, sceneId, scene) {
    // 1. Done Button
    const doneBtn = buildOptionButton(this.engine.t('plugin.curator.curatorDone'));
    doneBtn.onclick = () => {
      this.engine._customUIOpen = false;
      this.engine.scene.renderOptions(scene);
    };
    container.appendChild(doneBtn);

    // Museum Reputation Section
    const repSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    repSection.style.padding = '12px 15px';
    repSection.style.marginBottom = '15px';
    repSection.style.background = 'var(--list-item-bg)';
    repSection.style.border = '1px solid var(--panel-border)';
    
    const repTitle = createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('plugin.curator.museumReputationHeading'));
    repSection.appendChild(repTitle);
    
    const repVal = gameState.getMuseumReputation();
    const repText = createElement('div', CSS.ITEM_STATS, this.engine.t('plugin.curator.museumReputationValue', { value: repVal }));
    repText.style.fontWeight = 'bold';
    repSection.appendChild(repText);
    
    panel.insertBefore(repSection, skillsContainer);

    // 2. Exhibits Section
    const exhibitsSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    exhibitsSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('plugin.curator.curatorHeadingExhibits')));

    const displays = gameState.getDisplaysForScene(sceneId);
    if (displays.length > 0) {
      displays.forEach(d => {
        const badge = d.item ? getItemLabel(this.engine.data.items, d.item) : this.engine.t('plugin.curator.curatorEmpty');
        const btn = buildOptionButton(d.name, badge);
        btn.onclick = () => {
          if (d.item) {
            this.render('inspect_display', d.id);
          } else {
            this.render('select_artifact', d.id);
          }
        };
        exhibitsSection.appendChild(btn);
      });
    } else {
      const emptyLabel = buildOptionButton(this.engine.t('plugin.curator.curatorEmpty'));
      emptyLabel.disabled = true;
      exhibitsSection.appendChild(emptyLabel);
    }

    panel.insertBefore(exhibitsSection, skillsContainer);

    // 3. Purchase Exhibit Case Button
    const installCost = this.engine.data.rules?.curator?.installCost ?? 50;
    const p = gameState.getPlayer();
    const canInstall = p.resources.gold >= installCost;
    
    const installSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    const installBtn = buildOptionButton(
      this.engine.t('plugin.curator.curatorInstall', { cost: installCost }),
      canInstall ? null : this.engine.t('ui.notEnoughGold')
    );
    if (!canInstall) installBtn.disabled = true;
    installBtn.onclick = () => {
      const count = displays.length + 1;
      const defaultName = this.engine.t('plugin.curator.curatorInstallDefault', { count });
      const customName = prompt(this.engine.t('plugin.curator.curatorInstallPrompt'), defaultName);
      if (customName === null) return; // User cancelled
      const name = customName.trim() || defaultName;

      gameState.modifyPlayerStat('gold', -installCost);
      gameState.addDisplayToScene(sceneId, {
        name: name
      });
      this.engine.log(LOG.SYSTEM, this.engine.t('plugin.curator.curatorInstallSuccess', { cost: installCost, name }));
      this._refreshSceneDesc();
      this.render('dashboard');
    };
    installSection.appendChild(installBtn);
    panel.insertBefore(installSection, skillsContainer);
  }

  _renderInspectDisplay(container, panel, skillsContainer, sceneId, displayId) {
    const displays = gameState.getDisplaysForScene(sceneId);
    const display = displays.find(d => d.id === displayId);
    if (!display || !display.item) {
      this.render('dashboard');
      return;
    }

    const itemId = display.item;
    const itemData = this.engine.data.items[itemId];
    const name = getItemLabel(this.engine.data.items, itemId);

    // 1. Back button
    const backBtn = buildOptionButton(this.engine.t('plugin.curator.curatorBack'));
    backBtn.onclick = () => this.render('dashboard');
    container.appendChild(backBtn);

    // 2. Display Details Section
    const detailSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    detailSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, display.name));

    // Item Info
    const infoContainer = createElement('div', CSS.ITEM_LIST_ITEM);
    infoContainer.style.padding = '15px';
    infoContainer.style.marginBottom = '15px';

    infoContainer.appendChild(createElement('h3', CSS.ITEM_TITLE, name));
    if (itemData?.type) {
      infoContainer.appendChild(createElement('div', CSS.ITEM_TYPE, itemData.type));
    }
    if (itemData?.description) {
      infoContainer.appendChild(createElement('p', CSS.ITEM_DESCRIPTION, itemData.description));
    }
    
    if (itemData?.value !== undefined || itemData?.actionPoints !== undefined) {
      let stats = `Value: ${itemData.value ?? 0} Gold`;
      if (itemData.actionPoints) stats += ` | AP Cost: ${itemData.actionPoints}`;
      infoContainer.appendChild(createElement('p', CSS.ITEM_STATS, stats));
    }

    detailSection.appendChild(infoContainer);

    // 3. Take Button
    const takeBtn = buildOptionButton(this.engine.t('plugin.curator.curatorRetrieve'));
    takeBtn.onclick = () => {
      gameState.takeItemFromDisplay(sceneId, displayId);
      this.engine.log(LOG.SYSTEM, this.engine.t('actions.displayTook', { name, display: display.name }));
      this._refreshSceneDesc();
      this.render('dashboard');
    };
    detailSection.appendChild(takeBtn);

    panel.insertBefore(detailSection, skillsContainer);
  }

  _renderSelectArtifact(container, panel, skillsContainer, sceneId, displayId) {
    const displays = gameState.getDisplaysForScene(sceneId);
    const display = displays.find(d => d.id === displayId);
    if (!display) {
      this.render('dashboard');
      return;
    }

    // 1. Cancel button
    const cancelBtn = buildOptionButton(this.engine.t('plugin.curator.curatorCancel'));
    cancelBtn.onclick = () => this.render('dashboard');
    container.appendChild(cancelBtn);

    // 2. Select Artifact Section
    const selectSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    selectSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('plugin.curator.curatorSelectArtifact')));

    // Get eligible player inventory items
    const player = gameState.getPlayer();
    const isEquipped = (itemId) => Object.values(player.equipment).includes(itemId);
    
    // Filter inventory to show all non-equipped items
    let eligibleItems = player.inventory.filter(invItem => {
      if (isEquipped(invItem.item)) return false;
      return !!this.engine.data.items[invItem.item];
    });

    if (eligibleItems.length > 0) {
      eligibleItems.forEach(invItem => {
        const itemData = this.engine.data.items[invItem.item];
        const name = getItemLabel(this.engine.data.items, invItem.item);
        const badge = itemData?.type || null;

        const btn = buildOptionButton(getItemLabel(this.engine.data.items, invItem.item, invItem.amount), badge);
        btn.onclick = () => {
          gameState.placeItemInDisplay(sceneId, displayId, invItem.item);
          this.engine.log(LOG.SYSTEM, this.engine.t('actions.displayDeposited', { name, display: display.name }));
          this._refreshSceneDesc();
          this.render('dashboard');
        };
        selectSection.appendChild(btn);
      });
    } else {
      const noneLabel = createElement('p', CSS.ITEM_TYPE, this.engine.t('plugin.curator.curatorNoEligibleItems'));
      noneLabel.style.textAlign = 'center';
      noneLabel.style.padding = '20px';
      selectSection.appendChild(noneLabel);
    }

    panel.insertBefore(selectSection, skillsContainer);
  }
}
