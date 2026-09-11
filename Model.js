function parseNetworkStatus(raw) {
  var parts = String(raw || "disconnected\t\t\t").replace(/\r?\n+$/, "").split("\t")
  return {
    kind: parts[0] || "disconnected",
    label: parts[1] || "",
    signalStrength: parts[2] ? parseInt(parts[2], 10) : -1,
    frequency: parts[3] || ""
  }
}

function wifiIconFor(strength) {
  var icons = ["󰤯", "󰤟", "󰤢", "󰤥", "󰤨"]
  var index = Math.max(0, Math.min(4, Math.ceil(strength / 20) - 1))
  return icons[index]
}

function connectionIcon(kind, signalStrength) {
  if (kind === "wifi") return wifiIconFor(signalStrength)
  if (kind === "ethernet") return "󰈀"
  return "󰤮"
}

function formatHeaderSpeed(mbps) {
  var v = parseInt(mbps, 10)
  if (!v || v < 0) return ""
  if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "gbit"
  return v + "mbit"
}

function formatHeaderFreq(mhz) {
  var v = parseFloat(mhz)
  if (!v) return ""

  if (v >= 2400 && v < 2500) return "2.4ghz"
  if (v >= 4900 && v < 5925) return "5ghz"
  if (v >= 5925 && v < 7125) return "6ghz"
  if (v >= 57000 && v < 71000) return "60ghz"

  var ghz = v / 1000
  return ghz.toFixed(ghz % 1 === 0 ? 0 : 1) + "ghz"
}

// Wi-Fi band state belongs in the selector section, not beside the hero name.
// Ethernet has no equivalent selector, so keep its negotiated link speed here.
function headerDetail(info) {
  var value = info || {}
  if (value.type === "ethernet") return formatHeaderSpeed(value.speed || "")
  return ""
}

function bandLabel(band) {
  if (band === "auto") return "Auto"
  if (!band) return ""
  return band + "ghz"
}

// Under Automatic the pills are hidden, so the header carries the live band
// instead -- "WI-FI BAND: 2.4GHZ". Once a band is pinned the pills are on
// screen and say it themselves, so the header drops back to a plain label.
function bandSectionTitle(selected, current) {
  if (selected !== "auto") return "WI-FI BAND"

  var label = bandLabel(current)
  if (label === "") return "WI-FI BAND"

  return "WI-FI BAND: " + label.toUpperCase()
}

function bandTooltip(band) {
  if (band === "auto") return "Let Wi-Fi pick the band"
  if (!band) return ""
  return "Stay on " + bandLabel(band)
}

function parseBandStatus(raw) {
  var next = parseKeyValue(raw)
  var tokens = String(next.available || "").split(" ")
  var available = []

  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "") available.push(tokens[i])
  }

  return {
    band: next.band || "",
    selected: next.selected || "auto",
    available: available
  }
}

function decodeIwSsid(value) {
  var raw = String(value || "")

  try {
    var encoded = ""

    for (var i = 0; i < raw.length; i++) {
      if (raw[i] === "\\" && raw[i + 1] === "x" && /^[0-9a-f]{2}$/i.test(raw.substring(i + 2, i + 4))) {
        var hex = raw.substring(i + 2, i + 4)
        var byte = parseInt(hex, 16)
        encoded += byte < 32 || byte === 127 ? encodeURIComponent(raw.substring(i, i + 4)) : "%" + hex
        i += 3
      } else {
        encoded += encodeURIComponent(raw[i])
      }
    }

    return decodeURIComponent(encoded)
  } catch (error) {
    return raw
  }
}

function parseKeyValue(raw) {
  var next = {}
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (!line) continue
    var idx = line.indexOf("\t")
    if (idx === -1) continue
    var key = line.substring(0, idx)
    var value = line.substring(idx + 1)
    next[key] = key === "ssid" ? decodeIwSsid(value) : value.trim()
  }
  return next
}

