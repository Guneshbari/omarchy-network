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

// An 802.1X (PEAP) profile must pin the authentication server's name: a CA chain
// alone accepts any host holding a valid certificate for an unrelated domain.
// Requires a real hostname/suffix with at least one dot (no bare "com").
function isValidServerDomain(value) {
  return /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(String(value || ""))
}

function canForgetNetwork(network) {
  return !!(network && network.known && !network.connected)
}

// The password arrives on stdin and reaches nmcli through the scriptable
// `connection edit` editor -- argv is world-readable in /proc, so the secret
// must never be an argument (printf is a bash builtin, so no process spawns
// with it either).
var enterpriseConnectScript =
  'u=$(uuidgen) || exit 1\n' +
  'IFS= read -r pw\n' +
  'pw=$(printf "%s" "$pw" | tr -d "\\r\\n")\n' +
  'if [[ -z "$pw" ]]; then exit 1; fi\n' +
  'ssid=$(printf "%s" "$1" | tr -d "\\r\\n")\n' +
  'identity=$(printf "%s" "$2" | tr -d "\\r\\n")\n' +
  'ca_cert=$(printf "%s" "$3" | tr -d "\\r\\n")\n' +
  'domain=$(printf "%s" "$4" | tr -d "\\r\\n")\n' +
  'if [[ -z "$ssid" || -z "$identity" ]]; then exit 1; fi\n' +
  '# The expected authentication-server name is mandatory. A trusted CA alone is not\n' +
  '# enough: any host with a valid certificate for an unrelated domain could otherwise\n' +
  '# impersonate the SSID and collect the PEAP exchange.\n' +
  'if [[ ! "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]; then exit 1; fi\n' +
  'ca_args=()\n' +
  'if [[ -n "$ca_cert" ]]; then\n' +
  '  if [[ ! -f "$ca_cert" ]]; then exit 1; fi\n' +
  '  ca_args+=(802-1x.ca-cert "$ca_cert")\n' +
  'else\n' +
  '  ca_args+=(802-1x.system-ca-certs yes)\n' +
  'fi\n' +
  'ca_args+=(802-1x.domain-suffix-match "$domain")\n' +
  'trap \'nmcli connection delete uuid "$u" >/dev/null 2>&1 || true\' HUP INT TERM\n' +
  'nmcli connection add type wifi con-name "$ssid" ssid "$ssid" connection.uuid "$u" \\\n' +
  '  wifi-sec.key-mgmt wpa-eap 802-1x.eap peap 802-1x.phase2-auth mschapv2 \\\n' +
  '  802-1x.identity "$identity" "${ca_args[@]}" 802-1x.auth-timeout 8 >/dev/null \\\n' +
  '  && printf "set 802-1x.password %s\\nsave\\nquit\\n" "$pw" | nmcli connection edit uuid "$u" >/dev/null \\\n' +
  '  && nmcli connection up uuid "$u" \\\n' +
  '  || { nmcli connection delete uuid "$u" >/dev/null 2>&1; exit 1; }\n'

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

// Wired-uplink detection shared by the hotspot and wired scripts (see eth_detect.sh
// semantics: kernel view, not nmcli STATE).
var ethDetectFunction =
  '# Wired-uplink detection, shared by the hotspot and wired scripts.\n' +
  '# Reads the kernel\'s view (/sys/class/net) instead of nmcli\'s STATE column, so a\n' +
  '# link that NetworkManager reports as "connected (externally)" or "unmanaged"\n' +
  '# (systemd-networkd, dhcpcd, a dock...) is still found. Physical NICs only: virtual\n' +
  '# devices (veth, bridges, tunnels...) have no /sys/.../device node.\n' +
  'net_is_physical_eth() {\n' +
  '  local p="$1" n="${1##*/}"\n' +
  '  [[ -n "$n" && -d "$p" ]] || return 1\n' +
  '  [[ -e "$p/device" && ! -d "$p/wireless" && ! -d "$p/phy80211" ]] || return 1\n' +
  '  [[ "$n" =~ ^(veth|docker|br-|virbr|lo|dummy|tap|tun|tailscale|wg|zt) ]] && return 1\n' +
  '  [[ "$(cat "$p/type" 2>/dev/null)" == 1 ]] || return 1\n' +
  '  return 0\n' +
  '}\n' +
  '# Prints the live ethernet device (default-route device first), nothing if none is up.\n' +
  'detect_eth() {\n' +
  '  local sysnet=/sys/class/net def p n st\n' +
  '  def=$(ip -4 route show default 2>/dev/null | awk \'{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }\')\n' +
  '  for p in "$sysnet/$def" "$sysnet"/*; do\n' +
  '    n=${p##*/}\n' +
  '    net_is_physical_eth "$p" || continue\n' +
  '    st=$(cat "$p/operstate" 2>/dev/null)\n' +
  '    if [[ "$st" != up ]]; then\n' +
  '      [[ "$st" == unknown && "$(cat "$p/carrier" 2>/dev/null)" == 1 ]] || continue\n' +
  '    fi\n' +
  '    ip -4 -o addr show dev "$n" scope global 2>/dev/null | grep -q . || continue\n' +
  '    printf "%s" "$n"\n' +
  '    return 0\n' +
  '  done\n' +
  '  return 1\n' +
  '}\n' +
  '# Prints the first physical ethernet NIC regardless of link state (idle-NIC fallback).\n' +
  'first_eth() {\n' +
  '  local p\n' +
  '  for p in /sys/class/net/*; do\n' +
  '    net_is_physical_eth "$p" || continue\n' +
  '    printf "%s" "${p##*/}"\n' +
  '    return 0\n' +
  '  done\n' +
  '  return 1\n' +
  '}\n'

