import { buildCard, buildOptionButton, buildPanelSection, addDirectionMarker, createElement, getItemLabel, isSpecialItem, itemCardStatsFor, resetOptionsPanel } from '../../core/utils.js';
import { CSS, EL, LOG } from '../../core/config.js';
import {
  DEFAULT_WING_COST, addDisplayToScene, findDisplay, getDisplaysForScene, getMuseumReputation,
  nextMuseumSlot, placeItemInDisplay, takeItemFromDisplay,
} from './museum.js';

// The reputation line under the scene name. It hangs off the location
// reminder, which resetOptionsPanel rewrites on every render, so it is
// rebuilt with the current value each time.
export function showReputationLine(engine) {
  const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
  if (!reminder) return;
  const line = createElement('div', 'curator-scene-rep');
  line.appendChild(createElement('span', 'curator-scene-rep__label', engine.t('plugin.curator.reputationLabel')));
  line.appendChild(createElement('span', 'curator-scene-rep__value',
    engine.t('plugin.curator.museumReputationValue', { value: getMuseumReputation(engine.state) })));
  reminder.appendChild(line);
}


// The curator panel: dashboard, case inspection, and artifact selection.
export class CuratorUI {
  constructor(engine) {
    this.engine = engine;
  }

  render(screen = 'dashboard', context = null) {
    const sceneId = this.engine.state.getCurrentSceneId();
    const scene = this.engine.data.scenes[sceneId];
    if (!scene) return;

    // The heading names what you are looking at: the room, or the case you
    // stepped up to.
    const display = context
      ? findDisplay(this.engine.state, sceneId, context)
      : null;
    const { panel, container, skillsContainer } = resetOptionsPanel(display?.name ?? (scene.title || scene.name));

    if (scene.showsReputation) showReputationLine(this.engine);

    if (screen === 'dashboard' && scene.museumHall) {
      this._renderHall(container, panel, skillsContainer, scene);
    } else if (screen === 'dashboard') {
      this._renderDashboard(container, panel, skillsContainer, sceneId, scene);
    } else if (screen === 'inspect_display') {
      this._renderInspectDisplay(container, panel, skillsContainer, sceneId, context);
    } else if (screen === 'select_artifact') {
      this._renderSelectArtifact(container, panel, skillsContainer, sceneId, context);
    }

    this.engine.scrollNarrativeToBottom();
  }

  // The way out. A room with nothing to do but curate gives the panel its own
  // exit; a room with other options keeps a close button, or they would be
  // unreachable.
  _exitButton(scene) {
    const isBack = (o) => o.isBack === true || (o.actions ?? []).some(a => a.type === 'return');
    const options = scene.options ?? [];
    const back = options.length === 1 && isBack(options[0]) ? options[0] : null;

    if (!back) {
      // The back path below needs no log line: handleOption logs the option.
      const close = this.engine.t('plugin.curator.curatorClose');
      const doneBtn = buildOptionButton(close);
      doneBtn.onclick = () => {
        this.engine.log(LOG.PLAYER, close, 'choice');
        this.engine.setCustomUIOpen(false);
        this.engine.scene.renderOptions(scene);
      };
      return doneBtn;
    }

    const backBtn = buildOptionButton(back.text);
    // Built here rather than by the scene renderer, so it carries its own arrow.
    const dest = back.actions?.find(a => a.type === 'navigate')?.destination;
    addDirectionMarker(this.engine, scene, this.engine.data.scenes[dest], backBtn);
    if (this.engine.data.scenes[dest]) backBtn.dataset.destination = dest;
    backBtn.onclick = () => {
      this.engine.setCustomUIOpen(false);
      this.engine.scene.handleOption(back);   // logs the choice and walks out
    };
    return backBtn;
  }

  // The exit, a door into every wing in slot order, then construction.
  _renderHall(container, panel, skillsContainer, scene) {
    container.appendChild(this._exitButton(scene));

    const wingsSection = buildPanelSection(this.engine.t('plugin.curator.wingsHeading'));

    const wings = Object.entries(this.engine.data.scenes)
      .filter(([, s]) => Number.isInteger(s.museumSlot))
      .sort((a, b) => a[1].museumSlot - b[1].museumSlot);

    for (const [id, wing] of wings) {
      const text = this.engine.t('plugin.curator.wingEnter', { name: wing.name });
      const btn = buildOptionButton(text);
      addDirectionMarker(this.engine, scene, wing, btn);
      btn.dataset.destination = id;
      btn.onclick = () => {
        this.engine.setCustomUIOpen(false);
        this.engine.scene.handleOption({ text, actions: [{ type: 'navigate', destination: id }] });
      };
      wingsSection.appendChild(btn);
    }
    panel.insertBefore(wingsSection, skillsContainer);

    // No layout, no construction; build_wing refuses on the same condition.
    if (!this.engine.pluginConfig('curator').museumLayout) return;

    // Construction ends every museum room's panel.
    const cost = this.engine.pluginConfig('curator').wingCost ?? DEFAULT_WING_COST;
    const affordable = this.engine.state.getPlayer().resources.gold >= cost;
    const section = buildPanelSection(this.engine.t('plugin.curator.constructionHeading'));
    const buildBtn = buildOptionButton(
      this.engine.t('plugin.curator.wingBuild', { cost }),
      affordable ? null : this.engine.t('ui.notEnoughGold')
    );
    if (!affordable) buildBtn.disabled = true;
    buildBtn.onclick = () => {
      const slot = nextMuseumSlot(this.engine);
      const fallback = this.engine.t('plugin.curator.wingDefaultName', { count: slot + 1 });
      const typed = prompt(this.engine.t('plugin.curator.wingPrompt'), fallback);
      if (typed === null) return;   // cancelled
      // The action, not handleOption: nobody leaves the hall, so the panel
      // redraws itself.
      this.engine.runActions([{ type: 'build_wing', name: typed.trim() || fallback }]);
      this.render();
    };
    section.appendChild(buildBtn);
    panel.insertBefore(section, skillsContainer);
  }

