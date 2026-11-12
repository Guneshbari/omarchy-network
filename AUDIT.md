What this repo does: This plugin adds network controls to the Omarchy desktop. It manages Wi-Fi, Ethernet settings, DNS, hotspots, repeaters, QR sharing, and WireGuard connections.

Load assumed: One desktop user, with a widget potentially instantiated on more than one monitor. Normal saved connection lists, a Wi-Fi display capped at 150 rows, and a synthetic stress check with 40 WireGuard configurations. This is desktop software; avoiding background work and blocking the shared shell matters more than server throughput.

The findings below describe the code at the start of this review. All listed fixes were applied. Tests use fake networking commands for changes; measurements use read-only queries.

## Must fix

1. **Duplicate profile names can change the wrong connection** (`Model.js`, wired and hotspot query/apply scripts; `Panel.qml`, apply callers).
   - **What this is:** NetworkManager permits several saved profiles to share a display name.
   - **Problem:** The scripts first found a profile's UUID, then looked it up again by name. Two Ethernet or hotspot profiles named alike could select a different profile for reading or writing.
   - **Fix:** Carry the UUID, a unique connection identifier, from query through Apply. Check its connection type before changing settings. Give new profiles an explicit new UUID. QR profile reads also keep the selected UUID.
   - **If we skip it:** Applying settings can modify another saved connection. Duplicate-name and wrong-type regression tests now cover both wired and hotspot paths.

2. **Failed network actions can appear successful** (`Model.js`, wired activation and hotspot save/stop scripts).
   - **What this is:** The panel uses a command's exit status to show whether an action worked.
   - **Problem:** Wired activation, hotspot modification, and hotspot stop commands discarded failures with `|| true`. A failed activation or denied stop could produce an “Applied” message or clear the panel's error state.
   - **Fix:** Return an error for these failures. A wired activation error explicitly says the settings were saved but activation failed. Stopping a repeater still works when its saved NetworkManager profile has disappeared.
   - **If we skip it:** Users cannot trust the panel's success message. Tests now cover failed activation, modification, and hotspot stop.