function throughputState(previous, next, now) {
  var prev = previous || {}
  var sample = next || {}
  var iface = sample.iface || ""
  var rx = parseFloat(sample.rx_bytes || "0")
  var tx = parseFloat(sample.tx_bytes || "0")
  var previousTime = Number(prev.prevSampleTime || 0)

  if (iface !== (prev.prevIface || "") || previousTime === 0) {
    return {
      prevIface: iface,
      prevRxBytes: rx,
      prevTxBytes: tx,
      prevSampleTime: now,
      downloadRate: 0,
      uploadRate: 0
    }
  }

  var downloadRate = Number(prev.downloadRate || 0)
  var uploadRate = Number(prev.uploadRate || 0)
  var dt = now - previousTime
  if (dt > 0) {
    downloadRate = Math.max(0, (rx - Number(prev.prevRxBytes || 0)) / dt)
    uploadRate = Math.max(0, (tx - Number(prev.prevTxBytes || 0)) / dt)
  }

  return {
    prevIface: iface,
    prevRxBytes: rx,
    prevTxBytes: tx,
    prevSampleTime: now,
    downloadRate: downloadRate,
    uploadRate: uploadRate
  }
}

function pingSampleValue(raw) {
  var value = parseFloat(raw)
  if (!isFinite(value) || value < 0) return null
  return value
}

function appendPingSample(samples, raw, limit) {
  var values = Array.isArray(samples) ? samples.slice() : []

  values.push(pingSampleValue(raw))
  while (values.length > limit) values.shift()

  return values
}

function averagePingLatency(samples, limit) {
  var values = Array.isArray(samples) ? samples : []
  var sampleLimit = Math.max(1, parseInt(limit, 10) || values.length || 1)
  var total = 0
  var count = 0

  for (var i = Math.max(0, values.length - sampleLimit); i < values.length; i++) {
    var value = values[i]
    if (typeof value !== "number" || !isFinite(value) || value < 0) continue
    total += value
    count++
  }

  return count > 0 ? total / count : -1
}

function pingPacketLossPercent(samples) {
  var values = Array.isArray(samples) ? samples : []
  if (values.length === 0) return 0

  var lost = 0
  for (var i = 0; i < values.length; i++) {
    if (values[i] === null) lost++
  }

  return Math.round((lost / values.length) * 100)
}

function formatPacketLoss(percent, hasSamples) {
  if (hasSamples === false) return "--"

  var value = parseInt(percent, 10)
  if (!value || value < 0) return "0%"
  return value + "%"
}

function pingLatencyState(previous, next, limit, averageLimit) {
  var prev = previous || {}
  var sample = next || {}
  var iface = sample.iface || ""
  var window = Math.max(1, parseInt(limit, 10) || 5)
  var averageWindow = Math.max(1, parseInt(averageLimit, 10) || window)
  var reset = iface === "" || iface !== (prev.pingIface || "")
  var routerSamples = reset ? [] : prev.routerPingSamples
  var internetSamples = reset ? [] : prev.internetPingSamples

  routerSamples = sample.router_ping_ms === undefined ? [] : appendPingSample(routerSamples, sample.router_ping_ms, window)
  internetSamples = sample.internet_ping_ms === undefined ? [] : appendPingSample(internetSamples, sample.internet_ping_ms, window)

  return {
    pingIface: iface,
    routerPingSamples: routerSamples,
    internetPingSamples: internetSamples,
    routerPingLatency: averagePingLatency(routerSamples, averageWindow),
    internetPingLatency: averagePingLatency(internetSamples, averageWindow),
    internetPingPacketLoss: pingPacketLossPercent(internetSamples)
  }
}

function formatBytes(bytes) {
  var n = Number(bytes)
  if (!isFinite(n) || n < 0) n = 0
  if (n < 1024) return Math.round(n) + " B"
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB"
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB"
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB"
}

function formatRate(bytesPerSec) {
  return formatBytes(bytesPerSec) + "/s"
}

// `hasSamples` false means no probe has come back yet, which is different from
// a probe that timed out. The rows stay mounted through that gap and read "--"
// so the grid doesn't reflow a second after the panel opens.
function formatPingLatency(ms, hasSamples) {
  if (hasSamples === false) return "--"

  var value = parseFloat(ms)
  if (!isFinite(value) || value < 0) return "Timeout"
  return value.toFixed(value > 0 && value < 10 ? 1 : 0) + " ms"
}