// Runs as root through pkexec. Verifies create_ap's shared /tmp state before
// create_ap runs (it kill -9s PIDs read from files there) and never sees a
// passphrase: that reaches create_ap only through a private --config file.
var createApRootHelper =
  '# create-ap-root <start|stop> [create_ap args]\n' +
  '# Runs as root (pkexec). create_ap keeps shared state in /tmp/create_ap.common.conf\n' +
  '# and, on cleanup, runs kill -9 on whatever PID is written in its *.pid files. Any\n' +
  '# local user can pre-create that directory in /tmp, so it is verified (or replaced)\n' +
  '# here, inside the privileged context, before create_ap ever touches it. No\n' +
  '# passphrase is passed through here: create_ap reads it from a private --config file.\n' +
  'set -u\n' +
  'umask 022\n' +
  'common=/tmp/create_ap.common.conf\n' +
  '\n' +
  'harden_common() {\n' +
  '  local mode f\n' +
  '  if [[ ! -k /tmp ]]; then\n' +
  '    echo "Refusing to run: /tmp is not sticky" >&2\n' +
  '    return 1\n' +
  '  fi\n' +
  '  if [[ -L "$common" ]]; then\n' +
  '    rm -f -- "$common" || return 1\n' +
  '  fi\n' +
  '  if [[ -e "$common" ]]; then\n' +
  '    mode=$(stat -c %a -- "$common" 2>/dev/null || echo 777)\n' +
  '    if [[ ! -d "$common" || "$(stat -c %u -- "$common" 2>/dev/null)" != 0 || $(( 8#$mode & 8#022 )) -ne 0 ]]; then\n' +
  '      rm -rf --one-file-system -- "$common" || return 1\n' +
  '    fi\n' +
  '  fi\n' +
  '  if [[ ! -e "$common" ]]; then\n' +
  '    mkdir -m 0755 -- "$common" 2>/dev/null || true\n' +
  '  fi\n' +
  '  if [[ -L "$common" || ! -d "$common" || "$(stat -c %u -- "$common" 2>/dev/null)" != 0 ]]; then\n' +
  '    echo "Refusing to run: cannot secure $common" >&2\n' +
  '    return 1\n' +
  '  fi\n' +
  '  for f in "$common"/*.pid; do\n' +
  '    [[ -e "$f" || -L "$f" ]] || continue\n' +
  '    if [[ -L "$f" || ! -f "$f" || "$(stat -c %u -- "$f" 2>/dev/null)" != 0 ]]; then\n' +
  '      rm -f -- "$f"\n' +
  '    fi\n' +
  '  done\n' +
  '  return 0\n' +
  '}\n' +
  '\n' +
  'is_create_ap_pid() {\n' +
  '  [[ "$1" =~ ^[0-9]+$ && -r "/proc/$1/cmdline" ]] || return 1\n' +
  '  tr "\\0" " " < "/proc/$1/cmdline" 2>/dev/null | grep -q create_ap\n' +
  '}\n' +
  '\n' +
  'owned_by_root() {\n' +
  '  [[ -e "$1" && ! -L "$1" && "$(stat -c %u -- "$1" 2>/dev/null)" == 0 ]]\n' +
  '}\n' +
  '\n' +
  '# Stale dnsmasq left behind by a create_ap instance that is no longer running.\n' +
  'reap_stale_dnsmasq() {\n' +
  '  local d pid dp\n' +
  '  for d in /tmp/create_ap.*.conf.*; do\n' +
  '    [[ -d "$d" ]] && owned_by_root "$d" || continue\n' +
  '    pid=$(cat "$d/pid" 2>/dev/null)\n' +
  '    is_create_ap_pid "$pid" && continue\n' +
  '    owned_by_root "$d/dnsmasq.pid" || continue\n' +
  '    dp=$(cat "$d/dnsmasq.pid" 2>/dev/null)\n' +
  '    [[ "$dp" =~ ^[0-9]+$ && -r "/proc/$dp/cmdline" ]] || continue\n' +
  '    if tr "\\0" " " < "/proc/$dp/cmdline" 2>/dev/null | grep -q dnsmasq; then\n' +
  '      kill "$dp" 2>/dev/null || true\n' +
  '    fi\n' +
  '  done\n' +
  '}\n' +
  '\n' +
  'case "${1:-}" in\n' +
  '  start)\n' +
  '    shift\n' +
  '    harden_common || exit 1\n' +
  '    reap_stale_dnsmasq\n' +
  '    exec create_ap "$@"\n' +
  '    ;;\n' +
  '  stop)\n' +
  '    harden_common || exit 1\n' +
  '    for d in /tmp/create_ap.*.conf.*; do\n' +
  '      [[ -d "$d" ]] && owned_by_root "$d" && owned_by_root "$d/pid" || continue\n' +
  '      pid=$(cat "$d/pid" 2>/dev/null)\n' +
  '      is_create_ap_pid "$pid" && create_ap --stop "$pid" >/dev/null 2>&1\n' +
  '    done\n' +
  '    reap_stale_dnsmasq\n' +
  '    exit 0\n' +
  '    ;;\n' +
  '  *)\n' +
  '    exit 2\n' +
  '    ;;\n' +
  'esac\n'

var wiredQueryScript =
  ethDetectFunction +
  'dev=$(detect_eth)\n' +
  'if [[ -z "$dev" ]]; then dev=$(first_eth); fi\n' +
  'con_uuid=""\n' +
  'if [[ -n "$dev" ]]; then\n' +
  '  con_uuid=$(nmcli -t -f UUID,TYPE,DEVICE connection show --active 2>/dev/null | awk -F: -v d="$dev" \'($2 == "802-3-ethernet" || $2 == "ethernet") && $3 == d { print $1; exit }\')\n' +
  'fi\n' +
  'if [[ -z "$con_uuid" ]]; then\n' +
  '  con_uuid=$(nmcli -t -f UUID,TYPE connection show --active 2>/dev/null | awk -F: \'$2 == "802-3-ethernet" || $2 == "ethernet" { print $1; exit }\')\n' +
  'fi\n' +
  'if [[ -z "$con_uuid" && -n "$dev" ]]; then\n' +
  '  for u in $(nmcli -t -f UUID,TYPE connection show 2>/dev/null | awk -F: \'$2 == "802-3-ethernet" || $2 == "ethernet" { print $1 }\'); do\n' +
  '    if [[ "$(nmcli -g connection.interface-name connection show uuid "$u" 2>/dev/null)" == "$dev" ]]; then con_uuid="$u"; break; fi\n' +
  '  done\n' +
  'fi\n' +
  'if [[ -z "$con_uuid" ]]; then\n' +
  '  con_uuid=$(nmcli -t -f UUID,TYPE connection show 2>/dev/null | awk -F: \'$2 == "802-3-ethernet" || $2 == "ethernet" { print $1; exit }\')\n' +
  'fi\n' +
  'con=""\n' +
  'if [[ -n "$con_uuid" ]]; then\n' +
  '  con=$(nmcli -g connection.id connection show uuid "$con_uuid" 2>/dev/null)\n' +
  'fi\n' +
  'if [[ -z "$con" && -n "$dev" ]]; then con="Wired connection 1"; fi\n' +
  'if [[ -n "$con" ]]; then\n' +
  '  if nmcli connection show id "$con" >/dev/null 2>&1; then\n' +
  '    method=$(nmcli -g ipv4.method connection show id "$con" 2>/dev/null || echo "auto")\n' +
  '    addr=$(nmcli -g ipv4.addresses connection show id "$con" 2>/dev/null || echo "")\n' +
  '    gw=$(nmcli -g ipv4.gateway connection show id "$con" 2>/dev/null || echo "")\n' +
  '    dns=$(nmcli -g ipv4.dns connection show id "$con" 2>/dev/null || echo "")\n' +
  '  else\n' +
  '    method="auto"; addr=""; gw=""; dns=""\n' +
  '  fi\n' +
  '  jq -nc --arg con "$con" --arg dev "${dev:-}" --arg method "${method:-auto}" --arg addr "${addr:-}" --arg gw "${gw:-}" --arg dns "${dns:-}" \\\n' +
  '    \'{name: $con, device: $dev, method: $method, addresses: $addr, gateway: $gw, dns: $dns}\'\n' +
  'else\n' +
  '  echo "{}"\n' +
  'fi\n'