  _renderDashboard(container, panel, skillsContainer, sceneId, scene) {
    container.appendChild(this._exitButton(scene));

    const exhibitsSection = buildPanelSection(this.engine.t('plugin.curator.curatorHeadingExhibits'));

    const displays = getDisplaysForScene(this.engine.state, sceneId);
    if (displays.length > 0) {
      displays.forEach(d => {
        const badge = d.item ? getItemLabel(this.engine.data.items, d.item) : this.engine.t('plugin.curator.curatorEmpty');
        const btn = buildOptionButton(d.name, badge);
        btn.onclick = () => {
          // Not a scene option, so the button logs its own choice line.
          if (d.item) {
            this.engine.log(LOG.PLAYER, this.engine.t('plugin.curator.displayApproach', { display: d.name }), 'choice');
            this.render('inspect_display', d.id);
          } else {
            this.engine.log(LOG.PLAYER, this.engine.t('plugin.curator.displayApproachEmpty', { display: d.name }), 'choice');
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

    const installCost = this.engine.pluginConfig('curator').installCost ?? 50;
    const p = this.engine.state.getPlayer();
    const canInstall = p.resources.gold >= installCost;

    const installSection = buildPanelSection(this.engine.t('plugin.curator.constructionHeading'));
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

      this.engine.state.modifyPlayerStat('gold', -installCost);
      addDisplayToScene(this.engine.state, sceneId, { name });
      this.engine.log(LOG.SYSTEM, this.engine.t('plugin.curator.curatorInstallSuccess', { cost: installCost, name }));
      this.render('dashboard');
    };
    installSection.appendChild(installBtn);
    panel.insertBefore(installSection, skillsContainer);
  }

  _renderInspectDisplay(container, panel, skillsContainer, sceneId, displayId) {
    const display = findDisplay(this.engine.state, sceneId, displayId);
    if (!display || !display.item) {
      this.render('dashboard');
      return;
    }

    const itemId = display.item;
    const itemData = this.engine.data.items[itemId];
    const name = getItemLabel(this.engine.data.items, itemId);

    // The heading names the case, so the button carries the verb alone.
    const backBtn = buildOptionButton(this.engine.t('plugin.curator.curatorBack'));
    backBtn.onclick = () => {
      this.engine.log(LOG.PLAYER, this.engine.t('plugin.curator.displayLeave', { display: display.name }), 'choice');
      this.render('dashboard');
    };
    container.appendChild(backBtn);

    // No heading: the panel's own heading is the case's name.
    const detailSection = buildPanelSection();

    // The same card as in the pack; clicking it takes the relic out.
    const itemCard = buildCard({
      tag: 'button',
      title: name,
      body: itemData?.description,
      stats: itemData ? itemCardStatsFor(this.engine, itemData) : undefined,
    });
    itemCard.onclick = () => {
      takeItemFromDisplay(this.engine.state, sceneId, displayId);
      this.engine.log(LOG.SYSTEM, this.engine.t('plugin.curator.displayTook', { name, display: display.name }));
      this.render('dashboard');
    };
    detailSection.appendChild(itemCard);

    // Reading is its own act, so the card keeps its one meaning.
    if (itemData?.story) {
      const readBtn = buildOptionButton(this.engine.t('plugin.curator.displayRead', { name }));
      readBtn.onclick = () => this.engine.readStory(itemId);
      detailSection.appendChild(readBtn);
    }

    panel.insertBefore(detailSection, skillsContainer);
  }

  _renderSelectArtifact(container, panel, skillsContainer, sceneId, displayId) {
    const display = findDisplay(this.engine.state, sceneId, displayId);
    if (!display) {
      this.render('dashboard');
      return;
    }

    // Same words as the filled case's back button; the log line differs.
    const cancelBtn = buildOptionButton(this.engine.t('plugin.curator.curatorBack'));
    cancelBtn.onclick = () => {
      this.engine.log(LOG.PLAYER,
        this.engine.t('plugin.curator.displayLeaveEmpty', { display: display.name }), 'choice');
      this.render('dashboard');
    };
    container.appendChild(cancelBtn);

    const selectSection = buildPanelSection(this.engine.t('plugin.curator.curatorSelectArtifact'));

    const player = this.engine.state.getPlayer();
    const isEquipped = (itemId) => Object.values(player.equipment).includes(itemId);

    // Anything the player can part with; Special items never are.
    const eligibleItems = player.inventory.filter(invItem => {
      if (isEquipped(invItem.item)) return false;
      const itemData = this.engine.data.items[invItem.item];
      if (isSpecialItem(itemData)) return false;
      return !!itemData;
    });

    if (eligibleItems.length > 0) {
      eligibleItems.forEach(invItem => {
        const itemData = this.engine.data.items[invItem.item];
        const name = getItemLabel(this.engine.data.items, invItem.item);
        const badge = itemData?.type || null;

        const btn = buildOptionButton(getItemLabel(this.engine.data.items, invItem.item, invItem.amount), badge);
        btn.onclick = () => {
          placeItemInDisplay(this.engine.state, sceneId, displayId, invItem.item);
          this.engine.log(LOG.SYSTEM, this.engine.t('plugin.curator.displayDeposited', { name, display: display.name }));
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