function wifiRow(network) {
  if (!network) return null
  // Primitives only: rows become list-model data, so a WifiNetwork here puts a
  // live QObject wrapper in every delegate's var property. NetworkManager churn
  // (scans, AP removals) can destroy the object while a delegate is still
  // incubating, which segfaults quickshell in wrap_slowPath on the dangling
  // wrapper. Callers that need the object resolve it via networkForSsid().
  return {
    connected: !!network.connected,
    known: !!network.known,
    ssid: network.name || "",
    signal: Math.round((network.signalStrength || 0) * 100),
    security: network.security
  }
}

function sortWifiRows(rows) {
  var nets = Array.isArray(rows) ? rows.slice() : []
  nets.sort(function(a, b) {
    if (a.connected !== b.connected) return a.connected ? -1 : 1
    if (a.known !== b.known) return a.known ? -1 : 1
    return b.signal - a.signal
  })
  return nets
}

function wifiSectionTitle(wifiNetworks, index) {
  var networks = Array.isArray(wifiNetworks) ? wifiNetworks : []
  if (index < 0 || index >= networks.length) return ""

  var net = networks[index]
  if (!net) return ""

  if (net.known && index === 0) return "KNOWN NETWORKS"
  if (!net.known && (index === 0 || (networks[index - 1] && networks[index - 1].known))) return "OTHER NETWORKS"
  return ""
}

// OWE (Enhanced Open) encrypts traffic without authenticating the user, so it
// has no credentials to collect. The panel's lock is a credentials-required
// affordance, so OWE should neither show it nor open its attached prompt.
function requiresCredentials(security, openSecurity, oweSecurity) {
  // Only explicit passwordless types bypass the prompt. Unknown security
  // stays credentialed as the conservative fallback.
  return security !== openSecurity && security !== oweSecurity
}

function canForgetNetwork(network) {
  return !!(network && network.known && !network.connected)
}

// The password arrives on stdin and reaches nmcli through the scriptable
// `connection edit` editor -- argv is world-readable in /proc, so the secret
// must never be an argument (printf is a bash builtin, so no process spawns
// with it either).
var enterpriseConnectScript =
  "u=$(uuidgen); IFS= read -r pw;" +
  " nmcli connection add type wifi con-name \"$1\" ssid \"$1\" connection.uuid \"$u\"" +
  " wifi-sec.key-mgmt wpa-eap 802-1x.eap peap 802-1x.phase2-auth mschapv2" +
  " 802-1x.identity \"$2\" 802-1x.auth-timeout 8 >/dev/null" +
  " && printf 'set 802-1x.password %s\\nsave\\nquit\\n' \"$pw\" | nmcli connection edit uuid \"$u\" >/dev/null" +
  " && nmcli connection up uuid \"$u\"" +
  " || { nmcli connection delete uuid \"$u\" >/dev/null 2>&1; false; }"

function networkFailureReason(reason, needsCredentials, reasons) {
  var r = reasons || {}
  if (needsCredentials && reason === r.NoSecrets) return "Passphrase required"
  if (needsCredentials && reason === r.WifiAuthTimeout) return "Wrong password"
  if (reason === r.WifiNetworkLost) return "Network lost"
  if (reason === r.WifiClientDisconnected) return "Disconnected"
  if (reason === r.WifiClientFailed) return "Connection failed"
  return "Failed to connect"
}

// Whether a failed connect should reopen the passphrase prompt. NoSecrets
// means credentials are missing only for a network that actually uses them.
// An auth timeout on such a network means the saved passphrase is wrong (the
// same profile a first failed attempt leaves behind as "known"), so the user
// needs a chance to re-enter it -- connectWithPsk overwrites the stored PSK on
// submit.
function shouldRepromptPassphrase(reason, needsCredentials, reasons) {
  var r = reasons || {}
  if (!needsCredentials) return false
  return reason === r.NoSecrets || reason === r.WifiAuthTimeout
}

