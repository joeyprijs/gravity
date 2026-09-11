import { buildOptionButton } from '../core/utils.js';
import { LOG } from '../core/config.js';
import {
  DEFAULT_WING_COST, bagOf, findHall, getDisplaysForScene, isMuseumRoom, layoutMuseum,
  nextMuseumSlot, registerCuratorState, syncMuseumRooms,
} from './curator/museum.js';
import { CuratorUI, showReputationLine } from './curator/panel.js';

// The curator plugin: the museum's wings, display cases, and reputation.
// Reputation is derived: a permanent score from first acquisitions plus a
// bonus from relics on display. Everything hangs off the StateManager plugin
// API and the plugin's save bag; no engine method is wrapped.
//
// This file wires the plugin into the engine; museum.js holds the museum's
// state and rules; panel.js renders the curator panel.

// The museum's state API, for the tests and the smoke page.
export {
  addDisplayToScene, getDisplaysForScene, getMuseumReputation, layoutMuseum,
  placeItemInDisplay, registerCuratorState, takeItemFromDisplay,
} from './curator/museum.js';

export default function curatorPlugin(engine) {
  registerCuratorState(engine.state, engine.data.items, engine);
  layoutMuseum(engine);

  // The plugin's own authoring mistakes, so the core validator stays unaware
  // of its fields.
  engine.registerValidator((data, { add }) => {
    if (data.rules?.curator !== undefined)
      add('Rules', 'rules.curator was removed — set the curator\'s options on its manifest entry instead (data/index.json: plugins → { "id": "curator", "config": { "installCost": … } })');
    for (const [id, item] of Object.entries(data.items ?? {})) {
      if (item.reputation !== undefined)
        add(`Item "${id}"`, 'reputation moved into the attributes object — write attributes.reputation');
    }
  });

  // Every museum room gets the curator-panel act; scenes flagged
  // showsReputation get the standing reputation line.
  engine.registerSceneDecorator({
    options: (scene, optionsContainer, _engine, sections) => {
      if (scene.showsReputation) showReputationLine(engine);
      const sceneId = engine.state.getCurrentSceneId();
      const hasDisplays = getDisplaysForScene(engine.state, sceneId).length > 0;
      if (!isMuseumRoom(scene, hasDisplays)) return;
      // The museum's "Open Personal Chest": handleOption logs it as the choice.
      const btn = buildOptionButton(engine.t('plugin.curator.curatorOpen'));
      btn.onclick = () => engine.scene.handleOption({
        text: engine.t('plugin.curator.curatorOpen'),
        actions: [{ type: 'manage_exhibits' }]
      });
      (sections?.actions ?? optionsContainer).appendChild(btn);
    }
  });

  // Arriving in a museum room opens its panel. On arrival only: a re-render
  // or a load must not reopen a panel the player closed. Combat comes first.
  engine.on('scene:entered', ({ sceneId, scene, isEntry, startsCombat }) => {
    if (!isEntry || engine.inCombat || startsCombat) return;
    if (!isMuseumRoom(scene, getDisplaysForScene(engine.state, sceneId).length > 0)) return;
    engine.setCustomUIOpen(true);
    new CuratorUI(engine).render();
  });

  engine.registerAction('build_wing', (action, engine) => {
    const hall = findHall(engine);
    // No layout, no construction: the wing would land nowhere on the map.
    if (!hall || !engine.pluginConfig('curator').museumLayout) return;
    const cost = action.cost ?? engine.pluginConfig('curator').wingCost ?? DEFAULT_WING_COST;
    if (engine.state.getPlayer().resources.gold < cost) {
      engine.log(LOG.SYSTEM, engine.t('ui.notEnoughGold'));
      return;
    }

    const slot = nextMuseumSlot(engine);
    const name = action.name || engine.t('plugin.curator.wingDefaultName', { count: slot + 1 });
    engine.state.modifyPlayerStat('gold', -cost);
    // The save carries the wing, not its scene (see syncMuseumRooms).
    (bagOf(engine.state).rooms ??= []).push({ id: `${hall.id}_wing_${slot}`, name, slot });
    syncMuseumRooms(engine);

    // Nothing else redraws the map: neither the player nor the clock moved.
    // Optional because the state-level tests run without a UI.
    engine.ui?.map.invalidateMinimap();
    engine.ui?.map.renderMinimap();
    engine.log(LOG.SYSTEM, engine.t('plugin.curator.wingBuiltLog', { cost, name }));
  });

  engine.registerAction('manage_exhibits', (_action, engine) => {
    engine.setCustomUIOpen(true);
    new CuratorUI(engine).render();
  });

  engine.registerSheetRow({
    label: engine.t('plugin.curator.reputationLabel'),
    bind: 'attributes.reputation',
    icon: 'thumbs_up',
  });

  // A game can configure the reputation stat into invisibility.
  const tabs = engine.data.rules?.tabs;
  if (tabs && !tabs.some(t => t?.widget === 'attributes'))
    console.warn('[Gravity] curator: no tab with widget "attributes" — the reputation stat renders nowhere');
}
