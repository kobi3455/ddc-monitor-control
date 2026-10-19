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

        const redetectButton = new Gtk.Button({
            label: 'Re-detect',
            valign: Gtk.Align.CENTER,
        });
        redetectButton.connect('clicked', () =>
            settings.set_uint('redetect', (settings.get_uint('redetect') + 1) >>> 0));
        const redetectRow = new Adw.ActionRow({
            title: 'Re-detect monitors',
            subtitle: 'Search again for monitors that support DDC/CI',
            activatable_widget: redetectButton,
        });
        redetectRow.add_suffix(redetectButton);

        const group = new Adw.PreferencesGroup();
        group.add(row);
        group.add(redetectRow);

        const page = new Adw.PreferencesPage();
        page.add(group);
        window.add(page);
    }
}
