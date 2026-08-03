import { clearElement, createElement, buildSceneDescription, buildOptionButton, addDirectionMarker, getItemLabel, isInteriorScene, resetOptionsPanel } from "../core/utils.js";
import { CHECK_KEYS, CSS, FLAG_KEYS, GOLD_ITEM_ID, LOG, MAX_D20_ROLL } from "../core/config.js";
import { evaluateCondition } from "./condition.js";
import { formatList } from "../core/i18n.js";
import { roll, rollTable } from "./dice.js";
import { resolveTimeCost } from "./time.js";
import {
  runCheckAttempt, checkPresentation, normalizeOutcomes,
  getAttempts, isResolved, resetAttempts,
  spendRetryCost, pickVariant,
  rollBreakdown, skillLabel
} from "./skill-checks.js";

// SceneRenderer handles navigating to scenes, resolving their descriptions,
// and rendering their option buttons. It is the main driver of scene-to-scene
// movement and all non-combat, non-dialogue player interactions.
export class SceneRenderer {
  constructor(engine) {
    this.engine = engine;
    // Tracks the last rendered scene/desc so we don't duplicate narrative
    // entries when re-rendering options without changing the scene body.
    this.lastRenderedSceneId = null;
    this.lastRenderedDesc = null;
  }

  reset() {
    this.lastRenderedSceneId = null;
    this.lastRenderedDesc = null;
  }

  // Called after a save is loaded. Syncs the cache to the restored state so
  // the next render doesn't duplicate the scene description, then re-renders
  // the option buttons without appending a new narrative block.
  restoreFromSave(sceneId, lastDesc) {
    if (lastDesc !== null) {
      this.lastRenderedSceneId = sceneId;
      this.lastRenderedDesc = lastDesc;
    }
    const scene = this.engine.data.scenes[sceneId];
    if (scene) {
      // Loading into a location should sound like it — but stay quiet:
      // ambience only, no narration replay. That includes a clip already
      // mid-sentence from before the load — the null stops it.
      this.engine.audio?.syncAmbience(scene);
      this.engine.audio?.playNarration(null);
      this.renderOptions(scene);
    }
  }

  /**
   * Renders a scene: its description, options, skills, and any auto-combat.
   * No-op while combat is active.
   *
   * @param {string} sceneId - The id of the scene to render.
   * @param {object} [opts]
   * @param {boolean} [opts.skipAutoAttack=false] - Suppresses the scene's
   *   autoAttack encounter. Used by the post-victory re-render so winning a
   *   fight on an auto-attack scene doesn't immediately restart it.
   * @param {boolean} [opts.skipNarration=false] - Renders the description
   *   without starting its narration clip. Used by the post-victory re-render:
   *   combat reset the description cache, so the block re-appends — but the
   *   narrator already read this room on the way in.
   */
  render(sceneId, { skipAutoAttack = false, skipNarration = false } = {}) {
    if (this.engine.inCombat) return;

    const scene = this.engine.data.scenes[sceneId];
    if (!scene) {
      console.error(`Scene ${sceneId} not found!`);
      return;
    }

    this._registerInitialDisplays(scene, sceneId);

    // Passive checks roll BEFORE the description resolves, so conditional
    // description variants already see the flags they set. Their narration
    // logs after the description block (see below).
    const passiveTexts = this._rollPassiveChecks(scene, sceneId);

    // Attempt counters reset on actual (re-)entry only — a same-scene
    // re-render (e.g. after a successful check) must not rewind other checks'
    // retry wording or refill their maxAttempts budgets mid-visit.
    const isEntry = this.engine.state.getCurrentSceneId() !== sceneId;

    // addVisitedScene must be called BEFORE setCurrentSceneId because
    // setCurrentSceneId triggers notifyListeners → ui.update() → renderMinimap(),
    // which checks visitedScenes. If the order is reversed, the current scene
    // would be absent from visitedScenes when the minimap first renders.
    this.engine.state.addVisitedScene(sceneId);
    this.engine.state.setCurrentSceneId(sceneId);

    const appended = this._appendSceneDescription(scene, sceneId);

    // Audio rides the description's own dedupe: ambience re-syncs on every
    // render (a no-op while the loop is unchanged), narration plays exactly
    // when a new description block was appended — covering the boot render
    // (where currentSceneId is pre-seeded, so isEntry is false) while
    // skipping skill-check re-renders and save restores.
    this.engine.audio?.syncAmbience(scene);
    if (appended && !skipNarration) this.engine.audio?.playNarration(this._resolveNarration(scene));

    passiveTexts.forEach(text => this.engine.log(LOG.NARRATOR, text));
    if (isEntry) this._resetSkillAttempts(scene, sceneId);
    this._awardSceneXP(scene, sceneId);
    this.renderOptions(scene);

    // Emitted after the options render, so a listener may replace the panel
    // with a UI of its own (the curator opens its dashboard on entering a wing).
    // `isEntry` separates walking in from a same-scene re-render or a save
    // restore — listeners that act on arrival must check it. Quest triggers do
    // not: they re-check scene.questTrigger and are idempotent. The scene's
    // auto-encounter is decided BEFORE the emit and passed as `startsCombat`:
    // combat hasn't begun yet at this point, so a listener that opens a UI on
    // arrival can't learn from engine.inCombat that a fight is about to take
    // the screen over.
    const startsCombat = !skipAutoAttack && this._autoAttackDue(scene);
    this.engine.emit('scene:entered', { sceneId, scene, isEntry, startsCombat });

    if (startsCombat && this._maybeStartAutoAttack(scene)) return;

    this.engine.scrollNarrativeToBottom();
  }

