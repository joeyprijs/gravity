# Gravity — Feature Ideas

## Gameplay Mechanics
- [ ] **Skill checks** — Roll d20 vs a difficulty (DC) on certain options. Success/fail route to different scenes or set flags. e.g. `"action": "skillCheck", "actionDetails": { "stat": "initiative", "dc": 12, "success": "scene_a", "fail": "scene_b" }`
- [ ] **Status effects** — Poison, burn, stun applied mid-combat. Items and enemies can inflict or cure them. Tick each round.
- [ ] **Multi-stage / scripted combat** — Enemy changes behaviour at half HP (flees, enrages, calls for help, switches weapon)
- [ ] **Gold as a requirement** — Options that cost gold to unlock (bribes, toll gates, paid services). New `requirements.gold` field.
- [ ] **Random encounters** — Chance-based combat or events when navigating between scenes

## Content & World
- [ ] **More items** — Head and Legs armor slots have no items yet
- [ ] **More enemies** — Only one hostile NPC currently
- [ ] **More quests** — Only one mission exists

## Systems to Wire Up (already partially built)
- [ ] Merchant restocking / dynamic inventories — stock changes based on flags or quest progress

## Bigger Features (longer term)
- [ ] **Companion / party system** — A second character with their own stats that aids in combat
- [ ] **Area map / world overworld** — A scene type that renders a visual map between locations
- [ ] **Item durability** — Weapons degrade with use; rusty sword eventually breaks
- [ ] **Permadeath mode** — Optional flag; no load on death
