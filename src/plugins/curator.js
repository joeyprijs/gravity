import { gameState } from "../core/state.js";
import { attrRowHtml, createElement, buildOptionButton, escapeHtml, getItemLabel, resetOptionsPanel } from "../core/utils.js";
import { ACTIONS, CSS, LOG } from "../core/config.js";

// The curator's reputation model: a permanent score (state.museumReputation,
// earned by acquiring relics for the first time) plus a dynamic bonus from
// relics currently on display. player.attributes.reputation is the derived sum.
// Reputation recalculation hangs off the formal StateManager plugin API —
// mutation hooks, a custom stat handler, and a save migration; no engine or
// StateManager methods are wrapped. The plugin's own top-level save fields
// (museumReputation, obtainedItems) are read/written directly on the state
// object, which is the documented pattern for plugin-owned save data.

// Item database reference, set by registerCuratorState(). Module-level because
// the hook callbacks need it and the engine owns the loaded data.
let curatorItems = {};
let hooksRegistered = false;

/** Returns the museum reputation currently shown to the player (permanent + display bonus). */
export function getMuseumReputation() {
  return gameState.getPlayer()?.attributes?.reputation ?? 0;
}

// Recomputes the derived reputation attribute from the permanent score plus
// the reputation of every relic currently on display.
function updateReputation() {
  let rep = gameState.state.museumReputation ?? 0;
  for (const sceneId in (gameState.state.displays ?? {})) {
    for (const display of gameState.state.displays[sceneId]) {
      if (display.item && curatorItems[display.item]) {
        rep += curatorItems[display.item].attributes?.reputation ?? 0;
      }
    }
  }
  gameState.setPlayerAttribute('reputation', rep);
}

// First-time acquisition of a reputation-bearing item awards its reputation
// permanently. obtainedItems tracks which items have already been counted.
function handleAcquisition(itemId) {
  const itemData = curatorItems[itemId];
  if (!itemData?.attributes?.reputation) return;
  if (!gameState.state.obtainedItems) gameState.state.obtainedItems = [];
  if (gameState.state.obtainedItems.includes(itemId)) return;
  gameState.state.obtainedItems.push(itemId);
  gameState.modifyPlayerStat('reputation', itemData.attributes.reputation);
}