var wiredApplyScript =
  ethDetectFunction +
  'con="$1"; method="$2"; addr="$3"; gw="$4"; dns="$5"\n' +
  'con=$(printf "%s" "$con" | tr -d "\\r\\n")\n' +
  'if [[ -z "$con" || "$con" == -* ]]; then con="Wired connection 1"; fi\n' +
  'if [[ "$method" != "manual" ]]; then method="auto"; fi\n' +
  'validate_ipv4() {\n' +
  '  local ip=$1\n' +
  '  [[ $ip =~ ^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$ ]] || return 1\n' +
  '  local IFS=.\n' +
  '  local -a octets=($ip)\n' +
  '  [[ ${#octets[@]} -eq 4 ]] || return 1\n' +
  '  for o in "${octets[@]}"; do\n' +
  '    [[ $o =~ ^(0|[1-9][0-9]*)$ ]] || return 1\n' +
  '    (( o >= 0 && o <= 255 )) || return 1\n' +
  '  done\n' +
  '  return 0\n' +
  '}\n' +
  'validate_cidr() {\n' +
  '  local entry=$1\n' +
  '  local ip=${entry%/*}\n' +
  '  local pfx=""\n' +
  '  if [[ "$entry" == *"/"* ]]; then\n' +
  '    pfx=${entry#*/}\n' +
  '    [[ "$pfx" =~ ^[0-9]+$ ]] && (( pfx >= 0 && pfx <= 32 )) || return 1\n' +
  '  fi\n' +
  '  validate_ipv4 "$ip" || return 1\n' +
  '  return 0\n' +
  '}\n' +
  'fail() { echo "$1" >&2; exit 1; }\n' +
  'nm_error() { echo "$1" | grep -m 1 -i "error:" | sed \'s/^[Ee]rror:[[:space:]]*//\'; }\n' +
  '\n' +
  'if [[ "$method" == "manual" ]]; then\n' +
  '  addr=$(printf "%s" "$addr" | tr -d "\\r\\n")\n' +
  '  gw=$(printf "%s" "$gw" | tr -d "\\r\\n")\n' +
  '  dns=$(printf "%s" "$dns" | tr -d "\\r\\n")\n' +
  '  if [[ "$addr" != */* && -n "$addr" ]]; then addr="${addr}/24"; fi\n' +
  '  addr_clean="${addr//,/ }"\n' +
  '  [[ -z "$addr_clean" ]] && fail "IP address is required for Static IP"\n' +
  '  for a in $addr_clean; do\n' +
  '    validate_cidr "$a" || fail "Invalid IPv4 address format: $a"\n' +
  '  done\n' +
  '  if [[ -n "$gw" ]] && ! validate_ipv4 "$gw"; then fail "Invalid Gateway IP format: $gw"; fi\n' +
  '  if [[ -n "$dns" ]]; then\n' +
  '    for d in ${dns//,/ }; do\n' +
  '      validate_ipv4 "$d" || fail "Invalid DNS format: $d"\n' +
  '    done\n' +
  '  fi\n' +
  'fi\n' +
  '\n' +
  '# The NIC that is actually up (kernel view); an idle NIC only as a fallback.\n' +
  'dev=$(detect_eth)\n' +
  'if [[ -z "$dev" ]]; then dev=$(first_eth); fi\n' +
  'if [[ -n "$dev" && ! "$dev" =~ ^[a-zA-Z0-9_.-]+$ ]]; then dev=""; fi\n' +
  '\n' +
  'if ! nmcli connection show id "$con" >/dev/null 2>&1; then\n' +
  '  if ! nm_out=$(nmcli connection add type ethernet con-name "$con" ${dev:+ifname "$dev"} 2>&1); then\n' +
  '    err=$(nm_error "$nm_out")\n' +
  '    fail "Failed to create wired connection: ${err:-$nm_out}"\n' +
  '  fi\n' +
  'fi\n' +
  'uuid=$(nmcli -g connection.uuid connection show id "$con" 2>/dev/null | head -n 1)\n' +
  '[[ -n "$uuid" ]] || fail "Failed to find wired connection: $con"\n' +
  '\n' +
  'if [[ "$method" == "manual" ]]; then\n' +
  '  if ! nm_out=$(nmcli connection modify uuid "$uuid" ipv4.method manual ipv4.addresses "$addr" ipv4.gateway "${gw:-}" ipv4.dns "${dns:-}" 2>&1); then\n' +
  '    fail "Failed to update wired connection: $(nm_error "$nm_out")"\n' +
  '  fi\n' +
  'else\n' +
  '  if ! nm_out=$(nmcli connection modify uuid "$uuid" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns "" 2>&1); then\n' +
  '    fail "Failed to update wired connection: $(nm_error "$nm_out")"\n' +
  '  fi\n' +
  'fi\n' +
  '\n' +
  '# Apply without dropping the link. Only this profile on its own device is ever touched:\n' +
  '# another connection that happens to be active on the NIC is never displaced.\n' +
  'act_dev=$(nmcli -t -f UUID,DEVICE connection show --active 2>/dev/null | awk -F: -v u="$uuid" \'$1 == u && $2 != "" { print $2; exit }\')\n' +
  'if [[ -n "$act_dev" && "$act_dev" =~ ^[a-zA-Z0-9_.-]+$ ]]; then\n' +
  '  # Live profile: re-apply in place; a full re-activation is the last resort.\n' +
  '  if ! nmcli device reapply "$act_dev" >/dev/null 2>&1; then\n' +
  '    nmcli connection up uuid "$uuid" ifname "$act_dev" >/dev/null 2>&1 || true\n' +
  '  fi\n' +
  'elif [[ -n "$dev" ]]; then\n' +
  '  st=$(nmcli -t -f DEVICE,STATE device status 2>/dev/null | awk -F: -v d="$dev" \'$1 == d { print $2; exit }\')\n' +
  '  if [[ "$st" == "disconnected" ]]; then\n' +
  '    nmcli connection up uuid "$uuid" ifname "$dev" >/dev/null 2>&1 || true\n' +
  '  fi\n' +
  'fi\n' +
  'exit 0\n'

