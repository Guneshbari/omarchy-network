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
  'u=$(uuidgen); IFS= read -r pw; ' +
  'pw=$(printf "%s" "$pw" | tr -d "\\r\\n"); ' +
  'if [[ -z "$pw" ]]; then exit 1; fi; ' +
  'ssid=$(printf "%s" "$1" | tr -d "\\r\\n"); ' +
  'identity=$(printf "%s" "$2" | tr -d "\\r\\n"); ' +
  'if [[ -z "$ssid" || -z "$identity" ]]; then exit 1; fi; ' +
  'trap \'nmcli connection delete uuid "$u" >/dev/null 2>&1 || true\' HUP INT TERM; ' +
  'nmcli connection add type wifi con-name "$ssid" ssid "$ssid" connection.uuid "$u" ' +
  '  wifi-sec.key-mgmt wpa-eap 802-1x.eap peap 802-1x.phase2-auth mschapv2 ' +
  '  802-1x.identity "$identity" 802-1x.auth-timeout 8 >/dev/null ' +
  '  && printf \'set 802-1x.password %s\\nsave\\nquit\\n\' "$pw" | nmcli connection edit uuid "$u" >/dev/null ' +
  '  && nmcli connection up uuid "$u" ' +
  '  || { nmcli connection delete uuid "$u" >/dev/null 2>&1; exit 1; }'

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
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2 == "ethernet" && $1 !~ /^(veth|docker|br-|virbr|lo|dummy|tap|tun|tailscale|wg|zt)/ { print $1; exit }\'); ' +
  'con_uuid=$(nmcli -t -f UUID,TYPE connection show --active 2>/dev/null | awk -F: \'$2 == "802-3-ethernet" || $2 == "ethernet" { print $1; exit }\'); ' +
  'if [[ -z "$con_uuid" ]]; then ' +
  '  con_uuid=$(nmcli -t -f UUID,TYPE connection show 2>/dev/null | awk -F: \'$2 == "802-3-ethernet" || $2 == "ethernet" { print $1; exit }\'); ' +
  'fi; ' +
  'con=""; ' +
  'if [[ -n "$con_uuid" ]]; then ' +
  '  con=$(nmcli -g connection.id connection show uuid "$con_uuid" 2>/dev/null); ' +
  'fi; ' +
  'if [[ -z "$con" && -n "$dev" ]]; then con="Wired connection 1"; fi; ' +
  'if [[ -n "$con" ]]; then ' +
  '  if nmcli connection show id "$con" >/dev/null 2>&1; then ' +
  '    method=$(nmcli -g ipv4.method connection show id "$con" 2>/dev/null || echo "auto"); ' +
  '    addr=$(nmcli -g ipv4.addresses connection show id "$con" 2>/dev/null || echo ""); ' +
  '    gw=$(nmcli -g ipv4.gateway connection show id "$con" 2>/dev/null || echo ""); ' +
  '    dns=$(nmcli -g ipv4.dns connection show id "$con" 2>/dev/null || echo ""); ' +
  '  else ' +
  '    method="auto"; addr=""; gw=""; dns=""; ' +
  '  fi; ' +
  '  jq -nc --arg con "$con" --arg dev "${dev:-}" --arg method "${method:-auto}" --arg addr "${addr:-}" --arg gw "${gw:-}" --arg dns "${dns:-}" ' +
  '    \'{name: $con, device: $dev, method: $method, addresses: $addr, gateway: $gw, dns: $dns}\'; ' +
  'else ' +
  '  echo "{}"; ' +
  'fi'