var wiredQueryScript =
  'con=$(nmcli -t -f NAME,TYPE connection show 2>/dev/null | grep ":802-3-ethernet" | head -1 | cut -d: -f1); ' +
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | grep ":ethernet" | head -1 | cut -d: -f1); ' +
  'if [[ -z "$con" && -n "$dev" ]]; then con="Wired connection 1"; fi; ' +
  'if [[ -n "$con" ]]; then ' +
  '  if nmcli connection show "$con" >/dev/null 2>&1; then ' +
  '    method=$(nmcli -t -f ipv4.method connection show "$con" 2>/dev/null | cut -d: -f2); ' +
  '    addr=$(nmcli -t -f ipv4.addresses connection show "$con" 2>/dev/null | cut -d: -f2); ' +
  '    gw=$(nmcli -t -f ipv4.gateway connection show "$con" 2>/dev/null | cut -d: -f2); ' +
  '    dns=$(nmcli -t -f ipv4.dns connection show "$con" 2>/dev/null | cut -d: -f2); ' +
  '  else ' +
  '    method="auto"; addr=""; gw=""; dns=""; ' +
  '  fi; ' +
  '  jq -nc --arg con "$con" --arg dev "${dev:-}" --arg method "${method:-auto}" --arg addr "${addr:-}" --arg gw "${gw:-}" --arg dns "${dns:-}" ' +
  '    "{\\"name\\": \\$con, \\\"device\\\": \\$dev, \\\"method\\\": \\$method, \\\"addresses\\\": \\$addr, \\\"gateway\\\": \\$gw, \\\"dns\\\": \\$dns}"; ' +
  'else ' +
  '  echo "{}"; ' +
  'fi'

var wiredApplyScript =
  'con="$1"; method="$2"; addr="$3"; gw="$4"; dns="$5"; ' +
  'if ! nmcli connection show "$con" >/dev/null 2>&1; then ' +
  '  dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2 == "ethernet" { print $1; exit }\'); ' +
  '  nmcli connection add type ethernet con-name "$con" ${dev:+ifname "$dev"} >/dev/null 2>&1; ' +
  'fi; ' +
  'if [[ "$method" == "manual" ]]; then ' +
  '  if [[ "$addr" != */* && -n "$addr" ]]; then addr="${addr}/24"; fi; ' +
  '  nmcli connection modify "$con" ipv4.method manual ipv4.addresses "$addr" ipv4.gateway "${gw:-}" ipv4.dns "${dns:-}"; ' +
  'else ' +
  '  nmcli connection modify "$con" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns ""; ' +
  'fi; ' +
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2 == "ethernet" { print $1; exit }\'); ' +
  'if [[ -n "$dev" ]]; then ' +
  '  nmcli device reapply "$dev" 2>/dev/null || nmcli connection up "$con" 2>/dev/null || true; ' +
  'else ' +
  '  nmcli connection up "$con" 2>/dev/null || true; ' +
  'fi'