var hotspotQueryScript =
  ethDetectFunction +
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2=="wifi"{print $1; exit}\'); ' +
  'has_ap="false"; ' +
  'if [[ -n "$dev" ]] && iw list 2>/dev/null | grep -A 8 "Supported interface modes" | grep -q "AP"; then has_ap="true"; fi; ' +
  'has_create_ap="false"; ' +
  'if command -v create_ap >/dev/null 2>&1; then has_create_ap="true"; fi; ' +
  'eth_dev=$(detect_eth); ' +
  'eth_connected="false"; ' +
  'if [[ -n "$eth_dev" ]]; then eth_connected="true"; fi; ' +
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
  '  cap_running="false"; cap_ssid=""; cap_pwd=""; cap_band="bg"; cap_iface=""; cap_uplink=""; ' +
  'for d in /tmp/create_ap.*.conf.*; do ' +
  '  if [[ -d "$d" && ! -L "$d" && -f "$d/pid" && ! -L "$d/pid" ]]; then ' +
  '    if [[ $(stat -c \'%u\' "$d" 2>/dev/null) -eq 0 && $(stat -c \'%u\' "$d/pid" 2>/dev/null) -eq 0 ]]; then ' +
  '      pid=$(cat "$d/pid" 2>/dev/null); ' +
  '      if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ && -d "/proc/$pid" && $(stat -c \'%u\' "/proc/$pid" 2>/dev/null) -eq 0 ]] && grep -q "create_ap" "/proc/$pid/cmdline" 2>/dev/null; then ' +
  '        cap_running="true"; ' +
  '        cap_uplink=$(cat "$d/nat_internet_iface" 2>/dev/null); ' +
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
  '  active="true"; is_repeater="true"; if [[ -n "$cap_uplink" && "$cap_uplink" != "$dev" ]]; then is_repeater="false"; fi; ssid="${cap_ssid:-$nm_ssid}"; pwd="${nm_pwd:-$cap_pwd}"; band="$cap_band"; ap_iface="$cap_iface"; ' +
  'elif [[ "$nm_active" == "true" ]]; then ' +
  '  active="true"; is_repeater="false"; ssid="${nm_ssid:-Omarchy-Hotspot}"; pwd="${nm_pwd:-}"; band="${nm_band:-bg}"; ap_iface="$dev"; ' +
  'else ' +
  '  active="false"; is_repeater="false"; ssid="${nm_ssid:-Omarchy-Hotspot}"; pwd="${nm_pwd:-}"; ' +
  '  if [[ "$wifi_connected" == "true" && -n "$connected_band" ]]; then band="$connected_band"; else band="${nm_band:-bg}"; fi; ' +
  '  ap_iface=""; ' +
  'fi; ' +
  'lease_files=""\n' +
  'for d in /tmp/create_ap.*.conf.*; do\n' +
  '  [[ -d "$d" && ! -L "$d" && "$(stat -c %u "$d" 2>/dev/null)" == 0 ]] || continue\n' +
  '  f="$d/dnsmasq.leases"\n' +
  '  [[ -f "$f" && ! -L "$f" && "$(stat -c %u "$f" 2>/dev/null)" == 0 ]] || continue\n' +
  '  [[ "$f" =~ ^/tmp/create_ap\\.[A-Za-z0-9_.-]+\\.conf\\.[A-Za-z0-9]+/dnsmasq\\.leases$ ]] || continue\n' +
  '  lease_files="$lease_files $f"\n' +
  'done\n' +
  'client_json="[]"; ' +
  'if [[ "$active" == "true" ]]; then ' +
  '  client_json=$(awk -v iface="${ap_iface:-}" -v leasefiles="$lease_files" \'' +
  'BEGIN {' +
  '  cmd = "cat " leasefiles " /var/lib/NetworkManager/dnsmasq-*.leases 2>/dev/null";' +
  '  while ((cmd | getline line) > 0) {' +
  '    n = split(line, f);' +
  '    if (n >= 3 && f[2] ~ /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/) {' +
  '      m = toupper(f[2]);' +
  '      seen[m] = 1;' +
  '      if (f[3] ~ /^[0-9.]+$/) client_ip[m] = f[3];' +
  '      if (n >= 4 && length(f[4]) <= 63 && f[4] ~ /^[A-Za-z0-9._-]+$/) client_host[m] = f[4];' +
  '    }' +
  '  }' +
  '  close(cmd);' +
  '  while ((getline line < "/proc/net/arp") > 0) {' +
  '    split(line, f);' +
  '    if (f[4] ~ /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/) {' +
  '      m = toupper(f[4]);' +
  '      if (m != "00:00:00:00:00:00") {' +
  '        if (!(m in client_ip) || client_ip[m] == "") client_ip[m] = f[1];' +
  '      }' +
  '    }' +
  '  }' +
  '  close("/proc/net/arp");' +
  '  if (iface != "") {' +
  '    cmd = "ip -4 neigh show dev " iface " 2>/dev/null";' +
  '    while ((cmd | getline line) > 0) {' +
  '      n = split(line, f);' +
  '      for (i = 1; i < n; i++) {' +
  '        if (f[i] == "lladdr" && f[i+1] ~ /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/) {' +
  '          m = toupper(f[i+1]);' +
  '          if (!(m in client_ip) || client_ip[m] == "") client_ip[m] = f[1];' +
  '        }' +
  '      }' +
  '    }' +
  '    close(cmd);' +
  '  }' +
  '}' +
  '/^Station / {' +
  '  m = toupper($2);' +
  '  if (m ~ /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/) {' +
  '    cur_m = m; seen[cur_m] = 1;' +
  '  } else {' +
  '    cur_m = "";' +
  '  }' +
  '  next;' +
  '}' +
  'cur_m != "" && /^[[:space:]]*signal:/ {' +
  '  for (i=1; i<=NF; i++) if ($i ~ /^-?[0-9]+$/) { client_sig[cur_m] = $i; break; }' +
  '}' +
  'cur_m != "" && /^[[:space:]]*tx bitrate:/ {' +
  '  sub(/^[[:space:]]*tx bitrate:[[:space:]]*/, "");' +
  '  if (match($0, /^[0-9.]+[[:space:]]*M?B[a-zA-Z/]*/)) client_tx[cur_m] = substr($0, RSTART, RLENGTH);' +
  '  else client_tx[cur_m] = $0;' +
  '}' +
  'cur_m != "" && /^[[:space:]]*rx bitrate:/ {' +
  '  sub(/^[[:space:]]*rx bitrate:[[:space:]]*/, "");' +
  '  if (match($0, /^[0-9.]+[[:space:]]*M?B[a-zA-Z/]*/)) client_rx[cur_m] = substr($0, RSTART, RLENGTH);' +
  '  else client_rx[cur_m] = $0;' +
  '}' +
  'cur_m != "" && /^[[:space:]]*connected time:/ {' +
  '  sub(/^[[:space:]]*connected time:[[:space:]]*/, "");' +
  '  s = $1 + 0;' +
  '  if (s < 60) client_ct[cur_m] = s "s";' +
  '  else if (s < 3600) client_ct[cur_m] = int(s / 60) "m " (s % 60) "s";' +
  '  else client_ct[cur_m] = int(s / 3600) "h " int((s % 3600) / 60) "m";' +
  '}' +
  'END {' +
  '  first = 1;' +
  '  printf "[";' +
  '  for (m in seen) {' +
  '    if (m == "" || m == "00:00:00:00:00:00") continue;' +
  '    ip = (m in client_ip) ? client_ip[m] : "";' +
  '    host = (m in client_host) ? client_host[m] : "";' +
  '    sig = (m in client_sig) ? client_sig[m] : "";' +
  '    tx = (m in client_tx) ? client_tx[m] : "";' +
  '    rx = (m in client_rx) ? client_rx[m] : "";' +
  '    ct = (m in client_ct) ? client_ct[m] : "";' +
  '    if (host != "") {' +
  '      name = host;' +
  '    } else {' +
  '      b = substr(m, 2, 1);' +
  '      suffix = substr(m, 13);' +
  '      if (b ~ /[2367AaBbEeFf]/) name = "Private Device (" suffix ")";' +
  '      else if (ip != "") name = ip;' +
  '      else name = "Device (" suffix ")";' +
  '    }' +
  '    sig_val = (sig != "" && sig ~ /^-?[0-9]+$/) ? sig : "null";' +
  '    if (!first) printf ",";' +
  '    first = 0;' +
  '    printf "{\\"mac\\":\\"%s\\",\\"ip\\":\\"%s\\",\\"name\\":\\"%s\\",\\"vendor\\":\\"\\",\\"hostname\\":\\"%s\\",\\"signal\\":%s,\\"txBitrate\\":\\"%s\\",\\"rxBitrate\\":\\"%s\\",\\"connectedTime\\":\\"%s\\"}", m, ip, name, host, sig_val, tx, rx, ct;' +
  '  }' +
  '  printf "]";' +
  '}\' <(if [[ -n "$ap_iface" ]]; then iw dev "$ap_iface" station dump 2>/dev/null; fi)); ' +
  '  if [[ -z "$client_json" || "$client_json" != "["*"]" ]]; then client_json="[]"; fi; ' +
  'fi; ' +
  'clients=$(echo "$client_json" | jq "length" 2>/dev/null || echo 0); ' +
  'printf "%s" "${pwd:-}" | jq -Rs --arg con "$con" --arg ssid "${ssid:-Omarchy-Hotspot}" --arg band "${band:-bg}" --argjson active "$active" --arg dev "${dev:-}" --argjson clients "${clients:-0}" --argjson clientList "$client_json" --argjson hasAp "$has_ap" --argjson isRepeater "$is_repeater" --argjson hasCreateAp "$has_create_ap" --argjson wifiConnected "$wifi_connected" --arg connectedBand "$connected_band" --argjson ethernetConnected "$eth_connected" --argjson repeaterCapable "$repeater_capable" ' +
  '  \'{"name": $con, "ssid": $ssid, "password": ., "band": $band, "active": $active, "device": $dev, "clients": $clients, "clientList": $clientList, "hasAp": $hasAp, "isRepeater": $isRepeater, "hasCreateAp": $hasCreateAp, "wifiConnected": $wifiConnected, "connectedBand": $connectedBand, "ethernetConnected": $ethernetConnected, "repeaterCapable": $repeaterCapable}\''