  // Auto-registers initial displays defined in the scene file, unless the
  // scene already has displays registered in state (e.g. from a loaded save).
  _registerInitialDisplays(scene, sceneId) {
    if (!scene.displays?.length) return;
    if (this.engine.state.getDisplaysForScene(sceneId).length > 0) return;
    scene.displays.forEach(d => {
      this.engine.state.addDisplayToScene(sceneId, {
        id: d.id,
        name: d.name,
        item: d.item || null,
        allowedTypes: d.allowedTypes || null
      });
    });
  }

  // Appends the scene description as a new narrative block — but only when the
  // scene or its description actually changed, preventing duplicate entries
  // when options re-render. Returns whether a block was appended (the audio
  // narration trigger rides the same dedupe).
  _appendSceneDescription(scene, sceneId) {
    const currentDesc = this._resolveDescription(scene);
    if (this.lastRenderedSceneId === sceneId && this.lastRenderedDesc === currentDesc) return false;

    this.engine.openScene();
    // Scene content comes from developer-authored JSON, not user input —
    // buildSceneDescription uses innerHTML for the body to allow basic formatting.
    const descEl = buildSceneDescription(scene.title || scene.name, currentDesc, this.engine.t.bind(this.engine));
    this.engine.currentSceneEl.appendChild(descEl);
    this.engine.state.appendLog({ type: 'scene', title: scene.title || scene.name, desc: currentDesc });

    this.lastRenderedSceneId = sceneId;
    this.lastRenderedDesc = currentDesc;
    return true;
  }

  // Passive checks: auto-rolled the first time the player enters the scene,
  // writing pass/fail into an author-named flag that conditions, description
  // variants, and option gates can read. Rolled exactly once per game — never
  // re-rolled on re-entry — so the world stays consistent. Silent unless the
  // check succeeds and carries authored `text` (returned for post-description
  // logging).
  _rollPassiveChecks(scene, sceneId) {
    const texts = [];
    (scene.passiveChecks || []).forEach((check, i) => {
      if (!check.skillCheck || !check.flag) return;
      const doneKey = FLAG_KEYS.passiveDone(sceneId, i);
      if (this.engine.state.getFlag(doneKey)) return;
      this.engine.state.setFlag(doneKey, true);
      const mod = this.engine.state.getPlayer().attributes[check.skillCheck] ?? 0;
      const success = roll(1, MAX_D20_ROLL) + mod >= (check.dc ?? 10);
      this.engine.state.setFlag(check.flag, success);
      if (success && check.text) texts.push(check.text);
    });
    return texts;
  }

