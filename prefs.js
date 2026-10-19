import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Translated where they are used, once the preferences object exists
const POSITIONS = [
    ['top', N_('Top of the panel')],
    ['sliders', N_('Below the built-in sliders')],
    ['bottom', N_('Bottom of the panel')],
    ['panel', N_('Separate panel')],
];

// Only marks the strings above for extraction by xgettext
function N_(str) {
    return str;
}

export default class DdcControlPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const row = new Adw.ComboRow({
            title: _('Slider position'),
            subtitle: _('Where the monitor sliders appear in Quick Settings'),
            model: Gtk.StringList.new(POSITIONS.map(([, label]) => _(label))),
            selected: POSITIONS.findIndex(([nick]) => nick === settings.get_string('position')),
        });
        row.connect('notify::selected',
            () => settings.set_string('position', POSITIONS[row.selected][0]));

        const redetectButton = new Gtk.Button({
            label: _('Re-detect'),
            valign: Gtk.Align.CENTER,
        });
        redetectButton.connect('clicked', () =>
            settings.set_uint('redetect', (settings.get_uint('redetect') + 1) >>> 0));
        const redetectRow = new Adw.ActionRow({
            title: _('Re-detect monitors'),
            subtitle: _('Search again for monitors that support DDC/CI'),
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