3. **Clipboard copying never signals that its input is complete** (`Panel.qml`, `clipboardProc` and `copyToClipboard`).
   - **What this is:** The panel sends an IP address or password to `wl-copy` through a private input stream.
   - **Problem:** It wrote the text but left the stream open. `wl-copy` can wait for the end of the stream instead of publishing the clipboard content.
   - **Fix:** Close the input after writing, reopen it before each new process, and reject overlapping writes while the previous request is starting. This follows the installed Process API; see the [Quickshell Process documentation](https://quickshell.org/docs/v0.3.0/types/Quickshell.Io/Process/).
   - **If we skip it:** Copy buttons can hang or fail to update the clipboard. The regression test exercises the actual QML handler and its channel lifecycle.

4. **Closing the panel can leave a hotspot password in memory again** (`Panel.qml`, `updateHotspot`).
   - **What this is:** Closing the panel clears password fields, but a status query may still be finishing.
   - **Problem:** A query started just before closing could write the password back into the panel after cleanup.
   - **Fix:** Keep the returned password only while the Network tab or its QR overlay needs it. The test delivers a late response after closing and checks both password fields remain empty.
   - **If we skip it:** Passwords can outlive the UI that requested them.

5. **Dashed WireGuard interface names are handled incorrectly** (`WireGuard.py`, `quick_unit` and `quick_interface`).
   - **What this is:** A configuration such as `wg-office.conf` normally belongs to `wg-quick@wg-office.service`.
   - **Problem:** Path-style systemd escaping changed the dash or decoded it as a path separator. The installed WireGuard service passes the instance name directly to `wg-quick` with `%i`.
   - **Fix:** Preserve valid WireGuard interface names verbatim and validate the service prefix, suffix, and interface name. Tests cover dashed names and reject path-shaped or unrelated service names.
   - **If we skip it:** Existing dashed instances disappear from the list or use the wrong service name.

## Should fix

6. **The hidden Network tab keeps polling and scanning** (`Panel.qml`, tab switching, refresh, scanner ownership, and timers).
   - **What this is:** The Network tab polls connection details and hotspot metadata every two seconds and Wi-Fi band metadata every four seconds.
   - **Problem:** Those timers kept running while the WireGuard tab was visible. Wi-Fi discovery and the hidden connection-label animation also continued.
   - **Fix:** Gate Network-tab work on its visibility, release its scanner when switching away, and refresh it immediately when switching back. WireGuard-only refresh no longer starts unrelated queries. Bar connection changes still receive their existing updates.
   - **If we skip it:** WireGuard use continues paying for up to 75 unrelated polling invocations per minute, plus their child commands and Wi-Fi discovery. A test exercises the actual refresh function with the Network tab hidden.

7. **Hotspot checks start a search process for every policy file** (`Model.js`, `hotspotQueryScript`).
   - **What this is:** The plugin checks installed authorization policies for an unsafe repeater package.
   - **Problem:** It started a separate `grep` process for each policy file on every hotspot poll.
   - **Fix:** Search all files in one command, then inspect only matching files. Keep the same policy check and safe handling of filenames.
   - **If we skip it:** The desktop repeatedly starts avoidable processes. The measured original query launched 44 searches; the first optimized version launched five. Final hotspot queries measured about 36% faster on this machine.

8. **WireGuard discovery starts extra commands for every tunnel** (`WireGuard.py`, service-name handling and discovery).
   - **What this is:** The helper lists both NetworkManager connections and wg-quick services/configurations.
   - **Problem:** Each configuration launched a command to encode its name, then each service launched another to decode it. Also, failure to list unit files prevented the independent loaded-service query from running.
   - **Fix:** Validate the already usable instance names locally. Keep the three bulk queries and handle each systemd query's failure independently.
   - **If we skip it:** Refresh time grows with the tunnel count, and one failed query hides usable data. Forty synthetic configurations required 83 child commands before this change and three afterward; measured elapsed time fell from 187 ms to 17 ms. Both runs found the same 42 rows, including this machine's two existing profiles.

9. **Unchanged status responses rebuild UI lists** (`Model.js`, `stableRows`; `Panel.qml`, Wi-Fi, WireGuard, warning, and client models).
   - **What this is:** List models control the visible connection rows and their buttons.
   - **Problem:** Polling assigned fresh arrays even when the content was identical. This made Qt discard and rebuild delegates, the objects that draw each row, and could disturb list position or hover state.
   - **Fix:** Reuse the previous array when its primitive data is unchanged. Replace it when a name, signal, state, or list member changes.
   - **If we skip it:** Idle polling keeps causing UI work. Tests check that unchanged results preserve the model and changed results still replace it.

10. **Read-only shell queries have no overall deadline** (`Panel.qml`, wired and hotspot query processes).
    - **What this is:** The panel launches shell scripts to query NetworkManager and hardware metadata.
    - **Problem:** A hung child command could keep the query running indefinitely. The process guard then prevented all future refreshes for that section.
    - **Fix:** Give each read-only query a ten-second overall timeout. Keep action authorization and the repeater's long-lived process behavior separate.
    - **If we skip it:** A transient backend hang can leave a section permanently stale until the shell restarts.

11. **Wired settings repeat the same profile lookup** (`Model.js`, `wiredQueryScript`).
    - **What this is:** The wired panel reads the IPv4 method, addresses, gateway, and DNS fields.
    - **Problem:** It checked the profile and started four separate field queries.
    - **Fix:** Read all four fields in one `nmcli` call using the selected UUID. The test checks both the returned settings and the single bulk read.
    - **If we skip it:** Each refresh repeats avoidable work. The final median read time dropped from 112 ms to 74 ms, about 34%, over five runs per version.

## Nice to have

12. **Query errors can remain visible after recovery** (`Panel.qml`, WireGuard query handling; `WireGuardTab.qml`).
    - **What this is:** Status-query failures and Connect/Disconnect failures were shown through the same field.
    - **Problem:** A temporary status error survived later successful queries. Conversely, indiscriminately clearing that field would erase an action failure immediately after refreshing.
    - **Fix:** Keep query errors with the query process, clear them after a successful response, and preserve action errors separately. Do not show “No configured connections” alongside a query error.
    - **If we skip it:** The panel can show a failure after the backend has recovered, or lose the useful reason an action failed.

13. **Unused state and a gap in validation add maintenance work** (`Panel.qml`, `scripts/validate.sh`, `tests/`).
    - **What this is:** The panel had an unused `headerHasDisconnect` flag, and validation scanned tracked files only.
    - **Problem:** The flag had no caller anywhere in the tree. Newly added helper files were excluded from the safety scan until staged in Git. The original tests covered WireGuard but not the modified wired/hotspot scripts or QML refresh lifecycle.
    - **Fix:** Remove the flag, scan tracked and untracked non-ignored files, and run the new JavaScript and Python regression suites from the standard validator.
    - **If we skip it:** Dead state persists and newly added code can miss the checks developers expect. Validation now passes 27 Python tests and eight JavaScript tests, plus plugin validation, QML lint, JavaScript syntax, Bash syntax, and the safety scan.

Verdict: The measured polling work is smaller, and the fixes protect profile selection and failure reporting. All findings above have been addressed without adding packages.

Lean: -1 lines, -0 dependencies possible. The unused flag was removed. Added tests and checks increase the total line count deliberately; no framework or persistent cache was introduced.

Not checked: Real Connect/Disconnect, wired reconfiguration, hotspot broadcasting, privileged repeater installation, firewall changes, and driver/regulatory behavior were not exercised on the user's live network. Their changed paths were checked with fake commands and Bash syntax checks. No multi-monitor hardware stress test was run. I traced the functional and credential paths, but did not manually review every decorative QML layout line. Timings describe this machine and are not a universal speed guarantee.
