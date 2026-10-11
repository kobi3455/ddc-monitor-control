# DDC Monitor Control

A GNOME Shell extension that controls external monitors over DDC/CI from the
Quick Settings menu. It talks to the monitors through
[ddcutil](https://www.ddcutil.com/).

## Features

- One brightness slider per monitor in Quick Settings, with the display number
  and the current percentage next to it.
- A dropdown menu per monitor with:
  - contrast and speaker volume sliders,
  - input source selection,
  - color preset selection,
  - a refresh button that re-reads the current values from the monitor.
- Only the features a monitor reports in its DDC capabilities are shown.
- Configurable slider position: top of the panel, below the built-in sliders,
  bottom of the panel, or a separate panel.
- Monitors are re-detected after a display is connected or disconnected.

## Requirements

- GNOME Shell 50 or higher.
- `ddcutil` 2.x (installed by the install script).
- A monitor that supports DDC/CI, with DDC/CI enabled in its on-screen menu.
- Read/write access to the monitor's I2C device (`/dev/i2c-*`) for your user.

## Installation

The extension is not yet published on
[extensions.gnome.org](https://extensions.gnome.org/), so for now it has to be
installed from this repository.

```sh
git clone https://github.com/kobi3455/ddc-monitor-control.git
cd ddc-monitor-control
./install.sh
```

The script:

1. installs `ddcutil` with your package manager (`dnf`, `apt`, `pacman` or
   `zypper`) if it is missing, asking for your sudo password,
2. loads the `i2c-dev` kernel module if no I2C devices are present,
3. copies the extension to `~/.local/share/gnome-shell/extensions/ddc-control@kobi3455.github.io`
   and compiles its settings schema,
4. enables the extension.

**Log out and back in afterwards.** On Wayland the shell only discovers new
extensions at login.

To update, run `git pull` in the cloned folder, run `./install.sh` again and
log out and back in.

## Manual (Advanced) Installation

Install ddcutil:

```sh
sudo dnf install ddcutil        # Fedora
sudo apt install ddcutil        # Debian / Ubuntu
sudo pacman -S ddcutil          # Arch
```

Then check that it works **without sudo**:

```sh
ddcutil detect
ddcutil getvcp 10
```

If `ddcutil detect` lists your monitors and `getvcp 10` prints a brightness
value, the extension will work. If it reports permission errors, make sure the
`i2c-dev` kernel module is loaded and that your user may access `/dev/i2c-*`.
Recent ddcutil packages ship udev rules that grant this to the logged-in user;
otherwise add yourself to the `i2c` group and log in again:

```sh
sudo modprobe i2c-dev
sudo usermod -aG i2c $USER
```

Then install the extension itself:

```sh
git clone https://github.com/kobi3455/ddc-monitor-control.git \
    ~/.local/share/gnome-shell/extensions/ddc-control@kobi3455.github.io
glib-compile-schemas ~/.local/share/gnome-shell/extensions/ddc-control@kobi3455.github.io/schemas
```

The folder name must be exactly `ddc-control@kobi3455.github.io`.

Log out and back in (on Wayland the shell only discovers new extensions at
login), then enable it:

```sh
gnome-extensions enable ddc-control@kobi3455.github.io
```

To update, run `git pull` in the extension folder, re-run
`glib-compile-schemas` and log out and back in.

## Usage

Open Quick Settings. Each detected monitor has a brightness slider. The arrow
at the end of a slider opens that monitor's menu with the remaining controls.

The extension reads the monitor's values when it loads and after a display is
connected or disconnected. It does not poll, so changes made with the
monitor's own buttons only show up after pressing the refresh button in the
monitor's menu.

Switching the input source takes effect immediately. If the selected input has
no signal, the monitor will show nothing until you switch back with its
buttons.

## Preferences

Open the preferences from a terminal:

```sh
gnome-extensions prefs ddc-control@kobi3455.github.io
```

or from any extension manager, such as the GNOME Extensions app or the
[Extension List](https://extensions.gnome.org/extension/3088/extension-list/)
shell extension.

| Setting         | Values                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Slider position | Top of the panel, Below the built-in sliders (default), Bottom, Separate panel |

In "Separate panel" mode the sliders get their own panel, which can be dragged
to a different place in the Quick Settings layout.

## Troubleshooting

Show the extension's log messages:

```sh
journalctl --user -b -o cat _COMM=gnome-shell | grep -i ddc
```

- **No sliders appear:** run `ddcutil detect` in a terminal. A monitor listed
  as "Invalid display" does not answer DDC requests; enable DDC/CI in its
  on-screen menu or try another cable or port. Monitors that do not report
  brightness support are not shown.
- **A control is missing:** the monitor does not list that feature in
  `ddcutil capabilities`.
- **Short stutter when a value is applied:** DDC requests are slow and can
  briefly stall the display pipeline on some graphics drivers. This is why
  values are only sent on release and never polled.

## Limitations

- Tested on Wayland only: Fedora with GNOME Shell 50 and CachyOS with GNOME
  Shell 51.
- Translations are not implemented yet; the interface is English only.
- Not yet available on extensions.gnome.org.
- Placing the sliders inside the main panel relies on GNOME Shell internals
  that may change between releases.

## Credits and license

The separate panel mode uses [libpanel](https://github.com/Rayzeq/libpanel) by
Rayzeq, bundled in `libs/libpanel`.

Licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
