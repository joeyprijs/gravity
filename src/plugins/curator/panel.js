import { buildCard, buildOptionButton, buildPanelSection, addDirectionMarker, createElement, getItemLabel, isSpecialItem, itemCardStatsFor, resetOptionsPanel } from '../../core/utils.js';
import { CSS, EL, LOG } from '../../core/config.js';
import {
  DEFAULT_WING_COST, addDisplayToScene, findDisplay, getDisplaysForScene, getMuseumReputation,
  nextMuseumSlot, placeItemInDisplay, takeItemFromDisplay,
} from './museum.js';

// Pins the museum's reputation under the scene name in the options panel, for
// scenes flagged `showsReputation` — so it reads at a glance from anywhere in
// the museum, not only with the curator panel open. It hangs off the location
// reminder (sharing its underline) rather than sitting between the options,
// and resetOptionsPanel rewrites that element's text on every render, so the
// line is discarded and rebuilt with the current value each time.
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

    // The panel names what you are looking at, never itself — a chest's panel
    // names the chest, a dialogue names the speaker. On the dashboard that is
    // the room (the panel opens on arrival and IS what the room looks like);
    // drilled into a case, it is the case, so the heading follows you in.
    const display = context
      ? findDisplay(this.engine.state, sceneId, context)
      : null;
    const { panel, container, skillsContainer } = resetOptionsPanel(display?.name ?? (scene.title || scene.name));

    // resetOptionsPanel rewrote the reminder, so the standing reputation line
    // has to be rebuilt here too — it reads the same, in the same place, with
    // the panel open as without it.
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

  // The way out of the panel. When curating is ALL there is to do in the room,
  // that's the room's own exit — the panel opens on arrival, so a "Leave the
  // exhibits" that revealed nothing but a single "Return to…" was a step for
  // its own sake. A room with anything else to do keeps its own exit button,
  // or those options would be unreachable while the panel is up.
  _exitButton(scene) {
    const isBack = (o) => o.isBack === true || (o.actions ?? []).some(a => a.type === 'return');
    const options = scene.options ?? [];
    const back = options.length === 1 && isBack(options[0]) ? options[0] : null;

    if (!back) {
      // The button carries the words the log records, as the chest's "Close
      // Chest" does. The back-button path below needs no line of its own:
      // walking out through handleOption logs the option's own text.
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
    // A museum room's panel is built here rather than by the scene renderer, so
    // its way out has to carry its own direction marker or the museum would be
    // the one place indoors where doors don't show which way they go.
    const dest = back.actions?.find(a => a.type === 'navigate')?.destination;
    addDirectionMarker(this.engine, scene, this.engine.data.scenes[dest], backBtn);
    if (this.engine.data.scenes[dest]) backBtn.dataset.destination = dest;
    backBtn.onclick = () => {
      this.engine.setCustomUIOpen(false);
      this.engine.scene.handleOption(back);   // logs the choice and walks out
    };
    return backBtn;
  }

  // The hall: the way out of the museum, then a door into every wing in slot
  // order (so they read the way the map does), then construction. Same shape as
  // a wing's panel — exit, what's here, what you can add.
  _renderHall(container, panel, skillsContainer, scene) {
    container.appendChild(this._exitButton(scene));

    const wingsSection = buildPanelSection(this.engine.t('plugin.curator.wingsHeading'));

    const wings = Object.entries(this.engine.data.scenes)
      .filter(([, s]) => Number.isInteger(s.museumSlot))
      .sort((a, b) => a[1].museumSlot - b[1].museumSlot);

    for (const [id, wing] of wings) {
      const text = this.engine.t('plugin.curator.wingEnter', { name: wing.name });
      const btn = buildOptionButton(text);
      // Slot order already reads the way the map does; the marker says it
      // outright — the wings sit directly above and below the hall.
      addDirectionMarker(this.engine, scene, wing, btn);
      btn.dataset.destination = id;
      btn.onclick = () => {
        this.engine.setCustomUIOpen(false);
        this.engine.scene.handleOption({ text, actions: [{ type: 'navigate', destination: id }] });
      };
      wingsSection.appendChild(btn);
    }
    panel.insertBefore(wingsSection, skillsContainer);

    // No layout, no construction (the build_wing action refuses on the same
    // condition): a built wing's geometry is derived from museumLayout.
    if (!this.engine.pluginConfig('curator').museumLayout) return;

    // Construction — what the player can add here — ends every museum room's
    // panel, so building is always in the same place: a wing in the hall, a
    // case in a wing.
    const cost = this.engine.pluginConfig('curator').wingCost ?? DEFAULT_WING_COST;
    const affordable = this.engine.state.getPlayer().resources.gold >= cost;
    const section = buildPanelSection(this.engine.t('plugin.curator.constructionHeading'));
    const buildBtn = buildOptionButton(
      this.engine.t('plugin.curator.wingBuild', { cost }),
      affordable ? null : this.engine.t('ui.notEnoughGold')
    );
    if (!affordable) buildBtn.disabled = true;
    buildBtn.onclick = () => {
      // Named like a display case is: the player's own label, prompted for.
      const slot = nextMuseumSlot(this.engine);
      const fallback = this.engine.t('plugin.curator.wingDefaultName', { count: slot + 1 });
      const typed = prompt(this.engine.t('plugin.curator.wingPrompt'), fallback);
      if (typed === null) return;   // cancelled
      // Run the action rather than handleOption: nobody is leaving the hall, so
      // the panel redraws itself with the new wing instead of being replaced by
      // the scene's options.
      this.engine.runActions([{ type: 'build_wing', name: typed.trim() || fallback }]);
      this.render();
    };
    section.appendChild(buildBtn);
    panel.insertBefore(section, skillsContainer);
  }

  _renderDashboard(container, panel, skillsContainer, sceneId, scene) {
    // Out of the panel — and, in a room that is only its exhibits, out of
    // the room itself.
    container.appendChild(this._exitButton(scene));

    const exhibitsSection = buildPanelSection(this.engine.t('plugin.curator.curatorHeadingExhibits'));

    const displays = getDisplaysForScene(this.engine.state, sceneId);
    if (displays.length > 0) {
      displays.forEach(d => {
        const badge = d.item ? getItemLabel(this.engine.data.items, d.item) : this.engine.t('plugin.curator.curatorEmpty');
        const btn = buildOptionButton(d.name, badge);
        btn.onclick = () => {
          // Panel buttons are not scene options, so handleOption's choice log
          // never runs for them — stepping up to a case logs itself as the
          // act, in the player's voice, the way the chest's buttons do.
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

    // Construction — what the player can add to the room, last, under its
    // own heading (the hall's wing-building sits in the same place).
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

    // The way out. The panel heading names the case right above this, so
    // the button carries the verb alone; the log line spells the case out.
    const backBtn = buildOptionButton(this.engine.t('plugin.curator.curatorBack'));
    backBtn.onclick = () => {
      this.engine.log(LOG.PLAYER, this.engine.t('plugin.curator.displayLeave', { display: display.name }), 'choice');
      this.render('dashboard');
    };
    container.appendChild(backBtn);

    // No section heading: the panel's own heading is the case's name now, and
    // this section holds nothing but the relic standing in it.
    const detailSection = buildPanelSection();

    // Item Info — the exhibited item as a standard card, built by the same
    // helpers the inventory uses (buildCard, itemCardStats), so a relic in its
    // case reads exactly as it does in the player's bag. And like there, the
    // card IS the control: clicking the relic takes it out of the case.
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

    // An exhibited story book stays readable — the card keeps its one meaning
    // (take it out, like every other exhibit), so reading is its own act
    // below it. Offered however thin the telling: a half-heard story reads as
    // the half-filled exhibit it is.
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

    // The way out. Same words as the filled case's back button; the log
    // line is what distinguishes them (this one records the case left empty).
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

    // A case takes anything the player can part with — the museum is theirs,
    // and a case doesn't tell them what belongs in it. Special items are the
    // one exception, and it's not the museum's rule: every surface that parts
    // the player from an item filters them out.
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
