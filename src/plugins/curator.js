import { buildCard, buildContentsTable, buildOptionButton, createElement, escapeHtml, getItemLabel, itemCardStats, resetOptionsPanel } from "../core/utils.js";
import { CSS, EL, LOG } from "../core/config.js";

// The curator's reputation model: a permanent score (earned by acquiring
// relics for the first time) plus a dynamic bonus from relics currently on
// display. player.attributes.reputation is the derived sum.
// Reputation recalculation hangs off the formal StateManager plugin API —
// mutation hooks, a custom stat handler, and a save migration; no engine or
// StateManager methods are wrapped. The plugin's own save data
// (museumReputation, obtainedItems) lives in the sanctioned plugin bag,
// state.pluginState('curator').

// Set by registerCuratorState(). Module-level because the hook callbacks need
// them: the engine's StateManager and the loaded item database. curatorEngine
// is set by the plugin's register function only — the state-level tests call
// registerCuratorState on its own, and room synthesis stays out of their way.
let curatorState = null;
let curatorItems = {};
let curatorEngine = null;
let hooksRegistered = false;

// The curator's save-data bag ({ museumReputation, obtainedItems, rooms }).
const bag = () => curatorState.pluginState('curator');

// What building a wing costs when the game's config doesn't say — the demo's
// configured price. One constant because two places must agree on it: the
// hall's build button (its label and its affordability check) and the
// build_wing action that does the charging.
const DEFAULT_WING_COST = 250;

/** Returns the museum reputation currently shown to the player (permanent + display bonus). */
export function getMuseumReputation() {
  return curatorState?.getPlayer()?.attributes?.reputation ?? 0;
}

// Recomputes the derived reputation attribute from the permanent score plus
// the reputation of every relic currently on display.
function updateReputation() {
  let rep = bag().museumReputation ?? 0;
  const displays = curatorState.getAllDisplays();
  for (const sceneId in displays) {
    for (const display of displays[sceneId]) {
      if (display.item && curatorItems[display.item]) {
        rep += curatorItems[display.item].attributes?.reputation ?? 0;
      }
    }
  }
  curatorState.setPlayerAttribute('reputation', rep);
}

// First-time acquisition of a reputation-bearing item awards its reputation
// permanently. obtainedItems tracks which items have already been counted.
function handleAcquisition(itemId) {
  const itemData = curatorItems[itemId];
  if (!itemData?.attributes?.reputation) return;
  const obtained = (bag().obtainedItems ??= []);
  if (obtained.includes(itemId)) return;
  obtained.push(itemId);
  curatorState.modifyPlayerStat('reputation', itemData.attributes.reputation);
}