var hotspotQueryScript =
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2=="wifi"{print $1; exit}\'); ' +
  'has_ap="false"; ' +
  'if [[ -n "$dev" ]] && iw list 2>/dev/null | grep -A 8 "Supported interface modes" | grep -q "AP"; then has_ap="true"; fi; ' +
  'has_create_ap="false"; ' +
  'if command -v create_ap >/dev/null 2>&1; then has_create_ap="true"; fi; ' +
  'wifi_connected="false"; ' +
  'if [[ -n "$dev" ]] && nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep -q "^${dev}:connected"; then wifi_connected="true"; fi; ' +
  'repeater_capable="false"; ' +
  'if [[ "$has_create_ap" == "true" && "$wifi_connected" == "true" && -n "$dev" ]]; then ' +
  '  freq=$(iw dev "$dev" link 2>/dev/null | grep -i "freq:" | awk \'{print $2}\' | cut -d. -f1); ' +
  '  if [[ -n "$freq" ]]; then ' +
  '    phy=$(cat /sys/class/net/"$dev"/phy80211/name 2>/dev/null || echo "phy0"); ' +
  '    ch_info=$(iw phy "$phy" info 2>/dev/null | grep -E "\\* ${freq}\\.[0-9]+ MHz"); ' +
  '    if [[ "$ch_info" != *"no IR"* ]]; then repeater_capable="true"; fi; ' +
  '  fi; ' +
  'fi; ' +
  'cap_running="false"; cap_ssid=""; cap_pwd=""; cap_band="bg"; cap_clients=0; ' +
  'for d in /tmp/create_ap.*.conf.*; do ' +
  '  if [[ -d "$d" && -f "$d/pid" ]]; then ' +
  '    pid=$(cat "$d/pid" 2>/dev/null); ' +
  '    if [[ -n "$pid" && -d "/proc/$pid" ]] && grep -q "create_ap" "/proc/$pid/cmdline" 2>/dev/null; then ' +
  '      cap_running="true"; ' +
  '      viface=$(cat "$d/wifi_iface" 2>/dev/null); ' +
  '      if [[ -n "$viface" && -d "/sys/class/net/$viface" ]]; then ' +
  '        info_ssid=$(iw dev "$viface" info 2>/dev/null | sed -n \'s/^[[:space:]]*ssid[[:space:]]\\+//p\'); ' +
  '        if [[ -n "$info_ssid" ]]; then cap_ssid="$info_ssid"; fi; ' +
  '        cap_freq=$(iw dev "$viface" info 2>/dev/null | grep -o \'([0-9]\\+ MHz)\' | tr -d \'() MHz\'); ' +
  '        if [[ -n "$cap_freq" && "$cap_freq" -gt 5000 ]]; then cap_band="a"; else cap_band="bg"; fi; ' +
  '        cap_clients=$(iw dev "$viface" station dump 2>/dev/null | awk \'/^Station /{c++} END{print c+0}\'); ' +
  '      fi; ' +
  '      break; ' +
  '    fi; ' +
  '  fi; ' +
  'done; ' +
  'con=""; ' +
  'for uuid in $(nmcli -t -f UUID,TYPE con show 2>/dev/null | awk -F: \'$2=="802-11-wireless"{print $1}\'); do ' +
  '  mode=$(nmcli -g 802-11-wireless.mode con show "$uuid" 2>/dev/null); ' +
  '  if [[ "$mode" == "ap" ]]; then con=$(nmcli -g connection.id con show "$uuid" 2>/dev/null); break; fi; ' +
  'done; ' +
  'if [[ -z "$con" ]]; then con="Hotspot"; fi; ' +
  'nm_active="false"; nm_ssid=""; nm_pwd=""; nm_band=""; ' +
  'if nmcli connection show "$con" >/dev/null 2>&1; then ' +
  '  nm_ssid=$(nmcli -s -g 802-11-wireless.ssid connection show "$con" 2>/dev/null); ' +
  '  nm_pwd=$(nmcli -s -g 802-11-wireless-security.psk connection show "$con" 2>/dev/null); ' +
  '  nm_band=$(nmcli -s -g 802-11-wireless.band connection show "$con" 2>/dev/null); ' +
  '  if nmcli -t -f NAME,ACTIVE connection show 2>/dev/null | grep -q "^${con}:yes"; then nm_active="true"; fi; ' +
  'fi; ' +
  'if [[ "$cap_running" == "true" ]]; then ' +
  '  active="true"; is_repeater="true"; ssid="${cap_ssid:-$nm_ssid}"; pwd="${nm_pwd:-$cap_pwd}"; band="$cap_band"; clients="$cap_clients"; ' +
  'elif [[ "$nm_active" == "true" ]]; then ' +
  '  active="true"; is_repeater="false"; ssid="${nm_ssid:-Omarchy-Hotspot}"; pwd="${nm_pwd:-omarchy12345}"; band="${nm_band:-bg}"; ' +
  '  clients=$(iw dev "$dev" station dump 2>/dev/null | awk \'/^Station /{c++} END{print c+0}\'); ' +
  'else ' +
  '  active="false"; is_repeater="false"; ssid="${nm_ssid:-Omarchy-Hotspot}"; pwd="${nm_pwd:-omarchy12345}"; band="${nm_band:-bg}"; clients=0; ' +
  'fi; ' +
  'printf "%s" "${pwd:-omarchy12345}" | jq -Rs --arg con "$con" --arg ssid "${ssid:-Omarchy-Hotspot}" --arg band "${band:-bg}" --argjson active "$active" --arg dev "${dev:-}" --argjson clients "${clients:-0}" --argjson hasAp "$has_ap" --argjson isRepeater "$is_repeater" --argjson hasCreateAp "$has_create_ap" --argjson wifiConnected "$wifi_connected" --argjson repeaterCapable "$repeater_capable" ' +
  '  \'{"name": $con, "ssid": $ssid, "password": ., "band": $band, "active": $active, "device": $dev, "clients": $clients, "hasAp": $hasAp, "isRepeater": $isRepeater, "hasCreateAp": $hasCreateAp, "wifiConnected": $wifiConnected, "repeaterCapable": $repeaterCapable}\''