  // One-time XP reward on first visit. The flag prevents re-awarding on
  // subsequent visits or after loading a save. Lives in render(), not
  // renderOptions() — rendering buttons must never mutate progression state.
  _awardSceneXP(scene, sceneId) {
    if (!scene.xpReward) return;
    const xpFlag = FLAG_KEYS.xpAwarded(sceneId);
    if (this.engine.state.getFlag(xpFlag)) return;
    this.engine.state.addXP(scene.xpReward);
    this.engine.state.setFlag(xpFlag, true);
    this.engine.log(LOG.SYSTEM, this.engine.t('loot.xpGained', { amount: scene.xpReward }), 'loot');
  }

  // Resets skill-check attempt counters on scene re-entry so retryText wording
  // starts fresh. Discovery progress and resolved (retired) checks persist.
  _resetSkillAttempts(scene, sceneId) {
    (scene.skills || []).forEach(opt => {
      if (!opt.skillCheck) return;
      resetAttempts(this.engine.state, CHECK_KEYS.skillDc(opt.skillCheck, sceneId));
    });
  }

  // Whether the scene's autoAttack encounter would start right now — the
  // predicate half of _maybeStartAutoAttack, checked before scene:entered is
  // emitted so listeners know a fight is coming.
  _autoAttackDue(scene) {
    if (!scene.autoAttack) return false;
    const cond = scene.autoAttack.condition ?? null;
    return !cond || evaluateCondition(cond, this.engine.state);
  }

  // Starts the scene's autoAttack encounter when its condition allows.
  // Returns true when combat was started (the caller stops rendering).
  _maybeStartAutoAttack(scene) {
    if (!this._autoAttackDue(scene)) return false;
    // The scene description rendered a moment ago is this encounter's framing,
    // so the fight doesn't re-describe the enemy on top of it.
    this.engine.combatSystem.startCombat(scene.autoAttack.enemies, scene.autoAttack, { fromSceneEntry: true });
    return true;
  }