// The password arrives on stdin and reaches nmcli through the scriptable
// `connection edit` editor or create_ap through a protected temporary config file.
// argv is world-readable in /proc, so the secret must never be an argument
// (printf is a bash builtin, so no process spawns with it either).
var hotspotApplyScript =
  ethDetectFunction +
  'IFS= read -r pwd\n' +
  'pwd=$(printf "%s" "$pwd" | tr -d "\\r\\n")\n' +
  'action="$1"; con="$2"; ssid="$3"; band="$4"\n' +
  'if [[ "$action" != "save" && "$action" != "toggle" && "$action" != "stop" ]]; then exit 1; fi\n' +
  'con=$(printf "%s" "$con" | tr -d "\\r\\n")\n' +
  'if [[ -z "$con" || "$con" == -* ]]; then con="Hotspot"; fi\n' +
  'ssid=$(printf "%s" "$ssid" | tr -d "\\r\\n")\n' +
  'if [[ -z "$ssid" || ${#ssid} -gt 32 || "$ssid" =~ [^[:print:]] ]]; then ssid="Omarchy-Hotspot"; fi\n' +
  'if [[ "$band" != "a" ]]; then band="bg"; fi\n' +
  "ap_helper='" + createApRootHelper + "'\n" +
  'dev=$(nmcli -t -f DEVICE,TYPE device status 2>/dev/null | awk -F: \'$2=="wifi"{print $1; exit}\')\n' +
  'if [[ -n "$dev" && ! "$dev" =~ ^[a-zA-Z0-9_.-]+$ ]]; then dev=""; fi\n' +
  '\n' +
  '# No built-in default passphrase: an empty one becomes a random per-device secret.\n' +
  'generated="false"\n' +
  'prepare_password() {\n' +
  '  if [[ -z "$pwd" ]]; then\n' +
  '    # Nothing supplied: keep the passphrase already saved in the profile.\n' +
  '    pwd=$(nmcli -s -g 802-11-wireless-security.psk connection show id "$con" 2>/dev/null | head -n 1)\n' +
  '  fi\n' +
  '  if [[ -z "$pwd" ]]; then\n' +
  '    pwd=$(LC_ALL=C tr -dc \'A-Za-z0-9\' < /dev/urandom | head -c 16)\n' +
  '    generated="true"\n' +
  '  fi\n' +
  '  if [[ ${#pwd} -lt 8 || ${#pwd} -gt 63 || "$pwd" =~ [^[:print:]] ]]; then\n' +
  '    echo "Invalid password: must be 8-63 printable ASCII characters" >&2\n' +
  '    exit 1\n' +
  '  fi\n' +
  '}\n' +
  '\n' +
  '# Persist SSID/band/passphrase in the NetworkManager profile. The passphrase goes\n' +
  '# through the scriptable `connection edit` editor on stdin (printf is a builtin), so\n' +
  '# it never appears in any argv.\n' +
  'save_profile() {\n' +
  '  local nm_out err_detail\n' +
  '  if ! nmcli connection show id "$con" >/dev/null 2>&1; then\n' +
  '    if ! nm_out=$(nmcli con add type wifi con-name "$con" autoconnect no ssid "$ssid" \\\n' +
  '      802-11-wireless.mode ap 802-11-wireless.band "$band" \\\n' +
  '      802-11-wireless-security.key-mgmt wpa-psk \\\n' +
  '      802-11-wireless-security.proto rsn \\\n' +
  '      802-11-wireless-security.pairwise ccmp \\\n' +
  '      802-11-wireless-security.group ccmp \\\n' +
  '      802-11-wireless-security.pmf 1 \\\n' +
  '      ipv4.method shared ipv6.method ignore ${dev:+ifname "$dev"} 2>&1); then\n' +
  '      err_detail=$(echo "$nm_out" | grep -m 1 -i "error:" | sed \'s/^[Ee]rror:[[:space:]]*//\')\n' +
  '      echo "Failed to create hotspot connection: ${err_detail:-$nm_out}" >&2\n' +
  '      exit 1\n' +
  '    fi\n' +
  '  else\n' +
  '    nmcli con modify id "$con" 802-11-wireless.ssid "$ssid" 802-11-wireless.band "$band" \\\n' +
  '      802-11-wireless-security.key-mgmt wpa-psk \\\n' +
  '      802-11-wireless-security.proto rsn \\\n' +
  '      802-11-wireless-security.pairwise ccmp \\\n' +
  '      802-11-wireless-security.group ccmp \\\n' +
  '      802-11-wireless-security.pmf 1 \\\n' +
  '      ipv6.method ignore >/dev/null 2>&1 || true\n' +
  '  fi\n' +
  '  if ! printf "set 802-11-wireless-security.psk %s\\nsave\\nquit\\n" "$pwd" | nmcli connection edit id "$con" >/dev/null 2>&1; then\n' +
  '    echo "Failed to configure hotspot password" >&2\n' +
  '    exit 1\n' +
  '  fi\n' +
  '}\n' +
  '\n' +
  'if [[ "$action" == "save" ]]; then\n' +
  '  prepare_password\n' +
  '  save_profile\n' +
  '  exit 0\n' +
  'fi\n' +
  '\n' +
  '# A running create_ap instance is only trusted if its state dir and pid file are\n' +
  '# root-owned and the pid really is a root create_ap process.\n' +
  'ap_pid=""; ap_dir=""\n' +
  'find_ap() {\n' +
  '  local d pid\n' +
  '  ap_pid=""; ap_dir=""\n' +
  '  for d in /tmp/create_ap.*.conf.*; do\n' +
  '    [[ -d "$d" && ! -L "$d" && -f "$d/pid" && ! -L "$d/pid" ]] || continue\n' +
  '    [[ $(stat -c \'%u\' "$d" 2>/dev/null) -eq 0 && $(stat -c \'%u\' "$d/pid" 2>/dev/null) -eq 0 ]] || continue\n' +
  '    pid=$(cat "$d/pid" 2>/dev/null)\n' +
  '    [[ -n "$pid" && "$pid" =~ ^[0-9]+$ && -d "/proc/$pid" ]] || continue\n' +
  '    [[ $(stat -c \'%u\' "/proc/$pid" 2>/dev/null) -eq 0 ]] || continue\n' +
  '    grep -q "create_ap" "/proc/$pid/cmdline" 2>/dev/null || continue\n' +
  '    ap_pid="$pid"; ap_dir="$d"\n' +
  '    return 0\n' +
  '  done\n' +
  '  return 1\n' +
  '}\n' +
  '\n' +
  'is_running="false"\n' +
  'if find_ap; then\n' +
  '  is_running="true"\n' +
  'elif nmcli -t -f NAME,ACTIVE connection show 2>/dev/null | grep -q -F -x "${con}:yes"; then\n' +
  '  is_running="true"\n' +
  'fi\n' +
  '\n' +
  'if [[ "$action" == "stop" ]] || [[ "$action" == "toggle" && "$is_running" == "true" ]]; then\n' +
  '  if [[ -n "$ap_pid" ]]; then\n' +
  '    pkexec bash -c "$ap_helper" create-ap-root stop >/dev/null 2>&1 || true\n' +
  '  fi\n' +
  '  nmcli con down id "$con" >/dev/null 2>&1 || true\n' +
  '  exit 0\n' +
  'fi\n' +
  '\n' +
  'prepare_password\n' +
  '\n' +
  'eth_dev=$(detect_eth)\n' +
  'wifi_connected="false"\n' +
  'if [[ -n "$dev" ]] && nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep -q -F -x "${dev}:connected"; then\n' +
  '  wifi_connected="true"\n' +
  'fi\n' +
  '\n' +
  '# Wired uplink -> create_ap (iptables NAT, forwarding and DHCP/DNS are all handled\n' +
  '# there, same as the Wi-Fi repeater). NetworkManager\'s own "shared" mode is only the\n' +
  '# fallback when linux-wifi-hotspot is not installed and there is no Wi-Fi uplink.\n' +
  'use_cap="false"\n' +
  'if command -v create_ap >/dev/null 2>&1; then\n' +
  '  if [[ -n "$eth_dev" || "$wifi_connected" == "true" ]]; then use_cap="true"; fi\n' +
  'elif [[ -z "$eth_dev" && "$wifi_connected" == "true" ]]; then\n' +
  '  echo "Wi-Fi is connected. Install linux-wifi-hotspot for simultaneous repeater chaining." >&2\n' +
  '  exit 1\n' +
  'fi\n' +
  '\n' +
  'if [[ "$use_cap" == "true" ]]; then\n' +
  '  if [[ -z "$dev" ]]; then\n' +
  '    echo "No Wi-Fi adapter found" >&2\n' +
  '    exit 1\n' +
  '  fi\n' +
  '  [[ "$generated" == "true" ]] && save_profile\n' +
  '  phy=$(cat /sys/class/net/"$dev"/phy80211/name 2>/dev/null || echo "phy0")\n' +
  '  if [[ ! "$phy" =~ ^phy[0-9]+$ ]]; then phy="phy0"; fi\n' +
  '  uplink="$dev"\n' +
  '  freq_band="default"\n' +
  '  freq=""\n' +
  '  hostapd_n="1"\n' +
  '  ht_capab="[SHORT-GI-20]"\n' +
  '  dhcp_dns=""\n' +
  '  if [[ -n "$eth_dev" ]]; then\n' +
  '    # Wired uplink: configured like the linux-wifi-hotspot GUI does it\n' +
  '    # (`create_ap <wifi> <inet> ssid pass --mkconfig`), but with 802.11n explicitly\n' +
  '    # enabled (hostapd_n="1") to avoid capping link speeds to legacy 54 Mbps.\n' +
  '    uplink="$eth_dev"\n' +
  '    hostapd_n="1"\n' +
  '    ht_capab="[HT40+]"\n' +
  '    dhcp_dns="gateway"\n' +
  '    if nmcli radio wifi 2>/dev/null | grep -qi disabled; then\n' +
  '      nmcli radio wifi on >/dev/null 2>&1 || true\n' +
  '      sleep 1\n' +
  '    fi\n' +
  '    if [[ "$band" == "a" ]] && ! iw phy "$phy" info 2>/dev/null | grep -A 40 "Frequencies:" | grep -E "5[0-9]{3}(\\.[0-9]+)? MHz" | grep -v -e "no IR" -e "disabled" | grep -q "MHz"; then\n' +
  '      band="bg"\n' +
  '    fi\n' +
  '    want_band="2.4"\n' +
  '    if [[ "$band" == "a" ]]; then want_band="5"; fi\n' +
  '    if [[ "$wifi_connected" == "true" ]]; then\n' +
  '      # The AP shares the radio with the station link. Keep that link when it is on\n' +
  '      # the requested band (create_ap follows its channel); otherwise drop it, since\n' +
  '      # many adapters cannot run the AP on a second channel.\n' +
  '      sta_freq=$(iw dev "$dev" link 2>/dev/null | grep -i "freq:" | awk \'{print $2}\' | cut -d. -f1)\n' +
  '      sta_band="2.4"\n' +
  '      if [[ "$sta_freq" =~ ^[0-9]+$ && "$sta_freq" -ge 5000 ]]; then sta_band="5"; fi\n' +
  '      if [[ "$sta_band" != "$want_band" ]]; then\n' +
  '        nmcli dev disconnect "$dev" >/dev/null 2>&1 || true\n' +
  '        sleep 1\n' +
  '      fi\n' +
  '      freq_band="$want_band"\n' +
  '    elif [[ "$want_band" == "5" ]]; then\n' +
  '      freq_band="5"\n' +
  '    fi\n' +
  '  else\n' +
  '    # Wi-Fi repeater: the AP has to share the channel of the active Wi-Fi link.\n' +
  '    freq=$(iw dev "$dev" link 2>/dev/null | grep -i "freq:" | awk \'{print $2}\' | cut -d. -f1)\n' +
  '    if [[ -n "$freq" && "$freq" =~ ^[0-9]+$ ]]; then\n' +
  '      ch_info=$(iw phy "$phy" info 2>/dev/null | grep -E "\\* ${freq}\\.[0-9]+ MHz")\n' +
  '      if [[ "$ch_info" == *"no IR"* ]]; then\n' +
  '        echo "Cannot repeat: current 5GHz Wi-Fi channel is restricted (no-IR) by card firmware. Connect to 2.4GHz Wi-Fi to repeat." >&2\n' +
  '        exit 1\n' +
  '      fi\n' +
  '    fi\n' +
  '    up_dns=$(resolvectl dns "$uplink" 2>/dev/null | awk \'{$1=""; print $0}\' | tr \' \' \'\\n\' | grep -E \'^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$\' | grep -v \'^127\\.\' | paste -sd, -)\n' +
  '    if [[ -n "$up_dns" ]]; then dhcp_dns="$up_dns"; else dhcp_dns="1.1.1.1,8.8.8.8"; fi\n' +
  '  fi\n' +
  '\n' +
  '  # Pick a hotspot subnet that does not collide with any existing route.\n' +
  '  gw="192.168.12.1"\n' +
  '  for n in 12 13 14 15 16; do\n' +
  '    if ! ip -4 route show 2>/dev/null | grep -q "192\\.168\\.${n}\\."; then\n' +
  '      gw="192.168.${n}.1"\n' +
  '      break\n' +
  '    fi\n' +
  '  done\n' +
  '\n' +
  '  cap_sec_dir=$(mktemp -d /tmp/create_ap_sec.XXXXXX) || exit 1\n' +
  '  chmod 700 "$cap_sec_dir"\n' +
  '  cap_conf="$cap_sec_dir/ap.conf"\n' +
  '  cap_log="$cap_sec_dir/ap.log"\n' +
  '  : > "$cap_conf"\n' +
  '  : > "$cap_log"\n' +
  '  chmod 600 "$cap_conf" "$cap_log"\n' +
  '  trap \'rm -rf "$cap_sec_dir"\' EXIT HUP INT QUIT TERM\n' +
  '  # Keep create_ap\'s startup output where the user can read it after a failure\n' +
  '  # (written by the user, never by the root helper).\n' +
  '  save_log() {\n' +
  '    local sd="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy-network"\n' +
  '    mkdir -p -m 700 "$sd" 2>/dev/null && cp -f "$cap_log" "$sd/hotspot-last.log" 2>/dev/null && chmod 600 "$sd/hotspot-last.log" 2>/dev/null\n' +
  '    return 0\n' +
  '  }\n' +
  '  # create_ap reads this file with a plain `read` (no -r): double backslashes so\n' +
  '  # SSIDs and passphrases containing one survive intact.\n' +
  '  cap_ssid=${ssid//\\\\/\\\\\\\\}\n' +
  '  cap_pwd=${pwd//\\\\/\\\\\\\\}\n' +
  '  # Same keys, same order as `create_ap --mkconfig` writes (verified against upstream).\n' +
  '  {\n' +
  '    printf "CHANNEL=default\\n"\n' +
  '    printf "GATEWAY=%s\\n" "$gw"\n' +
  '    printf "WPA_VERSION=2\\n"\n' +
  '    printf "ETC_HOSTS=0\\n"\n' +
  '    printf "DHCP_DNS=%s\\n" "$dhcp_dns"\n' +
  '    printf "NO_DNS=0\\n"\n' +
  '    printf "NO_DNSMASQ=0\\n"\n' +
  '    printf "HIDDEN=0\\n"\n' +
  '    printf "MAC_FILTER=0\\n"\n' +
  '    printf "MAC_FILTER_ACCEPT=/etc/hostapd/hostapd.accept\\n"\n' +
  '    printf "ISOLATE_CLIENTS=0\\n"\n' +
  '    printf "SHARE_METHOD=nat\\n"\n' +
  '    printf "IEEE80211N=%s\\n" "$hostapd_n"\n' +
  '    printf "IEEE80211AC=0\\n"\n' +
  '    printf "IEEE80211AX=0\\n"\n' +
  '    printf "HT_CAPAB=%s\\n" "$ht_capab"\n' +
  '    printf "VHT_CAPAB=\\n"\n' +
  '    printf "VHT_CHWIDTH=80\\n"\n' +
  '    printf "DRIVER=nl80211\\n"\n' +
  '    printf "NO_VIRT=0\\n"\n' +
  '    printf "COUNTRY=\\n"\n' +
  '    printf "FREQ_BAND=%s\\n" "$freq_band"\n' +
  '    printf "NEW_MACADDR=\\n"\n' +
  '    printf "DAEMONIZE=1\\n"\n' +
  '    printf "DAEMON_PIDFILE=\\n"\n' +
  '    printf "DAEMON_LOGFILE=/dev/null\\n"\n' +
  '    printf "DNS_LOGFILE=\\n"\n' +
  '    printf "NO_HAVEGED=0\\n"\n' +
  '    printf "WIFI_IFACE=%s\\n" "$dev"\n' +
  '    printf "INTERNET_IFACE=%s\\n" "$uplink"\n' +
  '    printf "SSID=%s\\n" "$cap_ssid"\n' +
  '    printf "PASSPHRASE=%s\\n" "$cap_pwd"\n' +
  '    printf "USE_PSK=0\\n"\n' +
  '    printf "ADDN_HOSTS=\\n"\n' +
  '    printf "DHCP_HOSTS=\\n"\n' +
  '  } > "$cap_conf"\n' +
  '  # Only the path of the private config file crosses the pkexec argv boundary.\n' +
  '  pkexec bash -c "$ap_helper" create-ap-root start --config "$cap_conf" > "$cap_log" 2>&1\n' +
  '  pk_status=$?\n' +
  '  if [[ $pk_status -ne 0 ]] && grep -qi "not authorized" "$cap_log" 2>/dev/null; then\n' +
  '    echo "Hotspot start cancelled: polkit authorization denied or dismissed." >&2\n' +
  '    exit 1\n' +
  '  fi\n' +
  '  for i in {1..14}; do\n' +
  '    sleep 0.5\n' +
  '    if find_ap; then\n' +
  '      viface=$(cat "$ap_dir/wifi_iface" 2>/dev/null)\n' +
  '      if [[ -n "$viface" && "$viface" =~ ^[a-zA-Z0-9_.-]+$ && -d "/sys/class/net/$viface" ]]; then\n' +
  '        # An AP that is "on" but cannot hand out addresses is worse than a clear error:\n' +
  '        # the AP interface must still hold the gateway address and dnsmasq must be\n' +
  '        # listening on UDP 67.\n' +
  '        have_ip="false"; have_dhcp="false"\n' +
  '        for k in 1 2 3 4 5 6; do\n' +
  '          if ip -4 -o addr show dev "$viface" 2>/dev/null | grep -q "inet ${gw}/"; then have_ip="true"; else have_ip="false"; fi\n' +
  '          if ! command -v ss >/dev/null 2>&1; then have_dhcp="true"\n' +
  '          elif ss -H -uln 2>/dev/null | awk \'{print $4}\' | grep -q -E \':67$\'; then have_dhcp="true"\n' +
  '          else have_dhcp="false"; fi\n' +
  '          if [[ "$have_ip" == "true" && "$have_dhcp" == "true" ]]; then exit 0; fi\n' +
  '          sleep 0.5\n' +
  '        done\n' +
  '        pkexec bash -c "$ap_helper" create-ap-root stop >/dev/null 2>&1 || true\n' +
  '        save_log\n' +
  '        if [[ "$have_ip" != "true" ]]; then\n' +
  '          echo "Hotspot stopped: $viface lost its address ${gw}. Another network service (NetworkManager, iwd or systemd-networkd) is reconfiguring the access-point interface." >&2\n' +
  '        else\n' +
  '          echo "Hotspot stopped: no DHCP server is listening on UDP 67. Check for another DHCP/dnsmasq service and for a firewall blocking UDP 67 on $viface." >&2\n' +
  '        fi\n' +
  '        exit 1\n' +
  '      fi\n' +
  '    fi\n' +
  '  done\n' +
  '  save_log\n' +
  '  if grep -qi "rf-kill" "$cap_log" 2>/dev/null; then\n' +
  '    echo "Cannot start repeater: Wi-Fi is soft-blocked by rfkill. Run \'rfkill unblock wifi\'." >&2\n' +
  '  elif grep -qi "does not fully support virtual interfaces" "$cap_log" 2>/dev/null; then\n' +
  '    echo "Hotspot error: Wi-Fi card cannot run an access point on this band/channel at the same time." >&2\n' +
  '  elif grep -qi "not authorized" "$cap_log" 2>/dev/null; then\n' +
  '    echo "Hotspot start cancelled: polkit authorization denied or dismissed." >&2\n' +
  '  else\n' +
  '    err_line=$(grep -m 1 -E "^(ERROR|RTNETLINK):" "$cap_log" 2>/dev/null | sed -e \'s/^ERROR:[[:space:]]*//\')\n' +
  '    if [[ -n "$err_line" ]]; then\n' +
  '      echo "Hotspot error: $err_line" >&2\n' +
  '    elif [[ -n "$freq" ]]; then\n' +
  '      cur_band="2.4GHz"; if [[ "$freq" -gt 5000 ]]; then cur_band="5GHz"; fi\n' +
  '      echo "Repeater failed: Wi-Fi card cannot broadcast AP while connected to $cur_band (${freq} MHz)." >&2\n' +
  '    else\n' +
  '      echo "Failed to start hotspot: verify your Wi-Fi interface and Ethernet connection." >&2\n' +
  '    fi\n' +
  '  fi\n' +
  '  exit 1\n' +
  'else\n' +
  '  # Fallback: plain NetworkManager hotspot (no linux-wifi-hotspot installed).\n' +
  '  nmcli radio wifi on >/dev/null 2>&1 || true\n' +
  '  if [[ "$wifi_connected" == "true" ]]; then\n' +
  '    nmcli dev disconnect "$dev" >/dev/null 2>&1 || true\n' +
  '  fi\n' +
  '  if [[ "$band" == "a" && -n "$dev" ]]; then\n' +
  '    phy=$(cat /sys/class/net/"$dev"/phy80211/name 2>/dev/null || echo "phy0")\n' +
  '    if [[ "$phy" =~ ^phy[0-9]+$ ]] && ! iw phy "$phy" info 2>/dev/null | grep -A 40 "Frequencies:" | grep -E "5[0-9]{3}(\\.[0-9]+)? MHz" | grep -v -e "no IR" -e "disabled" | grep -q "MHz"; then\n' +
  '      band="bg"\n' +
  '    fi\n' +
  '  fi\n' +
  '  save_profile\n' +
  '  if ! nm_out=$(nmcli con up id "$con" 2>&1); then\n' +
  '    err_detail=$(echo "$nm_out" | grep -m 1 -i "error:" | sed \'s/^[Ee]rror:[[:space:]]*//\')\n' +
  '    echo "Failed to start hotspot: ${err_detail:-$nm_out}" >&2\n' +
  '    exit 1\n' +
  '  fi\n' +
  'fi\n'

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
    isValidServerDomain: isValidServerDomain,
    ethDetectFunction: ethDetectFunction,
    createApRootHelper: createApRootHelper,
    enterpriseConnectScript: enterpriseConnectScript,
    networkFailureReason: networkFailureReason,
    shouldRepromptPassphrase: shouldRepromptPassphrase,
    wiredQueryScript: wiredQueryScript,
    wiredApplyScript: wiredApplyScript,
    hotspotQueryScript: hotspotQueryScript,
    hotspotApplyScript: hotspotApplyScript
  }
}