// The password arrives on stdin and reaches nmcli through the scriptable
// `connection edit` editor or create_ap through a protected temporary config file.
// argv is world-readable in /proc, so the secret must never be an argument
// (printf is a bash builtin, so no process spawns with it either).
var hotspotApplyScript =
  'IFS= read -r pwd; ' +
  'action="$1"; con="$2"; ssid="$3"; band="$4"; ' +
  'if [[ -z "$con" ]]; then con="Hotspot"; fi; ' +
  'if [[ -z "$ssid" ]]; then ssid="Omarchy-Hotspot"; fi; ' +
  'if [[ -z "$pwd" ]]; then pwd="omarchy12345"; fi; ' +
  'if [[ -z "$band" ]]; then band="bg"; fi; ' +
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2=="wifi"{print $1; exit}\'); ' +
  'if [[ "$action" == "save" ]]; then ' +
  '  if ! nmcli connection show "$con" >/dev/null 2>&1; then ' +
  '    nmcli con add type wifi con-name "$con" autoconnect no ssid "$ssid" ' +
  '      802-11-wireless.mode ap 802-11-wireless.band "$band" ' +
  '      802-11-wireless-security.key-mgmt wpa-psk ' +
  '      ipv4.method shared ${dev:+ifname "$dev"} >/dev/null 2>&1 || { echo "Failed to create hotspot connection" >&2; exit 1; }; ' +
  '  else ' +
  '    nmcli con modify "$con" 802-11-wireless.ssid "$ssid" 802-11-wireless.band "$band" >/dev/null 2>&1 || true; ' +
  '  fi; ' +
  '  if ! printf "set 802-11-wireless-security.psk %s\\nsave\\nquit\\n" "$pwd" | nmcli connection edit "$con" >/dev/null 2>&1; then ' +
  '    echo "Failed to configure hotspot password" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  '  exit 0; ' +
  'fi; ' +
  'is_running="false"; running_pid=""; ' +
  'for d in /tmp/create_ap.*.conf.*; do ' +
  '  if [[ -d "$d" && -f "$d/pid" ]]; then ' +
  '    pid=$(cat "$d/pid" 2>/dev/null); ' +
  '    if [[ -n "$pid" && -d "/proc/$pid" ]] && grep -q "create_ap" "/proc/$pid/cmdline" 2>/dev/null; then ' +
  '      is_running="true"; running_pid="$pid"; break; ' +
  '    fi; ' +
  '  fi; ' +
  'done; ' +
  'if [[ "$is_running" == "false" ]] && nmcli -t -f NAME,ACTIVE connection show 2>/dev/null | grep -q "^${con}:yes"; then ' +
  '  is_running="true"; ' +
  'fi; ' +
  'if [[ "$action" == "stop" ]] || [[ "$action" == "toggle" && "$is_running" == "true" ]]; then ' +
  '  if [[ -n "$running_pid" ]]; then ' +
  '    pkexec create_ap --stop "$running_pid" >/dev/null 2>&1 || true; ' +
  '  fi; ' +
  '  for d in /tmp/create_ap.*.conf.*; do ' +
  '    if [[ -d "$d" && -f "$d/pid" ]]; then ' +
  '      p=$(cat "$d/pid" 2>/dev/null); ' +
  '      if [[ -n "$p" && -d "/proc/$p" ]] && grep -q "create_ap" "/proc/$p/cmdline" 2>/dev/null; then ' +
  '        pkexec create_ap --stop "$p" >/dev/null 2>&1 || true; ' +
  '      fi; ' +
  '    fi; ' +
  '  done; ' +
  '  if [[ -n "$dev" ]]; then ' +
  '    for p in $(pgrep -f "create_ap.*$dev" 2>/dev/null); do ' +
  '      pkexec create_ap --stop "$p" >/dev/null 2>&1 || true; ' +
  '    done; ' +
  '  fi; ' +
  '  nmcli con down "$con" >/dev/null 2>&1 || true; ' +
  '  exit 0; ' +
  'fi; ' +
  'wifi_connected="false"; ' +
  'if [[ -n "$dev" ]] && nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep -q "^${dev}:connected"; then ' +
  '  wifi_connected="true"; ' +
  'fi; ' +
  'if [[ "$wifi_connected" == "true" ]]; then ' +
  '  if ! command -v create_ap >/dev/null 2>&1; then ' +
  '    echo "Wi-Fi is connected. Install linux-wifi-hotspot for simultaneous repeater chaining." >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  '  freq=$(iw dev "$dev" link 2>/dev/null | grep -i "freq:" | awk \'{print $2}\' | cut -d. -f1); ' +
  '  if [[ -n "$freq" ]]; then ' +
  '    phy=$(cat /sys/class/net/"$dev"/phy80211/name 2>/dev/null || echo "phy0"); ' +
  '    ch_info=$(iw phy "$phy" info 2>/dev/null | grep -E "\\* ${freq}\\.[0-9]+ MHz"); ' +
  '    if [[ "$ch_info" == *"no IR"* ]]; then ' +
  '      echo "Cannot repeat: current 5GHz Wi-Fi channel is restricted (no-IR) by card firmware. Connect to 2.4GHz Wi-Fi to repeat." >&2; ' +
  '      exit 1; ' +
  '    fi; ' +
  '  fi; ' +
  '  cap_sec_dir=$(mktemp -d /tmp/create_ap_sec.XXXXXX); ' +
  '  chmod 700 "$cap_sec_dir"; ' +
  '  cap_conf="$cap_sec_dir/ap.conf"; ' +
  '  freq_band="2.4"; if [[ "$band" == "a" ]]; then freq_band="5"; fi; ' +
  '  printf "WIFI_IFACE=%s\\nINTERNET_IFACE=%s\\nSSID=%s\\nPASSPHRASE=%s\\nFREQ_BAND=%s\\nDAEMONIZE=1\\n" "$dev" "$dev" "$ssid" "$pwd" "$freq_band" > "$cap_conf"; ' +
  '  chmod 600 "$cap_conf"; ' +
  '  trap \'rm -rf "$cap_sec_dir"\' EXIT HUP INT QUIT TERM; ' +
  '  pkexec create_ap --config "$cap_conf" >/dev/null 2>&1; ' +
  '  for i in {1..14}; do ' +
  '    sleep 0.5; ' +
  '    for d in /tmp/create_ap.*.conf.*; do ' +
  '      if [[ -d "$d" && -f "$d/pid" ]]; then ' +
  '        pid=$(cat "$d/pid" 2>/dev/null); ' +
  '        if [[ -n "$pid" && -d "/proc/$pid" ]] && grep -q "create_ap" "/proc/$pid/cmdline" 2>/dev/null; then ' +
  '          viface=$(cat "$d/wifi_iface" 2>/dev/null); ' +
  '          if [[ -n "$viface" && -d "/sys/class/net/$viface" ]]; then ' +
  '            exit 0; ' +
  '          fi; ' +
  '        fi; ' +
  '      fi; ' +
  '    done; ' +
  '  done; ' +
  '  echo "Failed to start repeater access point" >&2; ' +
  '  exit 1; ' +
  'else ' +
  '  if ! nmcli connection show "$con" >/dev/null 2>&1; then ' +
  '    nmcli con add type wifi con-name "$con" autoconnect no ssid "$ssid" ' +
  '      802-11-wireless.mode ap 802-11-wireless.band "$band" ' +
  '      802-11-wireless-security.key-mgmt wpa-psk ' +
  '      ipv4.method shared ${dev:+ifname "$dev"} >/dev/null 2>&1 || { echo "Failed to create hotspot connection" >&2; exit 1; }; ' +
  '  else ' +
  '    nmcli con modify "$con" 802-11-wireless.ssid "$ssid" 802-11-wireless.band "$band" >/dev/null 2>&1 || true; ' +
  '  fi; ' +
  '  if ! printf "set 802-11-wireless-security.psk %s\\nsave\\nquit\\n" "$pwd" | nmcli connection edit "$con" >/dev/null 2>&1; then ' +
  '    echo "Failed to configure hotspot password" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  '  if ! nmcli con up "$con" >/dev/null 2>&1; then ' +
  '    echo "Failed to start hotspot" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  'fi'

// The password arrives on stdin; argv is world-readable in /proc,
// so secrets must never appear in command line arguments.
var hotspotQrScript =
  'IFS= read -r pwd; ' +
  'ssid="$1"; ' +
  'if [[ -z "$ssid" || -z "$pwd" ]]; then ' +
  '  con=""; ' +
  '  for uuid in $(nmcli -t -f UUID,TYPE con show 2>/dev/null | awk -F: \'$2=="802-11-wireless"{print $1}\'); do ' +
  '    mode=$(nmcli -g 802-11-wireless.mode con show "$uuid" 2>/dev/null); ' +
  '    if [[ "$mode" == "ap" ]]; then con=$(nmcli -g connection.id con show "$uuid" 2>/dev/null); break; fi; ' +
  '  done; ' +
  '  if [[ -z "$con" ]]; then con="Hotspot"; fi; ' +
  '  if [[ -z "$ssid" ]]; then ' +
  '    nm_s=$(nmcli -s -g 802-11-wireless.ssid connection show "$con" 2>/dev/null || true); ' +
  '    ssid="${nm_s:-Omarchy-Hotspot}"; ' +
  '  fi; ' +
  '  if [[ -z "$pwd" ]]; then ' +
  '    nm_p=$(nmcli -s -g 802-11-wireless-security.psk connection show "$con" 2>/dev/null || true); ' +
  '    pwd="$nm_p"; ' +
  '  fi; ' +
  'fi; ' +
  'escape_wifi_qr() { ' +
  '  local value=$1; ' +
  '  value=${value//\\\\/\\\\\\\\}; ' +
  '  value=${value//;/\\\\;}; ' +
  '  value=${value//,/\\\\,}; ' +
  '  value=${value//:/\\\\:}; ' +
  '  printf "%s" "$value"; ' +
  '}; ' +
  'if [[ -n "$pwd" ]]; then ' +
  '  payload="WIFI:T:WPA;S:$(escape_wifi_qr "$ssid");P:$(escape_wifi_qr "$pwd");;"; ' +
  'else ' +
  '  payload="WIFI:T:nopass;S:$(escape_wifi_qr "$ssid");;"; ' +
  'fi; ' +
  'ascii=$(printf "%s" "$payload" | qrencode --type ASCII --margin 4 --output -); ' +
  'while IFS= read -r line; do ' +
  '  row=""; ' +
  '  for ((column = 0; column < ${#line}; column += 2)); do ' +
  '    [[ ${line:column:2} == *#* ]] && row+=1 || row+=0; ' +
  '  done; ' +
  '  printf "%s\\n" "$row"; ' +
  'done <<<"$ascii"'

function parseQrMatrix(raw) {
  var lines = String(raw || "").trim().split(/\r?\n/).filter(function(line) { return line !== "" })
  if (lines.length === 0) return { rows: [], size: 0 }
  var size = lines[0].length
  if (size !== lines.length) return { rows: [], size: 0 }
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].length !== size || !/^[01]+$/.test(lines[i])) return { rows: [], size: 0 }
  }
  return { rows: lines, size: size }
}

