# Contributing to community.network

Thank you for your interest in contributing to `community.network` (Network Manager with Repeater & Hotspot)! This plugin provides a status bar widget and management panel for Wi-Fi, Ethernet, Hotspot, Repeater, and DNS switching on the Omarchy Quattro Linux desktop shell.

Because this plugin interacts directly with the Linux networking stack, system daemons, and user credentials, contributor safety and software reliability are paramount. This guide outlines the project's security model, development standards, and pull request expectations to make contributing transparent, safe, and straightforward.

---

## Important Runtime Security Model

Omarchy Quattro plugins operate under a direct-execution runtime model:
- **Plugins run unsandboxed**: Plugins execute directly on the host with the standard privileges of the logged-in desktop user.
- **Shared shell process**: Plugin QML components run inside the long-running Omarchy shell process (`quickshell`). An unhandled crash or blocking operation in a plugin freezes or crashes the user's entire desktop shell.
- **User permissions**: Plugin processes, scripts, and file access have full access to user files and user-level permissions.
- **High-impact operations**: Every shell command, process invocation, filesystem write, NetworkManager call, external dependency, and PolicyKit privilege escalation must be treated as security-sensitive.
- **Single shell process constraint**: Never start a second `quickshell` process from a plugin. All UI components must integrate into the existing shell instance.

> [!NOTE]
> The Omarchy marketplace validates plugin package integrity and manifest structure, not plugin security. Contributors and maintainers share responsibility for keeping code, dependencies, and system interactions safe. This contributing guide establishes development expectations, but is not an automated security boundary.

---

## Before You Start

1. **Work from a fork or feature branch**: Clone your fork locally and create a dedicated feature branch for your change.
2. **Keep development copies user-owned**: Test plugins in user-owned directories (such as `~/.config/omarchy/plugins/community.network/` or a local development workspace). Never require root permissions for development copies.
3. **Do not modify packaged system files**: Never edit or overwrite Omarchy core files in `/usr/share/omarchy/`.
4. **Understand the critical path**: Core networking functions (NetworkManager connections, Wi-Fi scanning, hotspot startup, repeater routing, and DNS switching) form the critical path. Optional metadata (client hostnames, signal metrics, transfer rates) must remain decoupled so metadata failures never interrupt networking.
5. **Keep pull requests focused**: Do not bundle unrelated refactoring, cosmetic restyling, or dependency changes into functional bug fixes or features.

---

## Security Rules

All contributions must follow these non-negotiable security requirements:

### 1. Secret Protection & Process `argv`
- **Never commit credentials**: Never commit passwords, private keys, API keys, personal Wi-Fi passphrases, or test tokens.
- **Never expose secrets in `argv`**: Passwords and 802.1X credentials must never be passed as command-line arguments to processes. Command arguments are globally visible to all local users via `/proc/<pid>/cmdline`.
- **Use safe delivery channels**: Pass secrets over `stdin` streams (e.g. piping into `nmcli connection edit` or `qrencode`), or write them to temporary files with restrictive permissions.
- **Enforce restrictive permissions**: Any temporary directory or configuration file holding credentials must use strict POSIX permissions (`0700` for directories, `0600` for files) before writing sensitive data.

### 2. Privilege Escalation & System Boundaries
- **No root requirement**: The plugin and its development tooling must never run entirely as root.
- **Scope elevated operations narrowly**: If elevated privileges are required (such as PolicyKit execution for `create_ap`), isolate the command to the specific helper needed, justify the requirement in documentation, and run it with finite timeouts.
- **No silent modifications**: Do not modify `/etc/sudoers`, Polkit policy rules, system firewall tables (`iptables`/`nftables`), sysctl kernel settings, or system services without explicit justification and maintainer approval.
- **No silent package installations**: Never automatically trigger package manager installs (`pacman`, `paru`, `yay`, `apt`) in background scripts or normal panel operations.

### 3. Safe Process Lifecycle & Termination
- **No broad process killing**: Never use broad commands like `pkill` or `killall` against generic process names (e.g. `killall dnsmasq` or `pkill bash`), which can terminate unrelated system services.
- **Verify process ownership**: Before terminating a process, explicitly verify:
  1. The PID is strictly numeric.
  2. The process exists in `/proc/$pid`.
  3. The cmdline (`/proc/$pid/cmdline`) matches the specific process started by the plugin.