var wiredApplyScript =
  'con="$1"; method="$2"; addr="$3"; gw="$4"; dns="$5"; ' +
  'con=$(printf "%s" "$con" | tr -d "\\r\\n"); ' +
  'if [[ -z "$con" || "$con" == -* ]]; then con="Wired connection 1"; fi; ' +
  'if [[ "$method" != "manual" ]]; then method="auto"; fi; ' +
  'validate_ipv4() { ' +
  '  local ip=$1; ' +
  '  [[ $ip =~ ^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$ ]] || return 1; ' +
  '  local IFS=.; ' +
  '  local -a octets=($ip); ' +
  '  [[ ${#octets[@]} -eq 4 ]] || return 1; ' +
  '  for o in "${octets[@]}"; do ' +
  '    [[ $o =~ ^(0|[1-9][0-9]*)$ ]] || return 1; ' +
  '    (( o >= 0 && o <= 255 )) || return 1; ' +
  '  done; ' +
  '  return 0; ' +
  '}; ' +
  'validate_cidr() { ' +
  '  local entry=$1; ' +
  '  local ip=${entry%/*}; ' +
  '  local pfx=""; ' +
  '  if [[ "$entry" == *"/"* ]]; then ' +
  '    pfx=${entry#*/}; ' +
  '    [[ "$pfx" =~ ^[0-9]+$ ]] && (( pfx >= 0 && pfx <= 32 )) || return 1; ' +
  '  fi; ' +
  '  validate_ipv4 "$ip" || return 1; ' +
  '  return 0; ' +
  '}; ' +
  'if ! nmcli connection show id "$con" >/dev/null 2>&1; then ' +
  '  dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2 == "ethernet" && $1 !~ /^(veth|docker|br-|virbr|lo|dummy|tap|tun|tailscale|wg|zt)/ { print $1; exit }\'); ' +
  '  if [[ -n "$dev" && ! "$dev" =~ ^[a-zA-Z0-9_.-]+$ ]]; then dev=""; fi; ' +
  '  if ! nm_out=$(nmcli connection add type ethernet con-name "$con" ${dev:+ifname "$dev"} 2>&1); then ' +
  '    err_detail=$(echo "$nm_out" | grep -m 1 -i "error:" | sed \'s/^[Ee]rror:[[:space:]]*//\'); ' +
  '    echo "Failed to create wired connection: ${err_detail:-$nm_out}" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  'fi; ' +
  'if [[ "$method" == "manual" ]]; then ' +
  '  addr=$(printf "%s" "$addr" | tr -d "\\r\\n"); ' +
  '  gw=$(printf "%s" "$gw" | tr -d "\\r\\n"); ' +
  '  dns=$(printf "%s" "$dns" | tr -d "\\r\\n"); ' +
  '  if [[ "$addr" != */* && -n "$addr" ]]; then addr="${addr}/24"; fi; ' +
  '  addr_clean="${addr//,/ }"; ' +
  '  [[ -z "$addr_clean" ]] && { echo "IP address is required for Static IP" >&2; exit 1; }; ' +
  '  for a in $addr_clean; do ' +
  '    if ! validate_cidr "$a"; then ' +
  '      echo "Invalid IPv4 address format: $a" >&2; ' +
  '      exit 1; ' +
  '    fi; ' +
  '  done; ' +
  '  if [[ -n "$gw" ]] && ! validate_ipv4 "$gw"; then ' +
  '    echo "Invalid Gateway IP format: $gw" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  '  if [[ -n "$dns" ]]; then ' +
  '    dns_clean="${dns//,/ }"; ' +
  '    for d in $dns_clean; do ' +
  '      if ! validate_ipv4 "$d"; then ' +
  '        echo "Invalid DNS format: $d" >&2; ' +
  '        exit 1; ' +
  '      fi; ' +
  '    done; ' +
  '  fi; ' +
  '  if ! nm_out=$(nmcli connection modify id "$con" ipv4.method manual ipv4.addresses "$addr" ipv4.gateway "${gw:-}" ipv4.dns "${dns:-}" 2>&1); then ' +
  '    err_detail=$(echo "$nm_out" | grep -m 1 -i "error:" | sed \'s/^[Ee]rror:[[:space:]]*//\'); ' +
  '    echo "Failed to update wired connection: ${err_detail:-$nm_out}" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  'else ' +
  '  if ! nm_out=$(nmcli connection modify id "$con" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns "" 2>&1); then ' +
  '    err_detail=$(echo "$nm_out" | grep -m 1 -i "error:" | sed \'s/^[Ee]rror:[[:space:]]*//\'); ' +
  '    echo "Failed to update wired connection: ${err_detail:-$nm_out}" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  'fi; ' +
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2 == "ethernet" && $1 !~ /^(veth|docker|br-|virbr|lo|dummy|tap|tun|tailscale|wg|zt)/ { print $1; exit }\'); ' +
  'if [[ -n "$dev" && "$dev" =~ ^[a-zA-Z0-9_.-]+$ ]]; then ' +
  '  nmcli device reapply "$dev" 2>/dev/null || nmcli connection up id "$con" 2>/dev/null || true; ' +
  'else ' +
  '  nmcli connection up id "$con" 2>/dev/null || true; ' +
  'fi'

