import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickSlider, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import * as Ddc from './ddc.js';
import {LibPanel, Panel} from './libs/libpanel/main.js';

// Monitors need a moment after a hotplug before they answer DDC requests
const RELOAD_DELAY_SECONDS = 3;

// Scrolling and arrow keys have no "release", so those changes are
// sent once the value has been left alone for this long.
const APPLY_DELAY_MS = 400;

const MENU_SLIDERS = [
    [Ddc.Vcp.CONTRAST, 'Contrast'],
    [Ddc.Vcp.VOLUME, 'Volume'],
];

const MENU_CHOICES = [
    [Ddc.Vcp.INPUT_SOURCE, 'Input Source'],
    [Ddc.Vcp.COLOR_PRESET, 'Color Preset'],
];

// The number the compositor gives the monitor, falling back to
// ddcutil's own numbering when the connector cannot be matched.
function displayNumber(display) {
    let index = -1;
    if (display.connector) {
        index = global.backend.get_monitor_manager()
            .get_monitor_for_connector?.(display.connector) ?? -1;
    }
    return index >= 0 ? index + 1 : display.number;
}

const MonitorItem = GObject.registerClass(
class MonitorItem extends QuickSlider {
    _init(display, redetect) {
        super._init({
            iconName: 'display-brightness-symbolic',
            iconLabel: `${display.name} brightness`,
            menuButtonAccessibleName: `Open ${display.name} menu`,
        });

        this._display = display;
        this._sliders = new Map();
        this._choices = new Map();
        this._max = new Map();
        this._applyIds = new Map();

        const number = displayNumber(display);

        const box = this.child;
        const sliderBin = this.slider.get_parent();
        box.insert_child_below(new St.Label({
            text: `${number}`,
            style_class: 'ddc-slider-number',
            y_align: Clutter.ActorAlign.CENTER,
        }), sliderBin);
        const [percentBin, percent] = this._createPercentLabel();
        box.insert_child_above(percentBin, sliderBin);

        this.slider.accessible_name = `${display.name} brightness`;
        this._bindSlider(Ddc.Vcp.BRIGHTNESS, this.slider, percent);

        this.menu.setHeader('video-display-symbolic', display.name, `Display ${number}`);

        // Values are not polled, so this picks up changes made with the
        // monitor's own buttons.
        const refreshButton = new St.Button({
            child: new St.Icon({icon_name: 'view-refresh-symbolic'}),
            style_class: 'icon-button flat',
            accessible_name: 'Re-read settings from monitor',
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        refreshButton.connect('clicked', async () => {
            refreshButton.reactive = false;
            await this.refresh();
            if (!this._destroyed)
                refreshButton.reactive = true;
        });
        this.menu.addHeaderSuffix(refreshButton);

        for (const [code, label] of MENU_SLIDERS) {
            if (display.supports(code))
                this._addMenuSlider(code, label);
        }

        for (const [code, label] of MENU_CHOICES) {
            if (display.features.get(code)?.values.size > 1)
                this._addMenuChoice(code, label);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Re-detect Monitors', () => redetect());

        this.menuEnabled = true;

        this.connect('destroy', () => {
            this._destroyed = true;
            this.menu.destroy();
            this._applyIds.forEach(id => GLib.source_remove(id));
            this._applyIds.clear();
        });
    }

    // The label sits in a fixed-width bin that is cut off from layout:
    // otherwise every text change while dragging re-lays out the whole
    // Quick Settings popup, which makes libpanel move it around.
    _createPercentLabel() {
        const label = new St.Label({
            style_class: 'ddc-slider-percent-label',
            x_expand: true,
        });
        const bin = new St.Bin({
            style_class: 'ddc-slider-percent',
            child: label,
            y_align: Clutter.ActorAlign.CENTER,
        });
        bin.set_no_layout(true);
        return [bin, label];
    }

    _bindSlider(code, slider, percent) {
        this._sliders.set(code, slider);

        slider.connectObject(
            'notify::value', () => {
                percent.text = `${Math.round(slider.value * 100)}%`;
                if (slider._blockDdcWrite || slider._ddcDragging)
                    return;
                this._queueApply(code);
            },
            'drag-begin', () => (slider._ddcDragging = true),
            'drag-end', () => {
                slider._ddcDragging = false;
                this._apply(code);
            }, this);
    }

    _queueApply(code) {
        if (this._applyIds.has(code))
            GLib.source_remove(this._applyIds.get(code));
        this._applyIds.set(code, GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            APPLY_DELAY_MS, () => {
                this._applyIds.delete(code);
                this._apply(code);
                return GLib.SOURCE_REMOVE;
            }));
    }

    _apply(code) {
        if (this._applyIds.has(code)) {
            GLib.source_remove(this._applyIds.get(code));
            this._applyIds.delete(code);
        }

        const max = this._max.get(code) ?? 100;
        this._display.set(code, Math.round(this._sliders.get(code).value * max));
    }

    _addMenuSlider(code, label) {
        this.menu.addMenuItem(new PopupMenu.PopupMenuItem(label, {reactive: false}));

        const slider = new Slider(0);
        slider.accessible_name = label;

        const sliderBin = new St.Bin({
            style_class: 'slider-bin',
            child: slider,
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const [percentBin, percent] = this._createPercentLabel();

        const sliderMenuItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        sliderMenuItem.add_child(sliderBin);
        sliderMenuItem.add_child(percentBin);
        this.menu.addMenuItem(sliderMenuItem);

        this._bindSlider(code, slider, percent);
    }

    _addMenuChoice(code, label) {
        const subMenu = new PopupMenu.PopupSubMenuMenuItem(label);
        const items = new Map();
        for (const [value, name] of this._display.features.get(code).values) {
            const item = subMenu.menu.addAction(name, () => {
                this._display.set(code, value);
                this._syncChoice(code, value);
            });
            items.set(value, item);
        }
        this.menu.addMenuItem(subMenu);
        this._choices.set(code, items);
    }

    _syncChoice(code, current) {
        for (const [value, item] of this._choices.get(code)) {
            item.setOrnament(value === current
                ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        }
    }

    async refresh() {
        let values;
        try {
            values = await this._display.read(
                [...this._sliders.keys(), ...this._choices.keys()]);
        } catch (e) {
            if (!Ddc.isCancelled(e))
                console.error(`DDC: ${this._display.name}: ${e.message}`);
            return;
        }

        if (this._destroyed)
            return;

        for (const [code, {value, max, low}] of values) {
            const slider = this._sliders.get(code);
            if (slider && max > 0) {
                this._max.set(code, max);
                slider._blockDdcWrite = true;
                slider.value = value / max;
                // Also notify when unchanged so the percentage gets filled in
                slider.notify('value');
                slider._blockDdcWrite = false;
            } else if (this._choices.has(code)) {
                this._syncChoice(code, low);
            }
        }
    }
});

const Indicator = GObject.registerClass(
class Indicator extends SystemIndicator {
    _init(displays, redetect) {
        super._init();

        for (const display of displays) {
            if (display.supports(Ddc.Vcp.BRIGHTNESS))
                this.quickSettingsItems.push(new MonitorItem(display, redetect));
        }

        // Values are only read here, not whenever the menu opens: DDC
        // traffic can stall the compositor for the duration of the request.
        this.quickSettingsItems.forEach(item => item.refresh());
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class DdcControlExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settings.connectObject(
            'changed::position', () => this._rebuild(),
            // Bumped by the preferences window to request a re-detection
            'changed::redetect', () => this._redetect(),
            this);

        this._generation = 0;
        this._reload();

        Main.layoutManager.connectObject('monitors-changed',
            () => this._queueReload(), this);
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._settings = null;

        this._cancelQueuedReload();

        // Invalidates any detection still in flight
        this._generation++;
        this._clear();
    }

    _cancelQueuedReload() {
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = null;
    }

    _queueReload() {
        this._cancelQueuedReload();
        this._reloadId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            RELOAD_DELAY_SECONDS, () => {
                this._reloadId = null;
                this._reload();
                return GLib.SOURCE_REMOVE;
            });
    }

    // Manual re-detection, for monitors that were missed at startup (e.g.
    // DDC/CI only enabled later) or changed without a hotplug event.
    _redetect() {
        this._cancelQueuedReload();
        this._reload();
    }

    async _reload() {
        const generation = ++this._generation;

        let displays;
        try {
            displays = await Ddc.detect();
        } catch (e) {
            console.error(`DDC: monitor detection failed: ${e.message}`);
            return;
        }

        if (generation !== this._generation) {
            displays.forEach(display => display.destroy());
            return;
        }

        this._clear();
        this._displays = displays;
        this._rebuild();
    }

    _rebuild() {
        if (!this._displays)
            return;

        this._removeIndicator();
        this._indicator = new Indicator(this._displays, () => this._redetect());

        if (this._settings.get_string('position') === 'panel') {
            this._addPanel();
        } else {
            Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator, 2);
            this._place();
        }
    }

    // A panel of its own next to the main one, provided by libpanel so
    // that it coexists with the panels of other extensions using it.
    _addPanel() {
        LibPanel.enable();

        this._panel = new Panel('main');
        // Nothing in the panel has a minimum width, so match the main one
        this._panel.add_constraint(new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.WIDTH,
            source: LibPanel.main_panel,
        }));
        LibPanel.addPanel(this._panel);

        this._indicator.quickSettingsItems.forEach(
            item => this._panel.addItem(item, 2));
    }

    _removeIndicator() {
        this._indicator?.destroy();
        this._indicator = null;

        if (this._panel) {
            // Keeps the position the panel was dragged to
            LibPanel.removePanel(this._panel);
            this._panel.destroy();
            this._panel = null;
            LibPanel.disable();
        }
    }

    // The public API only appends external items after the toggles, so
    // the sliders are moved to the configured spot in the grid afterwards.
    _place() {
        const items = this._indicator?.quickSettingsItems ?? [];
        const {quickSettings} = Main.panel.statusArea;
        const grid = quickSettings.menu._grid;
        if (!grid || items.some(item => item.get_parent() !== grid))
            return;

        const inGrid = actor => actor?.get_parent() === grid ? actor : null;

        let after = null;
        let before = null;
        switch (this._settings.get_string('position')) {
        case 'top':
            before = grid.get_children().find(child => !items.includes(child));
            break;
        case 'sliders':
            after = inGrid(quickSettings._brightness?.quickSettingsItems.at(-1));
            break;
        }
        // Bottom, and the fallback for the others: above background apps
        if (!after && !before)
            before = inGrid(quickSettings._backgroundApps?.quickSettingsItems.at(0));

        for (const item of items) {
            if (after) {
                grid.set_child_above_sibling(item, after);
                after = item;
            } else if (before) {
                grid.set_child_below_sibling(item, before);
            } else {
                // A null sibling moves the item to the very end
                grid.set_child_above_sibling(item, null);
            }
        }
    }

    _clear() {
        this._removeIndicator();

        this._displays?.forEach(display => display.destroy());
        this._displays = null;
    }
}
