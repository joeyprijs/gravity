import { buildOptionButton } from '../core/utils.js';
import { LOG } from '../core/config.js';
import {
  DEFAULT_WING_COST, bagOf, findHall, getDisplaysForScene, isMuseumRoom, layoutMuseum,
  nextMuseumSlot, registerCuratorState, syncMuseumRooms,
} from './curator/museum.js';
import { CuratorUI, showReputationLine } from './curator/panel.js';

// The curator plugin: the museum's wings, display cases, and reputation.
//
// Reputation is a derived stat: a permanent score (earned by acquiring relics
// for the first time) plus a bonus from relics currently on display, summed
// into player.attributes.reputation. Everything hangs off the formal
// StateManager plugin API — mutation hooks, a custom stat handler, save
// migrations; no engine or StateManager methods are wrapped. All plugin save
// data (museumReputation, obtainedItems, rooms, displays) lives in the
// sanctioned bag, state.pluginState('curator').
//
// The display cases are the museum's, not the engine's: the engine keeps
// `chests` (a container any game can author) and knows nothing about
// exhibiting. A case holds exactly one item whose identity feeds a score —
// a different mechanic, not a chest with a smaller lid.
//
// Three files: this one wires the plugin into the engine (actions, decorator,
// validator, the sheet row); museum.js holds the museum's state and rules;
// panel.js renders the curator panel.

// The museum's state API, for the tests and the smoke page.
export {
  addDisplayToScene, getDisplaysForScene, getMuseumReputation, layoutMuseum,
  placeItemInDisplay, registerCuratorState, takeItemFromDisplay,
} from './curator/museum.js';

export default function curatorPlugin(engine) {
  registerCuratorState(engine.state, engine.data.items, engine);
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

  // Decorate every scene that has display cases with the curator-panel
  // option button. What stands in each case is the panel's job to show — the
  // description doesn't table it, the way a chest doesn't table its contents.
  // Scenes flagged `showsReputation` also get the standing reputation line.
  engine.registerSceneDecorator({
    options: (scene, optionsContainer, _engine, sections) => {
      if (scene.showsReputation) showReputationLine(engine);
      const sceneId = engine.state.getCurrentSceneId();
      const hasDisplays = getDisplaysForScene(engine.state, sceneId).length > 0;
      if (!isMuseumRoom(scene, hasDisplays)) return;
      // Named for the act, not the panel: this is the museum's "Open Personal
      // Chest", and handleOption logs its text as the player's choice. It sits
      // in the panel's Actions section for the same reason the chest does.
      const btn = buildOptionButton(engine.t('plugin.curator.curatorOpen'));
      btn.onclick = () => engine.scene.handleOption({
        text: engine.t('plugin.curator.curatorOpen'),
        actions: [{ type: 'manage_exhibits' }]
      });
      (sections?.actions ?? optionsContainer).appendChild(btn);
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
    if (!isMuseumRoom(scene, getDisplaysForScene(engine.state, sceneId).length > 0)) return;
    engine.setCustomUIOpen(true);
    new CuratorUI(engine).render();
  });

  engine.registerAction('build_wing', (action, engine) => {
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
    (bagOf(engine.state).rooms ??= []).push({ id: `${hall.id}_wing_${slot}`, name, slot });
    syncMuseumRooms(engine);

    // The hall just got wider and the wing is on the map — but neither the
    // player nor the clock moved, so nothing would redraw the map on its own.
    // (Optional: the state-level tests run the action on an engine with no UI.)
    engine.ui?.map.invalidateMinimap();
    engine.ui?.map.renderMinimap();
    engine.log(LOG.SYSTEM, engine.t('plugin.curator.wingBuiltLog', { cost, name }));
  });

  engine.registerAction('manage_exhibits', (_action, engine) => {
    engine.setCustomUIOpen(true);
    new CuratorUI(engine).render();
  });

  // Surface the reputation stat as a sheet row — rendered by the sheet
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
