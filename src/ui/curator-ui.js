import { gameState } from "../core/state.js";
import { createElement, clearElement, buildOptionButton } from "../core/utils.js";
import { CSS, EL, LOG } from "../core/config.js";

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

    const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    const container = document.getElementById(EL.SCENE_OPTIONS);
    const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);

    clearElement(container);
    panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());

    if (reminder) {
      reminder.innerText = this.engine.t('ui.curatorTitle');
      container.appendChild(reminder);
    }

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
    const doneBtn = buildOptionButton(this.engine.t('ui.curatorDone'));
    doneBtn.onclick = () => {
      this.engine._customUIOpen = false;
      this.engine.scene.renderOptions(scene);
    };
    container.appendChild(doneBtn);

    // 2. Exhibits Section
    const exhibitsSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    exhibitsSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.curatorHeadingExhibits')));

    const displays = gameState.getDisplaysForScene(sceneId);
    if (displays.length > 0) {
      displays.forEach(d => {
        const itemName = d.item ? (this.engine.data.items[d.item]?.name || d.item) : this.engine.t('ui.curatorEmpty');
        const badge = d.item ? itemName : this.engine.t('ui.curatorEmpty');
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
      const emptyLabel = buildOptionButton(this.engine.t('ui.curatorEmpty'));
      emptyLabel.disabled = true;
      exhibitsSection.appendChild(emptyLabel);
    }

    panel.insertBefore(exhibitsSection, skillsContainer);

    // 3. Purchase Exhibit Case Button
    const installCost = 50;
    const p = gameState.getPlayer();
    const canInstall = p.resources.gold >= installCost;
    
    const installSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    const installBtn = buildOptionButton(
      this.engine.t('ui.curatorInstall', { cost: installCost }),
      canInstall ? null : this.engine.t('ui.notEnoughGold')
    );
    if (!canInstall) installBtn.disabled = true;
    installBtn.onclick = () => {
      const count = displays.length + 1;
      const defaultName = `Display Case ${count}`;
      const customName = prompt("Enter a name for your new display case:", defaultName);
      if (customName === null) return; // User cancelled
      const name = customName.trim() || defaultName;

      gameState.modifyPlayerStat('gold', -installCost);
      gameState.addDisplayToScene(sceneId, {
        name: name
      });
      this.engine.log(LOG.SYSTEM, `You spent ${installCost} gold and installed the "${name}".`);
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
    const name = itemData?.name || itemId;

    // 1. Back button
    const backBtn = buildOptionButton(this.engine.t('ui.curatorBack'));
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
    const takeBtn = buildOptionButton(this.engine.t('ui.curatorRetrieve'));
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
    const cancelBtn = buildOptionButton(this.engine.t('ui.curatorCancel'));
    cancelBtn.onclick = () => this.render('dashboard');
    container.appendChild(cancelBtn);

    // 2. Select Artifact Section
    const selectSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    selectSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.curatorSelectArtifact')));

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
        const name = itemData?.name || invItem.item;
        const label = invItem.amount > 1 ? `${name} (x${invItem.amount})` : name;
        const badge = itemData?.type || null;

        const btn = buildOptionButton(label, badge);
        btn.onclick = () => {
          gameState.placeItemInDisplay(sceneId, displayId, invItem.item);
          this.engine.log(LOG.SYSTEM, this.engine.t('actions.displayDeposited', { name, display: display.name }));
          this._refreshSceneDesc();
          this.render('dashboard');
        };
        selectSection.appendChild(btn);
      });
    } else {
      const noneLabel = createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.curatorNoEligibleItems'));
      noneLabel.style.textAlign = 'center';
      noneLabel.style.padding = '20px';
      selectSection.appendChild(noneLabel);
    }

    panel.insertBefore(selectSection, skillsContainer);
  }
}