  renderOptions(scene) {
    const { container: optionsContainer, entrancesContainer, talkContainer, actionsContainer, skillsContainer, exitsContainer } = resetOptionsPanel(scene.title || scene.name);

    const navOpts = [];
    const enterOpts = [];
    const exitOpts = [];
    const backOpts = [];
    const talkOpts = [];
    const actionOpts = [];

    // A "back" option is sorted to the bottom of the list. Detected by the
    // `return` action type or an explicit `"isBack": true` flag — never by
    // matching English words in the text, which would break in other locales.
    const isBackOption = (opt) => {
      if (opt.isBack === true) return true;
      return opt.actions?.some(a => a.type === 'return') ?? false;
    };

    // Which section an option lands in follows from what its pipeline does, for
    // the same reason isBackOption does — the action type says so in every
    // locale. The unheaded first list is where the player can GO without leaving
    // where they are: a road on, a door to the next room. Talking to somebody is
    // its own section. Everything left is an act performed here — resting,
    // eating, opening a chest, starting a fight — and lands under Actions,
    // whatever action type it is built from.
    const startsAction = (opt, type) => opt.actions?.some(a => a.type === type) ?? false;

    // Crossing a threshold is a different kind of move from walking on, so those
    // options are listed apart — decided, like every other section, by what the
    // pipeline does: here by what kind of place it leads to.
    //
    // Outdoors that means the doors into buildings (**Entrances**). Inside one it
    // means the ways back out (**Exits**) — a navigate to somewhere that isn't
    // this building, or a teleport, which leaves whatever else it does. Neither
    // split applies to a move that stays on the same side of the threshold: a
    // road between two outdoor places, or a door between two rooms of one house.
    const regions = this.engine.data.regions;
    const outdoors = !isInteriorScene(scene, regions);
    // Destinations that actually resolve. An unknown one is a typo, and reading
    // it as "not a building" would make the two halves below disagree: outdoors
    // it falls through to the roads, but inside it would satisfy "navigates to
    // somewhere that isn't this building" and file a broken door under Exits.
    // Dropping it leaves the option in the neutral list, where validate.js is
    // the one that names the typo.
    const navTargets = (opt) => (opt.actions || [])
      .filter(a => a.type === 'navigate')
      .map(a => this.engine.data.scenes[a.destination])
      .filter(Boolean);

    const entersBuilding = (opt) => outdoors
      && navTargets(opt).some(dest => isInteriorScene(dest, regions));
    const leavesBuilding = (opt) => !outdoors && (
      navTargets(opt).some(dest => !isInteriorScene(dest, regions))
      || (opt.actions || []).some(a => a.type === 'return')
    );

    // Where an option leads, unfiltered. Whether that *has* a direction —
    // a step within one space does, crossing a threshold doesn't — is
    // addDirectionMarker's question, because the curator builds navigation
    // buttons of its own and the two must not answer it differently. Road prose
    // no longer names its direction; the marker does, in every language.
    const destinationOf = (opt) => navTargets(opt)[0] ?? null;

    (scene.options || []).forEach(opt => {
      const cond = opt.condition ?? null;
      if (!evaluateCondition(cond, this.engine.state)) return;

      if (entersBuilding(opt)) {
        enterOpts.push(opt);
      } else if (leavesBuilding(opt)) {
        exitOpts.push(opt);
      } else if (isBackOption(opt)) {
        backOpts.push(opt);
      } else if (startsAction(opt, 'navigate')) {
        navOpts.push(opt);
      } else if (startsAction(opt, 'dialogue')) {
        talkOpts.push(opt);
      } else {
        actionOpts.push(opt);
      }
    });

    const renderOptionBtn = (opt, target = optionsContainer, extraStats = null) => {
      let reqText = null;
      let disabled = false;
      if (opt.requirements?.item) {
        const totalCount = this.engine.state.countPlayerItem(opt.requirements.item);
        if (totalCount <= 0) {
          disabled = true;
          reqText = this.engine.t('ui.itemRequires', { name: getItemLabel(this.engine.data.items, opt.requirements.item) });
        }
      }

      const stats = [...(extraStats ?? []), ...(reqText ? [reqText] : [])];
      const btn = buildOptionButton(opt.text, stats.length ? stats : null);
      addDirectionMarker(this.engine, scene, destinationOf(opt), btn);

      if (disabled) btn.disabled = true;
      btn.onclick = () => this.handleOption(opt);
      target.appendChild(btn);
      return btn;
    };

    // Both headed option sections are opened up front and swept at the end, so
    // a plugin decorator can append to one without having to know whether this
    // scene filled it: a section nobody put a button in loses its heading again.
    const openSection = (container, headingKey) => {
      container.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t(headingKey)));
      container.removeAttribute('hidden');
    };
    const sweepSection = (container) => {
      if (container.querySelector('button')) return;
      clearElement(container);
      container.setAttribute('hidden', '');
    };

    openSection(entrancesContainer, 'ui.entrancesHeading');
    openSection(talkContainer, 'ui.conversationsHeading');
    openSection(actionsContainer, 'ui.actionsHeading');
    // Exits sit at the foot of the panel, where the way out has always sat — the
    // two threshold sections never appear together, so they don't have to agree
    // on a position.
    openSection(exitsContainer, 'ui.exitsHeading');

    navOpts.forEach(opt => renderOptionBtn(opt));
    // A door the author also marked as the way back still sits last among the
    // doors, the way a back option sits last among the roads.
    const backLast = (a, b) => Number(isBackOption(a)) - Number(isBackOption(b));
    [...enterOpts].sort(backLast).forEach(opt => renderOptionBtn(opt, entrancesContainer));
    [...exitOpts].sort(backLast).forEach(opt => renderOptionBtn(opt, exitsContainer));
    talkOpts.forEach(opt => renderOptionBtn(opt, talkContainer));
    // Acts render in authored order — where a rest sits in the section is the
    // scene author's call, like whether the scene offers one at all. A rest's
    // card says what it does, item-style: a full rest lists everything it
    // gives back, a short rest its heal and the pool's remaining uses — and
    // the short rest disables (rather than hides) at an empty pool, so what a
    // full rest would give back stays visible.
    actionOpts.forEach(opt => {
      if (startsAction(opt, 'full_rest')) {
        renderOptionBtn(opt, actionsContainer, this._fullRestStats());
      } else if (startsAction(opt, 'short_rest')) {
        const btn = renderOptionBtn(opt, actionsContainer, this._shortRestStats());
        const pool = this.engine.state.getPlayer().resources?.[this.engine.data.rules?.shortRest?.resource];
        if (pool?.current < 1) btn.disabled = true;
      } else {
        renderOptionBtn(opt, actionsContainer);
      }
    });

    const skillBtns = [];
    const sceneId = this.engine.state.getCurrentSceneId();

    (scene.skills || []).forEach((opt, i) => {
      if (!opt.skillCheck) return;
      const cond = opt.condition ?? null;
      if (!evaluateCondition(cond, this.engine.state)) return;

      const items = opt.items || [];
      let btn;
      if (items.length) {
        btn = this._buildItemDiscoveryButton(opt, i, sceneId, scene);
      } else if (!opt.dc) {
        btn = this._buildNarrativeButton(opt, i, sceneId, scene);
      } else {
        btn = this._buildPassFailButton(opt, i, sceneId, scene);
      }
      if (btn) skillBtns.push(btn);
    });

    if (skillBtns.length > 0) {
      const heading = createElement('div', CSS.SECTION_HEADING, this.engine.t('ui.skillsHeading'));
      skillsContainer.appendChild(heading);
      skillBtns.forEach(b => skillsContainer.appendChild(b));
      skillsContainer.removeAttribute('hidden');
    }

    // Plugin-registered decorators may append extra option buttons. They get the
    // panel's headed sections too, so a plugin's own act (the curator's "Curate
    // the exhibits") sits with the scene's acts instead of among its doors.
    const sections = { conversations: talkContainer, actions: actionsContainer };
    for (const decorator of this.engine.sceneDecorators) {
      if (decorator.options) decorator.options(scene, optionsContainer, this.engine, sections);
    }

    backOpts.forEach(opt => renderOptionBtn(opt));
    sweepSection(entrancesContainer);
    sweepSection(talkContainer);
    sweepSection(actionsContainer);
    sweepSection(exitsContainer);
  }

  // What a short rest does, as card stat lines — shown on any scene act whose
  // pipeline short-rests: the configured heal, plus the pool's remaining
  // uses. Null when rules.shortRest isn't wired to a declared pool, so a
  // misconfigured act still renders as a plain button.
  _shortRestStats() {
    const config = this.engine.data.rules?.shortRest;
    if (!config?.resource) return null;
    const pool = this.engine.state.getPlayer().resources?.[config.resource];
    if (!(pool && typeof pool === 'object' && 'current' in pool)) return null;

    return [
      this.engine.t('ui.restHealing', { value: String(config.heal ?? 1) }),
      this.engine.t('ui.shortRestRemaining', { current: pool.current, max: pool.max }),
    ];
  }

  // What a full rest gives back, as card stat lines — shown on any scene act
  // whose pipeline full-rests (the bedroom's Long Rest). Derived from the
  // same rules handleFullRest reads, so the lines can't drift from the act.
  _fullRestStats() {
    const t = this.engine.t.bind(this.engine);
    const resourceLabel = (id) => {
      const key = `ui.resources.${id}`;
      return t(key) !== key ? t(key) : id;
    };
    const lines = [t('ui.restHealing', { value: t('ui.restFull') })];
    const retry = this.engine.data.rules?.skillRetry;
    if (retry?.resource && retry.restRestore > 0) {
      lines.push(t('ui.restRestores', { resource: resourceLabel(retry.resource), value: `+${retry.restRestore}` }));
    }
    const shortRest = this.engine.data.rules?.shortRest;
    if (shortRest?.resource) {
      lines.push(t('ui.restRestores', { resource: resourceLabel(shortRest.resource), value: t('ui.restFull') }));
    }
    return lines;
  }

  /**
   * Executes a chosen scene option: logs the choice (unless silenced) and runs
   * its action pipeline.
   *
   * @param {object} opt - The option object from the scene's `options` array.
   */
  handleOption(opt) {
    if (this.engine.isGameOver) return; // only Load/Restart act after death
    if (opt.log !== false) this.engine.log(LOG.PLAYER, opt.text, 'choice');

    this._chargeTime(opt, this._optionCostKind(opt));

    const didNavigate = this.engine.snapshotNavigation();
    this.engine.runActions(opt.actions || []);

    // Re-render options if nothing caused navigation, so flag changes take
    // effect immediately.
    if (!didNavigate()) {
      const scene = this.engine.data.scenes[this.engine.state.getCurrentSceneId()];
      if (scene) this.renderOptions(scene);
    }
  }

  // Picks which rules.time.defaultCosts entry applies to a plain scene option,
  // from what its pipeline does: moving somewhere defaults to the travel cost,
  // a full rest to the rest cost. Anything else is free unless the option
  // carries an explicit timeCost.
  _optionCostKind(opt) {
    const actions = opt.actions || [];
    if (actions.some(a => a.type === 'navigate' || a.type === 'return')) return 'navigate';
    if (actions.some(a => a.type === 'full_rest')) return 'fullRest';
    return null;
  }

  // Advances the world clock for a chosen option/check. An explicit timeCost
  // always wins; otherwise the kind's default from rules.time.defaultCosts
  // applies. Always charged BEFORE any pipeline that can navigate, so a timer
  // that fires can set flags the destination scene already sees. Plain options
  // charge up front; skill checks charge after their roll and loot are
  // narrated, so the passage of time reads as a consequence of the attempt.
  _chargeTime(opt, kind) {
    const cost = resolveTimeCost(opt.timeCost, kind, this.engine.data.rules);
    if (cost > 0) this.engine.advanceTime(cost);
  }

  // Reads one discovery entry's state from the shared per-skill check-state map.
  // The map is shared by every check in the scene that rolls the same skill
  // (pass/fail attempt counters, narrative uses, resolution markers), so
  // discovery state lives NAMESPACED under `disc_<index>` — it must never
  // replace the whole map, or it wipes its siblings' state. Older saves
  // stored discovery state at the map's top level; that shape is adopted by
  // the first discovery entry that reads it.
  _readDiscoveryState(skillKey, i, items) {
    const map = this.engine.state.getCheckState(skillKey);
    const state = typeof map === 'object' && map !== null ? map[`disc_${i}`] : null;
    if (state?.found) return state;
    if (i === 0 && map?.found) {
      // Legacy top-level shape (pre-namespacing) — adopt it as the FIRST
      // entry's only (later entries didn't exist when it was written), padding
      // or truncating `found` to the current item list so no holes or stale
      // trailing entries survive.
      return {
        found: items.map((_, idx) => map.found[idx] ?? false),
        tries: map.tries,
        resolved: map.resolved,
      };
    }
    return { found: items.map(() => false) };
  }

  // Persists one discovery entry's state into the shared map, clearing any
  // legacy top-level discovery fields it supersedes.
  _saveDiscoveryState(skillKey, i, state) {
    const existing = this.engine.state.getCheckState(skillKey);
    const map = typeof existing === 'object' && existing !== null ? existing : {};
    delete map.found;
    delete map.tries;
    delete map.resolved;
    delete map.dcs;
    map[`disc_${i}`] = state;
    this.engine.state.setCheckState(skillKey, map);
  }

  // Item-discovery skill check: roll against per-item DCs, track found items.
  // Returns a button, or null when everything has been found or the check has
  // been retired (resolveOnce, or an exhausted maxAttempts budget).
  _buildItemDiscoveryButton(opt, i, sceneId, scene) {
    const skillKey = CHECK_KEYS.skillDc(opt.skillCheck, sceneId);
    const items = opt.items;
    const state = this._readDiscoveryState(skillKey, i, items);
    if (state.resolved || state.found.every(f => f)) return null;

    const lowestDc = Math.min(...items.map(l => l.dc ?? 10).filter((_, idx) => !state.found[idx]));
    const p = checkPresentation(this.engine, opt, state.tries || 0, lowestDc);
    const btn = buildOptionButton(p.displayText, p.badge);
    if (p.blocked) {
      btn.disabled = true;
      return btn;
    }
    btn.onclick = () => {
      if (this.engine.isGameOver) return;
      this.engine.log(LOG.PLAYER, p.displayText, 'choice');
      spendRetryCost(this.engine, p.gate);
      this._resolveDiscovery(opt, i, state, skillKey, scene);
    };
    return btn;
  }

  // Resolves one discovery attempt: rolls once against every still-hidden
  // item's DC, marks hits as found, awards the found loot, persists the
  // updated state, and re-renders the options. A maxAttempts budget that runs
  // out (or resolveOnce) retires the check; exhaustion runs onExhausted.
  _resolveDiscovery(opt, i, state, skillKey, scene) {
    const items = opt.items;
    const mod = this.engine.state.getPlayer().attributes[opt.skillCheck] ?? 0;
    const baseRoll = roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + mod;

    // The DC the roll is narrated against: the easiest still-hidden item's —
    // the same number the button's badge advertised for this attempt.
    const lowestDc = Math.min(...items.map(l => l.dc ?? 10).filter((_, idx) => !state.found[idx]));

    const newlyFound = [];
    items.forEach((l, idx) => {
      if (state.found[idx]) return;
      if (hitRoll >= (l.dc ?? 10)) { state.found[idx] = true; newlyFound.push(l); }
    });

    const anyFound = newlyFound.length > 0;
    const stillMore = anyFound && !state.found.every(f => f);
    const msgKey = anyFound
      ? (stillMore ? 'actions.lookAroundFoundMore' : 'actions.lookAroundFound')
      : 'actions.lookAroundFail';
    const variant = anyFound ? 'loot' : 'system';
    this.engine.log(LOG.SYSTEM, this.engine.t('actions.lookAroundRoll', {
      roll: hitRoll,
      dc: lowestDc,
      breakdown: rollBreakdown(baseRoll, mod, skillLabel(this.engine, opt.skillCheck)),
    }), variant);
    // The outcome narration is its own log entry: same source, so it groups
    // under the roll line with a breathing gap (like combat's damage lines).
    this.engine.log(LOG.SYSTEM, this.engine.t(msgKey), variant);

    this._awardDiscoveredLoot(newlyFound);
    this._chargeTime(opt, 'skillAttempt');

    state.tries = (state.tries || 0) + 1;
    const allFound = state.found.every(f => f);
    const exhausted = !allFound && opt.maxAttempts && state.tries >= opt.maxAttempts;
    if (opt.resolveOnce || exhausted) state.resolved = true;
    this._saveDiscoveryState(skillKey, i, state);

    if (exhausted && opt.onExhausted?.length) {
      const didNavigate = this.engine.snapshotNavigation();
      this.engine.runActions(opt.onExhausted);
      if (didNavigate()) return;
    }
    this.renderOptions(scene);
  }

  // Awards the loot for newly found discovery entries: rolls table entries
  // into concrete drops, aggregates duplicates, adds gold/items to the player,
  // and logs one summary line listing everything found.
  _awardDiscoveredLoot(newlyFound) {
    const drops = [];
    newlyFound.forEach(l => {
      if (l.table) {
        for (let i = 0; i < (l.itemDrops ?? 1); i++) {
          const resolved = rollTable(this.engine.data.tables[l.table]);
          if (resolved) drops.push(resolved);
        }
      } else {
        drops.push(l);
      }
    });

    const aggregated = new Map();
    drops.forEach(d => {
      const existing = aggregated.get(d.item);
      if (existing) existing.amount += (d.amount ?? 1);
      else aggregated.set(d.item, { item: d.item, amount: d.amount ?? 1 });
    });

    const lootItems = [];
    aggregated.forEach(d => {
      if (d.item === GOLD_ITEM_ID) {
        this.engine.state.modifyPlayerStat('gold', d.amount);
        lootItems.push(`${d.amount} ${this.engine.t('loot.gold')}`);
      } else {
        this.engine.state.addToInventory(d.item, d.amount);
        lootItems.push(getItemLabel(this.engine.data.items, d.item, d.amount));
      }
    });

    if (lootItems.length === 0) return;

    // Locale-aware list joining ("A, B, and C") — list grammar never lives
    // in code, and the sentence itself comes from loot.foundItems.
    const list = formatList(this.engine.language, lootItems);
    this.engine.log(LOG.SYSTEM, this.engine.t('loot.foundItems', { list }), 'loot');
  }

  // Narrative (free) skill check: no roll, no DC — a story beat framed as a
  // skill. Logs the authored resultText (a string, or an array walked per use)
  // and runs an optional action pipeline. Retires after one use unless marked
  // repeatable. Returns a button, or null once retired.
  _buildNarrativeButton(opt, i, sceneId, scene) {
    const skillKey = CHECK_KEYS.skillDc(opt.skillCheck, sceneId);
    const state = this.engine.state.getCheckState(skillKey);
    // Older saves stored a bare `true` at this key for a used flavor check.
    const uses = state === true ? 1 : (state?.[`uses_${i}`] || 0);
    if (uses > 0 && !opt.repeatable) return null;

    const badgeKey = `actions.skillBadgeFree.${opt.skillCheck}`;
    const badge = this.engine.t(badgeKey) !== badgeKey
      ? this.engine.t(badgeKey)
      : this.engine.t('actions.lookAroundBadge');

    // Narrative beats are free story moments — no AP, no roll.
    const btn = buildOptionButton(opt.text, badge);
    btn.onclick = () => {
      if (this.engine.isGameOver) return;
      const map = typeof state === 'object' && state !== null ? state : {};
      map[`uses_${i}`] = uses + 1;
      this.engine.state.setCheckState(skillKey, map);
      this.engine.log(LOG.PLAYER, opt.text, 'choice');

      if (opt.resultText) {
        this.engine.log(LOG.NARRATOR, pickVariant(opt.resultText, uses));
      } else {
        this.engine.log(LOG.SYSTEM, this.engine.t('actions.lookAroundEmpty'));
      }

      // Narrative beats are free by default — no skillAttempt default cost.
      this._chargeTime(opt, null);

      const didNavigate = this.engine.snapshotNavigation();
      this.engine.runActions(normalizeOutcomes(opt).success.actions);
      if (!didNavigate()) this.renderOptions(scene);
    };
    return btn;
  }

  // Pass/fail skill check, resolved against the check's outcome tiers
  // (critical/success/partial/failure) by the shared runCheckAttempt machine.
  // Returns a button, or null when the check has been retired (resolveOnce,
  // or an exhausted maxAttempts budget).
  _buildPassFailButton(opt, i, sceneId, scene) {
    const skillKey = CHECK_KEYS.skillDc(opt.skillCheck, sceneId);
    if (isResolved(this.engine.state, skillKey, i)) return null;
    const p = checkPresentation(this.engine, opt, getAttempts(this.engine.state, skillKey, i));
    const btn = buildOptionButton(p.displayText, p.badge);
    if (p.blocked) {
      btn.disabled = true;
      return btn;
    }
    btn.onclick = () => {
      if (this.engine.isGameOver) return;
      this.engine.log(LOG.PLAYER, p.displayText, 'choice');
      spendRetryCost(this.engine, p.gate);
      runCheckAttempt(this.engine, opt, {
        attemptKey: skillKey,
        entryKey: i,
        runActions: (actions) => this.engine.runActions(actions),
        // Like handleOption, the re-render must be skipped when a pipeline
        // opened a dialogue or custom UI — rendering would clobber it.
        didNavigate: this.engine.snapshotNavigation(),
        chargeTime: () => this._chargeTime(opt, 'skillAttempt'),
        rerender: () => this.renderOptions(scene),
        // A success may set flags a description variant reads — re-render fully.
        rerenderSuccess: () => this.engine.renderScene(this.engine.state.getCurrentSceneId()),
      });
    };
    return btn;
  }

  // Returns the description string to display for a scene.
  // Handles two cases:
  //   1. Plain string description — returned as-is.
  //   2. Conditional array — first matching condition wins; the entry with
  //      no condition acts as the fallback.
  _resolveDescription(scene) {
    let desc = scene.description;

    if (Array.isArray(scene.description)) {
      desc = this._resolveDescriptionVariant(scene)?.text || '';
    }

    // Plugin-registered decorators may append dynamic HTML to any scene's
    // description (e.g. the curator plugin's exhibits table).
    const sceneId = this.engine.state.getCurrentSceneId() || scene.id;
    for (const decorator of this.engine.sceneDecorators) {
      if (decorator.description) desc += decorator.description(scene, sceneId, this.engine) || '';
    }

    return desc;
  }

  // The matching entry of a conditional description array — first matching
  // condition wins; the entry with no condition is the fallback. Null for
  // plain-string descriptions.
  _resolveDescriptionVariant(scene) {
    if (!Array.isArray(scene.description)) return null;
    for (const d of scene.description) {
      if (d.condition && evaluateCondition(d.condition, this.engine.state)) return d;
    }
    return scene.description.find(d => !d.condition) ?? null;
  }

  // The narration clip for a scene entry: the resolved description variant's
  // `narration` wins, the scene-level field is the fallback (and covers
  // plain-string descriptions). Null when neither is authored.
  _resolveNarration(scene) {
    return this._resolveDescriptionVariant(scene)?.narration ?? scene.narration ?? null;
  }
}
