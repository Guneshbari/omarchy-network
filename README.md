# Network Manager for Omarchy

An enhanced Network bar widget and popup panel for the Omarchy Linux desktop shell. Features full Wi-Fi scanning and connection management, DNS provider selection, and an interactive **Wired Ethernet IPv4 configuration interface** with complete keyboard navigation and floating `nmtui` integration.

![Network Manager Preview](preview.png)

---

## Features

- 🌐 **Wi-Fi Management**: Scan, connect, disconnect, and enter passphrases for known and nearby networks.
- 🔌 **Wired Connection GUI**:
  - Real-time Ethernet interface and profile detection (`nmcli`).
  - Switch between **`<Automatic>` (DHCP)** and **`<Manual>` (Static IP)** with a single click or keystroke.
  - Interactive manual IPv4 form fields for **Addresses** (CIDR), **Gateway**, and **DNS servers**.
  - Direct validation, dirty tracking, and instant Apply/Cancel buttons.
- ⌨️ **Full Keyboard Accessibility**:
  - Seamless navigation with Arrow keys or Vim keys (`h`/`j`/`k`/`l`).
  - Tab and Shift+Tab navigation through manual input fields.
  - Quick hotkey `n` or `N` to open `nmtui` in a centered floating terminal window.
  - Visual cursor focus outlines matching Omarchy's design language.
- 🛡️ **DNS Switching**: One-click switching between DHCP, Cloudflare, Google, and Custom DNS.
- 🚀 **Speed Test & Sharing**: Integrated speed test and Wi-Fi QR code sharing overlays.

---

## Installation

You can install and enable this plugin with the Omarchy plugin CLI:

```bash
omarchy plugin add https://github.com/guneshbari/omarchy-network --enable
```

To replace the default network widget in your status bar, update `~/.config/omarchy/shell.json`:

```json
{
  "bar": {
    "sections": {
      "right": [
        { "id": "gnx.network" }
      ]
    }
  }
}
```

Then reload your shell:

```bash
omarchy restart shell
```

---

## Keyboard Navigation Reference

| Key(s) | Context | Action |
|---|---|---|
| `Down` / `j` | Header / Panel | Move focus to next section or row |
| `Up` / `k` | Header / Panel | Move focus to previous section or row |
| `Left` / `Right` or `h` / `l` | Buttons | Switch between pills or action buttons |
| `Enter` / `Space` | Buttons | Activate selected button or toggle method |
| `Tab` / `Down` | Input Fields | Advance to next field or action button |
| `Shift+Tab` / `Up` | Input Fields | Return to previous field or method row |
| `Escape` | Input Fields | Exit field editing and return cursor to `<Manual>` |
| `n` / `N` | Panel (unfocused) | Launch `nmtui` in a floating terminal |
| `r` / `R` | Panel (unfocused) | Refresh network list and connection status |
| `w` / `W` | Panel (unfocused) | Toggle Wi-Fi radio on/off |

---

## Dependencies

- **NetworkManager** (`nmcli`)
- **Omarchy Shell** (`quickshell`)
- **Hyprland**

To ensure `nmtui` always opens in a centered floating window, add this rule to your `~/.config/hypr/hyprland.lua`:

```lua
o.window("org.omarchy.nmtui", { tag = "+floating-window" })
```

---

## License

[MIT](LICENSE) © 2026 Gunesh Bari
