'use strict'

/**
 * @module @yoda/network
 * @description Provides classes to manage network functions on the device.
 */

var logger = require('logger')('network')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var flora = require('@yoda/flora')

module.exports = Network

function Network () {
  EventEmitter.call(this)

  this.wifiStatus = {state: "DISCONNECTED"}
  this.ethernetStatus = {state: "DISCONNECTED"}
  this.modemStatus = {state: "DISCONNECTED"}
  this.networkStatus = {state: "DISCONNECTED"}

  this._remoteCallTarget = "net_manager"
  this._remoteCallCommand = "network.command"
  this._remoteCallTimeout = 60 * 1000

  this._agent = null
  this._initAgent()

  this._initPing()
}
inherits(Network, EventEmitter)

Network.prototype._initAgent = function () {
  this._agent = new flora.Agent('unix:/var/run/flora.sock')

  this._agent.subscribe("network.status", (msg, type) => {
    var msg = JSON.parse(msg[0])

    if (msg.wifi) {
      this.wifiStatus = msg.wifi
      this.emit('network.status', 'wifi', msg.wifi)
    } else if (msg.ethernet) {
      this.ethernetStatus = msg.ethernet
      this.emit('network.status', 'ethernet', msg.ethernet)
    } else if (msg.modem) {
      this.modemStatus = msg.modem
      this.emit('network.status', 'modem', msg.modem)
    }
  })

  this._agent.start()
}

Network.prototype._initPing = function () {
  // TODO: Implement ping with napi
  this.networkStatus = {state: "CONNECTED"}
}

Network.prototype._remoteCall = function (device, command, params) {
  var data = {
    "device": device,
    "command": command,
  }
  if (params) data.params = params

  return this._agent.call(this._remoteCallCommand, [JSON.stringify(data)],
                          this._remoteCallTarget, this._remoteCallTimeout)
}

Network.prototype.capacities = function () {
  return this._remoteCall("NETWORK", "GET_CAPACITY")
}

Network.prototype.wifiOpen = function (ssid, passwd) {
  return this._remoteCall("WIFI", "CONNECT", {"SSID": ssid, "PASSWD": passwd})
}

Network.prototype.wifiClose = function () {
  return this._remoteCall("WIFI", "DISCONNECT")
}

Network.prototype.wifiStartScan = function () {
  return this._remoteCall("WIFI", "START_SCAN")
}

Network.prototype.wifiStopScan = function () {
  return this._remoteCall("WIFI", "STOP_SCAN")
}

Network.prototype.wifiScanList = function () {
  return this._remoteCall("WIFI", "GET_WIFILIST")
}

Network.prototype.wifiApOpen = function (ssid, passwd, ip, timeout) {
  return this._remoteCall("WIFI_AP", "CONNECT", {
    "SSID": ssid,
    "PASSWD": passwd,
    "IP": ip,
    "TIMEOUT": timeout
  })
}

Network.prototype.wifiApClose = function () {
  return this._remoteCall("WIFI_AP", "DISCONNECT")
}

Network.prototype.modemOpen = function () {
  return this._remoteCall("MODEM", "CONNECT")
}

Network.prototype.modemClose = function () {
  return this._remoteCall("MODEM", "DISCONNECT")
}
