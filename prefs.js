import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = [
    ['top', 'Top of the panel'],
    ['sliders', 'Below the built-in sliders'],
    ['bottom', 'Bottom of the panel'],
    ['panel', 'Separate panel'],
];

export default class DdcControlPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const row = new Adw.ComboRow({
            title: 'Slider position',
            subtitle: 'Where the monitor sliders appear in Quick Settings',
            model: Gtk.StringList.new(POSITIONS.map(([, label]) => label)),
            selected: POSITIONS.findIndex(([nick]) => nick === settings.get_string('position')),
        });
        row.connect('notify::selected',
            () => settings.set_string('position', POSITIONS[row.selected][0]));

        const group = new Adw.PreferencesGroup();
        group.add(row);

        const page = new Adw.PreferencesPage();
        page.add(group);
        window.add(page);
    }
}