var hotspotQueryScript =
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2=="wifi"{print $1; exit}\'); ' +
  'has_ap="false"; ' +
  'if [[ -n "$dev" ]] && iw list 2>/dev/null | grep -A 8 "Supported interface modes" | grep -q "AP"; then has_ap="true"; fi; ' +
  'has_create_ap="false"; ' +
  'if command -v create_ap >/dev/null 2>&1; then has_create_ap="true"; fi; ' +
  'eth_connected="false"; ' +
  'if nmcli -t -f DEVICE,TYPE,STATE dev status 2>/dev/null | awk -F: \'$2 == "ethernet" && $1 !~ /^(veth|docker|br-|virbr|lo|dummy|tap|tun|tailscale|wg|zt)/ && $3 == "connected" { found=1 } END { exit (found ? 0 : 1) }\'; then eth_connected="true"; fi; ' +
  'wifi_connected="false"; ' +
  'if [[ -n "$dev" ]] && nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep -q -F -x "${dev}:connected"; then wifi_connected="true"; fi; ' +
  'repeater_capable="false"; ' +
  'connected_band=""; ' +
  'if [[ -n "$dev" ]]; then ' +
  '  freq=$(iw dev "$dev" link 2>/dev/null | grep -i "freq:" | awk \'{print $2}\' | cut -d. -f1); ' +
  '  if [[ -n "$freq" ]]; then ' +
  '    if [[ "$freq" -gt 5000 ]]; then connected_band="a"; else connected_band="bg"; fi; ' +
  '    if [[ "$has_create_ap" == "true" && "$wifi_connected" == "true" ]]; then ' +
  '      phy=$(cat /sys/class/net/"$dev"/phy80211/name 2>/dev/null || echo "phy0"); ' +
  '      ch_info=$(iw phy "$phy" info 2>/dev/null | grep -E "\\* ${freq}\\.[0-9]+ MHz"); ' +
  '      if [[ "$ch_info" != *"no IR"* ]]; then repeater_capable="true"; fi; ' +
  '    fi; ' +
  '  fi; ' +
  'fi; ' +
  '  cap_running="false"; cap_ssid=""; cap_pwd=""; cap_band="bg"; cap_iface=""; ' +
  'for d in /tmp/create_ap.*.conf.*; do ' +
  '  if [[ -d "$d" && ! -L "$d" && -f "$d/pid" && ! -L "$d/pid" ]]; then ' +
  '    if [[ $(stat -c \'%u\' "$d" 2>/dev/null) -eq 0 && $(stat -c \'%u\' "$d/pid" 2>/dev/null) -eq 0 ]]; then ' +
  '      pid=$(cat "$d/pid" 2>/dev/null); ' +
  '      if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ && -d "/proc/$pid" && $(stat -c \'%u\' "/proc/$pid" 2>/dev/null) -eq 0 ]] && grep -q "create_ap" "/proc/$pid/cmdline" 2>/dev/null; then ' +
  '        cap_running="true"; ' +
  '        viface=$(cat "$d/wifi_iface" 2>/dev/null); ' +
  '        if [[ -n "$viface" && "$viface" =~ ^[a-zA-Z0-9_.-]+$ && -d "/sys/class/net/$viface" ]]; then ' +
  '          cap_iface="$viface"; ' +
  '          info_ssid=$(iw dev "$viface" info 2>/dev/null | sed -n \'s/^[[:space:]]*ssid[[:space:]]\\+//p\'); ' +
  '          if [[ -n "$info_ssid" ]]; then cap_ssid="$info_ssid"; fi; ' +
  '          cap_freq=$(iw dev "$viface" info 2>/dev/null | grep -o "([0-9]\\+ MHz)" | tr -d "() MHz"); ' +
  '          if [[ -n "$cap_freq" && "$cap_freq" =~ ^[0-9]+$ && "$cap_freq" -gt 5000 ]]; then cap_band="a"; else cap_band="bg"; fi; ' +
  '        fi; ' +
  '        break; ' +
  '      fi; ' +
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
  'if nmcli connection show id "$con" >/dev/null 2>&1; then ' +
  '  nm_ssid=$(nmcli -s -g 802-11-wireless.ssid connection show id "$con" 2>/dev/null); ' +
  '  nm_pwd=$(nmcli -s -g 802-11-wireless-security.psk connection show id "$con" 2>/dev/null); ' +
  '  nm_band=$(nmcli -s -g 802-11-wireless.band connection show id "$con" 2>/dev/null); ' +
  '  if nmcli -t -f NAME,ACTIVE connection show 2>/dev/null | grep -q -F -x "${con}:yes"; then nm_active="true"; fi; ' +
  'fi; ' +
  'ap_iface=""; ' +
  'if [[ "$cap_running" == "true" ]]; then ' +
  '  active="true"; is_repeater="true"; ssid="${cap_ssid:-$nm_ssid}"; pwd="${nm_pwd:-$cap_pwd}"; band="$cap_band"; ap_iface="$cap_iface"; ' +
  'elif [[ "$nm_active" == "true" ]]; then ' +
  '  active="true"; is_repeater="false"; ssid="${nm_ssid:-Omarchy-Hotspot}"; pwd="${nm_pwd:-omarchy12345}"; band="${nm_band:-bg}"; ap_iface="$dev"; ' +
  'else ' +
  '  active="false"; is_repeater="false"; ssid="${nm_ssid:-Omarchy-Hotspot}"; pwd="${nm_pwd:-omarchy12345}"; ' +
  '  if [[ "$wifi_connected" == "true" && -n "$connected_band" ]]; then band="$connected_band"; else band="${nm_band:-bg}"; fi; ' +
  '  ap_iface=""; ' +
  'fi; ' +
  'client_json="[]"; ' +
  'if [[ "$active" == "true" && -n "$ap_iface" && "$ap_iface" =~ ^[a-zA-Z0-9_.-]+$ ]]; then ' +
  '  parsed=$(iw dev "$ap_iface" station dump 2>/dev/null | awk -v iface="$ap_iface" \'' +
  'BEGIN {' +
  '  while ((getline line < "/proc/net/arp") > 0) {' +
  '    split(line, f);' +
  '    if (f[6] == iface && f[4] ~ /^[0-9a-fA-F:]+$/) arp[toupper(f[4])] = f[1];' +
  '  }' +
  '  close("/proc/net/arp");' +
  '  cmd = "ip -4 neigh show dev " iface " 2>/dev/null";' +
  '  while ((cmd | getline line) > 0) {' +
  '    n = split(line, f);' +
  '    for (i = 1; i < n; i++) if (f[i] == "lladdr") arp[toupper(f[i+1])] = f[1];' +
  '  }' +
  '  close(cmd);' +
  '}' +
  '/^Station / {' +
  '  if (mac != "") print_st();' +
  '  mac = toupper($2); sig = ""; tx = ""; rx = ""; ct = "";' +
  '  next;' +
  '}' +
  '/^[[:space:]]*signal:/ {' +
  '  for (i=1; i<=NF; i++) if ($i ~ /^-?[0-9]+$/) { sig = $i; break; }' +
  '}' +
  '/^[[:space:]]*tx bitrate:/ {' +
  '  sub(/^[[:space:]]*tx bitrate:[[:space:]]*/, "");' +
  '  if (match($0, /^[0-9.]+[[:space:]]*M?B[a-zA-Z/]*/)) tx = substr($0, RSTART, RLENGTH);' +
  '  else tx = $0;' +
  '}' +
  '/^[[:space:]]*rx bitrate:/ {' +
  '  sub(/^[[:space:]]*rx bitrate:[[:space:]]*/, "");' +
  '  if (match($0, /^[0-9.]+[[:space:]]*M?B[a-zA-Z/]*/)) rx = substr($0, RSTART, RLENGTH);' +
  '  else rx = $0;' +
  '}' +
  '/^[[:space:]]*connected time:/ {' +
  '  sub(/^[[:space:]]*connected time:[[:space:]]*/, "");' +
  '  s = $1 + 0;' +
  '  if (s < 60) ct = s "s";' +
  '  else if (s < 3600) ct = int(s / 60) "m " (s % 60) "s";' +
  '  else ct = int(s / 3600) "h " int((s % 3600) / 60) "m";' +
  '}' +
  'function print_st() {' +
  '  ip = (mac in arp) ? arp[mac] : "";' +
  '  printf "%s|%s|%s|%s|%s|%s\\n", mac, ip, sig, tx, rx, ct;' +
  '}' +
  'END { if (mac != "") print_st(); }\'); ' +
  '  items=""; ' +
  '  while IFS="|" read -r mac ip sig tx rx ct; do ' +
  '    [[ -z "$mac" || ! "$mac" =~ ^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$ ]] && continue; ' +
  '    oui=$(echo "$mac" | tr -d ":" | cut -c1-6); ' +
  '    vendor=$(grep -m 1 -i "^$oui" /usr/share/hwdata/oui.txt 2>/dev/null | awk -F"\\t+" \'{print $NF}\'); ' +
  '    hostname=""; ' +
  '    if [[ -n "$ip" && "$ip" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then ' +
  '      h=$(getent hosts "$ip" 2>/dev/null | awk \'{print $2; exit}\'); ' +
  '      if [[ -n "$h" && "$h" != *"local" && "$h" != *"arpa" && "$h" != "omarchy" ]]; then ' +
  '        hostname="$h"; ' +
  '      fi; ' +
  '    fi; ' +
  '    name="$hostname"; ' +
  '    if [[ -z "$name" ]]; then name="$vendor"; fi; ' +
  '    if [[ -z "$name" ]]; then ' +
  '      fb=$((16#${mac:0:2})); ' +
  '      if (( (fb & 2) != 0 )); then ' +
  '        name="Private Device (${mac: -5})"; ' +
  '      else ' +
  '        name="Device (${mac: -5})"; ' +
  '      fi; ' +
  '    fi; ' +
  '    item=$(jq -nc ' +
  '      --arg mac "$mac" ' +
  '      --arg ip "$ip" ' +
  '      --arg name "$name" ' +
  '      --arg vendor "$vendor" ' +
  '      --arg hostname "$hostname" ' +
  '      --arg sig "$sig" ' +
  '      --arg tx "$tx" ' +
  '      --arg rx "$rx" ' +
  '      --arg ct "$ct" ' +
  '      \'{mac: $mac, ip: $ip, name: $name, vendor: $vendor, hostname: $hostname, signal: (if $sig != "" then ($sig|tonumber) else null end), txBitrate: $tx, rxBitrate: $rx, connectedTime: $ct}\'); ' +
  '    items="${items:+$items,}$item"; ' +
  '  done <<< "$parsed"; ' +
  '  client_json="[$items]"; ' +
  'fi; ' +
  'clients=$(echo "$client_json" | jq "length" 2>/dev/null || echo 0); ' +
  'printf "%s" "${pwd:-omarchy12345}" | jq -Rs --arg con "$con" --arg ssid "${ssid:-Omarchy-Hotspot}" --arg band "${band:-bg}" --argjson active "$active" --arg dev "${dev:-}" --argjson clients "${clients:-0}" --argjson clientList "$client_json" --argjson hasAp "$has_ap" --argjson isRepeater "$is_repeater" --argjson hasCreateAp "$has_create_ap" --argjson wifiConnected "$wifi_connected" --arg connectedBand "$connected_band" --argjson ethernetConnected "$eth_connected" --argjson repeaterCapable "$repeater_capable" ' +
  '  \'{"name": $con, "ssid": $ssid, "password": ., "band": $band, "active": $active, "device": $dev, "clients": $clients, "clientList": $clientList, "hasAp": $hasAp, "isRepeater": $isRepeater, "hasCreateAp": $hasCreateAp, "wifiConnected": $wifiConnected, "connectedBand": $connectedBand, "ethernetConnected": $ethernetConnected, "repeaterCapable": $repeaterCapable}\''