// Registers the curator's state integrations: the reputation stat handler,
// the mutation hooks that keep the derived attribute current, and the save
// migration for the plugin's fields. Idempotent — repeat calls only refresh
// the state/item references (the test suite re-inits state per test).
export function registerCuratorState(state, items = {}) {
  curatorState = state;
  curatorItems = items;
  if (hooksRegistered) return;
  hooksRegistered = true;

  // modifyPlayerStat('reputation', delta) adjusts the permanent score; the
  // visible attribute is recomputed (and notified) from updateReputation.
  state.registerStatHandler('reputation', (amount) => {
    bag().museumReputation = (bag().museumReputation ?? 0) + amount;
    updateReputation();
  });

  state.onMutation((method, info) => {
    switch (method) {
      case 'init':
      case 'loadFromObject':
      case 'reset':
        // Rooms first: a loaded save's wings must be on the map (and their
        // display cases addressable) before anything reads the museum.
        syncMuseumRooms(curatorEngine);
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

  // Migration v5: curator save data. v5 because plugin migrations must sit
  // above the core SAVE_VERSION (4) — registering at a core version would
  // shadow that core migration (registerMigration throws). Adopts the
  // pre-bag top-level fields older saves carried, and seeds defaults for
  // saves that predate the curator entirely.
  state.registerMigration(5, (data) => {
    if (!data.plugins) data.plugins = {};
    const saved = data.plugins.curator ?? (data.plugins.curator = {});
    saved.museumReputation ??= data.museumReputation ?? 0;
    if (!saved.obtainedItems) {
      if (data.obtainedItems) {
        saved.obtainedItems = data.obtainedItems;
      } else {
        // Backfill from everything the player already owns or exhibits, so
        // pre-curator relics don't re-award reputation on pickup.
        const currentItems = new Set();
        (data.player?.inventory ?? []).forEach(i => currentItems.add(i.item));
        Object.values(data.player?.equipment ?? {}).forEach(itemId => {
          if (itemId) currentItems.add(itemId);
        });
        for (const sceneId in (data.displays ?? {})) {
          data.displays[sceneId].forEach(d => { if (d.item) currentItems.add(d.item); });
        }
        saved.obtainedItems = Array.from(currentItems);
      }
    }
    delete data.museumReputation;
    delete data.obtainedItems;
  });
}

// The exhibits table appended to the description of any scene that has display
// cases — the same contents table the engine gives a chest (buildContentsTable),
// so a museum room and a chest read alike. Every case is listed, filled or not:
// an empty stand is the museum's standing invitation.
function buildExhibitsTable(engine, sceneId) {
  const displays = engine.state.getDisplaysForScene(sceneId);
  return buildContentsTable(
    [engine.t('plugin.curator.curatorTableStand'), engine.t('plugin.curator.curatorTableRelic')],
    displays.map(d => ({
      label: d.name,
      value: d.item ? getItemLabel(engine.data.items, d.item) : engine.t('plugin.curator.curatorEmpty'),
      empty: !d.item,
    })),
  );
}

// Pins the museum's reputation under the scene name in the options panel, for
// scenes flagged `showsReputation` — so it reads at a glance from anywhere in
// the museum, not only with the curator panel open. It hangs off the location
// reminder (sharing its underline) rather than sitting between the options,
// and resetOptionsPanel rewrites that element's text on every render, so the
// line is discarded and rebuilt with the current value each time.
function showReputationLine(engine) {
  const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
  if (!reminder) return;
  const line = createElement('div', 'curator-scene-rep');
  line.appendChild(createElement('span', 'curator-scene-rep__label', engine.t('plugin.curator.reputationLabel')));
  line.appendChild(createElement('span', 'curator-scene-rep__value',
    engine.t('plugin.curator.museumReputationValue', { value: getMuseumReputation() })));
  reminder.appendChild(line);
}

// Lays the museum out on the world map. A museum that can grow can't have its
// coordinates authored one room at a time: a wing declares which slot it
// occupies (`museumSlot`) and the geometry is derived from that, so however
// many rooms exist, they tile without overlapping and without anyone editing
// pixels. Slots run away from the hall in a pair per column — even slots north
// of it, odd slots south — so the museum grows one column per TWO rooms and
// stays roughly square instead of stretching into a ribbon.
//
//     ┌────┬────┐        slot 0   slot 2      (north, columns 0 and 1)
//     │ 0  │ 2  │
//   ──┼────┴────┤        the hall (museumHall) spans every column in use
//     │ 1  │ 3  │
//     └────┴────┘        slot 1   slot 3      (south)
//
// The hall's own width follows the column count, which is what makes room for
// the next wing on the map. Geometry only — nothing here knows what a room
// holds. Needs `museumLayout: { top, left, roomWidth, roomHeight }` in the
// plugin's manifest config (the hall's top-left corner and one room's size);
// without it the authored mapDefinitions are left exactly as they are.
export function layoutMuseum(engine) {
  const layout = engine.pluginConfig('curator').museumLayout;
  if (!layout) return;
  const { top, left, roomWidth, roomHeight } = layout;

  let columns = 0;
  let hall = null;
  for (const scene of Object.values(engine.data.scenes)) {
    if (scene.museumHall) hall = scene;
    if (!Number.isInteger(scene.museumSlot)) continue;
    const column = Math.floor(scene.museumSlot / 2);
    columns = Math.max(columns, column + 1);
    Object.assign(scene.mapDefinitions ??= {}, {
      left: left + column * roomWidth,
      top: scene.museumSlot % 2 ? top + roomHeight : top - roomHeight,
      width: roomWidth,
      height: roomHeight,
    });
  }

  // An empty museum still has its hall — one column wide.
  if (hall) Object.assign(hall.mapDefinitions ??= {}, {
    left, top, width: roomWidth * Math.max(columns, 1), height: roomHeight,
  });
}

// Rooms the curator takes over on arrival: the hall (its wings and the building
// of them) and anything holding display cases. Both get a panel instead of a
// plain option list, so the museum reads the same wherever you stand in it.
function isMuseumRoom(scene, hasDisplays) {
  return Boolean(scene.museumHall || scene.supportsExhibits || hasDisplays);
}

// The museum's hall, as { id, scene } — the scene flagged museumHall. Null in
// a game that has no museum.
function findHall(engine) {
  const entry = Object.entries(engine.data.scenes).find(([, s]) => s.museumHall);
  return entry ? { id: entry[0], scene: entry[1] } : null;
}

// The slot a newly built wing takes: one past the highest in use, so ids and
// geometry both follow from it and nothing has to be counted or stored twice.
function nextMuseumSlot(engine) {
  const slots = Object.values(engine.data.scenes)
    .map(s => s.museumSlot)
    .filter(Number.isInteger);
  return slots.length ? Math.max(...slots) + 1 : 0;
}

// A built wing as a scene object. Everything but the player's chosen name is
// derived: the id and geometry from the slot, the room's text from the plugin's
// locale, the region and the way back from the hall it opens off. Bare on
// purpose — the player installs display cases and decides what goes in.
// The name is player input, and a description is rendered as HTML, so it is
// escaped going in (the option button and map label take text nodes).
function buildRoomScene(engine, hall, room) {
  // Geometry comes from layoutMuseum; without a museumLayout there is none to
  // derive, and a bare mapDefinitions would put the wing on the map at
  // undefined coordinates — so the wing gets no map presence at all. (Building
  // is gated on the layout, but a save carrying wings can be loaded anywhere.)
  const layout = engine.pluginConfig('curator').museumLayout;
  return {
    id: room.id,
    name: room.name,
    region: hall.scene.region,
    museumSlot: room.slot,
    museumBuilt: true,
    supportsExhibits: true,
    showsReputation: true,
    description: engine.t('plugin.curator.wingDescription', { name: escapeHtml(room.name) }),
    ...(layout ? { mapDefinitions: { background: layout.roomBackground } } : {}),
    options: [{
      text: engine.t('plugin.curator.wingBack', { name: hall.scene.name }),
      isBack: true,
      actions: [{ type: 'navigate', destination: hall.id }],
    }],
  };
}

// Brings data.scenes in line with the built wings in the save, then re-runs the
// layout. Wings live in the save as { id, name, slot } and nothing else — their
// scenes are rebuilt from that on every load, so a saved game can never carry
// stale coordinates or drift from the layout rules. Called on boot, on load,
// and after building: a loaded save must also DROP the wings the previous game
// had, which is what museumBuilt marks.
function syncMuseumRooms(engine) {
  if (!engine) return;
  const hall = findHall(engine);
  if (!hall) return;

  const rooms = bag().rooms ?? [];
  const wanted = new Map(rooms.map(r => [r.id, r]));
  for (const [id, scene] of Object.entries(engine.data.scenes)) {
    if (scene.museumBuilt && !wanted.has(id)) delete engine.data.scenes[id];
  }
  for (const room of rooms) {
    engine.data.scenes[room.id] ??= buildRoomScene(engine, hall, room);
  }
  layoutMuseum(engine);
}

export default function curatorPlugin(engine) {
  // 1. Register state integrations (stat handler, mutation hooks, migration)
  curatorEngine = engine;
  registerCuratorState(engine.state, engine.data.items);
  layoutMuseum(engine);

  // Reputation is a curator concept: flag the deprecated top-level item shape
  // here rather than in the core item validator, so the engine stays unaware
  // of the plugin's fields.
  engine.registerValidator((data, { add }) => {
    // The curator's settings moved from rules.json to the manifest plugin
    // config — a leftover rules.curator block would silently fall back to
    // the defaults (installCost 50).
    if (data.rules?.curator !== undefined)
      add('Rules', 'rules.curator was removed — set the curator\'s options on its manifest entry instead (data/index.json: plugins → { "id": "curator", "config": { "installCost": … } })');
    for (const [id, item] of Object.entries(data.items ?? {})) {
      if (item.reputation !== undefined)
        add(`Item "${id}"`, 'reputation moved into the attributes object — write attributes.reputation');
    }
  });

  // 2. Decorate every scene that has display cases: exhibits table appended to
  // the description, plus the curator-panel option button. Scenes flagged
  // `showsReputation` also get the standing reputation line.
  engine.registerSceneDecorator({
    description: (scene, sceneId) => buildExhibitsTable(engine, sceneId),
    options: (scene, optionsContainer) => {
      if (scene.showsReputation) showReputationLine(engine);
      const sceneId = engine.state.getCurrentSceneId();
      const hasDisplays = engine.state.getDisplaysForScene(sceneId).length > 0;
      if (!isMuseumRoom(scene, hasDisplays)) return;
      // Named for the act, not the panel: this is the museum's "Open Personal
      // Chest", and handleOption logs its text as the player's choice.
      const btn = buildOptionButton(engine.t('plugin.curator.curatorOpen'));
      btn.onclick = () => engine.scene.handleOption({
        text: engine.t('plugin.curator.curatorOpen'),
        actions: [{ type: "manage_exhibits" }]
      });
      optionsContainer.appendChild(btn);
    }
  });

  // Walking into any museum room opens its panel then and there — curating IS
  // what these rooms are for, so the button to get to it was a step for its own
  // sake. It stays on the scene's options as the way back in after Done. Only
  // on arrival (isEntry): a re-render or a save restore must not reopen a panel
  // the player closed. And combat comes first if a scene has both — a fight
  // already running (inCombat) or one the render is about to start
  // (startsCombat: the scene's autoAttack fires right after this emit).
  engine.on('scene:entered', ({ sceneId, scene, isEntry, startsCombat }) => {
    if (!isEntry || engine.inCombat || startsCombat) return;
    if (!isMuseumRoom(scene, engine.state.getDisplaysForScene(sceneId).length > 0)) return;
    engine.setCustomUIOpen(true);
    new CuratorUI(engine).render();
  });

  // 3. Register custom action handlers
  engine.registerAction("build_wing", (action, engine) => {
    const hall = findHall(engine);
    // No layout, no construction: a built wing's map geometry is derived from
    // museumLayout, so without one the wing would land nowhere. The hall's
    // panel hides the build option on the same condition.
    if (!hall || !engine.pluginConfig('curator').museumLayout) return;
    const cost = action.cost ?? engine.pluginConfig('curator').wingCost ?? DEFAULT_WING_COST;
    if (engine.state.getPlayer().resources.gold < cost) {
      engine.log(LOG.SYSTEM, engine.t('ui.notEnoughGold'));
      return;
    }

    const slot = nextMuseumSlot(engine);
    const name = action.name || engine.t('plugin.curator.wingDefaultName', { count: slot + 1 });
    engine.state.modifyPlayerStat('gold', -cost);
    // The save carries the wing, not its scene: the scene is rebuilt from this
    // on every load (see syncMuseumRooms), and pluginState persists it.
    (bag().rooms ??= []).push({ id: `${hall.id}_wing_${slot}`, name, slot });
    syncMuseumRooms(engine);

    // The hall just got wider and the wing is on the map — but neither the
    // player nor the clock moved, so nothing would redraw the map on its own.
    engine.ui?.map?.invalidateMinimap?.();
    engine.ui?.map?.renderMinimap?.();
    engine.log(LOG.SYSTEM, engine.t('plugin.curator.wingBuiltLog', { cost, name }));
  });

  engine.registerAction("manage_exhibits", (action, engine) => {
    engine.setCustomUIOpen(true);
    new CuratorUI(engine).render();
  });

  engine.registerAction("add_display", (action, engine) => {
    const sceneId = action.scene || engine.state.getCurrentSceneId();
    const cost = action.cost ?? 0;
    const p = engine.state.getPlayer();
    if (p.resources.gold < cost) {
      engine.log(LOG.SYSTEM, engine.t('ui.notEnoughGold'));
      return;
    }
    engine.state.modifyPlayerStat('gold', -cost);
    const displayName = action.name || engine.t('plugin.curator.displayDefaultName');
    engine.state.addDisplayToScene(sceneId, { name: displayName });
    engine.log(LOG.SYSTEM, engine.t('plugin.curator.displayAddedLog', { name: displayName }));
  });

  // 4. Surface the reputation stat as a sheet row — rendered by the sheet
  // build itself (see engine.registerSheetRow), so no DOM injection here.
  engine.registerSheetRow({
    label: engine.t('plugin.curator.reputationLabel'),
    bind: 'attributes.reputation',
    icon: 'thumbs_up',
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
    const scene = this.engine.data.scenes[this.engine.state.getCurrentSceneId()];
    if (scene) this.engine.scene.refreshDescription(scene);
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
      ? this.engine.state.getDisplaysForScene(sceneId).find(d => d.id === context)
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
  // that's the room's own exit — the panel opens on arrival, so a "Done" that
  // revealed nothing but a single "Go back" was a step for its own sake. A room
  // with anything else to do keeps Done, or those options would be unreachable
  // while the panel is up.
  _exitButton(scene) {
    const isBack = (o) => o.isBack === true || (o.actions ?? []).some(a => a.type === 'return');
    const options = scene.options ?? [];
    const back = options.length === 1 && isBack(options[0]) ? options[0] : null;

    if (!back) {
      const doneBtn = buildOptionButton(this.engine.t('plugin.curator.curatorDone'));
      doneBtn.onclick = () => {
        // Terse button, act-shaped log line — the chest's "Done" logs "Close
        // Chest" the same way. The back-button path below needs none: walking
        // out through handleOption logs the option's own text.
        this.engine.log(LOG.PLAYER, this.engine.t('plugin.curator.curatorClose'), 'choice');
        this.engine.setCustomUIOpen(false);
        this.engine.scene.renderOptions(scene);
      };
      return doneBtn;
    }

    const backBtn = buildOptionButton(back.text);
    backBtn.onclick = () => {
      this.engine.setCustomUIOpen(false);
      this.engine.scene.handleOption(back);   // logs the choice and walks out
    };
    return backBtn;
  }

  // A panel section headed "Construction" — what the player can add here. Every
  // museum room ends with one, so building is always in the same place: a case
  // in a wing, a whole wing in the hall.
  _constructionSection() {
    const section = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    section.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t('plugin.curator.constructionHeading')));
    return section;
  }

  // The hall: the way out of the museum, then a door into every wing in slot
  // order (so they read the way the map does), then construction. Same shape as
  // a wing's panel — exit, what's here, what you can add.
  _renderHall(container, panel, skillsContainer, scene) {
    container.appendChild(this._exitButton(scene));

    const wingsSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    wingsSection.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t('plugin.curator.wingsHeading')));

    const wings = Object.entries(this.engine.data.scenes)
      .filter(([, s]) => Number.isInteger(s.museumSlot))
      .sort((a, b) => a[1].museumSlot - b[1].museumSlot);

    for (const [id, wing] of wings) {
      const text = this.engine.t('plugin.curator.wingEnter', { name: wing.name });
      const btn = buildOptionButton(text);
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

    const cost = this.engine.pluginConfig('curator').wingCost ?? DEFAULT_WING_COST;
    const affordable = this.engine.state.getPlayer().resources.gold >= cost;
    const section = this._constructionSection();
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
    // 1. Out of the panel — and, in a room that is only its exhibits, out of
    // the room itself.
    container.appendChild(this._exitButton(scene));

    // 2. Exhibits Section
    const exhibitsSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    exhibitsSection.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t('plugin.curator.curatorHeadingExhibits')));

    const displays = this.engine.state.getDisplaysForScene(sceneId);
    if (displays.length > 0) {
      displays.forEach(d => {
        const badge = d.item ? getItemLabel(this.engine.data.items, d.item) : this.engine.t('plugin.curator.curatorEmpty');
        const btn = buildOptionButton(d.name, badge);
        btn.onclick = () => {
          // Panel buttons are not scene options, so handleOption's choice log
          // never runs for them — stepping up to a case logs itself, in the
          // player's voice and as the act, the way "Open Personal Chest" does.
          // The card stays terse (a name and its relic); the log line carries
          // the act, exactly as the chest's "Done" button logs "Close Chest".
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

    // 3. Construction — what the player can add to the room, last, under its
    // own heading (the hall's wing-building sits in the same place).
    const installCost = this.engine.pluginConfig('curator').installCost ?? 50;
    const p = this.engine.state.getPlayer();
    const canInstall = p.resources.gold >= installCost;

    const installSection = this._constructionSection();
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
      this.engine.state.addDisplayToScene(sceneId, {
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
    const displays = this.engine.state.getDisplaysForScene(sceneId);
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
    backBtn.onclick = () => {
      this.engine.log(LOG.PLAYER, this.engine.t('plugin.curator.displayLeave', { display: display.name }), 'choice');
      this.render('dashboard');
    };
    container.appendChild(backBtn);

    // 2. Display Details Section
    // No section heading: the panel's own heading is the case's name now, and
    // this section holds nothing but the relic standing in it.
    const detailSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);

    // Item Info — the exhibited item as a standard card, built by the same
    // helpers the inventory uses (buildCard, itemCardStats), so a relic in its
    // case reads exactly as it does in the player's bag. And like there, the
    // card IS the control: clicking the relic takes it out of the case.
    const t = this.engine.t.bind(this.engine);
    const itemCard = buildCard({
      tag: 'button',
      title: name,
      body: itemData?.description,
      stats: itemData ? itemCardStats(t, itemData, this.engine.state.getPlayer().attributes) : undefined,
    });
    itemCard.onclick = () => {
      this.engine.state.takeItemFromDisplay(sceneId, displayId);
      this.engine.log(LOG.SYSTEM, this.engine.t('actions.displayTook', { name, display: display.name }));
      this._refreshSceneDesc();
      this.render('dashboard');
    };
    detailSection.appendChild(itemCard);

    panel.insertBefore(detailSection, skillsContainer);
  }

  _renderSelectArtifact(container, panel, skillsContainer, sceneId, displayId) {
    const displays = this.engine.state.getDisplaysForScene(sceneId);
    const display = displays.find(d => d.id === displayId);
    if (!display) {
      this.render('dashboard');
      return;
    }

    // 1. Cancel button
    const cancelBtn = buildOptionButton(this.engine.t('plugin.curator.curatorCancel'));
    cancelBtn.onclick = () => {
      this.engine.log(LOG.PLAYER, this.engine.t('plugin.curator.displayLeaveEmpty', { display: display.name }), 'choice');
      this.render('dashboard');
    };
    container.appendChild(cancelBtn);

    // 2. Select Artifact Section
    const selectSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    selectSection.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t('plugin.curator.curatorSelectArtifact')));

    // Get eligible player inventory items
    const player = this.engine.state.getPlayer();
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
          this.engine.state.placeItemInDisplay(sceneId, displayId, invItem.item);
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