// Registers the curator's state integrations: the reputation stat handler,
// the mutation hooks that keep the derived attribute current, and the save
// migration for the plugin's fields. Idempotent — repeat calls only refresh
// the item database reference (the test suite re-inits state per test).
export function registerCuratorState(items = {}) {
  curatorItems = items;
  if (hooksRegistered) return;
  hooksRegistered = true;

  // modifyPlayerStat('reputation', delta) adjusts the permanent score; the
  // visible attribute is recomputed (and notified) from updateReputation.
  gameState.registerStatHandler('reputation', (amount) => {
    gameState.state.museumReputation = (gameState.state.museumReputation ?? 0) + amount;
    updateReputation();
  });

  gameState.onMutation((method, info) => {
    switch (method) {
      case 'init':
      case 'loadFromObject':
      case 'reset':
        updateReputation();
        break;
      case 'addToInventory':
        handleAcquisition(info.itemId);
        break;
      case 'placeItemInDisplay':
      case 'takeItemFromDisplay':
        updateReputation();
        break;
    }
  });

  // Migration v4: reputation save file additions
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

// Whether the sheet row has been injected — checked before touching the DOM
// so the subscribe callback below costs a boolean once injection is done.
let sheetRowInjected = false;

// Injects a reputation row into the sheet tab's character list (the
// attributes widget), after the gold row.
function injectReputationSheetRow(engine) {
  if (sheetRowInjected) return;
  const list = document.querySelector('.attr-list--character');
  if (!list) return;
  // Same row shape as the sheet's own rows (see attrRowHtml) — parsed via a
  // template element because this row is inserted into an existing list.
  const tpl = document.createElement('template');
  tpl.innerHTML = attrRowHtml(
    engine.t('plugin.curator.reputationLabel'),
    '<span data-stat-bind="attributes.reputation"></span>',
    'attr-list__row--reputation'
  );
  const row = tpl.content.firstElementChild;
  // The stats update loop only fills binds on 'stats' notifications; seed the
  // value here so the row isn't blank when injected by a non-stats one.
  row.querySelector('[data-stat-bind]').textContent = getMuseumReputation();
  const goldRow = list.querySelector('[data-stat-bind="resources.gold"]')?.closest('.attr-list__row');
  if (goldRow) goldRow.insertAdjacentElement('afterend', row);
  else list.appendChild(row);
  sheetRowInjected = true;
}

export default function curatorPlugin(engine) {
  // 1. Register state integrations (stat handler, mutation hooks, migration)
  registerCuratorState(engine.data.items);

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
    engine.setCustomUIOpen(true);
    new CuratorUI(engine).render();
  });

  engine.registerAction("add_display", (action, engine) => {
    const sceneId = action.scene || gameState.getCurrentSceneId();
    const cost = action.cost ?? 0;
    const p = gameState.getPlayer();
    if (p.resources.gold < cost) {
      engine.log(LOG.SYSTEM, engine.t('ui.notEnoughGold'));
      return;
    }
    gameState.modifyPlayerStat('gold', -cost);
    const displayName = action.name || engine.t('plugin.curator.displayDefaultName');
    gameState.addDisplayToScene(sceneId, { name: displayName });
    engine.log(LOG.SYSTEM, engine.t('plugin.curator.displayAddedLog', { name: displayName }));
  });

  // 4. Inject the reputation row into the sheet tab. The sheet panel doesn't
  // exist yet at plugin-load time (ui.setup runs later), so injection rides
  // the state notifications and retries until the panel appears.
  gameState.subscribe(() => {
    injectReputationSheetRow(engine);
  });

  // Tabs are fully data-driven, so a game can configure the reputation stat
  // into invisibility — warn like validate.js does for a missing options tab
  // (validation itself stays plugin-agnostic).
  const tabs = engine.data.rules?.tabs;
  if (tabs && !tabs.some(t => t?.widget === 'attributes'))
    console.warn('[Gravity] curator: no tab with widget "attributes" — the reputation stat renders nowhere');
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
      this.engine.setCustomUIOpen(false);
      this.engine.scene.renderOptions(scene);
    };
    container.appendChild(doneBtn);

    // Museum Reputation Section
    const repSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC, 'curator-panel__rep']);

    const repTitle = createElement('div', CSS.SECTION_HEADING, this.engine.t('plugin.curator.museumReputationHeading'));
    repSection.appendChild(repTitle);

    const repVal = getMuseumReputation();
    const repText = createElement('div', [CSS.CARD_STATS, 'curator-panel__rep-value'], this.engine.t('plugin.curator.museumReputationValue', { value: repVal }));
    repSection.appendChild(repText);
    
    panel.insertBefore(repSection, skillsContainer);

    // 2. Exhibits Section
    const exhibitsSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    exhibitsSection.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t('plugin.curator.curatorHeadingExhibits')));

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
    
    const installSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
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
    const detailSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    detailSection.appendChild(createElement('div', CSS.SECTION_HEADING, display.name));

    // Item Info
    const infoContainer = createElement('div', [CSS.CARD, 'curator-panel__item-info']);

    infoContainer.appendChild(createElement('h3', CSS.CARD_TITLE, name));
    if (itemData?.type) {
      infoContainer.appendChild(createElement('div', CSS.CARD_BODY, itemData.type));
    }
    if (itemData?.description) {
      infoContainer.appendChild(createElement('p', CSS.CARD_BODY, itemData.description));
    }
    
    if (itemData?.value !== undefined || itemData?.attributes?.actionPoints !== undefined) {
      let stats = this.engine.t('plugin.curator.inspectValue', { value: itemData.value ?? 0 });
      if (itemData.attributes?.actionPoints) stats += ` | ${this.engine.t('plugin.curator.inspectApCost', { ap: itemData.attributes.actionPoints })}`;
      infoContainer.appendChild(createElement('p', CSS.CARD_STATS, stats));
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
    const selectSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    selectSection.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t('plugin.curator.curatorSelectArtifact')));

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
      const noneLabel = createElement('p', [CSS.CARD_BODY, 'curator-panel__empty-note'], this.engine.t('plugin.curator.curatorNoEligibleItems'));
      selectSection.appendChild(noneLabel);
    }

    panel.insertBefore(selectSection, skillsContainer);
  }
}