if (typeof module !== "undefined") {
  module.exports = {
    hotspotQrScript: hotspotQrScript,
    parseQrMatrix: parseQrMatrix,
    parseNetworkStatus: parseNetworkStatus,
    wifiIconFor: wifiIconFor,
    connectionIcon: connectionIcon,
    formatHeaderSpeed: formatHeaderSpeed,
    formatHeaderFreq: formatHeaderFreq,
    headerDetail: headerDetail,
    bandLabel: bandLabel,
    bandSectionTitle: bandSectionTitle,
    bandTooltip: bandTooltip,
    parseBandStatus: parseBandStatus,
    decodeIwSsid: decodeIwSsid,
    parseKeyValue: parseKeyValue,
    throughputState: throughputState,
    pingLatencyState: pingLatencyState,
    pingPacketLossPercent: pingPacketLossPercent,
    formatPacketLoss: formatPacketLoss,
    formatBytes: formatBytes,
    formatRate: formatRate,
    formatPingLatency: formatPingLatency,
    wifiRow: wifiRow,
    sortWifiRows: sortWifiRows,
    wifiSectionTitle: wifiSectionTitle,
    requiresCredentials: requiresCredentials,
    canForgetNetwork: canForgetNetwork,
    enterpriseConnectScript: enterpriseConnectScript,
    networkFailureReason: networkFailureReason,
    shouldRepromptPassphrase: shouldRepromptPassphrase,
    wiredQueryScript: wiredQueryScript,
    wiredApplyScript: wiredApplyScript,
    hotspotQueryScript: hotspotQueryScript,
    hotspotApplyScript: hotspotApplyScript
  }
}
