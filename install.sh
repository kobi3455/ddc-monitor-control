#!/usr/bin/env bash
# Installs DDC Monitor Control and its dependencies for the current user.
set -euo pipefail

UUID="ddc-control@kobi3455.github.io"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

info() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -ne 0 ]] || die "Run this script as your normal user, not as root. It asks for sudo when needed."
[[ -f "$SRC/metadata.json" ]] || die "Run this script from a checkout of the repository."
command -v gnome-shell >/dev/null || die "GNOME Shell is not installed."

# --- Dependencies -----------------------------------------------------------

install_packages() {
    if command -v dnf >/dev/null; then
        sudo dnf install -y "$@"
    elif command -v apt-get >/dev/null; then
        sudo apt-get update
        sudo apt-get install -y "$@"
    elif command -v pacman >/dev/null; then
        sudo pacman -S --needed --noconfirm "$@"
    elif command -v zypper >/dev/null; then
        sudo zypper --non-interactive install "$@"
    else
        die "No supported package manager found. Install manually: $*"
    fi
}

missing=()
command -v ddcutil >/dev/null || missing+=(ddcutil)
if ! command -v glib-compile-schemas >/dev/null; then
    # The schema compiler ships with GLib; only the package name differs
    if command -v apt-get >/dev/null; then
        missing+=(libglib2.0-bin)
    elif command -v zypper >/dev/null; then
        missing+=(glib2-tools)
    else
        missing+=(glib2)
    fi
fi

if (( ${#missing[@]} )); then
    info "Installing dependencies: ${missing[*]}"
    install_packages "${missing[@]}"
else
    info "Dependencies are already installed"
fi

# --- I2C access -------------------------------------------------------------

if ! compgen -G "/dev/i2c-*" >/dev/null; then
    info "Loading the i2c-dev kernel module"
    sudo modprobe i2c-dev
    echo i2c-dev | sudo tee /etc/modules-load.d/i2c-dev.conf >/dev/null
fi

# --- Extension --------------------------------------------------------------

# When the destination is this checkout itself (e.g. a symlink used for
# development) there is nothing to copy.
if [[ "$(readlink -f "$DEST")" != "$(readlink -f "$SRC")" ]]; then
    info "Installing the extension to $DEST"
    rm -rf "$DEST"
    mkdir -p "$DEST"
    cp -r "$SRC"/{extension.js,ddc.js,prefs.js,metadata.json,stylesheet.css,libs,schemas,LICENSE} "$DEST"/
else
    info "Extension folder already points at this checkout"
fi

glib-compile-schemas "$DEST/schemas"

# The running shell does not know a new extension until the next login, so
# `gnome-extensions enable` would fail here; add it to the enabled list instead.
enabled="$(gsettings get org.gnome.shell enabled-extensions)"
if [[ "$enabled" != *"'$UUID'"* ]]; then
    info "Enabling the extension"
    if [[ "$enabled" == *"[]" ]]; then
        enabled="['$UUID']"
    else
        enabled="${enabled%]}, '$UUID']"
    fi
    gsettings set org.gnome.shell enabled-extensions "$enabled"
fi

# --- Check ------------------------------------------------------------------

if ! ddcutil detect --brief 2>/dev/null | grep -q '^Display'; then
    warn "ddcutil did not find a monitor it can control."
    echo "  - Make sure DDC/CI is enabled in the monitor's on-screen menu." >&2
    echo "  - If 'ddcutil detect' reports permission errors, run:" >&2
    echo "        sudo usermod -aG i2c \$USER" >&2
    echo "    and log in again." >&2
fi

echo
info "Done. Log out and back in for the extension to appear in Quick Settings."
