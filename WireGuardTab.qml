import QtQuick
import qs.Ui
import qs.Commons

Column {
  id: tab
  required property color foreground
  required property string fontFamily
  property var connections: []
  property var warnings: []
  property string error: ""
  property string pendingId: ""
  property bool loading: false
  property bool cursorActive: false
  property int selectedIndex: -1
  signal activate(var connection)
  signal selectRow(int index)

  spacing: Style.space(8)

  Text {
    width: parent.width
    textFormat: Text.PlainText
    text: "WIREGUARD"
    color: tab.foreground
    font.family: tab.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Text {
    width: parent.width
    textFormat: Text.PlainText
    text: tab.error
    visible: text !== ""
    wrapMode: Text.Wrap
    color: tab.foreground
    font.family: tab.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Repeater {
    model: tab.warnings
    Text {
      required property string modelData
      width: tab.width
      textFormat: Text.PlainText
      text: modelData
      wrapMode: Text.Wrap
      color: tab.foreground
      opacity: 0.7
      font.family: tab.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  Text {
    width: parent.width
    visible: tab.connections.length === 0 && tab.error === ""
    textFormat: Text.PlainText
    text: tab.loading ? "Loading WireGuard connections…" : "No configured WireGuard connections found."
    wrapMode: Text.Wrap
    color: tab.foreground
    font.family: tab.fontFamily
    font.pixelSize: Style.font.body
  }

  ListView {
    id: connectionsList
    width: parent.width
    height: Math.min(contentHeight, Style.space(300))
    clip: true
    spacing: Style.space(6)
    model: tab.connections
    currentIndex: tab.selectedIndex
    onCurrentIndexChanged: if (currentIndex >= 0) positionViewAtIndex(currentIndex, ListView.Contain)

    delegate: Column {
      id: row
      required property var modelData
      required property int index
      width: connectionsList.width
      spacing: Style.space(3)

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: row.modelData.name
        elide: Text.ElideRight
        color: tab.foreground
        font.family: tab.fontFamily
        font.pixelSize: Style.font.body
      }
      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: row.modelData.backend + " · " + row.modelData.state + (row.modelData.interface ? " · " + row.modelData.interface : "")
        elide: Text.ElideRight
        color: tab.foreground
        opacity: 0.7
        font.family: tab.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
      Button {
        width: parent.width
        text: tab.pendingId === row.modelData.id ? "Working…" : (row.modelData.active ? "Disconnect" : "Connect")
        foreground: tab.foreground
        fontFamily: tab.fontFamily
        fontSize: Style.font.bodySmall
        bordered: true
        enabled: tab.pendingId === "" && row.modelData.state !== "activating" && row.modelData.state !== "deactivating"
        hasCursor: tab.cursorActive && tab.selectedIndex === row.index
        onHovered: function(on) { if (on) tab.selectRow(row.index) }
        onClicked: tab.activate(row.modelData)
      }
    }
  }
}
