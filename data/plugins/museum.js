import { gameState } from '../../src/core/state.js';
import { CSS } from '../../src/core/config.js';

export default function(engine) {
  engine.registerAction('manage_chest', (_action, engine) => {
    engine.ui.renderMuseumChestUI();
  });

  engine.registerDescriptionHook('museumChestContents', (engine) => {
    const chest = gameState.getMuseumChest();
    if (chest?.length > 0) {
      const nameList = chest.map(b => {
        const name = engine.data.items[b.item]?.name || b.item;
        return b.amount > 1 ? `${name} (x${b.amount})` : name;
      }).join(', ');
      const names = `<span class="${CSS.MUSEUM_ITEM_LIST}">${nameList}</span>`;
      return `<br><br>${engine.t('actions.museumDisplayedWithin', { names })}`;
    }
    return `<br><br>${engine.t('actions.museumRoomEmpty')}`;
  });
}