- **Symlink resistance**: Guard temporary PID and configuration directory paths against symlink traversal attacks (`! -L "$path"`).

### 4. Network and Metadata Safety
- **Preserve existing connections**: Never drop, reconfigure, or overwrite unrelated NetworkManager connections without explicit user direction.
- **Metadata isolation**: Failures in optional client metadata lookups (e.g. `iw station dump` or ARP parsing) must degrade gracefully to empty or fallback values and must never abort active AP routing or disconnect upstream Wi-Fi.
- **No unnecessary surveillance**: Avoid capturing, storing, or transmitting telemetry, client MAC addresses, or network usage data beyond what is needed to display immediate local UI status.

---

## Network and Process Safety

When developing network management logic:
- **Respect radio hardware constraints**: Wi-Fi hardware often shares a single radio between client station and AP mode. Avoid triggering active background Wi-Fi scans or channel hopping while an AP/repeater is broadcasting on a locked channel.
- **Avoid subnet collisions**: When routing DHCP subnets for AP/repeater clients, inspect existing upstream route tables to avoid IP range conflicts (e.g. dynamically fallback if `192.168.12.0/24` is already in use).
- **DNS loopback blackhole prevention**: When passing upstream DNS resolvers to hotspot/repeater DHCP clients, ensure loopback addresses (such as `systemd-resolved`'s `127.0.0.53`) are filtered out and replaced with reachable upstream or fallback nameservers.
- **Command timeouts**: All background child processes and network probes must include finite timeouts to prevent hanging processes from accumulating in the user's session.
- **Cleanup on exit**: Ensure traps (`EXIT`, `HUP`, `INT`, `TERM`) cleanly remove temporary files, directories, and background daemon PIDs created during execution.

---

## QML and UI Guidelines

The user interface is built with Quickshell and Omarchy shell components:
- **UI responsiveness**: The QML thread shares the shell's event loop. Never execute long-running or blocking synchronous operations on the main thread.
- **Preserve panel lifecycle**: Panels must handle rapid open, close, and `Escape` dismissal cleanly. Timers and active polling scripts should pause when the panel is closed.
- **Keyboard navigation**: All interactive controls, dialogs, and input forms should be navigable using Arrow keys or Vim keys (`h`/`j`/`k`/`l`), `Tab`/`Shift+Tab`, and `Enter`.
- **Form design**: Input fields for credentials should support standard visibility toggles, clear placeholder hints, and validation feedback.
- **Theme integration**: Use Omarchy theme tokens (`Style`, `Color`, `root.bar.foreground`, etc.) rather than hardcoding arbitrary color hex codes or fonts.
- **Visual evidence**: For PRs introducing noticeable visual or layout changes, attach clear before-and-after screenshots to the PR description.

---

## Validation Before Opening a PR

Before submitting a pull request, run the official validation tools against your local repository:

### 1. Validate Plugin Structure & Manifest
Ensure the plugin directory conforms to the official Omarchy Quattro specification:

```bash
omarchy plugin validate .
```

### 2. Lint QML Code
Check modified QML files against the installed Omarchy shell import environment:

```bash
qmllint -I "$OMARCHY_PATH/shell" Panel.qml
```

*(If `$OMARCHY_PATH` is not explicitly exported in your shell environment, use `/usr/share/omarchy/shell`)*:

```bash
qmllint -I /usr/share/omarchy/shell Panel.qml
```

### 3. Run Repository Tests
If test scripts exist in the repository for the modified component, execute them and ensure all assertions pass without error.

### 4. Lifecycle & Runtime Verification
Deploy your branch to your local plugin directory (`~/.config/omarchy/plugins/community.network/`) and verify:
- [ ] Panel opens smoothly when clicked and closes on click-away or `Escape`.
- [ ] Hotspot toggles on and off reliably without hanging.
- [ ] Plugin can be disabled and re-enabled cleanly via `omarchy plugin disable community.network` / `enable`.
- [ ] Shell restarts cleanly (`omarchy restart shell`) without orphan child processes.
- [ ] Safe removal: uninstalling the plugin does not leave orphaned root services or broken network states.

---

## Dependencies and Privileges

We strive to keep `community.network` lightweight and native to standard Linux distributions:
- **Prefer native tooling**: Always prefer `nmcli`, `ip`, and standard Linux wireless utilities over introducing third-party packages or daemons.
- **Document all requirements**: If your contribution requires an external package or utility, you must:
  1. Clearly state the dependency name and package in `README.md`.
  2. Categorize it as required or optional (`optdepends`).
  3. Explain why the dependency is necessary and why existing tools are insufficient.
  4. Document any PolicyKit or permission boundaries required to run it.

---

## Testing Network Features

When making changes to network routing, hotspot, or interface code:
- **Hotspot changes**: Verify that the AP broadcasts the configured SSID, associates clients, assigns IP addresses via DHCP, and resolves DNS queries.
- **Repeater changes**: Verify simultaneous client-mode upstream internet access alongside AP broadcast on compatible hardware, including reconnect recovery if upstream connection drops.
- **Ethernet changes**: Test switching between DHCP and static manual configurations, ensuring gateway and CIDR validation reject malformed input.
- **DNS changes**: Test switching between providers (Cloudflare, Google, DHCP, Custom) and verify DNS resolution restores correctly upon disconnect.
- **Stale process recovery**: Verify that starting an AP when a previous instance died abruptly recovers cleanly without port conflicts (e.g. port 67 bind failures).
- **Safety first**: Never conduct tests that could permanently corrupt your host's network routing configuration or leave administrative backdoors.

---

## Pull Request Expectations

To help maintainers review and merge your contribution quickly, please ensure your PR description includes:

1. **Summary of changes**: A concise description of what was changed and the problem it solves.
2. **Rationale**: Why this approach was chosen and any architectural considerations.
3. **Behavioral impact**: A list of affected network modes (Wi-Fi, Hotspot, Repeater, Ethernet, DNS).
4. **Dependencies**: Any new packages or utilities required.
5. **Privileges**: Any elevated permissions or PolicyKit actions used.
6. **Validation output**: Proof that `omarchy plugin validate .` and `qmllint` were executed and passed.
7. **Screenshots**: Before-and-after screenshots for any user-facing UI modifications.
8. **Known limitations**: Document any edge cases, untested hardware drivers, or regulatory restrictions (e.g. 5GHz DFS/no-IR constraints).

---

## Security Review Checklist

Before submitting your PR, review your code against this final checklist:

- [ ] **No committed secrets**: No passwords, tokens, private keys, or credentials in commits or test files.
- [ ] **No secrets in `argv`**: Sensitive data is passed via `stdin` or restricted temporary files, not process arguments.
- [ ] **Protected file permissions**: Sensitive temporary files use `0600` permissions and directories use `0700`.
- [ ] **No broad process kills**: No use of `killall` or `pkill` without verified PID, owner, and cmdline checks.
- [ ] **Resource cleanup**: All child processes, temporary directories, and network virtual interfaces are cleaned up on shutdown.
- [ ] **Finite timeouts**: All spawned subprocesses, network probes, and external scripts have bounded execution limits.
- [ ] **Scoped privileges**: Elevated permissions are minimal, explicitly prompted via PolicyKit, and never run full scripts as root.
- [ ] **Single Quickshell instance**: No second `quickshell` process is spawned.
- [ ] **No system tampering**: No unauthorized changes to `/etc/sudoers`, Polkit files, system firewall rules, or kernel parameters.
- [ ] **Reversible operations**: Any network changes made by the plugin can be cleanly reverted by the user.
- [ ] **Validated**: `omarchy plugin validate .` and `qmllint` have run successfully with zero errors.

---

## Responsible Disclosure

If you discover a security vulnerability in `community.network`:
- **Do not open a public issue**: Please do not file public GitHub issues or disclose vulnerability details publicly before maintainers have had an opportunity to address it.
- **Private reporting**: Submit a vulnerability report using GitHub's **Private Vulnerability Reporting** feature on this repository (`Security` > `Advisories` > `Report a vulnerability`).
- If GitHub Private Vulnerability Reporting is unavailable, contact the project maintainer privately via the contact information listed on the maintainer's GitHub profile.

---

## License

By contributing to `community.network`, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