// The password arrives on stdin and reaches nmcli through the scriptable
// `connection edit` editor or create_ap through a protected temporary config file.
// argv is world-readable in /proc, so the secret must never be an argument
// (printf is a bash builtin, so no process spawns with it either).
var hotspotApplyScript =
  'IFS= read -r pwd; ' +
  'pwd=$(printf "%s" "$pwd" | tr -d "\\r\\n"); ' +
  'action="$1"; con="$2"; ssid="$3"; band="$4"; ' +
  'if [[ "$action" != "save" && "$action" != "toggle" && "$action" != "stop" ]]; then exit 1; fi; ' +
  'con=$(printf "%s" "$con" | tr -d "\\r\\n"); ' +
  'if [[ -z "$con" || "$con" == -* ]]; then con="Hotspot"; fi; ' +
  'ssid=$(printf "%s" "$ssid" | tr -d "\\r\\n"); ' +
  'if [[ -z "$ssid" || ${#ssid} -gt 32 || "$ssid" =~ [^[:print:]] ]]; then ssid="Omarchy-Hotspot"; fi; ' +
  'if [[ -z "$pwd" ]]; then pwd="omarchy12345"; fi; ' +
  'if [[ ${#pwd} -lt 8 || ${#pwd} -gt 63 || "$pwd" =~ [^[:print:]] ]]; then ' +
  '  echo "Invalid password: must be 8-63 printable ASCII characters" >&2; ' +
  '  exit 1; ' +
  'fi; ' +
  'if [[ "$band" != "a" ]]; then band="bg"; fi; ' +
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2=="wifi"{print $1; exit}\'); ' +
  'if [[ -n "$dev" && ! "$dev" =~ ^[a-zA-Z0-9_.-]+$ ]]; then dev=""; fi; ' +
  'if [[ "$action" == "save" ]]; then ' +
  '  if ! nmcli connection show id "$con" >/dev/null 2>&1; then ' +
  '    if ! nm_out=$(nmcli con add type wifi con-name "$con" autoconnect no ssid "$ssid" ' +
  '      802-11-wireless.mode ap 802-11-wireless.band "$band" ' +
  '      802-11-wireless-security.key-mgmt wpa-psk ' +
  '      ipv4.method shared ${dev:+ifname "$dev"} 2>&1); then ' +
  '      err_detail=$(echo "$nm_out" | grep -m 1 -i "error:" | sed \'s/^[Ee]rror:[[:space:]]*//\'); ' +
  '      echo "Failed to create hotspot connection: ${err_detail:-$nm_out}" >&2; ' +
  '      exit 1; ' +
  '    fi; ' +
  '  else ' +
  '    nmcli con modify id "$con" 802-11-wireless.ssid "$ssid" 802-11-wireless.band "$band" >/dev/null 2>&1 || true; ' +
  '  fi; ' +
  '  if ! printf "set 802-11-wireless-security.psk %s\\nsave\\nquit\\n" "$pwd" | nmcli connection edit id "$con" >/dev/null 2>&1; then ' +
  '    echo "Failed to configure hotspot password" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  '  exit 0; ' +
  'fi; ' +
  'is_running="false"; running_pid=""; ' +
  'for d in /tmp/create_ap.*.conf.*; do ' +
  '  if [[ -d "$d" && ! -L "$d" && -f "$d/pid" && ! -L "$d/pid" ]]; then ' +
  '    if [[ $(stat -c \'%u\' "$d" 2>/dev/null) -eq 0 && $(stat -c \'%u\' "$d/pid" 2>/dev/null) -eq 0 ]]; then ' +
  '      pid=$(cat "$d/pid" 2>/dev/null); ' +
  '      if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ && -d "/proc/$pid" && $(stat -c \'%u\' "/proc/$pid" 2>/dev/null) -eq 0 ]] && grep -q "create_ap" "/proc/$pid/cmdline" 2>/dev/null; then ' +
  '        is_running="true"; running_pid="$pid"; break; ' +
  '      fi; ' +
  '    fi; ' +
  '  fi; ' +
  'done; ' +
  'if [[ "$is_running" == "false" ]] && nmcli -t -f NAME,ACTIVE connection show 2>/dev/null | grep -q -F -x "${con}:yes"; then ' +
  '  is_running="true"; ' +
  'fi; ' +
  'if [[ "$action" == "stop" ]] || [[ "$action" == "toggle" && "$is_running" == "true" ]]; then ' +
  '  if [[ -n "$running_pid" && "$running_pid" =~ ^[0-9]+$ ]]; then ' +
  '    pkexec create_ap --stop "$running_pid" >/dev/null 2>&1 || true; ' +
  '  fi; ' +
  '  for d in /tmp/create_ap.*.conf.*; do ' +
  '    if [[ -d "$d" && ! -L "$d" && -f "$d/pid" && ! -L "$d/pid" ]]; then ' +
  '      if [[ $(stat -c \'%u\' "$d" 2>/dev/null) -eq 0 && $(stat -c \'%u\' "$d/pid" 2>/dev/null) -eq 0 ]]; then ' +
  '        p=$(cat "$d/pid" 2>/dev/null); ' +
  '        if [[ -n "$p" && "$p" =~ ^[0-9]+$ && -d "/proc/$p" && $(stat -c \'%u\' "/proc/$p" 2>/dev/null) -eq 0 ]] && grep -q "create_ap" "/proc/$p/cmdline" 2>/dev/null; then ' +
  '          pkexec create_ap --stop "$p" >/dev/null 2>&1 || true; ' +
  '        fi; ' +
  '      fi; ' +
  '    fi; ' +
  '  done; ' +
  '  if [[ -n "$dev" ]]; then ' +
  '    for p in $(pgrep -u 0 -f "create_ap" 2>/dev/null); do ' +
  '      if [[ "$p" =~ ^[0-9]+$ ]]; then ' +
  '        pkexec create_ap --stop "$p" >/dev/null 2>&1 || true; ' +
  '      fi; ' +
  '    done; ' +
  '  fi; ' +
  '  nmcli con down id "$con" >/dev/null 2>&1 || true; ' +
  '  exit 0; ' +
  'fi; ' +
  'eth_connected="false"; ' +
  'if nmcli -t -f DEVICE,TYPE,STATE dev status 2>/dev/null | awk -F: \'$2 == "ethernet" && $1 !~ /^(veth|docker|br-|virbr|lo|dummy|tap|tun|tailscale|wg|zt)/ && $3 == "connected" { found=1 } END { exit (found ? 0 : 1) }\'; then eth_connected="true"; fi; ' +
  'wifi_connected="false"; ' +
  'if [[ -n "$dev" ]] && nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep -q -F -x "${dev}:connected"; then ' +
  '  wifi_connected="true"; ' +
  'fi; ' +
  'if [[ "$wifi_connected" == "true" ]]; then ' +
  '  if ! command -v create_ap >/dev/null 2>&1; then ' +
  '    echo "Wi-Fi is connected. Install linux-wifi-hotspot for simultaneous repeater chaining." >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  '  freq=$(iw dev "$dev" link 2>/dev/null | grep -i "freq:" | awk \'{print $2}\' | cut -d. -f1); ' +
  '  if [[ -n "$freq" && "$freq" =~ ^[0-9]+$ ]]; then ' +
  '    phy=$(cat /sys/class/net/"$dev"/phy80211/name 2>/dev/null || echo "phy0"); ' +
  '    if [[ "$phy" =~ ^phy[0-9]+$ ]]; then ' +
  '      ch_info=$(iw phy "$phy" info 2>/dev/null | grep -E "\\* ${freq}\\.[0-9]+ MHz"); ' +
  '      if [[ "$ch_info" == *"no IR"* ]]; then ' +
  '        echo "Cannot repeat: current 5GHz Wi-Fi channel is restricted (no-IR) by card firmware. Connect to 2.4GHz Wi-Fi to repeat." >&2; ' +
  '        exit 1; ' +
  '      fi; ' +
  '    fi; ' +
  '  fi; ' +
  '  cap_sec_dir=$(mktemp -d /tmp/create_ap_sec.XXXXXX); ' +
  '  chmod 700 "$cap_sec_dir"; ' +
  '  cap_conf="$cap_sec_dir/ap.conf"; ' +
  '  cap_log="$cap_sec_dir/ap.log"; ' +
  '  touch "$cap_conf" "$cap_log"; ' +
  '  chmod 600 "$cap_conf" "$cap_log"; ' +
  '  printf "WIFI_IFACE=%s\\nINTERNET_IFACE=%s\\nSSID=%s\\nPASSPHRASE=%s\\nCHANNEL=default\\nFREQ_BAND=default\\nDAEMONIZE=1\\n" "$dev" "$dev" "$ssid" "$pwd" > "$cap_conf"; ' +
  '  trap \'rm -rf "$cap_sec_dir"\' EXIT HUP INT QUIT TERM; ' +
  '  pkexec create_ap --config "$cap_conf" > "$cap_log" 2>&1; ' +
  '  pk_status=$?; ' +
  '  if [[ $pk_status -ne 0 ]] && grep -qi "not authorized" "$cap_log" 2>/dev/null; then ' +
  '    echo "Hotspot start cancelled: polkit authorization denied or dismissed." >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  '  for i in {1..14}; do ' +
  '    sleep 0.5; ' +
  '    for d in /tmp/create_ap.*.conf.*; do ' +
  '      if [[ -d "$d" && ! -L "$d" && -f "$d/pid" && ! -L "$d/pid" ]]; then ' +
  '        if [[ $(stat -c \'%u\' "$d" 2>/dev/null) -eq 0 && $(stat -c \'%u\' "$d/pid" 2>/dev/null) -eq 0 ]]; then ' +
  '          pid=$(cat "$d/pid" 2>/dev/null); ' +
  '          if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ && -d "/proc/$pid" && $(stat -c \'%u\' "/proc/$pid" 2>/dev/null) -eq 0 ]] && grep -q "create_ap" "/proc/$pid/cmdline" 2>/dev/null; then ' +
  '            viface=$(cat "$d/wifi_iface" 2>/dev/null); ' +
  '            if [[ -n "$viface" && "$viface" =~ ^[a-zA-Z0-9_.-]+$ && -d "/sys/class/net/$viface" ]]; then ' +
  '              exit 0; ' +
  '            fi; ' +
  '          fi; ' +
  '        fi; ' +
  '      fi; ' +
  '    done; ' +
  '  done; ' +
  '  if grep -qi "rf-kill" "$cap_log" 2>/dev/null; then ' +
  '    echo "Cannot start repeater: Wi-Fi is soft-blocked by rfkill. Run \'rfkill unblock wifi\'." >&2; ' +
  '  elif grep -qi "does not fully support virtual interfaces" "$cap_log" 2>/dev/null; then ' +
  '    echo "Repeater error: Wi-Fi card cannot repeat on this band/channel simultaneously." >&2; ' +
  '  elif grep -qi "not authorized" "$cap_log" 2>/dev/null; then ' +
  '    echo "Hotspot start cancelled: polkit authorization denied or dismissed." >&2; ' +
  '  else ' +
  '    err_line=$(grep -m 1 -E "^(ERROR|RTNETLINK):" "$cap_log" 2>/dev/null | sed -e \'s/^ERROR:[[:space:]]*//\'); ' +
  '    if [[ -n "$err_line" ]]; then ' +
  '      echo "Repeater error: $err_line" >&2; ' +
  '    elif [[ -n "$freq" ]]; then ' +
  '      cur_band="2.4GHz"; if [[ "$freq" -gt 5000 ]]; then cur_band="5GHz"; fi; ' +
  '      echo "Repeater failed: Wi-Fi card cannot broadcast AP while connected to $cur_band (${freq} MHz)." >&2; ' +
  '    else ' +
  '      echo "Failed to start repeater: verify your Wi-Fi interface and ensure the active Wi-Fi channel is not restricted." >&2; ' +
  '    fi; ' +
  '  fi; ' +
  '  exit 1; ' +
  'else ' +
  '  nmcli radio wifi on >/dev/null 2>&1 || true; ' +
  '  if [[ -n "$dev" ]] && nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep -q -F -x "${dev}:connected"; then ' +
  '    nmcli dev disconnect "$dev" >/dev/null 2>&1 || true; ' +
  '  fi; ' +
  '  if [[ "$band" == "a" && -n "$dev" ]]; then ' +
  '    phy=$(cat /sys/class/net/"$dev"/phy80211/name 2>/dev/null || echo "phy0"); ' +
  '    if [[ "$phy" =~ ^phy[0-9]+$ ]] && ! iw phy "$phy" info 2>/dev/null | grep -A 40 "Frequencies:" | grep -E "5[0-9]{3} MHz" | grep -v "no IR" | grep -q "MHz"; then ' +
  '      band="bg"; ' +
  '    fi; ' +
  '  fi; ' +
  '  if ! nmcli connection show id "$con" >/dev/null 2>&1; then ' +
  '    if ! nm_out=$(nmcli con add type wifi con-name "$con" autoconnect no ssid "$ssid" ' +
  '      802-11-wireless.mode ap 802-11-wireless.band "$band" ' +
  '      802-11-wireless-security.key-mgmt wpa-psk ' +
  '      ipv4.method shared ${dev:+ifname "$dev"} 2>&1); then ' +
  '      err_detail=$(echo "$nm_out" | grep -m 1 -i "error:" | sed \'s/^[Ee]rror:[[:space:]]*//\'); ' +
  '      echo "Failed to create hotspot: ${err_detail:-$nm_out}" >&2; ' +
  '      exit 1; ' +
  '    fi; ' +
  '  else ' +
  '    nmcli con modify id "$con" 802-11-wireless.ssid "$ssid" 802-11-wireless.band "$band" >/dev/null 2>&1 || true; ' +
  '  fi; ' +
  '  if ! printf "set 802-11-wireless-security.psk %s\\nsave\\nquit\\n" "$pwd" | nmcli connection edit id "$con" >/dev/null 2>&1; then ' +
  '    echo "Failed to configure hotspot password" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  '  if ! nm_out=$(nmcli con up id "$con" 2>&1); then ' +
  '    err_detail=$(echo "$nm_out" | grep -m 1 -i "error:" | sed \'s/^[Ee]rror:[[:space:]]*//\'); ' +
  '    echo "Failed to start hotspot: ${err_detail:-$nm_out}" >&2; ' +
  '    exit 1; ' +
  '  fi; ' +
  'fi'

// The password arrives on stdin; argv is world-readable in /proc,
// so secrets must never appear in command line arguments.
var hotspotQrScript =
  'IFS= read -r pwd; ' +
  'pwd=$(printf "%s" "$pwd" | tr -d "\\r\\n"); ' +
  'ssid="$1"; ' +
  'ssid=$(printf "%s" "$ssid" | tr -d "\\r\\n"); ' +
  'if [[ -z "$ssid" || -z "$pwd" ]]; then ' +
  '  con=""; ' +
  '  for uuid in $(nmcli -t -f UUID,TYPE con show 2>/dev/null | awk -F: \'$2=="802-11-wireless"{print $1}\'); do ' +
  '    mode=$(nmcli -g 802-11-wireless.mode con show "$uuid" 2>/dev/null); ' +
  '    if [[ "$mode" == "ap" ]]; then con=$(nmcli -g connection.id con show "$uuid" 2>/dev/null); break; fi; ' +
  '  done; ' +
  '  if [[ -z "$con" ]]; then con="Hotspot"; fi; ' +
  '  if [[ -z "$ssid" ]]; then ' +
  '    nm_s=$(nmcli -s -g 802-11-wireless.ssid connection show id "$con" 2>/dev/null || true); ' +
  '    ssid="${nm_s:-Omarchy-Hotspot}"; ' +
  '    ssid=$(printf "%s" "$ssid" | tr -d "\\r\\n"); ' +
  '  fi; ' +
  '  if [[ -z "$pwd" ]]; then ' +
  '    nm_p=$(nmcli -s -g 802-11-wireless-security.psk connection show id "$con" 2>/dev/null || true); ' +
  '    pwd="$nm_p"; ' +
  '    pwd=$(printf "%s" "$pwd" | tr -d "\\r\\n"); ' +
  '  fi; ' +
  'fi; ' +
  'escape_wifi_qr() { ' +
  '  local value=$1; ' +
  '  value=${value//\\\\/\\\\\\\\}; ' +
  '  value=${value//;/\\\\;}; ' +
  '  value=${value//,/\\\\,}; ' +
  '  value=${value//:/\\\\:}; ' +
  '  value=${value//\"/\\\\\"}; ' +
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

// Pinned AUR package installer for linux-wifi-hotspot.
// Binds to an immutable commit SHA and verifies the PKGBUILD checksum to prevent
// arbitrary code execution from mutable upstream/AUR HEAD changes.
var installRepeaterScript =
  'set -euo pipefail; ' +
  'if pacman -Q linux-wifi-hotspot >/dev/null 2>&1; then ' +
  '  echo "linux-wifi-hotspot is already installed."; ' +
  '  exit 0; ' +
  'fi; ' +
  'AUR_COMMIT="09f15942b495d89ef0f34abf2885f32d84f28025"; ' +
  'EXPECTED_SHA="f2b08a066f7a35c08030d175be6a9959b3de2b50993026ac359fd3900cacfbef"; ' +
  'EXPECTED_INSTALL_SHA="f417033bfc4253fe575b13fa7a4d7ffa97758d03bf95c7627043472a1f3a6b29"; ' +
  'BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/aur-lwh.XXXXXX"); ' +
  'chmod 700 "$BUILD_DIR"; ' +
  'trap \'rm -rf "$BUILD_DIR"\' EXIT HUP INT QUIT TERM; ' +
  'echo "==> Fetching linux-wifi-hotspot at pinned release ($AUR_COMMIT)..."; ' +
  'git clone -q https://aur.archlinux.org/linux-wifi-hotspot.git "$BUILD_DIR" || { echo "Failed to clone AUR repository" >&2; exit 1; }; ' +
  'cd "$BUILD_DIR"; ' +
  'echo "==> Checking out immutable commit..."; ' +
  'git checkout -q "$AUR_COMMIT" || { echo "Failed to checkout commit $AUR_COMMIT" >&2; exit 1; }; ' +
  'if [ "$(git rev-parse HEAD)" != "$AUR_COMMIT" ]; then ' +
  '  echo "Error: Commit SHA mismatch (expected $AUR_COMMIT)" >&2; exit 1; ' +
  'fi; ' +
  'echo "==> Verifying PKGBUILD and install script checksums..."; ' +
  'if ! printf "%s  PKGBUILD\\n%s  linux-wifi-hotspot.install\\n" "$EXPECTED_SHA" "$EXPECTED_INSTALL_SHA" | sha256sum -c --status -; then ' +
  '  echo "Error: Integrity checksum verification failed!" >&2; exit 1; ' +
  'fi; ' +
  'echo "==> Building and installing verified package..."; ' +
  'makepkg -si --needed --noconfirm'

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
    installRepeaterScript: installRepeaterScript,
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
